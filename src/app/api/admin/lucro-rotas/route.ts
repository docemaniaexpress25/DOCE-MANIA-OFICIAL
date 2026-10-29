import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { isAdminSession } from '@/lib/session';

/**
 * BLOCO 79 — LUCRO POR ROTA (visao do admin)
 *
 * GET /api/admin/lucro-rotas?mes=YYYY-MM   [sessao ADMIN]
 *
 * A conta que o dono pediu, rota por rota, SEMPRE ATUAL (calculada na hora,
 * conforme as vendas acontecem — nao e relatorio congelado):
 *   Faturamento = soma(sales.valor_total) do mes
 *   Custo       = soma(itens.quantidade x products.preco_custo) dos produtos vendidos
 *   LUCRO BRUTO = Faturamento - Custo   (comissao/despesas o dono desconta a parte)
 *
 * Regras:
 * - Mes em America/Sao_Paulo (UTC-3 fixo, sem horario de verao): a janela em UTC
 *   vai do dia 1 as 03:00Z ate o dia 1 do mes seguinte as 03:00Z.
 * - Venda a prazo (PENDENTE) entra no faturamento do mes da VENDA — o painel
 *   separa PAGO x PENDENTE para o dono ver o que ainda nao caiu na conta.
 * - Custo = preco_custo CADASTRADO HOJE (o sistema nao guarda custo historico
 *   por item; se o custo mudou no meio do mes, a leitura usa o de agora).
 * - Vendas excluidas nao existem mais no banco (estorno fisico) — nao contam.
 * - Agrupamento pela ROTA do vendedor (app_users.rota). Vendedor sem rota
 *   cai em ROTA_01 (mesma regra do login). Vendedor apagado do banco cai em
 *   "SEM ROTA" para o numero nunca sumir da conta.
 */

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Mes corrente no fuso de Sao Paulo (UTC-3), como YYYY-MM */
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

type Acc = {
  n: number; fat: number; custo: number;
  pagoN: number; pagoFat: number; pagoCus: number;
  pendN: number; pendFat: number; pendCus: number;
};

const accZero = (): Acc => ({ n: 0, fat: 0, custo: 0, pagoN: 0, pagoFat: 0, pagoCus: 0, pendN: 0, pendFat: 0, pendCus: 0 });

