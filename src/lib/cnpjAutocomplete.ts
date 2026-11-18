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

// =====================================================================
// BLOCO 132 (regra do dono): o cadastro aceita CPF E CNPJ no MESMO campo.
// Pessoa fisica com CPF valido = NFC-e identificada pelo cadastro (BLOCO 128);
// empresa com CNPJ = NF-e. O mask decide pelo comprimento enquanto digita:
// ate 11 digitos formata como CPF; a partir do 12o reformata como CNPJ.
// =====================================================================

/** Tipo do documento pelos digitos: 'CPF' (11), 'CNPJ' (14) ou '' (incompleto). */
export function tipoDocDigitos(v: string): 'CPF' | 'CNPJ' | '' {
  const d = (v || '').replace(/\D/g, '');
  if (d.length === 11) return 'CPF';
  if (d.length === 14) return 'CNPJ';
  return '';
}

/**
 * Mascara progressiva CPF/CNPJ no campo unico:
 * 999999999 -> 999.999.999 (CPF) · 99999999999-99 continua -> 99.999.999/9999-99.
 * Enquanto o vendedor digita um CNPJ, o formato muda de CPF para CNPJ ao
 * passar do 11o digito (padrao dos ERPs brasileiros).
 */
export function mascararCpfCnpj(v: string): string {
  const d = (v || '').replace(/\D/g, '');
  if (d.length <= 11) return mascararCpf(d);
  return mascararCnpj(d);
}

/**
 * Valida CPF OU CNPJ (digitos verificadores). true = documento ok para a
 * NFC-e identificada; CNPJ valido (14 dig) tambem libera a NF-e.
 */
export function validaCpfOuCnpj(v: string): boolean {
  const d = (v || '').replace(/\D/g, '');
  const tipo = tipoDocDigitos(d);
  if (tipo === 'CPF') return validaCpf(d);
  if (tipo === 'CNPJ') return validaCnpj(d);
  return false;
}

/** Valida CNPJ (digitos verificadores). true se valido. */
export function validaCnpj(valor: string): boolean {
  const s = (valor || '').replace(/\D/g, '');
  if (s.length !== 14 || /^(\d)\1{13}$/.test(s)) return false;
  const calc = (len: number): number => {
    let soma = 0;
    let pos = len - 7;
    for (let i = len; i >= 1; i--) {
      soma += parseInt(s.charAt(len - i), 10) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === parseInt(s[12], 10) && calc(13) === parseInt(s[13], 10);
}

/** Valida CPF (digitos verificadores). Retorna true se valido. */
export function validaCpf(valor: string): boolean {
  const s = (valor || '').replace(/\D/g, '');
  if (s.length !== 11 || /^(\d)\1{10}$/.test(s)) return false;
  const calc = (len: number): number => {
    let soma = 0;
    for (let i = 0; i < len; i++) soma += parseInt(s[i], 10) * (len + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === parseInt(s[9], 10) && calc(10) === parseInt(s[10], 10);
}

/**
 * Apto a NF-e — BLOCO 77 (regra do dono): a NF-e NÃO é batida por este app
 * (o dono emite no sistema externo dele); o app só CONTROLA a venda como NF.
 * Por enquanto a exigência do cadastro é SOMENTE: CNPJ válido + email.
 * Os demais dados fiscais (razão social, endereço, bairro, município, UF)
 * continuam sendo usados se existirem, mas NÃO bloqueiam mais.
 */
export function clienteAptoNfe(c: {
  cnpj?: string;
  razaoSocial?: string;
  endereco?: string;
  bairro?: string;
  enderecoMunicipio?: string;
  enderecoUf?: string;
  email?: string;
}): boolean {
  const digitos = (c.cnpj || '').replace(/\D/g, '');
  return digitos.length === 14 && !!c.email?.trim();
}

/** Monta a mensagem de feedback (banner do formulario) a partir da busca. */
export function mensagemCnpj(r: CnpjBusca): { msg: string; ok: boolean; endereco?: string } {
  if (!r.ok) return { msg: `✖ ${r.erro || 'CNPJ nao encontrado. Preencha manualmente.'}`, ok: false };
  const extras = [r.simples ? 'Simples Nacional' : '', r.mei ? 'MEI' : '', r.email ? 'email NF-e incluido' : ''].filter(Boolean).join(' · ');
  const nome = r.razaoSocial || r.nomeFantasia || 'CNPJ';
  const base = `✓ ${nome} — ${r.situacao || 'Cadastrado'}${extras ? ` · ${extras}` : ''}`;
  if (r.situacaoOk === false) {
    return { msg: `⚠ ${base} — situacao irregular na Receita, confira antes de emitir NF-e`, ok: false, endereco: r.enderecoCompleto };
  }
  return { msg: `${base} — dados fiscais preenchidos automaticamente`, ok: true, endereco: r.enderecoCompleto };
}
