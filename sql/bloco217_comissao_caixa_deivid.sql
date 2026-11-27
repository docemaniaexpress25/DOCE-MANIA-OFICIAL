-- ============================================================================
-- BLOCO 217 — COMISSÃO E CAIXA DO DEIVID (antigo David, Rota 5): NÚMEROS REAIS
--
-- Pedido do dono: "verifique se comissões dos vendedores e caixa do David
-- estão corretos no quesito a função de calcular isso. Não pode haver erros
-- e os números sempre devem ser reais."
--
-- AUDITORIA REAL (24/11/2026, feito contra o banco de produção) achou 2 bugs:
--
-- BUG 1 — COMISSÕES DO DEIVID NASCENDO DE NOVO (regra do dono violada)
--   O BLOCO 118 desligou a comissão do David (R5). O vendedor foi RENOMEADO
--   para "Deivid ..." e a trigger do banco trg_comissoes_skip_david ainda
--   casava SÓ 'david%' (ilike) — o Deivid ESCAPAVA e as comissões voltaram a
--   ser gravadas (81 linhas no banco, mais recentes de 24/11). O app já casa
--   david|deivid (Bloco 166, src/lib/equipe.isDavidNome) — o banco é que ficou
--   para trás. AQUI: trigger v2 casa POR ID OU NOME (david|deivid) + backup e
--   limpeza das comissões dele.
--
-- BUG 2 — CAIXA DO DEIVID VAZIO (caixa_pagamentos com 0 linhas)
--   Existem 29 vendas à vista PAGO (DINHEIRO/PIX) do Deivid — ex.: R$ 919,57
--   PIX em 23/11 — e NENHUMA linha em caixa_pagamentos. A trigger
--   trg_caixa_david_sales (SQL 165/166/167) não está ativa no banco real
--   (dropada ou nunca aplicada na versão atual). O POST client-side do PDV
--   era a única fonte e dependia da SESSÃO do vendedor — com a sessão expirada
--   (corrigido no app no mesmo bloco) o registro era engolido em silêncio.
--   AQUI: trigger recriada (à prova de renome, idempotente, AFTER INSERT OR
--   UPDATE) + BACKFILL de todas as vendas à vista PAGO e boletos a prazo do
--   Deivid desde sexta 13/11 (janela da regra do dono, Bloco 165).
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser no SQL Editor do Supabase.
-- Rodar COM O USUÁRIO ADMIN do projeto (postgres), não com a chave anon.
-- ============================================================================

-- ============================================================================
-- PARTE A — TRIGGER DE COMISSÃO v2: descarta comissão do Deivid/David
-- ============================================================================

create or replace function public.trg_comissoes_skip_david()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  -- Regra do dono (BLOCO 118, fix BLOCO 217): sem comissão para o caixa
  -- próprio da Rota 5. Casamento À PROVA DE RENOME: por ID fixo OU nome
  -- david|deivid (o vendedor foi renomeado de David para Deivid).
  if coalesce(new.seller_id::text, '') = '7c989927-a148-479c-bf00-11f35bfa66b0' then
    return null; -- descarta o insert
  end if;
  select nome into v_nome from app_users where id::text = new.seller_id::text;
  if v_nome is not null and v_nome ~* '^\s*(david|deivid)' then
    return null; -- descarta o insert
  end if;
  return new;
end;
$$;

drop trigger if exists trg_comissoes_skip_david on public.commissions;
create trigger trg_comissoes_skip_david
  before insert on public.commissions
  for each row execute function public.trg_comissoes_skip_david();

-- Backup + limpeza das comissões JÁ gravadas do Deivid (regra do dono:
-- repasses do Deivid não existem — a compensação dele é o próprio caixa).
drop table if exists backup_commissions_bloco217;
create table backup_commissions_bloco217 as
select * from commissions
 where seller_id::text = '7c989927-a148-479c-bf00-11f35bfa66b0'
    or seller_id in (select id from app_users where nome ~* '^\s*(david|deivid)');

delete from commissions
 where seller_id::text = '7c989927-a148-479c-bf00-11f35bfa66b0'
    or seller_id in (select id from app_users where nome ~* '^\s*(david|deivid)');

-- ============================================================================
-- PARTE B — TRIGGER DO CAIXA v3: grava à vista PAGO + boleto a prazo do Deivid
-- (mesma regra do SQL 166/167 — recriada aqui para GARANTIR que está ativa)
-- ============================================================================

create or replace function public.trg_caixa_david_sales()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendedor text;
  v_cliente  text;
  v_metodo   text;
  v_valor    numeric(12,2);
  v_det      text;
