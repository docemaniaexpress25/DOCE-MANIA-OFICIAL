-- ============================================================================
-- BLOCO 166 — CAIXA DO DEIVID (DAVID, ROTA 5) AINDA ZERADO: FIX DEFINITIVO
-- Rodar no SQL Editor do Supabase de PRODUÇÃO
-- (https://eyjhqjrczzpfthsddlpg.supabase.co). Idempotente: pode rodar mais de
-- uma vez sem duplicar. Pode rodar MESMO que o 165 já tenha rodado.
--
-- POR QUE AINDA ESTAVA ZERADO (causas do bloco 166):
--   1) O SQL do bloco 165 depende de ser rodado MANUALMENTE pelo dono no SQL
--      Editor (o sandbox não tem service key) — sem rodar, nada entra.
--   2) O vendedor foi RENOMEADO: o app/sistema chamava "David ...", mas o nome
--      passado/constante passou a ser "Deivid ...". Tanto o SQL 165 (regex
--      '^\s*david') quanto o guard da API (/^david/i) SÓ casavam "david":
--      com "Deivid" o backfill não inseria NADA, a trigger NUNCA disparava e
--      o POST /api/caixa dava 403 (guard "Caixa é exclusivo do David").
--
-- O QUE ESTE SQL FAZ:
--   A) Mostra o nome REAL do vendedor (conferência — o Rota 5).
--   B) TRIGGER v2: casa por ID fixo do vendedor (7c989927-...) OU pelo nome
--      david|deivid — à prova de grafia e de renome. Dinheiro/PIX à vista PAGO
--      e A_PRAZO (boleto) entram SOZINHOS no caixa a cada INSERT/UPDATE de
--      venda — sem depender de sessão/login do vendedor.
--   C) BACKFILL v2: recria TODAS as vendas dele desde sexta 13/11/2026
--      casando por vendedor_id (não depende nem do nome nem do app_users).
--      EXCETO a venda do POSTO MODELO II (d6485c79) que o dono mandou apagar
--      do caixa no bloco 124 — não volta.
--   D) Conferência final por método.
--
-- ESPERADO NA CONFERÊNCIA (D):
--   BOLETO   | 4 |  2898.37
--   DINHEIRO | 5 |  3207.40
--   PIX      | 2 |  2690.46
--   (Total R$ 8.796,23 — vendas reais desde 13/11)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) CONFERÊNCIA DO NOME REAL DO VENDEDOR (Rota 5)
-- ---------------------------------------------------------------------------
select id::text, nome, ativo
from app_users
where id::text = '7c989927-a148-479c-bf00-11f35bfa66b0';

-- ---------------------------------------------------------------------------
-- B) TRIGGER v2 — casamento por ID OU nome (david|deivid)
-- ---------------------------------------------------------------------------
create or replace function trg_caixa_david_sales()
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

  -- 1) À VISTA recebido (dinheiro/pix)
  if v_metodo in ('DINHEIRO','PIX') and upper(coalesce(new.status_pagamento,'')) = 'PAGO' then
    v_valor := coalesce(nullif(new.valor_pago, 0), new.valor_total, 0);
    if v_valor > 0 then
      v_det := 'Venda à vista ' || lower(v_metodo) || ' — automático (trigger)';
      if not exists (
        select 1 from caixa_pagamentos c
        where c.sale_id = new.id::text
          and c.metodo = v_metodo
          and c.valor = v_valor
          and c.fechamento_id is null
      ) then
        insert into caixa_pagamentos
          (origem, metodo, valor, sale_id, cliente, vendedor, detalhe, usuario_nome)
        values
          ('VENDA', v_metodo, v_valor, new.id::text, v_cliente, v_vendedor, v_det, 'AUTOMATICO (trigger)');
      end if;
    end if;
  end if;

  -- 2) A PRAZO = BOLETO entra no caixa (regra do dono 165: "todos os
  --    recebidos em dinheiro, pix e boletos")
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
          and c.fechamento_id is null
      ) then
        insert into caixa_pagamentos
          (origem, metodo, valor, sale_id, cliente, vendedor, detalhe, usuario_nome)
        values
          ('VENDA', 'BOLETO', v_valor, new.id::text, v_cliente, v_vendedor, v_det, 'AUTOMATICO (trigger)');
      end if;
    end if;
  end if;

  return null; -- AFTER trigger: retorno não altera a linha
end;
$$;

drop trigger if exists trg_caixa_david_sales on sales;
create trigger trg_caixa_david_sales
  after insert or update on sales
  for each row execute function trg_caixa_david_sales();

-- ---------------------------------------------------------------------------
-- C) BACKFILL v2 — por vendedor_id (à prova de grafia/renome). Idempotente.
-- ---------------------------------------------------------------------------
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
       else 'Venda à vista ' || lower(upper(s.metodo_pagamento)) || ' — backfill bloco 166' end,
  'BACKFILL bloco 166'
from sales s
left join clients  c on c.id::text  = s.client_id::text
left join app_users u on u.id::text = s.vendedor_id::text
where s.data_venda >= '2026-11-13 00:00:00-03'              -- sexta 13/11, horário de Brasília
  and (
        s.vendedor_id::text = '7c989927-a148-479c-bf00-11f35bfa66b0'
     or coalesce(u.nome, '') ~* '^\s*(david|deivid)'
      )
  and s.id::text <> 'd6485c79-9440-4cef-9439-f1dc50a17346'  -- POSTO MODELO II: apagada pelo dono (bloco 124) — NÃO volta
  and (
       (upper(s.metodo_pagamento) in ('DINHEIRO','PIX') and upper(s.status_pagamento) = 'PAGO')
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
      and cp.fechamento_id is null
  );

-- ---------------------------------------------------------------------------
-- D) CONFERÊNCIA FINAL — deve sair:
--    BOLETO   4  |  2898.37
--    DINHEIRO 5  |  3207.40
--    PIX      2  |  2690.46
-- ---------------------------------------------------------------------------
select metodo, count(*) as qtde, sum(valor) as total
from caixa_pagamentos
where fechamento_id is null
group by metodo
order by metodo;
