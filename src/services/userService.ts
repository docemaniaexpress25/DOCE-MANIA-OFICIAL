import { User, UserRole } from '@/lib/types';

/**
 * userService agora conversa com /api/users (server-side, service_role).
 * O PIN nunca mais trafega para o browser:
 * - PINs sao hashados no servidor (bcrypt) e guardados em pin_hash
 * - a lista de usuarios vem SEM pin
 * - criacao/edicao exigem token de sessao ADMIN (emitido no login)
 */

const SESSION_KEY = 'dm_session_token';

/**
 * BLOCO 217 — evento global disparado quando QUALQUER API devolve 401 de
 * "Sessão expirada". O App escuta e força o logout (tela de login). Assim o
 * vendedor NUNCA fica travado "logado fantasma" no meio da venda — antes o
 * token morria em silêncio e as APIs de venda devolviam 401 sem o app reagir.
 */
export const SESSION_EXPIRED_EVENT = 'dm:session-expired';

export function saveSessionToken(token: string) {
  try { localStorage.setItem(SESSION_KEY, token); } catch {}
}

export function clearSessionToken() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

export function authHeaders(): HeadersInit {
  try {
    const token = localStorage.getItem(SESSION_KEY);
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {}
  return {};
}

/* ------------------------------------------------------------------ *
 * BLOCO 217 — SESSÃO DESLIZANTE (sliding session)
 *
 * Causa raiz do "Sessão expirada" na venda: o token dura 7 dias e o app
 * restaurava o usuário do localStorage sem validar nada. O vendedor
 * continuava na tela mas TODAS as APIs exigiam sessão — 401 no meio do
 * atendimento. Agora:
 *   1. getSessionTokenExpiry() lê o "exp" do token local (só decodifica,
 *      SEM validar assinatura — a validação real é do servidor);
 *   2. renovarSessaoSeNecessario() renova o token via /api/session/renew
 *      quando falta menos de 72h para expirar (chamada no arranque do app
 *      e a cada 30 min — quem usa o app nunca mais vê a sessão morrer);
 *   3. installSessionGuard() observa TODAS as respostas de /api/*: quando
 *      uma vem 401 de sessão, limpa o token e dispara SESSION_EXPIRED_EVENT
 *      — o App força logout e o vendedor entra com o PIN de novo.
 * ------------------------------------------------------------------ */

/** Decodifica o "exp" (epoch ms) do token salvo. null = sem token/ilegível. */
export function getSessionTokenExpiry(): number | null {
  try {
    const token = localStorage.getItem(SESSION_KEY);
    if (!token) return null;
    const [body] = token.split('.');
    if (!body) return null;
    const payload = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload?.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** true quando o token salvo já passou do exp (ou não existe). */
export function isSessionTokenExpired(): boolean {
  const exp = getSessionTokenExpiry();
  return exp === null || exp < Date.now();
}

/**
 * BLOCO 217 — renova o token se estiver perto de expirar (< 72h) ou já
 * expirado. Deve ser chamada só com usuário logado (id em ref). Silenciosa:
 * nunca lança — a sessão nunca pode travar o app por dentro.
 */
export async function renovarSessaoSeNecessario(): Promise<void> {
  const exp = getSessionTokenExpiry();
  // Sem token: nada a renovar (usuário deslogado — o guard cuida do resto).
  if (exp === null) return;
  const faltam = exp - Date.now();
  // Renova quando faltar menos de 72h (3 dias) dos 7 dias de janela.
  if (faltam > 1000 * 60 * 60 * 72) return;
  try {
    const res = await fetch('/api/session/renew', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
    });
    if (!res.ok) {
      // Token recusado (assinatura/segredo mudou, expirou de verdade): o
      // guard do 401 dispara o logout — aqui só encerra sem erro.
      return;
    }
    const d = await res.json().catch(() => null);
    if (d?.ok && d.token) saveSessionToken(String(d.token));
  } catch { /* offline: tenta de novo no próximo ciclo */ }
}

/** true quando o guard global já foi instalado (evita dupla instalação). */
let sessionGuardInstalled = false;

/**
 * BLOCO 217 — GUARD GLOBAL DE SESSÃO: envolve window.fetch e observa as
 * respostas de /api/*. Quando uma API devolve 401 "Sessão expirada" (venda,
 * carga, notas, pix...), limpa o token e dispara SESSION_EXPIRED_EVENT — o
 * App desloga e mostra a tela de login na hora. Idempotente.
 */
export function installSessionGuard(): void {
  if (sessionGuardInstalled || typeof window === 'undefined') return;
  sessionGuardInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await originalFetch(input as any, init as any);
    try {
      const url = typeof input === 'string' ? input : (input as Request)?.url || '';
      // Só respostas de NOSSAS APIs; Supabase/terceiros não são tocados.
      if (res.status === 401 && url.includes('/api/') && !url.includes('/api/login')) {
        const text = await res.clone().text();
        if (/sess[aã]o\s*expirada/i.test(text)) {
          clearSessionToken();
          window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
        }
      }
    } catch { /* observação best-effort: nunca interfere na resposta */ }
    return res;
  };
}

function mapUser(u: any): User {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    // /api/users retorna camelCase com "role"; rows diretas do Supabase usam "perfil"
    role: (u.role ?? u.perfil) as UserRole,
    ativo: !!u.ativo,
    telefone: u.telefone,
    whatsapp: u.whatsapp,
    foto: u.foto,
    placaVeiculo: u.placaVeiculo ?? u.placa_veiculo,
    rota: u.rota || 'ROTA_01',
    // Bloco 27: preserva preVenda e rota2 (antes o mapUser descartava a
    // preVenda de rows diretas do Supabase — bug latente)
    preVenda: !!u.preVenda,
    rota2: !!u.rota2,
  };
}

export const userService = {
  /**
   * Bloco 12: agora LANCA em caso de falha (rede/API 5xx) para que a tela
   * de login possa mostrar erro + "Tentar novamente" em vez de um card
   * vazio que parecia app quebrado ("o login nao aparece").
   */
  async getAllUsers(): Promise<User[]> {
    const res = await fetch('/api/users', { headers: authHeaders() });
    if (!res.ok) {
      throw new Error(`Erro ${res.status} ao buscar usuarios`);
    }
    const data = await res.json();
    return (data.users || []).map(mapUser);
  },

  async getUserById(id: string): Promise<User | null> {
    try {
      const res = await fetch('/api/users', { headers: authHeaders() });
      if (!res.ok) return null;
      const data = await res.json();
      const found = (data.users || []).find((u: any) => u.id === id);
      return found ? mapUser(found) : null;
    } catch {
      return null;
    }
  },

  async insertUser(user: Omit<User, 'id'>): Promise<User | null> {
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(user),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Erro ao criar usuario:', err?.error || res.status);
        return null;
      }
      const data = await res.json();
      return data.user ? mapUser(data.user) : null;
    } catch (e) {
      console.error('Erro ao criar usuario:', e);
      return null;
    }
  },

  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    try {
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ...updates, id }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Erro ao atualizar usuario:', err?.error || res.status);
        return null;
      }
      const data = await res.json();
      return data.user ? mapUser(data.user) : null;
    } catch (e) {
      console.error('Erro ao atualizar usuario:', e);
      return null;
    }
  },

  async deleteUser(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/users?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        console.error('Erro ao excluir usuario:', res.status);
        return false;
      }
      return true;
    } catch (e) {
      console.error('Erro ao excluir usuario:', e);
      return false;
    }
  }
};
