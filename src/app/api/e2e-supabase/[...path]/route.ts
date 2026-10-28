import { NextRequest, NextResponse } from 'next/server';
import { hashSync } from 'bcryptjs';

/**
 * MOCK DO SUPABASE (PostgREST) — SOMENTE PARA E2E LOCAL.
 * Ativa apenas com NEXT_PUBLIC_E2E_MOCK=1 no .env.local (nunca na Vercel).
 * O dev aponta NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3000/api/e2e-supabase
 * e este handler responde como o PostgREST responderia.
 *
 * BLOCO 31: filtros PostgREST basicos (eq/in/gte/lte/is/not/order), PATCH e
 * DELETE PERSISTENTES, usuario ADMIN fake e 2 pre-vendas pendentes — para
 * testar a fila de entrega do admin (setas de ordem + editor de pedido).
 */

const CATCH_TABLES = ['app_users', 'clients', 'products', 'app_settings', 'product_categories', 'product_subcategories', 'cargas', 'cargas_pendentes', 'system_messages', 'commissions', 'commission_payment_logs', 'sales', 'seller_expenses', 'push_tokens', 'daily_routes', 'entrega_rotas', 'entrega_eventos', 'sale_items', 'payment_comprovantes', 'caixa_fechamentos', 'pre_vendas', 'pedidos'];

const users = [{
  id: 'adminuser', nome: 'Admin Teste', email: '', perfil: 'ADMIN', ativo: true,
  telefone: '', whatsapp: '', foto: null, placa_veiculo: '', rota: '',
  pre_venda: false, rota2: false, pin_hash: hashSync('123456', 10),
}, {
  id: 'rota2user', nome: 'Rota 2 Teste', email: '', perfil: 'VENDEDOR', ativo: true,
  telefone: '', whatsapp: '', foto: null, placa_veiculo: '', rota: 'ROTA_02',
  pre_venda: false, rota2: true, pin_hash: hashSync('123456', 10),
}, {
  // BLOCO 64: vendedor SEM a flag rota2 — prova que o fluxo novo (wizard/nota/
  // estoques) agora vale para TODOS os vendedores, nao so para o piloto.
  id: 'vend01', nome: 'Rota 1 Teste', email: '', perfil: 'VENDEDOR', ativo: true,
  telefone: '', whatsapp: '', foto: null, placa_veiculo: '', rota: 'ROTA_01',
  pre_venda: false, rota2: false, pin_hash: hashSync('123456', 10),
}, {
  // BLOCO 71: vendedor da ROTA_04 (Gil Pantoja) — rota LIBERADA pro cliente
  // ESPECIAL GB. Prova o toggle no form do vendedor + rota nova no select do admin.
  id: 'vend04', nome: 'Gil Pantoja', email: '', perfil: 'VENDEDOR', ativo: true,
  telefone: '', whatsapp: '', foto: null, placa_veiculo: '', rota: 'ROTA_04',
  pre_venda: false, rota2: false, pin_hash: hashSync('123456', 10),
}];

