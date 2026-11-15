-- ============================================================
-- BLOCO 29 — ROTA 2: DOIS ESTOQUES EM CASA (COM NF / SEM NF)
--            + MODO DA VAN (1 ou outro, nunca mistura)
-- Rodar no SQL Editor do Supabase. Idempotente (pode rodar 2x).
-- ============================================================
--
-- MODELO DO DONO (discutido e aprovado no chat):
--  * CASA passa a ter 2 estoques: ESTOQUE 1 = COM NF (estoque_nota)
--    e ESTOQUE 2 = SEM NF (estoque_semnf). O estoque_principal antigo
--    continua existindo para os PERFIS LEGADO (nao-rota2) — intocado.
--  * PRONTA ENTREGA = VAN: a carga define o MODO DO DIA (COM_NF ou
--    SEM_NF) — 1 ou outro, NUNCA mistura (bloqueio no servidor).
--    A carga baixa casa do estoque do modo; a venda baixa a van (igual hj).
--  * PRE-VENDA: o ATENDIMENTO pergunta "deseja emitir nota?":
--    SIM (NF-e/NFC-e) -> pedido usa ESTOQUE COM NF; NAO (cupom) -> SEM NF.
--    A baixa acontece na entrega, na coluna certa (RPC v2 abaixo).
--  * PRODUTOS TESTE: 6 produtos "TESTE" que so aparecem no PDV da rota 2.
-- ============================================================

-- ------------------------------------------------------------
-- 1) COLUNAS NOVAS (idempotente)
-- ------------------------------------------------------------
alter table public.products        add column if not exists estoque_nota   int  default 0;
alter table public.products        add column if not exists estoque_semnf  int  default 0;
alter table public.products        add column if not exists produto_teste  boolean default false;
alter table public.cargas          add column if not exists modo_nota      text;   -- 'COM_NF' | 'SEM_NF'
alter table public.cargas_pendentes add column if not exists modo_nota     text;
alter table public.sales           add column if not exists modo_nota      text;   -- 'NFE' | 'NFCE' | 'CUPOM'

-- ------------------------------------------------------------
-- 2) BAIXA DE ESTOQUE NA ENTREGA — v2 modo-aware
--    PRÉ-VENDA rota 2: baixa o estoque de casa do MODO do pedido
--    (CUPOM -> estoque_semnf | NFE/NFCE -> estoque_nota).
--    Vendas antigas (modo_nota null) continuam no estoque_principal.
--    Mesma assinatura e mesmo guard de idempotencia (estoque_baixado).
-- ------------------------------------------------------------
create or replace function public.baixar_estoque_principal(p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baixado boolean;
  v_modo    text;
begin
  select estoque_baixado, modo_nota into v_baixado, v_modo
    from public.sales where id = p_sale_id;
  if v_baixado is not true then
    update public.sales set estoque_baixado = true where id = p_sale_id;

    if v_modo = 'CUPOM' then
      update public.products p
         set estoque_semnf = coalesce(p.estoque_semnf, 0) - i.quantidade
        from public.sale_items i
       where i.sale_id = p_sale_id
         and i.produto_id = p.id;
    elsif v_modo in ('NFE','NFCE') then
      update public.products p
         set estoque_nota = coalesce(p.estoque_nota, 0) - i.quantidade
        from public.sale_items i
       where i.sale_id = p_sale_id
         and i.produto_id = p.id;
    else
      -- LEGADO (Bloco 5 original): venda sem modo baixa o estoque principal
      update public.products p
         set estoque_principal = coalesce(p.estoque_principal, 0) - i.quantidade
        from public.sale_items i
       where i.sale_id = p_sale_id
         and i.produto_id = p.id;
    end if;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 3) ESTORNO NA EXCLUSÃO DE ITEM/PEDIDO — v2 modo-aware
--    Devolve a unidade para a MESMA coluna de onde saiu.
-- ------------------------------------------------------------
create or replace function public.pre_venda_estorna_item()
returns trigger
language plpgsql
as $$
declare
  v_sale record;
