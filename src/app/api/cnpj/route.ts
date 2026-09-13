import { NextRequest, NextResponse } from 'next/server';
import { sessionFromRequest } from '@/lib/session';
import { validaCpfCnpj } from '@/lib/focusNfe';

/**
 * CNPJ AUTOCOMPLETE (Bloco 10.1) — consulta dados de cadastro na Receita
 * Federal para preencher automaticamente o cliente no cadastro (Admin e
 * Vendedor). Usada na emissao de NF-e: quanto mais completo o cadastro,
 * menor a chance de rejeicao da SEFAZ.
 *
 * GET /api/cnpj?cnpj=00000000000000   (Bearer session obrigatoria)
 *
 * Fontes, em ordem:
 *   1. BrasilAPI     — https://brasilapi.com.br/api/cnpj/v1/{cnpj}
 *   2. Minha Receita — https://minhareceita.org/{cnpj}  (fallback)
 *
 * Sem SQL, sem env var, sem chave de API. Cache em memoria por 24h
 * por instancia serverless (mesma consulta repetida nao bate na fonte).
 */

const BAD = (status: number, erro: string) =>
  NextResponse.json({ ok: false, erro }, { status });

export interface CnpjInfo {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  endereco: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  telefone: string;
  situacao: string;
  situacaoOk: boolean;
  simples: boolean;
  mei: boolean;
}

type CacheEntry = { data: CnpjInfo; exp: number };
const g = globalThis as { __dmCnpjCache?: Map<string, CacheEntry> };
const CACHE = (g.__dmCnpjCache = g.__dmCnpjCache || new Map<string, CacheEntry>());
const TTL_MS = 24 * 60 * 60 * 1000;

const soDigitos = (v: unknown): string => String(v ?? '').replace(/\D/g, '');
const str = (obj: Record<string, unknown>, k: string): string => String(obj[k] ?? '').trim();

function formatarCnpj(digitos: string): string {
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-${digitos.slice(12)}`;
}

function formatarCep(v: unknown): string {
  const d = soDigitos(v);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : String(v ?? '').trim();
}

function formatarTelefone(v: unknown): string {
  const d = soDigitos(v);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(v ?? '').trim();
}

async function fetchJson(url: string, timeoutMs = 9000): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function normalizar(digitos: string, src: Record<string, unknown>): CnpjInfo {
  const logradouro = str(src, 'logradouro');
  const tipoLog = str(src, 'descricao_tipo_de_logradouro');
  const endereco =
    tipoLog && !logradouro.toUpperCase().startsWith(tipoLog.toUpperCase())
      ? `${tipoLog} ${logradouro}`.trim()
      : logradouro;

  const situacao = (str(src, 'descricao_situacao_cadastral') || str(src, 'situacao_cadastral') || 'INDEFINIDA').toUpperCase();

  return {
    cnpj: formatarCnpj(digitos),
    razaoSocial: str(src, 'razao_social'),
    nomeFantasia: str(src, 'nome_fantasia'),
    endereco,
    numero: str(src, 'numero'),
    bairro: str(src, 'bairro'),
    municipio: str(src, 'municipio'),
    uf: str(src, 'uf').toUpperCase(),
    cep: formatarCep(src.cep),
    telefone: formatarTelefone(src.ddd_telefone_1 || src.ddd_telefone_2),
    situacao,
    situacaoOk: situacao === 'ATIVA',
    simples: src.opcao_pelo_simples === true,
    mei: src.opcao_pelo_mei === true,
  };
}

export async function GET(req: NextRequest) {
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');

  const digitos = soDigitos(req.nextUrl.searchParams.get('cnpj'));
  if (!digitos) return BAD(400, 'Informe o CNPJ.');
  if (validaCpfCnpj(digitos) !== 'CNPJ') {
    return BAD(422, 'CNPJ invalido (digitos verificadores nao conferem). Confira o numero.');
  }

  const cached = CACHE.get(digitos);
  if (cached && cached.exp > Date.now()) {
    return NextResponse.json({ ok: true, cached: true, ...cached.data });
  }

  // 1) BrasilAPI -> 2) Minha Receita
  const br = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`);
  const src = br && br.razao_social ? br : null;
  const mr = src ? null : await fetchJson(`https://minhareceita.org/${digitos}`);
  const fonte = src || (mr && mr.razao_social ? mr : null);

  if (!fonte) {
    return BAD(
      502,
      'Nao foi possivel consultar esse CNPJ agora (Receita indisponivel ou CNPJ nao encontrado). Preencha os dados manualmente ou tente de novo.'
    );
  }

  const info = normalizar(digitos, fonte);
  CACHE.set(digitos, { data: info, exp: Date.now() + TTL_MS });
  return NextResponse.json({ ok: true, cached: false, ...info });
}
