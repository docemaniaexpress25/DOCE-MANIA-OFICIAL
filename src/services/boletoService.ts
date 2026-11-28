import { authHeaders } from '@/services/userService';

/**
 * Servico de BOLETO BANCARIO INTER (Bloco 25) — conversa com /api/boletos.
 * As credenciais do Inter (client_id/secret/certificado mTLS) ficam no
 * servidor; aqui so vai o token de sessao do app.
 * BLOCO 152: mini boleto 80mm EXCLUIDO — o boleto do app e o PDF ORIGINAL
 * do Inter (acao PDF) enviado ao cliente/WhatsApp.
 */

// ============================================================================
// BLOCO 230 — PRAZO (timeout) em TODAS as chamadas do boleto.
// Caso real (27/11 13:07 SP): o dono apertou GERAR e o card ficou girando
// "Gerando no Inter..." por 3 MINUTOS sem nenhuma resposta — o fetch do
// app não tinha prazo e o servidor podia ficar até ~5,5 min preso na cadeia
// token + tentativas + fallback no Inter. Agora TODA chamada tem AbortController:
// estourou o prazo, o card mostra mensagem clara na hora (e orienta conferir
// o ATUALIZAR antes de gerar de novo, porque o Inter pode ter aceitado).
// ============================================================================
class PrazoExcedidoError extends Error {
  constructor(public prazoSegundos: number) {
    super(`PRAZO_EXCEDIDO_${prazoSegundos}s`);
  }
}

async function fetchComPrazo(url: string, init: RequestInit, prazoMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), prazoMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new PrazoExcedidoError(Math.round(prazoMs / 1000));
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Mensagem amigável quando o prazo estoura — sempre orienta a conferir antes
 *  de reemitir (evita boleto em dobro: a emissão pode ter sido aceita lá). */
function msgPrazo(prazoSegundos: number, contexto: string): string {
  return `${contexto}: passou de ${prazoSegundos}s sem resposta (Inter lento/instável agora). O boleto PODE ter sido aceito — toque ATUALIZAR no card para conferir a situação antes de GERAR de novo.`;
}

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
 *  (boleto com prazo vencido sai vencendo hoje — o servidor avisa aqui).
 *  BLOCO 239: avisoRecuperacao = a tentativa anterior tinha sido ACEITA pelo
 *  Inter (cobranca sombra) e foi reencontrada/adotada pelo código — o boleto
 *  nasceu e NÃO foi emitido em dobro. */
export interface GerarBoletoResposta {
  ok: boolean;
  jaGerado?: boolean;
  boleto?: BoletoInfo;
  erro?: string;
  avisoAtrelamento?: string;
  notaAtrelada?: boolean;
  avisoVencimento?: string;
  avisoRecuperacao?: string;
}

