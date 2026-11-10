import { authHeaders } from '@/services/userService';
import { NotaStatus } from '@/lib/types';

/**
 * Servico de notas fiscais (Bloco 10) — conversa com /api/notas (server-side).
 * O token Focus NFe nunca toca o browser; aqui so vai o token de sessao do app.
 */

export interface NotaEmitente {
  nome?: string;
  cnpj?: string;
  ie?: string;
  endereco?: string;
}

export interface NotaInfo {
  status: NotaStatus | string;
  numero?: string;
  ref?: string;
  pdfUrl?: string;
  erro?: string;
  // BLOCO 82: dados p/ o mini DANFE 80mm (vindos da Focus via /api/notas)
  chave?: string;            // 44 digitos — numero/serie/modelo derivam dela
  serie?: string;
  protocolo?: string;
  dataAutorizacao?: string;
  qrCode?: string;           // URL de consulta NFC-e (quando a Focus devolve)
  emitente?: NotaEmitente;   // razao/CNPJ/IE reais da SEFAZ
}

export interface FocusStatusInfo {
  configurado: boolean;      // BLOCO 85: env FOCUS_NFE_TOKEN presente no servidor
  ambiente: string;          // 'homologacao' | 'producao'
  emitenteCnpj: boolean;     // dados do emitente configurados (NFC-e exige)
}

export const notaService = {
  /** BLOCO 85: status da integracao Focus + nota da venda (leitura barata). */
  async statusIntegracao(saleId: string): Promise<{ ok: boolean; focus?: FocusStatusInfo; nota?: NotaInfo | null; erro?: string }> {
    try {
      const res = await fetch(`/api/notas?saleId=${encodeURIComponent(saleId)}`, {
        method: 'GET',
        headers: { ...authHeaders() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      return { ok: true, focus: data.focus, nota: data.nota };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /**
   * Emite a nota da venda.
   * - Sem tipo: automatico (CNPJ valido -> NFe, senao NFC-e).
   * - tipo 'NFCE': NFC-e; se `cpfNaNota` informado e valido, emite
   *   identificando o consumidor; se vazio, NFC-e sem identificacao.
   */
  async emitir(saleId: string, tipo?: 'NFE' | 'NFCE', cpfNaNota?: string, modoCupom?: boolean): Promise<{ ok: boolean; jaEmitida?: boolean; nota?: NotaInfo; erro?: string }> {
    try {
      const res = await fetch('/api/notas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        // BLOCO 108: modoCupom -> NFC-e ANONIMA com os produtos no preco cupom/custo
        body: JSON.stringify({ acao: 'EMITIR', saleId, tipo, cpf: cpfNaNota || undefined, modoCupom: modoCupom || undefined }),
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
