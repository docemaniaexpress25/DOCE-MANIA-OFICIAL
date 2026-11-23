import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { isAdminSession } from '@/lib/session';
import { hasCustosEmpresaTable } from '@/lib/serverSchema';
// Helpers PUROS de conta a receber (mesma régua do app) — importáveis no servidor.
import { ehContaAReceber, saldoAberto, preVendaNaFila } from '@/lib/contaAReceber';

/**
 * BLOCO 191 — PORTAL FINANCEIRO (admin): o balanço geral da empresa.
 *
 * POST /api/financeiro { acao: 'RESUMO', periodo: 'HOJE'|'7D'|'30D'|'TUDO' }
 *   → entradas (faturamento, recebido, a receber por método), saídas
 *     (despesas dos vendedores, comissões pagas, custos lançados), logs
 *     (repasses + fechamentos de caixa) e balanço (recebido − saídas).
 * POST /api/financeiro { acao: 'ADD_CUSTO', descricao, categoria, valor, data? }
 * POST /api/financeiro { acao: 'DEL_CUSTO', id }
 *
 * Auth: MESMA sessão do Portal Fiscal — token ADMIN nascido do
 * POST /api/notas-admin {acao:'AUTH'} (Bearer). Nada de PIN novo.
 * SQL: sql/bloco191_financeiro.sql cria custos_empresa (degrada sem ele).
 */

const BAD = (status: number, erro: string) =>
  NextResponse.json({ ok: false, erro }, { status });

type Periodo = 'HOJE' | '7D' | '30D' | 'TUDO';

