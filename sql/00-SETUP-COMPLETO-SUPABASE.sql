-- ============================================================================
-- DOCE MANIA — SETUP COMPLETO DO BANCO SUPABASE (PostgreSQL)
-- ============================================================================
-- Consolidação idempotente de TODAS as migrações do sistema (blocos 5-118
-- + setups iniciais), organizada para rodar em um projeto Supabase NOVO ou
-- em um banco existente, direto no SQL Editor:
--   Supabase Dashboard -> SQL Editor -> New query -> colar tudo -> RUN
--
-- Pode rodar quantas vezes quiser (CREATE IF NOT EXISTS / ADD COLUMN IF
-- NOT EXISTS / CREATE OR REPLACE FUNCTION).
--
-- ORIGEM DAS DEFINIÇÕES:
--   [BLOCO N]  = corpo copiado do SQL oficial do repo (sql/blocoN_*.sql,
--                supabase/*.sql)
--   [INFERIDO] = tabela/coluna/RPC sem CREATE no repo, reconstruída pela
--                leitura do código (services/API routes). Marcada com
--                "INFERIDO DO CÓDIGO".
--
-- PADRÃO DE SEGURANÇA DO PROJETO:
--   - O backend (API routes Next.js) usa SUPABASE_SERVICE_ROLE_KEY, que
--     BYPASSA RLS — é o caminho principal de escrita/leitura.
--   - O BROWSER usa a anon key direto para as tabelas operacionais
--     (vendas, produtos, clientes, comissões, cargas, settings...),
--     então essas tabelas PRECISAM de policies para `anon` (seção 6).
--   - Tabelas de sistema/servidor (xml fiscal, kardex, spedy, caixa,
--     entregas, locations, rotas diárias) ficam com RLS FECHADA — o
--     browser só acessa via API com sessão.
-- ============================================================================


-- ============================================================================
-- SEÇÃO 0 — EXTENSÕES
-- ============================================================================
create extension if not exists pgcrypto;   -- gen_random_uuid() + gen_salt('bf') p/ PIN bcrypt


-- ============================================================================
-- SEÇÃO 1 — TABELAS BASE [INFERIDO DO CÓDIGO]
-- (não há CREATE TABLE destas no repo — o app nasceu com elas já criadas;
--  todas as colunas abaixo são referenciadas em src/services e src/app/api)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1.1 app_users — usuários do sistema (login por PIN + bcrypt)
-- ---------------------------------------------------------------------------
create table if not exists public.app_users (
  id           uuid primary key default gen_random_uuid(),
  nome         text,
  email        text,
  perfil       text not null default 'VENDEDOR',   -- ADMIN | VENDEDOR | ENTREGADOR | SECRETARIO
  ativo        boolean not null default true,
  telefone     text,
  whatsapp     text,
  foto         text,
  placa_veiculo text,
  rota         text default 'ROTA_01',
  pin_hash     text,                               -- bcrypt do PIN (bcryptjs aceita $2a$ do pgcrypto)
  criado_em    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1.2 clients — clientes da distribuidora (portal_code abre os portais)
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id                uuid primary key default gen_random_uuid(),
  nome_fantasia     text,
  nome              text,
  ativar_cnpj       boolean default false,
  cnpj              text,
  telefone          text,
  endereco          text,
  bairro            text,
  ativo             boolean not null default true,
  localizacao       text,
  dia_roteiro       text,
  ordem             integer default 0,
  observacoes       text,
  pin_localizacao   text,
  rota              text default 'ROTA_01',
  portal_code       text,                          -- código público dos portais /cliente /pedido
  criado_em         timestamptz not null default now()
);
create unique index if not exists idx_clients_portal_code
  on public.clients (portal_code) where portal_code is not null;
create index if not exists idx_clients_rota on public.clients (rota);

-- ---------------------------------------------------------------------------
-- 1.3 products — catálogo + 3 estoques (principal / nota / semnf) + van
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id                   uuid primary key default gen_random_uuid(),
  nome                 text not null,
  preco_custo          numeric(12,2) default 0,
  preco_venda          numeric(12,2) default 0,
  preco_minimo         numeric(12,2) default 0,
  comissao_percentual  numeric(5,2) default 10,    -- comissão PRONTA ENTREGA (%)
  estoque_principal    integer default 0,          -- ESTOQUE TOTAL (casa) — Bloco 75
  estoque_van          integer default 0,          -- legado
  ativo                boolean not null default true,
  category_id          uuid,
  subcategory_id       uuid,
  criado_em            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1.4 sales — vendas (PRONTA = PDV / PRE_VENDA = fila) + fiscal + boleto
-- ---------------------------------------------------------------------------
create table if not exists public.sales (
  id                uuid primary key default gen_random_uuid(),
  vendedor_id       uuid,
  client_id         uuid,
  valor_total       numeric(12,2) not null default 0,
  valor_pago        numeric(12,2) not null default 0,
  metodo_pagamento  text not null default 'DINHEIRO',
  detalhe_pagamento text,
  status_pagamento  text not null default 'PENDENTE',  -- PENDENTE | PAGO | PARCIAL
  status            text,
  data_venda        timestamptz not null default now(),
  data_vencimento   timestamptz,
  comprovante_foto  text,                          -- dataURL antigo (legado)
  created_at        timestamptz not null default now()
);
create index if not exists idx_sales_data_venda on public.sales (data_venda);
create index if not exists idx_sales_client_id  on public.sales (client_id);
create index if not exists idx_sales_vendedor   on public.sales (vendedor_id);

-- ---------------------------------------------------------------------------
-- 1.5 sale_items — itens da venda (produto_id atual + product_id legado)
-- ---------------------------------------------------------------------------
create table if not exists public.sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid references public.sales(id) on delete cascade,
  produto_id  uuid,
  product_id  uuid,                                -- legado (kardex aceita as duas)
  quantidade  numeric(12,3) not null default 0,
  precovenda  numeric(12,2) not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sale_items_sale on public.sale_items (sale_id);

-- ---------------------------------------------------------------------------
-- 1.6 commissions + logs de repasse + despesas do vendedor
-- ---------------------------------------------------------------------------
create table if not exists public.commissions (
  id             uuid primary key default gen_random_uuid(),
  sale_id        uuid,
  seller_id      uuid,
  valor_comissao numeric(12,2) not null default 0,
  valor_base     numeric(12,2),
  percentual     numeric(5,2),
  status         text not null default 'A_RECEBER', -- A_RECEBER | DISPONIVEL | PAGO
  created_at     timestamptz not null default now()
);
create index if not exists idx_commissions_seller on public.commissions (seller_id, status);

create table if not exists public.commission_payment_logs (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid,
  valor_pago  numeric(12,2) not null default 0,
  aceitado    boolean default false,               -- vendedor confirmou o recibo (Bloco 14)
  created_at  timestamptz not null default now()
);

create table if not exists public.seller_expenses (
  id          uuid primary key default gen_random_uuid(),
  seller_id   uuid,
  descricao   text,
  valor       numeric(12,2) not null default 0,
  data        date not null default current_date,
  criado_em   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1.7 cargas (estoque da van por vendedor) + cargas_pendentes (rascunho)
-- ---------------------------------------------------------------------------
create table if not exists public.cargas (
  id          uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null,
  produto_id  uuid,
  quantidade  integer not null default 0,
  criado_em   timestamptz not null default now()
);
create index if not exists idx_cargas_vendedor on public.cargas (vendedor_id);

create table if not exists public.cargas_pendentes (
  id           uuid primary key default gen_random_uuid(),
  vendedor_id  uuid not null,
  itens        jsonb not null default '[]'::jsonb,   -- [{produtoid, quantidade, precovenda}]
  data_criacao timestamptz not null default now(),
  status       text not null default 'PENDENTE'      -- PENDENTE | ACEITA | CANCELADA_*
);

-- ---------------------------------------------------------------------------
-- 1.8 app_settings — linha única 'global_settings' (logo, margens, PIX...)
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id                   text primary key default 'global_settings',
  logo                 text,
  margem_global_ativa  boolean not null default true,
  margem_global_valor  numeric(5,2) not null default 30,
  margem_minima_ativa  boolean not null default true,
  margem_minima        numeric(5,2) not null default 20,
  pix1_name            text,
  pix1_code            text,
  pix2_name            text,
  pix2_code            text,
  pix_chave            text,                          -- chave Pix de RECEBIMENTO (entrega)
  product_order        text[] not null default '{}',  -- ordem do PDV
  client_order         text[] not null default '{}',
  company_name         text default 'DOCE MANIA DISTRIBUIDORA',
  company_cnpj         text,
  criado_em            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1.9 app_config — chave/valor (taxa de comissão de pré-venda) [BLOCO 7]
-- ---------------------------------------------------------------------------
create table if not exists public.app_config (
  chave      text primary key,
  valor      text not null,
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 1.10 system_messages — avisos internos do sistema (sino do vendedor)
--      O código usa seller_id/created_at (messageService) e também
--      vendedor_id/data (api/pre-venda) — as duas famílias de colunas existem.
-- ---------------------------------------------------------------------------
create table if not exists public.system_messages (
  id         uuid primary key default gen_random_uuid(),
  seller_id  uuid,
  vendedor_id uuid,
  titulo     text,
  mensagem   text,
  type       text,
  data       timestamptz,
  lida       boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1.11 product_categories + product_subcategories
-- ---------------------------------------------------------------------------
create table if not exists public.product_categories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  display_order integer not null default 0
);

create table if not exists public.product_subcategories (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid references public.product_categories(id) on delete cascade,
  name          text not null,
  display_order integer not null default 0
);

-- ---------------------------------------------------------------------------
-- 1.12 payment_comprovantes — comprovantes Pix do PORTAL DO CLIENTE
--      (cliente envia foto, admin confirma/rejeita) [INFERIDO DO CÓDIGO]
-- ---------------------------------------------------------------------------
create table if not exists public.payment_comprovantes (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid,
  client_id   uuid,
  valor       numeric(12,2) not null default 0,
  txid        text,
  foto        text,                                -- caminho no Storage (bucket comprovantes)
  observacao  text,
  status      text not null default 'PENDENTE',    -- PENDENTE | CONFIRMADO | REJEITADO
  review_note text,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_paycomp_status on public.payment_comprovantes (status, created_at);

-- ============================================================================
-- SEÇÃO 2 — TABELAS DOS BLOCOS (corpos oficiais do repo)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 2.1 entrega_rotas + entrega_eventos [BLOCO 5]
-- ---------------------------------------------------------------------------
create table if not exists public.entrega_rotas (
  id             uuid primary key default gen_random_uuid(),
  vendedor_id    uuid references public.app_users(id),
  data           date not null default current_date,
  status         text not null default 'GERADA',        -- GERADA | EM_ROTA | CONCLUIDA
  total_paradas  integer not null default 0,
  criada_em      timestamptz not null default now(),
  iniciada_em    timestamptz,
  concluida_em   timestamptz,
  unique (vendedor_id, data)
);

create table if not exists public.entrega_eventos (
  id         uuid primary key default gen_random_uuid(),
  route_id   uuid references public.entrega_rotas(id),
  sale_id    uuid references public.sales(id) on delete cascade,
  user_id    uuid,
  status     text not null,                              -- ROTA_GERADA | EM_ROTA | ENTREGUE | FALHOU
  motivo     text,
  foto       text,
  lat        double precision,
  lng        double precision,
  criado_em  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2.2 caixa_fechamentos (por entregador) [BLOCO 13]
-- ---------------------------------------------------------------------------
create table if not exists public.caixa_fechamentos (
  id            uuid primary key default gen_random_uuid(),
  entregador_id uuid not null,
  data          date not null default (current_date at time zone 'America/Sao_Paulo'),
  valor_dinheiro numeric(12,2) not null default 0,
  valor_pix      numeric(12,2) not null default 0,
  qtd_entregas   integer       not null default 0,
  obs            text,
  confirmado     boolean not null default false,
  confirmado_por uuid,
  confirmado_em  timestamptz,
  criado_em      timestamptz not null default now(),
  unique (entregador_id, data)
);

-- ---------------------------------------------------------------------------
-- 2.3 caixa_fechamentos_geral + caixa_pagamentos [BLOCO 118]
-- ---------------------------------------------------------------------------
create table if not exists public.caixa_fechamentos_geral (
  id uuid primary key default gen_random_uuid(),
  janela_inicio timestamptz,
  fechado_em timestamptz not null default now(),
  fechado_por_id text,
  fechado_por_nome text,
  total_dinheiro numeric(12,2) not null default 0,
  total_pix numeric(12,2) not null default 0,
  total_deposito numeric(12,2) not null default 0,
  total_geral numeric(12,2) not null default 0,
  qtde_pagamentos integer not null default 0,
  observacao text,
  pagamentos jsonb not null default '[]'
);

create table if not exists public.caixa_pagamentos (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  origem text not null,                  -- VENDA | ENTREGA | RECEBIMENTO | PORTAL | AJUSTE
  sale_id text,
  cliente text,
  vendedor text,
  metodo text not null,                  -- DINHEIRO | PIX | DEPOSITO
  valor numeric(12,2) not null,
  comprovante text,                      -- caminho no bucket fotos-pedidos ou dataURL
  detalhe text,
  usuario_id text,
  usuario_nome text,
  fechamento_id uuid references public.caixa_fechamentos_geral(id) on delete set null
);

-- ---------------------------------------------------------------------------
-- 2.4 daily_routes [setup-daily-routes.sql]
-- ---------------------------------------------------------------------------
create table if not exists public.daily_routes (
  vendedor_id TEXT NOT NULL,
  data TEXT NOT NULL,
  client_ids TEXT[] DEFAULT '{}',
  skipped_client_ids TEXT[] DEFAULT '{}',
  PRIMARY KEY (vendedor_id, data)
);

-- ---------------------------------------------------------------------------
-- 2.5 push_tokens [setup-push-tokens.sql]
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  keys_auth TEXT,
  keys_p256dh TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2.6 user_locations [setup-user-locations.sql]
-- ---------------------------------------------------------------------------
create table if not exists public.user_locations (
  user_id TEXT PRIMARY KEY,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2.7 xml_importacoes + xml_itens [BLOCO 95 / fila fiscal]
-- ---------------------------------------------------------------------------
create table if not exists public.xml_importacoes (
  id           uuid primary key default gen_random_uuid(),
  chave        text not null,                       -- chave de acesso 44 díg (dedup no app)
  origem       text,
  emit_cnpj    text,
  emit_nome    text,
  emit_ie      text,
  numero       text,
  serie        text,
  data_emissao timestamptz,
  valor_total  numeric(14,2),
  qtd_itens    integer default 0,
  xml_text     text,                                -- backup integral do XML
  criado_em    timestamptz not null default now()
);
create unique index if not exists idx_xml_importacoes_chave
  on public.xml_importacoes (chave);

create table if not exists public.xml_itens (
  id              uuid primary key default gen_random_uuid(),
  importacao_id   uuid references public.xml_importacoes(id) on delete cascade,
  c_prod          text,
  c_ean           text,
  x_prod          text,
  ncm             text,
  cest            text,                             -- [BLOCO 95.1]
  cfop            text,
  unidade         text,
  quantidade      numeric(12,3),
  valor_unitario  numeric(12,4),
  valor_total     numeric(14,2),
  cst_icms        text,
  csosn_icms      text,
  status          text not null default 'PENDENTE', -- PENDENTE | VINCULADO | CRIADO | IGNORADO
  produto_id      uuid,                             -- vínculo ao catálogo
  resolvido_em    timestamptz,
  entrada_estoque_em timestamptz,                   -- [BLOCO 95.1] anti-duplo estoque
  criado_em       timestamptz not null default now()
);
create index if not exists idx_xml_itens_import on public.xml_itens (importacao_id);
create index if not exists idx_xml_itens_status on public.xml_itens (status);

-- ---------------------------------------------------------------------------
-- 2.8 spedy_webhook_events + notas_recebidas [BLOCO 95]
-- ---------------------------------------------------------------------------
create table if not exists public.spedy_webhook_events (
  id           uuid PRIMARY KEY,          -- id da entrega (webhook-id / corpo.id)
  event        text NOT NULL,             -- invoice.status_changed, inbound_invoice.* ...
  payload      jsonb NOT NULL,            -- envelope completo { id, event, data }
  recebido_em  timestamptz NOT NULL DEFAULT now(),
  processado   boolean NOT NULL DEFAULT false,
  acao         text
);

create table if not exists public.notas_recebidas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spedy_id           text UNIQUE,
  chave_acesso       text UNIQUE,       -- chave NF-e 44 díg
  modelo             text DEFAULT '55',
  emissor_cnpj       text,
  emissor_nome       text,
  emissor_uf         text,
  numero             text,
  serie              text,
  valor_total        numeric(14,2),
  qtd_itens          integer,
  data_emissao       timestamptz,
  is_complete        boolean DEFAULT false,
  manifestacao       text,              -- science | confirmation | unknown_operation | declined
  status_sefaz       text,
  xml                text,
  danfe_url          text,
  processado_entrada boolean DEFAULT false,
  erro_matching      text,
  recebido_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz
);

-- ---------------------------------------------------------------------------
-- 2.9 estoque_movimentos — KARDEX [BLOCO 108]
-- ---------------------------------------------------------------------------
create table if not exists public.estoque_movimentos (
  id             uuid primary key default gen_random_uuid(),
  produto_id     uuid not null,
  tipo           text not null check (tipo in ('ENTRADA','SAIDA','AJUSTE','ESTORNO')),
  origem         text not null default 'MANUAL',   -- VENDA | MANUAL | XML | CARGA
  referencia     text,
  quantidade     numeric(12,3) not null,
  custo_unitario numeric(12,4),
  saldo_apos     numeric(12,3),
  usuario_id     uuid,
  usuario_nome   text,
  criado_em      timestamptz not null default now()
);


-- ============================================================================
-- SEÇÃO 3 — COLUNAS ADICIONAIS (todos os ALTERs dos blocos, consolidados)
-- ============================================================================

-- [BLOCO 5/6/7] pré-venda
-- (sales.route_id + FK para entrega_rotas aplicados logo abaixo — a tabela
--  entrega_rotas já foi criada na SEÇÃO 2)
alter table public.app_users add column if not exists pre_venda boolean not null default false;
alter table public.sales add column if not exists tipo_venda      text not null default 'PRONTA'; -- PRONTA | PRE_VENDA
alter table public.sales add column if not exists entrega_status  text;   -- PENDENTE | EM_ROTA | ENTREGUE | FALHOU
alter table public.sales add column if not exists entrega_seq     integer;
alter table public.sales add column if not exists estoque_baixado boolean not null default false;
alter table public.entrega_eventos add column if not exists foto text;

-- FK de sales.route_id -> entrega_rotas (aqui a tabela já existe)
alter table public.sales add column if not exists route_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sales_route_id_fkey'
      and conrelid = 'public.sales'::regclass
  ) then
    alter table public.sales
      add constraint sales_route_id_fkey foreign key (route_id) references public.entrega_rotas(id);
  end if;
end $$;

-- [BLOCO 12] campos fiscais de produto + email do cliente
alter table public.products add column if not exists ncm     text;
alter table public.products add column if not exists cest    text;
alter table public.products add column if not exists cfop    text;
alter table public.products add column if not exists ean     text;
alter table public.products add column if not exists unidade text default 'UN';
alter table public.products add column if not exists origem  text default '0';
alter table public.clients add column if not exists email    text;

-- [BLOCO 13] fila contínua de entregas
alter table public.sales add column if not exists trocas        text;
alter table public.sales add column if not exists prioridade    smallint not null default 0;
alter table public.sales add column if not exists separado      boolean  not null default false;
alter table public.sales add column if not exists separado_em   timestamptz;
alter table public.sales add column if not exists entregador_id uuid;

-- [BLOCO 14] comissão por produto + melhorias + push por usuário + FIFO
alter table public.products add column if not exists comissao_pv_percentual numeric(5,2) default 5;
alter table public.app_settings add column if not exists melhor_troca_separacao boolean not null default true;
alter table public.app_settings add column if not exists melhor_push_entrega    boolean not null default true;
alter table public.app_settings add column if not exists melhor_whatsapp        boolean not null default true;
alter table public.app_settings add column if not exists melhor_bairro          boolean not null default true;
alter table public.app_settings add column if not exists melhor_foto_entrega    boolean not null default true;
alter table public.app_settings add column if not exists melhor_push_falha      boolean not null default true;
alter table public.push_tokens  add column if not exists user_id uuid;
alter table public.commissions  add column if not exists valor_pago numeric(12,2) not null default 0;

-- [BLOCO 15/18/23] catálogo do portal
alter table public.products     add column if not exists imagem             text;
alter table public.products     add column if not exists unidades_por_caixa integer default 1;
alter table public.products     add column if not exists obs                text;
alter table public.products     add column if not exists familia_catalogo   text;
alter table public.app_settings add column if not exists catalogo_order     text[];

-- [BLOCO 25] boleto Inter + chave da nota
alter table public.sales add column if not exists inter_boleto_status     text;
alter table public.sales add column if not exists inter_boleto_codigo     text;
alter table public.sales add column if not exists inter_boleto_seu_numero text;
alter table public.sales add column if not exists inter_boleto_linha      text;
alter table public.sales add column if not exists inter_boleto_barras     text;
alter table public.sales add column if not exists inter_boleto_pix        text;
alter table public.sales add column if not exists inter_boleto_vencimento date;
alter table public.sales add column if not exists inter_boleto_valor      numeric(10,2);
alter table public.sales add column if not exists inter_boleto_erro       text;
alter table public.sales add column if not exists inter_boleto_em         timestamptz;
alter table public.sales add column if not exists nota_chave              text;

-- [BLOCO 27] Rota 2 por vendedor
alter table public.app_users add column if not exists rota2 boolean not null default false;

-- [BLOCO 29/40] produto teste + modo do DOCUMENTO da venda
-- BLOCO 217: estoque_nota/estoque_semnf (estoque 1/2) e o modo da van
-- (cargas.modo_nota) foram REMOVIDOS — um só saldo: estoque_principal.
alter table public.products         add column if not exists produto_teste  boolean default false;
alter table public.sales            add column if not exists modo_nota      text;   -- NFE | NFCE | CUPOM (documento da venda)

-- [BLOCO 31] ordem manual da fila
alter table public.sales add column if not exists ordem_entrega int;

-- [BLOCO 58] check de carga no veículo
alter table public.sales add column if not exists carga_confirmada_em   timestamptz;
alter table public.sales add column if not exists carga_confirmada_por  uuid;

-- [BLOCO 62] chave Pix do recebimento editável
alter table public.app_settings add column if not exists pix_chave_entrega text;

-- [BLOCO 70] cliente especial GB + preço especial GB
alter table public.clients  add column if not exists cliente_especial_gb boolean not null default false;
alter table public.products add column if not exists preco_especial_gb   numeric(12,2) not null default 0;

-- [BLOCO 95] cadastro fiscal Spedy (complementos)
alter table public.products add column if not exists csosn           varchar(4);
alter table public.products add column if not exists unidade_fiscal varchar(6);
alter table public.products add column if not exists peso_kg        numeric(10,3);
alter table public.products add column if not exists st_entrada     boolean default false;
alter table public.products add column if not exists cfop_padrao    integer;
alter table public.products add column if not exists spedy_product_id text;

-- [BLOCO 98] valor das trocas em custo
alter table public.sales add column if not exists trocas_valor numeric(12,2);

-- [BLOCO 80] custo médio congelado por item
alter table public.sale_items add column if not exists custo_unitario numeric(12,4);

-- [BLOCO 108] modo cupom + central ERP
-- (a FK route_id foi aplicada na seção anterior, após criar entrega_rotas)
alter table public.products     add column if not exists preco_cupom numeric(12,2) not null default 0;
alter table public.clients      add column if not exists modo_cupom  boolean not null default false;
alter table public.app_settings add column if not exists erp_config  jsonb not null default '{}'::jsonb;

-- [BLOCO 145] CÓDIGO INTERNO DO PRODUTO — o código que APARECE NA NF
-- (NÃO é o EAN; o app envia este código no campo codigo_produto da NF-e/NFC-e)
alter table public.products add column if not exists codigo text;
create unique index if not exists products_codigo_uidx
  on public.products (codigo) where codigo is not null and codigo <> '';

-- Fiscal das notas (Bloco 10/109 — INFERIDO DO CÓDIGO: notas/cupom/pre-venda)
alter table public.sales add column if not exists nota_status     text;  -- EMITINDO | AUTORIZADA | REJEITADA | CANCELADA
alter table public.sales add column if not exists nota_tipo       text;  -- NFE | NFCE
alter table public.sales add column if not exists nota_numero     text;
alter table public.sales add column if not exists nota_ref        text;
alter table public.sales add column if not exists nota_pdf_url    text;
alter table public.sales add column if not exists nota_xml_url    text;
alter table public.sales add column if not exists nota_erro       text;
alter table public.sales add column if not exists nota_emitida_em timestamptz;


-- ============================================================================
-- SEÇÃO 4 — FUNÇÕES (RPCs) E TRIGGERS
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 4.1 baixar_estoque_principal [BLOCO 5, v3 do BLOCO 217 — estoque central único]
-- ---------------------------------------------------------------------------
create or replace function public.baixar_estoque_principal(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baixado boolean;
begin
  select estoque_baixado into v_baixado
    from public.sales where id = p_sale_id;
  if v_baixado is not true then
    update public.sales set estoque_baixado = true where id = p_sale_id;

    -- BLOCO 217: UM só saldo — a entrega da pré-venda baixa o ESTOQUE CENTRAL
    update public.products p
       set estoque_principal = coalesce(p.estoque_principal, 0) - i.quantidade
      from public.sale_items i
     where i.sale_id = p_sale_id
       and i.produto_id = p.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4.2 Estornos na exclusão de item/venda [BLOCO 5/6, v3 do BLOCO 217]
-- ---------------------------------------------------------------------------
create or replace function public.pre_venda_estorna_item()
returns trigger
language plpgsql
as $$
declare
  v_sale record;
begin
  select tipo_venda, estoque_baixado into v_sale
    from public.sales where id = old.sale_id;
  if found and v_sale.tipo_venda = 'PRE_VENDA' and v_sale.estoque_baixado is true then
    update public.products
       set estoque_principal = coalesce(estoque_principal, 0) + old.quantidade
     where id = old.produto_id;
    update public.sales set estoque_baixado = false where id = old.sale_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_pre_venda_estorna_item on public.sale_items;
create trigger trg_pre_venda_estorna_item
  before delete on public.sale_items
  for each row execute function public.pre_venda_estorna_item();

create or replace function public.pre_venda_estorna_venda()
returns trigger
language plpgsql
as $$
begin
  if old.tipo_venda = 'PRE_VENDA' and old.estoque_baixado is true then
    update public.products p
       set estoque_principal = coalesce(p.estoque_principal, 0) + i.quantidade
      from public.sale_items i
     where i.sale_id = old.id and i.produto_id = p.id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_pre_venda_estorna_venda on public.sales;
create trigger trg_pre_venda_estorna_venda
  before delete on public.sales
  for each row execute function public.pre_venda_estorna_venda();

create or replace function public.pre_venda_atualiza_rota()
returns trigger
language plpgsql
as $$
begin
  if old.route_id is not null then
    update public.entrega_rotas r
       set total_paradas = (select count(*) from public.sales s where s.route_id = r.id)
     where r.id = old.route_id;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_pre_venda_atualiza_rota on public.sales;
create trigger trg_pre_venda_atualiza_rota
  after delete on public.sales
  for each row execute function public.pre_venda_atualiza_rota();

-- ---------------------------------------------------------------------------
-- 4.3 Custo médio congelado [BLOCO 80]
-- ---------------------------------------------------------------------------
create or replace function public.setar_custo_unitario_venda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.custo_unitario is null then
    select p.preco_custo into new.custo_unitario
    from public.products p
    where p.id = coalesce(new.produto_id, new.product_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_custo_unitario_sale_items on public.sale_items;
create trigger trg_custo_unitario_sale_items
  before insert on public.sale_items
  for each row execute function public.setar_custo_unitario_venda();

-- ---------------------------------------------------------------------------
-- 4.4 Kardex: SAÍDA na venda / ESTORNO na exclusão [BLOCO 108]
-- ---------------------------------------------------------------------------
create or replace function public.trg_sale_items_kardex()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v         jsonb := to_jsonb(coalesce(new, old));
  v_produto uuid;
  v_qtd     numeric;
  v_custo   numeric;
begin
  v_produto := nullif(v->>'produto_id', '')::uuid;
  if v_produto is null then
    v_produto := nullif(v->>'product_id', '')::uuid;
  end if;
  if v_produto is null then
    return coalesce(new, old);
  end if;

  v_qtd := nullif(v->>'quantidade', '')::numeric;
  if v_qtd is null or v_qtd = 0 then
    return coalesce(new, old);
  end if;

  v_custo := nullif(v->>'custo_unitario', '')::numeric;

  if (tg_op = 'INSERT') then
    insert into public.estoque_movimentos (produto_id, tipo, origem, referencia, quantidade, custo_unitario)
    values (v_produto, 'SAIDA', 'VENDA', v->>'sale_id', v_qtd, v_custo);
  elsif (tg_op = 'DELETE') then
    insert into public.estoque_movimentos (produto_id, tipo, origem, referencia, quantidade, custo_unitario)
    values (v_produto, 'ESTORNO', 'VENDA', v->>'sale_id', v_qtd, v_custo);
  end if;
  return coalesce(new, old);
exception when others then
  return coalesce(new, old);
end $$;

drop trigger if exists trg_kardex_sale_items on public.sale_items;
create trigger trg_kardex_sale_items
  after insert or delete on public.sale_items
  for each row execute function public.trg_sale_items_kardex();

-- ---------------------------------------------------------------------------
-- 4.5 registrar_movimento_estoque (entrada/saída atômica) [BLOCO 108]
-- ---------------------------------------------------------------------------
create or replace function public.registrar_movimento_estoque(
  p_produto_id     uuid,
  p_tipo           text,
  p_quantidade     numeric,
  p_origem         text default 'MANUAL',
  p_referencia     text default null,
  p_custo_unitario numeric default null,
  p_usuario_id     uuid default null,
  p_usuario_nome   text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta numeric;
  v_novo  numeric;
  -- BLOCO 208: custo médio ponderado na ENTRADA (mesma fórmula do sql/bloco208)
  v_saldo_antes numeric;
  v_custo_atual numeric;
  v_novo_custo  numeric;
begin
  if p_quantidade is null or p_quantidade <= 0 then
    return json_build_object('ok', false, 'erro', 'Quantidade deve ser maior que zero.');
  end if;
  if p_tipo not in ('ENTRADA','SAIDA') then
    return json_build_object('ok', false, 'erro', 'Tipo deve ser ENTRADA ou SAIDA.');
  end if;

  v_delta := case p_tipo when 'ENTRADA' then p_quantidade else -p_quantidade end;

  update public.products
     set estoque_principal = greatest(0, coalesce(estoque_principal, 0) + v_delta)
   where id = p_produto_id
  returning estoque_principal into v_novo;

  if not found then
    return json_build_object('ok', false, 'erro', 'Produto não encontrado.');
  end if;

  -- BLOCO 208: ENTRADA com custo recalcula o PREÇO DE CUSTO MÉDIO ponderado:
  --   (saldo_antes × custo_atual + qtd × custo_nota) ÷ (saldo_antes + qtd).
  --   Saldo antes <= 0 → o custo médio vira o custo da própria nota (a entrada
  --   é 100% do saldo). SAÍDA nunca mexe no custo. Preço de venda intacto.
  if p_tipo = 'ENTRADA' and coalesce(p_custo_unitario, 0) > 0 then
    v_saldo_antes := v_novo - v_delta;
    select preco_custo into v_custo_atual from public.products where id = p_produto_id;
    v_novo_custo := case
      when v_saldo_antes > 0 then
        ((v_saldo_antes * coalesce(v_custo_atual, 0)) + (p_quantidade * p_custo_unitario))
          / (v_saldo_antes + p_quantidade)
      else p_custo_unitario
    end;
    update public.products
       set preco_custo = round(v_novo_custo::numeric, 2)
     where id = p_produto_id;
  end if;

  insert into public.estoque_movimentos
    (produto_id, tipo, origem, referencia, quantidade, custo_unitario, saldo_apos, usuario_id, usuario_nome)
  values
    (p_produto_id, p_tipo, coalesce(p_origem, 'MANUAL'), p_referencia, p_quantidade,
     p_custo_unitario, v_novo, p_usuario_id, p_usuario_nome);

  return json_build_object('ok', true, 'saldo', v_novo,
    'custoMedio', (select preco_custo from public.products where id = p_produto_id));
exception when others then
  return json_build_object('ok', false, 'erro', sqlerrm);
end $$;

revoke execute on function public.registrar_movimento_estoque(uuid, text, numeric, text, text, numeric, uuid, text) from public;
revoke execute on function public.registrar_movimento_estoque(uuid, text, numeric, text, text, numeric, uuid, text) from anon;
revoke execute on function public.registrar_movimento_estoque(uuid, text, numeric, text, text, numeric, uuid, text) from authenticated;

-- ---------------------------------------------------------------------------
-- 4.6 aceitar_carga_vendedor (aceite v1, legado) [BLOCO 11B]
-- ---------------------------------------------------------------------------
create or replace function public.aceitar_carga_vendedor(p_carga_pendente_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendedor uuid;
  v_itens    jsonb;
  v_status   text;
  v_total    int;
begin
  select vendedor_id, coalesce(itens, '[]'::jsonb), status
    into v_vendedor, v_itens, v_status
    from public.cargas_pendentes
   where id = p_carga_pendente_id
     for update;

  if not found then
    raise exception 'Carga pendente nao encontrada (ja aceita ou cancelada?). Atualize a tela.';
  end if;

  if v_status is distinct from 'PENDENTE' then
    raise exception 'Esta carga nao esta mais pendente (status: %).', v_status;
  end if;

  select coalesce(sum(coalesce((it->>'quantidade')::int, 0)), 0)
    into v_total
    from jsonb_array_elements(v_itens) it;

  if v_total <= 0 then
    raise exception 'Esta carga veio VAZIA (soma 0). Peca ao admin para reenviar.';
  end if;

  delete from public.cargas where vendedor_id = v_vendedor;

  insert into public.cargas (vendedor_id, produto_id, quantidade)
  select distinct on (chave)
         v_vendedor,
         chave::uuid,
         qtd
    from (
      select coalesce(it->>'produtoid', it->>'produtoId') as chave,
             coalesce((it->>'quantidade')::int, 0)        as qtd
        from jsonb_array_elements(v_itens) it
    ) x
   where chave is not null
     and qtd > 0
   order by chave, qtd desc;

  update public.cargas_pendentes
     set status = 'ACEITA'
   where id = p_carga_pendente_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4.7 Comissão desativada para o David (Rota 5) [BLOCO 118]
-- ---------------------------------------------------------------------------
create or replace function public.trg_comissoes_skip_david()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  select nome into v_nome from public.app_users where id::text = new.seller_id::text;
  if v_nome is not null and v_nome ilike 'david%' then
    return null; -- regra do dono: não calcula comissão para o David (R5)
  end if;
  return new;
end;
$$;

drop trigger if exists trg_comissoes_skip_david on public.commissions;
create trigger trg_comissoes_skip_david
  before insert on public.commissions
  for each row execute function public.trg_comissoes_skip_david();

-- ---------------------------------------------------------------------------
-- 4.8 Limpeza de push tokens antigos [setup-push-tokens.sql]
-- ---------------------------------------------------------------------------
create or replace function public.clean_old_push_tokens()
returns void as $$
begin
  delete from public.push_tokens where updated_at < now() - interval '30 days';
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 4.9 processar_venda_v2 [INFERIDO DO CÓDIGO]
--     Chamada (src/services/saleService.ts):
--       rpc('processar_venda_v2', { p_vendedor_id, p_client_id, p_valor_total,
--             p_valor_pago, p_metodo_pagamento, p_detalhe_pagamento,
--             p_status_pagamento, p_data_venda, p_data_vencimento,
--             p_itens: [{produtoid, quantidade, precovenda}] })
--     Grava a venda + itens e baixa o estoque DA VAN do vendedor
--     (tabela cargas). Custa triggers cuidam do resto (custo, kardex).
-- ---------------------------------------------------------------------------
create or replace function public.processar_venda_v2(
  p_vendedor_id       uuid,
  p_client_id         uuid,
  p_valor_total       numeric,
  p_valor_pago        numeric default 0,
  p_metodo_pagamento  text default 'DINHEIRO',
  p_detalhe_pagamento text default '',
  p_status_pagamento  text default 'PAGO',
  p_data_venda        timestamptz default now(),
  p_data_vencimento   timestamptz default null,
  p_itens             jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_item    jsonb;
begin
  insert into public.sales
    (vendedor_id, client_id, valor_total, valor_pago, metodo_pagamento,
     detalhe_pagamento, status_pagamento, status, data_venda, data_vencimento)
  values
    (p_vendedor_id, p_client_id, p_valor_total, coalesce(p_valor_pago, 0),
     coalesce(p_metodo_pagamento, 'DINHEIRO'), coalesce(p_detalhe_pagamento, ''),
     coalesce(p_status_pagamento, 'PAGO'),
     case when coalesce(p_status_pagamento, 'PAGO') = 'PAGO' then 'CONCLUIDA' else 'PENDENTE' end,
     coalesce(p_data_venda, now()), p_data_vencimento)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb))
  loop
    insert into public.sale_items (sale_id, produto_id, quantidade, precovenda)
    values (
      v_sale_id,
      nullif(v_item->>'produtoid', '')::uuid,
      coalesce(nullif(v_item->>'quantidade', '')::numeric, 0),
      coalesce(nullif(v_item->>'precovenda', '')::numeric, 0)
    );

    -- baixa o estoque da VAN do vendedor (tabela cargas); se não houver
    -- linha de carga, segue (best-effort — igual comportamento observado)
    update public.cargas c
       set quantidade = greatest(0, c.quantidade - coalesce(nullif(v_item->>'quantidade','')::numeric, 0))
     where c.vendedor_id = p_vendedor_id
       and c.produto_id  = nullif(v_item->>'produtoid', '')::uuid;
  end loop;

  return v_sale_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4.10 excluir_venda_estornar_estoque [INFERIDO DO CÓDIGO]
--      Devolve itens ao estoque da VAN, apaga comissões, itens e a venda.
--      Os triggers trg_pre_venda_estorna_* cuidam do estoque de casa (PV).
-- ---------------------------------------------------------------------------
create or replace function public.excluir_venda_estornar_estoque(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_itens record;
begin
  -- 1) devolve o estoque da van (venda pronta entrega)
  for v_itens in
    select produto_id, quantidade from public.sale_items where sale_id = p_sale_id
  loop
    update public.cargas c
       set quantidade = c.quantidade + v_itens.quantidade
     where c.produto_id = v_itens.produto_id
       and c.vendedor_id = (select vendedor_id from public.sales where id = p_sale_id);
  end loop;

  -- 2) apaga rastros (entrega_eventos cai por cascade na venda)
  delete from public.commissions where sale_id = p_sale_id;
  delete from public.payment_comprovantes where sale_id = p_sale_id;

  -- 3) itens (trigger do kardex grava ESTORNO) e a venda
  delete from public.sale_items where sale_id = p_sale_id;
  delete from public.sales where id = p_sale_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4.11 apply_carga_admin (carga da van pelo admin) [INFERIDO DO CÓDIGO]
--      Chamada (src/services/cargaService.ts): rpc('apply_carga_admin',
--      { p_vendedor_id, p_itens: [{produtoid, quantidade, precovenda}] })
--      Substitui a carga atual da van pelos itens enviados.
-- ---------------------------------------------------------------------------
create or replace function public.apply_carga_admin(
  p_vendedor_id uuid,
  p_itens       jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.cargas where vendedor_id = p_vendedor_id;

  insert into public.cargas (vendedor_id, produto_id, quantidade)
  select distinct on (chave)
         p_vendedor_id,
         chave::uuid,
         qtd
    from (
      select coalesce(it->>'produtoid', it->>'produtoId') as chave,
             coalesce((it->>'quantidade')::int, 0)        as qtd
        from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) it
    ) x
   where chave is not null
     and qtd > 0
   order by chave, qtd desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4.12 get_sugestoes_cliente (sugestões do portal do cliente)
--      [INFERIDO DO CÓDIGO — o frontend usa {produto_id, nome}]
-- ---------------------------------------------------------------------------
create or replace function public.get_sugestoes_cliente(p_client_id uuid)
returns table (produto_id uuid, nome text, total_comprado numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select si.produto_id,
           p.nome,
           sum(si.quantidade) as total_comprado
      from public.sale_items si
      join public.sales s      on s.id = si.sale_id
      join public.products p   on p.id = si.produto_id
     where s.client_id = p_client_id
       and p.ativo is true
     group by si.produto_id, p.nome
     order by total_comprado desc
     limit 8;
end;
$$;


-- ============================================================================
-- SEÇÃO 5 — ÍNDICES DE PERFORMANCE (dos blocos)
-- ============================================================================
create index if not exists idx_sales_route_id        on public.sales(route_id);
create index if not exists idx_sales_pre_venda       on public.sales(tipo_venda, entrega_status);
create index if not exists idx_entrega_eventos_sale  on public.entrega_eventos(sale_id);
create index if not exists idx_entrega_eventos_route on public.entrega_eventos(route_id);
create index if not exists idx_entrega_rotas_data    on public.entrega_rotas(data);
create index if not exists idx_sales_fila_pv         on public.sales (prioridade, data_venda) where tipo_venda = 'PRE_VENDA';
create index if not exists idx_sales_ordem_entrega   on public.sales (ordem_entrega) where ordem_entrega is not null;
create index if not exists idx_sales_inter_boleto_status on public.sales (inter_boleto_status) where inter_boleto_status is not null;
create index if not exists idx_sales_nota_chave      on public.sales (nota_chave) where nota_chave is not null;
create index if not exists idx_caixa_pag_abertos     on public.caixa_pagamentos (criado_em) where fechamento_id is null;
create index if not exists idx_caixa_pag_fechamento  on public.caixa_pagamentos (fechamento_id);
create index if not exists idx_push_tokens_user      on public.push_tokens (user_id);
create index if not exists idx_spedy_events_event    on public.spedy_webhook_events (event, recebido_em desc);
create index if not exists idx_notas_recebidas_chave on public.notas_recebidas (chave_acesso);
create index if not exists idx_notas_recebidas_pend  on public.notas_recebidas (processado_entrada, recebido_em desc);
create index if not exists idx_kardex_produto        on public.estoque_movimentos (produto_id, criado_em desc);
create index if not exists idx_kardex_tipo           on public.estoque_movimentos (tipo, criado_em desc);
create index if not exists idx_kardex_data           on public.estoque_movimentos (criado_em desc);
create index if not exists idx_kardex_ref            on public.estoque_movimentos (referencia);


-- ============================================================================
-- SEÇÃO 6 — RLS E POLICIES
-- ============================================================================
-- Modelo de segurança do DOCE MANIA:
--  * Backend (API routes) = SUPABASE_SERVICE_ROLE_KEY (bypassa RLS) — sempre.
--  * Browser (anon) lê/escreve DIRETO as tabelas operacionais
--    (vendas, produtos, clientes, comissões, cargas, settings...).
--    Por isso estas tabelas recebem policy PERMISSIVA para anon.
--  * Tabelas de servidor (fiscal, kardex, caixa, entregas, locations)
--    ficam COM RLS FECHADA — o browser só chega nelas via API com sessão.
-- ============================================================================

-- ---------- 6.1 Tabelas que o browser usa DIRETO (policy anon permissiva) ----
do $$
declare t text;
begin
  foreach t in array array[
    'app_users','clients','products','sales','sale_items',
    'commissions','commission_payment_logs','seller_expenses',
    'cargas','cargas_pendentes','app_settings','app_config',
    'system_messages','product_categories','product_subcategories',
    'payment_comprovantes','push_tokens'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "anon_full_access" on public.%I', t);
    execute format(
      'create policy "anon_full_access" on public.%I for all to anon using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- 6.2 Tabelas de servidor (RLS fechada, sem policies) --------------
do $$
declare t text;
begin
  foreach t in array array[
    'entrega_rotas','entrega_eventos',
    'caixa_fechamentos','caixa_fechamentos_geral','caixa_pagamentos',
    'daily_routes','user_locations',
    'xml_importacoes','xml_itens','spedy_webhook_events','notas_recebidas',
    'estoque_movimentos'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    -- remove qualquer policy existente (padrão dos blocos: REVOKE total)
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------- 6.3 RPCs chamados pelo browser (anon pode executar) --------------
grant execute on function public.processar_venda_v2(uuid, uuid, numeric, numeric, text, text, text, timestamptz, timestamptz, jsonb) to anon;
grant execute on function public.excluir_venda_estornar_estoque(uuid) to anon;
grant execute on function public.apply_carga_admin(uuid, jsonb) to anon;
grant execute on function public.aceitar_carga_vendedor(uuid) to anon;
grant execute on function public.baixar_estoque_principal(uuid) to anon;
grant execute on function public.get_sugestoes_cliente(uuid) to anon;


-- ============================================================================
-- SEÇÃO 7 — STORAGE (buckets)
-- ============================================================================
insert into storage.buckets (id, name, public)
values
  ('product-images', 'product-images', true),     -- fotos do catálogo (URL pública)
  ('notas-fiscais',  'notas-fiscais',  false),    -- DANFE PDF/XML arquivados (privado)
  ('comprovantes',   'comprovantes',   false),    -- comprovantes Pix do portal (privado)
  ('fotos-pedidos',  'fotos-pedidos',  false)     -- fotos de entrega/caixa (privado)
on conflict (id) do nothing;

-- Policies de Storage: service_role grava tudo; público só LÊ product-images.
do $$
begin
  -- leitura pública das fotos de produto
  drop policy if exists "public read product-images" on storage.objects;
  create policy "public read product-images" on storage.objects
    for select to anon, authenticated
    using (bucket_id = 'product-images');

  -- gravar fotos de produto (app usa anon + API admin)
  drop policy if exists "anon write product-images" on storage.objects;
  create policy "anon write product-images" on storage.objects
    for insert to anon, authenticated
    with check (bucket_id = 'product-images');

  -- buckets privados: o browser usa SIGNED URL devolvida pela API,
  -- então o anon NÃO lista nem lê direto (acesso só via service_role)
  drop policy if exists "anon upload fotos-pedidos" on storage.objects;
  create policy "anon upload fotos-pedidos" on storage.objects
    for insert to anon
    with check (bucket_id = 'fotos-pedidos');

  drop policy if exists "anon upload comprovantes" on storage.objects;
  create policy "anon upload comprovantes" on storage.objects
    for insert to anon
    with check (bucket_id = 'comprovantes');
end $$;


-- ============================================================================
-- SEÇÃO 8 — DADOS INICIAIS (seed mínimo)
-- ============================================================================

-- Linha global de configurações (os defaults das colunas já entram ligados)
insert into public.app_settings (id) values ('global_settings')
on conflict (id) do nothing;

-- Taxa de comissão de PRÉ-VENDA (50% da comissão do produto) [BLOCO 7]
insert into public.app_config (chave, valor)
values ('comissao_pre_venda_pct', '50')
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- ADMIN DE EXEMPLO (PIN 123456) — só insere se a tabela estiver VAZIA.
-- O hash bcrypt via pgcrypto (gen_salt 'bf') é aceito pelo bcryptjs do app.
-- TROQUE O PIN no primeiro acesso: Admin > Usuarios > editar.
-- ---------------------------------------------------------------------------
insert into public.app_users (nome, perfil, rota, pin_hash, ativo)
select 'Administrador', 'ADMIN', 'ROTA_01', crypt('123456', gen_salt('bf', 10)), true
where not exists (select 1 from public.app_users)
  and not exists (select 1 from public.app_users where perfil = 'ADMIN');


-- ============================================================================
-- VERIFICAÇÃO FINAL (rode os SELECTs abaixo para conferir o setup)
-- ============================================================================
-- 1) Tabelas criadas:
--    select table_name from information_schema.tables
--     where table_schema='public' order by table_name;
-- 2) RPCs instalados:
--    select routine_name from information_schema.routines
--     where routine_schema='public' and routine_type='FUNCTION'
--       and routine_name in ('processar_venda_v2','excluir_venda_estornar_estoque',
--            'apply_carga_admin','aceitar_carga_vendedor','baixar_estoque_principal',
--            'get_sugestoes_cliente','registrar_movimento_estoque');
-- 3) Admin criado:
--    select id, nome, perfil, (pin_hash is not null) as tem_pin from app_users;
-- 4) Buckets:
--    select id, public from storage.buckets;
-- 5) No app, entre como ADMIN e abra: /api/diagnostico-banco
--    (checa por bloco SQL o que está aplicado e o que falta).
-- ============================================================================
-- FIM DO SETUP
-- ============================================================================
