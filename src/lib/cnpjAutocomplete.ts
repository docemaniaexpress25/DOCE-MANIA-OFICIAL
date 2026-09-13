/**
 * Autocomplete de CNPJ (Bloco 10.1) — utilidades CLIENT-SIDE compartilhadas
 * pelo cadastro de clientes no AdminDashboard e no VendedorDashboard.
 *
 * Fluxo: vendedor/admin digita o CNPJ -> ao completar 14 digitos, chama
 * GET /api/cnpj (Receita Federal via BrasilAPI/minhareceita) e preenche
 * os dados fiscais do cliente. Sem CNPJ no cadastro, a venda emite NFC-e
 * de consumidor (decisao automatica no /api/notas).
 */

import { authHeaders } from '@/services/userService';

export interface CnpjBusca {
  ok: boolean;
  erro?: string;
  cached?: boolean;
  cnpj?: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  endereco?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  telefone?: string;
  situacao?: string;
  situacaoOk?: boolean;
  simples?: boolean;
  mei?: boolean;
}

/** Mascara progressiva: 00000000000000 -> 00.000.000/0000-00 */
export function mascararCnpj(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Consulta a Receita via rota interna. Sempre resolve (nunca lanca). */
export async function buscarCnpjReceita(digitos: string): Promise<CnpjBusca> {
  try {
    const res = await fetch(`/api/cnpj?cnpj=${encodeURIComponent(digitos)}`, { headers: authHeaders() });
    const data = (await res.json()) as CnpjBusca;
    if (!res.ok || !data.ok) {
      return { ok: false, erro: data.erro || 'CNPJ nao encontrado. Preencha os dados manualmente.' };
    }
    return data;
  } catch {
    return { ok: false, erro: 'Falha de conexao ao consultar o CNPJ. Tente novamente.' };
  }
}

/** Monta a mensagem de feedback (banner do formulario) a partir da busca. */
export function mensagemCnpj(r: CnpjBusca): { msg: string; ok: boolean } {
  if (!r.ok) return { msg: `✖ ${r.erro || 'CNPJ nao encontrado. Preencha manualmente.'}`, ok: false };
  const extras = [r.simples ? 'Simples Nacional' : '', r.mei ? 'MEI' : ''].filter(Boolean).join(' · ');
  const nome = r.razaoSocial || r.nomeFantasia || 'CNPJ';
  const base = `✓ ${nome} — ${r.situacao || 'Cadastrado'}${extras ? ` · ${extras}` : ''}`;
  if (r.situacaoOk === false) {
    return { msg: `⚠ ${base} — situacao irregular na Receita, confira antes de emitir NF-e`, ok: false };
  }
  return { msg: `${base} — dados fiscais preenchidos automaticamente`, ok: true };
}
