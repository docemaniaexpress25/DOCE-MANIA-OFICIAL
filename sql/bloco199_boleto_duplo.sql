-- =====================================================================
-- BLOCO 199 (regra do dono): BOLETO DUPLICO — 2 boletos por venda
-- =====================================================================
-- "Deixe uma opção de gerar dois boletos ou seja dois boletos juntos
--  devem fechar o valor da venda. Somente para a rota 5 do Deivid...
--  exemplo 1 boleto para 7 dias e o restante do valor para 14 dias.
--  Ou vc pega o valor e divide por 2."
--
-- Como funciona:
--   - Exclusivo do vendedor Deivid/David (ROTA_05) — o PDV (tela 6) mostra
--     o interruptor "2 BOLETOS" só para ele.
--   - A venda continua ÚNICA (estoque, comissão, nota e caixa intocados).
--     O que muda é a COBRANÇA: 2 cobranças no Inter que somam o total.
--   - Cada boleto tem SEU vencimento (ex.: 1º em 7 dias, 2º em 14 dias) e
--     SEU valor (ex.: divide por 2, ou parte no 1º e o restante no 2º).
--   - Baixa: quando um boleto paga, a venda recebe o valor parcial
--     (valor_pago acumula); quando TODOS pagam, a venda fecha PAGO
--     (contas a receber limpa, caixa baixa, comissão libera).
--   - Webhook do Inter e o cron boletos-sync baixam a parcela paga
--     automaticamente (mesma confiabilidade do boleto único).
--
-- Degradacao graciosa: enquanto este SQL não rodar, o app segue com o
-- boleto ÚNICO de sempre (as APIs sondam a tabela antes de usar).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.sales_boletos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  seq int NOT NULL CHECK (seq >= 1),
  valor numeric(10,2) NOT NULL CHECK (valor >= 0),
  vencimento date NOT NULL,
  doc text,                       -- CPF/CNPJ do pagador capturado na tela 6 (opcional — resolve na emissão)
  cep text,                       -- CEP do pagador (opcional — resolve na emissão)
  status text DEFAULT 'NAO_GERADO',
  -- NAO_GERADO | EM_PROCESSAMENTO | A_RECEBER | RECEBIDO | ATRASADO
  -- | CANCELADO | EXPIRADO | FALHA_EMISSAO | PROTESTO | MARCADO_RECEBIDO
  codigo text,                    -- codigoSolicitacao da cobranca no Inter
  seu_numero text,                -- DM<saleId8>-P<seq> (único por parcela/reemissão)
  linha text,
  barras text,
  pix text,
  erro text,
  emitido_em timestamptz,
  pago_em timestamptz,
  criado_em timestamptz DEFAULT now(),
  UNIQUE (sale_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_sales_boletos_codigo   ON public.sales_boletos(codigo);
CREATE INDEX IF NOT EXISTS idx_sales_boletos_seu      ON public.sales_boletos(seu_numero);
CREATE INDEX IF NOT EXISTS idx_sales_boletos_status   ON public.sales_boletos(status);
CREATE INDEX IF NOT EXISTS idx_sales_boletos_sale     ON public.sales_boletos(sale_id);

-- O acesso é sempre service_role (como o resto do projeto); RLS fica
-- ativada com policy liberada para não bloquear ambientes com anon key.
ALTER TABLE public.sales_boletos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales_boletos_service_all" ON public.sales_boletos;
CREATE POLICY "sales_boletos_service_all" ON public.sales_boletos
  FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.sales_boletos IS
  'BLOCO 199: parcelas de boleto da venda (boleto duplico do Deivid/R5). Cada linha é UMA cobrança no Inter; a soma das parcelas fecha o valor da venda. Baixa por parcela: webhook/cron.';
