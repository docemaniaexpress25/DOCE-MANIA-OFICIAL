-- ============================================================================
-- BLOCO 14 — COMISSÃO POR PRODUTO (PRONTA ENTREGA × PRÉ-VENDA) + MELHORIAS
-- Rodar no Supabase SQL Editor. Idempotente (pode rodar mais de uma vez).
--
-- O que muda:
--   1. products.comissao_pv_percentual -> comissão de PRÉ-VENDA por produto (%)
--      (a de PRONTA ENTREGA já existe: products.comissao_percentual)
--      - Se vazio (NULL): usa a regra antiga (comissão PE × taxa global da PV)
--   2. app_settings (linha global_settings) -> 6 interruptores liga/desliga
--      que o admin controla na aba Configurações:
--        melhor_troca_separacao -> secretário ajusta trocas no card
--        melhor_push_entrega    -> avisa o vendedor quando a entrega rola
--        melhor_whatsapp        -> botão Zap (avisar cliente) na fila
--        melhor_bairro          -> bairro em destaque no card
--        melhor_foto_entrega    -> foto opcional da entrega concluída
--        melhor_push_falha      -> avisa o vendedor quando a entrega falha
--   3. push_tokens.user_id -> push direcionado (avisa SÓ o vendedor da venda)
--   4. commissions.valor_pago -> permite pagar comissão em partes (FIFO)
--      sem quebrar o saldo (o acerto do admin consome as mais antigas antes)
--
-- NAO destrói nada. Todas as colunas novas nascem com default seguro.
-- ============================================================================

-- ---------- 1: comissão de pré-venda por produto ----------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS comissao_pv_percentual numeric(5,2);

-- ---------- 2: interruptores das melhorias (padrão: LIGADO) ----------
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS melhor_troca_separacao boolean NOT NULL DEFAULT true;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS melhor_push_entrega    boolean NOT NULL DEFAULT true;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS melhor_whatsapp        boolean NOT NULL DEFAULT true;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS melhor_bairro          boolean NOT NULL DEFAULT true;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS melhor_foto_entrega    boolean NOT NULL DEFAULT true;
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS melhor_push_falha      boolean NOT NULL DEFAULT true;

-- Garante que a linha global exista (os defaults acima já entram ligados)
INSERT INTO public.app_settings (id) VALUES ('global_settings') ON CONFLICT (id) DO NOTHING;

-- ---------- 3: push por usuário ----------
ALTER TABLE public.push_tokens ADD COLUMN IF NOT EXISTS user_id uuid;
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.push_tokens (user_id);

-- ---------- 4: comissão com pagamento parcial (acerto FIFO do admin) ----------
ALTER TABLE public.commissions ADD COLUMN IF NOT EXISTS valor_pago numeric(12,2) NOT NULL DEFAULT 0;

-- ============================================================================
-- FIM — depois de rodar:
--   • Admin -> Configurações: 6 interruptores + taxa padrão da comissão PV
--   • Admin -> Produtos: campo "Comissão Pré-Venda %" em cada produto
--   • Comissão entra: PE à vista na hora da venda; PE a prazo quando receber;
--     PV à vista no aceite do entregador; PV a prazo quando receber o prazo
--   • Aviso automático ao vendedor na entrega/falha (se ligado)
-- ============================================================================