const clients = [{
  id: 'cli-1', nome_fantasia: 'Emporio Teste', nome: null, ativar_cnpj: false, cnpj: null,
  telefone: '(54) 99999-9999', endereco: 'Rua Teste 123', bairro: 'Centro', ativo: true,
  localizacao: null, dia_roteiro: new Date().getDay(), ordem: 1, observacoes: null,
  pin_localizacao: '-29.166037, -51.210285',
  rota: 'ROTA_02', portal_code: 'TEST1234', razao_social: null, inscricao_estadual: null,
  // BLOCO 64: numero/sala no cadastro — sai na fila e na impressao ("Rua X, SALA 5")
  endereco_numero: 'SALA 5', endereco_cep: null, endereco_municipio: null, endereco_uf: null,
  // BLOCO 46: clientes com email para o rodape do cupom (envio do XML)
  email: 'emporio@teste.com',
}, {
  id: 'cli-2', nome_fantasia: 'Padaria Dois', nome: null, ativar_cnpj: false, cnpj: null,
  telefone: '(54) 98888-8888', endereco: 'Av Segunda 456', bairro: 'Sao Pelegrino', ativo: true,
  localizacao: null, dia_roteiro: new Date().getDay(), ordem: 2, observacoes: null,
  pin_localizacao: null,
  rota: 'ROTA_02', portal_code: 'TEST5678', razao_social: null, inscricao_estadual: null,
  endereco_numero: null, endereco_cep: null, endereco_municipio: null, endereco_uf: null, email: 'padaria@teste.com',
}, {
  // BLOCO 36: cliente com CNPJ APTO a NF-e (painel CNPJ nota -> Confirmar NF-e)
  id: 'cli-3', nome_fantasia: 'Mercado CNPJ', nome: null, ativar_cnpj: true, cnpj: '12.345.678/0001-99',
  telefone: '(54) 97777-7777', endereco: 'Av Brasil', bairro: 'Centro', ativo: true,
  localizacao: null, dia_roteiro: new Date().getDay(), ordem: 3, observacoes: null,
  pin_localizacao: '-29.167000, -51.180000',
  rota: 'ROTA_02', portal_code: 'TEST9012', razao_social: 'MERCADO TESTE LTDA', inscricao_estadual: null,
  endereco_numero: '500', endereco_cep: '95000-000', endereco_municipio: 'Caxias do Sul', endereco_uf: 'RS', email: 'fiscal@teste.com',
}, {
  // BLOCO 36: cliente com CNPJ mas cadastro fiscal INCOMPLETO (painel mostra o que falta)
  id: 'cli-4', nome_fantasia: 'Lanchonete CNPJ2', nome: null, ativar_cnpj: true, cnpj: '98.765.432/0001-55',
  telefone: '(54) 96666-6666', endereco: 'Rua Terceira 789', bairro: 'Marechal', ativo: true,
  localizacao: null, dia_roteiro: new Date().getDay(), ordem: 4, observacoes: null,
  pin_localizacao: '-29.168000, -51.190000',
  rota: 'ROTA_02', portal_code: 'TEST3456', razao_social: null, inscricao_estadual: null,
  endereco_numero: null, endereco_cep: null, endereco_municipio: null, endereco_uf: null, email: 'lanchonete@teste.com',
}, {
  // BLOCO 36: GPS capturado mas SEM telefone (modal abre com Localização ok / WhatsApp pendente)
  id: 'cli-5', nome_fantasia: 'Acougue Sem Tel', nome: null, ativar_cnpj: false, cnpj: null,
  telefone: '0', endereco: 'Rua Quarta 101', bairro: 'Fiorita', ativo: true,
  localizacao: null, dia_roteiro: new Date().getDay(), ordem: 5, observacoes: null,
  pin_localizacao: '-29.169000, -51.200000',
  rota: 'ROTA_02', portal_code: 'TEST7890', razao_social: null, inscricao_estadual: null,
  endereco_numero: null, endereco_cep: null, endereco_municipio: null, endereco_uf: null, email: null,
}, {
  // BLOCO 64: cliente da ROTA_01 (vendedor vend01, sem flag rota2) — cadastro
  // COMPLETO (pin >= 5 + telefone) para o modoSheet ir direto pra venda.
  id: 'cli-6', nome_fantasia: 'Cliente Rota Um', nome: null, ativar_cnpj: false, cnpj: null,
  telefone: '(54) 95555-5555', endereco: 'Rua da Rota Um 10', bairro: 'Esplanada', ativo: true,
  localizacao: null, dia_roteiro: new Date().getDay(), ordem: 6, observacoes: null,
  pin_localizacao: '-29.170000, -51.210000',
  rota: 'ROTA_01', portal_code: 'TESTROTA1', razao_social: null, inscricao_estadual: null,
  endereco_numero: '10', endereco_cep: null, endereco_municipio: null, endereco_uf: null, email: null,
}, {
  // BLOCO 64: 2o cliente da ROTA_01 — pronta entrega (van SEM_NF = cupom direto)
  id: 'cli-7', nome_fantasia: 'Mercado Rota Um', nome: null, ativar_cnpj: false, cnpj: null,
  telefone: '(54) 94444-4444', endereco: 'Av da Rota Um 20', bairro: 'Kayser', ativo: true,
  localizacao: null, dia_roteiro: new Date().getDay(), ordem: 7, observacoes: null,
  pin_localizacao: '-29.171000, -51.211000',
  rota: 'ROTA_01', portal_code: 'TESTROTA2', razao_social: null, inscricao_estadual: null,
  endereco_numero: '20', endereco_cep: null, endereco_municipio: null, endereco_uf: null, email: null,
}, {
  // BLOCO 71: cliente LEGADO marcado ESPECIAL GB numa rota NAO liberada (Rota 02)
  // — o form do admin deve mostrar o aviso (sem toggle) e ao salvar volta a NORMAL.
  id: 'cli-8', nome_fantasia: 'Doceria GB Legado', nome: null, ativar_cnpj: false, cnpj: null,
  telefone: '(54) 93333-3333', endereco: 'Rua Legado 30', bairro: 'Centro', ativo: true,
  localizacao: null, dia_roteiro: new Date().getDay(), ordem: 8, observacoes: null,
  pin_localizacao: '-29.172000, -51.212000',
  rota: 'ROTA_02', portal_code: 'TESTGBLEG', razao_social: null, inscricao_estadual: null,
  endereco_numero: '30', endereco_cep: null, endereco_municipio: null, endereco_uf: null, email: null,
  cliente_especial_gb: true,
}, {
  // BLOCO 71: cliente da ROTA_04 (Gil Pantoja) — cadastro COMPLETO para o
  // vendedor vend04 atender direto; rota liberada pro cliente ESPECIAL GB.
  id: 'cli-9', nome_fantasia: 'Mercado Gil', nome: null, ativar_cnpj: false, cnpj: null,
  telefone: '(54) 92222-2222', endereco: 'Rua Gil 40', bairro: 'Sao Pelegrino', ativo: true,
  localizacao: null, dia_roteiro: new Date().getDay(), ordem: 9, observacoes: null,
  pin_localizacao: '-29.173000, -51.213000',
  rota: 'ROTA_04', portal_code: 'TESTGIL04', razao_social: null, inscricao_estadual: null,
  endereco_numero: '40', endereco_cep: null, endereco_municipio: null, endereco_uf: null, email: null,
  cliente_especial_gb: false,
}];

