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
  /** Endereço completo em uma linha (logradouro, nº - bairro - cidade/UF - CEP) */
  enderecoCompleto?: string;
  /** Email publicado na Receita (raro — normalmente preencher manual) */
  email?: string;
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

/** Mascara progressiva de CPF: 00000000000 -> 000.000.000-00 */
export function mascararCpf(v: string): string {
  const d = (v || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Valida CPF (digitos verificadores). Retorna true se valido. */
export function validaCpf(valor: string): boolean {
  const s = (valor || '').replace(/\D/g, '');
  if (s.length !== 11 || /^((\d)\1{10})$/.test(s)) return false;
  const calc = (len: number): number => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += parseInt(s[i], 10) * (len + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === parseInt(s[9], 10) && calc(10) === parseInt(s[10], 10);
}

/**
 * Apto a NF-e: cliente com CNPJ valido + cadastro fiscal completo
 * (razao social, endereco, bairro, municipio, UF). Usado para habilitar
 * o botao "Emitir NF-e" e sinalizar a aptidao no cadastro.
 */
export function clienteAptoNfe(c: {
  cnpj?: string;
  razaoSocial?: string;
  endereco?: string;
  bairro?: string;
  enderecoMunicipio?: string;
  enderecoUf?: string;
}): boolean {
  const digitos = (c.cnpj || '').replace(/\D/g, '');
  return digitos.length === 14
    && !!c.razaoSocial?.trim()
    && !!c.endereco?.trim()
    && !!c.bairro?.trim()
    && !!c.enderecoMunicipio?.trim()
    && !!c.enderecoUf?.trim();
}

/** Monta a mensagem de feedback (banner do formulario) a partir da busca. */
export function mensagemCnpj(r: CnpjBusca): { msg: string; ok: boolean; endereco?: string } {
  if (!r.ok) return { msg: `✖ ${r.erro || 'CNPJ nao encontrado. Preencha manualmente.'}`, ok: false };
  const extras = [r.simples ? 'Simples Nacional' : '', r.mei ? 'MEI' : ''].filter(Boolean).join(' · ');
  const nome = r.razaoSocial || r.nomeFantasia || 'CNPJ';
  const base = `✓ ${nome} — ${r.situacao || 'Cadastrado'}${extras ? ` · ${extras}` : ''}`;
  if (r.situacaoOk === false) {
    return { msg: `⚠ ${base} — situacao irregular na Receita, confira antes de emitir NF-e`, ok: false, endereco: r.enderecoCompleto };
  }
  return { msg: `${base} — dados fiscais preenchidos automaticamente`, ok: true, endereco: r.enderecoCompleto };
}
