/**
 * usbPrint.ts
 * BLOCO 111 — IMPRESSAO POR IMPRESSORA TERMICA USB DO PC
 *
 * Ate hoje o sistema imprimia so via Web Bluetooth (celular/van). No computador
 * a impressora termica costuma vir por USB — e o navegador nao fala ESC/POS
 * por USB sem permissao especial. O caminho universal que funciona em QUALQUER
 * PC (Windows/Mac/Linux, Chrome/Edge/Firefox) e o dialogo de impressao do
 * proprio navegador: renderizamos o MESMO texto do cupom (32/48 colunas,
 * Courier monoespacado) numa folha do tamanho do papel termico (58mm/80mm) e
 * chamamos window.print(). O Windows manda para a termica USB que o usuario
 * escolher — e o navegador MEMORIZA a ultima impressora usada (a partir da
 * segunda impressao sai com 1 clique).
 *
 * Canal de impressao (BT x USB) fica no localStorage, por dispositivo:
 * - celular com Web Bluetooth  -> BT por padrao
 * - desktop sem Web Bluetooth  -> USB por padrao
 * O canal escolhido vale para TODOS os pontos de impressao do sistema
 * (cupom, pre-pedido, DANFE, relatorio fiscal, lista de carga).
 */

export type CanalImpressao = 'BT' | 'USB';
export type PrinterWidth = '56MM' | '80MM';

const CANAL_KEY = 'docemania_canal_impressao';

/** Web Bluetooth existe? (Chrome/Edge no Android/Windows sim; iPhone e Firefox nao) */
export function temBluetoothNavegador(): boolean {
  if (typeof navigator === 'undefined') return false;
  return 'bluetooth' in navigator;
}

/** Canal de impressao do dispositivo. Default inteligente: USB no desktop sem BT. */
export function lerCanalImpressao(): CanalImpressao {
  if (typeof window === 'undefined') return 'BT';
  try {
    const salvo = window.localStorage.getItem(CANAL_KEY);
    if (salvo === 'BT' || salvo === 'USB') return salvo;
  } catch { /* localStorage bloqueado — usa default */ }
  return temBluetoothNavegador() ? 'BT' : 'USB';
}

/** Grava o canal escolhido pelo usuario (vale para todos os pontos de impressao). */
export function salvarCanalImpressao(canal: CanalImpressao): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CANAL_KEY, canal);
  } catch { /* nada que possamos fazer */ }
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Converte os marcadores [[PEQ]] / [[FIMPEQ]] (font B no ESC/POS) em spans
 * menores para o papel virtual — mesmo comportamento da impressora Bluetooth.
 */
const converterMarcadores = (texto: string): string => {
  const abre = '<span class="peq">';
  const fecha = '</span>';
  return texto
    .replace(/\[\[PEQ\]\]/g, abre)
    .replace(/\[\[FIMPEQ\]\]/g, fecha);
};

/**
 * Abre o dialogo de impressao do navegador com o cupom formatado no tamanho
 * do papel termico. O usuario escolhe a impressora USB (o navegador memoriza).
 * `onError` recebe falhas assincronas (iframe bloqueado/print indisponivel) —
 * o caller usa para mostrar modal/toast, porque o load do iframe acontece
 * DEPOIS que esta funcao retorna.
 */
export function imprimirViaUsb(
  texto: string,
  width: PrinterWidth = '56MM',
  onError?: (msg: string) => void,
): void {
  if (typeof document === 'undefined') {
    const msg = 'SEM_DOCUMENTO';
    if (onError) onError(msg); else console.error('[usbPrint]', msg);
    return;
  }

  // Papel 58mm (32 colunas @ 10.5px Courier) | papel 80mm (48 colunas @ 10px)
  const pageMm = width === '80MM' ? '80mm' : '58mm';
  const fontPx = width === '80MM' ? '10px' : '10.5px';

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';

  // srcdoc = documento autocontido (sem CORS); margin 0 + padding minimo para
  // a termica cortar certinho; white-space pre preserva o alinhamento por
  // colunas do cupom (totais na mesma coluna da impressora BT).
  iframe.srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Cupom</title>
<style>
  @page { size: ${pageMm} auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    padding: 1.5mm 1mm;
    font-family: 'Courier New', Courier, ui-monospace, monospace;
    font-size: ${fontPx};
    line-height: 1.3;
    white-space: pre;
    color: #000;
  }
  .peq { font-size: 0.72em; color: #222; }
</style>
</head>
<body>${converterMarcadores(escapeHtml(String(texto || '')))}</body>
</html>`;

  const remover = () => {
    try { iframe.remove(); } catch { /* ja removido */ }
  };

  const falhar = (e: unknown) => {
    remover();
    const msg = e instanceof Error ? e.message : String(e);
    if (onError) onError(msg);
    else console.error('[usbPrint]', msg);
  };

  // srcdoc = documento autocontido (sem CORS); margin 0 + padding minimo para
  // a termica cortar certinho; white-space pre preserva o alinhamento por
  // colunas do cupom (totais na mesma coluna da impressora BT).
  iframe.srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Cupom</title>
<style>
  @page { size: ${pageMm} auto; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    padding: 1.5mm 1mm;
    font-family: 'Courier New', Courier, ui-monospace, monospace;
    font-size: ${fontPx};
    line-height: 1.3;
    white-space: pre;
    color: #000;
  }
  .peq { font-size: 0.72em; color: #222; }
</style>
</head>
<body>${converterMarcadores(escapeHtml(String(texto || '')))}</body>
</html>`;

  // Remove o iframe depois da impressao (e com fallback de seguranca)
  iframe.addEventListener('load', () => {
    try {
      const w = iframe.contentWindow;
      if (!w) throw new Error('IFRAME_BLOQUEADO');
      w.addEventListener('afterprint', remover);
      w.focus();
      w.print();
      // Fallback: se afterprint nao chegar (usuario cancela), limpa depois.
      setTimeout(remover, 60000);
    } catch (e) {
      falhar(e);
    }
  });

  try {
    document.body.appendChild(iframe);
  } catch (e) {
    falhar(e);
  }
}