const products = [
  { id: 'prod-1', nome: 'Palitinho Morango', preco_custo: 1.0, preco_venda: 2.39, preco_minimo: 2.39, comissao_percentual: 10, comissao_pv_percentual: 5, estoque_principal: 100, estoque_van: 0, estoque_nota: 0, estoque_semnf: 40, produto_teste: false, ativo: true, unidade: 'UN', origem: '0', ncm: null, cest: null, cfop: null, ean: null, imagem: null, unidades_por_caixa: null, obs: null, familia_catalogo: null, category_id: null, subcategory_id: null, display_order: null },
  { id: 'prod-2', nome: 'Bacon Wanflo 110g', preco_custo: 3.0, preco_venda: 4.29, preco_minimo: 3.99, comissao_percentual: 10, comissao_pv_percentual: 5, estoque_principal: 80, estoque_van: 0, estoque_nota: 0, estoque_semnf: 30, produto_teste: false, ativo: true, unidade: 'UN', origem: '0', ncm: null, cest: null, cfop: null, ean: null, imagem: null, unidades_por_caixa: null, obs: null, familia_catalogo: null, category_id: null, subcategory_id: null, display_order: null },
  // BLOCO 29 (ROTA 2): produtos de TESTE — 3 do estoque COM NF + 3 do SEM NF
  { id: 'prod-t1', nome: 'TESTE NF 01 — Doce A', preco_custo: 0.5, preco_venda: 1.0, preco_minimo: 1.0, comissao_percentual: 10, comissao_pv_percentual: 5, estoque_principal: 0, estoque_van: 0, estoque_nota: 50, estoque_semnf: 0, produto_teste: true, ativo: true, unidade: 'UN', origem: '0', ncm: null, cest: null, cfop: null, ean: null, imagem: null, unidades_por_caixa: null, obs: null, familia_catalogo: null, category_id: null, subcategory_id: null, display_order: null },
  { id: 'prod-t2', nome: 'TESTE NF 02 — Doce B', preco_custo: 1.0, preco_venda: 2.0, preco_minimo: 2.0, comissao_percentual: 10, comissao_pv_percentual: 5, estoque_principal: 0, estoque_van: 0, estoque_nota: 50, estoque_semnf: 0, produto_teste: true, ativo: true, unidade: 'UN', origem: '0', ncm: null, cest: null, cfop: null, ean: null, imagem: null, unidades_por_caixa: null, obs: null, familia_catalogo: null, category_id: null, subcategory_id: null, display_order: null },
  { id: 'prod-t3', nome: 'TESTE S/NF 01 — Doce D', preco_custo: 0.5, preco_venda: 1.0, preco_minimo: 1.0, comissao_percentual: 10, comissao_pv_percentual: 5, estoque_principal: 0, estoque_van: 0, estoque_nota: 0, estoque_semnf: 50, produto_teste: true, ativo: true, unidade: 'UN', origem: '0', ncm: null, cest: null, cfop: null, ean: null, imagem: null, unidades_por_caixa: null, obs: null, familia_catalogo: null, category_id: null, subcategory_id: null, display_order: null },
  { id: 'prod-t4', nome: 'TESTE ZERADO — sem saldo', preco_custo: 1.0, preco_venda: 2.0, preco_minimo: 2.0, comissao_percentual: 10, comissao_pv_percentual: 5, estoque_principal: 0, estoque_van: 0, estoque_nota: 0, estoque_semnf: 0, produto_teste: true, ativo: true, unidade: 'UN', origem: '0', ncm: null, cest: null, cfop: null, ean: null, imagem: null, unidades_por_caixa: null, obs: null, familia_catalogo: null, category_id: null, subcategory_id: null, display_order: null },
];

