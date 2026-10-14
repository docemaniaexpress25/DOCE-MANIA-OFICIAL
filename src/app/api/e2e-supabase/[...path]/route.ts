import { NextRequest, NextResponse } from 'next/server';
import { hashSync } from 'bcryptjs';

/**
 * MOCK DO SUPABASE (PostgREST) — SOMENTE PARA E2E LOCAL.
 * Ativa apenas com NEXT_PUBLIC_E2E_MOCK=1 no .env.local (nunca na Vercel).
 * O dev aponta NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3000/api/e2e-supabase
 * e este handler responde como o PostgREST responderia.
 */

const CATCH_TABLES = ['app_users', 'clients', 'products', 'app_settings', 'product_categories', 'product_subcategories', 'cargas', 'cargas_pendentes', 'system_messages', 'commissions', 'commission_payment_logs', 'sales', 'seller_expenses', 'push_tokens', 'daily_routes', 'entrega_rotas', 'entrega_eventos', 'sale_items', 'payment_comprovantes', 'caixa_fechamentos', 'pre_vendas', 'pedidos'];

const users = [{
  id: 'rota2user', nome: 'Rota 2 Teste', email: '', perfil: 'VENDEDOR', ativo: true,
  telefone: '', whatsapp: '', foto: null, placa_veiculo: '', rota: 'ROTA_02',
  pre_venda: false, rota2: true, pin_hash: hashSync('123456', 10),
}];

const clients = [{
  id: 'cli-1', nome_fantasia: 'Emporio Teste', nome: null, ativar_cnpj: false, cnpj: null,
  telefone: '(54) 99999-9999', endereco: 'Rua Teste 123', bairro: 'Centro', ativo: true,
  localizacao: null, dia_roteiro: 3, ordem: 1, observacoes: null,
  pin_localizacao: '-29.166037, -51.210285',
  rota: 'ROTA_02', portal_code: 'TEST1234', razao_social: null, inscricao_estadual: null,
  endereco_numero: null, endereco_cep: null, endereco_municipio: null, endereco_uf: null, email: null,
}];

const products = [
  { id: 'prod-1', nome: 'Palitinho Morango', preco_custo: 1.0, preco_venda: 2.39, preco_minimo: 2.39, comissao_percentual: 10, comissao_pv_percentual: 5, estoque_principal: 100, estoque_van: 0, estoque_nota: 0, estoque_semnf: 0, produto_teste: false, ativo: true, unidade: 'UN', origem: '0', ncm: null, cest: null, cfop: null, ean: null, imagem: null, unidades_por_caixa: null, obs: null, familia_catalogo: null, category_id: null, subcategory_id: null, display_order: null },
  { id: 'prod-2', nome: 'Bacon Wanflo 110g', preco_custo: 3.0, preco_venda: 4.29, preco_minimo: 3.99, comissao_percentual: 10, comissao_pv_percentual: 5, estoque_principal: 80, estoque_van: 0, estoque_nota: 0, estoque_semnf: 0, produto_teste: false, ativo: true, unidade: 'UN', origem: '0', ncm: null, cest: null, cfop: null, ean: null, imagem: null, unidades_por_caixa: null, obs: null, familia_catalogo: null, category_id: null, subcategory_id: null, display_order: null },
  // BLOCO 29 (ROTA 2): produtos de TESTE — 3 do estoque COM NF + 3 do SEM NF
  { id: 'prod-t1', nome: 'TESTE NF 01 — Doce A', preco_custo: 0.5, preco_venda: 1.0, preco_minimo: 1.0, comissao_percentual: 10, comissao_pv_percentual: 5, estoque_principal: 0, estoque_van: 0, estoque_nota: 50, estoque_semnf: 0, produto_teste: true, ativo: true, unidade: 'UN', origem: '0', ncm: null, cest: null, cfop: null, ean: null, imagem: null, unidades_por_caixa: null, obs: null, familia_catalogo: null, category_id: null, subcategory_id: null, display_order: null },
  { id: 'prod-t2', nome: 'TESTE NF 02 — Doce B', preco_custo: 1.0, preco_venda: 2.0, preco_minimo: 2.0, comissao_percentual: 10, comissao_pv_percentual: 5, estoque_principal: 0, estoque_van: 0, estoque_nota: 50, estoque_semnf: 0, produto_teste: true, ativo: true, unidade: 'UN', origem: '0', ncm: null, cest: null, cfop: null, ean: null, imagem: null, unidades_por_caixa: null, obs: null, familia_catalogo: null, category_id: null, subcategory_id: null, display_order: null },
  { id: 'prod-t3', nome: 'TESTE S/NF 01 — Doce D', preco_custo: 0.5, preco_venda: 1.0, preco_minimo: 1.0, comissao_percentual: 10, comissao_pv_percentual: 5, estoque_principal: 0, estoque_van: 0, estoque_nota: 0, estoque_semnf: 50, produto_teste: true, ativo: true, unidade: 'UN', origem: '0', ncm: null, cest: null, cfop: null, ean: null, imagem: null, unidades_por_caixa: null, obs: null, familia_catalogo: null, category_id: null, subcategory_id: null, display_order: null },
  { id: 'prod-t4', nome: 'TESTE ZERADO — sem saldo', preco_custo: 1.0, preco_venda: 2.0, preco_minimo: 2.0, comissao_percentual: 10, comissao_pv_percentual: 5, estoque_principal: 0, estoque_van: 0, estoque_nota: 0, estoque_semnf: 0, produto_teste: true, ativo: true, unidade: 'UN', origem: '0', ncm: null, cest: null, cfop: null, ean: null, imagem: null, unidades_por_caixa: null, obs: null, familia_catalogo: null, category_id: null, subcategory_id: null, display_order: null },
];

