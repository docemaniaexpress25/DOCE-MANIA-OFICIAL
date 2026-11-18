/**
 * BLOCO 182 — NOTAS ESPECIAIS — motor de emissão MANUAL de NF-e (modelo 55).
 *
 * Pedido do dono (18/11): "eu preciso emitir notas de devolução ao meu
 * fornecedor... uma aba que abre uma tela onde poderemos colocar o nosso
 * destinatário da nota após isso os produtos, poderemos calcular alíquota e
 * trocar os códigos de emissão, como 5102, seria 5202, 6202 fora do estado,
 * cst 0101 seria 0900, nota sairia sem pagamento ao invés de dinheiro, seria
 * como emitir uma nota toda personalizada".
 *
 * Este arquivo é o MOTOR (funções PURAS — sem env, sem rede, testável por QA
 * e reaproveitado no client para validar ANTES de chamar o servidor):
 *
 *  - PRESETS do que o dono pediu:
 *      DEVOLUCAO   -> natureza "Devolução...", CFOP 5202 (mesma UF) / 6202
 *                     (fora), CSOSN 900 ("0101" vira "0900" na mão do dono),
 *                     finalidade 4 (devolução), tPag 90 — SEM PAGAMENTO;
 *      BONIFICACAO -> CFOP 5910/6910 (bonificação/doação/brinde), CSOSN 900,
 *                     tPag 90 — SEM PAGAMENTO;
 *      LIVRE       -> qualquer nota manual: CFOP/CSOSN/CST/alíquota/forma de
 *                     pagamento/natureza/finalidade TUDO editável.
 *
 *  - CFOP 5xxx/6xxx: o PRIMEIRO DÍGITO obedece a UF (5 = operação dentro do
 *    estado do emitente, 6 = fora). Digitou 5202 para destinatário em outra
 *    UF? O motor vira 6202 SOZINHO (com ajuste automático ligado, default ON;
 *    pode desligar para mandar o CFOP exatamente como digitou).
 *
 *  - Tributação por item: CSOSN 101/102/900 (Simples Nacional — a "0101" e
 *    "0900" do dono são aceitas e normalizadas) OU CST de regime normal
 *    (000/040/041/050/060/090) — quando CST, os campos BASE + ALÍQUOTA de
 *    ICMS SOBEM no XML (icms_base_calculo / icms_aliquota — nomes oficiais da
 *    API Focus v2.0, conferidos no echo `requisicao_nota_fiscal` da doc);
 *    quando CSOSN, NADA de ICMS sobe (o Simples não destaca vICMS — a
 *    alíquota digitada vira ESTIMATIVA de conferência na tela).
 *
 *  - Pagamento: tPag "90" = SEM PAGAMENTO (o EXEMPLO OFICIAL da Focus usa
 *    exatamente { forma_pagamento: "90", valor_pagamento: "0" } na doc
 *    consultar_nfe.md) — vPag sai 0 quando "90".
 *
 *  - Nota referenciada (devolução): chave de 44 dígitos opcional vai em
 *    `notas_referenciadas` (campo do payload normalizado da v2.0).
 *
 *  - Endereço do destinatário: modelo 55 aceita enderDest TODO OU NADA (mesma
 *    regra do Bloco 176 — o erro "nro not expected" morre aqui: a validação
 *    RECUSA antes de chamar a Focus quando falta qualquer pedaço).
 */

import { validaCpfCnpj, mascaraCpfCnpj } from '@/lib/validaDoc';
import type { FocusNfePayloadV2, FocusItemV2 } from '@/lib/focusNfe';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type TipoNotaEspecial = 'DEVOLUCAO' | 'BONIFICACAO' | 'LIVRE';
export type KindTributacao = 'CSOSN' | 'CST';

