import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';

/**
 * BLOCO 217 — POST /api/cargas (unifica o fluxo do Bloco 29 sem MODO)
 * A regra de ESTOQUE 1/ESTOQUE 2 (COM_NF | SEM_NF) foi REMOVIDA: existe UM
 * só saldo — o ESTOQUE CENTRAL (products.estoque_principal) — que abastece
 * a van (pronta entrega) e o próprio central (pré-venda).
 *
 * body: { vendedorId, itens: [{produtoId|produtoid, quantidade}], acao }
 *   acao 'APLICAR'   -> aplica AGORA: calcula o DELTA da van (desejado - atual),
 *                       move CASA no estoque central e substitui a carga.
 *   acao 'PENDENTE'  -> grava cargas_pendentes; o ACEITE em /api/cargas/aceitar
 *                       move a casa (mesma mecânica do delta).
 *
 * Regras do dono:
 * - CASA SEM SALDO SUFICIENTE -> 409 com a lista do que falta.
 * - So ADMIN carrega.
 */

interface ItemPayload { produtoId?: string; produtoid?: string; quantidade?: number; }

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return NextResponse.json({ ok: false, erro: 'Servidor nao configurado.' }, { status: 503 });
  }

  const session = sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, erro: 'Sessao expirada. Entre novamente.' }, { status: 401 });
  }
  if (session.perfil !== 'ADMIN') {
    return NextResponse.json({ ok: false, erro: 'Somente o admin carrega a van.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ ok: false, erro: 'Payload invalido.' }, { status: 400 });

  const vendedorId = String(body.vendedorId || '');
  const acao = String(body.acao || '').toUpperCase() === 'PENDENTE' ? 'PENDENTE' : 'APLICAR';
  const rawItens: ItemPayload[] = Array.isArray(body.itens) ? body.itens : [];

  if (!vendedorId || rawItens.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Carga vazia (vendedor ou itens ausentes).' }, { status: 400 });
  }

  const itens = rawItens
    .map(i => ({
      produtoId: String(i.produtoId || i.produtoid || ''),
      quantidade: Math.max(0, Math.floor(Number(i.quantidade) || 0)),
    }))
    .filter(i => i.produtoId);

  if (itens.length === 0) {
    return NextResponse.json({ ok: false, erro: 'Itens da carga invalidos.' }, { status: 400 });
  }

  try {
    const supabase = getServiceClient();

    // BLOCO 75/217: a casa é UNICA — o ESTOQUE CENTRAL (estoque_principal).
    const colCasa = 'estoque_principal';

    // ---------- ACAO PENDENTE: grava a pendente (casa move no aceite) ----------
    if (acao === 'PENDENTE') {
      const { error: insErr } = await supabase.from('cargas_pendentes').insert({
        vendedor_id: vendedorId,
        itens: itens.map(i => ({ produtoid: i.produtoId, quantidade: i.quantidade })),
        data_criacao: new Date().toISOString(),
        status: 'PENDENTE',
      });
      if (insErr) {
        return NextResponse.json({ ok: false, erro: 'Erro ao gravar a carga pendente.', detalhe: insErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, acao });
    }

    // ---------- ACAO APLICAR: delta da van + movimento de casa ----------
    const { data: cargaAtual, error: cargaErr } = await supabase
      .from('cargas').select('produto_id, quantidade').eq('vendedor_id', vendedorId);
    if (cargaErr) throw cargaErr;
    const atualMap = new Map<string, number>((cargaAtual || []).map((c: any) => [c.produto_id, Number(c.quantidade) || 0]));

    const ids = [...new Set(itens.map(i => i.produtoId))];
    // BLOCO 75: casa unica = Estoque Total
    const { data: prods, error: prodErr } = await supabase
      .from('products').select(`id, nome, estoque_principal`).in('id', ids);
    if (prodErr) throw prodErr;
    const prodMap = new Map<string, any>((prods || []).map((p: any) => [p.id, p]));

    // Delta por produto: desejado (van) - atual (van). Delta>0 tira de casa; delta<0 devolve.
    const deltas: { produtoId: string; delta: number }[] = [];
    const faltas: { produto: string; falta: number }[] = [];
    for (const i of itens) {
      const atual = atualMap.get(i.produtoId) ?? 0;
      const delta = i.quantidade - atual;
      if (delta === 0) continue;
      const p = prodMap.get(i.produtoId);
      if (!p) return NextResponse.json({ ok: false, erro: 'Produto nao encontrado no cadastro.' }, { status: 404 });
      if (delta > 0) {
        const casaSaldo = Number(p[colCasa] ?? 0);
        if (casaSaldo < delta) {
          faltas.push({ produto: p.nome || i.produtoId, falta: delta - casaSaldo });
        }
      }
      deltas.push({ produtoId: i.produtoId, delta });
    }
    if (faltas.length > 0) {
      const lista = faltas.map(f => `${f.produto} (falta ${f.falta})`).join(', ');
      return NextResponse.json({ ok: false, erro: `ESTOQUE TOTAL INSUFICIENTE: ${lista}. Fa a entrada primeiro.` }, { status: 409 });
    }

    // Move casa (Estoque Total) — update direto server-side (1 admin, janela de corrida irrelevante)
    for (const d of deltas) {
      if (d.delta === 0) continue;
      const p = prodMap.get(d.produtoId);
      const novo = Math.max(0, Number(p[colCasa] ?? 0) - d.delta);
      const { error: e2 } = await supabase.from('products').update({ [colCasa]: novo }).eq('id', d.produtoId);
      if (e2) throw e2;
    }

    // Substitui a carga da van pelo estado desejado
    const { error: delErr } = await supabase.from('cargas').delete().eq('vendedor_id', vendedorId);
    if (delErr) throw delErr;
    const rows = itens.filter(i => i.quantidade > 0).map(i => ({
      vendedor_id: vendedorId,
      produto_id: i.produtoId,
      quantidade: i.quantidade,
    }));
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('cargas').insert(rows);
      if (insErr) throw insErr;
    }

    return NextResponse.json({ ok: true, acao });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/cargas] erro:', msg);
    return NextResponse.json({ ok: false, erro: 'Erro ao gravar a carga. Tente novamente.', detalhe: msg }, { status: 500 });
  }
}
