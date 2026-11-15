-- ============================================================================
-- BLOCO 13 — FILA CONTÍNUA DE PRÉ-VENDA (entrega estilo "fila viva")
-- Rodar no Supabase SQL Editor. Idempotente (pode rodar mais de uma vez).
--
-- O que muda:
--   1. sales.trocas        -> anotação de trocas do vendedor (sai no cupom)
--                             ex.: "1 Lays sour cream 62g, 2 Toddynho 200ml"
--   2. sales.prioridade    -> 0 = normal, 1 = PRIORIDADE 1, 2 = PRIORIDADE 2
--                             (P1 sempre no topo da fila de entrega)
--   3. sales.separado      -> secretário da base separou o pedido (card cinza)
--   4. sales.separado_em   -> quando separou
--   5. sales.entregador_id -> quem fez a entrega (nominal)
--   6. caixa_fechamentos   -> entregador fecha o caixa do dia (dinheiro em
--                             espécie) e o admin confirma o recebimento físico
--
-- NAO destrói nada do fluxo antigo (entrega_rotas/entrega_eventos continuam).
-- RLS: caixa_fechamentos nasce FECHADA (padrão do projeto: só service_role).
-- ============================================================================

-- ---------- 1..5: colunas da fila em sales ----------
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS trocas        text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS prioridade    smallint NOT NULL DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS separado      boolean  NOT NULL DEFAULT false;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS separado_em   timestamptz;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS entregador_id uuid;

-- ---------- 6: fechamento de caixa do entregador ----------
CREATE TABLE IF NOT EXISTS public.caixa_fechamentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entregador_id uuid NOT NULL,
  data          date NOT NULL DEFAULT (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo'),
  valor_dinheiro numeric(12,2) NOT NULL DEFAULT 0,
  valor_pix      numeric(12,2) NOT NULL DEFAULT 0,
  qtd_entregas   integer       NOT NULL DEFAULT 0,
  obs            text,
  confirmado     boolean NOT NULL DEFAULT false,
  confirmado_por uuid,
  confirmado_em  timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entregador_id, data)
);

ALTER TABLE public.caixa_fechamentos ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy: anon/authenticated nao le nem escreve.
-- A API usa SUPABASE_SERVICE_ROLE_KEY (service_role bypassa RLS).

-- ---------- Legibilidade: índice da fila (opcional, acelera o GET) ----------
CREATE INDEX IF NOT EXISTS idx_sales_fila_pv
  ON public.sales (prioridade, data_venda)
  WHERE tipo_venda = 'PRE_VENDA';

-- ============================================================================
-- FIM — depois de rodar, o sistema liga as novidades automaticamente:
--   • campo "Trocas" no PDV grava e imprime no cupom
--   • botões P1/P2 na fila de entregas
--   • botão SEPARADO do secretário (card cinza)
--   • fechamento de caixa do entregador com confirmação do admin
-- ============================================================================
