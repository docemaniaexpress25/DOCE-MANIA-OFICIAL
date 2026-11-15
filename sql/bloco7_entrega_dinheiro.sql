-- ============================================================
-- DOCE MANIA — BLOCO 7: entrega com pagamento na rota
-- Rodar no SQL Editor do Supabase (idempotente: pode rodar 2x)
--
-- O que este bloco faz:
--   1. Tabela app_config (chave/valor) — guarda a taxa da comissao
--      de PRE-VENDA (app_config.comissao_pre_venda_pct, default 50
--      = 50% da comissao normal do produto). Admin edita no app.
--   2. Coluna foto em entrega_eventos (caso o Bloco 6 nao tenha
--      rodado) — comprovante Pix / foto do boleto na entrega.
--   3. Destrava rotas de teste travadas: rotas EM_ROTA sem nenhuma
--      parada sao marcadas como CONCLUIDA (o sistema permite gerar
--      a rota de novo).
--   4. (Opcional, manual) Apagar venda orfa de teste antiga.
-- ============================================================

-- ---------- 1. CONFIG DO APP ----------
CREATE TABLE IF NOT EXISTS public.app_config (
  chave      text PRIMARY KEY,
  valor      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Sem politicas para anon/authenticated: a tabela e acessada somente
-- pelo servidor (service_role), mesmo padrao de entrega_rotas.

INSERT INTO public.app_config (chave, valor)
VALUES ('comissao_pre_venda_pct', '50')
ON CONFLICT (chave) DO NOTHING;

-- ---------- 2. FOTO DOS COMPROVANTES NA ENTREGA ----------
ALTER TABLE public.entrega_eventos
  ADD COLUMN IF NOT EXISTS foto text;

-- ---------- 3. DESTRAVAR ROTAS VAZIAS (teste) ----------
-- Rotas de QUALQUER dia em EM_ROTA sem paradas viram CONCLUIDA.
UPDATE public.entrega_rotas r
SET status = 'CONCLUIDA',
    concluida_em = now()
WHERE r.status = 'EM_ROTA'
  AND NOT EXISTS (
    SELECT 1 FROM public.sales s WHERE s.route_id = r.id
  );

-- Rotas GERADAS de dias ANTERIORES sem paradas: apaga (sujeira de teste)
DELETE FROM public.entrega_rotas r
WHERE r.data < CURRENT_DATE
  AND NOT EXISTS (
    SELECT 1 FROM public.sales s WHERE s.route_id = r.id
  );

-- ---------- 4. OPCIONAL (manual): venda orfa de teste ----------
-- DELETE FROM public.sale_items WHERE sale_id = 'c74eee95-6a64-4230-9f33-821bd8bbe500';
-- DELETE FROM public.sales WHERE id = 'c74eee95-6a64-4230-9f33-821bd8bbe500';
