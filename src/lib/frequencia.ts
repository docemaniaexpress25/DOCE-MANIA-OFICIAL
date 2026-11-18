/**
 * BLOCO 190 — FREQUÊNCIA DE ATENDIMENTO (regra do dono):
 *   SEMANAL   → aparece TODA semana no dia da visita (padrão de hoje).
 *   QUINZENAL → aparece a cada 2 semanas (a cada 15 dias).
 *   MENSAL    → aparece 1 vez a cada 4 semanas.
 *
 * O ciclo é ancorado no NÚMERO DA SEMANA ISO-8601 do ano: a
 * semana_referencia (1-4) diz em que posição do ciclo o cliente é
 * visitado. Determinístico e igual em todos os aparelhos — o admin
 * troca a frequência/âncora no cadastro e a Rota do Dia inteira obedece.
 *
 * Regras de vizinhança (pensadas para o roteiro):
 *   - Quinzenal com âncora 1 → semanas ISO 1, 3, 5, 7... (ímpares)
 *   - Quinzenal com âncora 2 → semanas ISO 2, 4, 6, 8... (pares)
 *   - Mensal com âncora 1 → semanas ISO 1, 5, 9, 13...
 *   - Mensal com âncora 2 → semanas ISO 2, 6, 10, 14... (etc.)
 *
 * Sem React, sem rede — testável por QA (mesmo padrão do BLOCO 184).
 */

export type FrequenciaTipo = 'SEMANAL' | 'QUINZENAL' | 'MENSAL';

export const FREQUENCIAS: FrequenciaTipo[] = ['SEMANAL', 'QUINZENAL', 'MENSAL'];

export function normalizarFrequencia(v: unknown): FrequenciaTipo {
  const s = String(v || '').toUpperCase();
  return s === 'QUINZENAL' || s === 'MENSAL' ? (s as FrequenciaTipo) : 'SEMANAL';
}

/** Ciclo da frequência: 1 = toda semana, 2 = a cada 2 semanas, 4 = a cada 4. */
export function cicloDe(frequencia: unknown): number {
  const f = normalizarFrequencia(frequencia);
  if (f === 'QUINZENAL') return 2;
  if (f === 'MENSAL') return 4;
  return 1;
}

/**
 * Número da semana ISO-8601 (1-53): a semana começa na SEGUNDA e a
 * primeira semana do ano é a que contém a primeira quinta-feira.
 */
export function numeroSemanaISO(data: Date): number {
  const d = new Date(Date.UTC(data.getFullYear(), data.getMonth(), data.getDate()));
  const diaSemana = d.getUTCDay() || 7; // dom=0 → 7 (semana ISO começa segunda)
  d.setUTCDate(d.getUTCDate() + 4 - diaSemana); // vai para a quinta da semana
  const inicioAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - inicioAno.getTime()) / 86400000 + 1) / 7);
}

/** Âncora válida dentro do ciclo (quinzenal: 1|2, mensal: 1-4, semanal: 1). */
export function normalizarSemanaReferencia(frequencia: unknown, semana: unknown): number {
  const ciclo = cicloDe(frequencia);
  const n = Math.max(1, Math.min(ciclo, Math.round(Number(semana) || 1)));
  return n;
}

/**
 * O cliente tem visita ESSA semana? SEMANAL sempre sim; quinzenal/mensal
 * só quando a semana ISO atual casa com a âncora do ciclo.
 */
export function visitaEssaSemana(
  frequencia: unknown,
  semanaReferencia: unknown,
  semanaISO: number,
): boolean {
  const ciclo = cicloDe(frequencia);
  if (ciclo === 1) return true;
  const ref = normalizarSemanaReferencia(frequencia, semanaReferencia);
  // ((sem-1) % ciclo) + 1 === ref — ex.: ciclo 2, ref 2, sem 4 → (3%2)+1=2 ✓
  return ((semanaISO - 1) % ciclo) + 1 === ref;
}

/** Rótulo curto para badges (rota/roteiro/lista de clientes). */
export function rotuloFrequencia(frequencia: unknown): string {
  const f = normalizarFrequencia(frequencia);
  if (f === 'QUINZENAL') return 'Quinzenal';
  if (f === 'MENSAL') return 'Mensal';
  return 'Semanal';
}

/** Rótulo do ciclo da âncora para o admin ("Semana A/B", "Semana 1-4"). */
export function rotuloSemanaReferencia(frequencia: unknown, semana: unknown): string {
  const ciclo = cicloDe(frequencia);
  if (ciclo === 1) return '';
  const ref = normalizarSemanaReferencia(frequencia, semana);
  return ciclo === 2 ? `Semana ${ref === 1 ? 'A' : 'B'}` : `Semana ${ref} do ciclo`;
}

/** Cliente fica fora da rota de hoje? (dia casa, mas frequência não manda) */
export function clienteForaDaSemana(
  frequencia: unknown,
  semanaReferencia: unknown,
  semanaISO: number,
): boolean {
  return !visitaEssaSemana(frequencia, semanaReferencia, semanaISO);
}
