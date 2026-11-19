/**
 * btRaster.ts — BLOCO 185
 * IMPRESSAO BLUETOOTH COM O LAYOUT EXATO DO CANAL USB.
 *
 * Pedido do dono (verbatim): "quando imprimimos esta saindo com um layout
 * totalmente diferente do layout da impressao desses itens por usb, entao
 * faça a impressao por bt ser igual a de usb, pois a de usb esta muito boa".
 *
 * ANTES: o canal BT saia em TEXTO ESC/POS 48 colunas (danfe80/cupomTexto) —
 * sem grade, sem caixa, sem codigo de barras vetorial, quebra de linha
 * propria. O canal USB sai no LAYOUT DE REFERENCIA do dono (danfe80Html /
 * miniBoleto80Html): grade de caixas, valor total em destaque, CODE 128 em
 * SVG, fonte Consolas — "muito boa" segundo o dono.
 *
 * AGORA: o MESMO HTML do USB e RASTERIZADO e enviado como IMAGEM ESC/POS
 * (GS v 0, modo 0) na resolucao nativa da termica de 203dpi (8 dots/mm).
 * O papel sai com grade, barras e fonte IGUAIS ao USB — o layout fica
 * pixel-a-pixel o mesmo, inclusive a FORMA DE PAGAMENTO (bloco 180), o
 * QR do PIX/consulta SEFAZ e o bloco RECEBIMENTO da NF-e.
 *
 * Como funciona (tudo no navegador, sem dependencia nova):
 *   1. O HTML (variante raster, sem @media screen e sem .hint) e carregado
 *      num iframe escondido — media-se o .poster real (mesmo motor de layout
 *      do dialogo USB) e extrai-se o CSS + outerHTML do poster.
 *   2. O poster e re-renderizado dentro de um SVG <foreignObject> NA
 *      RESOLUCAO DA CABECA TERMICA (560 dots = 70mm x 8 dots/mm, 203dpi):
 *      transform scale() amplia o layout do iframe para a largura de dots.
 *   3. O SVG vira Image (data URL — Blob URL TINGE o canvas com
 *      foreignObject no Chromium, provado no QA) -> canvas -> luminancia ->
 *      LIMIAR (1-bit) -> bytes por linha (70 bytes/linha).
 *   4. Embala em BANDAS de GS v 0 (128 linhas por comando, ~9KB cada) +
 *      alimentacao + corte. BLOCO 186 (impressora MTP-3 GOOJPRT 80mm): o
 *      firmware barato NAO consegue guardar uma imagem inteira de 100-250KB
 *      em RAM — com UM comando gigante o papel saia rasgado/comecado no
 *      meio. Em bandas a impressora imprime cada fatia conforme chega.
 *
 * O envio usa o MESMO bluetoothPrinterService (fila, reconnect, retry por
 * chunk) — BLOCO 186: o raster vai COM RESPOSTA (ATT ack controla o fluxo,
 * chunk 480/5ms) e degrada para 100/30ms sem resposta se o módulo não
 * aceitar; o TEXTO continua com o ritmo de sempre (100/40ms sem resposta).
 *
 * FALLBACK: se a rasterizacao falhar num navegador (foreignObject/canvas
 * indisponivel), o chamador volta para o TEXTO 48 colunas de sempre — a
 * impressao nunca morre. (Chrome/Edge no Android/PC, que sao os aparelhos
 * com Web Bluetooth, suportam todo o caminho de raster.)
 *
 * BLOCO 186 — POR QUE SAIA "BUGADO" NA MTP-3 (GOOJPRT, 80mm, BT 4.2, 203dpi):
 *   a) a imagem inteira ia num UNICO GS v 0 (100-250KB) — o firmware da
 *      MTP-3 nao tem RAM para isso: papel rasgado/comecado no meio;
 *   b) chunks de 300 bytes com writeValueWithoutResponse: o Write Command
 *      BLE nao tem fragmentacao — acima de (MTU-3) bytes o modulo barato
 *      TRUNCA em silencio, e cada chunk perdia pedaco (imagem deslocada/
 *      embaralhada). O TEXTO de 100 bytes sempre funcionou — por isso o
 *      cupom saia bom e o raster saia "bugado". Agora o envio do raster usa
 *      writeValue COM resposta (ATT ack = controle de fluxo real, Long
 *      Write fecha qualquer MTU) e degrada para 100/30ms sem resposta;
 *   c) o MINI BOLETO (modal MiniBoletoImpressao) nem tinha migrado — o BT
 *      dele ainda mandava TEXTO 48 colunas, layout totalmente diferente do
 *      USB (corrigido no proprio componente).
 *
 * BLOCO 196 — NITIDEZ (pedido do dono: "melhorar a nitidez do mini boleto e
 * da mini danfe, nao mude nada no layout delas somente a nitidez"):
 *   ANTES: o SVG era rasterizado DIRETO na largura da cabeca (560 dots) e o
 *   canvas binarizava os pixels com antialiasing cinza do navegador — cada
 *   borda de traco virava pontinhos decididos por um único pixel renderizado,
 *   o que deixava o texto serrilhado/cinza no papel.
 *   AGORA: SUPERAMOSTRAGEM — o mesmo SVG e rasterizado em RESOLUCAO MULTIPLA
 *   (2x ou 3x os 560 dots), cada dot final é a MÉDIA de luminância do bloco
 *   mult×mult (área real de tinta) e só então o limiar decide o ponto queimado.
 *   O resultado é o mesmo layout (o downsampling não altera geometria), com
 *   bordas posicionadas pela cobertura REAL de tinta: tracos retos, cantos
 *   fechados e código de barras/QR estáveis. O multiplicador é adaptativo
 *   (3x em cupons curtos, 2x nos longos, 1x acima do limite de memória de
 *   canvas de celular) — nunca estoura o limite de área do iOS/Android.
 */

