-- ============================================================
-- BLOCO 217 — ESTOQUE CENTRAL ÚNICO (fim da regra ESTOQUE 1 / ESTOQUE 2)
-- ============================================================
-- Pedido do dono: "não estamos mais usando a regra de estoque 1 e estoque 2,
-- exclua tudo que existe sobre essa regra pois está atrapalhando; hoje tudo
-- vem do estoque central e abastece a van para pronta entrega e o próprio
-- central para pré-venda".
--
-- O que a regra antiga fazia (e por que ATRAPALHAVA):
--   products.estoque_nota  = "Estoque 1" (contador de saídas COM NF);
--   products.estoque_semnf = "Estoque 2" (contador de saídas com cupom);
--   cargas.modo_nota / cargas_pendentes.modo_nota = van COM_NF/SEM_NF.
--   E o RPC baixar_estoque_principal descontava DO CONTADOR (estoque 1/2)
--   nas entregas de pré-venda com documento — o ESTOQUE CENTRAL nunca baixava.
--
-- O que muda:
--   1) RPCs reescritos (v3): baixa/estorno SEMPRE no ESTOQUE CENTRAL
--      (products.estoque_principal) — um saldo só.
--   2) Colunas da regra DROPADAS (com backup antes).
--   3) sales.modo_nota CONTINUA (é o documento da venda: NFE|NFCE|CUPOM —
--      fiscal, não estoque).
--
-- Ordem importa: funções primeiro, drop depois. Idempotente.
-- Rode no SQL Editor do Supabase.
-- ============================================================

-- ---------- 1) BACKUP DE SEGURANÇA (snapshot antes do drop) ----------
create table if not exists products_backup_bloco217 as
select id, nome, estoque_principal, estoque_nota, estoque_semnf, now() as backup_em
  from products;

-- ---------- 2) RPCs v3 — SEMPRE no ESTOQUE CENTRAL ----------
-- 2.1 baixar_estoque_principal (entrega da pré-venda baixa o estoque central)
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

    -- BLOCO 217: UM só saldo — a pré-venda baixa o ESTOQUE CENTRAL
    -- (antes descontava dos contadores estoque_nota/estoque_semnf, que eram
    -- apagados na migração do Bloco 75: o central nunca baixava com documento)
    update public.products p
       set estoque_principal = coalesce(p.estoque_principal, 0) - i.quantidade
      from public.sale_items i
     where i.sale_id = p_sale_id
       and i.produto_id = p.id;
  end if;
end;
$$;

-- 2.2 Estornos (exclusão de item / venda de pré-venda devolvem ao CENTRAL)
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

-- (os triggers trg_pre_venda_estorna_* já apontam para estas funções —
--  create or replace não precisa recriar trigger)

-- ---------- 3) DROP das colunas da regra (depois das funções!) ----------
alter table public.products         drop column if exists estoque_nota;
alter table public.products         drop column if exists estoque_semnf;
alter table public.cargas           drop column if exists modo_nota;   -- COM_NF | SEM_NF (van única)
alter table public.cargas_pendentes drop column if exists modo_nota;

-- ============================================================
-- FIM — A partir daqui: ESTOQUE CENTRAL (products.estoque_principal)
-- abastece a VAN (pronta entrega) e o próprio CENTRAL (pré-venda).
-- sales.modo_nota permanece — é o DOCUMENTO da venda (NFE/NFCE/CUPOM).
-- ============================================================