function inicioDoPeriodo(p: Periodo): string | null {
  const agora = new Date();
  const sp = (d: Date) => new Date(d.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const local = sp(agora);
  local.setHours(0, 0, 0, 0);
  if (p === 'HOJE') return local.toISOString();
  if (p === '7D') { local.setDate(local.getDate() - 6); return local.toISOString(); }
  if (p === '30D') { local.setDate(local.getDate() - 29); return local.toISOString(); }
  return null; // TUDO
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * A lib contaAReceber fala camelCase (Sale do app); as linhas do Supabase
 * vêm snake_case — traduz SÓ os campos que a régua usa (BLOCO 22).
 */
function vendaCamel(s: Record<string, unknown>): never {
  return {
    ...s,
    valorTotal: Number(s.valor_total) || 0,
    valorPago: Number(s.valor_pago) || 0,
    metodoPagamento: s.metodo_pagamento,
    statusPagamento: s.status_pagamento,
    tipoVenda: s.tipo_venda,
    entregaStatus: s.entrega_status,
    trocasValor: s.trocas_valor,
  } as never;
}

export async function POST(request: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponivel.');
  }
  if (!isAdminSession(request)) {
    return BAD(401, 'Sessao expirada. Entre com o PIN novamente.');
  }

  const body = await request.json().catch(() => ({}));
  const acao = String(body.acao || '');
  const db = getServiceClient();

  // ---------------------------------------------------------------
  // RESUMO — o balanço do período
  // ---------------------------------------------------------------
  if (acao === 'RESUMO') {
    const periodo: Periodo = ['HOJE', '7D', '30D', 'TUDO'].includes(String(body.periodo)) ? body.periodo : '30D';
    const desde = inicioDoPeriodo(periodo);

    // ---- vendas (entradas) — BLOCO 205.1 FIX: a coluna de sales é data_venda
    //      (não existe sales.data — erro "column sales.data does not exist").
    //      BLOCO 206 FIX: sales usa client_id (não existe sales.cliente_id —
    //      erro "column sales.cliente_id does not exist" quebrando o portal). ----
    let salesQ = db.from('sales').select('id, data_venda, valor_total, valor_pago, metodo_pagamento, status_pagamento, tipo_venda, entrega_status, client_id, vendedor_id, nota_numero, trocas_valor');
    if (desde) salesQ = salesQ.gte('data_venda', desde);
    salesQ = salesQ.order('data_venda', { ascending: false }).limit(3000);
    const { data: salesRaw, error: eSales } = await salesQ;
    if (eSales) return BAD(500, `Falha lendo vendas: ${eSales.message}`);

    const sales = (salesRaw || []) as Record<string, unknown>[];
    const vendasEfetivas = sales.filter((s) => !preVendaNaFila(vendaCamel(s)));

    let faturado = 0;
    let recebido = 0;
    let aReceber = 0;
    let recebidoDinheiro = 0;
    let recebidoPix = 0;
    let recebidoBoleto = 0;
    for (const s of vendasEfetivas) {
      const v = vendaCamel(s);
      const total = round2(s.valor_total);
      const pago = round2(s.valor_pago);
      const metodo = String(s.metodo_pagamento || '').toUpperCase();
      faturado += total;
      if (ehContaAReceber(v)) {
        aReceber += saldoAberto(v);
        recebido += pago;
        if (metodo === 'DINHEIRO') recebidoDinheiro += pago;
        if (metodo === 'PIX') recebidoPix += pago;
        if (metodo === 'BOLETO' || metodo === 'APRAZO') recebidoBoleto += pago;
      } else {
        recebido += total;
        if (metodo === 'DINHEIRO') recebidoDinheiro += total;
        else if (metodo === 'PIX') recebidoPix += total;
        else if (metodo === 'BOLETO' || metodo === 'APRAZO') recebidoBoleto += total;
        else recebidoDinheiro += total; // MISTO e outros: cai no dinheiro do balanço
      }
    }

    // ---- nomes dos clientes/vendedores das últimas vendas ----
    const clientIds = [...new Set(sales.slice(0, 200).map((s) => String(s.client_id || '')))].filter(Boolean);
    const nomes = new Map<string, string>();
    if (clientIds.length > 0) {
      const { data: cl } = await db.from('clients').select('id, nome_fantasia, nome').in('id', clientIds.slice(0, 200));
      for (const c of (cl || []) as Record<string, unknown>[]) {
        nomes.set(String(c.id), String(c.nome_fantasia || c.nome || 'Cliente'));
      }
    }
    const vendedorIds = [...new Set(sales.slice(0, 200).map((s) => String(s.vendedor_id || '')))].filter(Boolean);
    const nomesVend = new Map<string, string>();
    if (vendedorIds.length > 0) {
      const { data: vs } = await db.from('app_users').select('id, nome').in('id', vendedorIds.slice(0, 200));
      for (const v of (vs || []) as Record<string, unknown>[]) nomesVend.set(String(v.id), String(v.nome || 'Vendedor'));
    }

    const ultimasVendas = sales.slice(0, 40).map((s) => ({
      id: s.id,
      data: s.data_venda,
      cliente: nomes.get(String(s.client_id || '')) || 'Cliente',
      vendedor: nomesVend.get(String(s.vendedor_id || '')) || '—',
      valor: round2(s.valor_total),
      recebido: round2(ehContaAReceber(vendaCamel(s)) ? s.valor_pago : s.valor_total),
      metodo: s.metodo_pagamento,
      prazo: ehContaAReceber(vendaCamel(s)),
      naFila: preVendaNaFila(vendaCamel(s)),
      nota: s.nota_numero || null,
    }));

    // ---- saídas: despesas dos vendedores ----
    let expQ = db.from('seller_expenses').select('id, seller_id, descricao, valor, created_at');
    if (desde) expQ = expQ.gte('created_at', desde);
    const { data: expRaw } = await expQ.order('created_at', { ascending: false }).limit(300);
    const despesas = (expRaw || []) as Record<string, unknown>[];
    const totalDespesas = round2(despesas.reduce((a, d) => a + Number(d.valor || 0), 0));
    const despesasComNome = despesas.slice(0, 40).map((d) => ({
      id: d.id, descricao: d.descricao, valor: round2(d.valor), data: d.created_at,
      vendedor: nomesVend.get(String(d.seller_id || '')) || '—',
    }));

    // ---- saídas: comissões pagas (repasses) ----
    let logQ = db.from('commission_payment_logs').select('id, seller_id, valor_pago, metodo_pagamento, observacao, created_at, aceitado');
    if (desde) logQ = logQ.gte('created_at', desde);
    let logsRaw: Record<string, unknown>[] | null = null;
    let logErr: { message: string } | null = null;
    {
      const r = await logQ.order('created_at', { ascending: false }).limit(300);
      logsRaw = r.data as Record<string, unknown>[] | null;
      logErr = r.error as { message: string } | null;
    }
    if (logErr && /aceitado/i.test(logErr.message || '')) {
      const r = await db.from('commission_payment_logs').select('id, seller_id, valor_pago, metodo_pagamento, observacao, created_at').order('created_at', { ascending: false }).limit(300);
      logsRaw = r.data as Record<string, unknown>[] | null;
    }
    const repasses = (logsRaw || []) as Record<string, unknown>[];
    const totalComissoes = round2(repasses.reduce((a, r) => a + Number(r.valor_pago || 0), 0));
    const repassesLista = repasses.slice(0, 40).map((r) => ({
      id: r.id, valor: round2(r.valor_pago), data: r.created_at,
      vendedor: nomesVend.get(String(r.seller_id || '')) || '—',
      obs: r.observacao || '', aceitado: r.aceitado !== false,
    }));

    // ---- saídas: custos lançados pelo admin (custos_empresa) ----
    let custos: Record<string, unknown>[] = [];
    const temCustos = await hasCustosEmpresaTable();
    if (temCustos) {
      let cQ = db.from('custos_empresa').select('id, descricao, categoria, valor, data, criado_em');
      if (desde) cQ = cQ.gte('data', desde);
      const { data: cRaw } = await cQ.order('data', { ascending: false }).limit(300);
      custos = (cRaw || []) as Record<string, unknown>[];
    }
    const totalCustos = round2(custos.reduce((a, c) => a + Number(c.valor || 0), 0));

    const saidasTotal = round2(totalDespesas + totalComissoes + totalCustos);
    const saldo = round2(recebido - saidasTotal);

    // ---- caixa: últimos fechamentos ----
    const { data: caixaRaw } = await db
      .from('caixa_fechamentos')
      .select('id, fechado_em, fechado_por_nome, total_dinheiro, total_pix, total_deposito, total_geral, qtde_pagamentos')
      .order('fechado_em', { ascending: false })
      .limit(12);
    const caixa = (caixaRaw || []) as Record<string, unknown>[];

    return NextResponse.json({
      ok: true,
      periodo,
      temCustos,
      resumo: {
        faturado: round2(faturado),
        recebido: round2(recebido),
        aReceber: round2(aReceber),
        recebidoDinheiro: round2(recebidoDinheiro),
        recebidoPix: round2(recebidoPix),
        recebidoBoleto: round2(recebidoBoleto),
        totalDespesas,
        totalComissoes,
        totalCustos,
        saidasTotal,
        saldo,
        qtdeVendas: vendasEfetivas.length,
      },
      ultimasVendas,
      despesas: despesasComNome,
      repasses: repassesLista,
      custos: custos.slice(0, 60).map((c) => ({
        id: c.id, descricao: c.descricao, categoria: c.categoria,
        valor: round2(c.valor), data: c.data || c.criado_em,
      })),
      caixa: caixa.map((c) => ({
        id: c.id, data: c.fechado_em, nome: c.fechado_por_nome,
        dinheiro: round2(c.total_dinheiro), pix: round2(c.total_pix),
        deposito: round2(c.total_deposito), total: round2(c.total_geral),
        qtde: c.qtde_pagamentos,
      })),
    });
  }

  // ---------------------------------------------------------------
  // ADD_CUSTO — lança um custo da empresa (saída)
  // ---------------------------------------------------------------
  if (acao === 'ADD_CUSTO') {
    if (!(await hasCustosEmpresaTable())) {
      return BAD(503, 'Banco desatualizado: rode sql/bloco191_financeiro.sql no Supabase (tabela custos_empresa).');
    }
    const descricao = String(body.descricao || '').trim();
    const categoria = String(body.categoria || 'OUTROS').toUpperCase();
    const valor = round2(Number(body.valor));
    if (!descricao) return BAD(400, 'Informe a descrição do custo.');
    if (!(valor > 0)) return BAD(400, 'Informe um valor maior que zero.');
    const data = body.data ? new Date(String(body.data)).toISOString() : new Date().toISOString();
    const { data: row, error } = await db
      .from('custos_empresa')
      .insert({ descricao, categoria, valor, data })
      .select('id')
      .single();
    if (error) return BAD(500, `Falha gravando custo: ${error.message}`);
    return NextResponse.json({ ok: true, id: (row as Record<string, unknown>).id });
  }

  // ---------------------------------------------------------------
  // DEL_CUSTO — remove um custo lançado
  // ---------------------------------------------------------------
  if (acao === 'DEL_CUSTO') {
    if (!(await hasCustosEmpresaTable())) {
      return BAD(503, 'Banco desatualizado: rode sql/bloco191_financeiro.sql no Supabase (tabela custos_empresa).');
    }
    const id = String(body.id || '');
    if (!id) return BAD(400, 'Custo inválido.');
    const { error } = await db.from('custos_empresa').delete().eq('id', id);
    if (error) return BAD(500, `Falha removendo custo: ${error.message}`);
    return NextResponse.json({ ok: true });
  }

  return BAD(400, 'Ação inválida.');
}
