-- ===========================================================================
-- BLOCO 95.1 — CEST de verdade + ENTRADA DE ESTOQUE 1 clique (fila XML)
-- Rodar no SQL EDITOR do Supabase. Idempotente: pode rodar quantas vezes
-- quiser, nunca duplica nada e NUNCA derruba o que ja esta no ar.
--
-- O que faz:
--   1) xml_itens.cest              — guarda o CEST que veio da nota de compra
--                                    (no <prod><CEST>), para a vinculacao
--                                    completar o cadastro fiscal do produto.
--   2) xml_itens.entrada_estoque_em — carimbo de quando o item ja virou
--                                    ENTRADA no estoque central (trava contra
--                                    entrada duplicada ao clicar 2x).
--   3) products.cest               — garantia idempotente (o bloco 12 ja cria).
--
-- A ENTRADA de estoque em si usa a RPC registrar_movimento_estoque do
-- BLOCO 108 (kardex): grava o movimento origem='XML' e soma no estoque_principal
-- na mesma transacao. Se o 108 ainda nao rodou, a API avisa para roda-lo.
--
-- NADA muda no fluxo de venda — as rotas continuam vendendo so cupom e os
-- vendedores nao veem nada disso.
-- ===========================================================================

alter table xml_itens add column if not exists cest                text;
alter table xml_itens add column if not exists entrada_estoque_em timestamptz;
alter table products add column if not exists cest                text;

-- Items de nota antiga (importados antes deste bloco) nao recebem entrada
-- retroativa: o carimbo nasce NULL e o dono decide se entra ou nao 1 a 1.
