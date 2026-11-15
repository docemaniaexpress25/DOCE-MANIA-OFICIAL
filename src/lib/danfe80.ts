import { chaveAgrupada, extrairDaChave, mascaraCnpjCpf, mascaraNumeroNota } from './danfeTexto';

/**
 * MINI DANFE 80mm RETRATO — NFe (modelo 55) e NFC-e (modelo 65).
 *
 * O dono mandou analisar o PDF A4 oficial (DANFE da Focus) e montar "o melhor
 * layout possivel" do mini DANFE para a termica 80mm (Bluetooth ou USB).
 * O cupom acompanha o A4 SECAO POR SECAO, nas 48 colunas do papel:
 *
 *   [emitente]   razao/fantasia + CNPJ + IE + endereco completo (como o A4)
 *   [titulo]     DANFE - Documento Auxiliar da Nota Fiscal Eletronica
 *                + "1-SAIDA" e a NATUREZA DA OPERACAO (VENDA)
 *   [nota]       NUMERO/SERIE/EMISSAO
 *   [destinat.]  NOME/RAZAO SOCIAL + CPF/CNPJ + IE + endereco completo
 *                (logradouro, bairro, CEP, municipio/UF — como o A4)
 *   [itens]      grade do A4: "n COD DESCRICAO ... VALOR TOT" + linha de
 *                dados fiscais "qtd UN x VL_UNIT NCM CST CFOP"
 *   [imposto]    CALCULO DO IMPOSTO (vBC/vICMS/vBCST/vST quando > 0)
 *   [totais]     QTDE ITENS / VALOR PRODUTOS / DESCONTO / VALOR TOTAL
 *                / tributos totais (Lei 12.741)
 *   [pagamento]  FORMA ... VALOR (tPag oficial da SEFAZ) + troco
 *                — REGRA DO DONO: forma de pagamento SEMPRE aparece
 *   [consulta]   QR CODE OFICIAL (NFC-e) ou codigo de barras (NF-e)
 *                + CHAVE DE ACESSO em grupos de 4
 *   [protocolo]  PROTOCOLO DE AUTORIZACAO + data
 *   [legal]      Simples Nacional (Lei 123/2006) + informacoes adicionais
 *
 * SAIDA: texto 48 colunas com os marcadores [[QR:...]] / [[BARCODE:...]] —
 * o bluetoothPrinterService imprime QR/barras ESC/POS nativos e o canal USB
 * do PC (usbPrint) vira imagem no papel virtual.
 *
 * Os dados vêm do endpoint /api/notas/cupom a partir do XML AUTORIZADO da
 * SEFAZ via Focus NFe — o cupom nunca diverge do documento fiscal.
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
  /** Grade fiscal do A4 (DADOS DO PRODUTO / SERVICO) */
  ncm?: string;
  cst?: string; // CST ou CSOSN
  cfop?: string;
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
  /** Destinatario completo (como o A4): doc so digitos + endereco + IE */
  destinatario?: {
    nome?: string;
    doc?: string;
    endereco?: string; // logradouro, n, bairro - CEP - mun/UF (multilinha)
    ie?: string;
  };
  natureza?: string;           // natOp (A4: NATUREZA DA OPERACAO — VENDA)
  itens: DanfeFiscalItem[];
  quantidadeItens?: number;    // soma das quantidades
  valorProdutos?: number;
  valorDesconto?: number;
  valorTotal: number;
  valorTributos?: number;      // vTotTrib (Lei da Transparencia) quando > 0
  /** CALCULO DO IMPOSTO do A4 (mostrado quando maior que zero) */
  baseIcms?: number;
  valorIcms?: number;
  baseIcmsSt?: number;
  valorIcmsSt?: number;
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

/** Valor unitario: 2 decimais; mantem 4 quando o XML traz precisao (kg/L). */
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

/** Endereco do destinatario em blocos (logradouro / bairro-municipio / CEP)
 *  — mesmo formato que o emitente recebe do servidor. */
export function enderecoDestinatarioTexto(d: DanfeFiscalData['destinatario']): string {
  if (!d) return '';
  const linhas: string[] = [];
  if (d.endereco && d.endereco.includes('\n')) {
    linhas.push(...d.endereco.split('\n').map((s) => s.trim()).filter(Boolean));
    return linhas.join('\n');
  }
  if (d.endereco) linhas.push(String(d.endereco));
  return linhas.join('\n');
}

