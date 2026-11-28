-- ============================================================================
-- BLOCO 234 — RECIBO DE ENTREGA DO CAIXA (número do recibo no fechamento)
-- Regra do dono: "Quando zerado o caixa o recibo gera para comprovar que foi
-- entregue o dinheiro."
--
-- O RECIBO DE ENTREGA é gerado na tela (front) a partir dos dados do
-- fechamento em caixa_fechamentos_geral (dinheiro/pix/depósito do snapshot,
-- janela_inicio → fechado_em, quem fechou). Esta migration dá o NÚMERO
-- SEQUENCIAL estável do recibo — a reimpressão é sempre a MESMA via.
--
-- RODAR NO SQL EDITOR DO SUPABASE. Idempotente: pode rodar quantas vezes
-- quiser (o UPDATE só toca linhas com recibo_numero null).
-- ============================================================================

-- 1) Sequência do número do recibo de entrega
create sequence if not exists caixa_fechamentos_recibo_seq start 1;

-- 2) Coluna nova no fechamento
alter table caixa_fechamentos_geral
  add column if not exists recibo_numero bigint;

-- 3) Fechamentos JÁ EXISTENTES ganham número (ordem cronológica) — o recibo
--    dos caixas já fechados fica reimpressível pelo mesmo número
update caixa_fechamentos_geral
   set recibo_numero = nextval('caixa_fechamentos_recibo_seq')
 where recibo_numero is null;

-- 4) Fechamentos NOVOS ganham número automaticamente ao inserir
alter table caixa_fechamentos_geral
  alter column recibo_numero set default nextval('caixa_fechamentos_recibo_seq');

comment on column caixa_fechamentos_geral.recibo_numero is
  'BLOCO 234: número do recibo de entrega do dinheiro do caixa (gerado ao fechar — comprova que o David entregou o dinheiro à vista).';

-- Conferência rápida (opcional):
-- select id, fechado_em, total_geral, recibo_numero
--   from caixa_fechamentos_geral order by fechado_em desc limit 5;
