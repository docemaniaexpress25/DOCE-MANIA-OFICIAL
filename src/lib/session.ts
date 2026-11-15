import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Sessao minimalista (HMAC-SHA256) para chamadas administrativas
 * as API routes. O token NAO da acesso ao Supabase — ele apenas
 * prova para nossas API routes que o portador fez login via
 * /api/login com PIN valido.
 */

export interface SessionPayload {
  sub: string;      // user id
  perfil: string;   // ADMIN | VENDEDOR
  exp: number;      // epoch ms
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

function getSecret(): string {
  // Usa SESSION_SECRET se definido; caso contrario deriva da service key.
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  return createHmac('sha256', 'docemania-session-v1')
    .update(process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback-dev-only')
    .digest('hex');
}

const b64url = (s: string) => Buffer.from(s).toString('base64url');

export function createSessionToken(sub: string, perfil: string): string {
  const payload: SessionPayload = {
    sub,
    perfil,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', getSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | null | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;

  const expected = createHmac('sha256', getSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
    if (!payload.sub || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Extrai e verifica o token do header Authorization da request */
export function sessionFromRequest(req: Request): SessionPayload | null {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  return verifySessionToken(token);
}

export function isAdminSession(req: Request): boolean {
  const session = sessionFromRequest(req);
  return !!session && session.perfil === 'ADMIN';
}
