-- ============================================================================
-- BLOCO 6 — OTIMIZAÇÃO DA PRÉ-VENDA
-- Rodar no Supabase -> SQL Editor -> New query -> colar tudo -> RUN.
-- IDEMPOTENTE (pode rodar mais de uma vez).
--
-- O que muda:
--   1) VENDA EXCLUÍDA SAI DA ROTA: excluir um pedido de pré-venda remove a
--      parada da rota (total de paradas é recalculado automaticamente).
--   2) ESTORNO DO ESTOQUE CENTRAL: se a entrega já tinha sido confirmada,
--      excluir a venda devolve as quantidades ao estoque principal.
--   3) FOTO DO BOLETO: entregador anexa a foto do boleto entregue
--      (entrega_eventos.foto) como comprovação.
--   4) Remove a trava antiga que impedia excluir pré-venda.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Eventos da entrega são apagados junto com a venda (cascade)
-- ---------------------------------------------------------------------------
alter table public.entrega_eventos
  drop constraint if exists entrega_eventos_sale_id_fkey;

alter table public.entrega_eventos
  add constraint entrega_eventos_sale_id_fkey
  foreign key (sale_id) references public.sales(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 2) Foto do boleto entregue (base64 no evento de entrega)
-- ---------------------------------------------------------------------------
alter table public.entrega_eventos add column if not exists foto text;

-- ---------------------------------------------------------------------------
-- 3) Remove a trava antiga (Bloco 5) que impedia excluir pré-venda
-- ---------------------------------------------------------------------------
drop trigger if exists trg_protege_pre_venda_delete on public.sales;
drop function if exists public.protege_pre_venda_delete();

-- ---------------------------------------------------------------------------
-- 3a) Estorno do estoque central por item (cobre o caso em que a exclusão
--     apaga sale_items ANTES de apagar a venda)
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

-- ---------------------------------------------------------------------------
-- 3b) Estorno do estoque central pela venda (cobre o caso em que a venda é
--     apagada ANTES dos itens)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3c) Rota atualiza o total de paradas quando uma venda é excluída
-- ---------------------------------------------------------------------------
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

-- ============================================================================
-- FIM DO BLOCO 6
-- ============================================================================
