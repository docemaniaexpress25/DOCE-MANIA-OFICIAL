/**
 * BLOCO 232 — VALOR POR EXTENSO (pt-BR) para o RECIBO do pagamento ao David.
 * Uso: valorPorExtenso(1234.56) -> "um mil, duzentos e trinta e quatro reais
 * e cinquenta e seis centavos". Sem dependências — client e server.
 */

const UNI = [
  'zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove',
];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEN = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** 0..999 por extenso (sem moeda). '' para 0. */
function tresDigitos(n: number): string {
  if (n <= 0 || n >= 1000) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CEN[c]);
  if (r) {
    if (r < 20) partes.push(UNI[r]);
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      partes.push(u ? `${DEZ[d]} e ${UNI[u]}` : DEZ[d]);
    }
  }
  return partes.join(' e ');
}

/** Número inteiro por extenso (0..999.999.999.999). */
function inteiroPorExtenso(n: number): string {
  if (n === 0) return 'zero';
  const bil = Math.floor(n / 1_000_000_000);
  const mih = Math.floor((n % 1_000_000_000) / 1_000_000);
  const mil = Math.floor((n % 1_000_000) / 1_000);
  const un = n % 1_000;

  const grupos: string[] = [];
  if (bil) grupos.push(bil === 1 ? 'um bilhão' : `${tresDigitos(bil)} bilhões`);
  if (mih) grupos.push(mih === 1 ? 'um milhão' : `${tresDigitos(mih)} milhões`);
  if (mil) grupos.push(mil === 1 ? 'mil' : `${tresDigitos(mil)} mil`);
  if (un) grupos.push(tresDigitos(un));

  // Conector do ÚLTIMO grupo: "e" quando o resto é centena exata ou menor
  // que 100 ("mil e cem", "duzentos mil e trinta"); vírgula nos demais casos
  // (norma de escrita). BLOCO 234: join manual — o join(', ') genérico com
  // conector dentro do grupo gerava vírgula DUPLA ("cinco mil, , oitocentos").
  let texto = grupos[0] || '';
  for (let i = 1; i < grupos.length; i++) {
    const ehUltimo = i === grupos.length - 1;
    const ultimoComE = ehUltimo && un > 0 && (un < 100 || un % 100 === 0);
    texto += ultimoComE ? ' e ' : ', ';
    texto += grupos[i];
  }
  return texto;
}

/** Valor monetário por extenso em reais: valorPorExtenso(1234.56). */
export function valorPorExtenso(v: number): string {
  const n = Math.round(Number(v || 0) * 100) / 100;
  const negativo = n < 0;
  const abs = Math.abs(n);
  const reais = Math.floor(abs);
  const centavos = Math.round((abs - reais) * 100);

  let texto = '';
  if (reais > 0) {
    const intTxt = inteiroPorExtenso(reais);
    // "um milhão DE reais" / "dois milhões DE reais" — termina em milhão/bilhão
    // pede a preposição "de"; os demais ("...mil reais") não pedem.
    const terminaGrupoDe = /(milh|bilh)(ão|ões)$/.test(intTxt);
    texto += `${intTxt} ${reais === 1 ? 'real' : terminaGrupoDe ? 'de reais' : 'reais'}`;
  }
  if (centavos > 0) {
    const cx = tresDigitos(centavos);
    texto += texto
      ? ` e ${cx} ${centavos === 1 ? 'centavo' : 'centavos'}`
      : `${cx} ${centavos === 1 ? 'centavo' : 'centavos'}`;
  }
  if (!texto) texto = 'zero real';
  if (negativo) texto = `menos ${texto}`;
  return texto;
}
