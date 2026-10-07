import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';

/**
 * GET  /api/daily-route?data=YYYY-MM-DD      [SESSAO OBRIGATORIA]
 *      Retorna a rota do dia do usuario logado (vendedor).
 * POST /api/daily-route                      [SESSAO OBRIGATORIA]
 *      Body: { date, clientIds, skippedClientIds }
 *      Salva a rota do dia do usuario logado (vendedor_id SEMPRE
 *      vem da sessao — impossivel salvar rota de outro usuario).
 *
 * Motivo da existencia: daily_routes tem RLS e as policies antigas eram
 * "TO authenticated" — mas o app usa login proprio (nunca Supabase Auth),
 * entao TODA requisicao do browser chega como anon e o upsert do vendedor
 * falhava com 42501 ("new row violates row-level security policy") em
 * silencio -> "Erro ao salvar rota diaria" no console.
 * Mesmo padrao do /api/location: tabela fechada + service_role aqui.
 */

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function hojeSp(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Sanitiza lista de ids: so strings, sem vazios, limite de tamanho. */
function limparIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => typeof x === 'string')
    .map((x) => (x as string).slice(0, 60))
    .filter((x) => x.length > 0)
    .slice(0, 500);
}

export async function GET(request: NextRequest) {
  const session = sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401 });
  }
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return NextResponse.json({ error: 'Servidor temporariamente indisponivel.' }, { status: 503 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const data = searchParams.get('data') || hojeSp();
    if (!DATA_RE.test(data)) {
      return NextResponse.json({ error: 'Parametro data invalido (use YYYY-MM-DD).' }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data: row, error } = await supabase
      .from('daily_routes')
      .select('client_ids, skipped_client_ids')
      .eq('vendedor_id', session.sub)
      .eq('data', data)
      .maybeSingle();
    if (error) throw error;

    if (!row) return NextResponse.json({ route: null });
    return NextResponse.json({
      route: {
        date: data,
        clientIds: row.client_ids || [],
        skippedClientIds: row.skipped_client_ids || [],
      },
    });
  } catch (e: any) {
    console.error('[api/daily-route GET] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao buscar rota diaria.', detail: String(e?.message || '').slice(0, 200) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = sessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Nao autenticado.' }, { status: 401 });
  }
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(request);
    if (bridged) return bridged;
    return NextResponse.json({ error: 'Servidor temporariamente indisponivel.' }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => null);
    const date = String(body?.date || '');
    if (!DATA_RE.test(date)) {
      return NextResponse.json({ error: 'Campo date invalido (use YYYY-MM-DD).' }, { status: 400 });
    }

    const payload = {
      vendedor_id: session.sub, // SEMPRE da sessao (nao do body)
      data: date,
      client_ids: limparIds(body?.clientIds),
      skipped_client_ids: limparIds(body?.skippedClientIds),
    };

    const supabase = getServiceClient();
    const { error } = await supabase
      .from('daily_routes')
      .upsert(payload, { onConflict: 'vendedor_id,data' });

    if (error) {
      console.error('[api/daily-route POST] falha:', error.code, error.message);
      return NextResponse.json(
        { error: 'Falha ao salvar rota diaria.', code: error.code, detail: String(error.message || '').slice(0, 200) },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[api/daily-route POST] erro:', e?.message);
    return NextResponse.json({ error: 'Erro ao salvar rota diaria.', detail: String(e?.message || '').slice(0, 200) }, { status: 500 });
  }
}
