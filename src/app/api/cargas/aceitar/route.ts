import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';
import { hasEstoquesNotaColumns } from '@/lib/serverSchema';

/**
 * POST /api/cargas/aceitar  { pendenciaId }
 *
 * Vendedor aceita a carga pendente enviada pelo admin (cargas_pendentes ->
 * RPC aceitar_carga_vendedor -> tabela cargas).
 *
 * Correcoes do Bloco 11 em relacao ao caminho antigo (RPC direto via anon):
 * - Exige sessao (Bearer) e valida que a carga pertence ao vendedor logado
 *   (antes QUALQUER um aceitava QUALQUER pendente — cargasPendentes[0]).
 * - Bloqueia cargas ZERADAS (bug de envio do admin) — aceitar uma carga
 *   vazia ZERARIA o estoque da van do vendedor.
 * - Erros voltam com mensagem legivel (antes eram engolidos no console).
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
      .select('id, vendedor_id, status, itens, modo_nota')
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
    // BLOCO 29 (ROTA 2): pendente COM MODO -> aceite v2 server-side.
    // Move a CASA na coluna do modo (delta vs carga atual da van) e
    // substitui a carga da van com modo_nota. Regra: van nunca mistura.
    // ============================================================
    const modoPendente = (pendente as any).modo_nota || null;
    if (modoPendente === 'COM_NF' || modoPendente === 'SEM_NF') {
      const temEstoqueNota = await hasEstoquesNotaColumns();
      if (!temEstoqueNota) {
        return NextResponse.json({ ok: false, erro: 'Banco desatualizado: rode o SQL do Bloco 29 (estoques COM NF / SEM NF).' }, { status: 503 });
      }
      const colCasa = modoPendente === 'COM_NF' ? 'estoque_nota' : 'estoque_semnf';

      // Van nunca mistura: se ja ha carga com outro modo, recusa
      const { data: modosVan } = await supabase
        .from('cargas').select('modo_nota').eq('vendedor_id', pendente.vendedor_id).not('modo_nota', 'is', null);
      const outros = new Set((modosVan || []).map((r: any) => r.modo_nota).filter((m: string) => m !== modoPendente));
      if (outros.size > 0) {
        const outro = [...outros][0];
        return NextResponse.json({ ok: false, erro: `SUA VAN JA ESTA CARREGADA COM ${outro === 'COM_NF' ? 'NF' : 'SEM NF'} — nao pode aceitar carga do outro modo. Fale com o admin.` }, { status: 409 });
      }

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
        .from('products').select('id, nome, estoque_nota, estoque_semnf').in('id', ids);
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
        return NextResponse.json({ ok: false, erro: `ESTOQUE DE CASA ${modoPendente === 'COM_NF' ? 'COM NF' : 'SEM NF'} INSUFICIENTE: ${faltas.join(', ')}. Peca ao admin a entrada.` }, { status: 409 });
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
        modo_nota: modoPendente,
      }));
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('cargas').insert(rows);
        if (insErr) throw insErr;
      }
      const { error: markErr } = await supabase.from('cargas_pendentes').update({ status: 'ACEITA' }).eq('id', pendenciaId);
      if (markErr) throw markErr;
      return NextResponse.json({ ok: true });
    }

    // ---------- LEGADO (sem modo): RPC original intocado ----------
    const { error: rpcErr } = await supabase.rpc('aceitar_carga_vendedor', { p_carga_pendente_id: pendenciaId });
    if (rpcErr) {
      const msg = rpcErr.message || 'Falha ao aplicar a carga.';
      console.error('[api/cargas/aceitar] RPC falhou:', rpcErr.code, msg);
      return NextResponse.json({ ok: false, erro: msg }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[api/cargas/aceitar] erro:', msg);
    return NextResponse.json({ ok: false, erro: 'Erro ao aceitar a carga. Tente novamente.', detalhe: msg }, { status: 500 });
  }
}