export interface PresetNotaEspecial {
  tipo: TipoNotaEspecial;
  label: string;
  desc: string;
  natureza: string;
  /** CFOP inicial (mesma UF) — o 6xxx sai sozinho quando a UF for outra. */
  cfopMesmaUf: string;
  /** Tributação inicial dos itens (CSOSN 101/102/900 ou CST). */
  tributacao: string;
  /** 1 normal · 2 complementar · 3 ajuste · 4 devolução/retorno (SEFAZ). */
  finalidade: number;
  /** tPag inicial — '90' = SEM PAGAMENTO (pedido do dono). */
  pagamentoDefault: string;
  /** indPres: 9 = não se aplica (devolução/bonificação) · 1 = presencial. */
  presenca: number;
  motivoSugerido: string;
}

export interface TributacaoOp {
  codigo: string;
  kind: KindTributacao;
  label: string;
  desc: string;
}

export interface FormaPagamentoOp {
  forma: string;
  label: string;
  prazo: boolean;
  desc?: string;
}

export interface ItemNotaEspecial {
  codigo?: string;
  descricao: string;
  ncm?: string;
  ean?: string;
  unidade?: string;
  /** Origem da mercadoria: 0-8 (0 = nacional). */
  origem?: string;
  /** CFOP do item (4 dígitos, sai 5xxx ou 6xxx conforme a UF). */
  cfop: string;
  /** CSOSN/CST do item (101/102/900 ou 000/040/041/050/060/090). */
  tributacao: string;
  quantidade: number;
  valorUnitario: number;
  /** Desconto em R$ aplicado NO item. */
  desconto?: number;
  /** Base de cálculo do ICMS em R$ (SÓ sobe no XML quando CST de regime normal). */
  baseIcms?: number;
  /** Alíquota do ICMS em % (sobe no XML quando CST; estimativa quando CSOSN). */
  aliquotaIcms?: number;
}

export interface DestinatarioNotaEspecial {
  nome: string;
  cpfCnpj: string;
  ie?: string;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  email?: string;
  telefone?: string;
}

export interface NotaEspecialInput {
  tipo: TipoNotaEspecial;
  natureza: string;
  /** Finalidade SEFAZ (default = preset; a nota LIVRE pode trocar). */
  finalidade?: number;
  /** ON (default): ajusta o 1º dígito do CFOP pela UF (5202 -> 6202 fora). */
  cfopAutoUf: boolean;
  destinatario: DestinatarioNotaEspecial;
  itens: ItemNotaEspecial[];
  /** tPag escolhido ('90' = sem pagamento). */
  pagamentoForma: string;
  /** Valor do pagamento (default = total da nota; '90' força 0). */
  pagamentoValor?: number;
  /** Chave da NF-e original (devolução) — 44 dígitos, opcional. */
  refNfe?: string;
  /** Informações complementares / motivo (texto do dono). */
  informacoes?: string;
}

/** Contexto injetado pelo servidor — o motor continua 100% puro/testável. */
export interface CtxNotaEspecial {
  ufEmitente: string;
  /** Dados do emitente já prontos (lerEmitentePayload + env). */
  emitentePayload?: Partial<FocusNfePayloadV2>;
  agora?: Date;
}

export interface ResultadoNotaEspecial {
  payload: FocusNfePayloadV2;
  valorProdutos: number;
  descontoTotal: number;
  valorTotal: number;
  /** ICMS ESTIMADO para conferência (base x alíquota dos itens). */
  icmsEstimado: number;
  /** Ajustes automáticos feitos pelo motor (ex.: "item 2: CFOP 5202 -> 6202"). */
  cfopsAjustados: string[];
}

export interface ValidaNotaEspecial {
  erros: string[];
  avisos: string[];
}

// ---------------------------------------------------------------------------
// PRESETS (regra do dono)
// ---------------------------------------------------------------------------

