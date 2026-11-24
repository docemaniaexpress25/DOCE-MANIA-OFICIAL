/**
 * BLOCO 215 — CARGA FISCAL: REMESSA PARA VENDA AMBULANTE (CFOP 5949) +
 * DEVOLUÇÃO AUTOMÁTICA DA CARGA (CFOP 1949 — entrada própria).
 *
 * Pergunta do dono: "meu vendedor sai com 50 caixas de Doritos 75g, fica 1
 * semana fora vendendo a pronta entrega (emite DANFE mini NF-e na hora),
 * quero que a CARGA dele gere um documento e que o DEVOLVER faça a devolução
 * automaticamente, tudo atrelado à carga carregada".
 *
 * RESPOSTA FISCAL (os nomes com 100% de certeza):
 *  - O documento da CARGA NÃO é "documento de transporte" (isso é CT-e, só
 *    para frete de terceiros — a van da própria empresa não precisa).
 *  - É a NF-e modelo 55 de REMESSA: natureza "REMESSA PARA VENDA AMBULANTE",
 *    CFOP 5949 "Outra saída não especificada" (mesma UF; 6949 fora),
 *    SEM PAGAMENTO (tPag 90), indPres 9, CSOSN 900 (Simples — igual ao que o
 *    contador orientou nas notas especiais; 400/500 ficam à mão para o
 *    contador trocar no LIVRE).
 *  - Cada VENDA da jornada continua sendo NF-e 55 CFOP 5102 (DANFE mini na
 *    hora — já existe no app).
 *  - No RETORNO, o que não vendeu volta com NF-e de ENTRADA própria:
 *    natureza "DEVOLUÇÃO DE REMESSA PARA VENDA AMBULANTE", CFOP 1949
 *    (2949 fora do estado), finalidade 4 (devolução/retorno), SEM PAGAMENTO,
 *    REFERENCIANDO a chave da NF-e de remessa (notas_referenciadas).
 *  - Fechamento fiscal da jornada: remessa (50 cx) − vendas (NF-e 5102) =
 *    devolução (49 cx). O estoque do app fecha pela mecânica própria (a venda
 *    baixa o estoque_principal no ato e a devolução mecânica devolve a carga).
 *
 * Este módulo é PURA (sem env, sem rede) e monta NotaEspecialInput — o motor
 * do Bloco 182 (notaEspecial.ts) que já sabe CFOP/CSOSN/UF/pagamento/ref —
 * e o /api/cargas-fiscal emite pela Focus igual às notas especiais.
 */

import {
  DestinatarioNotaEspecial,
  ItemNotaEspecial,
  NotaEspecialInput,
} from '@/lib/notaEspecial';

const soDig = (v?: string | null): string => (v || '').replace(/\D/g, '');
const round2Safe = (v: number): number => Math.round(v * 100) / 100;

export const NATUREZA_REMESSA = 'REMESSA PARA VENDA AMBULANTE';
export const NATUREZA_DEVOLUCAO_REMESSA = 'DEVOLUÇÃO DE REMESSA PARA VENDA AMBULANTE';
export const CFOP_REMESSA = '5949';
export const CFOP_DEVOLUCAO_REMESSA = '1949';

export interface ItemCargaFiscal {
  produtoId: string;
  nome: string;
  codigo?: string;
  ncm?: string;
  ean?: string;
  unidade?: string;
  origem?: string;
  quantidade: number;
  valorUnitario: number;
}

export interface EmitenteCargaFiscal {
  nome: string;
  cnpj: string;
  ie?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
}

/** Texto que sobe na NF-e de remessa (informações complementares). */
export function informacoesRemessaCarga(vendedor: string, dias: number): string {
  return (
    `Remessa para venda ambulante — carga do vendedor ${vendedor || '(vendedor)'} ` +
    `para venda a pronta entrega no período de ${dias} dia(s). ` +
    'As vendas serão emitidas por NF-e (CFOP 5102) pelo próprio emitente. ' +
    'O remanescente não vendido retorna ao estabelecimento por NF-e de devolução (CFOP 1949) referenciando esta nota.'
  );
}

/** Texto da devolução (referencia a remessa por número/chave). */
export function informacoesDevolucaoCarga(vendedor: string, remessaNumero: string): string {
  return (
    `Devolução do remanescente não vendido da remessa para venda ambulante ` +
    `(NF-e nº ${remessaNumero || '—'}) da carga do vendedor ${vendedor || '(vendedor)'}. ` +
    'Mercadoria retorna ao estoque do emitente.'
  );
}