export interface OpcoesRaster {
  /** Largura da imagem em dots (80mm = 560: 70mm x 8 dots/mm @ 203dpi). */
  larguraDots?: number;
  /** Luminancia (0..255) abaixo da qual o ponto e queimado. 168 = texto mais escuro (reforco). */
  limiar?: number;
  /** BLOCO 196: superamostragem (2 ou 3 = rasteriza mult× a resolução da cabeça
   *  e faz a média por dot antes do limiar — nitidez; 1 = comportamento antigo).
   *  Por padrão o pipeline escolhe sozinho (adaptativo pelo tamanho do papel). */
  multiplicador?: number;
}

export interface BitsRaster {
  bytes: Uint8Array;
  bytesPorLinha: number;
  altura: number;
}

// ---------------------------------------------------------------------------
// 1) PURA — luminancia + limiar -> bits 1-bit (testavel no bun, sem DOM)
// ---------------------------------------------------------------------------
export function bitsDoCanvas(
  dados: { width: number; height: number; data: ArrayLike<number> },
  limiar = 168,
): BitsRaster {
  const w = dados.width;
  const h = dados.height;
  const bytesPorLinha = Math.ceil(w / 8);
  const bytes = new Uint8Array(bytesPorLinha * h);
  const data = dados.data;
  const lim = limiar / 255;
  for (let y = 0; y < h; y++) {
    const base = y * bytesPorLinha;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a === 0) continue; // transparente = papel
      // luminancia 0..1 (Rec. 601) — menor = mais escuro
      const lum = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      if (lum < lim) bytes[base + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { bytes, bytesPorLinha, altura: h };
}

// ---------------------------------------------------------------------------
// 2) PURA — corta linhas VAZIAS do fim (sobras do padding do canvas)
// ---------------------------------------------------------------------------
export function cortarLinhasVazias(bits: BitsRaster): BitsRaster {
  let altura = bits.altura;
  while (altura > 0) {
    const linha = bits.bytes.subarray((altura - 1) * bits.bytesPorLinha, altura * bits.bytesPorLinha);
    if (linha.some((b) => b !== 0)) break;
    altura--;
  }
  if (altura === bits.altura) return bits;
  return { bytes: bits.bytes.subarray(0, altura * bits.bytesPorLinha), bytesPorLinha: bits.bytesPorLinha, altura };
}

// ---------------------------------------------------------------------------
// 3) PURA — embala os bits no comando ESC/POS raster (GS v 0) + feed + corte
// ---------------------------------------------------------------------------
export function comandoEscposRaster(bits: BitsRaster): Uint8Array {
  const ESC = 0x1b;
  const GS = 0x1d;
  const { bytes, bytesPorLinha, altura } = bits;
  const cmd = new Uint8Array(2 + 8 + bytes.length + 3 + 3);
  let o = 0;
  cmd[o++] = ESC; cmd[o++] = 0x40;                       // ESC @ — init
  cmd[o++] = GS; cmd[o++] = 0x76; cmd[o++] = 0x30; cmd[o++] = 0x00; // GS v 0, modo 0
  cmd[o++] = bytesPorLinha & 0xff; cmd[o++] = (bytesPorLinha >> 8) & 0xff; // xL xH (bytes/linha)
  cmd[o++] = altura & 0xff; cmd[o++] = (altura >> 8) & 0xff;               // yL yH (dots)
  cmd.set(bytes, o); o += bytes.length;
  cmd[o++] = ESC; cmd[o++] = 0x64; cmd[o++] = 4;         // ESC d 4 — alimenta 4 linhas
  cmd[o++] = GS; cmd[o++] = 0x56; cmd[o++] = 0x01;       // GS V 1 — corte parcial (mesmo do texto)
  return cmd.subarray(0, o);
}

// ---------------------------------------------------------------------------
// 3b) PURA — BLOCO 186: mesmo comando ESC/POS raster, em BANDAS de linhas.
// A MTP-3 (e qualquer térmica BLE barata) imprime cada GS v 0 só quando o
// comando INTEIRO chegou — uma imagem de 232KB num comando só estoura o
// buffer do firmware (papel rasgado/comecado). Em bandas de 128 linhas
// (128 x 70 bytes = 8.96KB por comando) cada fatia cabe no buffer e é
// impressa conforme chega — o resultado na folha é idêntico (o raster
// avança exatamente a altura da banda; nenhuma emenda aparece).
// ---------------------------------------------------------------------------
export const LINHAS_POR_BANDA = 128;

export function comandoEscposRasterBandas(bits: BitsRaster, linhasPorBanda: number = LINHAS_POR_BANDA): Uint8Array {
  const ESC = 0x1b;
  const GS = 0x1d;
  const { bytes, bytesPorLinha, altura } = bits;
  const banda = Math.max(1, Math.min(1024, Math.floor(linhasPorBanda)));
  const totalBandas = Math.ceil(altura / banda);
  // ESC @ (2) + bandas [ GS v 0 0 xL xH yL yH (8) + dados ] + ESC d 4 (3) + GS V 1 (3)
  const cmd = new Uint8Array(2 + totalBandas * 8 + bytes.length + 6);
  let o = 0;
  cmd[o++] = ESC; cmd[o++] = 0x40;                       // ESC @ — init (UMA vez)
  for (let y = 0; y < altura; y += banda) {
    const h = Math.min(banda, altura - y);
    cmd[o++] = GS; cmd[o++] = 0x76; cmd[o++] = 0x30; cmd[o++] = 0x00; // GS v 0, modo 0
    cmd[o++] = bytesPorLinha & 0xff; cmd[o++] = (bytesPorLinha >> 8) & 0xff; // xL xH
    cmd[o++] = h & 0xff; cmd[o++] = (h >> 8) & 0xff;               // yL yH da banda
    cmd.set(bytes.subarray(y * bytesPorLinha, (y + h) * bytesPorLinha), o);
    o += h * bytesPorLinha;
  }
  cmd[o++] = ESC; cmd[o++] = 0x64; cmd[o++] = 4;         // ESC d 4 — alimenta 4 linhas
  cmd[o++] = GS; cmd[o++] = 0x56; cmd[o++] = 0x01;       // GS V 1 — corte parcial
  return cmd.subarray(0, o);
}

// ---------------------------------------------------------------------------
// 4b) PURA — garante que o fragmento do poster é XML-BEM-FORMADO: dentro de
// <foreignObject> o conteúdo é parseado como XML (não HTML) — <br> aberto,
// &nbsp; e outros hábitos de HTML quebram o SVG inteiro. Serializamos com o
// XMLSerializer (parse text/html -> XML), que fecha void tags e escapa entidades.
// ---------------------------------------------------------------------------
export function xmlSafePoster(posterHtml: string): string {
  try {
    const doc = new DOMParser().parseFromString(String(posterHtml || ''), 'text/html');
    const raiz = doc.body.firstElementChild || doc.body;
    return new XMLSerializer().serializeToString(raiz);
  } catch {
    return posterHtml;
  }
}

// ---------------------------------------------------------------------------
// 3c) PURA — BLOCO 196: SUPERAMOSTRAGEM — média de luminância por dot.
// Recebe o ImageData do canvas HI-RES (mult× a largura da cabeça) e devolve
// um "ImageData-like" em RESOLUÇÃO FINAL (larguraDots × alturaDots), onde cada
// pixel guarda a luminância MÉDIA do bloco mult×mult (cobertura real de tinta).
// O bitsDoCanvas continua decidindo o ponto queimado com o MESMO limiar — a
// geometria não muda (nada sai deslocado), só a DECISÃO por dot fica com base
// na área real: bordas retas, cantos fechados, texto sem serrilhado.
// ---------------------------------------------------------------------------
export function reduzirMediaLuminancia(
  dados: { width: number; height: number; data: ArrayLike<number> },
  multiplicador: number,
  larguraDots: number,
  alturaDots: number,
): { width: number; height: number; data: Uint8ClampedArray } {
  const mult = Math.max(1, Math.floor(multiplicador));
  const data = dados.data;
  const saida = new Uint8ClampedArray(larguraDots * alturaDots * 4);
  for (let y = 0; y < alturaDots; y++) {
    const y0 = y * mult;
    const y1 = Math.min(dados.height, y0 + mult);
    for (let x = 0; x < larguraDots; x++) {
      const x0 = x * mult;
      const x1 = Math.min(dados.width, x0 + mult);
      let soma = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        const linha = yy * dados.width;
        for (let xx = x0; xx < x1; xx++) {
          const i = (linha + xx) * 4;
          // alpha 0 = papel (branco) — entra na média como luminância cheia
          const a = data[i + 3] / 255;
          const lum = a === 0 ? 1 : (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
          soma += lum * a + (1 - a); // pixel translúcido mistura com o papel
          n++;
        }
      }
      const media = n > 0 ? soma / n : 1;
      const o = (y * larguraDots + x) * 4;
      const v = Math.round(media * 255);
      saida[o] = v; saida[o + 1] = v; saida[o + 2] = v; saida[o + 3] = 255;
    }
  }
  return { width: larguraDots, height: alturaDots, data: saida };
}

// ---------------------------------------------------------------------------
// 4) PURA — monta o SVG <foreignObject> na resolucao da cabeca termica
// ---------------------------------------------------------------------------
export function construirSvgRaster(
  posterHtml: string,
  css: string,
  larguraPx: number,
  alturaPx: number,
  larguraDots: number,
  multiplicador = 1,
): { svg: string; alturaDots: number } {
  // BLOCO 196: mult>1 rasteriza em resolução MÚLTIPLA (superamostragem) —
  // o layout é o MESMO (mesma escala proporcional), só a rasterização interna
  // acontece com mais sub-pixels por dot antes da média.
  const mult = Math.max(1, Math.floor(multiplicador));
  const larguraHi = larguraDots * mult;
  const escala = larguraHi / larguraPx;
  const alturaDotsHi = Math.ceil(alturaPx * escala) + 4 * mult;
  const px = Math.ceil(larguraPx);
  // Reforco de traco (o USB usa -webkit-text-stroke 0.15px; no raster vai um
  // pouco mais grosso para compensar o 1-bit — se o navegador ignorar, no-op).
  const traco = `<style>.poster{-webkit-text-stroke:0.22px #000}</style>`;
  // CSS injetado também precisa ser XML-seguro (o texto do <style> é parseado
  // como XML: `&` ou `<` cru quebrariam — o XMLSerializer do poster não cobre
  // o css passado como string).
  const cssXml = String(css || '').replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;').replace(/<(?![!?a-zA-Z/])/g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${larguraHi}" height="${alturaDotsHi}">`
    + `<foreignObject width="${larguraHi}" height="${alturaDotsHi}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;width:${larguraHi}px;height:${alturaDotsHi}px;background:#ffffff;">`
    + `<div style="margin:0;padding:0;width:${px}px;background:#ffffff;transform:scale(${escala.toFixed(6)});transform-origin:0 0;">`
    + `<style>${cssXml}</style>`
    + traco
    + xmlSafePoster(posterHtml)
    + `</div></div></foreignObject></svg>`;
  // altura em DOTS FINAIS (pós-média) — a banda GS v 0 continua na resolução da cabeça
  const alturaDots = Math.ceil(alturaDotsHi / mult);
  return { svg, alturaDots };
}

// ---------------------------------------------------------------------------
// 5) DOM — mede o .poster num iframe escondido e extrai CSS + outerHTML
//    (o MESMO motor de layout que imprime o USB)
// ---------------------------------------------------------------------------
interface Medicao {
  posterHtml: string;
  css: string;
  larguraPx: number;
  alturaPx: number;
}

async function medirPoster(html: string): Promise<Medicao> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  const s = iframe.style;
  s.position = 'fixed';
  s.left = '-10000px';
  s.top = '0';
  s.width = '320px';
  s.height = '2400px';
  s.border = '0';
  s.opacity = '0';
  s.pointerEvents = 'none';

  document.body.appendChild(iframe);
  try {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('TEMPO_EXCEDIDO_MEDICAO_RASTER')), 8000);
      iframe.addEventListener('load', () => { clearTimeout(t); res(); });
      iframe.addEventListener('error', () => { clearTimeout(t); rej(new Error('FALHA_CARREGAMENTO_RASTER')); });
      iframe.srcdoc = html;
    });
    const doc = iframe.contentDocument;
    if (!doc) throw new Error('SEM_DOCUMENTO_RASTER');
    const poster = doc.querySelector('.poster') || doc.body;
    if (!poster) throw new Error('SEM_POSTER_RASTER');
    try { await doc.fonts?.ready; } catch { /* fontes de sistema — segue */ }
    const imgs = Array.from(doc.images || []);
    await Promise.all(imgs.map((i) => (typeof i.decode === 'function' ? i.decode().catch(() => undefined) : Promise.resolve())));
    const rect = poster.getBoundingClientRect();
    if (!(rect.width > 10) || !(rect.height > 10)) throw new Error('MEDICAO_INVALIDA_RASTER');
    const style = doc.querySelector('style');
    return {
      posterHtml: poster.outerHTML,
      css: style ? style.textContent || '' : '',
      larguraPx: rect.width,
      alturaPx: rect.height,
    };
  } finally {
    try { iframe.remove(); } catch { /* ja removido */ }
  }
}

