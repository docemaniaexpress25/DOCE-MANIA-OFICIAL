import { code128Svg } from './code128';

/**
 * BLOCO 167 — MINI BOLETO 80mm (pedido do dono):
 * "Já temos uma mini danfe muito boa em questão de layout agora iremos
 *  trabalhar com layout do mini boleto, então busque um boleto no sistema que
 *  está em a4 e transforme em um mini boleto completo e com layout parecido
 *  com o da mini danfe."
 *
 * O "boleto A4" do sistema é o PDF ORIGINAL do Inter (bloco 152). Este
 * gerador transforma os MESMOS dados (linha digitável, código de barras 44
 * dígitos, PIX copia-e-cola, valor, vencimento, pagador) no papel térmico
 * 80mm com o MESMO padrão visual da MINI DANFE (danfe80Html.ts):
 *   - @page 70mm auto (cabe na área imprimível real ~70,5mm, bloco 163)
 *   - fonte monoespaçada de alta definição (Consolas + text-stroke 0.15px)
 *   - grade/caixas com traço 0.75–1.6px que não some na térmica 203dpi
 *   - Código de barras Code 128 em SVG (65.5mm x 12mm) + QR do PIX 28mm
 *   - .hint só na tela (escondida no papel) + escala 1.6 no preview
 *
 * O boleto OFICIAL continua sendo o PDF do Inter (enviado ao cliente) — este
 * papel é a cópia de conferência/trabalho na térmica, NÃO é documento fiscal.
 */

export interface MiniBoletoDados {
  beneficiarioNome?: string;   // empresa (default DOCE MANIA)
  beneficiarioDoc?: string;    // CNPJ da empresa
  pagadorNome?: string;        // cliente
  pagadorDoc?: string;         // CPF/CNPJ do cliente
  valor?: number | null;
  vencimento?: string;         // ISO YYYY-MM-DD (ou já dd/mm/yyyy)
  status?: string;             // status do boleto no Inter (A_RECEBER etc.)
  linhaDigitavel?: string;
  codigoBarras?: string;
  pixCopiaECola?: string;
  vendaRef?: string;           // referência curta da venda
  seuNumero?: string;          // DM<saleId> no Inter
}

/** ascii-safe (mesma ideia do danfe80Html) — térmica não imprime emoji/acentos raros */
const ascii = (s: string): string =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();

