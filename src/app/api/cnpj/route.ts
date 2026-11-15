import { NextRequest, NextResponse } from 'next/server';
import { sessionFromRequest } from '@/lib/session';
import { validaCpfCnpj } from '@/lib/focusNfe';
import { isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';

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
 *   3. OpenCNPJ      — https://api.opencnpj.org/{cnpj}  (fallback)
 *
 * BLOCO 140 (regra do dono): o EMAIL da empresa — que vai no XML/destinatario
 * da NF-e — so existe na base aberta completa (OpenCNPJ/ReceitaWS). Testado
 * real: BrasilAPI e Minha Receita voltam email vazio; OpenCNPJ traz (ex.
 * Magazine Luiza -> fiscal.estadual@magazineluiza.com.br). Entao:
 *   - a fonte escolhida (1/2/3) e a base do cadastro;
 *   - se ela NAO trouxe email, bate na OpenCNPJ best-effort so para
 *     completar o email — quanto mais completo o cadastro, mais completo
 *     o XML da NF-e (destinatario.email).
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
  /** Endereco completo em uma linha (logradouro, numero - bairro - cidade/UF - CEP) */
  enderecoCompleto: string;
  /** Email na Receita (quando a empresa o publicou — raro; senao preencher manual) */
  email: string;
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

/**
 * BLOCO 140: a OpenCNPJ usa nomes de campo proprios (tipo_logradouro,
 * telefones[] com ddd/numero, situacao "Ativa" em title case). Traduz para a
 * MESMA forma que o normalizador ja entende (formato BrasilAPI/Minha Receita).
 */
function normalizarOpencnpj(oc: Record<string, unknown>): Record<string, unknown> {
  const tels = Array.isArray(oc.telefones) ? (oc.telefones as Record<string, unknown>[]) : [];
  const t1 = tels.find(t => t && t.is_fax !== true) || null;
  const bool = (v: unknown) => v === true || v === 'true' || v === 'True';
  return {
    razao_social: oc.razao_social,
    nome_fantasia: oc.nome_fantasia,
    descricao_tipo_de_logradouro: oc.tipo_logradouro,
    logradouro: oc.logradouro,
    numero: oc.numero,
    bairro: oc.bairro,
    municipio: oc.municipio,
    uf: oc.uf,
    cep: oc.cep,
    ddd_telefone_1: t1 ? `${t1.ddd || ''}${t1.numero || ''}` : '',
    email: oc.email,
    descricao_situacao_cadastral: oc.situacao_cadastral,
    opcao_pelo_simples: bool(oc.opcao_simples),
    opcao_pelo_mei: bool(oc.opcao_mei),
  };
}

function normalizar(digitos: string, src: Record<string, unknown>): CnpjInfo {
  const logradouro = str(src, 'logradouro');
  const tipoLog = str(src, 'descricao_tipo_de_logradouro');
  const endereco =
    tipoLog && !logradouro.toUpperCase().startsWith(tipoLog.toUpperCase())
      ? `${tipoLog} ${logradouro}`.trim()
      : logradouro;

  const numero = str(src, 'numero');
  const bairro = str(src, 'bairro');
  const municipio = str(src, 'municipio');
  const uf = str(src, 'uf').toUpperCase();
  const cep = formatarCep(src.cep);

  const enderecoCompleto = [
    endereco && numero ? `${endereco}, ${numero}` : endereco,
    bairro,
    municipio && uf ? `${municipio}/${uf}` : municipio || uf,
    cep ? `CEP ${cep}` : '',
  ].filter(Boolean).join(' - ');

  const situacao = (str(src, 'descricao_situacao_cadastral') || str(src, 'situacao_cadastral') || 'INDEFINIDA').toUpperCase();

  return {
    cnpj: formatarCnpj(digitos),
    razaoSocial: str(src, 'razao_social'),
    nomeFantasia: str(src, 'nome_fantasia'),
    endereco,
    numero,
    bairro,
    municipio,
    uf,
    cep,
    telefone: formatarTelefone(src.ddd_telefone_1 || src.ddd_telefone_2),
    enderecoCompleto,
    email: str(src, 'email'),
    situacao,
    situacaoOk: situacao === 'ATIVA',
    simples: src.opcao_pelo_simples === true,
    mei: src.opcao_pelo_mei === true,
  };
}

export async function GET(req: NextRequest) {
  // Preview/bridge primeiro (mesmo padrao das outras rotas): no sandbox o
  // token e assinado pela producao — quem valida o Bearer e a producao.
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponivel.');
  }
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

  // 1) BrasilAPI -> 2) Minha Receita -> 3) OpenCNPJ
  const br = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`);
  const mr = br && br.razao_social ? null : await fetchJson(`https://minhareceita.org/${digitos}`);
  let oc: Record<string, unknown> | null =
    !(br && br.razao_social) && !(mr && mr.razao_social)
      ? await fetchJson(`https://api.opencnpj.org/${digitos}`)
      : null;
  const fonte = br && br.razao_social
    ? br
    : mr && mr.razao_social
      ? mr
      : oc && oc.razao_social
        ? normalizarOpencnpj(oc)
        : null;

  if (!fonte) {
    return BAD(
      502,
      'Nao foi possivel consultar esse CNPJ agora (Receita indisponivel ou CNPJ nao encontrado). Preencha os dados manualmente ou tente de novo.'
    );
  }

  const info = normalizar(digitos, fonte);
  // BLOCO 140: sem email na fonte principal, completa com a OpenCNPJ (base
  // aberta completa) — o email e o que vai no destinatario do XML da NF-e.
  if (!info.email) {
    oc = oc || (await fetchJson(`https://api.opencnpj.org/${digitos}`));
    const emailOc = oc ? str(oc, 'email') : '';
    if (emailOc) info.email = emailOc;
  }
  CACHE.set(digitos, { data: info, exp: Date.now() + TTL_MS });
  return NextResponse.json({ ok: true, cached: false, ...info });
}