// ---------------------------------------------------------------------------
// Construtor do mini DANFE 80mm (retrato) — fiel ao modelo A4 do dono
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
    ctr('DANFE - Documento Auxiliar da');
    ctr('Nota Fiscal Eletronica - MODELO 55');
  }
  push(LINHA);

  // ============================================================
  // 1-SAIDA + NATUREZA DA OPERACAO (A4: "VENDA")
  // ============================================================
  push(`1-SAIDA  NATUREZA DA OPERACAO: ${(d.natureza || 'VENDA').toUpperCase()}`);

  // ============================================================
  // NUMERO / SERIE / EMISSAO
  // ============================================================
  const numero9 = info?.numero || (d.numero || '').replace(/\D/g, '');
  const serie3 = (info?.serie || (d.serie || '')).replace(/\D/g, '');
  push(`NUMERO: ${mascaraNumeroNota(numero9) || '---------'}`);
  push(`SERIE: ${(serie3 || '---').padStart(3, '0').slice(0, 3)}   EMISSAO: ${dataHoraBR(d.dataEmissao)}`);

  // ============================================================
  // DESTINATARIO / REMETENTE (A4: nome + doc + IE + endereco completo)
  // ============================================================
  push(LINHA);
  push('DESTINATARIO / REMETENTE');
  push(LINHA);
  const cliNome = (d.destinatario?.nome || '').trim();
  const cliDoc = (d.destinatario?.doc || '').replace(/\D/g, '');
  if (cliNome || cliDoc) {
    for (const l of wrap(cliNome || '-')) push(l);
    if (cliDoc) push(`CPF/CNPJ: ${mascaraCnpjCpf(cliDoc)}`);
    const cliIe = (d.destinatario?.ie || '').trim();
    if (cliIe && !/^isen/i.test(cliIe)) push(`IE: ${cliIe}`);
    for (const parte of enderecoDestinatarioTexto(d.destinatario).split('\n')) {
      if (parte) for (const l of wrap(parte)) push(l);
    }
  } else {
    ctr('CONSUMIDOR NAO IDENTIFICADO');
  }

  // ============================================================
  // ITENS — grade do A4 (DADOS DO PRODUTO / SERVICO): 2 linhas por item
  //   linha 1: "n CODIGO DESCRICAO .............. VL TOT"
  //   linha 2: "  qtd UN x VL_UNIT  NCM ... CST ... CFOP ..."
  // (CST = CSOSN no Simples Nacional — o A4 mostra 0101/0102)
  // ============================================================
  push(LINHA);
  push('DADOS DO PRODUTO / SERVICO');
  push(LINHA);
  let somaQtd = 0;
  (d.itens || []).forEach((it, i) => {
    somaQtd += Number(it.quantidade) || 0;
    const pCol = 10;  // "1 DOR120 " — item + codigo interno (coluna fixa)
    const qtdCol = 4; // "5,000" (fica "5,000UN")
    const valCol = 9; // "    57,95"
    const prefixo = `${i + 1}${it.codigo ? ` ${String(it.codigo).slice(0, 7)}` : ''}`;
    const p = prefixo.substring(0, pCol).padEnd(pCol);
    const nome = (it.descricao || 'ITEM').toUpperCase();
    const descW = Math.max(10, W - pCol - valCol - 1);
    const linhasNome = wrap(nome, descW);
    push(p + (linhasNome[0] || '').padEnd(descW) + money(it.valorTotal).padStart(valCol));
    for (let k = 1; k < Math.min(linhasNome.length, 4); k++) push(' '.repeat(pCol) + linhasNome[k]);

    // linha 2 — quantidade x valor unitario (grade do cupom fiscal)
    const linha2 = `${qtdFmt(it.quantidade)}${(it.unidade || 'UN').toUpperCase()} x ${unitFmt(it.valorUnitario)}`;
    push(' '.repeat(pCol) + linha2);

    // linha 3 — grade fiscal do A4 (NCM/CST/CFOP) em linha própria, nunca
    // quebrada no meio (o dono confere a carga por essas colunas)
    const fiscais = [
      it.ncm ? `NCM ${it.ncm}` : '',
      it.cst ? `CST ${it.cst}` : '',
      it.cfop ? `CFOP ${it.cfop}` : '',
    ].filter(Boolean).join('  ');
    if (fiscais) push(' '.repeat(pCol) + fiscais);
  });

  // ============================================================
  // CALCULO DO IMPOSTO (A4) — vBC/vICMS/vBCST/vST quando > 0
  // ============================================================
  const temImposto = (d.baseIcms || 0) > 0 || (d.valorIcms || 0) > 0 || (d.baseIcmsSt || 0) > 0 || (d.valorIcmsSt || 0) > 0;
  if (temImposto) {
    push(LINHA);
    push('CALCULO DO IMPOSTO');
    if ((d.baseIcms || 0) > 0 || (d.valorIcms || 0) > 0) dots('BASE DE CALCULO / VALOR ICMS', `${money(d.baseIcms || 0)} / ${money(d.valorIcms || 0)}`);
    if ((d.baseIcmsSt || 0) > 0 || (d.valorIcmsSt || 0) > 0) dots('BASE/VALOR ICMS ST', `${money(d.baseIcmsSt || 0)} / ${money(d.valorIcmsSt || 0)}`);
  }

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
  // REGRA DO DONO (tarefa fiscal): NFe/NFC SEMPRE mostram forma de pagamento
  // ============================================================
  push(LINHA);
  push('FORMA DE PAGAMENTO / VALOR');
  for (const pg of d.pagamentos || []) dots(pg.forma, money(pg.valor));
  if ((d.troco || 0) > 0) dots('TROCO', money(d.troco));
  if (!d.pagamentos?.length && (d.troco || 0) <= 0) push('(pagamento nao informado no XML)');

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
    push('PROTOCOLO DE AUTORIZACAO DE USO:');
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
  if (d.simplesNacional && !d.informacoes?.toUpperCase().includes('SIMPLES NACIONAL')) {
    push(LINHA);
    // BLOCO 137 (regra do dono): SEM a frase "nao gera direito a credito
    // fiscal" — a letra seca da lei assusta o consumidor de balcão. Fica
    // só o aviso do regime (Lei 123/2006).
    for (const l of wrap('Documento emitido por ME ou EPP optante pelo Simples Nacional.')) push(l);
  }

  push(LINHA);
  return L.join('\n');
}
