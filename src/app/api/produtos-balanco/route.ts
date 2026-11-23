import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { isAdminSession } from '@/lib/session';
import { hasXmlDirecaoColumn } from '@/lib/serverSchema';

/**
 * BLOCO 193 — PORTAL DE PRODUTOS: BALANÇO ENTRADA x SAÍDA (admin).
 *
 * GET /api/produtos-balanco
 *   ENTRADAS com nota  = XML de fornecedor (Portal de Entradas) já com
 *                        entrada no estoque confirmada (entrada_estoque_em).
 *   SAÍDAS com nota    = vendas feitas PELO APP com NF (sales + sale_items)
 *                        + XML de nota de venda emitida FORA do app
 *                        (xml_importacoes.direcao = 'SAIDA' — BLOCO 193).
 *   BALANÇO por produto (entradas − saídas) + ALERTAS: produto com saída
 *   que não tem entrada nenhuma (ou saída maior que a entrada).
 *
 * Auth: mesma sessão dos portais (Bearer ADMIN do /api/notas-admin AUTH).
 */

const BAD = (status: number, erro: string) =>
  NextResponse.json({ ok: false, erro }, { status });

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export async function GET(request: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponivel.');
  }
  if (!isAdminSession(request)) {
    return BAD(401, 'Sessao expirada. Entre com o PIN novamente.');
  }

  const db = getServiceClient();

  // ---- importações (cabeçalho) — direcao entra quando o SQL 193 rodou ----
  type Imp = { id: string; numero: string; emit_nome: string; data_emissao: string | null; direcao: string };
  const importacoes = new Map<string, Imp>();
  const temDirecao = await hasXmlDirecaoColumn();
  const impCols = temDirecao ? 'id, numero, emit_nome, data_emissao, direcao' : 'id, numero, emit_nome, data_emissao';
  const { data: impRaw, error: impErr } = await db.from('xml_importacoes').select(impCols).limit(5000);
  if (impErr) return BAD(503, `Banco desatualizado: rode sql/bloco95_xml_produtos.sql (${impErr.message})`);
  for (const i of (impRaw || []) as Record<string, unknown>[]) {
    importacoes.set(String(i.id), {
      id: String(i.id),
      numero: String(i.numero || ''),
      emit_nome: String(i.emit_nome || ''),
      data_emissao: (i.data_emissao as string) || null,
      direcao: String(i.direcao || 'ENTRADA'),
    });
  }

  // ---- itens das XMLs ----
  const { data: itensRaw, error: itensErr } = await db
    .from('xml_itens')
    .select('id, importacao_id, x_prod, c_ean, quantidade, valor_unitario, valor_total, produto_id, status, entrada_estoque_em, criado_em')
    .limit(20000);
  if (itensErr) return BAD(503, `Banco desatualizado: rode sql/bloco95_xml_produtos.sql (${itensErr.message})`);

  // ---- vendas com nota do app (saídas) + itens ----
  // BLOCO 206 FIX: sales usa client_id (não existe sales.cliente_id).
  let salesRaw: Record<string, unknown>[] | null = null;
  let salesErr: { message: string } | null = null;
  {
    const r = await db
      .from('sales')
      .select('id, data_venda, nota_numero, nota_status, client_id, sale_items(produto_id, quantidade, preco_venda, custo_unitario)')
      .not('nota_numero', 'is', null)
      .order('data_venda', { ascending: false })
      .limit(5000);
    salesRaw = r.data as Record<string, unknown>[] | null;
    salesErr = r.error as { message: string } | null;
  }
  if (salesErr && /custo_unitario/i.test(salesErr.message || '')) {
    const r = await db
      .from('sales')
      .select('id, data_venda, nota_numero, nota_status, client_id, sale_items(produto_id, quantidade, preco_venda)')
      .not('nota_numero', 'is', null)
      .order('data_venda', { ascending: false })
      .limit(5000);
    salesRaw = r.data as Record<string, unknown>[] | null;
    salesErr = r.error as { message: string } | null;
  }
  if (salesErr) return BAD(500, `Falha lendo vendas com nota: ${salesErr.message}`);

  // ---- catálogo (nomes + preço de custo) ----
  const { data: prodRaw } = await db.from('products').select('id, nome, preco_custo, ean').limit(10000);
  const produtos = new Map<string, { nome: string; custo: number; ean: string }>();
  for (const p of (prodRaw || []) as Record<string, unknown>[]) {
    produtos.set(String(p.id), {
      nome: String(p.nome || 'Produto'),
      custo: round2(p.preco_custo),
      ean: String(p.ean || ''),
    });
  }

  type Agg = { qtd: number; custo: number; venda: number; notas: number };
  const entradaVinc = new Map<string, Agg>();
  const entradaPend = new Map<string, Agg>();
  const saidaXmlVinc = new Map<string, Agg>();
  const semVinculoEntrada: { x_prod: string; c_ean: string; quantidade: number; valor_unitario: number; numero: string; emit: string; data: string | null }[] = [];
  const semVinculoSaida: { x_prod: string; c_ean: string; quantidade: number; valor_unitario: number; numero: string; emit: string; data: string | null }[] = [];

  const addAgg = (m: Map<string, Agg>, pid: string, qtd: number, custo: number, venda = 0, novaNota = true) => {
    const cur = m.get(pid) || { qtd: 0, custo: 0, venda: 0, notas: 0 };
    cur.qtd = round2(cur.qtd + qtd);
    cur.custo = round2(cur.custo + custo);
    cur.venda = round2(cur.venda + venda);
    if (novaNota) cur.notas += 1;
    m.set(pid, cur);
  };

  // ENTRADAS: XML de fornecedor (direcao ENTRADA / ausente)
  for (const it of (itensRaw || []) as Record<string, unknown>[]) {
    const imp = importacoes.get(String(it.importacao_id));
    const direcao = imp?.direcao || 'ENTRADA';
    const qtd = round2(it.quantidade);
    const vUn = round2(it.valor_unitario);
    const pid = it.produto_id ? String(it.produto_id) : '';
    const entradaOk = !!it.entrada_estoque_em;
    if (direcao === 'SAIDA') {
      // SAÍDA de XML de terceiros: conta quando vinculada; sem vínculo, alerta
      if (pid) addAgg(saidaXmlVinc, pid, qtd, round2(vUn * qtd), round2(it.valor_total));
      else semVinculoSaida.push({ x_prod: String(it.x_prod || ''), c_ean: String(it.c_ean || ''), quantidade: qtd, valor_unitario: vUn, numero: imp?.numero || '', emit: imp?.emit_nome || '', data: imp?.data_emissao || null });
      continue;
    }
    if (pid && entradaOk) addAgg(entradaVinc, pid, qtd, round2(vUn * qtd), 0, false);
    else if (pid) addAgg(entradaPend, pid, qtd, round2(vUn * qtd), 0, false);
    else semVinculoEntrada.push({ x_prod: String(it.x_prod || ''), c_ean: String(it.c_ean || ''), quantidade: qtd, valor_unitario: vUn, numero: imp?.numero || '', emit: imp?.emit_nome || '', data: imp?.data_emissao || null });
  }

  // SAÍDAS do app: sales com nota + sale_items
  const saidaAppVinc = new Map<string, Agg>();
  let notasSaida = 0;
  for (const s of (salesRaw || []) as Record<string, unknown>[]) {
    const itens = (s.sale_items || []) as Record<string, unknown>[];
    notasSaida += 1;
    for (const it of itens) {
      const pid = it.produto_id ? String(it.produto_id) : '';
      if (!pid) continue;
      const qtd = round2(it.quantidade);
      const custoUn = it.custo_unitario != null ? round2(it.custo_unitario) : produtos.get(pid)?.custo ?? 0;
      addAgg(saidaAppVinc, pid, qtd, round2(custoUn * qtd), round2((it.preco_venda as number) * qtd), false);
    }
  }

  // ---- balanço por produto ----
  const ids = new Set<string>([...entradaVinc.keys(), ...entradaPend.keys(), ...saidaAppVinc.keys(), ...saidaXmlVinc.keys()]);
  const balanco = [...ids]
    .map((pid) => {
      const p = produtos.get(pid);
      const e = entradaVinc.get(pid) || { qtd: 0, custo: 0, notas: 0 };
      const pend = entradaPend.get(pid) || { qtd: 0, custo: 0, notas: 0 };
      const sApp = saidaAppVinc.get(pid) || { qtd: 0, custo: 0, venda: 0, notas: 0 };
      const sXml = saidaXmlVinc.get(pid) || { qtd: 0, custo: 0, venda: 0, notas: 0 };
      const saidaQ = round2(sApp.qtd + sXml.qtd);
      const entradaQ = round2(e.qtd);
      // ALERTA: sai com nota e nunca entrou com nota (ou sai mais do que entrou)
      const alerta = saidaQ > 0 && (entradaQ === 0 || saidaQ > entradaQ);
      return {
        produtoId: pid,
        nome: p?.nome || 'Produto',
        custoCad: p?.custo ?? 0,
        entradaQtd: entradaQ,
        entradaCusto: e.custo,
        entradaPendQtd: pend.qtd,
        saidaQtd: saidaQ,
        saidaCusto: round2(sApp.custo + sXml.custo),
        saidaVenda: round2(sApp.venda + sXml.venda),
        saldoQtd: round2(entradaQ - saidaQ),
        alerta,
      };
    })
    .sort((a, b) => (a.alerta === b.alerta ? b.saidaQtd - a.saidaQtd : a.alerta ? -1 : 1));

  const totalEntradas = round2([...entradaVinc.values()].reduce((a, e) => a + e.qtd, 0));
  const totalSaidas = round2(balanco.reduce((a, b) => a + b.saidaQtd, 0));
  const custoEntradas = round2([...entradaVinc.values()].reduce((a, e) => a + e.custo, 0));
  const custoSaidas = round2(balanco.reduce((a, b) => a + b.saidaCusto, 0));
  const vendaSaidas = round2(balanco.reduce((a, b) => a + b.saidaVenda, 0));

  return NextResponse.json({
    ok: true,
    temDirecao,
    resumo: {
      totalEntradas,
      totalSaidas,
      saldoQtd: round2(totalEntradas - totalSaidas),
      custoEntradas,
      custoSaidas,
      vendaSaidas,
      alertas: balanco.filter((b) => b.alerta).length,
      notasSaida,
      notasEntrada: [...importacoes.values()].filter((i) => i.direcao === 'ENTRADA').length,
      notasSaidaXml: [...importacoes.values()].filter((i) => i.direcao === 'SAIDA').length,
    },
    balanco,
    semVinculoEntrada: semVinculoEntrada.slice(0, 60),
    semVinculoSaida: semVinculoSaida.slice(0, 60),
  });
}
