/**
 * impressaoHtml.ts — BLOCO 185/186
 * CANAL BLUETOOTH COM O LAYOUT DO CANAL USB (pedido do dono verbatim:
 * "faça a impressao por bt ser igual a de usb, pois a de usb esta muito boa").
 *
 * Até hoje a MINI DANFE e o MINI BOLETO saiam no Bluetooth em TEXTO ESC/POS
 * 48 colunas (sem grade/caixas/barras vetoriais) — layout "totalmente
 * diferente" do USB, que sai no LAYOUT DE REFERENCIA do dono (danfe80Html /
 * miniBoleto80Html). Agora o BT RASTERIZA o MESMO HTML do USB (btRaster —
 * SVG foreignObject na resolucao de 203dpi + bandas de GS v 0) e o papel sai
 * IGUAL: grade, valor em destaque, codigo de barras, QR do PIX/SEFAZ, forma
 * de pagamento (BLOCO 180) e bloco de recebimento — tudo nos dois canais.
 *
 * BLOCO 186 (impressora MTP-3 GOOJPRT 80mm, BT 4.2): o raster sai por
 * writeValue COM RESPOSTA (chunk 480 / 5ms) — o ack ATT controla o fluxo e
 * o Long Write fecha qualquer MTU do modulo barato (o writeValueWithoutResponse
 * truncava em silencio acima de (MTU-3) bytes e o papel saia embaralhado).
 * Se o modulo recusar escrita com resposta, o serviço degrada sozinho para
 * 100 bytes / 30ms sem resposta — o ritmo de campo que sempre funcionou no
 * texto desta mesma impressora.
 *
 * FALLBACK GARANTIDO: se a rasterizacao nao for possivel neste navegador
 * (foreignObject/canvas indisponivel), volta para o TEXTO 48 colunas de
 * sempre — a impressao nunca morre de mãos vazias. Erros de ENVIO (queda de
 * GATT, sem conexão) propagam como antes — trocar para texto no meio de um
 * raster parcial imprimiria o papel DUAS vezes. A queda para fallback agora
 * vem LOGADA no console (antes era silenciosa e o dono via o layout antigo
 * sem saber por quê).
 */

import { bluetoothPrinter } from '@/services/bluetoothPrinterService';
import { htmlParaEscposRaster } from './btRaster';

/** BLOCO 186: chunk 480 bytes / 5ms COM RESPOSTA — o ack ATT ritma o link
 *  (480 < 512: cabe numa única escrita quando o MTU negociado chega a 517;
 *  em módulos de MTU pequeno o Long Write do Chrome fecha a escrita igual). */
const CHUNK_RASTER = 480;
const DELAY_RASTER_MS = 5;

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
  } catch (e) {
    // Raster indisponível neste navegador — texto 48 colunas de sempre.
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[impressao] raster BT indisponível — cai para texto 48 colunas:', msg);
    return await bluetoothPrinter.print(fallbackTexto(), '80MM', { skipConfirm: true });
  }
  return await bluetoothPrinter.printBytes(bytes, '80MM', {
    skipConfirm: true,
    chunkSize: CHUNK_RASTER,
    delayMs: DELAY_RASTER_MS,
    comResposta: true,
  });
}
