import { NextRequest, NextResponse } from 'next/server';
import { isServerSupabaseConfigured, devBridge } from '@/lib/serverSupabase';
import { sessionFromRequest } from '@/lib/session';

/**
 * BLOCO 108.2 — DIAGNOSTICO DO BANCO: quais SQLs estao RODADOS de verdade?
 *
 * GET /api/diagnostico-banco  (ADMIN e SECRETARIO; somente leitura)
 *
 * Fonte da verdade: o OpenAPI do PostgREST do Supabase (GET /rest/v1/ com a
 * service role) — UM pedido que lista TODAS as tabelas, TODAS as colunas e
 * TODAS as RPCs do schema public. Nao consulta dado nenhum: so o esquema.
 *
 * O checklist por bloco espelha os arquivos sql/*.sql do repositorio. Um bloco
 * sai "ok" quando TODOS os seus itens (tabela, tabela.coluna ou rpc:nome)
 * existem no banco. Responde sempre ok:true com o mapa completo — o dono nao
 * precisa mais rodar SQL de check-up na mao para saber o que falta.
 */

const BAD = (status: number, erro: string) => NextResponse.json({ ok: false, erro }, { status });

type Bloco = { descricao: string; itens: string[] };

const BLOCOS: Record<string, Bloco> = {
  BLOCO_05_PRE_VENDA: {
    descricao: 'Pre-venda: fila de entregas, rotas e eventos',
    itens: [
      'app_users.pre_venda',
      'sales.tipo_venda',
      'sales.entrega_status',
      'sales.entrega_seq',
      'sales.estoque_baixado',
      'entrega_rotas',
      'entrega_eventos',
    ],
  },
  BLOCO_10_NOTAS: {
    descricao: 'Notas fiscais (Focus NFe): status/tipo/DANFE/XML na venda + cadastro fiscal do cliente',
    itens: [
      'sales.nota_status',
      'sales.nota_tipo',
      'sales.nota_ref',
      'sales.nota_numero',
      'sales.nota_pdf_url',
      'sales.nota_xml_url',
      'sales.nota_erro',
      'sales.nota_emitida_em',
      'clients.razao_social',
      'clients.inscricao_estadual',
      'clients.endereco_numero',
      'clients.endereco_cep',
      'clients.endereco_municipio',
      'clients.endereco_uf',
      'products.ncm',
      'products.cfop',
    ],
  },
  BLOCO_12_FISCAL: {
    descricao: 'Codigo fiscal do produto: NCM, CEST, CFOP, EAN, unidade, origem',
    itens: [
      'products.ncm',
      'products.cest',
      'products.cfop',
      'products.ean',
      'products.unidade',
      'products.origem',
    ],
  },
  BLOCO_13_FILA: {
    descricao: 'Fila continua da pre-venda (prioridade/separado/entregador) + caixa fechamentos',
    itens: [
      'sales.prioridade',
      'sales.separado',
      'sales.separado_em',
      'sales.entregador_id',
      'caixa_fechamentos',
    ],
  },
  BLOCO_15_FOTO: {
    descricao: 'Foto do produto e unidades por caixa',
    itens: ['products.imagem', 'products.unidades_por_caixa'],
  },
  BLOCO_25_BOLETO: {
    descricao: 'Boletos do Inter (Cobranca V3, boleto+pix) + chave da NF-e na venda',
    itens: [
      'sales.inter_boleto_status',
      'sales.inter_boleto_codigo',
      'sales.inter_boleto_seu_numero',
      'sales.inter_boleto_linha',
      'sales.inter_boleto_barras',
      'sales.inter_boleto_pix',
      'sales.inter_boleto_vencimento',
      'sales.inter_boleto_valor',
      'sales.inter_boleto_erro',
      'sales.inter_boleto_em',
      'sales.nota_chave',
    ],
  },
  BLOCO_58_CHECK_CARGA: {
    descricao: 'Check de carga da entrega (quem carregou e quando)',
    itens: ['sales.carga_confirmada_em', 'sales.carga_confirmada_por'],
  },
  BLOCO_62_PIX_ENTREGA: {
    descricao: 'Chave Pix da entrega (config)',
    itens: ['app_settings.pix_chave_entrega'],
  },
  BLOCO_80_CUSTO: {
    descricao: 'Custo congelado no item da venda (margem real)',
    itens: ['sale_items.custo_unitario'],
  },
  BLOCO_95_XML_FILA: {
    descricao: 'Fila XML -> Produtos (importacoes e itens da nota de compra)',
    itens: ['xml_importacoes', 'xml_itens'],
  },
  BLOCO_95_1_CEST_ENTRADA: {
    descricao: 'CEST na fila XML + carimbo de entrada de estoque (trava 2x)',
    itens: ['xml_itens.cest', 'xml_itens.entrada_estoque_em', 'products.cest'],
  },
  BLOCO_98_TROCAS: {
    descricao: 'Valor das trocas na venda',
    itens: ['sales.trocas_valor'],
  },
  BLOCO_108_KARDEX: {
    descricao: 'Kardex de estoque + Modo Cupom + central de automacoes (erp_config) + RPC de movimento',
    itens: [
      'estoque_movimentos',
      'products.preco_cupom',
      'clients.modo_cupom',
      'app_settings.erp_config',
      'rpc:registrar_movimento_estoque',
    ],
  },
  BLOCO_95_SPEDY: {
    descricao: 'Spedy (DORMANT — o dono decidiu Focus; false aqui e NORMAL, nao e pendencia)',
    itens: ['spedy_webhook_events'],
  },
};

