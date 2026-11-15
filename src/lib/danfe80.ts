import { chaveAgrupada, extrairDaChave, mascaraCnpjCpf, mascaraNumeroNota } from './danfeTexto';

/**
 * BLOCO 131 — CUPOM FISCAL 80mm PERFEITO (DANFE NFC-e / NF-e COMPLETO)
 *
 * Pedido do dono: o PDF A4 da Focus é "horrível" para a térmica — o cupom
 * fiscal tem que sair da impressora 80mm com TODOS os dados legíveis, no
 * MESMO layout do DANFE NFC-e oficial (layout do Ato DACTE/Ajuste SINIEF 05/08
 * adaptado ao papel de rolo):
 *
 *   [emitente]  razao/fantasia + CNPJ + IE + endereco completo
 *   [titulo]    DANFE - Documento Auxiliar da Nota Fiscal de Consumidor
 *               Eletronica  +  "NAO PERMITE APROVEITAMENTO DE CREDITO DE ICMS"
 *   [nota]      numero / serie / emissao
 *   [consumidor] nome + CPF/CNPJ  ou  CONSUMIDOR NAO IDENTIFICADO
 *   [itens]     ITEM COD DESCRICAO + "QTD UN x VL UNIT = VL TOTAL" (por item!)
 *   [totais]    qtde de itens / valor produtos / desconto / VALOR TOTAL
 *   [pagamento] FORMA ... VALOR (tPag oficial da SEFAZ) + troco
 *   [consulta]  QR CODE OFICIAL (infNFeSupl/qrCode do XML autorizado)
 *   [chave]     chave de acesso em grupos de 4 + protocolo de autorizacao
 *   [legal]     contingencia / Simples Nacional / informacoes adicionais
 *
 * SAIDA: texto 48 colunas (papel 80mm) com os marcadores de sempre do app
 * ([[QR:...]] / [[BARCODE:...]]) — o bluetoothPrinterService imprime QR/barras
 * ESC/POS nativos e o canal USB do PC (usbPrint) vira imagem no papel virtual.
 *
 * A DATA vem do objeto DanfeFiscalData (montado no servidor pelo endpoint
 * /api/notas/cupom a partir do XML AUTORIZADO da SEFAZ via Focus NFe) — o
 * cupom nunca diverge do documento fiscal.
 */

const W = 48; // colunas do papel 80mm (mesma grade de cupomTexto/danfeTexto)
const LINHA = '-'.repeat(W);

// ---------------------------------------------------------------------------
// Dados que o servidor devolve (endpoint /api/notas/cupom)
// ---------------------------------------------------------------------------
export interface DanfeFiscalItem {
  codigo?: string;
  descricao: string;
  quantidade: number;
  unidade?: string;
  valorUnitario: number;
  valorTotal: number; // vProd - vDesc do item (liquido, como o consumidor ve)
}

export interface DanfeFiscalPagamento {
  forma: string; // "DINHEIRO", "PIX", "CARTAO DE CREDITO"...
  valor: number;
}

export interface DanfeFiscalData {
  autorizada: boolean;
  cancelada?: boolean;
  statusBruto?: string;
  /** NFC-e em contingencia off-line (tpEmis 9) — aviso obrigatorio no papel */
  contingencia?: boolean;
  modelo: 'NFCE' | 'NFE';
  numero?: string;
  serie?: string;
  chave: string;               // 44 digitos
  protocolo?: string;
  dataAutorizacao?: string;    // dhRecbto (XML) ou data_autorizacao (Focus)
  dataEmissao?: string;        // dhEmi (XML) — vai no bloco numero/serie
  qrCode?: string;             // URL oficial de consulta NFC-e (XML)
  emitente: { nome?: string; fantasia?: string; cnpj?: string; ie?: string; endereco?: string };
  destinatario?: { nome?: string; doc?: string };  // doc so digitos
  itens: DanfeFiscalItem[];
  quantidadeItens?: number;    // soma das quantidades
  valorProdutos?: number;
  valorDesconto?: number;
  valorTotal: number;
  valorTributos?: number;      // vTotTrib (Lei da Transparencia) quando > 0
  pagamentos?: DanfeFiscalPagamento[];
  troco?: number;
  informacoes?: string;        // infCpl (informacoes adicionais contribuinte)
  simplesNacional?: boolean;   // mensagem legal ME/EPP (Lei 123/2006)
  pdfUrl?: string;
  fonte?: 'XML' | 'APP';
}

