import { formaPagamentoDeSale } from './cupomTexto';

/**
 * BLOCO 82: MINI DANFE 80mm (DANFE simplificado) + COMPROVANTE DE BOLETO
 * para a impressora termica ESC/POS (48 colunas).
 *
 * - DANFE simplificado NFC-e (modelo 65): chave + QR de consulta — formato
 *   previsto pela SEFAZ para venda ao consumidor (campo/rua).
 * - DANFE simplificado NF-e (modelo 55): chave com codigo de barras CODE128 —
 *   usado em venda ambulante/entrega posterior.
 * - Comprovante de boleto: linha digitavel + codigo de barras + QR do PIX
 *   (o boleto OFICIAL continua sendo o PDF do Inter p/ WhatsApp; este e o
 *   comprovante na mao do cliente na rua).
 *
 * Os codigos de barras e QR entram como marcadores no texto:
 *   [[QR:conteudo]]       -> QR Code ESC/POS
 *   [[BARCODE:conteudo]]  -> CODE128 ESC/POS
 * O bluetoothPrinterService.ts interpreta os marcadores ao montar o buffer.
 */

const COLS = 48; // papel 80mm

// ---------------------------------------------------------------------------
// Helpers de formatacao
// ---------------------------------------------------------------------------
const pR = (s: string, n: number) => s.substring(0, n).padEnd(n);
const pL = (s: string, n: number) => s.substring(0, n).padStart(n);
const ctr = (s: string, n = COLS) => { const x = s.substring(0, n); const sp = Math.max(0, Math.floor((n - x.length) / 2)); return ' '.repeat(sp) + x; };
const LINHA = '-'.repeat(COLS);

const fmtMoney = (v: number) => 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(v) ? v : 0);

const dataBR = (d?: Date | string) => {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
};
const dataHoraBR = (d?: Date | string) => {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} ${dt.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false })}`;
};

export const mascaraCnpjCpf = (v?: string | null): string => {
  const d = (v || '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v || '';
};

// ---------------------------------------------------------------------------
// Chave de acesso (44 digitos) — numero/serie/modeledoc derivam dela
// ---------------------------------------------------------------------------
export interface ChaveInfo {
  uf: string;     // 2  — codigo IBGE da UF emitente (43 = RS)
  aamm: string;   // 4  — ano/mes da emissao
  cnpj: string;   // 14 — CNPJ do emitente
  mod: string;    // 2  — modelo (55 NF-e / 65 NFC-e)
  serie: string;  // 3
  numero: string; // 9
  tpEmis: string; // 1
  cNF: string;    // 8
  dv: string;     // 1
}

export function extrairDaChave(chave: string): ChaveInfo | null {
  const s = (chave || '').replace(/\D/g, '');
  if (s.length !== 44) return null;
  return {
    uf: s.slice(0, 2),
    aamm: s.slice(2, 6),
    cnpj: s.slice(6, 20),
    mod: s.slice(20, 22),
    serie: s.slice(22, 25),
    numero: s.slice(25, 34),
    tpEmis: s.slice(34, 35),
    cNF: s.slice(35, 43),
    dv: s.slice(43, 44),
  };
}

/** "000123456" -> "000.123.456" (formato do numero no DANFE) */
const mascaraNumeroNota = (n9?: string) => {
  if (!n9 || n9.length !== 9) return n9 || '';
  return `${n9.slice(0, 3)}.${n9.slice(3, 6)}.${n9.slice(6)}`;
};

/** Chave em grupos de 4, quebrada em 2 linhas (11 grupos = 6+5) para caber
 *  nas 48 colunas do papel 80mm sem depender do wrap da impressora */
export const chaveAgrupada = (chave: string): string => {
  const grupos = (chave || '').replace(/\D/g, '').replace(/(\d{4})(?=\d)/g, '$1 ').trim().split(' ');
  if (grupos.length <= 6) return grupos.join(' ');
  return [grupos.slice(0, 6).join(' '), grupos.slice(6).join(' ')].join('\n');
};

/** URL de consulta NFC-e (SEFAZ-RS) codificada no QR — padrao usado quando
 *  a Focus nao devolve o qr_code pronto. */
export function montarQrNfce(chave: string): string {
  return `https://www.sefaz.rs.gov.br/NFCE/NFCE-COM.aspx?p=${(chave || '').replace(/\D/g, '')}`;
}

// ---------------------------------------------------------------------------
// MINI DANFE (80mm)
// ---------------------------------------------------------------------------
export interface DanfeEmitente { nome?: string; cnpj?: string; ie?: string; endereco?: string; }

