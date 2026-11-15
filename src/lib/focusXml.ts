/**
 * BLOCO 131 — PARSER DO XML AUTORIZADO DA NOTA (procNFe)
 *
 * O cupom fiscal 80mm do app (danfeFiscal80) precisa ser FIEL ao documento
 * autorizado pela SEFAZ — não pode ser "montado por fora" com dados da venda.
 * A fonte da verdade e o XML da nota (que a Focus NFe devolve em
 * caminho_xml_nota_fiscal apos a autorizacao — NF-e modelo 55 e NFC-e modelo
 * 65 usam o MESMO schema procNFe).
 *
 * Daqui saem, ja prontos para o cupom:
 *  - emitente com endereco completo (enderEmit) — o A4 da Focus mostra, o
 *    cupom tambem tem que mostrar;
 *  - itens (cProd/xProd/qCom/uCom/vUnCom/vProd/vDesc);
 *  - totais oficiais do ICMSTot (vProd/vDesc/vNF/vTotTrib);
 *  - formas de pagamento do bloco <pag> (tPag/vPag/vTroco);
 *  - o QR CODE OFICIAL de consulta (infNFeSupl/qrCode) — o mesmo que a
 *    fiscalizacao aponta a camera; o fallback antigo montava uma URL
 *    "chave-solo" que NAO consulta de verdade;
 *  - protocolo de autorizacao (nProt) + data/hora do recebimento (dhRecbto);
 *  - contingencia (ide/tpEmis = 9, NFC-e off-line).
 *
 * Parser por regex SEM dependencia externa: o XML e gerado pelo padrao
 * nacional (tags fixas), nunca e input hostil — e roda 1x por impressao.
 */

export interface FocusXmlEmitente {
  nome?: string;
  fantasia?: string;
  cnpj?: string;
  ie?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
}

export interface FocusXmlItem {
  codigo?: string;
  descricao?: string;
  quantidade: number;
  unidade?: string;
  valorUnitario: number;
  valorProduto: number;   // vProd (quantidade x valor unitario)
  valorDesconto: number;  // vDesc do proprio item
}

export interface FocusXmlPagamento {
  tPag?: string;
  valor: number;
}

export interface FocusXmlNota {
  modelo?: string;          // '55' | '65'
  numero?: string;          // nNF (9 digitos)
  serie?: string;
  dataEmissao?: string;     // dhEmi ISO com fuso
  tpEmis?: string;          // 1 = normal, 9 = contingencia off-line (NFC-e)
  natureza?: string;        // natOp
  emitente?: FocusXmlEmitente;
  destinatario?: { nome?: string; cpfCnpj?: string };
  itens?: FocusXmlItem[];
  totais?: {
    valorProdutos?: number;   // vProd
    valorDesconto?: number;   // vDesc
    valorTotal?: number;      // vNF
    valorTributos?: number;   // vTotTrib (Lei 12.741)
  };
  pagamentos?: FocusXmlPagamento[];
  troco?: number;
  qrCode?: string;          // infNFeSupl/qrCode (URL oficial de consulta)
  protocolo?: string;       // nProt
  dataAutorizacao?: string; // dhRecbto
  informacoes?: string;     // infAdic/infCpl (informacoes adicionais do emitente)
}

/** Tira o wrapper CDATA do conteudo de uma tag (o qrCode vem assim). */
const limpaCdata = (s: string): string =>
  s.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '').trim();

/** Primeiro conteudo da tag `nome` dentro de `base` (tolera atributos/ns). */
function tagInterna(base: string, nome: string): string | null {
  const m = base.match(new RegExp(`<${nome}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${nome}\\s*>`, 'i'));
  return m ? limpaCdata(m[1]) : null;
}

