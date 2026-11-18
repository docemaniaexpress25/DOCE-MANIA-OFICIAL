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
 *   3. O SVG vira Image -> canvas -> luminancia -> LIMIAR (1-bit: ponto
 *      queimado ou nao) -> bytes por linha (70 bytes/linha).
 *   4. Embala no comando GS v 0 (raster bit-image) + alimentacao + corte.
 *
 * O envio usa o MESMO bluetoothPrinterService (fila, reconnect, retry por
 * chunk) com chunk maior (300 bytes) e intervalo menor (10ms) — o texto
 * continua com o ritmo de sempre (100/40ms).
 *
 * FALLBACK: se a rasterizacao falhar num navegador (foreignObject/canvas
 * indisponivel), o chamador volta para o TEXTO 48 colunas de sempre — a
 * impressao nunca morre. (Chrome/Edge no Android/PC, que sao os aparelhos
 * com Web Bluetooth, suportam todo o caminho de raster.)
 */

export interface OpcoesRaster {
  /** Largura da imagem em dots (80mm = 560: 70mm x 8 dots/mm @ 203dpi). */
  larguraDots?: number;
  /** Luminancia (0..255) abaixo da qual o ponto e queimado. 168 = texto mais escuro (reforco). */
  limiar?: number;
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
// 4) PURA — monta o SVG <foreignObject> na resolucao da cabeca termica
// ---------------------------------------------------------------------------
export function construirSvgRaster(
  posterHtml: string,
  css: string,
  larguraPx: number,
  alturaPx: number,
  larguraDots: number,
): { svg: string; alturaDots: number } {
  const escala = larguraDots / larguraPx;
  const alturaDots = Math.ceil(alturaPx * escala) + 4;
  const px = Math.ceil(larguraPx);
  // Reforco de traco (o USB usa -webkit-text-stroke 0.15px; no raster vai um
  // pouco mais grosso para compensar o 1-bit — se o navegador ignorar, no-op).
  const traco = `<style>.poster{-webkit-text-stroke:0.22px #000}</style>`;
  // CSS injetado também precisa ser XML-seguro (o texto do <style> é parseado
  // como XML: `&` ou `<` cru quebrariam — o XMLSerializer do poster não cobre
  // o css passado como string).
  const cssXml = String(css || '').replace(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g, '&amp;').replace(/<(?![!?a-zA-Z/])/g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${larguraDots}" height="${alturaDots}">`
    + `<foreignObject width="${larguraDots}" height="${alturaDots}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;width:${larguraDots}px;height:${alturaDots}px;background:#ffffff;">`
    + `<div style="margin:0;padding:0;width:${px}px;background:#ffffff;transform:scale(${escala.toFixed(6)});transform-origin:0 0;">`
    + `<style>${cssXml}</style>`
    + traco
    + xmlSafePoster(posterHtml)
    + `</div></div></foreignObject></svg>`;
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
// 6) DOM — pipeline completo: HTML -> SVG -> canvas -> bits -> ESC/POS
// ---------------------------------------------------------------------------
export async function htmlParaEscposRaster(html: string, opcoes?: OpcoesRaster): Promise<Uint8Array> {
  if (typeof document === 'undefined') throw new Error('SEM_DOCUMENTO_RASTER');
  const larguraDots = opcoes?.larguraDots ?? 560; // 70mm x 8 dots/mm (203dpi)
  const limiar = opcoes?.limiar ?? 168;

  const med = await medirPoster(html);
  const { svg, alturaDots } = construirSvgRaster(med.posterHtml, med.css, med.larguraPx, med.alturaPx, larguraDots);

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

  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('FALHA_RASTERIZACAO_SVG'));
    i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });

  const canvas = document.createElement('canvas');
  canvas.width = larguraDots;
  canvas.height = alturaDots;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('SEM_CANVAS_RASTER');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, larguraDots, alturaDots);
  ctx.imageSmoothingEnabled = true;
  try { ctx.imageSmoothingQuality = 'high'; } catch { /* navegadores antigos */ }
  ctx.drawImage(img, 0, 0);

  const dados = ctx.getImageData(0, 0, larguraDots, alturaDots);
  const bits = cortarLinhasVazias(bitsDoCanvas(dados, limiar));
  if (bits.altura < 10) throw new Error('RASTER_VAZIO');
  return comandoEscposRaster(bits);
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
    let preview: string | undefined;
    if (alvo?.endsWith('-preview')) {
      const med = await medirPoster(html);
      const { svg: svgPrev, alturaDots: alturaPrev } = construirSvgRaster(med.posterHtml, med.css, med.larguraPx, med.alturaPx, larguraFixa);
      const imgPrev = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('FALHA_RASTERIZACAO_SVG'));
        i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgPrev);
      });
      const c = document.createElement('canvas');
      c.width = larguraFixa;
      c.height = Math.min(alturaPrev, 8000);
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(imgPrev, 0, 0);
        preview = c.toDataURL('image/png');
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
