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
 *
 * BLOCO 120 — IMPRESSAO NO IPHONE (bug do dono: "iphone nao esta conseguindo
 * imprimir os cupons"). Causa raiz: no iOS o Safari NAO TEM navigator.bluetooth
 * (entao o canal cai em USB por padrao, correto), mas o print() feito DENTRO de
 * iframe escondido e IGNORADO pelo iOS — a folha de impressao nunca abre e nada
 * acontece, sem erro. O Safari do iPhone so imprime pela JANELA PRINCIPAL.
 * Fix: no iOS o cupom e montado no proprio documento (container que so existe
 * na impressao — o app e escondido via @media print) + PAINEL DE REFORCO com
 * botao grande "IMPRIMIR CUPOM": mesmo que o print() automatico seja ignorado
 * (chamadas que vieram depois de um await perdem o gesto no iOS), o toque no
 * botao e gesto DIRETO — a folha abre com certeza. No painel o dono escolhe a
 * impressora AirPrint; termica so-Bluetooth continua no Android/PC (limitacao
 * do Safari, nao do sistema).
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

// ============================================================
// BLOCO 112 — REFORCO DE IMPRESSAO (cupom mais escuro)
// Queixa de campo: auto-teste da termica sai escuro mas o CUPOM sai
// claro. Nos dois canais o remédio do lado do sistema é NEGRITO:
// - Bluetooth: comando ESC/POS ESC E 1 no início do buffer — a cabeça
//   queima pontos DUPLOS, mesma grade de caracteres (nao muda largura).
// - USB: font-weight 700 no papel virtual — Courier New bold tem o MESMO
//   avanço monoespaçado do regular (colunas continuam alinhadas) e o
//   driver do Windows converte mais pixels pretos = impressão escura.
// Gravado em localStorage POR DISPOSITIVO. Default LIGADO (a queixa real
// de campo é cupom claro; quem preferir o traço fino desliga aqui).
// ============================================================
const REFORCO_KEY = 'docemania_reforco_impressao';

export function lerReforcoImpressao(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const salvo = window.localStorage.getItem(REFORCO_KEY);
    if (salvo === '0') return false;
    if (salvo === '1') return true;
  } catch { /* localStorage bloqueado — usa default */ }
  return true;
}

export function salvarReforcoImpressao(v: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REFORCO_KEY, v ? '1' : '0');
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

/** Corpo do cupom (mesmo texto nas duas vias: iframe do desktop e iOS). */
const corpoCupomHtml = (texto: string): string =>
  converterMarcadores(escapeHtml(String(texto || '')));

/** Detalhes tipograficos por largura de papel (58mm = 32 colunas, 80mm = 48). */
const detalhesPapel = (width: PrinterWidth) => ({
  pageMm: width === '80MM' ? '80mm' : '58mm',
  fontPx: width === '80MM' ? '12px' : '10.5px',
  // BLOCO 113 (regra do dono): no 80mm o cupom saia PEQUENO — escala 120%
  // assada na pagina virtual: fonte 12px e letter-spacing negativo que
  // compacta as 48 colunas de volta para ~76mm. Imprimir na escala PADRAO
  // (100%) do dialogo, sem escala personalizada.
  espaco80: width === '80MM' ? 'letter-spacing: -1.2px;' : '',
  espacoPeq80: width === '80MM' ? 'letter-spacing: -0.8px;' : '',
});

const cssReforco = (): string =>
  lerReforcoImpressao()
    ? 'font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact;'
    : '-webkit-print-color-adjust: exact; print-color-adjust: exact;';

// ============================================================
// BLOCO 120 — CAMINHO iOS (iPhone/iPad)
// ============================================================
const OVERLAY_ID = 'dm-impressao-termica';
const PAINEL_ID = 'dm-impressao-termica-painel';

/** iOS real: iPhone/iPod, iPad classico e iPad em modo desktop ("Macintosh" com toque). */
export function dispositivoIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = String(navigator.userAgent || '');
  const classico = /iPhone|iPod|iPad/i.test(ua);
  const ipadDesktop = /Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  return classico || ipadDesktop;
}

/**
 * Impressao iOS pelo DOCUMENTO PRINCIPAL: o Safari do iPhone ignora print()
 * dentro de iframe, entao o cupom e montado num container do proprio app que
 * so existe na impressao (@media print esconde todo o resto). Depois chama
 * window.print() — se a chamada veio de um toque direto, a folha abre na hora;
 * se o iOS ignorar (chamada assincrona), o PAINEL fica na tela com o botao
 * "IMPRIMIR CUPOM": toque direto = gesto garantido, a folha abre com certeza.
 */
function imprimirViaIos(texto: string, width: PrinterWidth): void {
  const { pageMm, fontPx, espaco80, espacoPeq80 } = detalhesPapel(width);
  const reforco = cssReforco();

  // Limpa sobras de impressoes anteriores (overlay + painel).
  try { document.getElementById(OVERLAY_ID)?.remove(); } catch { /* ja removido */ }
  try { document.getElementById(PAINEL_ID)?.remove(); } catch { /* ja removido */ }

  // Container de impressao: invisivel na tela, unico visivel no papel.
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
<style>
  @page { size: ${pageMm} auto; margin: 0; }
  #${OVERLAY_ID} { display: none; }
  #${OVERLAY_ID} .dm-cupom {
    padding: 1.5mm 1mm;
    font-family: 'Courier New', Courier, ui-monospace, monospace;
    font-size: ${fontPx};
    line-height: 1.3;
    white-space: pre;
    color: #000;
    ${reforco}
    ${espaco80}
  }
  #${OVERLAY_ID} .dm-cupom .peq { font-size: 0.72em; color: #000; ${espacoPeq80} }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
    body > *:not(#${OVERLAY_ID}) { display: none !important; }
    #${OVERLAY_ID} { display: block !important; }
  }
