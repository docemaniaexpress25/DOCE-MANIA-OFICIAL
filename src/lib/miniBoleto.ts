import { mascaraCnpjCpf } from './danfeTexto';

/**
 * MINI BOLETO 80mm PAISAGEM (DEITADO) — modelo oficial do Banco Inter.
 *
 * O dono mandou analisar o PDF A4 do boleto do Inter (Boleto Pix) e criar o
 * melhor layout possivel para a termica 80mm: "boleto mini no 80mm paisagem
 * deitado". No rolo termico isso significa que o boleto e DESENHADO deitado:
 * a ALTURA do boleto (76mm) ocupa a largura do papel e o COMPRIMENTO do boleto
 * corre no rolo — o papel sai e o cliente vira a folha para ler, igual uma
 * folha A4 em modo paisagem.
 *
 * SECOES copiadas do PDF A4 do Inter (ordem de cima pra baixo do boleto):
 *   1. faixa superior   — "Boleto Pix" + VALOR em destaque + quem recebe
 *   2. bloco Pix        — QR CODE do PIX + "Pague sua cobranca via Pix..."
 *   3. beneficiario     — CNPJ/razao + endereco do beneficiario
 *   4. pagador          — nome + endereco + CPF/CNPJ + VENCIMENTO + VALOR
 *   5. ficha compensacao— linha digitavel GRANDE (legivel de 3 passos)
 *                          + N do documento + data + nosso numero
 *   6. rodape           — CODIGO DE BARRAS (ITF, 44/47 digitos) + mensagem
 *                          "PAGAVEL EM QUALQUER BANCO" + obs da venda/NF
 *
 * TECNICA: canvas Canvas 2D (sem dependencias externas) em 8 dots/mm (203dpi
 * termica). O canvas paisagem e gerado por desenharMiniBoletoPaisagem(); para
 * IMPRIMIR, rotacionar90() vira o quadro (72mm x comprimento) que o
 * bluetoothPrinterService.printImage() manda como raster GS v 0, e o canal
 * USB (usbPrint.imprimirImagemViaUsb) imprime a MESMA imagem — os dois canais
 * saem identicos.
 *
 * GRADE CALIBRADA (576 dots = 72mm de altura util, nada pode colidir):
 *   faixa 1  topo            y 0    a 46   (titulo + valor)
 *   faixa 2  pix+partes      y 46   a 266  (QR 190 + textos dinamicos)
 *   faixa 3  caixas          y 266  a 360  (venc/valor/doc/data/agencia)
 *   faixa 4  linha digitavel y 360  a 428  (uma linha, mono 34px)
 *   faixa 5  codigo barras   y 428  a 542  (ITF 110px + nosso numero)
 *   faixa 6  rodape          y 542  a 576  (obs venda/NF)
 */

// Largura "util" do papel 80mm: 576 dots (72mm @ 8 dots/mm, margem de 2mm).
export const ALTURA_PX = 576;

export interface MiniBoletoData {
  beneficiario: { nome: string; cnpj: string; endereco?: string; cidadeUf?: string };
  pagador: { nome: string; doc?: string; endereco?: string; cidadeUf?: string; cep?: string };
  valor: number;
  vencimento: string;        // YYYY-MM-DD
  dataDocumento?: string;    // YYYY-MM-DD (data da emissao do boleto)
  numeroDocumento?: string;  // seuNumero (ex.: DME70F55D68-r3)
  nossoNumero?: string;      // ex.: 00019/112/9092732425-4
  agenciaCodigo?: string;    // ex.: 00019/485108020
  linhaDigitavel?: string;
  codigoBarras?: string;     // 44-48 digitos (ITF real do banco)
  pixCopiaECola?: string;
  mensagem1?: string;        // "Venda E70F55D6 - Doce Mania"
  mensagem2?: string;        // "NF-e 153"
  mensagem3?: string;        // "Data Limite para pagamento: 22/12/2026"
}

// ---------------------------------------------------------------------------
// Formatacao
// ---------------------------------------------------------------------------
export const money = (v: number): string =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(v) ? v : 0);