begin
  -- Vendedor da venda (à prova de renome: casa por ID fixo OU nome david/deivid)
  select nome into v_vendedor from app_users where id::text = new.vendedor_id::text;
  if coalesce(new.vendedor_id::text, '') <> '7c989927-a148-479c-bf00-11f35bfa66b0'
     and coalesce(v_vendedor, '') !~* '^\s*(david|deivid)' then
    return null;
  end if;

  select nome_fantasia into v_cliente from clients where id::text = new.client_id::text;
  v_metodo := upper(coalesce(new.metodo_pagamento, ''));

  -- 1) À VISTA recebido (dinheiro/pix/depósito PAGO)
  if v_metodo in ('DINHEIRO','PIX','DEPOSITO') and upper(coalesce(new.status_pagamento,'')) = 'PAGO' then
    v_valor := coalesce(nullif(new.valor_pago, 0), new.valor_total, 0);
    if v_valor > 0 then
      v_det := 'Venda à vista ' || lower(v_metodo) || ' — automático (trigger)';
      -- Idempotência: venda+método+valor já no caixa (qualquer estado) não duplica
      if not exists (
        select 1 from caixa_pagamentos c
        where c.sale_id = new.id::text
          and c.metodo = v_metodo
          and c.valor = v_valor
      ) then
        insert into caixa_pagamentos
          (origem, metodo, valor, sale_id, cliente, vendedor, detalhe, usuario_nome)
        values
          ('VENDA', v_metodo, v_valor, new.id::text, v_cliente, v_vendedor, v_det, 'AUTOMATICO (trigger)');
      end if;
    end if;
  end if;

  -- 2) A PRAZO = BOLETO entra no caixa como pendente (sai quando pago — 167)
  if v_metodo = 'A_PRAZO' then
    v_valor := coalesce(new.valor_total, 0);
    if v_valor > 0 then
      v_det := 'Boleto gerado na venda (a prazo)'
               || case when new.data_vencimento is not null
                       then ' — venc. ' || to_char(new.data_vencimento, 'DD/MM/YYYY')
                       else '' end;
      if not exists (
        select 1 from caixa_pagamentos c
        where c.sale_id = new.id::text
          and c.metodo = 'BOLETO'
          and c.valor = v_valor
      ) then
        insert into caixa_pagamentos
          (origem, metodo, valor, sale_id, cliente, vendedor, detalhe, usuario_nome)
        values
          ('VENDA', 'BOLETO', v_valor, new.id::text, v_cliente, v_vendedor, v_det, 'AUTOMATICO (trigger)');
      end if;
    end if;
  end if;

  return null; -- AFTER trigger
end;
$$;

drop trigger if exists trg_caixa_david_sales on public.sales;
create trigger trg_caixa_david_sales
  after insert or update on public.sales
  for each row execute function public.trg_caixa_david_sales();

-- ============================================================================
-- PARTE C — BACKFILL DO CAIXA: todas as vendas à vista PAGO e boletos a prazo
-- do Deivid desde sexta 13/11 (janela da regra do dono). Idempotente.
-- ============================================================================

insert into caixa_pagamentos
  (criado_em, origem, sale_id, cliente, vendedor, metodo, valor, detalhe, usuario_nome)
select
  s.data_venda,
  'VENDA',
  s.id::text,
  c.nome_fantasia,
  coalesce(u.nome, 'Deivid (Rota 5)'),
  case when upper(s.metodo_pagamento) = 'A_PRAZO' then 'BOLETO' else upper(s.metodo_pagamento) end,
  case when upper(s.metodo_pagamento) = 'A_PRAZO'
       then s.valor_total
       else coalesce(nullif(s.valor_pago, 0), s.valor_total) end,
  case when upper(s.metodo_pagamento) = 'A_PRAZO'
       then 'Boleto gerado na venda (a prazo)'
            || case when s.data_vencimento is not null
                    then ' — venc. ' || to_char(s.data_vencimento, 'DD/MM/YYYY')
                    else '' end
       else 'Venda à vista ' || lower(upper(s.metodo_pagamento)) || ' — backfill bloco 217' end,
  'BACKFILL bloco 217'
from sales s
left join clients  c on c.id::text  = s.client_id::text
left join app_users u on u.id::text = s.vendedor_id::text
where s.data_venda >= '2026-11-13 00:00:00-03'              -- sexta 13/11, horário de Brasília
  and (
        s.vendedor_id::text = '7c989927-a148-479c-bf00-11f35bfa66b0'
     or coalesce(u.nome, '') ~* '^\s*(david|deivid)'
      )
  and (
       (upper(s.metodo_pagamento) in ('DINHEIRO','PIX','DEPOSITO') and upper(s.status_pagamento) = 'PAGO')
    or upper(s.metodo_pagamento) = 'A_PRAZO'
  )
  and not exists (
    select 1 from caixa_pagamentos cp
    where cp.sale_id = s.id::text
      and cp.metodo = case when upper(s.metodo_pagamento) = 'A_PRAZO'
                           then 'BOLETO' else upper(s.metodo_pagamento) end
      and cp.valor = case when upper(s.metodo_pagamento) = 'A_PRAZO'
                          then s.valor_total
                          else coalesce(nullif(s.valor_pago, 0), s.valor_total) end
  );

-- ============================================================================
-- PARTE D — CONFERÊNCIA (rode e compare com a aba CAIXA do app)
-- ============================================================================
-- select metodo, count(*) qtde, sum(valor) total from caixa_pagamentos group by metodo;
-- select count(*) comissoes_deivid from commissions
--  where seller_id::text = '7c989927-a148-479c-bf00-11f35bfa66b0';
