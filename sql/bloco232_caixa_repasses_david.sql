-- ============================================================================
-- BLOCO 232 — CAIXA DO DAVID/DEIVID: PAGAMENTOS AO DAVID (REPASSES + RECIBO)
-- Rodar no SQL Editor do Supabase de PRODUÇÃO. Idempotente (pode rodar mais
-- de uma vez sem quebrar nada).
--
-- PEDIDO DO DONO (fluxo do caixa do David):
--   "o caixa do David serve para eu admin saber quanto ele gerou de vendas a
--    prazo e venda a vista em um período, o que realmente importa, e quando
--    ele trouxe a vista em dinheiro e Pix e quando dos boletos dele a prazo
--    foram pagos e dados baixa. Encima disso eu faço pagamento para ele...
--    vou fazer um pagamento a ele de um valor que eu vou digitar na tela e
--    isso precisa gerar um recibo."
--
-- O QUE ESTE SQL FAZ:
--   Cria a tabela caixa_repasses_david: cada linha é UM pagamento que o admin
--   fez ao David, registrado na tela Caixa (botão "Registrar pagamento") com
--   o VALOR digitado pelo dono + forma (dinheiro/pix) + observação. A coluna
--   recibo_numero (identity) numerá cada recibo em sequência — o recibo
--   imprimível sai direto da tela (nova aba, igual DANFE/portes do app).
--
--   O resumo das CONTAS DO DAVID (à vista x a prazo x boletos pagos) NÃO cria
--   tabela: é calculado pela API /api/caixa a partir do ledger caixa_pagamentos
--   que as triggers do SQL 165/166/167 já alimentam e baixam (pago_em).
--
-- REPASSES NÃO SÃO CAIXA: o pagamento do dono ao David é um registro próprio
-- (não entra em caixa_pagamentos e não interfere no fechamento).
-- ============================================================================

create table if not exists caixa_repasses_david (
  id uuid primary key default gen_random_uuid(),
  recibo_numero bigint generated always as identity,  -- nº do recibo (impressão)
  criado_em timestamptz not null default now(),        -- quando o pagamento foi feito
  valor numeric(12,2) not null,                        -- valor digitado pelo dono
  forma text not null default 'DINHEIRO',              -- DINHEIRO | PIX
  observacao text,                                     -- referência do pagamento (opcional)
  registrado_por_id text,                              -- sessão do admin que registrou
  registrado_por_nome text                             -- nome do admin que registrou
);

alter table caixa_repasses_david enable row level security;
-- RLS fechada de propósito (sem políticas): só o service_role das APIs do app enxerga.

create index if not exists idx_caixa_repasses_david_data
  on caixa_repasses_david (criado_em desc);

-- Conferência rápida (rode no SQL Editor):
-- select recibo_numero, criado_em, valor, forma, observacao from caixa_repasses_david order by criado_em desc limit 20;
-- ============================================================================
