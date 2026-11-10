import { trocasPartes, trocasValorNumero } from '@/lib/trocasTexto';

/**
 * BLOCO 98 — TROCAS BEM VISIVEIS (regra do dono):
 * "Deixe o espacamento correto, justificado, algo que fique bem visivel e
 *  facil de entender" + valor em R$ de PRECO DE CUSTO (a entrega devolve
 *  produtos que fecham esse valor).
 *
 * Um item por linha (•), texto justificado, espacamento uniforme e o valor
 * de custo num chip laranja no cabecalho — nunca mais texto corrido com
 * virgulas espremidas.
 */
export default function TrocasBox({
  trocas,
  valor,
  className = '',
}: {
  trocas: string | null | undefined;
  valor?: number | string | null;
  className?: string;
}) {
  const { itens, obs } = trocasPartes(trocas);
  const custo = trocasValorNumero(valor);
  if (itens.length === 0 && obs.length === 0 && custo === null) return null;
  return (
    <div className={`bg-orange-50 border border-orange-100 rounded-xl px-3 py-2.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[8px] font-black text-orange-400 uppercase tracking-widest">
          <i className="fa-solid fa-right-left mr-1"></i>Trocas — devolver produtos
        </p>
        {custo !== null && (
          <span
            title="Valor das trocas em PREÇO DE CUSTO — a entrega leva produtos que fechem esse valor"
            className="text-[9px] font-black text-white bg-orange-500 rounded-md px-1.5 py-0.5 uppercase shrink-0"
          >
            R$ {custo.toFixed(2).replace('.', ',')} <span className="opacity-80">(custo)</span>
          </span>
        )}
      </div>
      {itens.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {itens.map((it, i) => (
            <li key={i} className="text-[10px] font-bold text-orange-800 leading-snug text-justify">
              • {it}
            </li>
          ))}
        </ul>
      )}
      {obs.length > 0 && (
        <p className="text-[9px] font-semibold text-orange-600 mt-1.5 pt-1.5 border-t border-orange-100 leading-snug text-justify">
          <span className="font-black uppercase">Obs:</span> {obs.join(' — ')}
        </p>
      )}
    </div>
  );
}