function soma(a: Acc, b: Acc): Acc {
  return {
    n: a.n + b.n, fat: a.fat + b.fat, custo: a.custo + b.custo,
    pagoN: a.pagoN + b.pagoN, pagoFat: a.pagoFat + b.pagoFat, pagoCus: a.pagoCus + b.pagoCus,
    pendN: a.pendN + b.pendN, pendFat: a.pendFat + b.pendFat, pendCus: a.pendCus + b.pendCus,
  };
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

function rotuloRota(rota: string): string {
  if (!rota || rota === 'SEM ROTA') return 'SEM ROTA';
  return rota.replace(/^ROTA_/i, 'ROTA ').toUpperCase();
}

export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ error: 'Servidor nao configurado (SUPABASE_SERVICE_ROLE_KEY).' }, { status: 503 });
  }
  if (!isAdminSession(req)) {
    return NextResponse.json({ error: 'Acesso restrito ao administrador.' }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const pMes = url.searchParams.get('mes') || '';
    const mes = RE_MES.test(pMes) ? pMes : mesCorrenteSP();
    const { ini, fim } = janelaUTC(mes);

    // 1) Vendedores (rota de cada um) — service role le app_users direto
    const users = await todos('app_users', (r) =>
      r.from('app_users').select('id, nome, perfil, rota').order('nome', { ascending: true })
    );
    const userById = new Map<string, any>();
    for (const u of users) userById.set(String(u.id), u);

    // 2) Vendas do mes
    const vendas = await todos('sales', (r) =>
      r.from('sales')
        .select('id, vendedor_id, valor_total, status_pagamento')
        .gte('data_venda', ini)
        .lt('data_venda', fim)
        .order('data_venda', { ascending: true })
    );

    // 3) Itens dessas vendas (lotes de 40 ids para nao estourar a query)
    const itens: any[] = [];
    for (let i = 0; i < vendas.length; i += 40) {
      const lote = vendas.slice(i, i + 40).map((v: any) => String(v.id));
      const parte = await todos('sale_items', (r) =>
        r.from('sale_items').select('sale_id, produto_id, quantidade').in('sale_id', lote)
      );
      itens.push(...parte);
    }

    // 4) Custo atual dos produtos envolvidos
    const prodIds = [...new Set(itens.map((it: any) => String(it.produto_id)))];
    const custoPorProduto = new Map<string, number>();
    const semCadastro = new Set<string>();
    for (let i = 0; i < prodIds.length; i += 200) {
      const lote = prodIds.slice(i, i + 200);
      if (lote.length === 0) continue;
      const prods = await todos('products', (r) =>
        r.from('products').select('id, preco_custo').in('id', lote)
      );
      for (const p of prods) custoPorProduto.set(String(p.id), Number(p.preco_custo) || 0);
    }
    for (const id of prodIds) if (!custoPorProduto.has(id)) semCadastro.add(id);

    // 5) Conta: por vendedor e por rota
    const porVendedor = new Map<string, { user: any; acc: Acc }>();
    for (const v of vendas) {
      const uid = String(v.vendedor_id || '');
      if (!porVendedor.has(uid)) porVendedor.set(uid, { user: userById.get(uid) || null, acc: accZero() });
      const e = porVendedor.get(uid)!;
      const fat = Number(v.valor_total) || 0;
      const pago = String(v.status_pagamento || '').toUpperCase() === 'PAGO';
      e.acc.n += 1;
      e.acc.fat += fat;
      if (pago) { e.acc.pagoN += 1; e.acc.pagoFat += fat; } else { e.acc.pendN += 1; e.acc.pendFat += fat; }
    }
    // custo por venda (itens)
    const custoPorVenda = new Map<string, number>();
    for (const it of itens) {
      const sid = String(it.sale_id);
      const c = (Number(it.quantidade) || 0) * (custoPorProduto.get(String(it.produto_id)) ?? 0);
      custoPorVenda.set(sid, (custoPorVenda.get(sid) || 0) + c);
    }
    for (const v of vendas) {
      const e = porVendedor.get(String(v.vendedor_id || ''));
      if (!e) continue;
      const c = custoPorVenda.get(String(v.id)) || 0;
      e.acc.custo += c;
      if (String(v.status_pagamento || '').toUpperCase() === 'PAGO') e.acc.pagoCus += c; else e.acc.pendCus += c;
    }

    // 6) Agrupa por rota
    const porRota = new Map<string, { rotulo: string; acc: Acc; vendedores: any[] }>();
    for (const [uid, { user, acc }] of porVendedor) {
      const rotaKey = user ? String(user.rota || 'ROTA_01').toUpperCase() : 'SEM ROTA';
      if (!porRota.has(rotaKey)) porRota.set(rotaKey, { rotulo: rotuloRota(rotaKey), acc: accZero(), vendedores: [] });
      const g = porRota.get(rotaKey)!;
      g.acc = soma(g.acc, acc);
      g.vendedores.push({
        id: uid,
        nome: user?.nome || '(vendedor removido)',
        role: user?.perfil || 'VENDEDOR',
        nVendas: acc.n,
        faturamento: +acc.fat.toFixed(2),
        custo: +acc.custo.toFixed(2),
        lucro: +(acc.fat - acc.custo).toFixed(2),
      });
    }
    // vendedor cadastrado SEM venda no mes: entra com zero para o dono ver a rota completa
    for (const u of users) {
      const uid = String(u.id);
      if (porVendedor.has(uid)) continue;
      const rotaKey = String(u.rota || 'ROTA_01').toUpperCase();
      if (!porRota.has(rotaKey)) porRota.set(rotaKey, { rotulo: rotuloRota(rotaKey), acc: accZero(), vendedores: [] });
      porRota.get(rotaKey)!.vendedores.push({ id: uid, nome: u.nome, role: u.perfil, nVendas: 0, faturamento: 0, custo: 0, lucro: 0 });
    }

    const rotas = [...porRota.entries()]
      .map(([rotaKey, g]) => ({
        rota: rotaKey,
        rotulo: g.rotulo,
        nVendas: g.acc.n,
        faturamento: +g.acc.fat.toFixed(2),
        custo: +g.acc.custo.toFixed(2),
        lucro: +(g.acc.fat - g.acc.custo).toFixed(2),
        margem: g.acc.fat > 0 ? +(((g.acc.fat - g.acc.custo) / g.acc.fat) * 100).toFixed(1) : 0,
        pago: {
          n: g.acc.pagoN, faturamento: +g.acc.pagoFat.toFixed(2),
          custo: +g.acc.pagoCus.toFixed(2), lucro: +(g.acc.pagoFat - g.acc.pagoCus).toFixed(2),
        },
        pendente: {
          n: g.acc.pendN, faturamento: +g.acc.pendFat.toFixed(2),
          custo: +g.acc.pendCus.toFixed(2), lucro: +(g.acc.pendFat - g.acc.pendCus).toFixed(2),
        },
        vendedores: g.vendedores.sort((a, b) => b.faturamento - a.faturamento),
      }))
      .sort((a, b) => a.rota.localeCompare(b.rota));

    // Totais gerais (soma das rotas)
    const T = accZero();
    for (const r of rotas) {
      T.n += r.nVendas; T.fat += r.faturamento; T.custo += r.custo;
      T.pagoN += r.pago.n; T.pagoFat += r.pago.faturamento; T.pagoCus += r.pago.custo;
      T.pendN += r.pendente.n; T.pendFat += r.pendente.faturamento; T.pendCus += r.pendente.custo;
    }
    const totais = {
      nVendas: T.n,
      faturamento: +T.fat.toFixed(2),
      custo: +T.custo.toFixed(2),
      lucro: +(T.fat - T.custo).toFixed(2),
      margem: T.fat > 0 ? +(((T.fat - T.custo) / T.fat) * 100).toFixed(1) : 0,
    };

    return NextResponse.json({
      ok: true,
      mes,
      geradoEm: new Date().toISOString(),
      rotas,
      totais,
      avisos: {
        produtosSemCusto: semCadastro.size,
        detalhe: 'Lucro BRUTO = faturamento - custo dos produtos vendidos (preco de custo cadastrado hoje). Comissoes, taxas e despesas NAO estao descontadas. Vendas a prazo (pendente) entram no faturamento do mes da venda.',
      },
    });
  } catch (e: any) {
    console.error('[api/admin/lucro-rotas GET] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao calcular o lucro por rota.' }, { status: 500 });
  }
}