export const boletoService = {
  /** Estado atual do boleto da venda (leitura barata).
   *  BLOCO 200: o SERVIDOR também diz se a venda pode dividir em 2 boletos
   *  (rota 5) — reforço à prova de falha do casamento feito no client.
   *  BLOCO 210: podeCancelar diz se o botão CANCELAR BOLETO aparece (ADMIN).
   *  BLOCO 230: prazo 30s. */
  async status(saleId: string): Promise<{ ok: boolean; boleto?: BoletoInfo; parcelas?: BoletoParcelaInfo[]; inter?: InterStatusInfo; nota?: NotaDaVendaInfo; config?: BoletoConfigInfo; podeDividir?: boolean; podeCancelar?: boolean; erro?: string }> {
    try {
      const res = await fetchComPrazo(`/api/boletos?saleId=${encodeURIComponent(saleId)}`, {
        method: 'GET',
        headers: { ...authHeaders() },
      }, 30_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      return { ok: true, boleto: data.boleto, parcelas: data.parcelas, inter: data.inter, nota: data.nota, config: data.config, podeDividir: data.podeDividir === true, podeCancelar: data.podeCancelar === true };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'Consultar boleto') };
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Gera a cobranca (boleto+pix) no Inter para o saldo da venda.
   *  BLOCO 227: devolve avisoVencimento quando o prazo vencido foi corrigido
   *  para hoje pelo servidor.
   *  BLOCO 238: prazo 115s — alinhado ao orçamento REAL do servidor (deadline
   *  de emissão 64s + fallback sem nota 30s + consulta quando couber). Os 75s
   *  antigos abortavam AQUI antes do servidor terminar: o card morria em
   *  "passou de 75s" MESMO com o boleto gerado no Inter (o dono apertava
   *  GERAR de novo e criava cobrança duplicada). */
  async gerar(saleId: string, p: GerarBoletoParams): Promise<GerarBoletoResposta> {
    try {
      const res = await fetchComPrazo('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'EMITIR', saleId, ...p }),
      }, 115_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, boleto: data.boleto };
      return { ok: true, jaGerado: data.jaGerado, boleto: data.boleto, avisoAtrelamento: data.avisoAtrelamento, notaAtrelada: data.notaAtrelada, avisoVencimento: data.avisoVencimento, avisoRecuperacao: data.avisoRecuperacao };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'GERAR boleto') };
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Reconsulta a situacao no Inter (emissao assincrona / pagamento).
   *  BLOCO 230: prazo 30s. */
  async consultar(saleId: string): Promise<{ ok: boolean; boleto?: BoletoInfo; erro?: string }> {
    try {
      const res = await fetchComPrazo('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'CONSULTAR', saleId }),
      }, 30_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, boleto: data.boleto };
      return { ok: true, boleto: data.boleto };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'Consultar boleto') };
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
   * BLOCO 230: prazo 45s (o PDF vem do Inter e é maior).
   */
  async obterPdf(saleId: string): Promise<{ ok: boolean; pdfBase64?: string; erro?: string }> {
    try {
      const res = await fetchComPrazo('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'PDF', saleId }),
      }, 45_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.pdfBase64) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      return { ok: true, pdfBase64: String(data.pdfBase64) };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'Buscar PDF do boleto') };
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao buscar o PDF' };
    }
  },

  /** [ADMIN] Cancela a cobranca no Inter (motivo obrigatorio).
   *  BLOCO 210: cancela APENAS o boleto — a venda permanece e o status
   *  CANCELADO volta a oferecer "Gerar Novamente" no card.
   *  BLOCO 230: prazo 40s. */
  async cancelar(saleId: string, motivo: string): Promise<{ ok: boolean; boleto?: BoletoInfo; erro?: string }> {
    try {
      const res = await fetchComPrazo('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'CANCELAR', saleId, motivo }),
      }, 40_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, boleto: data.boleto };
      return { ok: true, boleto: data.boleto };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'Cancelar boleto') };
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
  // BLOCO 230: prazo 45s.
  // =====================================================================
  async destravar(saleId: string, parcelaId?: string): Promise<{ ok: boolean; boleto?: BoletoInfo; parcela?: BoletoParcelaInfo; erro?: string }> {
    try {
      const res = await fetchComPrazo('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'DESTRAVAR', saleId, ...(parcelaId ? { parcelaId } : {}) }),
      }, 45_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, boleto: data.boleto, parcela: data.parcela };
      return { ok: true, boleto: data.boleto, parcela: data.parcela };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'Destravar boleto') };
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  // =====================================================================
  // BLOCO 227 — RESET TOTAL do boleto da venda (ADMIN, ultimo recurso):
  // cancela as cobrancas vivas no Inter (o que o Inter recusar fica sob
  // vigilancia do sync, BLOCO 226), apaga a divisao de parcelas e devolve
  // a venda ao estado NAO_GERADO puro — o card volta a oferecer GERAR do
  // zero. Protecao no servidor: boleto/parcela ja RECEBIDO bloqueia.
  // BLOCO 230: prazo 60s (cancela várias cobranças no Inter).
  // =====================================================================
  async resetar(saleId: string): Promise<{ ok: boolean; boleto?: BoletoInfo; parcelas?: BoletoParcelaInfo[]; aviso?: string; erro?: string }> {
    try {
      const res = await fetchComPrazo('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'RESET', saleId }),
      }, 60_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, boleto: data.boleto };
      return { ok: true, boleto: data.boleto, parcelas: data.parcelas || [], aviso: data.aviso };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'Resetar boleto') };
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** BLOCO 210: [ADMIN] cancela o boleto de UMA parcela da divisão (só o
   *  boleto escolhido — a venda e as outras parcelas seguem normais).
   *  BLOCO 230: prazo 40s. */
  async cancelarParcela(saleId: string, parcelaId: string, motivo: string): Promise<{ ok: boolean; parcela?: BoletoParcelaInfo; erro?: string }> {
    try {
      const res = await fetchComPrazo('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'CANCELAR', saleId, parcelaId, motivo }),
      }, 40_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      return { ok: true, parcela: data.parcela };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'Cancelar boleto') };
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  // =====================================================================
  // BLOCO 199 — BOLETO DUPLICO (regra do dono, EXCLUSIVO rota 5 / Deivid):
  // dois boletos que JUNTOS fecham o valor da venda.
  // =====================================================================

  /** Grava a divisão (2 boletos com SEU valor e SEU vencimento).
   *  BLOCO 230: prazo 30s (só grava no banco). */
  async criarParcelas(saleId: string, boletos: Array<{ valor: number; vencimento: string; doc?: string; cep?: string }>): Promise<{ ok: boolean; parcelas?: BoletoParcelaInfo[]; erro?: string }> {
    try {
      const res = await fetchComPrazo('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'CRIAR_PARCELAS', saleId, boletos }),
      }, 30_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      return { ok: true, parcelas: data.parcelas };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'Gravar divisão') };
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Gera UMA parcela no Inter (boleto do seq escolhido).
   *  BLOCO 238: prazo 115s — MESMA cadeia do EMITIR único no servidor
   *  (deadline de emissão 64s + fallback + consulta condicionada); os 40s
   *  antigos abortavam cedo demais e o card morria com a emissão ainda
   *  andando lá (parecia "timeout" com o boleto gerado). */
  async gerarParcela(saleId: string, parcelaId: string, p: { docManual?: string; cepManual?: string; atrelarNFe?: boolean }): Promise<{ ok: boolean; jaGerado?: boolean; parcela?: BoletoParcelaInfo; erro?: string; avisoRecuperacao?: string }> {
    try {
      const res = await fetchComPrazo('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'EMITIR', saleId, parcelaId, ...p }),
      }, 115_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, parcela: data.parcela };
      return { ok: true, jaGerado: data.jaGerado, parcela: data.parcela, avisoRecuperacao: data.avisoRecuperacao };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'GERAR boleto') };
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Gera TODAS as parcelas abertas de uma vez (os dois boletos juntos).
   *  BLOCO 230: prazo 110s — são 2 emissões SEQUENCIAIS no Inter.
   *  BLOCO 238: cada parcela tem deadline próprio de 26s no servidor
   *  (tentativa 24s) — pior caso ~96s para as duas, dentro deste prazo. */
  async emitirTodasParcelas(saleId: string, p: { docManual?: string; cepManual?: string; atrelarNFe?: boolean } = {}): Promise<{ ok: boolean; resultados?: Array<{ seq: number; ok: boolean; erro?: string; parcela?: BoletoParcelaInfo }>; erro?: string }> {
    try {
      const res = await fetchComPrazo('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'EMITIR_TODAS', saleId, ...p }),
      }, 110_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      // BLOCO 212: o servidor devolve ok:false (200) quando alguma parcela
      // falhou — o ok real do SERVIDOR agora chega à tela (antes era sempre
      // ok:true e falha parcial/total ficava silenciosa).
      return { ok: data.ok !== false, resultados: data.resultados || [], erro: data.erro || (data.ok === false ? 'Falha ao gerar os boletos.' : undefined) };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'GERAR os 2 boletos') };
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** Reconsulta UMA parcela no Inter (emissao assincrona / pagamento).
   *  BLOCO 230: prazo 30s. */
  async consultarParcela(saleId: string, parcelaId: string): Promise<{ ok: boolean; parcela?: BoletoParcelaInfo; erro?: string }> {
    try {
      const res = await fetchComPrazo('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'CONSULTAR', saleId, parcelaId }),
      }, 30_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, erro: data.erro || `Erro ${res.status}`, parcela: data.parcela };
      return { ok: true, parcela: data.parcela };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'Consultar boleto') };
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha de conexao' };
    }
  },

  /** BLOCO 217: baixa o PDF do Inter de UMA parcela (base64, sem abrir janela
   *  — mesmo fluxo do visualizador do boleto único).
   *  BLOCO 230: prazo 45s. */
  async obterPdfParcela(saleId: string, parcelaId: string): Promise<{ ok: boolean; pdfBase64?: string; erro?: string }> {
    try {
      const res = await fetchComPrazo('/api/boletos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ acao: 'PDF', saleId, parcelaId }),
      }, 45_000);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.pdfBase64) return { ok: false, erro: data.erro || `Erro ${res.status}` };
      return { ok: true, pdfBase64: String(data.pdfBase64) };
    } catch (e: unknown) {
      if (e instanceof PrazoExcedidoError) return { ok: false, erro: msgPrazo(e.prazoSegundos, 'Buscar PDF do boleto') };
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao buscar o PDF' };
    }
  },
};
