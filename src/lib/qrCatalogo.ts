import { authHeaders } from '@/services/userService';

/**
 * BLOCO 125 — QR DO CATALOGO DO CLIENTE NO CUPOM.
 *
 * O admin liga/desliga no hub ERP Fiscal & Automações
 * (erp_config.qrCatalogoNoCupom via /api/configuracoes). O cupom é impresso
 * por vendedor/entregador/secretario/admin — este helper busca o flag com
 * CACHE de 5 minutos (memória + localStorage):
 *  - evita um pedido de rede a cada cupom aberto (egress);
 *  - a troca do admin propaga para os aparelhos em até 5 minutos.
 * Sem rede/sem resposta: usa o último valor conhecido; nunca houve valor
 * gravado = LIGADO (default da regra do dono).
 */

const CACHE_KEY = 'dm_qr_catalogo_v1';
const TTL_MS = 5 * 60 * 1000;

let memoria: { val: boolean; ts: number } | null = null;

function lerLocal(): { val: boolean; ts: number } | null {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(CACHE_KEY) : null;
    if (!raw) return null;
    const p = JSON.parse(raw) as { val: boolean; ts: number };
    if (typeof p?.val !== 'boolean' || typeof p?.ts !== 'number') return null;
    return p;
  } catch {
    return null;
  }
}

function gravarLocal(val: boolean) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ val, ts: Date.now() }));
  } catch {
    /* localStorage bloqueado — só a memória */
  }
}

export async function lerQrCatalogoCupom(): Promise<boolean> {
  if (memoria && Date.now() - memoria.ts < TTL_MS) return memoria.val;
  const local = lerLocal();
  if (local && Date.now() - local.ts < TTL_MS) {
    memoria = local;
    return local.val;
  }
  try {
    const res = await fetch('/api/configuracoes/qr-catalogo', { headers: authHeaders() });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.ok) {
      memoria = { val: d.ativo !== false, ts: Date.now() };
      gravarLocal(memoria.val);
      return memoria.val;
    }
  } catch {
    /* offline — cai no último valor conhecido abaixo */
  }
  if (local) return local.val;
  return true; // flag novo sem valor gravado = LIGADO (regra do dono)
}

/**
 * URL do portal do cliente (extrato + catálogo + pedido) — destino do QR
 * impresso no cupom. Sem portal_code no cadastro = '' (o cupom sai sem QR).
 */
export function urlCatalogoCliente(portalCodigo?: string | null): string {
  const code = String(portalCodigo || '').trim();
  if (!code || typeof window === 'undefined') return '';
  return `${window.location.origin}/cliente/${encodeURIComponent(code)}`;
}
