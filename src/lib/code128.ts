/**
 * code128.ts — CODIGO DE BARRAS CODE 128 em SVG (puro, sem dependencia).
 *
 * O MINI DANFE 80mm do dono (modelo de referencia) imprime a CHAVE DE ACESSO
 * de 44 digitos da NF-e como codigo de barras CODE 128 — o mesmo padrao que a
 * DANFE A4 oficial usa. A chave e sempre numerica (44 digitos), entao sai no
 * Code 128-C (2 digitos por simbolo — mais denso e mais facil de escanear).
 *
 * Saida: SVG com <rect> por barra, viewBox em MODULOS (largura exata da
 * simbologia) e tamanho fisico em mm — na termica 80mm cada modulo cai em
 * ~2 pontos da cabeca de impressao (203 dpi), dentro do padrao de escaneamento
 * do GS1 (X minimo 0,19mm). Zona de silencio de 10 modulos de cada lado.
 *
 * Tabela de padroes Code 128 (BS 5.1 / padrao nacional — mesmos valores da
 * tabela oficial: 6 digitos bar/space por simbolo, stop com 7).
 */

const PADROES: Record<number, string> = {
  0: '212222', 1: '222122', 2: '222221', 3: '121223', 4: '121322',
  5: '131222', 6: '122213', 7: '122312', 8: '132212', 9: '221213',
  10: '221312', 11: '231212', 12: '112232', 13: '122132', 14: '122231',
  15: '113222', 16: '123122', 17: '123221', 18: '223211', 19: '221132',
  20: '221231', 21: '213212', 22: '223112', 23: '312131', 24: '311222',
  25: '321122', 26: '321221', 27: '312212', 28: '322112', 29: '322211',
  30: '212123', 31: '212321', 32: '232121', 33: '111323', 34: '131123',
  35: '131321', 36: '112313', 37: '132113', 38: '132311', 39: '211313',
  40: '231113', 41: '231311', 42: '112133', 43: '112331', 44: '132131',
  45: '113123', 46: '113321', 47: '133121', 48: '313121', 49: '211331',
  50: '231131', 51: '213113', 52: '213311', 53: '213131', 54: '311123',
  55: '311321', 56: '331121', 57: '312113', 58: '312311', 59: '332111',
  60: '314111', 61: '221411', 62: '431111', 63: '111224', 64: '111422',
  65: '121124', 66: '121421', 67: '141122', 68: '141221', 69: '112214',
  70: '112412', 71: '122114', 72: '122411', 73: '142112', 74: '142211',
  75: '241211', 76: '221114', 77: '413111', 78: '241112', 79: '134111',
  80: '111242', 81: '121142', 82: '121241', 83: '114212', 84: '124112',
  85: '124211', 86: '411212', 87: '421112', 88: '421211', 89: '212141',
  90: '214121', 91: '412121', 92: '111143', 93: '111341', 94: '131141',
  95: '114113', 96: '114311', 97: '411113', 98: '411311', 99: '113141',
  100: '114131', 101: '311141', 102: '411131',
  103: '211412', // START A
  104: '211214', // START B
  105: '211232', // START C
  106: '2331112', // STOP
};

const START_C = 105;
const STOP = 106;
const QUIET = 10; // zona de silencio em modulos (padrao GS1)

export interface Code128SvgOptions {
  /** Largura fisica do SVG em mm (padrao 75mm = largura util do papel 80mm) */
  larguraMm?: number;
  /** Altura das barras em mm (padrao 12mm, como no modelo do dono) */
  alturaMm?: number;
}

/**
 * Gera o SVG do codigo de barras Code 128 do conteudo informado.
 * Conteudo todo numerico com tamanho PAR -> Code 128-C; caso contrario
 * Code 128-B (letras e digitos 1:1).
 */
export function code128Svg(conteudo: string, opts: Code128SvgOptions = {}): string {
  const dados = String(conteudo || '').trim();
  if (!dados) return '';

  // Sequencia de valores dos simbolos
  const simbolos: number[] = [];
  const soDigitos = /^\d+$/.test(dados);
  if (soDigitos && dados.length % 2 === 0) {
    simbolos.push(START_C);
    for (let i = 0; i < dados.length; i += 2) simbolos.push(Number(dados.substring(i, i + 2)));
  } else {
    simbolos.push(104); // START B
    for (const ch of dados) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) return ''; // caractere fora do alfabeto — sem barras
      simbolos.push(c - 32);
    }
  }

  // Digito de verificacao: (valor do start + SOMA(i * valor)) mod 103
  let soma = simbolos[0];
  for (let i = 1; i < simbolos.length; i++) soma += i * simbolos[i];
  simbolos.push(soma % 103);
  simbolos.push(STOP);

  // Converte os padroes em barras (x em modulos, largura em modulos)
  let x = 0;
  const barras: { x: number; w: number }[] = [];
  for (const v of simbolos) {
    const p = PADROES[v];
    if (!p) return '';
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]);
      if (i % 2 === 0) barras.push({ x, w }); // posicoes pares = barra
      x += w;                                  // impares = espaco
    }
  }
  const totalModulos = x; // sem zona de silencio (o viewBox comeca nela)

  const larguraMm = opts.larguraMm && opts.larguraMm > 0 ? opts.larguraMm : 75;
  const alturaMm = opts.alturaMm && opts.alturaMm > 0 ? opts.alturaMm : 12;
  const totalComQuiet = totalModulos + QUIET * 2;
  const alturaMod = alturaMm / (larguraMm / totalComQuiet); // mantem proporcao mm/altura

  const rects = barras
    .map((b) => `<rect x="${(b.x + QUIET).toFixed(3)}" y="0" width="${b.w}" height="${alturaMod.toFixed(3)}" fill="#000"></rect>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalComQuiet} ${alturaMod.toFixed(3)}" ` +
    `width="${larguraMm}mm" height="${alturaMm}mm" preserveAspectRatio="none" role="img" aria-label="Codigo de barras da chave de acesso">${rects}</svg>`;
}
