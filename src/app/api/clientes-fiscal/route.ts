import { NextRequest, NextResponse } from 'next/server';
import { isAdminSession } from '@/lib/session';
import { getServiceClient, isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { validaCpfCnpj, mascaraCpfCnpj } from '@/lib/validaDoc';

/**
 * BLOCO 174 — CLIENTES FISCAIS (portal, fora do app) — gêmeo do /fiscal-produtos.
 *
 * Pedido do dono (17/11): "crie um portal identido ao de produtos porem de
 * clientes para eu poder editar dados dos clientes! coloque somente
 * informaçoes relevantes ao fiscal tbm o nome e cep editaveis".
 *
 * BLOCO 177 (dono: "criar na aba clientes a caixa onde vamos colocar o cpf do
 * cliente para gerar boletos a prazo para o cliente que nao for nfe — nfe
 * seria cnpj, nfc > cpf"): o CPF/CNPJ (campo cnpj — CPF e CNPJ vivem no MESMO
 * campo do cadastro) também é EDITÁVEL:
 *   - CPF/CNPJ (cnpj) — EDITÁVEL, 11 ou 14 dígitos COM dígito verificador
 *     válido (o Inter recusa documento inválido); vazio = limpa;
 *   - NOME (nome_fantasia) — EDITÁVEL, obrigatório (catálogo, PDV, NF);
 *   - CEP (endereco_cep) — EDITÁVEL, 8 dígitos, gravado mascarado 00000-000;
 *   - LOGRADOURO (endereco) — EDITÁVEL até 60 (limite SEFAZ do xLgr);
 *   - NÚMERO (endereco_numero) — EDITÁVEL até 60 (aceita S/N);
 *   - BAIRRO (bairro) — EDITÁVEL até 60;
 *   - MUNICÍPIO (endereco_municipio) — EDITÁVEL até 60;
 *   - UF (endereco_uf) — EDITÁVEL, 2 letras;
 *
 * BLOCO 178 (dono: "no momento que digitar faça a busca automatica do endereço
 * completo e preencha, o mesmo vale para o cnpj — todos esses campos devem
 * poder ser editados"): o preenchimento automático acontece no FRONT (CEP ->
 * ViaCEP/Correios, CNPJ -> /api/cnpj Receita) e TODO campo do portal virou
 * EDITÁVEL. Esta API passa a aceitar também:
 *   - RAZÃO SOCIAL (razao_social) — EDITÁVEL até 120; vazio = limpa;
 *   - IE (inscricao_estadual) — EDITÁVEL até 20 (aceita ISENTO); vazio = limpa.
 *
 * GET   /api/clientes-fiscal          -> todos os clientes + contagens
 * PATCH /api/clientes-fiscal { id, nome?, documento?, cep?, endereco?, numero?, bairro?, municipio?, uf?, razaoSocial?, ie? }
 *                                     -> grava e devolve o cliente atualizado
 *
 * Auth: MESMA SESSÃO do portal fiscal (/notas) — POST /api/notas-admin
 * { acao:'AUTH', pin } gera o token ADMIN e esta rota só aceita sessão
 * ADMIN válida (Bearer). Vendedor/entregador não entra.
 */

const BAD = (status: number, erro: string) =>
  NextResponse.json({ ok: false, erro }, { status });

const COLS = 'id, nome_fantasia, nome, razao_social, inscricao_estadual, cnpj, endereco, endereco_numero, bairro, endereco_cep, endereco_municipio, endereco_uf, ativo';

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

interface ClientePatch {
  nome?: unknown;
  documento?: unknown;
  cep?: unknown;
  endereco?: unknown;
  numero?: unknown;
  bairro?: unknown;
  municipio?: unknown;
  uf?: unknown;
  /** BLOCO 178: razão social editável (a Receita puxa no CNPJ e o dono pode ajustar). */
  razaoSocial?: unknown;
  /** BLOCO 178: IE editável (aceita ISENTO — a NF-e usa quando existe). */
  ie?: unknown;
}

/**
 * BLOCO 176/177: limites do schema SEFAZ (xLgr/nro/xBairro/xMun = 60; UF = 2).
 * Texto vazio = LIMPA o campo (a emissão recusa NF-e e avisa o que falta).
 */
const max60 = (v: unknown): string | null => {
  const t = String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
  return t || null;
};

/** Normaliza + valida o patch. Nome vazio é RECUSADO; demais vazios = limpa. */
function validaPatch(patch: ClientePatch): { dados: Record<string, string | null>; erro?: string } {
  const dados: Record<string, string | null> = {};

  if (patch.nome !== undefined) {
    const n = String(patch.nome ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!n) return { dados, erro: 'O nome do cliente não pode ficar vazio.' };
    dados.nome_fantasia = n;
  }
  // BLOCO 177: CPF (11) ou CNPJ (14) com dígito verificador válido — o Inter
  // recusa documento inválido e a NF-e identificada também. Vazio = limpa.
  if (patch.documento !== undefined) {
    const d = soDigitos(patch.documento);
    if (d && d.length !== 11 && d.length !== 14) {
      return { dados, erro: 'CPF deve ter 11 dígitos ou CNPJ 14 dígitos. Vazio = limpa.' };
    }
    if (d && !validaCpfCnpj(d)) {
      return { dados, erro: 'Dígito verificador inválido — confira o CPF/CNPJ digitado.' };
    }
    dados.cnpj = d ? mascaraCpfCnpj(d) : null;
  }
  if (patch.cep !== undefined) {
    const d = soDigitos(patch.cep);
    if (d && d.length !== 8) return { dados, erro: 'CEP deve ter 8 dígitos (ex: 95034-240). Vazio = limpa.' };
    dados.endereco_cep = d ? `${d.slice(0, 5)}-${d.slice(5)}` : null;
  }
  if (patch.endereco !== undefined) dados.endereco = max60(patch.endereco);
  if (patch.numero !== undefined) dados.endereco_numero = max60(patch.numero);
  if (patch.bairro !== undefined) dados.bairro = max60(patch.bairro);
  if (patch.municipio !== undefined) dados.endereco_municipio = max60(patch.municipio);
  // BLOCO 178: RAZÃO SOCIAL editável (120 — mesmo limite do nome) e IE
  // editável (20, aceita ISENTO). Vazio = limpa o campo no cadastro.
  if (patch.razaoSocial !== undefined) {
    const r = String(patch.razaoSocial ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
    dados.razao_social = r || null;
  }
  if (patch.ie !== undefined) {
    const s = String(patch.ie ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
    dados.inscricao_estadual = s || null;
  }
  if (patch.uf !== undefined) {
    const u = String(patch.uf ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    if (u && u.length !== 2) return { dados, erro: 'UF deve ter 2 letras (ex: RS). Vazio = limpa.' };
    dados.endereco_uf = u || null;
  }
  return { dados };
}

function clienteLinha(c: Record<string, unknown>) {
  return {
    id: String(c.id),
    nome: String(c.nome_fantasia ?? ''),
    razaoSocial: c.razao_social ? String(c.razao_social) : '',
    // BLOCO 177: devolve MASCARADO (000.000.000-00 / 00.000.000/0000-00) —
    // a planilha grava mascarado de volta (o PATCH tira os pontinhos).
    cnpj: c.cnpj ? mascaraCpfCnpj(String(c.cnpj)) : '',
    ie: c.inscricao_estadual ? String(c.inscricao_estadual) : '',
    cep: c.endereco_cep ? String(c.endereco_cep) : '',
    municipio: c.endereco_municipio ? String(c.endereco_municipio) : '',
    uf: c.endereco_uf ? String(c.endereco_uf) : '',
    endereco: c.endereco ? String(c.endereco) : '',
    numero: c.endereco_numero ? String(c.endereco_numero) : '',
    bairro: c.bairro ? String(c.bairro) : '',
    ativo: !!c.ativo,
  };
}

// ---------------- GET: lista completa + contagens ----------------
export async function GET(req: NextRequest) {
  // Preview/bridge primeiro (padrao do projeto): no sandbox quem responde é a produção.
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponível.');
  }
  if (!isAdminSession(req)) return BAD(401, 'Sessão ADMIN expirada. Entre com o PIN novamente.');

  const db = getServiceClient();
  const { data, error } = await db.from('clients').select(COLS).order('nome_fantasia', { ascending: true });
  if (error) return BAD(500, `Falha ao carregar clientes: ${error.message}`);

  const clientes = (data || []).map(clienteLinha);
  const total = clientes.length;
  const comCep = clientes.filter(c => c.cep).length;
  const comCnpj = clientes.filter(c => c.cnpj).length;
  const comIe = clientes.filter(c => c.ie).length;
  const comMunicipio = clientes.filter(c => c.municipio).length;
  return NextResponse.json({
    ok: true,
    clientes,
    stats: {
      total,
      ativos: clientes.filter(c => c.ativo).length,
      comCep,
      semCep: total - comCep,
      comCnpj,
      semCnpj: total - comCnpj,
      comIe,
      comMunicipio,
    },
  });
}

// ---------------- PATCH: grava nome/CEP/endereço fiscal de UM cliente ----------------
export async function PATCH(req: NextRequest) {
  // Preview/bridge primeiro (padrao do projeto): no sandbox quem responde é a produção.
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Servidor temporariamente indisponível.');
  }
  if (!isAdminSession(req)) return BAD(401, 'Sessão ADMIN expirada. Entre com o PIN novamente.');

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return BAD(400, 'Corpo inválido.');
  const id = String((body as Record<string, unknown>).id ?? '');
  if (!id) return BAD(400, 'Faltou o id do cliente.');

  const { dados, erro } = validaPatch(body as ClientePatch);
  if (erro) return BAD(400, erro);
  if (Object.keys(dados).length === 0) return BAD(400, 'Nada para salvar.');

  const db = getServiceClient();
  const { data, error } = await db.from('clients').update(dados).eq('id', id).select(COLS).single();
  if (error) return BAD(500, `Falha ao salvar: ${error.message}`);
  if (!data) return BAD(404, 'Cliente não encontrado.');

  return NextResponse.json({ ok: true, cliente: clienteLinha(data) });
}