/** "3.6000" -> 3.6 (XML do padrao nacional usa ponto como decimal). */
const num = (s?: string | null): number => {
  const v = parseFloat(String(s || '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};

const tagNum = (base: string, nome: string): number => num(tagInterna(base, nome));

/** Extrai o emitente + enderEmit (endereco completo) do XML. */
function parseEmitente(xml: string): FocusXmlEmitente | undefined {
  const emit = tagInterna(xml, 'emit');
  if (!emit) return undefined;
  const ender = tagInterna(emit, 'enderEmit') || '';
  const e: FocusXmlEmitente = {
    nome: tagInterna(emit, 'xNome') || undefined,
    fantasia: tagInterna(emit, 'xFant') || undefined,
    cnpj: tagInterna(emit, 'CNPJ') || undefined,
    ie: tagInterna(emit, 'IE') || undefined,
    logradouro: tagInterna(ender, 'xLgr') || undefined,
    numero: tagInterna(ender, 'nro') || undefined,
    complemento: tagInterna(ender, 'xCpl') || undefined,
    bairro: tagInterna(ender, 'xBairro') || undefined,
    municipio: tagInterna(ender, 'xMun') || undefined,
    uf: tagInterna(ender, 'UF') || undefined,
    cep: tagInterna(ender, 'CEP') || undefined,
  };
  return e;
}

/** Itens do bloco <det nItem="n">...</det> (NF-e 55 e NFC-e 65 iguais). */
function parseItens(xml: string): FocusXmlItem[] {
  const dets = [...xml.matchAll(/<det\s[^>]*nItem\s*=\s*"(\d+)"[^>]*>([\s\S]*?)<\/det\s*>/gi)];
  const itens: FocusXmlItem[] = [];
  for (const d of dets) {
    const bloco = d[2];
    const prod = tagInterna(bloco, 'prod') || bloco;
    itens.push({
      codigo: tagInterna(prod, 'cProd') || undefined,
      descricao: tagInterna(prod, 'xProd') || undefined,
      quantidade: tagNum(prod, 'qCom'),
      unidade: tagInterna(prod, 'uCom') || undefined,
      valorUnitario: tagNum(prod, 'vUnCom'),
      valorProduto: tagNum(prod, 'vProd'),
      valorDesconto: tagNum(prod, 'vDesc'),
    });
  }
  return itens;
}

/** Pagamentos do bloco <pag><detPag><tPag>/<vPag> + <vTroco>. */
function parsePagamentos(xml: string): { pagamentos?: FocusXmlPagamento[]; troco?: number } {
  const pag = tagInterna(xml, 'pag') || '';
  const dets = [...pag.matchAll(/<detPag[^>]*>([\s\S]*?)<\/detPag\s*>/gi)];
  const pagamentos: FocusXmlPagamento[] = [];
  for (const d of dets) {
    const tPag = tagInterna(d[1], 'tPag') || undefined;
    const vPag = tagNum(d[1], 'vPag');
    if (tPag || vPag) pagamentos.push({ tPag, valor: vPag });
  }
  const trocoRaw = tagInterna(pag, 'vTroco');
  return {
    pagamentos: pagamentos.length ? pagamentos : undefined,
    troco: trocoRaw !== null && num(trocoRaw) > 0 ? num(trocoRaw) : undefined,
  };
}

/**
 * Parser principal. Devolve null se o conteudo nao for um procNFe valido
 * (ex.: pagina de erro da Focus) — o caller cai nos dados do app.
 */
export function parseFocusXml(xmlRaw: string): FocusXmlNota | null {
  const xml = String(xmlRaw || '');
  if (!/infNFe/i.test(xml)) return null;

  const ide = tagInterna(xml, 'ide');
  const out: FocusXmlNota = {
    modelo: ide ? tagInterna(ide, 'mod') || undefined : undefined,
    numero: ide ? tagInterna(ide, 'nNF') || undefined : undefined,
    serie: ide ? tagInterna(ide, 'serie') || undefined : undefined,
    dataEmissao: ide ? (tagInterna(ide, 'dhEmi') || tagInterna(ide, 'dEmi') || undefined) : undefined,
    tpEmis: ide ? tagInterna(ide, 'tpEmis') || undefined : undefined,
    natureza: ide ? tagInterna(ide, 'natOp') || undefined : undefined,
  };

  out.emitente = parseEmitente(xml);

  // Destinatario: NFC-e anonima NAO tem bloco <dest> (CONSUMIDOR NAO
  // IDENTIFICADO no cupom); quando existe, leva o documento do consumidor.
  const dest = tagInterna(xml, 'dest');
  if (dest) {
    const doc = tagInterna(dest, 'CPF') || tagInterna(dest, 'CNPJ') || undefined;
    out.destinatario = { nome: tagInterna(dest, 'xNome') || undefined, cpfCnpj: doc };
  }

  const itens = parseItens(xml);
  if (itens.length) out.itens = itens;

  const tot = tagInterna(xml, 'ICMSTot');
  if (tot) {
    out.totais = {
      valorProdutos: tagNum(tot, 'vProd') || undefined,
      valorDesconto: tagNum(tot, 'vDesc') || undefined,
      valorTotal: tagNum(tot, 'vNF') || undefined,
      valorTributos: tagNum(tot, 'vTotTrib') || undefined,
    };
  }

  const { pagamentos, troco } = parsePagamentos(xml);
  out.pagamentos = pagamentos;
  out.troco = troco;

  // QR oficial: primeiro dentro de infNFeSupl, depois solto (legado)
  const supl = tagInterna(xml, 'infNFeSupl');
  out.qrCode = (supl ? tagInterna(supl, 'qrCode') : null) || tagInterna(xml, 'qrCode') || undefined;

  const prot = tagInterna(xml, 'infProt');
  if (prot) {
    out.protocolo = tagInterna(prot, 'nProt') || undefined;
    out.dataAutorizacao = tagInterna(prot, 'dhRecbto') || undefined;
  }

  // Informacoes adicionais do contribuinte (o app grava "Venda XXXX...")
  const infAdic = tagInterna(xml, 'infAdic');
  const infCpl = infAdic ? tagInterna(infAdic, 'infCpl') : null;
  if (infCpl) out.informacoes = infCpl.replace(/\s+/g, ' ').trim();

  return out;
}
