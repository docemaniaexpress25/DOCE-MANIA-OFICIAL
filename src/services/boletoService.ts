import { authHeaders } from '@/services/userService';

/**
 * Servico de BOLETO BANCARIO INTER (Bloco 25) — conversa com /api/boletos.
 * As credenciais do Inter (client_id/secret/certificado mTLS) ficam no
 * servidor; aqui so vai o token de sessao do app.
 * BLOCO 152: mini boleto 80mm EXCLUIDO — o boleto do app e o PDF ORIGINAL
 * do Inter (acao PDF) enviado ao cliente/WhatsApp.
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
  /** FIX atrelamento: chave 44 dig da NF-e/NFC-e atrelada à cobrança no Inter. */
  notaFiscalChave?: string;
  /** BLOCO 225: minutos desde que a cobrança entrou EM_PROCESSAMENTO no
   *  Inter (null quando não é o caso) — o dono vê se é processamento normal
   *  ou emissão travada. */
  processandoMin?: number | null;
  /** BLOCO 225: true = processando há 30+ min sem sair — orientar o botão
   *  DESTRavar (admin) para liberar e gerar um boleto novo. */
  avisarDestravar?: boolean;
}

export interface NotaDaVendaInfo {
  status?: string;
  numero?: string;
  chave?: string;
  /** BLOCO 177: tipo da nota da venda ('NFE' | 'NFCE') — só NF-e (modelo 55)
   *  é atrelada ao boleto; NFC-e nunca (regra do dono). */
  tipo?: string;
}

/** BLOCO 177: configuração que enriquece o MINI BOLETO (papel + térmica BT):
 *  texto configurado no hub ERP Fiscal + beneficiário (emitente do ERP). */
export interface BoletoConfigInfo {
  mensagemPadrao?: string;
  beneficiarioNome?: string;
  beneficiarioDoc?: string;
}

/** BLOCO 199 (BOLETO DUPLICO — rota 5): uma PARCELA = uma cobrança no Inter.
 *  As parcelas JUNTAS fecham o valor da venda (ex.: 1º em 7 dias com parte do
 *  valor, o restante no 2º em 14 dias — ou dividir por 2). */
export interface BoletoParcelaInfo {
  id: string;
  seq: number;                 // 1 ou 2 (ordem do boleto na divisão)
  valor: number;
  vencimento: string;          // YYYY-MM-DD
  status: string;              // mesmos status do boleto único
  codigo?: string;
  seuNumero?: string;
  linhaDigitavel?: string;
  codigoBarras?: string;
  pixCopiaECola?: string;
  erro?: string;
  /** BLOCO 225: minutos em EM_PROCESSAMENTO + aviso do DESTRavar (30+ min). */
  processandoMin?: number | null;
  avisarDestravar?: boolean;
}

export interface GerarBoletoParams {
  vencimento: string;        // YYYY-MM-DD
  valor?: number | string;
  mensagem?: string;
  atrelarNFe?: boolean;
  docManual?: string;        // CPF/CNPJ informado na tela quando o cadastro nao tem
  cepManual?: string;        // CEP informado na tela quando o cadastro nao tem (Inter exige)
}

export interface InterStatusInfo {
  configurado: boolean;      // BLOCO 85: credenciais Inter presentes no servidor
  ambiente: string;          // 'producao' | 'sandbox'
}

/** BLOCO 227: resposta de gerar ganha o aviso do vencimento corrigido
 *  (boleto com prazo vencido sai vencendo hoje — o servidor avisa aqui). */
export interface GerarBoletoResposta {
  ok: boolean;
  jaGerado?: boolean;
  boleto?: BoletoInfo;
  erro?: string;
  avisoAtrelamento?: string;
  notaAtrelada?: boolean;
  avisoVencimento?: string;
}

