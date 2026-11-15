/**
 * BLOCO 98 — FORMATO CANONICO das TROCAS (regra do dono):
 *
 * "quando a gente escreve as trocas fica tudo errado — espacamento, virgulas,
 *  layout. Arruma. E as trocas nem sempre sao pelos mesmos produtos, entao
 *  precisa escrever quanto valem em REAIS de PRECO DE CUSTO — a gente devolve
 *  itens que fecham esse valor de custo."
 *
 * O texto nasce no PDV (autocomplete junta os itens com ", ") e pode ter
 * linhas "OBS: ..." (Bloco 41). Este helper e a UNICA fonte da verdade para
 * EXIBIR: divide em itens (um por linha) e separa as observacoes — usado nos
 * cards da fila, no aceite da entrega, na separacao do secretario e no cupom
 * (trocasTexto nunca e re-renderizado como texto corrido de novo).
 */

export interface TrocasPartes {
  /** Itens de troca — um por entrada (ex.: "1 Lays sour cream 62g") */
  itens: string[];
  /** Observacoes (linhas "OBS: ...") */
  obs: string[];
}

/**
 * Divide o texto bruto de sales.trocas em itens/observacoes.
 * Separadores: quebra de linha, ";" e "," (o autocomplete do PDV grava com ", ").
 * Linhas "OBS:" viram observacao; o resto, item de troca.
 */
export function trocasPartes(raw: string | null | undefined): TrocasPartes {
  const itens: string[] = [];
  const obs: string[] = [];
  String(raw || '')
    .split(/\r?\n|;/)
    .forEach(seg => {
      seg
        .split(',')
        .forEach(p => {
          const t = p.trim().replace(/\s+/g, ' ');
          if (!t || !/[a-z0-9]/i.test(t)) return;
          // Linhas "OBS: ..." viram observacao (em qualquer posicao — legado
          // grava depois de virgula tambem); o resto e item de troca.
          if (/^obs\s*[:\-]/i.test(t)) {
            const o = t.replace(/^obs\s*[:\-]\s*/i, '').trim();
            if (o) obs.push(o);
            return;
          }
          itens.push(t);
        });
    });
  return { itens, obs };
}

/** Valor em R$ (preco de custo) das trocas — null quando vazio/invalido. */
export function trocasValorNumero(valor: number | string | null | undefined): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const v = Number(valor);
  return isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}
