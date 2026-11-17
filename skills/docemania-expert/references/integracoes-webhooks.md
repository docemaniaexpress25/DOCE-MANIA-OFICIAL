# INTEGRAÇÕES, WEBHOOKS E TOKENS DOCEMANIA

## 1. Banco Inter — Cobrança V3 (boletos) — ATIVA

- **Lib**: `src/lib/interBoleto.ts` — OAuth2 client_credentials + **mTLS** (cert `.p12` base64 ou PEM). Endpoints: `POST /oauth/v2/token`, `POST /cobranca/v3/cobrancas`, `GET .../{codigo}`, `GET .../pdf`, `POST .../cancelar`. Base: `https://cdpj.partners.bancointer.com.br` (sandbox: `cdpj-sandbox.partners.uatinter.co`). Token cacheado 55min. Guia: `docs/BOLETOS-INTER.md`.
- **Envs necessárias na Vercel**: `INTER_CLIENT_ID`, `INTER_CLIENT_SECRET`, `INTER_CONTA_CORRENTE`, `INTER_CERT`, `INTER_KEY`, `INTER_P12`, `INTER_P12_SENHA`, `INTER_AMBIENTE`. Falha de emissão = conferir envs + Redeploy.
- **Emissão**: `POST /api/boletos EMITIR` → `codigoSolicitacao` (EM_PROCESSAMENTO → A_RECEBER). seuNumero `DM<saleId>`; reemissão sufixo `-r2`. Regras: CEP obrigatório no pagador, min R$2,50, valor = saldo da venda; **NÃO enviar campo notaFiscal** (Inter recusa a cobrança inteira — 151); nota na mensagem (linha 2 = mensagem padrão do hub, máx 78 chars).
- **WEBHOOK DE PAGAMENTO (baixa automática)** — `POST /api/webhooks/inter` (público):
  1. O dono cadastra no **Internet Banking PJ › API › Webhooks › Cobrança** a URL `https://sistema-doce-mania1.vercel.app/api/webhooks/inter`.
  2. Chegou evento → acha a venda por `codigoSolicitacao` ou `inter_boleto_seu_numero` (bloco 172 corrigiu o fallback: seuNumero é TRUNCADO — DM+9 chars — então casa pelo campo gravado na emissão, nunca por ID) → **RE-CONSULTA a cobrança na API do Inter (mTLS) antes de dar baixa** ("payload mentiroso não move um centavo") → se RECEBIDO: `valor_pago=valor_total` + `status_pagamento='PAGO'` + `inter_boleto_status='RECEBIDO'` + `baixa_origem='WEBHOOK_INTER'`/`baixa_em` (SQL 172).
  3. TODO evento (pago, sem código, venda não encontrada, já pago, falha) persiste em `webhook_logs` (167) → auditável em `/api/webhooks/inter-log` (admin/secretário) e no hub ERP (card Boletos › Log de eventos). Eventos do CRON também caem nessa tabela com `origem='CRON'` (170).
  4. **Baixa no CAIXA** acontece pela trigger SQL `trg_baixa_boleto_caixa` (reação ao UPDATE da venda → `pago_em=now()`).
  5. Responde 200 SEMPRE (evita reenvio infinito); idempotente (JA_PAGO tratado).
  6. **Teste real só com boleto pago de verdade** (sandbox não pode mutar dado real). Rede de segurança: cron `/api/boletos-sync` `0 10 * * *` reconsulta até 15 cobranças abertas e baixa atrasadas/pagas (comissão A_RECEBER→DISPONIVEL) — a baixa via cron marca `baixa_origem='CRON_INTER'` e grava webhook_logs.
  7. **LIMITAÇÃO CONHECIDA (170): boleto emitido FORA do app** (direto no Internet Banking, ex. Sacolão Zimermann R$ 1.102 — venda 0ef39ad3) **não tem inter_boleto_codigo → nem webhook nem cron alcançam → baixa é MANUAL** (Contas a Receber › Receber › Boleto). O log de eventos registra VENDA_NAO_ENCONTRADA com essa orientação quando o Inter avisa um boleto sem venda vinculada.