const esc = (s: string): string =>
  ascii(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** valor number -> "1.234,56" */
const valBR = (v?: number | null): string =>
  typeof v === 'number' && isFinite(v) && v > 0
    ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '--';

/** ISO YYYY-MM-DD -> dd/mm/yyyy (já-formatado passa direto) */
const dataBR = (v?: string): string => {
  const s = String(v || '').trim();
  if (!s) return '--/--/----';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [a, m, d] = s.slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  return s;
};

/** SITUAÇÃO legível do status do Inter */
const statusTxt = (s?: string): string => {
  const map: Record<string, string> = {
    A_RECEBER: 'A RECEBER (em aberto)',
    RECEBIDO: 'PAGO / RECEBIDO',
    MARCADO_RECEBIDO: 'PAGO / RECEBIDO',
    EM_PROCESSAMENTO: 'EM PROCESSAMENTO NO BANCO',
    ATRASADO: 'ATRASADO',
    PROTESTO: 'EM PROTESTO',
    CANCELADO: 'CANCELADO',
    EXPIRADO: 'EXPIRADO',
    FALHA_EMISSAO: 'FALHA NA EMISSAO',
    NAO_GERADO: 'NAO GERADO',
  };
  return map[String(s || '')] || String(s || '—').replace(/_/g, ' ');
};

/**
 * Linha digitável formatada. Se já tem pontuação, mantém; se são 47 dígitos
 * crus, aplica a máscara oficial XXXXX.XXXXX XXXXX.XXXXXX XXXXX.XXXXXX X
 * XXXXXXXXXXX; caso contrário agrupa de 5 em 5 (legível na térmica).
 */
function linhaFormatada(l?: string): string {
  const raw = String(l || '').trim();
  if (!raw) return '';
  const dig = raw.replace(/\D/g, '');
  if (/[^0-9]/.test(raw)) return raw; // já veio formatada do Inter
  if (dig.length === 47) {
    return `${dig.slice(0, 5)}.${dig.slice(5, 10)} ${dig.slice(10, 15)}.${dig.slice(15, 21)} ${dig.slice(21, 26)}.${dig.slice(26, 32)} ${dig.slice(32, 33)} ${dig.slice(33)}`;
  }
  return dig.replace(/(\d{5})(?=\d)/g, '$1 ').trim();
}

const docFmt = (d?: string): string => {
  const dig = String(d || '').replace(/\D/g, '');
  if (dig.length === 11) return dig.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (dig.length === 14) return dig.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return ascii(String(d || ''));
};

/** CSS do MINI BOLETO — mesmo padrão da MINI DANFE (bloco 163: 70mm). */
const CSS_BOLETO = `@page { size: 70mm auto; margin: 0; }
html, body { margin: 0; padding: 0; background: #ffffff; }
* { box-sizing: border-box; }
body { font-family: 'Consolas', 'Liberation Mono', 'DejaVu Sans Mono', 'Courier New', monospace; color: #000;
  background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  -webkit-text-stroke: 0.15px #000; text-rendering: optimizeLegibility; }
.poster { width: 70mm; background: #fff; }
.hint { display: none; }
@media screen {
  html { height: auto; display: flex; justify-content: center; background: #ffffff; }
  body { transform: scale(1.6); transform-origin: top center; margin: 12px 0; }
  .poster { box-shadow: 0 0 24px rgba(0,0,0,0.35); }
  .hint { display: block; background: #0f172a; color: #fff; font-family: Arial, sans-serif;
    font-size: 12px; line-height: 1.4; padding: 8px 10px; text-align: center; }
}
.poster { padding: 2mm 1.8mm 1.2mm 1.8mm; font-size: 8pt; line-height: 1.32; }
.row { display: flex; flex-wrap: wrap; justify-content: space-between; max-width: 100%; }
.hd { border: 1.2px solid #000; padding: 1mm 1.3mm; display: flex; justify-content: space-between; align-items: center; gap: 2mm; }
.hd .b1 { font-size: 9.5pt; font-weight: bold; }
.hd .b2 { font-size: 7pt; font-weight: bold; text-align: right; line-height: 1.3; }
.destaque { display: flex; border: 1.6px solid #000; margin-top: 1.4mm; }
.destaque > div { padding: 1.1mm 1.4mm; min-width: 0; }
.destaque .vlr { flex: 1 1 auto; border-right: 1.6px solid #000; }
.destaque .vlr b { font-size: 12.5pt; line-height: 1.15; display: block; }
.destaque .lbl { font-size: 7pt; font-weight: bold; }
.destaque .side { flex: 0 0 24mm; font-size: 7.4pt; }
.destaque .side b { display: block; font-size: 8.4pt; }
.bc-wrap { text-align: center; margin: 1.4mm 0 0 0; }
.bc-wrap svg { display: block; margin: 0 auto; max-width: 100%; }
.box { border: 1px solid #000; padding: 0.9mm 1.2mm; margin-top: 1.2mm; }
.box .lbl { font-size: 7.1pt; font-weight: bold; }
.box .val { font-size: 7.8pt; word-break: break-all; line-height: 1.35; }
.box .val.grande { font-size: 8.6pt; font-weight: bold; }
.box .nome { font-size: 8pt; font-weight: bold; word-break: break-word; }
.grid2 { display: flex; flex-wrap: wrap; max-width: 100%; margin-top: 1.2mm; }
.grid2 > div { flex: 1 1 0; min-width: 0; border: 1px solid #000; padding: 0.8mm 1.2mm; }
.grid2 > div + div { margin-left: -1px; }
.grid2 .lbl { font-size: 7.1pt; font-weight: bold; }
.grid2 .val { font-size: 7.8pt; font-weight: bold; word-break: break-all; }
.sit { border: 1.2px solid #000; padding: 1mm 1.2mm; margin-top: 1.2mm; font-size: 7.6pt; font-weight: bold; text-align: center; }
.aviso { font-size: 6.6pt; line-height: 1.45; margin-top: 1.2mm; text-align: left; }
.footer { text-align: center; font-size: 6.6pt; margin-top: 1.6mm; border-top: 0.3mm solid #000; padding-top: 1mm; }
.qr-wrap { text-align: center; margin: 1.4mm 0 0 0; }
.qr-wrap img { display: block; margin: 0 auto; width: 28mm; height: 28mm; }
.qr-wrap .qlbl { font-size: 7pt; font-weight: bold; margin-top: 0.6mm; }
.corte { border-top: 0.3mm dashed #000; margin-top: 1.5mm; padding-top: 1mm;
  text-align: center; font-size: 6.5pt; font-weight: bold; letter-spacing: 0.3px; }`;

/**
 * Gera o documento HTML completo do MINI BOLETO 80mm.
 * Async por causa do QR Code do PIX copia-e-cola (imagem data URL).
 */
export async function miniBoleto80Html(o: MiniBoletoDados): Promise<string> {
  const linha = linhaFormatada(o.linhaDigitavel);
  const barras = String(o.codigoBarras || '').replace(/\D/g, '');
  const pix = String(o.pixCopiaECola || '').trim();

  // Código de barras: 44 dígitos do Inter (Code 128-C nativo); fallback =
  // dígitos da linha digitável (47 → 128-B, legível igual).
  const barrasParaCodigo = barras || String(o.linhaDigitavel || '').replace(/\D/g, '');
  const bcHtml = barrasParaCodigo.length >= 30
    ? code128Svg(barrasParaCodigo, { larguraMm: 65.5, alturaMm: 12 })
    : '';

  // QR do PIX copia-e-cola
  let qrHtml = '';
  if (pix) {
    try {
      const QRCode = (await import('qrcode')).default;
      const url = await QRCode.toDataURL(pix, { margin: 1, errorCorrectionLevel: 'M', width: 320 });
      qrHtml = `<div class="qr-wrap"><img src="${url}" alt="QR do PIX copia-e-cola" /><div class="qlbl">PIX COPIA E COLA — pague pelo app do banco</div></div>`;
    } catch {
      qrHtml = '';
    }
  }

  const benefNome = esc(o.beneficiarioNome || 'DOCE MANIA');
  const benefDoc = docFmt(o.beneficiarioDoc);
  const pagNome = esc(o.pagadorNome || '—');
  const pagDoc = docFmt(o.pagadorDoc);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Mini Boleto 80mm</title>
<style>${CSS_BOLETO}</style>
</head>
<body>
<div class="hint">MINI BOLETO 80mm — imprima em 100% (sem ajuste de escala) na térmica.<br />O boleto OFICIAL do cliente continua sendo o PDF do Banco Inter.</div>
<div class="poster">

  <div class="hd">
    <div class="b1">MINI BOLETO<br /><span style="font-size:6.6pt;font-weight:normal">BANCO INTER (077) · COBRANCA</span></div>
    <div class="b2">DOCE MANIA<br /><span style="font-weight:normal">NAO E DOCUMENTO FISCAL</span></div>
  </div>

  <div class="destaque">
    <div class="vlr"><span class="lbl">VALOR DO DOCUMENTO</span><b>R$ ${valBR(o.valor)}</b></div>
    <div class="side"><span class="lbl">VENCIMENTO</span><b>${esc(dataBR(o.vencimento))}</b></div>
  </div>

  ${bcHtml ? `<div class="bc-wrap">${bcHtml}</div>` : ''}

  ${linha ? `<div class="box"><span class="lbl">LINHA DIGITAVEL</span><div class="val grande">${esc(linha)}</div></div>` : ''}

  ${qrHtml}
  ${pix && !qrHtml ? `<div class="box"><span class="lbl">PIX COPIA E COLA</span><div class="val">${esc(pix)}</div></div>` : ''}

  <div class="box"><span class="lbl">PAGADOR</span><div class="nome">${pagNome}${pagDoc ? ` — ${esc(pagDoc)}` : ''}</div></div>

  <div class="box"><span class="lbl">BENEFICIARIO</span><div class="nome">${benefNome}${benefDoc ? ` — ${esc(benefDoc)}` : ''}</div><div class="val">Cobranca registrada via Banco Inter (API Cobranca V3)</div></div>

  <div class="grid2">
    <div><span class="lbl">VENDA / REFERENCIA</span><div class="val">${esc(o.vendaRef || '—')}</div></div>
    <div><span class="lbl">SEU NUMERO</span><div class="val">${esc(o.seuNumero || '—')}</div></div>
  </div>

  <div class="sit">SITUACAO: ${esc(statusTxt(o.status))}</div>

  <div class="aviso">
    PAGAVEL EM QUALQUER BANCO ATE O VENCIMENTO. Apos o vencimento, acrescimos
    conforme contrato — confirme valores com o emitente antes de pagar.<br />
    Via de conferencia do EMITENTE (trabalho interno em papel termico 80mm).
    O boleto OFICIAL enviado ao cliente e o PDF original do Banco Inter
    (boleto + PIX).
  </div>

  <div class="footer">MINI BOLETO ${esc(o.vendaRef || '')} · gerado pelo sistema Doce Mania</div>
  <div class="corte">------------------ cortar aqui ------------------</div>

</div>
</body>
</html>`;
}
