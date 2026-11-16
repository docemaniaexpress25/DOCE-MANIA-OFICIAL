-- ============================================================================
-- BLOCO 165 — CAIXA DO DAVID: TRIGGER AUTOMATICA + BOLETOS + BACKFILL
-- Rodar no SQL Editor do Supabase (producao). Idempotente — pode rodar mais
-- de uma vez sem duplicar.
--
-- PROBLEMA (pedido do dono 16/11/2026):
--   "o caixa do david esta zerado! mas deve aparecer todos os recebidos em
--    dinheiro, pix e boletos! desde sexta dia 13"
--
-- CAUSAS (bloco 165 no worklog):
--   1) O registro do caixa na venda à vista era CLIENT-SIDE (POST /api/caixa
--      com a sessão HTTP do vendedor, fire-and-forget). Se a sessão expira
--      (JWT 7 dias), a venda grava (RPC anon direto) mas o caixa FALHA EM
--      SILÊNCIO (o código engole o erro). Foi o que aconteceu desde 13/11.
--   2) BLOCO 153 (PDV): a "confirmar caixa" da pronta entrega só escreve
--      texto no detalhe da venda — NUNCA registrou no ledger.
--   3) Boleto (a prazo) não entrava por regra — o dono agora quer que entre:
--      "deve aparecer todos os recebidos em dinheiro, pix e boletos".
--
-- SOLUÇÃO:
--   A) TRIGGER no banco: todo INSERT/UPDATE em sales de venda DO DAVID à
--      vista PAGO (dinheiro/pix) OU a prazo (boleto) insere o pagamento no
--      ledger caixa_pagamentos AUTOMATICAMENTE — sem depender de sessão HTTP,
--      de front novo/antigo ou de qualquer fluxo do app. À prova de tudo.
--   B) BOLETO entra como método próprio no caixa (metodo='BOLETO').
--   C) BACKFILL: recria as linhas das vendas do David desde sexta 13/11/2026
--      (à vista PAGO + a prazo) que nunca foram gravadas. EXCETO a venda do
--      POSTO MODELO II (d6485c79-9440-4cef-9439-f1dc50a17346) que o dono
--      MANDOU APAGAR do caixa no bloco 124 — não volta.
--   D) Idempotência: trigger e backfill NÃO duplicam (checam NOT EXISTS no
--      caixa aberto). O EXCLUIR do admin continua valendo (a trigger só roda
--      em INSERT/UPDATE de sales — apagar uma linha do caixa NÃO re-insere).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) TRIGGER — fonte ÚNICA do ledger do caixa do David
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
  -- Só vendas do DAVID (Rota 5) — casamento pelo nome à prova de renome/id
  select nome into v_vendedor from app_users where id::text = new.vendedor_id::text;
  if v_vendedor is null or v_vendedor !~* '^\s*david' then
    return null;
  end if;

  select nome_fantasia into v_cliente from clients where id::text = new.client_id::text;
  v_metodo := upper(coalesce(new.metodo_pagamento, ''));

  -- 1) À VISTA recebido (dinheiro/pix; MISTO grava como DINHEIRO no banco)
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

  -- 2) A PRAZO = BOLETO (regra do dono 165: "todos são boletos" — entra no
  --    caixa para conferência; recebimento real segue no Contas a Receber)
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
-- C) BACKFILL — vendas do David desde sexta 13/11/2026 que NUNCA entraram
--    no caixa. Idempotente (NOT EXISTS). EXCETO a venda do POSTO MODELO II
--    (excluída pelo dono no bloco 124 — não deve voltar).
-- ---------------------------------------------------------------------------
insert into caixa_pagamentos
  (criado_em, origem, sale_id, cliente, vendedor, metodo, valor, detalhe, usuario_nome)
select
  s.data_venda,
  'VENDA',
  s.id::text,
  c.nome_fantasia,
  u.nome,
  case when upper(s.metodo_pagamento) = 'A_PRAZO' then 'BOLETO' else upper(s.metodo_pagamento) end,
  case when upper(s.metodo_pagamento) = 'A_PRAZO'
       then s.valor_total
       else coalesce(nullif(s.valor_pago, 0), s.valor_total) end,
  case when upper(s.metodo_pagamento) = 'A_PRAZO'
       then 'Boleto gerado na venda (a prazo)'
            || case when s.data_vencimento is not null
                    then ' — venc. ' || to_char(s.data_vencimento, 'DD/MM/YYYY')
                    else '' end
       else 'Venda à vista ' || lower(upper(s.metodo_pagamento)) || ' — backfill bloco 165' end,
  'BACKFILL bloco 165'
from sales s
left join clients  c on c.id::text  = s.client_id::text
left join app_users u on u.id::text = s.vendedor_id::text
where s.data_venda >= '2026-11-13 00:00:00-03'          -- sexta 13/11, horário de Brasília
  and u.nome ~* '^\s*david'                              -- só o David (Rota 5)
  and s.id::text <> 'd6485c79-9440-4cef-9439-f1dc50a17346'  -- POSTO MODELO II: apagada pelo dono (bloco 124)
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

-- Conferência rápida (rode no SQL Editor para conferir o caixa aberto):
-- select metodo, count(*), sum(valor) from caixa_pagamentos where fechamento_id is null group by metodo;