export const dataBR = (iso?: string): string => {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const [a, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  }
  return iso;
};

// ---------------------------------------------------------------------------
// ITF (Interleaved 2 of 5) — codigo de barras REAL do boleto FEBRABAN.
// Desenhado barra a barra no canvas (o comprovante antigo usava CODE128 com
// a linha digitavel, que o leitor de banco NAO reconhece — o boleto do
// Inter manda o codigoBarras de 44/47 digitos e este e o correto).
// ---------------------------------------------------------------------------
const ITF_DIGITOS = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];

/** Devolve a largura ocupada pelo ITF (para dimensionar a caixa antes). */
export function itfLargura(digitos: number, estreito = 3, largo = 7): number {
  if (digitos < 2) return 0;
  const pares = Math.floor(digitos / 2);
  const corpo = pares * (3 * estreito + 3 * estreito + 2 * largo + 2 * largo);
  return 2 * estreito + corpo + largo + estreito + estreito + 40;
}

/** Desenha o codigo de barras ITF a partir de x,y (altura em dots). */
function desenharItf(ctx: CanvasRenderingContext2D, codigo: string, x: number, y: number, alturaPx: number, estreito = 3, largo = 7): number {
  let dig = (codigo || '').replace(/\D/g, '');
  if (dig.length < 2) return x;
  if (dig.length % 2 !== 0) dig = '0' + dig;
  let cx = x + 20; // margem de silencio
  // START: barra n + lacuna n
  for (const p of [1, 0, 1, 0]) {
    const w = estreito;
    if (p) ctx.fillRect(cx, y, w, alturaPx);
    cx += w;
  }
  for (let i = 0; i < dig.length; i += 2) {
    const a = ITF_DIGITOS[Number(dig[i])];
    const b = ITF_DIGITOS[Number(dig[i + 1])];
    for (let k = 0; k < 5; k++) {
      // barra (dígito A) — largura conforme padrao
      const wa = a[k] === 'w' ? largo : estreito;
      ctx.fillRect(cx, y, wa, alturaPx);
      cx += wa;
      // lacuna (dígito B)
      const wb = b[k] === 'w' ? largo : estreito;
      cx += wb;
    }
  }
  // STOP: barra w + lacuna n + barra n
  ctx.fillRect(cx, y, largo, alturaPx); cx += largo;
  cx += estreito;
  ctx.fillRect(cx, y, estreito, alturaPx); cx += estreito;
  return cx + 20;
}

// ---------------------------------------------------------------------------
// Helpers de desenho (canvas em dots de termica)
// ---------------------------------------------------------------------------
type C2d = CanvasRenderingContext2D;

const FONT_REG = "'Helvetica Neue', Arial, sans-serif";
const FONT_MONO = "'Courier New', monospace";

