-- ============================================================================
-- BLOCO 5 — PRÉ-VENDA + ROTAS DE ENTREGA (fase Édipo)
-- Rodar no Supabase -> SQL Editor -> New query -> colar tudo -> RUN.
--
-- IDEMPOTENTE: pode rodar mais de uma vez sem duplicar nada nem quebrar.
-- O que este bloco faz:
--   1) app_users.pre_venda (boolean) + marca Édipo automaticamente
--   2) entrega_rotas (rota por vendedor+dia) e entrega_eventos (timeline+GPS)
--   3) sales: tipo_venda / entrega_status / entrega_seq / route_id / estoque_baixado
--   4) RPC baixar_estoque_principal (baixa do estoque CENTRAL ao entregar,
--      idempotente — nunca desconta duas vezes)
--   5) Exclusão de venda sai da rota + estorna estoque central se entregue
--      (substituída pelo Bloco 6; mantido aqui para instalações novas)
--   6) Índices de performance
--   7) RLS FECHADA nas tabelas novas (padrão do projeto: tudo via API)
--
-- Enquanto este bloco NÃO rodar, o app continua funcionando normal:
-- login e cargas de todos os vendedores voltam a aparecer, e as telas de
-- Entregas mostram o aviso "migração pendente".
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) USUÁRIOS: flag de pré-venda + marca Édipo
-- ---------------------------------------------------------------------------
alter table public.app_users
  add column if not exists pre_venda boolean not null default false;

-- Marca o vendedor Édipo (tolera acento: Édipo/Edipo)
update public.app_users
   set pre_venda = true
 where translate(lower(nome), 'áàâãäéêëíïóôõöúüç', 'aaaaaeeeeiiiooooouuuc') like '%edipo%'
   and pre_venda = false;

-- ---------------------------------------------------------------------------
-- 2) TABELAS NOVAS (antes da FK em sales.route_id)
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
-- 3) SALES: colunas da pré-venda
-- ---------------------------------------------------------------------------
alter table public.sales add column if not exists tipo_venda       text not null default 'PRONTA';
alter table public.sales add column if not exists entrega_status   text;                -- PENDENTE | EM_ROTA | ENTREGUE | FALHOU
alter table public.sales add column if not exists entrega_seq      integer;
alter table public.sales add column if not exists estoque_baixado  boolean not null default false;
alter table public.sales
  add column if not exists route_id uuid references public.entrega_rotas(id);

-- ---------------------------------------------------------------------------
-- 4) RPC: baixa do estoque PRINCIPAL quando a entrega é confirmada
--    (chamada: supabase.rpc('baixar_estoque_principal', { p_sale_id }))
--    Idempotente via sales.estoque_baixado.
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
  select estoque_baixado into v_baixado from public.sales where id = p_sale_id;
  if v_baixado is not true then
    update public.sales set estoque_baixado = true where id = p_sale_id;

    update public.products p
       set estoque_principal = coalesce(p.estoque_principal, 0) - i.quantidade
      from public.sale_items i
     where i.sale_id = p_sale_id
       and i.produto_id = p.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) EXCLUSÃO DE PRÉ-VENDA: sai da rota + estorna estoque central
--    (substitui a antiga trava anti-delete — ver Bloco 6)
-- ---------------------------------------------------------------------------
drop trigger if exists trg_protege_pre_venda_delete on public.sales;
drop function if exists public.protege_pre_venda_delete();

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
     where i.sale_id = old.id
       and i.produto_id = p.id;
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
-- 6) ÍNDICES
-- ---------------------------------------------------------------------------
create index if not exists idx_sales_route_id        on public.sales(route_id);
create index if not exists idx_sales_pre_venda       on public.sales(tipo_venda, entrega_status);
create index if not exists idx_entrega_eventos_sale  on public.entrega_eventos(sale_id);
create index if not exists idx_entrega_eventos_route on public.entrega_eventos(route_id);
create index if not exists idx_entrega_rotas_data    on public.entrega_rotas(data);

-- ---------------------------------------------------------------------------
-- 7) RLS FECHADA (padrão do projeto: acesso só via API service_role)
-- ---------------------------------------------------------------------------
alter table public.entrega_rotas  enable row level security;
alter table public.entrega_eventos enable row level security;

revoke all on public.entrega_rotas  from anon, authenticated;
revoke all on public.entrega_eventos from anon, authenticated;

-- ============================================================================
-- FIM DO BLOCO 5 — depois de rodar:
--   • Édipo passa a ver a escolha "Pronta Entrega x Pré-Venda" ao abrir cliente
--   • Aba ENTREGAS aparece para Édipo e no Admin (pode levar ~30s: cache)
--   • Nenhum outro vendedor é afetado (pre_venda = false para todos os demais)
-- ============================================================================
