import { createHmac, timingSafeEqual } from 'crypto';
import { getSecret } from '@/lib/session';

/**
 * LINKS DE COMPARTILHAMENTO ASSINADOS (portal fiscal -> WhatsApp).
 *
 * O dono compartilha o DANFE/XML com o CLIENTE via WhatsApp. Os arquivos são
 * privados (sessão ADMIN) — não podemos mandar o token de sessão do admin na
 * URL do WhatsApp. Solução: token HMAC dedicado que autoriza BAIXAR APENAS os
 * arquivos de UMA nota (saleId ou ref+doc) e EXPIRA (7 dias).
 *
 *   createShareToken({ saleId })            -> token p/ arquivos da venda
 *   createShareToken({ ref, doc })          -> token p/ nota avulsa (portal)
 *   verifyShareToken(token)                 -> payload | null (expira sozinho)
 *
 * Endpoint público que consome: GET /api/notas-compartilhar?token=...&tipo=pdf|xml
 */

export interface SharePayload {
  kind: 'nota-share';
  saleId?: string;
  ref?: string;
  doc?: 'nfe' | 'nfce';
  exp: number; // epoch ms
}

const b64url = (s: string) => Buffer.from(s).toString('base64url');

export function createShareToken(p: { saleId?: string; ref?: string; doc?: 'nfe' | 'nfce'; dias?: number }): string {
  const payload: SharePayload = {
    kind: 'nota-share',
    ...(p.saleId ? { saleId: p.saleId } : {}),
    ...(p.ref ? { ref: p.ref } : {}),
    ...(p.doc ? { doc: p.doc } : {}),
    exp: Date.now() + (p.dias || 7) * 24 * 60 * 60 * 1000,
  };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', getSecret() + ':nota-share').update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyShareToken(token: string | null | undefined): SharePayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = createHmac('sha256', getSecret() + ':nota-share').update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SharePayload;
    if (payload.kind !== 'nota-share' || !payload.exp || payload.exp < Date.now()) return null;
    if (!payload.saleId && !(payload.ref && payload.doc)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Dias restantes do link (para o portal mostrar "expira em..."). */
export function diasRestantes(exp: number): number {
  return Math.max(1, Math.ceil((exp - Date.now()) / (24 * 60 * 60 * 1000)));
}