export const PRESET_ESPECIAL: Record<TipoNotaEspecial, PresetNotaEspecial> = {
  DEVOLUCAO: {
    tipo: 'DEVOLUCAO',
    label: 'DEVOLUÇÃO',
    desc: 'Devolução de venda / retorno ao fornecedor — sai SEM pagamento, CFOP 5202 (6202 fora do estado), CSOSN 900, finalidade 4.',
    natureza: 'Devolução de venda de mercadoria',
    cfopMesmaUf: '5202',
    tributacao: '900',
    finalidade: 4,
    pagamentoDefault: '90',
    presenca: 9,
    motivoSugerido: 'Devolução de mercadoria conforme negociação com o destinatário.',
  },
  BONIFICACAO: {
    tipo: 'BONIFICACAO',
    label: 'BONIFICAÇÃO',
    desc: 'Bonificação / doação / brinde — sai SEM pagamento, CFOP 5910 (6910 fora do estado), CSOSN 900.',
    natureza: 'Bonificação de mercadoria',
    cfopMesmaUf: '5910',
    tributacao: '900',
    finalidade: 1,
    pagamentoDefault: '90',
    presenca: 9,
    motivoSugerido: 'Bonificação de mercadoria sem cobrança de pagamento.',
  },
  LIVRE: {
    tipo: 'LIVRE',
    label: 'NOTA LIVRE',
    desc: 'Qualquer nota batida na mão: CFOP, CSOSN/CST, alíquota, natureza e pagamento 100% editáveis.',
    natureza: 'Venda de mercadoria',
    cfopMesmaUf: '5102',
    tributacao: '101',
    finalidade: 1,
    pagamentoDefault: '01',
    presenca: 1,
    motivoSugerido: '',
  },
};

// ---------------------------------------------------------------------------
// CFOP — dicionário + ajuste automático 5xxx/6xxx pela UF
// ---------------------------------------------------------------------------

/** Bases 5xxx (mesma UF). Fora do estado = mesmo número com 1º dígito 6. */
export const CFOP_BASES: { cfop: string; label: string }[] = [
  { cfop: '5102', label: 'Venda de mercadoria' },
  { cfop: '5202', label: 'Devolução de venda de mercadoria' },
  { cfop: '5409', label: 'Transferência de mercadoria' },
  { cfop: '5411', label: 'Devolução de mercadoria recebida p/ industrialização' },
  { cfop: '5551', label: 'Devolução de compra p/ comercialização (p/ fornecedor)' },
  { cfop: '5552', label: 'Devolução de compra p/ industrialização (p/ fornecedor)' },
  { cfop: '5905', label: 'Remessa p/ conserto ou reparo' },
  { cfop: '5906', label: 'Retorno de mercadoria de conserto/reparo' },
  { cfop: '5910', label: 'Remessa em bonificação, doação ou brinde' },
  { cfop: '5911', label: 'Remessa p/ demonstração' },
  { cfop: '5949', label: 'Outra saída de mercadoria não especificada' },
];

/** Rotulo completo: "5202 · Devolução de venda de mercadoria (fora do estado)". */
export function labelCfop(cfop: string): string {
  const c = soDigitos(cfop);
  if (c.length !== 4) return cfop || '—';
  const base = CFOP_BASES.find(b => b.cfop === c) || CFOP_BASES.find(b => b.cfop === '5' + c.slice(1));
  const fora = c.startsWith('6');
  if (!base) return `${c}${fora ? ' · fora do estado' : ''}`;
  return `${c} · ${base.label}${fora ? ' (fora do estado)' : ''}`;
}

/**
 * Ajusta o 1º dígito do CFOP pela UF do destinatário — o "5102 -> 6202 fora
 * do estado" do dono, automático. Sem `auto`, devolve o CFOP como digitou.
 */
export function cfopAjustadoPorUf(cfop: string, ufDest: string, ufEmit: string, auto: boolean): string {
  const c = soDigitos(cfop);
  if (!auto || c.length !== 4 || !/^[56]/.test(c)) return c;
  const fora = (ufDest || '').toUpperCase().trim() !== (ufEmit || '').toUpperCase().trim();
  const dígito = fora ? '6' : '5';
  return dígito + c.slice(1);
}

