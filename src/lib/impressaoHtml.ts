/**
 * impressaoHtml.ts — BLOCO 185
 * CANAL BLUETOOTH COM O LAYOUT DO CANAL USB (pedido do dono verbatim:
 * "faça a impressao por bt ser igual a de usb, pois a de usb esta muito boa").
 *
 * Até hoje a MINI DANFE e o MINI BOLETO saiam no Bluetooth em TEXTO ESC/POS
 * 48 colunas (sem grade/caixas/barras vetoriais) — layout "totalmente
 * diferente" do USB, que sai no LAYOUT DE REFERENCIA do dono (danfe80Html /
 * miniBoleto80Html). Agora o BT RASTERIZA o MESMO HTML do USB (btRaster —
 * SVG foreignObject na resolucao de 203dpi + GS v 0) e o papel sai IGUAL:
 * grade, valor em destaque, codigo de barras, QR do PIX/SEFAZ, forma de
 * pagamento (BLOCO 180) e bloco de recebimento — tudo nos dois canais.
 *
 * FALLBACK GARANTIDO: se a rasterizacao nao for possivel neste navegador
 * (foreignObject/canvas indisponivel), volta para o TEXTO 48 colunas de
 * sempre — a impressao nunca morde de mãos vazias. Erros de ENVIO (queda de
 * GATT, sem conexão) propagam como antes — trocar para texto no meio de um
 * raster parcial imprimiria o papel DUAS vezes.
 */

import { bluetoothPrinter } from '@/services/bluetoothPrinterService';
import { htmlParaEscposRaster } from './btRaster';

/** Rendimento do raster: chunk 300 bytes / 10ms — a imagem sai em segundos
 *  e o firmware BLE dos chineses drena essa cadência sem derrubar o GATT
 *  (o TEXTO continua no ritmo de campo 100/40ms do BLOCO 34). */
const CHUNK_RASTER = 300;
const DELAY_RASTER_MS = 10;

/**
 * Imprime o DOCUMENTO HTML (layout de referência) no canal Bluetooth.
 * @param gerarHtml gera o HTML na variante raster (danfeFiscal80Html(d, { raster: true }))
 * @param fallbackTexto gera o texto 48 colunas usado só se a rasterização falhar
 */
export async function imprimirHtmlViaBt(
  gerarHtml: () => Promise<string>,
  fallbackTexto: () => string,
): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    const html = await gerarHtml();
    bytes = await htmlParaEscposRaster(html);
  } catch {
    // Raster indisponível neste navegador — texto 48 colunas de sempre.
    return await bluetoothPrinter.print(fallbackTexto(), '80MM', { skipConfirm: true });
  }
  return await bluetoothPrinter.printBytes(bytes, '80MM', {
    skipConfirm: true,
    chunkSize: CHUNK_RASTER,
    delayMs: DELAY_RASTER_MS,
  });
}