class Paleta {
  ctx: C2d;
  W: number;
  M = 24;              // margem lateral
  cor = '#000';
  constructor(ctx: C2d, largura: number) {
    this.ctx = ctx; this.W = largura;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, largura, 1); // base
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
  }
  get Wt() { return this.W - 2 * this.M; }
  /** Texto com truncamento (elipse) — nunca estoura a coluna. */
  txt(s: string, x: number, y: number, maxW: number, size: number, bold = false, mono = false): string {
    const ctx = this.ctx;
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${mono ? FONT_MONO : FONT_REG}`;
    let t = String(s ?? '');
    if (ctx.measureText(t).width > maxW) {
      while (t.length > 1 && ctx.measureText(t + '...').width > maxW) t = t.slice(0, -1);
      t += '...';
    }
    ctx.fillText(t, x, y);
    return t;
  }
  txtDir(s: string, xDir: number, y: number, maxW: number, size: number, bold = false, mono = false): string {
    const ctx = this.ctx;
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${mono ? FONT_MONO : FONT_REG}`;
    let t = String(s ?? '');
    if (ctx.measureText(t).width > maxW) {
      while (t.length > 1 && ctx.measureText(t + '...').width > maxW) t = t.slice(0, -1);
      t += '...';
    }
    const w = ctx.measureText(t).width;
    ctx.fillText(t, xDir - w, y);
    return t;
  }
  /** Rotulo pequeno em cima (estilo boleto: cabecalho de campo) + valor. */
  campo(rotulo: string, valor: string, x: number, y: number, maxW: number, sizeValor = 22, boldValor = true) {
    this.txt(rotulo.toUpperCase(), x, y, maxW, 13, false);
    if (valor) this.txt(valor, x, y + sizeValor + 6, maxW, sizeValor, boldValor);
  }
  caixa(x: number, y: number, w: number, h: number) {
    this.ctx.strokeRect(x, y, w, h);
  }
  linha(y: number) {
    this.ctx.beginPath();
    this.ctx.moveTo(this.M, y);
    this.ctx.lineTo(this.W - this.M, y);
    this.ctx.stroke();
  }
  linhaPontilhada(y: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash([14, 10]);
    ctx.beginPath();
    ctx.moveTo(this.M, y);
    ctx.lineTo(this.W - this.M, y);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * DESENHA o mini boleto PAISAGEM (canvas de largura variavel x 576 dots).
 * O resultado e o boleto "em pe" — para imprimir use rotacionar90().
 */
export async function desenharMiniBoletoPaisagem(d: MiniBoletoData): Promise<HTMLCanvasElement> {
  const largura = 1560; // ~195mm de comprimento no rolo (papel paisagem)
  const c = document.createElement('canvas');
  c.width = largura;
  c.height = ALTURA_PX;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponivel neste navegador.');
  ctx.textBaseline = 'alphabetic';

  const P = new Paleta(ctx, largura);
  const M = P.M;
  const Wt = P.Wt; // largura util
  const digitadosFmt = formatarLinhaDigitavel(d.linhaDigitavel || '');
  const barras = (d.codigoBarras || '').replace(/\D/g, '');

  // =================== FAIXA 1 — topo: Boleto Pix + valor ===================
  let y = 38;
  P.txt('DOCE MANIA', M, y, 320, 30, true);
  P.txt('Boleto Pix', M + 330, y, 300, 34, true);
  P.txtDir(`R$ ${money(d.valor)}`, M + 860, y + 2, 360, 38, true);
  P.txtDir('Quem vai receber:', largura - M, y - 18, 330, 15, false);
  P.txtDir(d.beneficiario.nome, largura - M, y + 8, 330, 17, true);
  y += 20;
  P.linhaPontilhada(y);

  // =================== FAIXA 2 — QR Pix + beneficiario + pagador ============
  // grade:  y+20 = QR começa (190 dots) | textos ao lado | pagador à direita
  const qrTop = y + 26;
  const qrSize = 190;
  if (d.pixCopiaECola) {
    try {
      const { default: QRCode } = await import('qrcode');
      const qrUrl = await QRCode.toDataURL(d.pixCopiaECola.slice(0, 900), { margin: 0, errorCorrectionLevel: 'M', width: qrSize * 2 });
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('QR')); img.src = qrUrl; });
      ctx.drawImage(img, M, qrTop, qrSize, qrSize);
    } catch { /* QR falhou — bloco segue com o copia-e-cola em texto */ }
  }
  const xPix = M + qrSize + 30;
  const wPix = 480;
  let ty = qrTop + 22;
  P.txt('PIX — RECEBIMENTO INSTANTANEO', xPix, ty, wPix, 20, true);
  ty += 28;
  P.txt('Pague sua cobranca via Pix escaneando o QR', xPix, ty, wPix, 16, false);
  ty += 22;
  P.txt('no app do seu banco.', xPix, ty, wPix, 16, false);
  ty += 34;
  P.campo('Beneficiario', `${mascaraCnpjCpf(d.beneficiario.cnpj)} - ${d.beneficiario.nome}`, xPix, ty, wPix, 17);
  ty += 52;
  if (d.beneficiario.endereco) {
    P.txt(d.beneficiario.endereco, xPix, ty, wPix, 14, false);
    ty += 22;
  }
  if (d.beneficiario.cidadeUf) {
    P.txt(d.beneficiario.cidadeUf, xPix, ty, wPix, 14, false);
    ty += 22;
  }

  // coluna direita: pagador (alinhado com o topo do bloco Pix)
  const xPag = M + 900;
  const wPag = Wt - (xPag - M);
  P.campo('Pagador', d.pagador.nome, xPag, qrTop + 22, wPag, 20);
  let pgy = qrTop + 74;
  if (d.pagador.doc) { P.txt(`CPF/CNPJ: ${mascaraCnpjCpf(d.pagador.doc)}`, xPag, pgy, wPag, 15, false); pgy += 26; }
  const endPag = [d.pagador.endereco, d.pagador.cidadeUf].filter(Boolean).join(' - ');
  if (endPag) { P.txt(endPag, xPag, pgy, wPag, 14, false); pgy += 26; }

  y = qrTop + qrSize + 22;
  P.linhaPontilhada(y);

  // =================== FAIXA 3 — caixas: vencimento / valor / doc ===========
  y += 26;
  const h3 = 84;
  const col3 = [
    { rot: 'Vencimento', val: dataBR(d.vencimento), w: 210 },
    { rot: 'Valor do Documento', val: money(d.valor), w: 230 },
    { rot: 'N do Documento', val: d.numeroDocumento || d.nossoNumero || '', w: 350 },
    { rot: 'Data do Documento', val: dataBR(d.dataDocumento || d.vencimento), w: 220 },
    { rot: 'Agencia / Codigo Benef.', val: d.agenciaCodigo || '', w: Wt - (210 + 230 + 350 + 220) },
  ];
  let cx = M;
  for (const c3 of col3) {
    P.caixa(cx, y, c3.w, h3);
    P.campo(c3.rot, c3.val, cx + 14, y + 30, c3.w - 24, 21, true);
    cx += c3.w;
  }
  y += h3 + 22;

  // =================== FAIXA 4 — LINHA DIGITAVEL GRANDE =====================
  P.txt('LOCAL DE PAGAMENTO: PAGAVEL EM QUALQUER BANCO ATE O VENCIMENTO', M, y + 14, Wt, 14, true);
  y += 30;
  // Linha digitavel UMA linha (47 digitos em mono 30px = ~850 dots, cabe)
  if (digitadosFmt) {
    ctx.font = `bold 34px ${FONT_MONO}`;
    P.txt(digitadosFmt, M, y + 30, Wt, 34, true, true);
    y += 44;
  } else {
    P.txt('(boleto ainda processando — linha digitavel sai apos consulta ao Inter)', M, y + 26, Wt, 17, false);
    y += 34;
  }
  y += 4;
  P.linha(y);
  y += 20;

  // =================== FAIXA 5 — CODIGO DE BARRAS ITF + nosso numero ========
  const alturaBarras = 100;
  const fimDaFaixa = y + alturaBarras + 16;
  const xNN = M + Wt - 330;
  if (barras.length >= 36) {
    const wItf = itfLargura(barras.length);
    // folga fixa a direita para o Nosso Numero nunca ser invadido pelas barras
    const escala = Math.min(1.6, (Wt - 420) / (wItf - 60));
    ctx.save();
    ctx.translate(M, y);
    ctx.scale(escala, 1);
    desenharItf(ctx, barras, 0, 0, alturaBarras, 3, 7);
    ctx.restore();
  } else {
    P.txt('Pague pelo PIX (QR acima) ou pela linha digitavel nos bancos', M, y + 50, Wt - 380, 18, true);
  }
  P.campo('Nosso Numero', d.nossoNumero || d.numeroDocumento || '', xNN, y + 30, 310, 17);
  P.txt('Autenticacao mecanica', xNN, y + 88, 310, 13, false);

  // =================== FAIXA 6 — rodape: obs da venda / NF ==================
  y = Math.max(fimDaFaixa, ALTURA_PX - 34);
  const obs = [d.mensagem1, d.mensagem2, d.mensagem3].filter(Boolean).join('   ·   ');
  if (obs) P.txt(obs, M, y, Wt - 40, 14, true);

  return c;
}