// ---------------------------------------------------------------------------
// Tributação (CSOSN Simples + CST regime normal) — "0101" vira "101"
// ---------------------------------------------------------------------------

export const TRIBUTACOES: TributacaoOp[] = [
  { codigo: '101', kind: 'CSOSN', label: 'CSOSN 101', desc: 'Simples — com permissão de crédito (padrão da venda)' },
  { codigo: '102', kind: 'CSOSN', label: 'CSOSN 102', desc: 'Simples — sem crédito (padrão da NFC-e)' },
  { codigo: '900', kind: 'CSOSN', label: 'CSOSN 900', desc: 'Simples — outros (devolução / bonificação)' },
  { codigo: '000', kind: 'CST', label: 'CST 000', desc: 'Regime normal — tributada integralmente (envia base + alíquota)' },
  { codigo: '040', kind: 'CST', label: 'CST 040', desc: 'Regime normal — isenta' },
  { codigo: '041', kind: 'CST', label: 'CST 041', desc: 'Regime normal — não tributada' },
  { codigo: '050', kind: 'CST', label: 'CST 050', desc: 'Regime normal — suspensão' },
  { codigo: '060', kind: 'CST', label: 'CST 060', desc: 'Regime normal — ICMS ST retido anteriormente' },
  { codigo: '090', kind: 'CST', label: 'CST 090', desc: 'Regime normal — outras' },
];

/**
 * Normaliza o que o dono digitou: "0101" -> "101" e "0900" -> "900" (o dono
 * escreve o CST com zero à esquerda; o schema SEFAZ usa CSOSN de 3 dígitos).
 */
export function normalizaTributacao(v: string): string {
  const d = soDigitos(v);
  if (d.length === 4 && d.startsWith('0')) return d.slice(1);
  return d;
}

export function tributacaoDe(v: string): TributacaoOp | undefined {
  return TRIBUTACOES.find(t => t.codigo === normalizaTributacao(v));
}

/** true = é CST de regime normal (base + alíquota sobem no XML). */
export function ehCstNormal(v: string): boolean {
  const t = tributacaoDe(v);
  return !!t && t.kind === 'CST';
}

// ---------------------------------------------------------------------------
// Pagamento — tPag oficial (doc campo do NF-e 4.00 via Focus v2.0)
// ---------------------------------------------------------------------------

export const FORMAS_PAGAMENTO: FormaPagamentoOp[] = [
  { forma: '90', label: 'SEM PAGAMENTO', prazo: false, desc: 'Devolução / bonificação — nota sai sem cobrança' },
  { forma: '01', label: 'DINHEIRO', prazo: false },
  { forma: '17', label: 'PIX', prazo: false },
  { forma: '03', label: 'CARTÃO DE CRÉDITO', prazo: false },
  { forma: '04', label: 'CARTÃO DE DÉBITO', prazo: false },
  { forma: '15', label: 'BOLETO BANCÁRIO', prazo: true },
  { forma: '91', label: 'PAGAMENTO POSTERIOR', prazo: true },
  { forma: '99', label: 'OUTROS', prazo: false },
];

export function formaPagamentoDe(forma: string): FormaPagamentoOp | undefined {
  return FORMAS_PAGAMENTO.find(f => f.forma === soDigitos(forma));
}

// ---------------------------------------------------------------------------
// Finalidade SEFAZ
// ---------------------------------------------------------------------------

export const FINALIDADES: { valor: number; label: string; desc: string }[] = [
  { valor: 1, label: '1 · Normal', desc: 'Operação comum (venda, bonificação...)' },
  { valor: 2, label: '2 · Complementar', desc: 'Complemento de valores de nota anterior' },
  { valor: 3, label: '3 · Ajuste', desc: 'Ajuste fiscal' },
  { valor: 4, label: '4 · Devolução/Retorno', desc: 'Devolução de mercadoria (com referência quando houver)' },
];

