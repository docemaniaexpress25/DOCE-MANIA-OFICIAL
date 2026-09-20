import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';

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