// ---------------------------------------------------------------------------
// Formatacao
// ---------------------------------------------------------------------------
const money = (v: number): string =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number.isFinite(v) ? v : 0);

/** Quantidade: "2" inteiro, "0,500" quando fracionada (peso/volume). */
const qtdFmt = (v: number): string =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number.isFinite(v) ? v : 0);

/** Valor unitario: 2 decimais; mantem 4 quando o XML traz precisao (kg/L).
 *  BLOCO 137: a linha do item passou a ser UNICA (desc + QTD + valor) — o
 *  unitario por item ficou para o XML/PDF A4; helper mantido para uso futuro. */
const unitFmt = (v: number): string => {
  const n = Number.isFinite(v) ? v : 0;
  const preciso = Math.abs(n - Math.round(n * 100) / 100) > 0.0001;
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: preciso ? 4 : 2 }).format(n);
};

const dataHoraBR = (iso?: string): string => {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  const d = dt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const h = dt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${d} ${h}`;
};

/** Quebra em palavras (nunca corta no meio) para as 48 colunas. */
const wrap = (txt: string, n = W): string[] => {
  const out: string[] = [];
  let rest = String(txt || '').replace(/\s+/g, ' ').trim();
  if (!rest) return out;
  while (rest.length > n) {
    let corte = rest.lastIndexOf(' ', n);
    if (corte <= 0) corte = n;
    out.push(rest.substring(0, corte));
    rest = rest.substring(corte).trimStart();
  }
  if (rest) out.push(rest);
  return out;
};

/** tPag do padrao nacional -> nome legivel no papel */
export const TPAG_LABEL: Record<string, string> = {
  '01': 'DINHEIRO',
  '02': 'CHEQUE',
  '03': 'CARTAO DE CREDITO',
  '04': 'CARTAO DE DEBITO',
  '05': 'CREDITO EM LOJA',
  '10': 'VENDA A PRAZO LOJA',
  '11': 'CREDIARIO',
  '12': 'OUTROS',
  '15': 'BOLETO BANCARIO',
  '16': 'DEPOSITO BANCARIO',
  '17': 'PIX',
  '90': 'SEM PAGAMENTO',
  '91': 'PAGAMENTO POSTERIOR',
};

// ---------------------------------------------------------------------------
// Construtor do cupom fiscal 80mm
// ---------------------------------------------------------------------------
export function danfeFiscal80(d: DanfeFiscalData): string {
  const chave = (d.chave || '').replace(/\D/g, '');
  const info = extrairDaChave(chave);
  const isNfce = (d.modelo === 'NFE' || info?.mod === '55') ? false : true;

  const L: string[] = [];
  // Marcadores de QR/barras NUNCA truncados (mesma regra do danfeTexto)
  const push = (s: string) => L.push(/^\[\[(QR|BARCODE):/.test(s) ? s : String(s));
  const ctr = (s: string) => {
    const x = String(s || '');
    push(' '.repeat(Math.max(0, Math.floor((W - x.length) / 2))) + x.substring(0, Math.min(x.length, 200)));
  };
  /** "VALOR TOTAL ........... 11,30" — pontilhado alinhado a direita */
  const dots = (label: string, valor: string) => {
    const gap = Math.max(1, W - label.length - valor.length - 2);
    push(`${label} ${'.'.repeat(gap)} ${valor}`);
  };

  // ============================================================
  // CABECALHO — emitente (razao/fantasia + CNPJ/IE + endereco)
  // ============================================================
  const emitNome = (d.emitente?.nome || '').trim();
  const emitFant = (d.emitente?.fantasia || '').trim();
  const cab = (emitFant || emitNome).toUpperCase();
  if (cab) { push('*'.repeat(W)); ctr(cab); push('*'.repeat(W)); }
  // BLOCO 137 (regra do dono): "DOCE MANIA EXPRESS" + "DOCE MANIA EXPRESS
  // LTDA" = o MESMO nome duas vezes no papel. Quando a razao social e a
  // fantasia sao uma variacao da outra (uma contem a outra), sai UMA vez
  // só — o nome que ja saiu no cabeçalho de estrelas.
  const nomeU = emitNome.toUpperCase();
  const fantU = emitFant.toUpperCase();
  if (emitFant && emitNome && !nomeU.includes(fantU) && !fantU.includes(nomeU)) ctr(emitNome);
  const emitCnpj = (d.emitente?.cnpj || info?.cnpj || '').replace(/\D/g, '');
  if (emitCnpj) ctr(`CNPJ: ${mascaraCnpjCpf(emitCnpj)}`);
  const emitIe = (d.emitente?.ie || '').trim();
  if (emitIe && !/^isen/i.test(emitIe)) ctr(`IE: ${emitIe}`);
  const end = (d.emitente?.endereco || '').trim();
  // endereço pode vir com '\n' (blocos: logradouro / bairro-município / CEP)
  for (const parte of end.split('\n')) for (const l of wrap(parte)) ctr(l);

  // ============================================================
  // TITULO DO DOCUMENTO FISCAL
  // ============================================================
  push(LINHA);
  if (isNfce) {
    ctr('DANFE - Documento Auxiliar da');
    ctr('Nota Fiscal de Consumidor Eletronica');
    push(LINHA);
    ctr('EMISSAO NORMAL');
    ctr('NAO PERMITE APROVEITAMENTO DE');
    ctr('CREDITO DE ICMS');
  } else {
    ctr('DANFE SIMPLIFICADO');
    ctr('NOTA FISCAL ELETRONICA - MODELO 55');
  }
  push(LINHA);

  // ============================================================
  // NUMERO / SERIE / EMISSAO
  // ============================================================
  const numero9 = info?.numero || (d.numero || '').replace(/\D/g, '');
  const serie3 = (info?.serie || (d.serie || '')).replace(/\D/g, '');
  push(`NUMERO: ${mascaraNumeroNota(numero9) || '---------'}`);
  push(`SERIE: ${(serie3 || '---').padStart(3, '0').slice(0, 3)}   EMISSAO: ${dataHoraBR(d.dataEmissao)}`);

  // ============================================================
  // CONSUMIDOR
  // ============================================================
  push(LINHA);
  const cliNome = (d.destinatario?.nome || '').trim();
  const cliDoc = (d.destinatario?.doc || '').replace(/\D/g, '');
  if (cliNome || cliDoc) {
    for (const l of wrap(`CONSUMIDOR: ${cliNome || '-'}`)) push(l);
    if (cliDoc) push(`CPF/CNPJ: ${mascaraCnpjCpf(cliDoc)}`);
  } else {
    ctr('CONSUMIDOR NAO IDENTIFICADO');
  }

  // ============================================================
  // ITENS — BLOCO 137: UMA linha por item (nº codigo DESCRIÇÃO + QTDx + VALOR)
  // ============================================================
  push(LINHA);
  let somaQtd = 0;
  // BLOCO 137 (regra do dono): descrição + quantidade + VALOR em UMA linha
  // por item, em grade FIXA (nº+codigo | descrição | QTD | valor) — todos
  // os itens alinhados nas mesmas colunas. Descrição longa quebra com a
  // continuação ALINHADA sob o início do texto (nada de linha solta).
  (d.itens || []).forEach((it, i) => {
    somaQtd += Number(it.quantidade) || 0;
    const pCol = 9;   // "1 2e2822 " — item + codigo (coluna fixa)
    const qtdCol = 5; // "  1x" / " 0,5x"
    const valCol = 8; // "    3,60"
    const prefixo = `${i + 1}${it.codigo ? ` ${String(it.codigo).slice(0, 6)}` : ''}`;
    const p = prefixo.substring(0, pCol).padEnd(pCol);
    const nome = (it.descricao || 'ITEM').toUpperCase();
    const descW = Math.max(10, W - pCol - qtdCol - valCol);
    const linhasNome = wrap(nome, descW);
    const qtdStr = `${qtdFmt(it.quantidade)}x`;
    const valStr = money(it.valorTotal);
    push(p + (linhasNome[0] || '').padEnd(descW) + qtdStr.padStart(qtdCol) + valStr.padStart(valCol));
    for (let k = 1; k < Math.min(linhasNome.length, 4); k++) push(' '.repeat(pCol) + linhasNome[k]);
  });

  // ============================================================
  // TOTAIS (valores oficiais do ICMSTot)
  // ============================================================
  push(LINHA);
  dots('QTDE TOTAL DE ITENS', qtdFmt(d.quantidadeItens != null ? d.quantidadeItens : somaQtd));
  dots('VALOR DOS PRODUTOS', money(d.valorProdutos ?? (d.itens || []).reduce((a, it) => a + it.valorTotal, 0)));
  if ((d.valorDesconto || 0) > 0) dots('DESCONTO', money(d.valorDesconto));
  dots('VALOR TOTAL', `R$ ${money(d.valorTotal)}`);
  if ((d.valorTributos || 0) > 0) dots('TRIBUTOS TOTAIS (LEI 12.741)', money(d.valorTributos));

  // ============================================================
  // FORMA DE PAGAMENTO (tPag oficial) + troco
  // ============================================================
  push(LINHA);
  dots('FORMA DE PAGAMENTO', 'VALOR');
  for (const pg of d.pagamentos || []) dots(pg.forma, money(pg.valor));
  if ((d.troco || 0) > 0) dots('TROCO', money(d.troco));

  // ============================================================
  // CONSULTA — QR OFICIAL da SEFAZ (NFC-e) / barras da chave (NF-e)
  // ============================================================
  push(LINHA);
  if (isNfce && d.qrCode && /^https?:/i.test(d.qrCode)) {
    ctr('Consulta de autenticidade');
    ctr('leia o QR Code abaixo');
    push(`[[QR:${d.qrCode}]]`);
  }
  ctr('CHAVE DE ACESSO');
  push(chaveAgrupada(chave));
  if (!isNfce) push(`[[BARCODE:${chave}]]`);

  // ============================================================
  // PROTOCOLO DE AUTORIZACAO + contingencia
  // ============================================================
  push(LINHA);
  const prot = (d.protocolo || '').trim();
  if (prot) {
    push('PROTOCOLO DE AUTORIZACAO:');
    for (const l of wrap(prot)) push(l);
    push(`AUTORIZADO EM: ${dataHoraBR(d.dataAutorizacao)}`);
  }
  if (d.contingencia) {
    ctr('*** EMITIDA EM CONTINGENCIA (OFF-LINE) ***');
    ctr('consulta valida apos efetivacao');
  }

  // ============================================================
  // MENSAGENS LEGAIS + informacoes adicionais
  // ============================================================
  if (d.informacoes) {
    push(LINHA);
    for (const l of wrap(d.informacoes)) push(l);
  }
  if (d.simplesNacional) {
    push(LINHA);
    // BLOCO 137 (regra do dono): SEM a frase "nao gera direito a credito
    // fiscal" — a letra seca da lei assusta o consumidor de balcão. Fica
    // só o aviso do regime (Lei 123/2006).
    for (const l of wrap('Documento emitido por ME ou EPP optante pelo Simples Nacional.')) push(l);
  }

  push(LINHA);
  return L.join('\n');
}