const settings = [{
  id: 'global_settings', margem_global_ativa: false, margem_global_valor: 0, margem_minima_ativa: false, margem_minima: 0,
  pix1_name: 'Pix A', pix1_code: null, pix2_name: 'Pix B', pix2_code: null, pix_chave_entrega: null,
  product_order: null, client_order: null, catalogo_order: null,
  company_name: 'Doce Mania', company_cnpj: '00.000.000/0001-00',
}];

const agora = new Date();
const iso = (minAtras: number) => new Date(agora.getTime() - minAtras * 60000).toISOString();

// BLOCO 31: 2 pre-vendas pendentes para a fila do admin (setas + editor)
const salesSeed = [
  {
    id: 'sale-fila-001', vendedor_id: 'rota2user', client_id: 'cli-1',
    valor_total: 7.17, valor_pago: 0, metodo_pagamento: 'A_PRAZO',
    detalhe_pagamento: 'PRE-VENDA — cobrar DINHEIRO na entrega (A VISTA)',
    status_pagamento: 'PENDENTE', data_venda: iso(120), data_vencimento: null,
    tipo_venda: 'PRE_VENDA', entrega_status: 'PENDENTE', trocas: null,
    prioridade: 0, separado: false, separado_em: null, entregador_id: null,
    comprovante_foto: null, modo_nota: null, route_id: null, entrega_seq: null, ordem_entrega: null,
  },
  {
    id: 'sale-fila-002', vendedor_id: 'rota2user', client_id: 'cli-2',
    valor_total: 12.87, valor_pago: 0, metodo_pagamento: 'A_PRAZO',
    detalhe_pagamento: 'PRE-VENDA — cobrar PIX na entrega (A PRAZO)',
    status_pagamento: 'PENDENTE', data_venda: iso(60), data_vencimento: iso(-10080),
    tipo_venda: 'PRE_VENDA', entrega_status: 'PENDENTE', trocas: null,
    prioridade: 0, separado: false, separado_em: null, entregador_id: null,
    comprovante_foto: null, modo_nota: null, route_id: null, entrega_seq: null, ordem_entrega: null,
  },
  // BLOCO 67: divida ANTIGA do cli-5 (3 dias, pronta entrega a prazo) —
  // banner de divida no PDV sem tirar o botao Atender (nao e venda de hoje
  // nem pre-venda pendente na fila)
  {
    id: 'sale-divida-001', vendedor_id: 'rota2user', client_id: 'cli-5',
    valor_total: 25.0, valor_pago: 0, metodo_pagamento: 'A_PRAZO',
    detalhe_pagamento: 'PRONTA — cobrar BOLETO na entrega (A PRAZO)',
    status_pagamento: 'PENDENTE', data_venda: iso(4320), data_vencimento: iso(-720),
    tipo_venda: 'PRONTA', entrega_status: null, trocas: null,
    prioridade: 0, separado: false, separado_em: null, entregador_id: null,
    comprovante_foto: null, modo_nota: null, route_id: null, entrega_seq: null, ordem_entrega: null,
  },
];

