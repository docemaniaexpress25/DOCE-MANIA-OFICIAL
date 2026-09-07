import { User, UserRole } from '@/lib/types';

/**
 * userService agora conversa com /api/users (server-side, service_role).
 * O PIN nunca mais trafega para o browser:
 * - PINs sao hashados no servidor (bcrypt) e guardados em pin_hash
 * - a lista de usuarios vem SEM pin
 * - criacao/edicao exigem token de sessao ADMIN (emitido no login)
 */

const SESSION_KEY = 'dm_session_token';

export function saveSessionToken(token: string) {
  try { localStorage.setItem(SESSION_KEY, token); } catch {}
}

export function clearSessionToken() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

function authHeaders(): HeadersInit {
  try {
    const token = localStorage.getItem(SESSION_KEY);
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {}
  return {};
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
  };
}

export const userService = {
  async getAllUsers(): Promise<User[]> {
    try {
      // Com sessao ativa a API devolve a lista completa (admin); sem sessao,
      // apenas o minimo para a tela de login.
      const res = await fetch('/api/users', { headers: authHeaders() });
      if (!res.ok) {
        console.error('Erro ao buscar usuarios:', res.status);
        return [];
      }
      const data = await res.json();
      return (data.users || []).map(mapUser);
    } catch (e) {
      console.error('Erro ao buscar usuarios:', e);
      return [];
    }
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