- **LOG DE PAGAMENTOS/RECEBIMENTOS (170)**: `sales.baixa_origem` (`WEBHOOK_INTER`, `CRON_INTER`, `MANUAL`, `PIX_PORTAL`, `PDV`) + `sales.baixa_em` — gravados por TODOS os caminhos de baixa (webhook, sync, comprovante portal, receiveAccount com "— por NOME" no detalhe). Leitura: `GET /api/recebimentos-log` (admin/secretário) → UI: Configurações › Boletos › "Log de pagamentos e recebimentos". Updates de origem são SEPARADOS e best-effort (SQL 172 ausente não quebra a baixa).
- **Segurança do webhook**: público por natureza — a defesa é (a) nunca confiar no payload (re-consulta autenticada), (b) log completo para auditoria, (c) efeitos idempotentes. Não aceitar "baixa" direta do corpo do evento.

## 2. Focus NFe — NF-e/NFC-e — ATIVA

- **Lib**: `src/lib/focusNfe.ts` (API **v2.0 flat**, doc.focusnfe.com.br). Envs: `FOCUS_NFE_TOKEN`, `FOCUS_NFE_AMBIENTE` (homologacao default), `FOCUS_NFE_*` do emitente (sobrescritos em runtime por `erp_config.emitente` sem deploy).
- **Emitir/consultar/cancelar**: `/api/notas` (EMITIR/CONSULTAR/CANCELAR). Status mapeados EXPLICITAMENTE da v2 (`erro_autorizacao` = REJEITADA — não é "processando", 116).
- **Webhook**: `POST /api/focus/webhook` — gatilho criado PELA APP via `/api/configuracoes INSTALAR_WEBHOOK` (Focus `/v2/hooks`). **Gatilhos que EXISTEM no enum: `nfe` e `nfce_contingencia`** (`nfce` NÃO existe — doc em prosa mente, 150b). Header `x-dm-token` = `FOCUS_WEBHOOK_SECRET` (fallback `CRON_SECRET`). Valida token → 200 imediato → processa em `after()` reconsultando o documento → espelha `sales.nota_*`; documento sem venda → importa AVULSA.
- **Cron** `/api/notas-sync` (12h UTC): reconsulta EMITINDO (máx 15 — rate limit 100 req/min).
- **Arquivamento**: bucket privado `notas-fiscais` (NFE/{ref}.pdf|.xml|-can.xml); **backups mensais** `GET /v2/backups/{cnpj}.json` → ZIP de XMLs → chaves novas viram avulsas (142; NFC-e do painel não consulta por chave — 404; PDF individual `/arquivos/{cnpj}/{mes}/DANFEs/{chave}.pdf`).
- **Prazos de cancelamento** (SEFAZ): NFC-e 30min / NF-e 24h — fonte única `prazoCancelamentoNota` (front+servidor).
- **Rate limit**: 100 req/min → importador em lotes de 6-8.

## 3. Spedy — fiscal alternativo — PREPARADA, DESLIGADA

- `src/lib/spedy.ts`; envs `SPEDY_API_KEY`, `SPEDY_AMBIENTE`, `SPEDY_EMPRESA_ID`, `SPEDY_WEBHOOK_SECRET`, `SPEDY_ENABLED` (=1 liga; sem ela o webhook só armazena — modo observador).
- Webhook: assinatura **Standard Webhooks** (headers `webhook-id`/`webhook-timestamp`/`webhook-signature` v1.HMAC-SHA256), dedup por id em `spedy_webhook_events`; eventos `invoice.status_changed`, `inbound_invoice.*`.
- Nada do fluxo de venda chama a Spedy — só aba Fiscal do admin (`/api/spedy`).

## 4. Pix — gerado no app (sem PSP)

