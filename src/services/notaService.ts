import { authHeaders } from '@/services/userService';
import { NotaStatus } from '@/lib/types';

/**
 * Servico de notas fiscais (Bloco 10) — conversa com /api/notas (server-side).
 * O token Focus NFe nunca toca o browser; aqui so vai o token de sessao do app.
 */

export interface NotaInfo {
  status: NotaStatus | string;
  numero?: string;
  ref?: string;
  pdfUrl?: string;
  erro?: string;
}

export const notaService = {
  /** Emite a nota da venda. Tipo automatico: CNPJ -> NFe, senao NFC-e. */
  async emitir(saleId: string, tipo?: 'NFE' | 'NFCE'): Promise<{ ok: boolean; jaEmitida?: boolean; nota?: NotaInfo; erro?: string }> {
    try {
      const res = await fetch('/api/notas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'EMITIR', saleId, tipo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, nota: data.nota };
      return { ok: true, jaEmitida: data.jaEmitida, nota: data.nota };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Consulta a situacao atual da nota na SEFAZ (apos EMITINDO ou rejeicao). */
  async consultar(saleId: string): Promise<{ ok: boolean; nota?: NotaInfo; erro?: string }> {
    try {
      const res = await fetch('/api/notas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'CONSULTAR', saleId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, nota: data.nota };
      return { ok: true, nota: data.nota };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** [ADMIN] Cancela a nota com justificativa (min. 15 caracteres). */
  async cancelar(saleId: string, justificativa: string): Promise<{ ok: boolean; nota?: NotaInfo; erro?: string }> {
    try {
      const res = await fetch('/api/notas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'CANCELAR', saleId, justificativa }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, nota: data.nota };
      return { ok: true, nota: data.nota };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },
};