const settings = [{
  id: 1, margem_global_ativa: false, margem_global_valor: 0, margem_minima_ativa: false, margem_minima: 0,
  pix1_name: 'Pix A', pix1_code: null, pix2_name: 'Pix B', pix2_code: null,
  product_order: null, client_order: null, catalogo_order: null,
  company_name: 'Doce Mania', company_cnpj: '00.000.000/0001-00',
}];

const tables: Record<string, any[]> = {
  app_users: users,
  clients,
  products,
  app_settings: settings,
  product_categories: [],
  product_subcategories: [],
  cargas: [{ id: 'carga-1', vendedor_id: 'rota2user', produto_id: 'prod-t1', quantidade: 30, modo_nota: 'COM_NF', data: new Date().toISOString() }, { id: 'carga-2', vendedor_id: 'rota2user', produto_id: 'prod-1', quantidade: 20, data: new Date().toISOString() }],
  cargas_pendentes: [],
  system_messages: [],
  commissions: [],
  commission_payment_logs: [],
  sales: [],
  seller_expenses: [],
  push_tokens: [],
  daily_routes: [],
  entrega_rotas: [],
  entrega_eventos: [],
  sale_items: [],
  payment_comprovantes: [],
  caixa_fechamentos: [],
  pre_vendas: [],
  pedidos: [],
};

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

async function handle(req: NextRequest, segments: string[]) {
  // trava de segurança: só em modo E2E
  if (process.env.NEXT_PUBLIC_E2E_MOCK !== '1') {
    return NextResponse.json({ error: 'mock desativado' }, { status: 404 });
  }

  // /rest/v1/rpc/<fn>
  if (segments[0] === 'rest' && segments[1] === 'v1' && segments[2] === 'rpc') {
    const fn = segments[3] || '';
    if (fn === 'processar_venda_v2') {
      const sale = {
        id: 'sale-wiz-001', vendedor_id: 'rota2user', client_id: 'cli-1',
        valor_total: 2.39, valor_pago: 2.39, metodo_pagamento: 'DINHEIRO',
        detalhe_pagamento: 'TESTE WIZARD E2E', status_pagamento: 'PAGO',
        data_venda: new Date().toISOString(), data_vencimento: null,
        tipo_venda: 'PRONTA', entrega_status: null, trocas: null, comprovante_foto: null,
      };
      tables.sales.push(sale);
      return json('sale-wiz-001');
    }
    return json(null);
  }

  // /rest/v1/<table>
  if (segments[0] === 'rest' && segments[1] === 'v1') {
    const table = segments[2] || '';
    if (!CATCH_TABLES.includes(table)) return json([], 200);

    if (req.method === 'GET') {
      const rows = tables[table];
      // .single() do supabase-js pede Accept: application/vnd.pgrst.object+json -> retorna OBJETO
      const wantsObject = (req.headers.get('accept') || '').includes('vnd.pgrst.object');
      if (wantsObject) {
        return new NextResponse(JSON.stringify(rows[0] ?? null), {
          status: rows.length > 0 ? 200 : 406,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new NextResponse(JSON.stringify(rows), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
        },
      });
    }

    if (req.method === 'POST') {
      let body: any = null;
      try { body = await req.json(); } catch {}
      const arr = Array.isArray(body) ? body : [body];
      arr.forEach((row: any) => {
        const clone = { ...row };
        if (!clone.id) clone.id = `${table}-novo-${Math.random().toString(36).slice(2, 8)}`;
        if (table === 'sales') {
          clone.valor_total = clone.valor_total ?? 0;
          clone.valor_pago = clone.valor_pago ?? 0;
          clone.metodo_pagamento = clone.metodo_pagamento ?? 'DINHEIRO';
          clone.detalhe_pagamento = clone.detalhe_pagamento ?? '';
          clone.status_pagamento = clone.status_pagamento ?? 'PENDENTE';
          clone.data_venda = clone.data_venda ?? new Date().toISOString();
          clone.tipo_venda = clone.tipo_venda ?? 'PRE_VENDA';
          clone.entrega_status = clone.entrega_status ?? 'PENDENTE';
          clone.trocas = clone.trocas ?? null;
          clone.comprovante_foto = clone.comprovante_foto ?? null;
          clone.modo_nota = clone.modo_nota ?? null; // BLOCO 29 (ROTA 2)
        }
        if (table === 'cargas_pendentes') {
          clone.status = clone.status ?? 'PENDENTE';
          clone.modo_nota = clone.modo_nota ?? null; // BLOCO 29 (ROTA 2)
        }
        tables[table].push(clone);
      });
      return NextResponse.json(arr, { status: 201 });
    }

    if (req.method === 'PATCH') {
      let body: any = {};
      try { body = await req.json(); } catch {}
      return NextResponse.json([body]);
    }

    return json('ok');
  }

  return json({ error: 'mock: caminho desconhecido' }, 404);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, (await ctx.params).path || []);
}
export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, (await ctx.params).path || []);
}
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, (await ctx.params).path || []);
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
