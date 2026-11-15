-- ============================================================================
-- BLOCO 118 — CAIXA: FECHAMENTO PERSISTIDO + LEDGER DE PAGAMENTOS
--             + COMISSAO DESATIVADA PARA O DAVID (ROTA 5)
-- Rodar no SQL Editor do Supabase. Idempotente.
--
-- 1) FECHAMENTO DE CAIXA (pedido do dono):
--    "vamos trabalhar em uma nova aba com fechamento de caixa que nos mostra
--     o dinheiro recebido assim como o pix recebido com comprovantes! esse
--     caixa podera ser fechado a qualquer instante pelo admin, e sera
--     persistido ate o fechamento assim como gerara log de pagamentos etc
--     para ter rastreio!"
--    - caixa_pagamentos  = LEDGER: cada dinheiro/pix/deposito recebido vira
--      uma linha (venda a vista, entrega de pre-venda, recebimento manual de
--      conta a receber, pix confirmado no portal). Enquanto o caixa esta
--      aberto, fechamento_id e NULL.
--    - caixa_fechamentos_geral = SNAPSHOT imutavel do caixa no momento em que o
--      admin fecha (totais + qtde + os pagamentos em jsonb). Ao fechar, os
--      pagamentos abertos sao "presos" no fechamento (fechamento_id = id).
--
-- 2) COMISSAO DO DAVID (rota 5) DESATIVADA:
--    "a tela financeiro ... nao precisa aparecer para o vendedor da rota 5
--     david, tbm nao precisa calcular comissao e pagamento de comissoes para ele"
--    - trigger BEFORE INSERT em commissions: se o vendedor e o David
--      (nome comeca com "david" na app_users), a comissao NAO e gravada.
--    - limpa comissoes ja existentes dele (historico de repasses passados
--      permanece em commission_payment_logs — rastreio).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. FECHAMENTOS DE CAIXA (snapshot persistido)
-- ---------------------------------------------------------------------------
create table if not exists caixa_fechamentos_geral (
  id uuid primary key default gen_random_uuid(),
  janela_inicio timestamptz,            -- inicio do caixa corrente (null = primeiro caixa)
  fechado_em timestamptz not null default now(),
  fechado_por_id text,
  fechado_por_nome text,
  total_dinheiro numeric(12,2) not null default 0,
  total_pix numeric(12,2) not null default 0,
  total_deposito numeric(12,2) not null default 0,
  total_geral numeric(12,2) not null default 0,
  qtde_pagamentos integer not null default 0,
  observacao text,
  pagamentos jsonb not null default '[]' -- copia dos pagamentos presos neste fechamento
);

alter table caixa_fechamentos_geral enable row level security;
-- RLS fechada de proposito (sem politicas): so o service_role das APIs do app enxerga.

-- ---------------------------------------------------------------------------
-- 2. LEDGER DE PAGAMENTOS (cada dinheiro/pix recebido = 1 linha)
-- ---------------------------------------------------------------------------
create table if not exists caixa_pagamentos (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  origem text not null,                  -- VENDA | ENTREGA | RECEBIMENTO | PORTAL | AJUSTE
  sale_id text,                          -- venda de origem (quando ha)
  cliente text,
  vendedor text,
  metodo text not null,                  -- DINHEIRO | PIX | DEPOSITO
  valor numeric(12,2) not null,
  comprovante text,                      -- caminho no Storage (bucket fotos-pedidos) ou dataURL antigo
  detalhe text,
  usuario_id text,                       -- quem registrou (quando aplicavel)
  usuario_nome text,
  fechamento_id uuid references caixa_fechamentos_geral(id) on delete set null -- NULL = caixa aberto
);

alter table caixa_pagamentos enable row level security;
-- RLS fechada de proposito (sem politicas): so o service_role das APIs do app enxerga.

create index if not exists idx_caixa_pag_abertos
  on caixa_pagamentos (criado_em) where fechamento_id is null;
create index if not exists idx_caixa_pag_fechamento
  on caixa_pagamentos (fechamento_id);

-- ---------------------------------------------------------------------------
-- 3. COMISSAO DESATIVADA PARA O DAVID (rota 5)
--    Casamento pelo nome na app_users (id muda se o dono recriar o usuario;
--    o nome dele sempre comeca com "David").
-- ---------------------------------------------------------------------------
create or replace function trg_comissoes_skip_david()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  select nome into v_nome from app_users where id::text = new.seller_id::text;
  if v_nome is not null and v_nome ilike 'david%' then
    -- Regra do dono (BLOCO 118): nao calcula comissao para o David.
    return null; -- descarta o insert
  end if;
  return new;
end;
$$;

drop trigger if exists trg_comissoes_skip_david on commissions;
create trigger trg_comissoes_skip_david
  before insert on commissions
  for each row execute function trg_comissoes_skip_david();

-- Limpa comissoes JA EXISTENTES do David (regra do dono). Repasses passados
-- ficam em commission_payment_logs (historico/rastreio intacto).
delete from commissions
 where seller_id::text in (select id::text from app_users where nome ilike 'david%');
