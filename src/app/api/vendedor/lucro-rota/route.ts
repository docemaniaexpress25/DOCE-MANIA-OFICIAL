import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';

/**
 * BLOCO 92 — LUCRO DA ROTA DO VENDEDOR (aba exclusiva do David — R5)
 *
 * GET    /api/vendedor/lucro-rota?mes=YYYY-MM   [sessao — cada um vê SÓ a própria rota]
 *
 *   A conta que o dono pediu, na base do vendedor:
 *     Faturamento   = Σ sales.valor_total do mês (preço de venda REAL,
 *                     "o que foi finalizado na venda")
 *     Custo         = Σ itens.quantidade × custo_unitario CONGELADO na venda
 *                     (Bloco 80 — mudar o custo hoje não altera o passado;
 *                      fallback: preco_custo cadastrado se o item não tiver)
 *     LUCRO BRUTO   = Faturamento − Custo                    (R$ + %)
 *     Despesas      = seller_expenses do vendedor no mês — a MESMA tabela
 *                     que o Financeiro usa ("Lançar Despesa") e que o
 *                     acerto de comissões do admin já desconta.
 *     LUCRO LÍQUIDO = Lucro Bruto − Despesas                 (R$ + %)
 *
 *   Extras: Recebido × A receber (por status_pagamento) e quebra DIA A DIA.
 *
 * POST   { descricao, valor }   -> lança despesa do PRÓPRIO vendedor
 * DELETE ?id=                   -> apaga despesa PRÓPRIA
 *
 * Regras:
 * - Mês em America/Sao_Paulo (UTC-3 fixo): janela UTC dia 1 03:00Z → dia 1 03:00Z
 *   (mesma regra do painel Lucro por Rota do admin).
 * - Vendas excluídas não existem mais no banco — não contam.
 * - Sem sessão: 401. Nada de dados cruzados entre vendedores.
 */

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Mês corrente no fuso de Sao Paulo (UTC-3), como YYYY-MM */
function mesCorrenteSP(): string {
  const sp = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return `${sp.getUTCFullYear()}-${String(sp.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Janela UTC [ini,fim) do mes YYYY-MM em Sao Paulo (dia 1 03:00Z -> dia 1 03:00Z) */
function janelaUTC(mes: string): { ini: string; fim: string } {
  const [y, m] = mes.split('-').map(Number);
  const ini = new Date(Date.UTC(y, m - 1, 1, 3, 0, 0));
  const fim = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 3, 0, 0));
  return { ini: ini.toISOString(), fim: fim.toISOString() };
}

async function todos(table: string, build: (r: any) => any): Promise<any[]> {
  const client = getServiceClient();
  const out: any[] = [];
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await build(client).range(off, off + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// Custo congelado por venda (sale_items.custo_unitario — Bloco 80). Se a coluna
// ainda não existir, cai no plano B sem quebrar: custo = preco_custo de hoje.
let temCustoCongelado: boolean | null = null;
async function colunaCustoCongelado(client: any): Promise<boolean> {
  if (temCustoCongelado !== null) return temCustoCongelado;
  try {
    const { error } = await client.from('sale_items').select('custo_unitario').limit(1);
    temCustoCongelado = !error;
  } catch {
    temCustoCongelado = false;
  }
  return temCustoCongelado;
}

type Acc = { n: number; fat: number; cus: number };

const accZero = (): Acc => ({ n: 0, fat: 0, cus: 0 });

const fechaAcc = (a: Acc) => ({
  nVendas: a.n,
  faturamento: +a.fat.toFixed(2),
  custo: +a.cus.toFixed(2),
  lucro: +(a.fat - a.cus).toFixed(2),
  margem: a.fat > 0 ? +(((a.fat - a.cus) / a.fat) * 100).toFixed(1) : 0,
});

export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ error: 'Servidor nao configurado (SUPABASE_SERVICE_ROLE_KEY).' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const pMes = url.searchParams.get('mes') || '';
    const mes = RE_MES.test(pMes) ? pMes : mesCorrenteSP();
    const { ini, fim } = janelaUTC(mes);
    const client = getServiceClient();
    const usaCongelado = await colunaCustoCongelado(client);
    const vendedorId = String(session.sub || '');

    // 1) Vendas do vendedor no mês (preço de venda REAL — o que foi finalizado)
    const vendas = await todos('sales', (r) =>
      r.from('sales')
        .select('id, data_venda, valor_total, status_pagamento')
        .eq('vendedor_id', vendedorId)
        .gte('data_venda', ini)
        .lt('data_venda', fim)
        .order('data_venda', { ascending: true })
    );

    // 2) Itens dessas vendas (custo congelado na venda — Bloco 80)
    const itens: any[] = [];
    for (let i = 0; i < vendas.length; i += 40) {
      const lote = vendas.slice(i, i + 40).map((v: any) => String(v.id));
      const parte = await todos('sale_items', (r) =>
        r.from('sale_items').select(`sale_id, produto_id, quantidade${usaCongelado ? ', custo_unitario' : ''}`).in('sale_id', lote)
      );
      itens.push(...parte);
    }

    // 3) Custo atual dos produtos envolvidos (fallback se o item não tem congelado)
    const prodIds = [...new Set(itens.map((it: any) => String(it.produto_id)))];
    const custoPorProduto = new Map<string, number>();
    for (let i = 0; i < prodIds.length; i += 200) {
      const lote = prodIds.slice(i, i + 200);
      if (lote.length === 0) continue;
      const prods = await todos('products', (r) =>
        r.from('products').select('id, preco_custo').in('id', lote)
      );
      for (const p of prods) custoPorProduto.set(String(p.id), Number(p.preco_custo) || 0);
    }

    // 4) Conta — total, por status de pagamento e por dia (fuso SP)
    const total = accZero();
    const pago = accZero();
    const aReceber = accZero();
    const porDia = new Map<string, Acc>();

    for (const v of vendas) {
      const e = String(v.status_pagamento || '').toUpperCase() === 'PAGO' ? pago : aReceber;
      const fat = Number(v.valor_total) || 0;
      total.n += 1; total.fat += fat; e.n += 1; e.fat += fat;
      const dia = new Date(new Date(v.data_venda).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (!porDia.has(dia)) porDia.set(dia, accZero());
      const d = porDia.get(dia)!;
      d.n += 1; d.fat += fat;
    }
    const custoPorVenda = new Map<string, number>();
    for (const it of itens) {
      const sid = String(it.sale_id);
      const congelado = usaCongelado && it.custo_unitario != null ? Number(it.custo_unitario) : null;
      const custoUnit = congelado != null && Number.isFinite(congelado)
        ? congelado
        : (custoPorProduto.get(String(it.produto_id)) ?? 0);
      const c = (Number(it.quantidade) || 0) * custoUnit;
      custoPorVenda.set(sid, (custoPorVenda.get(sid) || 0) + c);
    }
    for (const v of vendas) {
      const c = custoPorVenda.get(String(v.id)) || 0;
      total.cus += c;
      const e = String(v.status_pagamento || '').toUpperCase() === 'PAGO' ? pago : aReceber;
      e.cus += c;
      const dia = new Date(new Date(v.data_venda).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const d = porDia.get(dia);
      if (d) d.cus += c;
    }

    // 5) Despesas do vendedor no mês (mesma tabela do Financeiro)
    const despesasRows = await todos('seller_expenses', (r) =>
      r.from('seller_expenses')
        .select('id, descricao, valor, created_at')
        .eq('seller_id', vendedorId)
        .gte('created_at', ini)
        .lt('created_at', fim)
        .order('created_at', { ascending: false })
    );
    const despesas = despesasRows.map((d: any) => ({
      id: String(d.id),
      descricao: String(d.descricao || ''),
      valor: +(Number(d.valor) || 0).toFixed(2),
      data: d.created_at,
    }));
    const despesasTotal = +despesas.reduce((s: number, d: any) => s + d.valor, 0).toFixed(2);

    const totais = fechaAcc(total);
    const lucroBruto = totais.lucro;
    const lucroLiquido = +(lucroBruto - despesasTotal).toFixed(2);

    return NextResponse.json({
      ok: true,
      mes,
      geradoEm: new Date().toISOString(),
      totais: {
        ...totais,
        ticketMedio: totais.nVendas > 0 ? +(totais.faturamento / totais.nVendas).toFixed(2) : 0,
        despesasTotal,
        despesasPct: totais.faturamento > 0 ? +((despesasTotal / totais.faturamento) * 100).toFixed(1) : 0,
        lucroLiquido,
        margemLiquida: totais.faturamento > 0 ? +((lucroLiquido / totais.faturamento) * 100).toFixed(1) : 0,
      },
      pago: fechaAcc(pago),
      aReceber: fechaAcc(aReceber),
      porDia: [...porDia.entries()]
        .map(([dia, a]) => ({ dia, ...fechaAcc(a) }))
        .sort((a, b) => b.dia.localeCompare(a.dia)),
      despesas,
      avisos: {
        custoCongelado: usaCongelado,
        detalhe: 'Lucro = preço de venda REAL finalizado na venda − custo CONGELADO do momento da venda. Despesas são as mesmas do Financeiro e o admin já desconta no acerto.',
      },
    });
  } catch (e: any) {
    console.error('[api/vendedor/lucro-rota GET] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao calcular o lucro da rota.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ error: 'Servidor nao configurado (SUPABASE_SERVICE_ROLE_KEY).' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const descricao = String(body?.descricao || '').trim().slice(0, 120);
    const valor = Number(body?.valor);

    if (!descricao) {
      return NextResponse.json({ error: 'Descreva a despesa (ex: Combustível, Almoço).' }, { status: 400 });
    }
    if (!Number.isFinite(valor) || valor <= 0 || valor > 999999) {
      return NextResponse.json({ error: 'Valor invalido. Informe um valor maior que zero.' }, { status: 400 });
    }

    const registro = {
      seller_id: String(session.sub || ''),
      descricao,
      valor: +valor.toFixed(2),
    };
    if (!registro.seller_id) {
      return NextResponse.json({ error: 'Sessao invalida.' }, { status: 401 });
    }

    const { data, error } = await getServiceClient()
      .from('seller_expenses')
      .insert(registro)
      .select('id, descricao, valor, created_at')
      .single();
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      despesa: {
        id: String(data.id),
        descricao: String(data.descricao || ''),
        valor: +(Number(data.valor) || 0).toFixed(2),
        data: data.created_at,
      },
    });
  } catch (e: any) {
    console.error('[api/vendedor/lucro-rota POST] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao lancar a despesa.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ error: 'Servidor nao configurado (SUPABASE_SERVICE_ROLE_KEY).' }, { status: 503 });
  }
  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  }

  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id da despesa obrigatorio.' }, { status: 400 });
    }
    // .eq seller_id: cada um só apaga a despesa PRÓPRIA (mesmo tentando por fora)
    const { data, error } = await getServiceClient()
      .from('seller_expenses')
      .delete()
      .eq('id', id)
      .eq('seller_id', String(session.sub || ''))
      .select('id');
    if (error) throw error;

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Despesa nao encontrada.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[api/vendedor/lucro-rota DELETE] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao excluir a despesa.' }, { status: 500 });
  }
}