/** "07790.00116 12149.225794 09273.242546 1 16380000000720" -> mantem os pontos
 *  que o cliente lê (a reconstrucao numerica pura e mais dificil de conferir). */
export function formatarLinhaDigitavel(linha: string): string {
  const limpa = String(linha || '').replace(/\D/g, '');
  if (limpa.length < 36) return String(linha || '');
  if (limpa.length >= 47) {
    // formato FEBRABAN: XXXXX.XXXXX XXXXX.XXXXXX XXXXX.XXXXXX X XXXXXXXXXXXXXX
    return limpa.replace(/^(\d{5})(\d{5})(\d{5})(\d{6})(\d{5})(\d{6})(\d{1})(\d{6})(\d{8})$/,
      '$1.$2 $3.$4 $5.$6 $7 $8$9');
  }
  return limpa.replace(/(\d{5})(?=\d)/g, '$1 ').trim();
}

/**
 * ROTACIONA -90° (padrao paisagem de Windows): o boleto paisagem vira uma
 * imagem de 576 x comprimento. No papel deitado o TOPO do documento fica na
 * borda ESQUERDA do rolo — o cliente gira a folha no sentido HORARIO para
 * ler, exatamente como uma folha A4 impressa em modo paisagem.
 * Mapa: (x_doc, y_doc) -> (y_doc, L - x_doc): borda esquerda do documento =
 * topo do papel; primeira coluna do documento = fim do rolo (imprime por
 * ultimo, igual qualquer impressao paisagem).
 */
