-- ============================================================================
-- BLOCO 172 — ORIGEM DE CADA BAIXA DE PAGAMENTO (automático x manual) + LOG
-- Rodar no SQL Editor do Supabase de PRODUÇÃO
-- (https://eyjhqjrczzpfthsddlpg.supabase.co). Idempotente: pode rodar mais de
-- uma vez.
--
-- PEDIDO DO DONO (17/11/2026):
--   "acabei de receber um boleto aqui no inter! porem o sistema nao deu baixa!
--    ... nao esqueca de criar o sistema de log indicando de onde vem esse
--    pagamento automatico e manuais tbm"
--
-- CAUSA DO CASO DE HOJE (boleto R$ 1.102,00 — Sacolao Zimermann):
--   A venda 0ef39ad3-7249-4eed-b862-dbe2034d3b52 NUNCA teve boleto emitido
--   pela APP (inter_boleto_codigo = null). O boleto foi gerado DIRETO no
--   Internet Banking do Inter (fora do app) — o webhook só dá baixa em
--   cobrança que a app emitiu (precisa do codigoSolicitacao p/ re-consultar).
--   => Boletos externos exigem baixa MANUAL no Contas a Receber (botao
--      "Receber", metodo Boleto) — com o log novo deste bloco, fica registrado
--      que foi MANUAL e por quem.
--
-- O QUE ESTE SQL FAZ:
--   A) sales ganha 2 colunas: baixa_origem e baixa_em — Toda vez que uma venda
--      virar PAGO, o app grava DE ONDE veio a baixa:
--        WEBHOOK_INTER  = automático (webhook do Inter em tempo real)
--        CRON_INTER     = automático (boletos-sync, rede de segurança diária)
--        MANUAL         = alguém deu baixa no app (Contas a Receber/PDV/Cupom)
--        PIX_PORTAL     = comprovante do portal do cliente confirmado pelo admin
--        PDV            = pagamento à vista no PDV (à vista nasce pago)
--   B) Retroativo: vendas PAGO de ONTEM para TRÁS ficam SEM origem (null) =
--      "antes deste log" — a UI mostra como "—". NÃO invento histórico.
--   C) Conferência: últimos eventos do webhook + últimas baixas com origem.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- A) COLUNAS DE ORIGEM DA BAIXA
-- ---------------------------------------------------------------------------
alter table sales
  add column if not exists baixa_origem text;
alter table sales
  add column if not exists baixa_em timestamptz;

comment on column sales.baixa_origem is
  'BLOCO 172: de onde veio a baixa do pagamento — WEBHOOK_INTER (automático), CRON_INTER (automático/sync), MANUAL (alguém no app), PIX_PORTAL (comprovante confirmado), PDV (à vista). Null = pago antes do log existir.';
comment on column sales.baixa_em is
  'BLOCO 172: quando a venda ficou PAGO (momento da baixa). Null = pago antes do log existir.';

-- Índice para o log de recebimentos (mais recentes primeiro)
create index if not exists idx_sales_baixa_em
  on sales (baixa_em desc);

-- ---------------------------------------------------------------------------
-- B) RETROATIVO — vendas PAGO de HOJE sem origem = baixa manual de hoje
--    (o sistema novo acabou de nascer; qualquer PAGO de hoje que ainda não
--     tem origem veio de recebimento manual do dia). Dias anteriores ficam
--     null (sem evidência — não invento histórico).
--    Ajuste FUSO: America/Sao_Paulo.
-- ---------------------------------------------------------------------------
update sales
   set baixa_origem = 'MANUAL',
       baixa_em = now()
 where upper(status_pagamento) = 'PAGO'
   and baixa_origem is null
   and updated_at >= date_trunc('day', now() at time zone 'America/Sao_Paulo')
     at time zone 'America/Sao_Paulo';

-- ---------------------------------------------------------------------------
-- C) CONFERÊNCIA 1 — o webhook do Inter está RECEBENDO eventos?
--    Se voltar vazio: o Inter ainda não chamou o app (webhook não cadastrado
--    no Internet Banking > API > Webhooks, ou nenhum boleto da APP pagou).
--    (webhook_logs tem RLS fechada — por isso a conferência é aqui no SQL)
-- ---------------------------------------------------------------------------
select criado_em, origem, seu_numero, sale_id, resultado, processado
  from webhook_logs
 order by criado_em desc
 limit 20;

-- ---------------------------------------------------------------------------
-- D) CONFERÊNCIA 2 — últimas baixas com origem (o novo log do app lê daqui)
-- ---------------------------------------------------------------------------
select baixa_em, baixa_origem, valor_total, metodo_pagamento, detalhe_pagamento
  from sales
 where baixa_origem is not null
 order by baixa_em desc
 limit 20;

-- FIM DO BLOCO 172 — rode e me diga o que as conferências C e D retornaram.