const saleItemsSeed = [
  { id: 'si-1', sale_id: 'sale-fila-001', produto_id: 'prod-1', product_id: 'prod-1', quantidade: 3, preco_venda: 2.39 },
  { id: 'si-2', sale_id: 'sale-fila-002', produto_id: 'prod-2', product_id: 'prod-2', quantidade: 3, preco_venda: 4.29 },
  { id: 'si-3', sale_id: 'sale-divida-001', produto_id: 'prod-1', product_id: 'prod-1', quantidade: 10, preco_venda: 2.5 },
];

const tables: Record<string, any[]> = {
  app_users: users,
  clients,
  products,
  app_settings: settings,
  product_categories: [],
  product_subcategories: [],
  cargas: [{ id: 'carga-1', vendedor_id: 'rota2user', produto_id: 'prod-t1', quantidade: 30, modo_nota: 'COM_NF', data: new Date().toISOString() }, { id: 'carga-2', vendedor_id: 'rota2user', produto_id: 'prod-1', quantidade: 20, data: new Date().toISOString() }, { id: 'carga-3', vendedor_id: 'vend01', produto_id: 'prod-1', quantidade: 25, modo_nota: 'SEM_NF', data: new Date().toISOString() }],
  cargas_pendentes: [],
  system_messages: [],
  commissions: [],
  commission_payment_logs: [],
  sales: salesSeed,
  seller_expenses: [],
  push_tokens: [],
  daily_routes: [],
  entrega_rotas: [],
  entrega_eventos: [],
  sale_items: saleItemsSeed,
  payment_comprovantes: [],
  caixa_fechamentos: [],
  pre_vendas: [],
  pedidos: [],
};

function json(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

// ---------- BLOCO 31: filtros PostgREST basicos ----------
function aplicarFiltros(rows: any[], params: URLSearchParams): any[] {
  let out = [...rows];
  for (const [key, raw] of params.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'apikey', 'columns'].includes(key)) continue;
    if (key === 'or' || key === 'and' || key === 'or=( Foto' ) continue;
    let val = raw;
    let negar = false;
    const m = val.match(/^(not\.)?(eq|neq|gt|gte|lt|lte|is|in|like|ilike)\.([\s\S]*)$/);
    let op = 'eq';
    if (m) { negar = !!m[1]; op = m[2]; val = m[3]; }
    out = out.filter(r => {
      let v = r[key];
      let ok = false;
      switch (op) {
        case 'is':
          ok = val === 'null' ? (v === null || v === undefined) : String(v) === val;
          break;
        case 'in': {
          const lista = val.replace(/^\(/, '').replace(/\)$/, '').split(',').map(s => s.replace(/^"|"$/g, '').trim());
          ok = lista.includes(String(v));
          break;
        }
        case 'gte': ok = String(v) >= val; break;
        case 'lte': ok = String(v) <= val; break;
        case 'gt': ok = String(v) > val; break;
        case 'lt': ok = String(v) < val; break;
        case 'neq': ok = String(v) !== val; break;
        default: ok = String(v) === val;
      }
      return negar ? !ok : ok;
    });
  }
  const order = params.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    out.sort((a, b) => {
      const av = String(a[col] ?? ''), bv = String(b[col] ?? '');
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return dir === 'desc' ? -cmp : cmp;
    });
  }
  return out;
}

