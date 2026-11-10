import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasKardexTable } from '@/lib/serverSchema';

/**
 * BLOCO 108 — KARDEX DE ESTOQUE (todas as entradas e saidas, 100% rastreavel).
 *
 * GET  /api/estoque/movimentos?limit=150&tipo=ENTRADA&origem=VENDA&busca=ceb
 *      -> lista + resumo (ADMIN e SECRETARIO; vendedor NAO ve o kardex global)
 *
 * POST /api/estoque/movimentos
 *      { produtoId, tipo:'ENTRADA'|'SAIDA', quantidade, origem:'MANUAL',
 *        referencia?, custoUnitario? }
 *      -> RPC atomico registrar_movimento_estoque (movimento + estoque na
 *         mesma transacao). ADMIN e SECRETARIO.
 *
 * As SAIDAS de venda chegam aqui pelo TRIGGER trg_kardex_sale_items (SQL 108)
 * — automatico, aprovado a falhas. Esta rota e leitura + movimento manual.
 */

const BAD = (status: number, erro: string) => NextResponse.json({ ok: false, erro }, { status });

export async function GET(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');
  if (session.perfil !== 'ADMIN' && session.perfil !== 'SECRETARIO') {
    return BAD(403, 'Somente admin e secretario veem as movimentacoes de estoque.');
  }

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(500, Math.max(1, parseInt(sp.get('limit') || '150', 10) || 150));
  const tipo = (sp.get('tipo') || '').toUpperCase();
  const origem = (sp.get('origem') || '').toUpperCase();
  const busca = (sp.get('busca') || '').trim();

  if (!(await hasKardexTable())) {
    return NextResponse.json({
      ok: true,
      disponivel: false,
      resumo: { entradas: 0, saidas: 0 },
      movimentos: [],
      instrucao: 'Rode o SQL do Bloco 108 (sql/bloco108_kardex_cupom.sql) no Supabase para ativar o kardex.',
    });
  }

  const db = getServiceClient();
  let q = db
    .from('estoque_movimentos')
    .select('id, produto_id, tipo, origem, referencia, quantidade, custo_unitario, saldo_apos, usuario_nome, criado_em, products(nome)')
    .order('criado_em', { ascending: false })
    .limit(limit);
  if (['ENTRADA', 'SAIDA', 'AJUSTE', 'ESTORNO'].includes(tipo)) q = q.eq('tipo', tipo);
  if (['VENDA', 'MANUAL', 'XML', 'CARGA'].includes(origem)) q = q.eq('origem', origem);

  const { data, error } = await q;
  if (error) return BAD(500, `Falha ao ler movimentacoes: ${error.message}`);

  const rows = (data || []) as Record<string, unknown>[];
  const movimentos = rows
    .filter((r) => !busca || String((r.products as Record<string, unknown> | null)?.nome || '').toLowerCase().includes(busca.toLowerCase()))
    .map((r) => ({
      id: r.id,
      produto_id: r.produto_id,
      produto_nome: (r.products as Record<string, unknown> | null)?.nome || 'Produto',
      tipo: r.tipo,
      origem: r.origem,
      referencia: r.referencia || '',
      quantidade: Number(r.quantidade) || 0,
      custo_unitario: r.custo_unitario === null || r.custo_unitario === undefined ? null : Number(r.custo_unitario),
      saldo_apos: r.saldo_apos === null || r.saldo_apos === undefined ? null : Number(r.saldo_apos),
      usuario_nome: r.usuario_nome || '',
      criado_em: r.criado_em,
    }));

  // Resumo dentro do recorte (sem filtro de tipo) — entradas vs saidas
  let resumo = { entradas: 0, saidas: 0 };
  if (!tipo) {
    resumo = movimentos.reduce(
      (acc, m) => {
        if (m.tipo === 'ENTRADA') acc.entradas += 1;
        else if (m.tipo === 'SAIDA') acc.saidas += 1;
        return acc;
      },
      { entradas: 0, saidas: 0 }
    );
  }

  return NextResponse.json({ ok: true, disponivel: true, resumo, movimentos });
}

export async function POST(req: NextRequest) {
  const bridged = await devBridge(req);
  if (bridged) return bridged;
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');
  if (session.perfil !== 'ADMIN' && session.perfil !== 'SECRETARIO') {
    return BAD(403, 'Somente admin e secretario movimentam o estoque.');
  }

  if (!(await hasKardexTable())) {
    return BAD(503, 'Kardex nao ativado ainda. Rode o SQL do Bloco 108 (sql/bloco108_kardex_cupom.sql) no Supabase.');
  }

  const body = await req.json().catch(() => ({}));
  const produtoId = String(body.produtoId || '');
  const tipo = String(body.tipo || '').toUpperCase();
  const quantidade = Number(body.quantidade);
  const origem = ['MANUAL', 'XML'].includes(String(body.origem || '').toUpperCase()) ? String(body.origem).toUpperCase() : 'MANUAL';
  const referencia = String(body.referencia || '').trim().slice(0, 200) || null;
  const custoUnitario = body.custoUnitario === undefined || body.custoUnitario === null || body.custoUnitario === '' ? null : Number(body.custoUnitario);

  if (!produtoId) return BAD(400, 'Escolha um produto.');
  if (!['ENTRADA', 'SAIDA'].includes(tipo)) return BAD(400, 'Tipo deve ser ENTRADA ou SAIDA.');
  if (!Number.isFinite(quantidade) || quantidade <= 0) return BAD(400, 'Quantidade deve ser maior que zero.');
  if (custoUnitario !== null && (!Number.isFinite(custoUnitario) || custoUnitario < 0)) return BAD(400, 'Custo unitario invalido.');

  const { data, error } = await getServiceClient().rpc('registrar_movimento_estoque', {
    p_produto_id: produtoId,
    p_tipo: tipo,
    p_quantidade: quantidade,
    p_origem: origem,
    p_referencia: referencia,
    p_custo_unitario: custoUnitario,
    p_usuario_id: session.sub,
    p_usuario_nome: session.nome || session.perfil,
  });
  if (error) return BAD(500, `Falha ao registrar: ${error.message}`);

  const res = (data || {}) as { ok?: boolean; erro?: string; saldo?: number };
  if (!res.ok) return BAD(422, res.erro || 'Movimento recusado pelo banco.');

  return NextResponse.json({ ok: true, saldo: Number(res.saldo) || 0 });
}
