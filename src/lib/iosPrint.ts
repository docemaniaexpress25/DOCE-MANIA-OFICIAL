/**
 * iosPrint.ts
 * BLOCO 82 — IMPRESSÃO NO iPHONE
 *
 * A Apple NÃO implementa a Web Bluetooth API (navigator.bluetooth) em NENHUM
 * navegador do iOS/iPadOS — Safari, Chrome, Firefox e Edge do iPhone usam o
 * mesmo motor WebKit, e todos têm navigator.bluetooth = undefined. Não é falha
 * do app: é bloqueio de plataforma. Nenhum código de site consegue falar com a
 * impressora térmica BLE de dentro do Safari do iPhone.
 *
 * Caminho que funciona HOJE, de graça: o app Bluefy (App Store) é um
 * navegador iOS COM Web Bluetooth nativo. Abrindo o sistema dentro dele, o
 * fluxo de impressão existente (bluetoothPrinterService) funciona igual ao
 * Chrome do Android — mesmo site, mesmo login, mesma impressora.
 *
 * Este helper centraliza a detecção de iPhone/iPad e o texto oficial do
 * passo a passo, usado nos 4 pontos de impressão (Cupom, PDV, RelatorioFiscal,
 * VendedorDashboard) e no PrinterSelector.
 */

/** Detecta iPhone/iPad/iPod — inclusive iPadOS em "modo desktop" (reporta Mac com tela touch). */
export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOSClassic = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ em modo desktop: UA mascara de Mac, mas maxTouchPoints > 1 entrega o toque.
  const iPadDesktopMode = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1;
  return iOSClassic || iPadDesktopMode;
}

/** Passo a passo oficial (modal/banner). Mesmo texto em todos os pontos de impressão. */
export const TEXTO_IMPRESSAO_IOS = [
  'No iPhone, a Apple NAO libera Bluetooth para sites (Safari, Chrome e Firefox do iOS sao todos bloqueados — nao e falha do sistema).',
  '',
  'SOLUCAO (2 minutos, gratis):',
  '1. Na App Store, instale o app "Bluefy - Web BLE Browser"',
  '2. Abra o Bluefy e entre no site do sistema (mesmo endereco que voce usa hoje)',
  '3. Faca login normalmente',
  '4. Toque em Imprimir — o seletor de Bluetooth abre dentro do Bluefy',
  '5. Aceite a permissao de Bluetooth que o iPhone pedir',
  '',
  'O cupom sai na MESMA impressora de sempre.',
].join('\n');

/** Título padrão para o modal de instruções iOS. */
export const TITULO_IMPRESSAO_IOS = 'Imprimir no iPhone';