/** Destinatário da remessa/devolução: a PRÓPRIA empresa (entrada/saída própria). */
export function destinatarioDaEmpresa(e: EmitenteCargaFiscal): DestinatarioNotaEspecial {
  return {
    nome: e.nome || 'PROPRIA EMPRESA',
    cpfCnpj: soDig(e.cnpj),
    ie: e.ie || '',
    logradouro: e.logradouro || 'SEDE',
    numero: e.numero || 'S/N',
    bairro: e.bairro || 'CENTRO',
    municipio: e.municipio || 'CIDADE',
    uf: (e.uf || 'RS').toUpperCase().slice(0, 2),
    cep: e.cep || '',
  };
}

function itensParaNota(itens: ItemCargaFiscal[], cfop: string, tributacao: string): ItemNotaEspecial[] {
  return itens.map(it => ({
    codigo: it.codigo || it.produtoId.slice(0, 8).toUpperCase(),
    descricao: it.nome,
    ncm: it.ncm,
    ean: it.ean,
    unidade: it.unidade || 'UN',
    origem: it.origem,
    cfop,
    tributacao,
    quantidade: Math.max(0, it.quantidade),
    valorUnitario: Math.max(0, it.valorUnitario),
  }));
}

/** REMESSA: carga da van -> NF-e 55 CFOP 5949 SEM PAGAMENTO (indPres 9). */
export function montarInputRemessaCarga(opts: {
  itens: ItemCargaFiscal[];
  emitente: EmitenteCargaFiscal;
  vendedor: string;
  dias: number;
}): NotaEspecialInput {
  return {
    tipo: 'LIVRE',
    natureza: NATUREZA_REMESSA,
    finalidade: 1,
    cfopAutoUf: true,
    presenca: 9,
    destinatario: destinatarioDaEmpresa(opts.emitente),
    itens: itensParaNota(opts.itens, CFOP_REMESSA, '900'),
    pagamentoForma: '90', // SEM PAGAMENTO (tPag 90) — remessa não é venda
    informacoes: informacoesRemessaCarga(opts.vendedor, opts.dias),
  };
}

/** DEVOLUÇÃO: o que voltou -> NF-e 55 de ENTRADA CFOP 1949, finalidade 4,
 *  referenciando a chave da remessa. */
export function montarInputDevolucaoCarga(opts: {
  itens: ItemCargaFiscal[];
  emitente: EmitenteCargaFiscal;
  vendedor: string;
  remessaNumero: string;
  remessaChave?: string;
}): NotaEspecialInput {
  return {
    tipo: 'LIVRE',
    natureza: NATUREZA_DEVOLUCAO_REMESSA,
    finalidade: 4,
    cfopAutoUf: true,
    presenca: 9,
    destinatario: destinatarioDaEmpresa(opts.emitente),
    itens: itensParaNota(opts.itens, CFOP_DEVOLUCAO_REMESSA, '900'),
    pagamentoForma: '90',
    ...(opts.remessaChave ? { refNfe: opts.remessaChave } : {}),
    informacoes: informacoesDevolucaoCarga(opts.vendedor, opts.remessaNumero),
  };
}

// ---------------------------------------------------------------------------
// RESUMO DA DEVOLUÇÃO — carregado × vendido × devolve
// ---------------------------------------------------------------------------

export interface ResumoDevolucaoItem {
  produtoId: string;
  nome: string;
  valorUnitario: number;
  /** Quantidade na remessa (o que saiu na NF-e 5949). */
  carregado: number;
  /** Vendido na jornada (NF-e 5102 — vendas do vendedor desde a remessa). */
  vendido: number;
  /** Devolve = max(0, carregado - vendido) — default do modal (editável). */
  devolve: number;
}

export function resumoDevolucao(opts: {
  remessa: ItemCargaFiscal[];
  /** mapa produtoId -> quantidade vendida desde a remessa (sale_items). */
  vendidos: Map<string, number>;
}): ResumoDevolucaoItem[] {
  return opts.remessa.map(it => {
    const vendido = Math.min(it.quantidade, Math.max(0, opts.vendidos.get(it.produtoId) || 0));
    const devolve = Math.max(0, it.quantidade - vendido);
    return {
      produtoId: it.produtoId,
      nome: it.nome,
      valorUnitario: it.valorUnitario,
      carregado: it.quantidade,
      vendido,
      devolve,
    };
  });
}

/** Total da remessa/devolução (itens × valor). */
export function totalItensCarga(itens: ItemCargaFiscal[]): number {
  return round2Safe(itens.reduce((a, it) => a + Math.max(0, it.quantidade) * Math.max(0, it.valorUnitario), 0));
}
