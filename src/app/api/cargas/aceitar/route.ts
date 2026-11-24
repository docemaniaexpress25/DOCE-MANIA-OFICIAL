import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';

/**
 * POST /api/cargas/aceitar  { pendenciaId }
 *
 * Vendedor aceita a carga pendente enviada pelo admin (cargas_pendentes ->
 * aceite server-side -> tabela cargas).
 *
 * BLOCO 217: o aceite é UNICO (v2) para TODA carga — calcula o DELTA da van
 * (desejado - atual) e move a CASA no ESTOQUE CENTRAL (estoque_principal).
 * A antiga ramificação por modo (COM_NF/SEM_NF, estoque 1/2) foi REMOVIDA
 * junto com a regra. Correções do Bloco 11 mantidas:
 * - Exige sessao (Bearer) e valida que a carga pertence ao vendedor logado.
 * - Bloqueia cargas ZERADAS (bug de envio do admin).
 * - Erros voltam com mensagem legivel.
 */

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

  const body = await req.json().catch(() => ({}));
  const pendenciaId = String(body.pendenciaId || '');
  if (!pendenciaId) {
    return NextResponse.json({ ok: false, erro: 'Carga nao informada.' }, { status: 400 });
  }

  try {
    const supabase = getServiceClient();

    const { data: pendente, error: pendErr } = await supabase
      .from('cargas_pendentes')
      .select('id, vendedor_id, status, itens')
      .eq('id', pendenciaId)
      .maybeSingle();

    if (pendErr) {
      return NextResponse.json({ ok: false, erro: 'Erro ao consultar a carga.', detalhe: pendErr.message }, { status: 500 });
    }
    if (!pendente) {
      return NextResponse.json({ ok: false, erro: 'Carga pendente nao encontrada (ja aceita ou cancelada?). Atualize a tela.' }, { status: 404 });
    }
    if (pendente.status !== 'PENDENTE') {
      return NextResponse.json({ ok: false, erro: 'Esta carga nao esta mais pendente. Atualize a tela.' }, { status: 409 });
    }
    // Dono da carga: vendedor so aceita a PROPRIA carga (admin pode qualquer uma)
    if (session.perfil !== 'ADMIN' && pendente.vendedor_id !== session.sub) {
      return NextResponse.json({ ok: false, erro: 'Esta carga pertence a outro vendedor.' }, { status: 403 });
    }

    // Guarda contra carga zerada (bug historico de envio no admin)
    const itens = Array.isArray(pendente.itens) ? pendente.itens : [];
    const soma = itens.reduce((acc: number, i: { quantidade?: number }) => acc + (Number(i?.quantidade) || 0), 0);
    if (soma <= 0) {
      return NextResponse.json(
        { ok: false, erro: 'Esta carga veio VAZIA (erro de envio). Peca ao admin para reenviar — aceitar zeraria seu estoque.' },
        { status: 422 }
      );
    }

    // ============================================================
    // BLOCO 217: ACEITE UNICO — delta da van × ESTOQUE CENTRAL.
    // (A ramificação por modo COM_NF/SEM_NF do Bloco 29 foi removida junto
    // com a regra de estoque 1/2 — a casa é uma só.)
    // ============================================================
    const colCasa = 'estoque_principal';

    // Van atual (para o delta)
    const { data: cargaAtual, error: cargaErr } = await supabase
      .from('cargas').select('produto_id, quantidade').eq('vendedor_id', pendente.vendedor_id);
    if (cargaErr) throw cargaErr;
    const atualMap = new Map<string, number>((cargaAtual || []).map((c: any) => [c.produto_id, Number(c.quantidade) || 0]));

    // Desejado: soma por produto dos itens da pendente (aceita produtoid/produtoId)
    const desejadoMap = new Map<string, number>();
    for (const i of itens) {
      const pid = String((i as any)?.produtoid || (i as any)?.produtoId || '');
      if (!pid) continue;
      desejadoMap.set(pid, (desejadoMap.get(pid) ?? 0) + (Number((i as any)?.quantidade) || 0));
    }

    const ids = [...new Set([...desejadoMap.keys(), ...atualMap.keys()])];
    const { data: prods, error: prodErr } = await supabase
      .from('products').select('id, nome, estoque_principal').in('id', ids);
    if (prodErr) throw prodErr;
    const prodMap = new Map<string, any>((prods || []).map((p: any) => [p.id, p]));

    const faltas: string[] = [];
    const deltas: { produtoId: string; delta: number }[] = [];
    for (const [pid, desejado] of desejadoMap) {
      const delta = desejado - (atualMap.get(pid) ?? 0);
      if (delta > 0) {
        const p = prodMap.get(pid);
        const casaSaldo = Number(p?.[colCasa] ?? 0);
        if (casaSaldo < delta) faltas.push(`${p?.nome || pid} (falta ${delta - casaSaldo})`);
      }
      if (delta !== 0) deltas.push({ produtoId: pid, delta });
    }
    // Produtos que saem da carga (delta<0) tambem devolvem para casa
    for (const [pid, atual] of atualMap) {
      if (!desejadoMap.has(pid) && atual > 0) deltas.push({ produtoId: pid, delta: -atual });
    }
    if (faltas.length > 0) {
      return NextResponse.json({ ok: false, erro: `ESTOQUE CENTRAL INSUFICIENTE: ${faltas.join(', ')}. Peca ao admin a entrada.` }, { status: 409 });
    }

    for (const d of deltas) {
      const p = prodMap.get(d.produtoId);
      if (!p) continue;
      const novo = Math.max(0, Number(p[colCasa] ?? 0) - d.delta);
      const { error: e2 } = await supabase.from('products').update({ [colCasa]: novo }).eq('id', d.produtoId);
      if (e2) throw e2;
    }

    const { error: delErr } = await supabase.from('cargas').delete().eq('vendedor_id', pendente.vendedor_id);
    if (delErr) throw delErr;
    const rows = [...desejadoMap.entries()].filter(([, q]) => q > 0).map(([pid, q]) => ({
      vendedor_id: pendente.vendedor_id,
      produto_id: pid,
      quantidade: q,
    }));
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('cargas').insert(rows);
      if (insErr) throw insErr;
    }
    const { error: markErr } = await supabase.from('cargas_pendentes').update({ status: 'ACEITA' }).eq('id', pendenciaId);
    if (markErr) throw markErr;
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/cargas/aceitar] erro:', msg);
    return NextResponse.json({ ok: false, erro: 'Erro ao aceitar a carga. Tente novamente.', detalhe: msg }, { status: 500 });
  }
}