// ---------------------------------------------------------------------------
// 6) DOM — pipeline completo: HTML -> SVG (hi-res) -> canvas -> média por dot
//    -> bits -> ESC/POS
// ---------------------------------------------------------------------------
export async function htmlParaEscposRaster(html: string, opcoes?: OpcoesRaster): Promise<Uint8Array> {
  if (typeof document === 'undefined') throw new Error('SEM_DOCUMENTO_RASTER');
  const larguraDots = opcoes?.larguraDots ?? 560; // 70mm x 8 dots/mm (203dpi)
  const limiar = opcoes?.limiar ?? 168;

  const med = await medirPoster(html);

  // BLOCO 196: multiplicador ADAPTATIVO — 3x em papéis curtos, 2x nos longos e
  // 1x quando o canvas hi-res estouraria o limite de memória dos celulares
  // (~12M de pixels — iOS/Android abortam canvas maior em silêncio).
  // O chamador pode fixar via opcoes.multiplicador (QA/testes).
  const alturaDotsBase = Math.ceil((med.alturaPx * larguraDots) / med.larguraPx) + 4;
  const areaFinal = larguraDots * Math.max(1, alturaDotsBase);
  const multAuto = areaFinal * 9 <= 12_000_000 ? 3 : areaFinal * 4 <= 12_000_000 ? 2 : 1;
  const mult = Math.max(1, Math.min(3, Math.floor(opcoes?.multiplicador ?? multAuto)));

  const { svg, alturaDots } = construirSvgRaster(med.posterHtml, med.css, med.larguraPx, med.alturaPx, larguraDots, mult);
  const larguraHi = larguraDots * mult;
  const alturaHi = alturaDots * mult;

  // Diagnóstico real: se o SVG não é XML válido (poster/CSS com sintaxe HTML
  // cru), o <img> falha com erro genérico — aqui a falha vem com o parsererror.
  const erroParse = (() => {
    try {
      const p = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const e = p.querySelector('parsererror');
      return e ? e.textContent.replace(/\s+/g, ' ').slice(0, 200) : '';
    } catch { return ''; }
  })();
  if (erroParse) throw new Error(`SVG_INVALIDO: ${erroParse}`);

  // BLOCO 186/QA: o SVG TEM que ir como data URL — Blob URL TINGE o canvas
  // (SecurityError no getImageData) quando o SVG tem <foreignObject>, regra
  // do Chromium para SVG-as-image de origem igual. Data URL tem origem
  // opaca e o <img> renderiza em "secure static mode" SEM tinta. O tamanho
  // não é problema: até uma DANFE de 500 itens fica longe do limite de 2MB
  // de URLs do Chrome (o HTML+CSS+QR real fica em ~100-200KB).
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('FALHA_RASTERIZACAO_SVG'));
    i.src = url;
  });

  // HI-RES: o navegador rasteriza o SVG vetorial em mult× a cabeça térmica
  const canvas = document.createElement('canvas');
  canvas.width = larguraHi;
  canvas.height = alturaHi;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('SEM_CANVAS_RASTER');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, larguraHi, alturaHi);
  ctx.imageSmoothingEnabled = true;
  try { ctx.imageSmoothingQuality = 'high'; } catch { /* navegadores antigos */ }
  ctx.drawImage(img, 0, 0);

  // BLOCO 196: MÉDIA por dot (superamostragem) ANTES do limiar — cada dot
  // final decide o queimado pela cobertura REAL de tinta do bloco mult×mult.
  const dadosHi = ctx.getImageData(0, 0, larguraHi, alturaHi);
  const dados = mult > 1 ? reduzirMediaLuminancia(dadosHi, mult, larguraDots, alturaDots) : dadosHi;
  const bits = cortarLinhasVazias(bitsDoCanvas(dados, limiar));
  if (bits.altura < 10) throw new Error('RASTER_VAZIO');
  // BLOCO 186: bandas de GS v 0 (firmware da MTP-3 nao segura imagem inteira)
  return comandoEscposRasterBandas(bits);
}

