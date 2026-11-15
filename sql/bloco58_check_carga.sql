-- ============================================================================
-- BLOCO 58 — CHECK DE PEDIDOS CARREGADOS NO VEICULO (regra do dono)
--
-- O admin da um CHECK no pedido quando ele entra no veiculo. Na fila podera
-- haver pedidos ja carregados e outros ainda nao carregados — assim sabemos
-- QUANTOS estao no veiculo e QUAL esta carregado.
--
-- Nulo = ainda nao carregado. Timestamp = carregado (e quem marcou).
-- Rodar no SQL Editor do Supabase. Idempotente (pode rodar de novo).
-- ============================================================================

alter table sales add column if not exists carga_confirmada_em timestamptz;
alter table sales add column if not exists carga_confirmada_por uuid;
