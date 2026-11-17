-- ============================================================================
-- BLOCO 167 — CAIXA: A PRAZO SÓ BAIXA QUANDO PAGO + WEBHOOK COM LOG
-- Rodar no SQL Editor do Supabase de PRODUÇÃO
-- (https://eyjhqjrczzpfthsddlpg.supabase.co). Idempotente: pode rodar mais de
-- uma vez. Inclui tudo do 165/166 (trigger do caixa do David) atualizada.
--
-- PEDIDO DO DONO (16/11/2026):
--   "Apartir de agora o caixa deve sempre atualizar e deverá ser fechado
--    somente pelo admin a qualquer momento. Quando fechar caixa zera e começa
--    tudo denovo. As vendas a prazo só zera quando o pagamento a prazo
--    ocorrer."
--
-- O QUE ESTE SQL FAZ:
--   A) caixa_pagamentos ganha a coluna pago_em (timestamptz, null = pendente).
--      O FECHAR do caixa trava SOMENTE o à vista (dinheiro/pix/depósito);
--      os BOLETOS PENDENTES continuam no caixa aberto e só "zeram" (pago_em)
--      quando o pagamento a prazo ocorrer de verdade.
--   B) TRIGGER trg_baixa_boleto_caixa: quando uma venda vira PAGO (webhook do
--      Inter, boletos-sync, recebimento manual, comprovante do portal —
--      QUALQUER caminho), a linha BOLETO do caixa aberto recebe pago_em=now()
--      e some do caixa aberto (baixa automática). Se o boleto é CANCELADO no
--      Inter, a linha pendente sai do caixa (não pagou).
--   C) TRIGGER trg_caixa_david_sales v2 (substitui a do 166): MESMA regra
--      (dinheiro/pix à vista PAGO + A_PRAZO=BOLETO entram sozinhos, casa por
--      ID 7c989927... OU nome david|deivid) com CORREÇÃO de duplicação:
--      a checagem de "já existe" agora olha TODAS as linhas da venda
--      (fechadas ou não) — antes, uma venda antiga que recebia qualquer
--      UPDATE depois do fechamento do caixa re-entrava como linha nova no
--      período novo. O EXCLUIR do admin continua valendo (a trigger só roda
--      em INSERT/UPDATE de sales).
--   D) TABELA webhook_logs: log de TODOS os eventos recebidos do Inter
--      (pagamentos, avisos, erros) — rastreio dentro do app
--      (Configurações > ERP Fiscal > Boletos > Log do webhook).
--
-- ESPERADO NA CONFERÊNCIA (F): igual ao 166 (11 linhas do Deivid desde 13/11:
-- BOLETO 4/2898.37 + DINHEIRO 5/3207.40 + PIX 2/2690.46) — se o 166 já rodou
-- não muda nada (tudo idempotente).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) COLUNA pago_em — null = boleto pendente; preenchida = pagamento ocorreu
-- ---------------------------------------------------------------------------
alter table caixa_pagamentos
  add column if not exists pago_em timestamptz;

comment on column caixa_pagamentos.pago_em is
  'BLOCO 167: baixa do boleto (a prazo) — null = pendente no caixa aberto; preenchida quando o pagamento a prazo ocorreu (webhook Inter/sync/recebimento).';

-- ---------------------------------------------------------------------------
-- B) TRIGGER DE BAIXA — venda virou PAGO => boleto sai do caixa aberto
-- ---------------------------------------------------------------------------
create or replace function trg_baixa_boleto_caixa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1) Transição para PAGO (qualquer caminho: webhook Inter, boletos-sync,
  --    recebimento manual, comprovante do portal) => baixa o BOLETO pendente
  --    do caixa aberto (pago_em preenchido = "zerou" da conferência).
  if new.status_pagamento = 'PAGO'
     and old.status_pagamento is distinct from 'PAGO' then
    update caixa_pagamentos
       set pago_em = now(),
           detalhe = coalesce(detalhe, '')
                     || case when detalhe is null or detalhe = '' then '' else ' | ' end
                     || 'Boleto PAGO — baixa automatica (pagamento a prazo confirmado)'
     where sale_id = new.id::text
       and metodo = 'BOLETO'
       and fechamento_id is null
       and pago_em is null;
  end if;

  -- 2) Boleto CANCELADO no Inter (ex.: nota cancelada) => a linha pendente
  --    sai do caixa aberto (não vai pagar — não pode ficar na conferência).
  if new.inter_boleto_status = 'CANCELADO'
     and coalesce(old.inter_boleto_status, '') <> 'CANCELADO' then
    delete from caixa_pagamentos
     where sale_id = new.id::text
       and metodo = 'BOLETO'
       and fechamento_id is null
       and pago_em is null;
  end if;

  return null; -- AFTER trigger
end;
$$;

drop trigger if exists trg_baixa_boleto_caixa on sales;
create trigger trg_baixa_boleto_caixa
  after update on sales
  for each row execute function trg_baixa_boleto_caixa();

-- ---------------------------------------------------------------------------
-- C) TRIGGER DO CAIXA DO DAVID/DEIVID v2 (substitui 165/166) — MESMA regra com
--    a correção de duplicação pós-fechamento (checa TODAS as linhas da venda)
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
      -- BLOCO 167: checa TODAS as linhas da venda (fechadas ou não) — evita
      -- re-inserir venda antiga em período novo após qualquer UPDATE dela.
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

drop trigger if exists trg_caixa_david_sales on sales;
create trigger trg_caixa_david_sales
  after insert or update on sales
  for each row execute function trg_caixa_david_sales();

-- ---------------------------------------------------------------------------
-- D) TABELA webhook_logs — log de TODOS os eventos do webhook do Inter
-- ---------------------------------------------------------------------------
create table if not exists webhook_logs (
  id          uuid primary key default gen_random_uuid(),
  criado_em   timestamptz not null default now(),
  origem      text not null default 'INTER',
  evento      jsonb,
  codigo      text,
  seu_numero  text,
  sale_id     text,
  resultado   text,
  processado  boolean not null default false
);

-- RLS fechada (padrão do app: service_role only — leitura via API com sessão admin)
alter table webhook_logs enable row level security;

create index if not exists idx_webhook_logs_criado_em
  on webhook_logs (criado_em desc);

comment on table webhook_logs is
  'BLOCO 167: log de todos os eventos recebidos pelo /api/webhooks/inter (pagamentos, avisos, erros). RLS fechada — leitura só via API admin (ConfiguracoesHub > Boletos > Log do webhook).';

-- ---------------------------------------------------------------------------
-- E) Linhas BOLETO que a venda já pagou antes deste SQL (atraso de implantação):
--    marca pago_em para não ficarem pendentes na conferência para sempre.
-- ---------------------------------------------------------------------------
update caixa_pagamentos cp
   set pago_em = now(),
       detalhe = coalesce(cp.detalhe, '')
                 || case when cp.detalhe is null or cp.detalhe = '' then '' else ' | ' end
                 || 'Baixa automatica (venda ja constava PAGO — SQL 167)'
  from sales s
 where cp.sale_id = s.id::text
   and cp.metodo = 'BOLETO'
   and cp.fechamento_id is null
   and cp.pago_em is null
   and upper(s.status_pagamento) = 'PAGO';

-- ---------------------------------------------------------------------------
-- F) CONFERÊNCIA FINAL — caixa aberto (boleto pendente = ainda não pagou)
-- ---------------------------------------------------------------------------
select metodo, count(*) as qtde, sum(valor) as total
from caixa_pagamentos
where fechamento_id is null
  and (metodo <> 'BOLETO' or pago_em is null)
group by metodo
order by metodo;