// ---------------------------------------------------------------------------
// QA (dev): gancho no window para testar o pipeline real no navegador —
// window.__dmRasterTest() devolve tamanho/cabecalho dos bytes ESC/POS.
// Nao existe na build de producao (NODE_ENV production na Vercel).
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  const larguraFixa = 560; // dots QA (mesmo default do pipeline)
  (window as unknown as Record<string, unknown>).__dmRasterTest = async (alvo?: string) => {
    const base = alvo?.replace(/-preview$/, '') || '';
    let html = base;
    let rotulo = base || 'inline';
    if (!html || base === 'danfe') {
      const [{ danfeFiscal80Html }, { DEMO_DANFE_69 }] = await Promise.all([
        import('./danfe80Html'), import('./danfeDemo'),
      ]);
      html = await danfeFiscal80Html(DEMO_DANFE_69, { raster: true });
      rotulo = 'danfe-demo';
    } else if (base === 'danfe-uso') {
      // variante USB (com @media screen) — prova de resistencia: o raster NAO
      // deve usar esta variante no app, mas se vier, a medicao detecta o scale.
      const [{ danfeFiscal80Html }, { DEMO_DANFE_69 }] = await Promise.all([
        import('./danfe80Html'), import('./danfeDemo'),
      ]);
      html = await danfeFiscal80Html(DEMO_DANFE_69);
      rotulo = 'danfe-usb';
    } else if (base === 'boleto') {
      const { miniBoleto80Html } = await import('./miniBoleto80Html');
      html = await miniBoleto80Html({ beneficiarioNome: 'DOCE MANIA', valor: 123.45, vencimento: '2026-12-05' }, { raster: true });
      rotulo = 'boleto';
    } else if (base === 'boleto-pix') {
      // QA: boleto COM PIX — prova a imagem data-URL (QR) dentro do foreignObject
      const { miniBoleto80Html } = await import('./miniBoleto80Html');
      html = await miniBoleto80Html({
        beneficiarioNome: 'DOCE MANIA', valor: 123.45, vencimento: '2026-12-05',
        codigoBarras: '07790000000164438000000003147415000145000000000001',
        pixCopiaECola: '00020126580014BR.GOV.BCB.PIX0136a1b2c3d4-e5f6-7890-abcd-ef12345678905204000053039865405123.455802BR5913DOCE MANIA6009SAO PAULO62070503***6304ABCD',
      }, { raster: true });
      rotulo = 'boleto-pix';
    }
    const bytes = await htmlParaEscposRaster(html);

    // Prévia visual (QA): mesmo SVG rasterizado em canvas — o dono/qa vê o
    // papel exatamente como a termica vai queimar os pontos.
    // BLOCO 196: a prévia replica o pipeline REAL (hi-res + média por dot +
    // limiar 1-bit) — o que aparece aqui é o papel com a nitidez nova.
    let preview: string | undefined;
    if (alvo?.endsWith('-preview')) {
      const med = await medirPoster(html);
      const alturaBase = Math.ceil((med.alturaPx * larguraFixa) / med.larguraPx) + 4;
      const areaFinal = larguraFixa * Math.max(1, alturaBase);
      const multPrev = areaFinal * 9 <= 12_000_000 ? 3 : areaFinal * 4 <= 12_000_000 ? 2 : 1;
      const { svg: svgPrev, alturaDots: alturaPrev } = construirSvgRaster(med.posterHtml, med.css, med.larguraPx, med.alturaPx, larguraFixa, multPrev);
      const imgPrev = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('FALHA_RASTERIZACAO_SVG'));
        i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgPrev);
      });
      const cHi = document.createElement('canvas');
      cHi.width = larguraFixa * multPrev;
      cHi.height = Math.min(alturaPrev * multPrev, 24000);
      const ctxHi = cHi.getContext('2d');
      if (ctxHi) {
        ctxHi.fillStyle = '#ffffff';
        ctxHi.fillRect(0, 0, cHi.width, cHi.height);
        ctxHi.drawImage(imgPrev, 0, 0);
        // Downsampling para os dots finais + limiar 1-bit (igual ao envio real)
        const dadosHi = ctxHi.getImageData(0, 0, cHi.width, cHi.height);
        const dados = multPrev > 1 ? reduzirMediaLuminancia(dadosHi, multPrev, larguraFixa, Math.min(alturaPrev, 8000)) : dadosHi;
        const bitsPrev = cortarLinhasVazias(bitsDoCanvas(dados, 168));
        const c = document.createElement('canvas');
        c.width = larguraFixa;
        c.height = bitsPrev.altura;
        const ctx = c.getContext('2d');
        if (ctx) {
          const imgData = ctx.createImageData(larguraFixa, bitsPrev.altura);
          for (let i = 0, p = 0; i < bitsPrev.bytes.length; i++) {
            const byte = bitsPrev.bytes[i];
            for (let b = 7; b >= 0 && p < imgData.data.length; b--) {
              const aceso = (byte >> b) & 1;
              imgData.data[p++] = aceso ? 0 : 255;
              imgData.data[p++] = aceso ? 0 : 255;
              imgData.data[p++] = aceso ? 0 : 255;
              imgData.data[p++] = 255;
            }
          }
          ctx.putImageData(imgData, 0, 0);
          preview = c.toDataURL('image/png');
        }
      }
    }

    return {
      rotulo,
      bytes: bytes.length,
      cabecalho: Array.from(bytes.slice(0, 12)).map((b) => b.toString(16).padStart(2, '0')),
      cauda: Array.from(bytes.slice(-8)).map((b) => b.toString(16).padStart(2, '0')),
      preview,
    };
  };
}