// ---------------------------------------------------------------------------
// Helpers locais (iguais aos do focusNfe — aqui puros p/ client também)
// ---------------------------------------------------------------------------

export function soDigitos(v?: string | null): string {
  return (v || '').replace(/\D/g, '');
}

function normalizaTexto(v?: string | null, max = 120): string {
  return (v || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function numeroDe(v: unknown): number {
  const n = Number(String(v ?? '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/** 'S/N' APENAS com logradouro (mesma convenção do Bloco 176). */
function numeroDoEndereco(numero?: string | null, logradouro?: string | null): string {
  const lgr = (logradouro || '').trim();
  const n = soDigitos(numero);
  if (n) return n;
  if (!lgr) return '';
  const m = lgr.match(/(\d+)\s*$/);
  return m ? m[1] : 'S/N';
}

/** Modelo 55 exige enderDest TODO OU NADA (Bloco 176). */
export function faltandoEnderecoEspecial(d: DestinatarioNotaEspecial): string[] {
  const faltando: string[] = [];
  if (!String(d.logradouro || '').trim()) faltando.push('Logradouro (rua)');
  if (!String(d.bairro || '').trim()) faltando.push('Bairro');
  if (!String(d.municipio || '').trim()) faltando.push('Município');
  if (!/^[A-Z]{2}$/.test(String(d.uf || '').toUpperCase().trim())) faltando.push('UF');
  if (soDigitos(d.cep).length !== 8) faltando.push('CEP (8 dígitos)');
  return faltando;
}

/** ISO com fuso de SP, igual ao focusNfe ("2026-11-18T10:30:00-03:00"). */
function isoComFuso(d: Date): string {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d);
  return `${p.replace(' ', 'T')}-03:00`;
}

function carimbo(): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// VALIDAÇÃO (mesma no client e no servidor)
// ---------------------------------------------------------------------------

export function validarNotaEspecial(input: NotaEspecialInput, ufEmitente: string): ValidaNotaEspecial {
  const erros: string[] = [];
  const avisos: string[] = [];
  const preset = PRESET_ESPECIAL[input.tipo] || PRESET_ESPECIAL.LIVRE;

  // ---- destinatário ----
  const dest = input.destinatario;
  if (!String(dest?.nome || '').trim()) erros.push('Destinatário: nome/razão social obrigatório.');
  const doc = soDigitos(dest?.cpfCnpj);
  if (!doc) erros.push('Destinatário: CPF/CNPJ obrigatório (SEFAZ não aceita destinatário sem documento na NF-e).');
  else if (!validaCpfCnpj(doc)) erros.push(`Destinatário: ${doc.length === 11 ? 'CPF' : 'CNPJ'} com dígito verificador inválido.`);
  const faltandoEnd = faltandoEnderecoEspecial(dest);
  if (faltandoEnd.length > 0) {
    erros.push(`Destinatário: endereço INCOMPLETO — falta ${faltandoEnd.join(', ')}. A NF-e (modelo 55) exige endereço completo.`);
  }

  // ---- natureza / finalidade ----
  if (!String(input.natureza || '').trim()) erros.push('Natureza da operação obrigatória.');
  const finalidade = Number(input.finalidade ?? preset.finalidade);
  if (![1, 2, 3, 4].includes(finalidade)) erros.push('Finalidade inválida (1, 2, 3 ou 4).');
  if (input.tipo === 'DEVOLUCAO' && finalidade !== 4) {
    avisos.push('Devolução com finalidade diferente de 4 — a SEFAZ espera finalidade 4 (devolução/retorno) na devolução.');
  }

  // ---- itens ----
  if (!input.itens || input.itens.length === 0) erros.push('Adicione pelo menos UM produto à nota.');
  input.itens.forEach((it, i) => {
    const n = i + 1;
    if (!String(it.descricao || '').trim()) erros.push(`Item ${n}: descrição obrigatória.`);
    if (!(it.quantidade > 0)) erros.push(`Item ${n}: quantidade deve ser maior que zero.`);
    if (numeroDe(it.valorUnitario) < 0) erros.push(`Item ${n}: valor unitário inválido.`);
    const cfop = soDigitos(it.cfop);
    if (cfop.length !== 4 || !/^[56]/.test(cfop)) {
      erros.push(`Item ${n}: CFOP "${it.cfop}" inválido — informe 4 dígitos começando com 5 (mesma UF) ou 6 (fora do estado).`);
    }
    const trib = tributacaoDe(it.tributacao);
    if (!trib) {
      erros.push(`Item ${n}: tributação "${it.tributacao}" não conhecida — use CSOSN 101/102/900 ou CST 000/040/041/050/060/090.`);
    } else if (trib.kind === 'CST' && (trib.codigo === '000' || trib.codigo === '090')) {
      const base = numeroDe(it.baseIcms);
      const ali = numeroDe(it.aliquotaIcms);
      if (base <= 0 || ali < 0) {
        erros.push(`Item ${n}: ${trib.label} exige BASE de cálculo (R$) e ALÍQUOTA (%) do ICMS preenchidas — é o que sobe no XML.`);
      }
    }
    if (!soDigitos(it.ncm)) avisos.push(`Item ${n} sem NCM — sai com o código genérico 21069090 na nota.`);
    if (soDigitos(it.ean) && ![8, 12, 13, 14].includes(soDigitos(it.ean).length)) {
      avisos.push(`Item ${n}: EAN com tamanho inválido (${soDigitos(it.ean).length} dígitos) — o EAN não vai na nota.`);
    }
  });

  // ---- pagamento ----
  const forma = formaPagamentoDe(input.pagamentoForma);
  if (!forma) erros.push('Forma de pagamento inválida.');
  else if (forma.forma === '90' && numeroDe(input.pagamentoValor) > 0) {
    avisos.push('SEM PAGAMENTO (tPag 90) sai com valor 0 no XML — o valor informado foi ignorado.');
  }
  if (input.tipo === 'BONIFICACAO' && forma && forma.forma !== '90') {
    avisos.push('Bonificação normalmente sai SEM PAGAMENTO (tPag 90) — confira se é essa mesmo a forma escolhida.');
  }

  // ---- referência (devolução) ----
  const ref = soDigitos(input.refNfe);
  if (ref && ref.length !== 44) {
    erros.push(`Chave da nota original deve ter 44 dígitos (tem ${ref.length}).`);
  }
  if (input.tipo === 'DEVOLUCAO' && !ref) {
    avisos.push('Devolução sem a chave da nota original — a SEFAZ de alguns estados exige a NF referenciada; informe a chave de 44 dígitos quando tiver.');
  }

  // ---- UF fora do estado (informativo) ----
  const ufDest = String(dest?.uf || '').toUpperCase().trim();
  if (ufEmitente && ufDest && ufEmitente !== ufDest) {
    avisos.push(`Destinatário em ${ufDest} (emitente ${ufEmitente}): operação FORA DO ESTADO — os CFOPs 5xxx viram 6xxx automaticamente${input.cfopAutoUf ? '' : ' (ajuste automático está DESLIGADO — confira o CFOP digitado)'}.`);
  }

  return { erros, avisos };
}

// ---------------------------------------------------------------------------
// MONTAGEM DO PAYLOAD FOCUS v2.0
// ---------------------------------------------------------------------------

export function montarNotaEspecial(input: NotaEspecialInput, ctx: CtxNotaEspecial): ResultadoNotaEspecial {
  const preset = PRESET_ESPECIAL[input.tipo] || PRESET_ESPECIAL.LIVRE;
  const ufEmit = (ctx.ufEmitente || '').toUpperCase();
  const ufDest = String(input.destinatario.uf || '').toUpperCase().trim();
  const foraEstado = !!ufDest && !!ufEmit && ufDest !== ufEmit;
  const cfopsAjustados: string[] = [];

  // ---- itens ----
  const items: FocusItemV2[] = input.itens.map((it, i) => {
    const qty = numeroDe(it.quantidade);
    const vunit = numeroDe(it.valorUnitario);
    const bruto = round2(qty * vunit);
    const desc = round2(Math.max(0, numeroDe(it.desconto)));
    const cfopOriginal = soDigitos(it.cfop);
    const cfop = cfopAjustadoPorUf(cfopOriginal, ufDest, ufEmit, input.cfopAutoUf);
    if (input.cfopAutoUf && cfop !== cfopOriginal && cfop.length === 4) {
      cfopsAjustados.push(`Item ${i + 1}: CFOP ${cfopOriginal} -> ${cfop} (${foraEstado ? 'destinatário fora do estado' : 'mesma UF'})`);
    }
    const trib = normalizaTributacao(it.tributacao);
    const item: FocusItemV2 = {
      numero_item: i + 1,
      codigo_produto: (String(it.codigo || '').trim() || `P${i + 1}`).slice(0, 60),
      descricao: normalizaTexto(it.descricao, 120),
      codigo_ncm: soDigitos(it.ncm) || '21069090',
      cfop,
      unidade_comercial: String(it.unidade || 'UN').slice(0, 6) || 'UN',
      unidade_tributavel: String(it.unidade || 'UN').slice(0, 6) || 'UN',
      quantidade_comercial: qty,
      quantidade_tributavel: qty,
      valor_unitario_comercial: round2(vunit),
      valor_unitario_tributavel: round2(vunit),
      valor_bruto: bruto,
      inclui_no_total: 1,
      icms_origem: Number(soDigitos(it.origem) || '0') || 0,
      icms_situacao_tributaria: trib,
      pis_situacao_tributaria: '49',
      cofins_situacao_tributaria: '49',
    };
    const ean = soDigitos(it.ean);
    if (ean.length === 8 || ean.length === 12 || ean.length === 13 || ean.length === 14) {
      // BLOCO 130 (regra SEFAZ): cEANT obrigatório quando cEAN existe (1:1).
      item.codigo_barras_comercial = ean;
      item.codigo_barras_tributavel = ean;
    }
    if (desc > 0) item.valor_desconto = desc;
    // CST de regime normal: base + alíquota SOBEM no XML (nomes oficiais v2.0);
    // CSOSN (Simples): nada de ICMS sobe — a alíquota na tela é estimativa.
    if (ehCstNormal(trib)) {
      const base = round2(numeroDe(it.baseIcms));
      const ali = round2(numeroDe(it.aliquotaIcms));
      if (base > 0 && ali >= 0) {
        (item as unknown as Record<string, unknown>).icms_base_calculo = base;
        (item as unknown as Record<string, unknown>).icms_aliquota = ali;
      }
    }
    return item;
  });

  // ---- totais ----
  const valorProdutos = round2(input.itens.reduce((acc, it) => acc + numeroDe(it.quantidade) * numeroDe(it.valorUnitario), 0));
  const descontoTotal = round2(input.itens.reduce((acc, it) => acc + Math.max(0, numeroDe(it.desconto)), 0));
  const valorTotal = round2(valorProdutos - descontoTotal);
  const icmsEstimado = round2(input.itens.reduce((acc, it) => {
    const t = tributacaoDe(it.tributacao);
    if (t && t.kind === 'CST') return acc + (numeroDe(it.baseIcms) * numeroDe(it.aliquotaIcms)) / 100;
    return acc + (numeroDe(it.quantidade) * numeroDe(it.valorUnitario) - Math.max(0, numeroDe(it.desconto))) * (numeroDe(it.aliquotaIcms) / 100);
  }, 0));

  // ---- pagamento (tPag 90 = SEM PAGAMENTO, vPag 0) ----
  const forma = formaPagamentoDe(input.pagamentoForma) || formaPagamentoDe('01')!;
  const valorPag = forma.forma === '90' ? 0 : (input.pagamentoValor !== undefined ? round2(numeroDe(input.pagamentoValor)) : valorTotal);

  // ---- destinatário (modelo 55 — endereço obrigatório; validado antes) ----
  const dest = input.destinatario;
  const docDest = soDigitos(dest.cpfCnpj);
  const ie = String(dest.ie || '').trim();
  const payload: FocusNfePayloadV2 = {
    natureza_operacao: normalizaTexto(input.natureza || preset.natureza, 120),
    data_emissao: isoComFuso(ctx.agora || new Date()),
    tipo_documento: 1,
    local_destino: foraEstado ? 2 : 1,
    finalidade_emissao: Number(input.finalidade ?? preset.finalidade),
    consumidor_final: docDest.length === 14 ? 0 : 1, // CNPJ (contribuinte) não é consumidor final; PF é
    presenca_comprador: preset.presenca,
    modalidade_frete: 9,
    ...(ctx.emitentePayload || {}),
    nome_destinatario: normalizaTexto(dest.nome, 60),
    ...(docDest.length === 14 ? { cnpj_destinatario: docDest } : {}),
    ...(docDest.length === 11 ? { cpf_destinatario: docDest } : {}),
    ...(ie && !/^isen/i.test(ie)
      ? { inscricao_estadual_destinatario: ie.slice(0, 20), indicador_inscricao_estadual_destinatario: 1 as const }
      : { indicador_inscricao_estadual_destinatario: 9 as const }),
    logradouro_destinatario: normalizaTexto(dest.logradouro, 60),
    numero_destinatario: numeroDoEndereco(dest.numero, dest.logradouro).slice(0, 60),
    bairro_destinatario: normalizaTexto(dest.bairro, 60),
    municipio_destinatario: normalizaTexto(dest.municipio, 60),
    uf_destinatario: ufDest.slice(0, 2),
    ...(soDigitos(dest.cep) ? { cep_destinatario: soDigitos(dest.cep) } : {}),
    ...(dest.email ? { email_destinatario: dest.email.trim().slice(0, 60) } : {}),
    ...(soDigitos(dest.telefone).length >= 6 ? { telefone_destinatario: soDigitos(dest.telefone) } : {}),
    valor_produtos: valorProdutos,
    ...(descontoTotal > 0 ? { valor_desconto: descontoTotal } : {}),
    valor_total: valorTotal,
    items,
    formas_pagamento: [{ indicador_pagamento: forma.prazo ? 1 : 0, forma_pagamento: forma.forma, valor_pagamento: valorPag }],
  };

  // ---- nota referenciada (devolução com a chave da nota original) ----
  const ref = soDigitos(input.refNfe);
  if (ref.length === 44) {
    (payload as unknown as Record<string, unknown>).notas_referenciadas = [ref];
  }

  // ---- informações complementares (motivo + carimbo — nunca silencioso) ----
  const infoDono = String(input.informacoes || '').trim();
  const auto = `Nota ${preset.label} emitida manualmente pelo app Doce Mania em ${carimbo()}. Pagamento: ${labelFormaPagamento(forma.forma)}.`;
  payload.informacoes_adicionais_contribuinte = normalizaTexto(
    infoDono ? `${infoDono} — ${auto}` : auto,
    500,
  );

  return { payload, valorProdutos, descontoTotal, valorTotal, icmsEstimado, cfopsAjustados };
}

/** Rótulo do tPag (mesma tabela do Bloco 145). */
export function labelFormaPagamento(forma: string): string {
  const f = formaPagamentoDe(forma);
  if (f) return f.label;
  const mapa: Record<string, string> = { '02': 'CHEQUE', '16': 'DEPÓSITO BANCÁRIO' };
  return mapa[soDigitos(forma)] || 'DINHEIRO';
}

/** Máscara do documento (delegada ao validaDoc — conveniência p/ o portal). */
export const mascaraDoc = mascaraCpfCnpj;
