/**
 * Autocomplete de EAN/GTIN (Bloco 13) — utilidades CLIENT-SIDE compartilhadas
 * pelo cadastro de produtos (Estoque Central / Admin).
 *
 * Fluxo: admin digita ou escaneia o codigo de barras -> ao completar um GTIN
 * valido (8/12/13/14 digitos), chama GET /api/ean e preenche nome, unidade e
 * (quando a fonte brasileira tiver) NCM/CEST — igual ao autocomplete de CNPJ
 * dos clientes.
 */

import { authHeaders } from '@/services/userService';

export interface EanBusca {
  ok: boolean;
  erro?: string;
  cached?: boolean;
  ean?: string;
  nome?: string;
  marca?: string;
  unidade?: string;
  ncm?: string;
  cest?: string;
  fonte?: string;
  temNcm?: boolean;
}

/** Somente digitos, maximo 14 (GTIN-14). */
export function soDigitosEan(v: string): string {
  return (v || '').replace(/\D/g, '').slice(0, 14);
}

/** Valida o digito verificador de GTIN-8/12/13/14. */
export function validaGtinLocal(d: string): boolean {
  if (![8, 12, 13, 14].includes(d.length)) return false;
  let soma = 0;
  d.slice(0, -1).split('').reverse().forEach((ch, i) => {
    soma += parseInt(ch, 10) * (i % 2 === 0 ? 3 : 1);
  });
  const dv = (10 - (soma % 10)) % 10;
  return dv === parseInt(d.slice(-1), 10);
}

/** EAN completo e valido = pronto para disparar a busca automatica. */
export function eanCompleto(digitos: string): boolean {
  return validaGtinLocal(digitos);
}

/** Consulta a base de produtos pela rota interna. Sempre resolve (nunca lanca). */
export async function buscarEanProduto(digitos: string): Promise<EanBusca> {
  try {
    const res = await fetch(`/api/ean?ean=${encodeURIComponent(digitos)}`, { headers: authHeaders() });
    const data = (await res.json()) as EanBusca;
    if (!res.ok || !data.ok) {
      return { ok: false, erro: data.erro || 'Produto nao encontrado pelo EAN. Preencha os dados manualmente.' };
    }
    return data;
  } catch {
    return { ok: false, erro: 'Falha de conexao ao consultar o EAN. Tente novamente.' };
  }
}

/** Monta a mensagem de feedback (banner do formulario) a partir da busca. */
export function mensagemEan(r: EanBusca): { msg: string; ok: boolean; temNcm?: boolean } {
  if (!r.ok) return { msg: `✖ ${r.erro || 'Produto nao encontrado pelo EAN. Preencha manualmente.'}`, ok: false };
  const fonte = r.fonte ? `via ${r.fonte}` : '';
  const marca = r.marca ? ` · ${r.marca}` : '';
  const nome = r.nome || 'Produto';
  const base = `✓ ${nome}${marca} — nome e unidade preenchidos automaticamente ${fonte}`.trim();
  if (r.temNcm) return { msg: `${base} · NCM preenchido`, ok: true, temNcm: true };
  return { msg: `${base}. Confira/complete o NCM`, ok: true, temNcm: false };
}