</style>
<div class="dm-cupom">${corpoCupomHtml(texto)}</div>`;

  // Painel de reforco (so tela — no papel ele e escondido pela regra do overlay).
  const painel = document.createElement('div');
  painel.id = PAINEL_ID;
  painel.setAttribute('role', 'dialog');
  painel.setAttribute('aria-label', 'Impressão do cupom');
  painel.style.cssText = [
    'position: fixed', 'left: 12px', 'right: 12px',
    'bottom: calc(12px + env(safe-area-inset-bottom))',
    'z-index: 2147483000', 'background: #0f172a', 'color: #fff',
    'border-radius: 16px', 'padding: 14px', 'max-width: 420px', 'margin: 0 auto',
    'box-shadow: 0 10px 30px rgba(0,0,0,.35)',
    "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  ].join(';');
  painel.innerHTML = `
<p style="margin:0 0 10px;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;">Cupom pronto para imprimir</p>
<button id="dm-ios-print-btn" style="width:100%;min-height:44px;padding:14px 0;border:0;border-radius:12px;background:#059669;color:#fff;font-size:14px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;">IMPRIMIR CUPOM</button>
<p style="margin:8px 0 0;font-size:10px;line-height:1.5;color:#cbd5e1;">Na folha do iPhone escolha uma impressora <b>AirPrint</b>. Impressora termica somente Bluetooth continua no aparelho Android ou no PC — o Safari do iPhone nao conecta em Bluetooth.</p>
<button id="dm-ios-print-close" style="width:100%;margin-top:8px;min-height:44px;padding:10px 0;border:0;border-radius:12px;background:#1e293b;color:#94a3b8;font-size:11px;font-weight:800;text-transform:uppercase;">FECHAR</button>`;

  let limpo = false;
  const limpar = () => {
    if (limpo) return;
    limpo = true;
    try { overlay.remove(); } catch { /* ja removido */ }
    try { painel.remove(); } catch { /* ja removido */ }
    try { window.removeEventListener('afterprint', limpar); } catch { /* nada */ }
  };

  const btnImprimir = painel.querySelector('#dm-ios-print-btn');
  const btnFechar = painel.querySelector('#dm-ios-print-close');
  btnImprimir?.addEventListener('click', () => {
    // GESTO DIRETO: o iOS nao ignora print() vindo de um toque no botao.
    try { window.print(); } catch { /* folha nao abriu — painel continua */ }
  });
  btnFechar?.addEventListener('click', limpar);
  window.addEventListener('afterprint', limpar);
  // Rede de seguranca: some sozinho se o dono nao interagir.
  setTimeout(limpar, 120000);

  document.body.appendChild(overlay);
  document.body.appendChild(painel);

  // Se esta chamada veio de um toque direto, a folha abre ja. Se veio depois
  // de await (iOS perde o gesto), a folha e ignorada e o PAINEL fica na tela.
  try { window.print(); } catch { /* painel segue como plano B */ }
}

/**
 * Abre o dialogo de impressao do navegador com o cupom formatado no tamanho
 * do papel termico. O usuario escolhe a impressora USB (o navegador memoriza).
 * `onError` recebe falhas assincronas (iframe bloqueado/print indisponivel) —
 * o caller usa para mostrar modal/toast, porque o load do iframe acontece
 * DEPOIS que esta funcao retorna.
 * BLOCO 120: no iPhone/iPad o caminho e o do documento principal (o iOS
 * ignora print de iframe) — ver imprimirViaIos acima.
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

  // BLOCO 120: iOS primeiro — o iframe escondido nao imprime no Safari do
  // iPhone (folha nunca abre, sem erro). Caminho proprio, sem iframe.
  if (dispositivoIOS()) {
    try {
      imprimirViaIos(texto, width);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (onError) onError(msg);
      else console.error('[usbPrint]', msg);
    }
    return;
  }

  // Papel 58mm (32 colunas @ 10.5px Courier) | papel 80mm (48 colunas @ 12px)
  const { pageMm, fontPx, espaco80, espacoPeq80 } = detalhesPapel(width);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';

  // BLOCO 112: reforço de impressão — quando ligado, o papel virtual sai em
  // NEGRITO (font-weight 700) e TUDO em preto sólido: a fonte pequena (.peq)
  // era #222/CINZA e imprimia mais clara na térmica; print-color-adjust impede
  // o driver de "aclarear" o texto.
  const cssReforcoTexto = cssReforco();

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
    ${cssReforcoTexto}
    ${espaco80}
  }
  /* Bloco 113: a fonte pequena (TROCAS) herda o espacamento compactado do
     80mm — com 12px x 0.72 o negrito tocaria a letra vizinha; espacamento
     proprio para a fonte pequena nao vazar tinta umas nas outras. */
  .peq { font-size: 0.72em; color: #000; ${espacoPeq80} }
</style>
</head>
<body>${corpoCupomHtml(texto)}</body>
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
