import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { sessionFromRequest, isAdminSession } from '@/lib/session';

/**
 * POST /api/location  [SESSAO OBRIGATORIA - vendedor/admin]
 * Body: { latitude, longitude }
 * Salva a ultima localizacao conhecida do usuario logado.
 * O user_id SEMPRE vem da sessao (nao do body) — impossivel
 * forjar a localizacao de outro usuario.
 *
 * GET /api/location?userId=xxx  [ADMIN]
 * Retorna a ultima localizacao de um usuario.
 * GET /api/location?all=1  [ADMIN]
 * Retorna a localizacao de todos os usuarios (nome incluso).
 *
 * Motivo da existencia: user_locations esta FECHADA para
 * anon/authenticated (RLS + REVOKE) — antes disto, o upsert do
 * vendedor falhava em silencio com 42501 e o admin nunca via
 * localizacao nenhuma.
 */

export async function POST(request: NextRequest) {
  const session = sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401 });
  }
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'Servidor temporariamente indisponivel.' }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const lat = Number(body?.latitude);
    const lng = Number(body?.longitude);

    // Validacao basica de coordenadas (rejeita lixo/fora do planeta)
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
      return NextResponse.json({ error: 'Coordenadas invalidas.' }, { status: 400 });
    }

    const supabase = getServiceClient();
    const now = new Date().toISOString();

    // 1. Tentativa normal: UPSERT (caminho rapido)
    const { error } = await supabase
      .from('user_locations')
      .upsert(
        {
          user_id: session.sub,
          latitude: lat,
          longitude: lng,
          updated_at: now,
        },
        { onConflict: 'user_id' }
      );

    if (!error) return NextResponse.json({ ok: true });

    // 2. Fallback resiliente: UPDATE e, se nao alterar nada, INSERT.
    //    Cobre o caso de a tabela nao ter indice unique em user_id
    //    (o ON CONFLICT do upsert falha com 42P10).
    const updErrCode = error.code;
    const { data: upd, error: updErr } = await supabase
      .from('user_locations')
      .update({ latitude: lat, longitude: lng, updated_at: now })
      .eq('user_id', session.sub)
      .select('user_id');

    if (!updErr && upd && upd.length > 0) {
      return NextResponse.json({ ok: true, via: 'update' });
    }
    if (!updErr) {
      const { error: insErr } = await supabase
        .from('user_locations')
        .insert({ user_id: session.sub, latitude: lat, longitude: lng, updated_at: now });
      if (!insErr) return NextResponse.json({ ok: true, via: 'insert' });
      return NextResponse.json(
        { error: 'Falha ao registrar localizacao.', code: insErr.code, detail: insErr.message },
        { status: 500 }
      );
    }

    // Ambos os caminhos falharam — devolve o motivo real para diagnostico
    // (a rota exige sessao, entao nao expoe nada a anonimos)
    console.error('[api/location POST] falha:', updErrCode, error.message, '| update:', updErr?.message);
    return NextResponse.json(
      { error: 'Falha ao registrar localizacao.', code: updErrCode || updErr?.code, detail: (error.message || updErr?.message || '').slice(0, 200) },
      { status: 500 }
    );
  } catch (e: any) {
    console.error('[api/location POST] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao salvar localizacao.', detail: String(e?.message || '').slice(0, 200) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (!isAdminSession(request)) {
    return NextResponse.json({ error: 'Acesso restrito a administradores.' }, { status: 401 });
  }
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ error: 'Servidor temporariamente indisponivel.' }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const all = searchParams.get('all');
    const supabase = getServiceClient();

    if (all) {
      // Lista completa (nome + localizacao) para o painel de vendedores
      const { data, error } = await supabase
        .from('user_locations')
        .select('user_id, latitude, longitude, updated_at');
      if (error) throw error;

      // Junta com nomes em uma segunda query (sem FK garantida)
      const { data: users } = await supabase.from('app_users').select('id, nome');
      const nameById = new Map((users || []).map((u: any) => [u.id, u.nome]));
      const locations = (data || []).map((l: any) => ({
        userId: l.user_id,
        nome: nameById.get(l.user_id) || 'Desconhecido',
        latitude: Number(l.latitude),
        longitude: Number(l.longitude),
        updatedAt: l.updated_at,
      }));
      return NextResponse.json({ locations });
    }

    if (!userId) {
      return NextResponse.json({ error: 'Informe userId ou all=1.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('user_locations')
      .select('latitude, longitude, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;

    if (!data) return NextResponse.json({ location: null });
    return NextResponse.json({
      location: {
        latitude: Number(data.latitude),
        longitude: Number(data.longitude),
        updated_at: data.updated_at,
      },
    });
  } catch (e: any) {
    console.error('[api/location GET] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao buscar localizacao.', detail: String(e?.message || '').slice(0, 200) }, { status: 500 });
  }
}