export interface DanfeMiniInput {
  tipo?: 'NFE' | 'NFCE';              // derivado da chave quando ausente (55/65)
  chave: string;                       // 44 digitos — OBRIGATORIO
  numero?: string;
  serie?: string;
  protocolo?: string;
  dataAutorizacao?: string;
  emitente?: DanfeEmitente;
  qrCode?: string;                     // QR pronto (consulta) — senao monta a URL RS
  dataVenda?: Date | string;
  cliente?: { nome?: string; doc?: string };
  itens: { descricao: string; quantidade: number; valorUnitario: number }[];
  valorTotal: number;
  metodoPagamento?: string;
  detalhePagamento?: string;
  statusPagamento?: string;
  dataVencimento?: Date | string;
  entregaStatus?: string;
  tipoVenda?: string;
}

export function danfeMiniTexto(o: DanfeMiniInput): string {
  const chave = (o.chave || '').replace(/\D/g, '');
  const info = extrairDaChave(chave);
  const modelo = info?.mod === '65' ? 'NFCE' : info?.mod === '55' ? 'NFE' : (o.tipo || 'NFE');
  const isNfce = modelo === 'NFCE';

  const numero = info?.numero || (o.numero || '').replace(/\D/g, '');
  const serie = info?.serie || (o.serie || '').replace(/\D/g, '');
  const emitCnpj = (o.emitente?.cnpj || info?.cnpj || '').replace(/\D/g, '');

  const L: string[] = [];
  const push = (s: string) => L.push(s.substring(0, 200));

  // ---- Cabecalho ----
  push('*'.repeat(COLS));
  push(ctr(isNfce ? 'DANFE - DOCUMENTO AUXILIAR' : 'DANFE SIMPLIFICADO'));
  push(ctr(isNfce ? 'DA NOTA FISCAL DE CONSUMIDOR ELETRONICA' : 'DA NOTA FISCAL ELETRONICA'));
  push('*'.repeat(COLS));
  push(ctr(`No ${mascaraNumeroNota(numero)}${serie ? ` - SERIE ${serie}` : ''}`));
  const emissao = dataHoraBR(o.dataVenda);
  if (emissao) push(ctr(`EMISSAO: ${emissao}`));

  // ---- Emitente ----
  const emitNome = (o.emitente?.nome || '').trim();
  if (emitNome) { push(''); push(pR(emitNome, COLS)); }
  if (emitCnpj) push(`CNPJ: ${mascaraCnpjCpf(emitCnpj)}`);
  const emitIe = (o.emitente?.ie || '').trim();
  if (emitIe) push(`IE: ${emitIe}`);
  const emitEnd = (o.emitente?.endereco || '').trim();
  if (emitEnd) push(pR(emitEnd, COLS));

  // ---- Destinatario ----
  const cliNome = (o.cliente?.nome || '').trim();
  const cliDoc = (o.cliente?.doc || '').replace(/\D/g, '');
  if (cliNome || cliDoc) {
    push(LINHA);
    if (cliNome) push(`DESTINATARIO: ${cliNome}`);
    if (cliDoc) push(`CPF/CNPJ: ${mascaraCnpjCpf(cliDoc)}`);
  }

  // ---- Itens ----
  push(LINHA);
  const dW = COLS - 15;
  push(pR('DESCRICAO', dW) + pL('QTD', 5) + pL('UNIT', 10));
  for (const it of o.itens || []) {
    const nome = (it.descricao || 'ITEM').toUpperCase();
    const q = (Number(it.quantidade) || 0).toString();
    const u = fmtMoney(it.valorUnitario);
    // nome quebra em ate 3 linhas de 48 (empurra colunas pra linha seguinte)
    const linhasNome = nome.match(/.{1,48}(\s|$)/g) || [nome];
    push(pR(linhasNome[0].trim(), dW) + pL(q, 5) + pL(u, 10));
    for (let k = 1; k < Math.min(linhasNome.length, 3); k++) push(pR(linhasNome[k].trim(), COLS));
  }
  push(LINHA);

  // ---- Totais / pagamento ----
  push(`TOTAL: ${fmtMoney(o.valorTotal)}`);
  const pg = formaPagamentoDeSale({
    metodoPagamento: o.metodoPagamento,
    detalhePagamento: o.detalhePagamento,
    statusPagamento: o.statusPagamento,
    tipoVenda: o.tipoVenda,
    entregaStatus: o.entregaStatus,
  } as any);
  let pgTxt = `PAGAMENTO: ${pg.forma} (${pg.condicao}`;
  if (pg.condicao === 'A PRAZO' && o.dataVencimento) pgTxt += ` VENC ${dataBR(o.dataVencimento)}`;
  pgTxt += ')';
  push(pgTxt.length > COLS ? pgTxt.replace(' (', '\n(') : pgTxt);

  // ---- Chave + barcode + QR ----
  push(LINHA);
  push('CHAVE DE ACESSO');
  push(chaveAgrupada(chave));
  push(`[[BARCODE:${chave}]]`);
  if (isNfce) push(`[[QR:${(o.qrCode && /^https?:/i.test(o.qrCode) ? o.qrCode : montarQrNfce(chave))}]]`);
  push(LINHA);
  push(ctr(isNfce ? 'Consulte pela Chave de Acesso' : 'Consulte pela Chave de Acesso'));
  push(ctr(isNfce ? 'no site da SEFAZ-RS' : 'no portal nacional da NF-e'));
  const prot = (o.protocolo || '').trim();
  if (prot) push(`PROTOCOLO DE AUTORIZACAO: ${prot}`);
  const aut = dataHoraBR(o.dataAutorizacao);
  if (aut) push(`AUTORIZADO EM: ${aut}`);
  push('');
  push(ctr('* DOCUMENTO AUXILIAR DA NOTA *'));
  push('');

  return L.join('\n');
}