- `src/lib/pix.ts`: BR Code **EMV QRCPS-MPM** estático com valor (campo 54) + txid + CRC16 Bacen. Chave: `app_settings.pix_chave_entrega` (PDV/entrega — bloco 62, valida CPF/CNPJ/telefone/email/aleatória com DV) ou env `PIX_KEY` (default CPF `01735712043`, `PIX_NAME='DOCE MANIA'`, `PIX_CITY='SAO PAULO'`).
- Pontos de uso: PDV `GET /api/pix/venda?valor=`; portal do cliente (saldo devedor, txid único); QR dentro do boleto Inter; QR consulta no cupom fiscal (`montarQrNfce`); mini boleto.
- **Não existe PSP de cobrança** (Mercado Pago/Asaas/Paggue/PagHipper não estão no sistema). Confirmação de Pix é MANUAL: foto do comprovante do cliente → revisão admin (Comprovantes) → CONFIRMAR baixa — grava `baixa_origem='PIX_PORTAL'` (170). Na entrega, Pix exige foto também.
- **Pix via API Inter (extrato/cobrança) NÃO existe** — proposta do roadmap (conciliação automática de Pix) exige env extra; hoje Pix do portal só baixa com revisão humana.

## 5. Padrão universal de webhook seguro (copiar para qualquer integração nova)

1. Rota POST pública + validação do segredo do provedor (header próprio ou assinatura HMAC).
2. Responder **200 imediatamente**; trabalho pesado em `after()` (Next) para não estourar timeout do provedor.
3. **NUNCA confiar no payload**: re-consulta na API de origem (autenticada) antes de qualquer efeito de dinheiro/estoque.
4. Persistir TODO evento em tabela de log (padrão `webhook_logs`: origem, evento jsonb, codigo, seu_numero, sale_id, resultado, processado) + tela de log (inter-log).
5. Idempotência: evento repetido não repete efeito (JA_PAGO, NOT EXISTS).
6. Tabela de log com RLS FECHADA (service_role only).
7. Cron de segurança diário (Vercel Hobby) cobrindo o que o webhook perder.

## 6. Tokens e segredos — onde vivem (NUNCA hardcodar em arquivo novo)

| Segredo | Onde | Como usar |
|---|---|---|
| Supabase anon key | `src/lib/supabase-config.ts` (hardcoded por decisão do dono) | extrair com grep `eyJ[...]`; só client-side/REST anon |
| SUPABASE_SERVICE_ROLE_KEY | env Vercel (sandbox NÃO tem → devBridge) | só server: `getServiceClient()` |
| SESSION_SECRET | env (fallback: derivado da service key) | `session.ts` HMAC |
| FOCUS_NFE_TOKEN + FOCUS_NFE_* | env Vercel + `erp_config.emitente` | `focusNfe.ts` |
| INTER_* (ID/SECRET/CERT/KEY/P12/P12_SENHA/CONTACORRENTE/AMBIENTE) | env Vercel | `interBoleto.ts` mTLS |
| CRON_SECRET / FOCUS_WEBHOOK_SECRET / SPEDY_* | env Vercel | webhooks/crons |
| PIX_KEY | env + `app_settings.pix_chave_entrega` | `pix.ts` |
| VAPID_PUBLIC/PRIVATE_KEY | env | `pushSender.ts` |
| Token GitHub do dono | remote do git (`git remote -v`) / histórico de sessão | só na URL do comando curl; NUNCA gravar em arquivo do repo |
| PIN admin | bcrypt em `app_users.pin_hash` (produção) | nunca em código; confirmar com o dono antes de QA |
| CRON do Vercel | `Bearer CRON_SECRET` no header | protege notas-sync e boletos-sync |

## 7. Otimizações possíveis (backlog para o dono aprovar — nada sem autorização)

- **Inter**: webhook + cron já cobrem baixa; próximos passos possíveis = endpoint de `sumario do dia` (caixa + boletos baixados por push), alerta push quando boleto baixar (webhook → send-push ao admin), conciliação automática de Pix via API de extrato do Inter (escopo novo — requer env de extrato).
- **Focus**: baixa automática de rejeitadas já parcial; possível = dashboard de nota média/dia no hub, alerta push de rejeição, contingência NFC-e offline (fora de escopo mobile — 116).
- **Webhooks**: mesmo padrão para qualquer PSP novo (seção 5). Spedy ligável a qualquer momento com `SPEDY_ENABLED=1` + SQL do bloco 95.
- **Push**: `/api/send-push` é público (risco conhecido) — propor guard de sessão admin.
