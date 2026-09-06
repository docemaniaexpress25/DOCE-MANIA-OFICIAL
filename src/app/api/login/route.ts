import { NextRequest, NextResponse } from 'next/server';
import { compare } from 'bcryptjs';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { createSessionToken } from '@/lib/session';

/**
 * POST /api/login  { userId, pin }
 * Valida o PIN NO SERVIDOR contra pin_hash (bcrypt).
 * Nunca retorna pin/pin_hash. Tela de login permanece identica.
 */

// Rate limit em memoria (best-effort por instancia serverless):
// 8 tentativas por IP a cada 10 minutos.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}

function clearAttempts(ip: string) {
  attempts.delete(ip);
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function POST(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Servidor nao configurado: defina SUPABASE_SERVICE_ROLE_KEY na Vercel.' },
      { status: 503 }
    );
  }

  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { ok: false, error: 'Muitas tentativas. Aguarde alguns minutos.' },
      { status: 429 }
    );
  }

  try {
    const { userId, pin } = await req.json();
    if (!userId || typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
      return NextResponse.json({ ok: false, error: 'PIN incorreto. Tente novamente.' }, { status: 400 });
    }

    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from('app_users')
      .select('id, nome, email, perfil, ativo, telefone, whatsapp, foto, placa_veiculo, rota, pin_hash')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: 'Usuario nao encontrado.' }, { status: 404 });
    }
    if (!data.ativo) {
      return NextResponse.json({ ok: false, error: 'Usuario inativo. Contate o administrador.' }, { status: 403 });
    }
    if (!data.pin_hash) {
      return NextResponse.json(
        { ok: false, error: 'PIN nao configurado. Contate o administrador para redefinir.' },
        { status: 409 }
      );
    }

    const valid = await compare(pin, data.pin_hash);
    if (!valid) {
      return NextResponse.json({ ok: false, error: 'PIN incorreto. Tente novamente.' }, { status: 401 });
    }

    clearAttempts(ip);

    // Objeto do usuario SEM dados sensiveis (mesma shape usada pelo app)
    const user = {
      id: data.id,
      nome: data.nome,
      email: data.email,
      role: data.perfil as string,
      ativo: !!data.ativo,
      telefone: data.telefone,
      whatsapp: data.whatsapp,
      foto: data.foto,
      placaVeiculo: data.placa_veiculo,
      rota: data.rota,
    };

    const token = createSessionToken(data.id, String(data.perfil || 'VENDEDOR'));

    return NextResponse.json({ ok: true, user, token });
  } catch (e: any) {
    console.error('[api/login] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Falha de conexao. Tente novamente.' }, { status: 500 });
  }
}