export const boletoService = {
  /** Estado atual do boleto da venda (leitura barata).
   *  BLOCO 200: o SERVIDOR também diz se a venda pode dividir em 2 boletos
   *  (rota 5) — reforço à prova de falha do casamento feito no client.
   *  BLOCO 210: podeCancelar diz se o botão CANCELAR BOLETO aparece (ADMIN). */
  async status(saleId: string): Promise<{ ok: boolean; boleto?: BoletoInfo; parcelas?: BoletoParcelaInfo[]; inter?: InterStatusInfo; nota?: NotaDaVendaInfo; config?: BoletoConfigInfo; podeDividir?: boolean; podeCancelar?: boolean; erro?: string }> {
    try {
      const res = await fetch(`/api/boletos?saleId=${encodeURIComponent(saleId)}`, {
        method: 'GET',
        headers: { ...authHeaders() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      return { ok: true, boleto: data.boleto, parcelas: data.parcelas, inter: data.inter, nota: data.nota, config: data.config, podeDividir: data.podeDividir === true, podeCancelar: data.podeCancelar === true };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Gera a cobranca (boleto+pix) no Inter para o saldo da venda.
   *  BLOCO 227: devolve avisoVencimento quando o prazo vencido foi corrigido
   *  para hoje pelo servidor. */
  async gerar(saleId: string, p: GerarBoletoParams): Promise<GerarBoletoResposta> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'EMITIR', saleId, ...p }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, boleto: data.boleto };
      return { ok: true, jaGerado: data.jaGerado, boleto: data.boleto, avisoAtrelamento: data.avisoAtrelamento, notaAtrelada: data.notaAtrelada, avisoVencimento: data.avisoVencimento };
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

  /**
   * BLOCO 217 — baixa o PDF do boleto e devolve o base64 (SEM abrir janela).
   * O window.open(blob) antigo era bloqueado no celular (popup após fetch
   * async já não conta como gesto do usuário) e blob: não abre em apps
   * externos — por isso "gera o PDF mas não consigo visualizar/compartilhar/
   * salvar". Agora o card recebe o base64 e mostra o VISUALIZADOR próprio
   * (iframe) com COMPARTILHAR (Web Share API com arquivo real), SALVAR
   * (download) e ABRIR EM NOVA ABA — tudo com gesto direto do usuário.
   */
  async obterPdf(saleId: string): Promise<{ ok: boolean; pdfBase64?: string; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'PDF', saleId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.pdfBase64) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      return { ok: true, pdfBase64: String(data.pdfBase64) };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao buscar o PDF' };
    }
  },

  /** [ADMIN] Cancela a cobranca no Inter (motivo obrigatorio).
   *  BLOCO 210: cancela APENAS o boleto — a venda permanece e o status
   *  CANCELADO volta a oferecer "Gerar Novamente" no card. */
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

  // =====================================================================
  // BLOCO 224 — DESTRAVAR boleto preso em EM_PROCESSAMENTO no Inter
  // (caso Paradouro do Campo / Zotti Tijuca): o Inter RECUSA o
  // cancelamento de cobrança em processamento ("A cobrança não pode ser
  // cancelada, pois se encontra na situação EM_PROCESSAMENTO"). O admin
  // destrava LOCALMENTE: vira FALHA_EMISSAO e o card volta a oferecer
  // GERAR para um boleto novo (novo seuNumero).
  // =====================================================================
  async destravar(saleId: string, parcelaId?: string): Promise<{ ok: boolean; boleto?: BoletoInfo; parcela?: BoletoParcelaInfo; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'DESTRAVAR', saleId, ...(parcelaId ? { parcelaId } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, boleto: data.boleto, parcela: data.parcela };
      return { ok: true, boleto: data.boleto, parcela: data.parcela };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  // =====================================================================
  // BLOCO 227 — RESET TOTAL do boleto da venda (ADMIN, ultimo recurso):
  // cancela as cobrancas vivas no Inter (o que o Inter recusar fica sob
  // vigilancia do sync, BLOCO 226), apaga a divisao de parcelas e devolve
  // a venda ao estado NAO_GERADO puro — o card volta a oferecer GERAR do
  // zero. Protecao no servidor: boleto/parcela ja RECEBIDO bloqueia.
  // =====================================================================
  async resetar(saleId: string): Promise<{ ok: boolean; boleto?: BoletoInfo; parcelas?: BoletoParcelaInfo[]; aviso?: string; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'RESET', saleId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, boleto: data.boleto };
      return { ok: true, boleto: data.boleto, parcelas: data.parcelas || [], aviso: data.aviso };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** BLOCO 210: [ADMIN] cancela o boleto de UMA parcela da divisão (só o
   *  boleto escolhido — a venda e as outras parcelas seguem normais). */
  async cancelarParcela(saleId: string, parcelaId: string, motivo: string): Promise<{ ok: boolean; parcela?: BoletoParcelaInfo; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'CANCELAR', saleId, parcelaId, motivo }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      return { ok: true, parcela: data.parcela };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  // =====================================================================
  // BLOCO 199 — BOLETO DUPLICO (regra do dono, EXCLUSIVO rota 5 / Deivid):
  // dois boletos que JUNTOS fecham o valor da venda.
  // =====================================================================

  /** Grava a divisão (2 boletos com SEU valor e SEU vencimento). */
  async criarParcelas(saleId: string, boletos: Array<{ valor: number; vencimento: string; doc?: string; cep?: string }>): Promise<{ ok: boolean; parcelas?: BoletoParcelaInfo[]; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'CRIAR_PARCELAS', saleId, boletos }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      return { ok: true, parcelas: data.parcelas };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Gera UMA parcela no Inter (boleto do seq escolhido). */
  async gerarParcela(saleId: string, parcelaId: string, p: { docManual?: string; cepManual?: string; atrelarNFe?: boolean }): Promise<{ ok: boolean; jaGerado?: boolean; parcela?: BoletoParcelaInfo; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'EMITIR', saleId, parcelaId, ...p }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, parcela: data.parcela };
      return { ok: true, jaGerado: data.jaGerado, parcela: data.parcela };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Gera TODAS as parcelas abertas de uma vez (os dois boletos juntos). */
  async emitirTodasParcelas(saleId: string, p: { docManual?: string; cepManual?: string; atrelarNFe?: boolean } = {}): Promise<{ ok: boolean; resultados?: Array<{ seq: number; ok: boolean; erro?: string; parcela?: BoletoParcelaInfo }>; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'EMITIR_TODAS', saleId, ...p }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      // BLOCO 212: o servidor devolve ok:false (200) quando alguma parcela
      // falhou — o ok real do SERVIDOR agora chega à tela (antes era sempre
      // ok:true e falha parcial/total ficava silenciosa).
      return { ok: data.ok !== false, resultados: data.resultados || [], erro: data.erro || (data.ok === false ? 'Falha ao gerar os boletos.' : undefined) };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Reconsulta UMA parcela no Inter (emissao assincrona / pagamento). */
  async consultarParcela(saleId: string, parcelaId: string): Promise<{ ok: boolean; parcela?: BoletoParcelaInfo; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'CONSULTAR', saleId, parcelaId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, parcela: data.parcela };
      return { ok: true, parcela: data.parcela };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** BLOCO 217: baixa o PDF do Inter de UMA parcela (base64, sem abrir janela
   *  — mesmo fluxo do visualizador do boleto único). */
  async obterPdfParcela(saleId: string, parcelaId: string): Promise<{ ok: boolean; pdfBase64?: string; erro?: string }> {
    try {
      const res = await fetch('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'PDF', saleId, parcelaId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.pdfBase64) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      return { ok: true, pdfBase64: String(data.pdfBase64) };
    } catch (e: unknown) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao buscar o PDF' };
    }
  },
};
