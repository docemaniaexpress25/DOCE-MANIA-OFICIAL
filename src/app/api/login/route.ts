import { NextRequest, NextResponse } from 'next/server';
import { compare } from 'bcryptjs';
import { getServiceClient, isServerSupabaseConfigured } from '@/lib/serverSupabase';
import { createSessionToken } from '@/lib/session';
import { hasPreVendaColumn } from '@/lib/serverSchema';

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
    // pre_venda so existe depois do Bloco 5 do SQL; enquanto isso o login NAO
    // PODE quebrar por causa dela (antes, o select 500ava para todo mundo).
    // (`as any` evita o ParserError do typegen do supabase-js com string dinamica)
    const comPreVenda = await hasPreVendaColumn();
    const userCols = comPreVenda
      ? 'id, nome, email, perfil, ativo, telefone, whatsapp, foto, placa_veiculo, rota, pre_venda, pin_hash'
      : 'id, nome, email, perfil, ativo, telefone, whatsapp, foto, placa_veiculo, rota, pin_hash';
    const { data, error } = await supabase
      .from('app_users')
      .select(userCols as any)
      .eq('id', userId)
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: 'Usuario nao encontrado.' }, { status: 404 });
    }
    // data vem com tipo dinamico (select montado em runtime) -> alias tipado
    const u = data as any;
    if (!u.ativo) {
      return NextResponse.json({ ok: false, error: 'Usuario inativo. Contate o administrador.' }, { status: 403 });
    }
    if (!u.pin_hash) {
      return NextResponse.json(
        { ok: false, error: 'PIN nao configurado. Contate o administrador para redefinir.' },
        { status: 409 }
      );
    }

    const valid = await compare(pin, u.pin_hash);
    if (!valid) {
      return NextResponse.json({ ok: false, error: 'PIN incorreto. Tente novamente.' }, { status: 401 });
    }

    clearAttempts(ip);

    // Objeto do usuario SEM dados sensiveis (mesma shape usada pelo app)
    const user = {
      id: u.id,
      nome: u.nome,
      email: u.email,
      role: u.perfil as string,
      ativo: !!u.ativo,
      telefone: u.telefone,
      whatsapp: u.whatsapp,
      foto: u.foto,
      placaVeiculo: u.placa_veiculo,
      rota: u.rota,
      preVenda: !!u.pre_venda,
    };

    const token = createSessionToken(u.id, String(u.perfil || 'VENDEDOR'));

    return NextResponse.json({ ok: true, user, token });
  } catch (e: any) {
    console.error('[api/login] erro:', e?.message);
    return NextResponse.json({ ok: false, error: 'Falha de conexao. Tente novamente.' }, { status: 500 });
  }
}
