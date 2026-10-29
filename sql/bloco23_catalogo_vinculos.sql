-- ============================================================
-- BLOCO 23 — Catálogo do portal: vínculo de família + ordem própria
-- Rodar no SQL Editor do Supabase. Idempotente (pode rodar 2x).
--
-- 1) products.familia_catalogo
--    Vínculo manual do produto (estoque central) a uma família do
--    catálogo do portal — para quando o nome do estoque é diferente
--    do nome que o cliente conhece. Vazio = família automática pelo
--    nome (regra de sempre, pedidoGrupos).
--
-- 2) app_settings.catalogo_order
--    ORDEM DO PORTAL, independente da ordem do PDV (product_order).
--    Mexer nas setas da aba Catálogo do Portal NÃO muda mais o PDV.
-- ============================================================

alter table products     add column if not exists familia_catalogo text;
alter table app_settings add column if not exists catalogo_order   text[];