// BLOCO 31: matcher generico col=eq.valor (DELETE usa sale_id, por exemplo)
function linhasQueBatem(rows: any[], params: URLSearchParams): number[] {
  const eqs: [string, string][] = [];
  for (const [key, val] of params.entries()) {
    const m = val.match(/^eq\.([\s\S]*)$/);
    if (m) eqs.push([key, m[1]]);
  }
  const idx: number[] = [];
  rows.forEach((r, i) => {
    if (eqs.every(([k, v]) => String(r[k]) === v)) idx.push(i);
  });
  return idx;
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
    const url = new URL(req.url);
    const params = url.searchParams;

    if (req.method === 'GET') {
      let rows = aplicarFiltros(tables[table], params);
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
      // BLOCO 62: supabase-js .upsert() manda POST com Prefer resolution=merge-duplicates —
      // o save de Configuracoes usa isso; no mock, merge por id quando existir.
      const pref = req.headers.get('prefer') || '';
      if (pref.includes('resolution=merge-duplicates')) {
        arr.forEach((row: any) => {
          const rows = tables[table];
          const idx = rows.findIndex(r => String(r.id) === String(row.id));
          if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
          else rows.push({ ...row, id: row.id ?? `${table}-novo-${Math.random().toString(36).slice(2, 8)}` });
        });
        return NextResponse.json(arr, { status: 201 });
      }
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
        // Defaults tipo PostgREST (colunas com DEFAULT now()/today no SQL real):
        // a conferencia do admin filtra entrega_eventos por criado_em de hoje —
        // sem o default, o evento ficava invisivel e a conferencia vazia.
        if (table === 'entrega_eventos') {
          clone.criado_em = clone.criado_em ?? new Date().toISOString();
        }
        if (table === 'caixa_fechamentos') {
          clone.data = clone.data ?? new Date().toISOString().slice(0, 10);
          clone.confirmado = clone.confirmado ?? false;
        }
        tables[table].push(clone);
      });
      // BLOCO 40: supabase-js .single() pede OBJETO (Accept vnd.pgrst.object).
      // O insert da pre-venda usa .select(...).single() — sem isso o client
      // recebia array e o pedido mapeava vazio (cupom com R$ 0.00).
      const wantsObject = (req.headers.get('accept') || '').includes('vnd.pgrst.object');
      if (wantsObject) {
        return new NextResponse(JSON.stringify(arr[0] ?? null), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return NextResponse.json(arr, { status: 201 });
    }

    // BLOCO 31: PATCH persistente com filtro col=eq.valor (ordem_entrega, editor...)
    // BLOCO 72: honra .single() (Accept vnd.pgrst.object) — o save de contato do
    // cliente usa update().select().single() e precisa da LINHA de volta.
    if (req.method === 'PATCH') {
      let body: any = {};
      try { body = await req.json(); } catch {}
      const rows = tables[table];
      const alvos = linhasQueBatem(rows, params);
      alvos.forEach(i => { rows[i] = { ...rows[i], ...body }; });
      const wantsObject = (req.headers.get('accept') || '').includes('vnd.pgrst.object');
      if (wantsObject) {
        return new NextResponse(JSON.stringify(alvos.length > 0 ? rows[alvos[0]] : null), {
          status: alvos.length > 0 ? 200 : 406,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return NextResponse.json(alvos.length > 0 ? [body] : [], { status: 200 });
    }

    // BLOCO 31: DELETE persistente com filtro col=eq.valor (itens do editor)
    if (req.method === 'DELETE') {
      const rows = tables[table];
      const alvos = new Set(linhasQueBatem(rows, params));
      tables[table] = rows.filter((_, i) => !alvos.has(i));
      return json([], 200);
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
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, (await ctx.params).path || []);
}
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