// ---------------------------------------------------------------------------
// COMPROVANTE DE BOLETO (80mm) — linha digitavel + barcode + QR PIX
// ---------------------------------------------------------------------------
export interface BoletoComprovanteInput {
  empresaNome?: string;
  vendaRef?: string;
  pagadorNome?: string;
  pagadorDoc?: string;
  valor?: number | null;
  vencimento?: string;      // YYYY-MM-DD ou DD/MM/YYYY
  status?: string;
  linhaDigitavel?: string;
  codigoBarras?: string;
  pixCopiaECola?: string;
}

const vencBR = (v?: string) => {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [a, m, d] = v.slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  }
  return v;
};

const STATUS_LABEL: Record<string, string> = {
  A_RECEBER: 'A RECEBER',
  RECEBIDO: 'PAGO',
  MARCADO_RECEBIDO: 'PAGO',
  ATRASADO: 'ATRASADO',
  EM_PROCESSAMENTO: 'EM PROCESSAMENTO',
};

export function comprovanteBoletoTexto(o: BoletoComprovanteInput): string {
  const L: string[] = [];
  const push = (s: string) => L.push(s.substring(0, 200));

  push('*'.repeat(COLS));
  push(ctr('COMPROVANTE - BOLETO + PIX'));
  push('*'.repeat(COLS));
  const emp = (o.empresaNome || 'DOCE MANIA DISTRIBUIDORA').toUpperCase();
  push(pR(emp, COLS));
  if (o.vendaRef) push(`Venda: ${o.vendaRef}`);

  const pagNome = (o.pagadorNome || '').trim();
  const pagDoc = (o.pagadorDoc || '').replace(/\D/g, '');
  if (pagNome) push(`Pagador: ${pagNome}`);
  if (pagDoc) push(`CPF/CNPJ: ${mascaraCnpjCpf(pagDoc)}`);

  push('');
  if (o.valor !== null && o.valor !== undefined) push(`VALOR: ${fmtMoney(Number(o.valor))}`);
  if (o.vencimento) push(`VENCIMENTO: ${vencBR(o.vencimento)}`);
  if (o.status) push(`SITUACAO: ${STATUS_LABEL[o.status] || o.status}`);
  push(LINHA);

  if (o.linhaDigitavel) {
    push('LINHA DIGITAVEL');
    // quebra a linha digitavel em blocos legiveis (12 chars por linha)
    const limpa = o.linhaDigitavel.replace(/[^0-9]/g, '');
    const fmt = limpa.length >= 47
      ? limpa.replace(/^(\d{5})(\d{5})(\d{5})(\d{6})(\d{5})(\d{6})(\d{1})(\d{14})$/, '$1.$2 $3.$4 $5.$6 $7 $8')
      : limpa.replace(/(\d{5})(?=\d)/g, '$1 ').trim();
    push(fmt);
  }
  const barras = (o.codigoBarras || o.linhaDigitavel || '').replace(/[^0-9]/g, '');
  if (barras.length >= 36) push(`[[BARCODE:${barras}]]`);

  if (o.pixCopiaECola) {
    push(LINHA);
    push(ctr('PIX - ESCANEIE O QR CODE'));
    push(`[[QR:${o.pixCopiaECola}]]`);
    push('PIX COPIA E COLA:');
    push(o.pixCopiaECola);
  }

  push(LINHA);
  push(ctr('Pague tambem pelo codigo de barras ou'));
  push(ctr('linha digitavel em qualquer banco'));
  push('');
  return L.join('\n');
}