begin
  select tipo_venda, estoque_baixado, modo_nota into v_sale
    from public.sales where id = old.sale_id;
  if found and v_sale.tipo_venda = 'PRE_VENDA' and v_sale.estoque_baixado is true then
    if v_sale.modo_nota = 'CUPOM' then
      update public.products
         set estoque_semnf = coalesce(estoque_semnf, 0) + old.quantidade
       where id = old.produto_id;
    elsif v_sale.modo_nota in ('NFE','NFCE') then
      update public.products
         set estoque_nota = coalesce(estoque_nota, 0) + old.quantidade
       where id = old.produto_id;
    else
      update public.products
         set estoque_principal = coalesce(estoque_principal, 0) + old.quantidade
       where id = old.produto_id;
    end if;
    update public.sales set estoque_baixado = false where id = old.sale_id;
  end if;
  return old;
end;
$$;

-- ------------------------------------------------------------
-- 4) PRODUTOS TESTE (so aparecem no PDV da ROTA 2 — produto_teste)
--    3 do estoque COM NF + 3 do estoque SEM NF, R$ 1/2/3.
--    Guard: NOT EXISTS por nome (pode rodar o bloco 2x sem duplicar).
-- ------------------------------------------------------------
insert into public.products
  (nome, preco_custo, preco_venda, preco_minimo, comissao_percentual, comissao_pv_percentual,
   estoque_nota, estoque_semnf, estoque_principal, ativo, unidade, origem, produto_teste)
select 'TESTE NF 01 — Doce A', 0.50, 1.00, 1.00, 10, 5, 50, 0, 0, true, 'UN', '0', true
 where not exists (select 1 from public.products where nome = 'TESTE NF 01 — Doce A');

insert into public.products
  (nome, preco_custo, preco_venda, preco_minimo, comissao_percentual, comissao_pv_percentual,
   estoque_nota, estoque_semnf, estoque_principal, ativo, unidade, origem, produto_teste)
select 'TESTE NF 02 — Doce B', 1.00, 2.00, 2.00, 10, 5, 50, 0, 0, true, 'UN', '0', true
 where not exists (select 1 from public.products where nome = 'TESTE NF 02 — Doce B');

insert into public.products
  (nome, preco_custo, preco_venda, preco_minimo, comissao_percentual, comissao_pv_percentual,
   estoque_nota, estoque_semnf, estoque_principal, ativo, unidade, origem, produto_teste)
select 'TESTE NF 03 — Salgado C', 1.50, 3.00, 3.00, 10, 5, 50, 0, 0, true, 'UN', '0', true
 where not exists (select 1 from public.products where nome = 'TESTE NF 03 — Salgado C');

insert into public.products
  (nome, preco_custo, preco_venda, preco_minimo, comissao_percentual, comissao_pv_percentual,
   estoque_nota, estoque_semnf, estoque_principal, ativo, unidade, origem, produto_teste)
select 'TESTE S/NF 01 — Doce D', 0.50, 1.00, 1.00, 10, 5, 0, 50, 0, true, 'UN', '0', true
 where not exists (select 1 from public.products where nome = 'TESTE S/NF 01 — Doce D');

insert into public.products
  (nome, preco_custo, preco_venda, preco_minimo, comissao_percentual, comissao_pv_percentual,
   estoque_nota, estoque_semnf, estoque_principal, ativo, unidade, origem, produto_teste)
select 'TESTE S/NF 02 — Doce E', 1.00, 2.00, 2.00, 10, 5, 0, 50, 0, true, 'UN', '0', true
 where not exists (select 1 from public.products where nome = 'TESTE S/NF 02 — Doce E');

insert into public.products
  (nome, preco_custo, preco_venda, preco_minimo, comissao_percentual, comissao_pv_percentual,
   estoque_nota, estoque_semnf, estoque_principal, ativo, unidade, origem, produto_teste)
select 'TESTE S/NF 03 — Salgado F', 1.50, 3.00, 3.00, 10, 5, 0, 50, 0, true, 'UN', '0', true
 where not exists (select 1 from public.products where nome = 'TESTE S/NF 03 — Salgado F');

-- ============================================================
-- FIM BLOCO 29
-- ============================================================
