import { authHeaders } from '@/services/userService';

/**
 * Servico de BOLETO BANCARIO INTER (Bloco 25) — conversa com /api/boletos.
 * As credenciais do Inter (client_id/secret/certificado mTLS) ficam no
 * servidor; aqui so vai o token de sessao do app.
 */

export interface BoletoInfo {
  status: string;            // NAO_GERADO | EM_PROCESSAMENTO | A_RECEBER | RECEBIDO | ATRASADO | CANCELADO | EXPIRADO | FALHA_EMISSAO | PROTESTO | MARCADO_RECEBIDO
  codigo?: string;           // codigoSolicitacao no Inter
  seuNumero?: string;
  vencimento?: string;       // YYYY-MM-DD
  valor?: number | null;
  linhaDigitavel?: string;
  codigoBarras?: string;
  pixCopiaECola?: string;
  valorRecebido?: number | null;
  erro?: string;
}

export interface GerarBoletoParams {
  vencimento: string;        // YYYY-MM-DD
  valor?: number | string;
  mensagem?: string;
  atrelarNFe?: boolean;
  docManual?: string;        // CPF/CNPJ informado na tela quando o cadastro nao tem
  cepManual?: string;        // CEP informado na tela quando o cadastro nao tem (Inter exige)
}

export const boletoService = {
  /** Estado atual do boleto da venda (leitura barata). */
  async status(saleId: string): Promise<{ ok: boolean; boleto?: BoletoInfo; erro?: string }> {
    try {
      const res = await fetch(`/api/boletos?saleId=${encodeURIComponent(saleId)}`, {
        method: 'GET',
        headers: { ...authHeaders() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      return { ok: true, boleto: data.boleto };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Gera a cobranca (boleto+pix) no Inter para o saldo da venda. */
  async gerar(saleId: string, p: GerarBoletoParams): Promise<{ ok: boolean; jaGerado?: boolean; boleto?: BoletoInfo; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'EMITIR', saleId, ...p }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, boleto: data.boleto };
      return { ok: true, jaGerado: data.jaGerado, boleto: data.boleto };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Reconsulta a situacao no Inter (emissao assincrona / pagamento). */
  async consultar(saleId: string): Promise<{ ok: boolean; boleto?: BoletoInfo; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'CONSULTAR', saleId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, boleto: data.boleto };
      return { ok: true, boleto: data.boleto };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Baixa o PDF do boleto e abre numa aba nova (blob URL). */
  async abrirPdf(saleId: string): Promise<{ ok: boolean; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'PDF', saleId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.pdfBase64) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      const bin = atob(data.pdfBase64 as string);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return { ok: true };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao abrir o PDF' };
    }
  },

  /** [ADMIN] Cancela a cobranca no Inter (motivo obrigatorio). */
  async cancelar(saleId: string, motivo: string): Promise<{ ok: boolean; boleto?: BoletoInfo; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'CANCELAR', saleId, motivo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, boleto: data.boleto };
      return { ok: true, boleto: data.boleto };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },
};