export async function GET(req: NextRequest) {
  if (!isServerSupabaseConfigured()) {
    const bridged = await devBridge(req);
    if (bridged) return bridged;
    return BAD(503, 'Indisponivel no preview local.');
  }
  const session = sessionFromRequest(req);
  if (!session) return BAD(401, 'Sessao expirada. Faca login novamente.');
  if (session.perfil !== 'ADMIN' && session.perfil !== 'SECRETARIO') {
    return BAD(403, 'Somente admin e secretario veem o diagnostico.');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  type Spec = {
    definitions?: Record<string, { properties?: Record<string, unknown> }>;
    paths?: Record<string, unknown>;
  };
  let spec: Spec;
  try {
    const r = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    spec = (await r.json()) as Spec;
    if (!spec || typeof spec !== 'object' || !spec.definitions) {
      return BAD(500, 'Esquema do banco nao veio como esperado do PostgREST.');
    }
  } catch (e) {
    return BAD(500, `Falha lendo o esquema do banco: ${String((e as Error).message)}`);
  }

  const tabelas: Record<string, string[]> = {};
  for (const [t, def] of Object.entries(spec.definitions || {})) {
    tabelas[t] = Object.keys(def.properties || {}).sort();
  }
  const rpcs = Object.keys(spec.paths || {})
    .filter((p) => p.startsWith('/rpc/'))
    .map((p) => p.slice('/rpc/'.length))
    .sort();

  const tem = (ref: string): boolean => {
    if (ref.startsWith('rpc:')) return rpcs.includes(ref.slice(4));
    if (ref.includes('.')) {
      const [t, c] = ref.split('.');
      return (tabelas[t] || []).includes(c);
    }
    return !!tabelas[ref];
  };

  const blocos: Record<string, { ok: boolean; faltando: string[]; descricao: string }> = {};
  const pendentes: string[] = [];
  for (const [nome, b] of Object.entries(BLOCOS)) {
    const faltando = b.itens.filter((i) => !tem(i));
    blocos[nome] = { ok: faltando.length === 0, faltando, descricao: b.descricao };
    if (faltando.length) pendentes.push(`${nome} faltando: ${faltando.join(', ')}`);
  }

  return NextResponse.json({
    ok: true,
    gerado_em: new Date().toISOString(),
    fonte: 'postgrest-openapi (esquema real do banco)',
    resumo: {
      total_tabelas: Object.keys(tabelas).length,
      total_rpcs: rpcs.length,
      blocos_total: Object.keys(BLOCOS).length,
      blocos_ok: Object.values(blocos).filter((b) => b.ok).length,
      blocos_pendentes: pendentes.length,
    },
    blocos,
    pendentes,
    tabelas,
    rpcs,
  });
}