export function rotacionar90(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.height;  // 576  (largura do rolo)
  out.height = src.width;  // comprimento do boleto no rolo
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponivel neste navegador.');
  ctx.translate(0, src.width);
  ctx.rotate(-Math.PI / 2);
  ctx.drawImage(src, 0, 0);
  return out;
}

/** Canvas -> PNG data URL (para printImage do Bluetooth e imprimirImagemViaUsb). */
export function canvasParaPng(c: HTMLCanvasElement): string {
  return c.toDataURL('image/png');
}

// ---------------------------------------------------------------------------
// DEMO — dados EXATOS do PDF A4 anexado pelo dono (NF-e 139 + boleto 153),
// usados no botao "Ver modelos de impressao 80mm" das Configuracoes.
// ---------------------------------------------------------------------------
export const DEMO_BOLETO: MiniBoletoData = {
  beneficiario: {
    nome: 'DOCE MANIA EXPRESS LTDA',
    cnpj: '63720443000177',
    endereco: 'RUA DOS MIMODEVENUS 185, 95012-400',
    cidadeUf: 'CAXIAS DO SUL - RS',
  },
  pagador: {
    nome: 'GIRARDI SUL ATACADO LTDA',
    doc: '69857331000149',
    endereco: 'RUA MAJOR ALIPIO PORTO 400 - MAUA',
    cidadeUf: '95214-453 VACARIA/RS',
  },
  valor: 7.2,
  vencimento: '2026-11-22',
  dataDocumento: '2026-11-15',
  numeroDocumento: 'DME70F55D68-r3',
  nossoNumero: '00019/112/9092732425-4',
  agenciaCodigo: '00019/485108020',
  linhaDigitavel: '07790001161214922579409273242546116380000000720',
  codigoBarras: '07790001161214922579409273242546116380000000720',
  pixCopiaECola: '00020126580014BR.GOV.BCB.PIX0136123e4567-e12b-c3d4-a456-4266554400005204000053039865802BR5909INTER6009SAO PAULO62070503***6304ABCD',
  mensagem1: 'Venda E70F55D6 - Doce Mania',
  mensagem2: 'NF-e 153',
  mensagem3: 'Data Limite para pagamento: 22/12/2026',
};
