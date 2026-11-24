-- ============================================================
-- BLOCO 208 — CUSTO MÉDIO ATUALIZADO NA ENTRADA DE ESTOQUE (XML e manual)
-- Rodar no SQL Editor do Supabase (produção). Idempotente (pode rodar 2x).
-- ============================================================
--
-- O BUG que o dono achou: a ENTRADA DE ESTOQUE que vem do PORTAL DE
-- ENTRADAS (XML de fornecedor — o fluxo real das compras) somava o estoque
-- e gravava o kardex, MAS NÃO RECALCULAVA O PREÇO DE CUSTO MÉDIO do
-- produto. Só a entrada manual (botão + do admin) recalculava. Resultado:
-- o custo do produto ficava velho e o Lucro por Rota (custo médio ×
-- unidades vendidas) saía errado.
--
-- O QUE MUDA: a RPC registrar_movimento_estoque passa a recalcular o custo
-- médio ponderado em TODA ENTRADA com custo informado:
--
--     custo médio novo = (saldo antes × custo atual + quantidade × custo nota)
--                        ÷ (saldo antes + quantidade)
--
-- Regras:
--   - saldo antes <= 0 (estoque zerado/negativo por venda por encomenda):
--     o custo médio novo = o custo da própria nota (a entrada é 100% do
--     saldo) — evita média distorcida com saldo negativo.
--   - SAÍDA nunca mexe no custo médio (regra do MPM correto).
--   - custo não informado (null/0): só move o estoque, não mexe no preço.
--   - O PREÇO DE VENDA não é alterado automaticamente (margem é decisão do
--     admin).
--
-- A entrada MANUAL do admin (botão +) continua calculando a mesma fórmula
-- no app (BLOCO 81) — agora com a mesma proteção para estoque negativo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.registrar_movimento_estoque(
  p_produto_id     uuid,
  p_tipo           text,
  p_quantidade     numeric,
  p_origem         text default 'MANUAL',
  p_referencia     text default null,
  p_custo_unitario numeric default null,
  p_usuario_id     uuid default null,
  p_usuario_nome   text default null
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delta       numeric;
  v_novo        numeric;
  v_saldo_antes numeric;
  v_custo_atual numeric;
  v_novo_custo  numeric;
BEGIN
  IF p_quantidade IS NULL OR p_quantidade <= 0 THEN
    RETURN json_build_object('ok', false, 'erro', 'Quantidade deve ser maior que zero.');
  END IF;
  IF p_tipo NOT IN ('ENTRADA','SAIDA') THEN
    RETURN json_build_object('ok', false, 'erro', 'Tipo deve ser ENTRADA ou SAIDA.');
  END IF;

  v_delta := CASE p_tipo WHEN 'ENTRADA' THEN p_quantidade ELSE -p_quantidade END;

  UPDATE public.products
     SET estoque_principal = greatest(0, coalesce(estoque_principal, 0) + v_delta)
   WHERE id = p_produto_id
  RETURNING estoque_principal INTO v_novo;

  IF NOT found THEN
    RETURN json_build_object('ok', false, 'erro', 'Produto não encontrado.');
  END IF;

  -- BLOCO 208 — CUSTO MÉDIO PONDERADO na ENTRADA com custo da nota:
  --   saldo_antes = saldo novo − delta (para ENTRADA o greatest() nunca
  --   atua, então a conta é exata). Só recalcula quando o custo veio.
  IF p_tipo = 'ENTRADA' AND coalesce(p_custo_unitario, 0) > 0 THEN
    v_saldo_antes := v_novo - v_delta;
    SELECT preco_custo INTO v_custo_atual FROM public.products WHERE id = p_produto_id;
    v_novo_custo := CASE
      WHEN v_saldo_antes > 0 THEN
        ((v_saldo_antes * coalesce(v_custo_atual, 0)) + (p_quantidade * p_custo_unitario))
          / (v_saldo_antes + p_quantidade)
      ELSE p_custo_unitario  -- estoque zerado/negativo: vale o custo da nota
    END;
    UPDATE public.products
       SET preco_custo = round(v_novo_custo::numeric, 2)
     WHERE id = p_produto_id;
  END IF;

  INSERT INTO public.estoque_movimentos
    (produto_id, tipo, origem, referencia, quantidade, custo_unitario, saldo_apos, usuario_id, usuario_nome)
  VALUES
    (p_produto_id, p_tipo, coalesce(p_origem, 'MANUAL'), p_referencia, p_quantidade,
     p_custo_unitario, v_novo, p_usuario_id, p_usuario_nome);

  RETURN json_build_object('ok', true, 'saldo', v_novo,
    'custoMedio', (SELECT preco_custo FROM public.products WHERE id = p_produto_id));
EXCEPTION WHEN others THEN
  RETURN json_build_object('ok', false, 'erro', sqlerrm);
END $$;

REVOKE EXECUTE ON FUNCTION public.registrar_movimento_estoque(uuid, text, numeric, text, text, numeric, uuid, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.registrar_movimento_estoque(uuid, text, numeric, text, text, numeric, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.registrar_movimento_estoque(uuid, text, numeric, text, text, numeric, uuid, text) FROM authenticated;
