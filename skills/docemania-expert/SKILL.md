---
name: docemania-expert
description: ESPECIALISTA COMPLETA no sistema DOCEMANIA (distribuidora de doces B2B — Next.js 16 App Router + Supabase + Vercel, produção https://sistema-doce-mania1.vercel.app). Use esta skill em QUALQUER tarefa, pergunta, bug ou evolução do projeto: fluxos de venda (PDV, pré-venda), fila de entregas, caixa (regras do David/Deivid Rota 5), boletos Banco Inter, notas fiscais (Focus NFe, NF-e/NFC-e, portal /notas), mini DANFE e mini boleto 80mm, impressão térmica (Bluetooth/USB/iOS), webhooks de cobrança, Pix, comissões, estoque/cargas/kardex, portal do cliente, catálogo, clientes GB, configurações, usuários/PIN/admin, banco Supabase (SQL, triggers, RLS), QA (lint/tsc/agent-browser), git e deploy Vercel. Dispara sempre que o usuário mencionar docemania, caixa, boleto, nota fiscal, DANFE, entrega, rota, vendedor, comissão, cliente GB, kardex, webhook, carga, NFC-e ou pedir qualquer alteração/correção no código deste projeto — mesmo sem citar o nome do sistema.
---

# DOCEMANIA Expert — especialista completa do app

Você é o especialista do DOCEMANIA. Este documento é sua memória operacional: leia-o inteiro antes de agir, depois abra APENAS as referências do domínio da tarefa (índice na seção 12). Nunca "adivinhe" uma regra — se não estiver aqui nem nas referências, investigue no código/worklog antes de escrever qualquer linha.

## 1. O que é o DOCEMANIA

Distribuidora de doces (atacado B2B) em São Paulo. App de operação completo:
- **Venda**: PDV de pronta entrega (vende da carga da van) e pré-venda (vende do estoque central, entrega depois — fila estilo Shopee).
- **Entrega**: fila contínua com separação, check de carga, entregador, GPS, foto de comprovante.
- **Caixa**: EXCLUSIVO do vendedor David/Deivid (Rota 5) — dinheiro/PIX à vista + boletos a prazo dele; fechamento só do admin.
- **Fiscal**: NF-e/NFC-e via Focus NFe, mini DANFE 80mm térmica, portal /notas.
- **Cobrança**: boletos Banco Inter (Cobrança V3, mTLS), Pix EMV gerado no app, webhook de baixa automática.
- **Portais**: cliente (extrato + pedido online por link), notas (/notas), entradas (/entradas), produtos fiscais (/fiscal-produtos).

**Stack e infra**: Next.js 16.1.3 (App Router, quase tudo `"use client"`) · Supabase (PostgREST + Storage + SQL) · Vercel (push na `main` = deploy automático) · bun · Tailwind v4 · sem NextAuth/Prisma (sessão HMAC própria; `db.ts` é boilerplate).

**Chaves de ambiente do contexto:**
- Produção: `https://sistema-doce-mania1.vercel.app` · repo GitHub: `docemaniaexpress25/DOCE-MANIA-OFICIAL` (remote já tem o token embutido — `git remote -v`).
- Supabase: `https://eyjhqjrczzpfthsddlpg.supabase.co` + anon key hardcoded em `src/lib/supabase-config.ts` (extrair: `grep -o "eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*" src/lib/supabase-config.ts`).
- **NUNCA escreva segredos (token GitHub, keys, PIN) em arquivos do repo.** O anon key já está no código por decisão do dono; não adicione mais nada.
- Sandbox (seu ambiente) NÃO tem `SUPABASE_SERVICE_ROLE_KEY` nem envs do Inter/Focus → as rotas usam `devBridge()` para repassar requests à produção (ver references/arquitetura.md).

## 2. Quando usar esta skill

Use SEMPRE que a tarefa tocar qualquer um destes domínios: vendas, PDV, pré-venda, entregas, caixa, fechamento, boleto, Inter, Pix, nota fiscal, DANFE, cupom, NFC-e, NF-e, Focus, Spedy, impressora térmica, Bluetooth/USB, webhook, comissão, vendedor, entrega/fila, rota, carga, estoque, kardex, cliente, portal, catálogo, configurações, login/PIN/admin, usuários, Supabase, SQL, trigger, RLS, cron, vercel, deploy, QA, bug ou "não está funcionando". Em caso de dúvida se aplica, USE — o custo de ler é menor que o de quebrar uma regra.

## 3. As 12 leis do dono (nunca violar)

Gravadas em 167 blocos de histórico. Violar qualquer uma já quebrou confiança no passado — cada lei cita o bloco de origem.

1. **Responder sempre em português do Brasil**, direto, com valores/provas concretas. O dono escreve em caixa alta e quer resposta clara.
2. **SQL para rodar vai NO CHAT, pronto para copiar e colar** — e também salvo idempotente em `sql/blocoN_*.sql` (bloco 166: "Se tiver SQL para rodar sempre escreve aqui no chat. Para eu copiar e colar"). Idempotente = `add column if not exists`, `create or replace`, guardas NOT EXISTS, backup espelho antes de operação destrutiva + rollback comentado + SELECT de conferência no fim.
3. **Worklog por BLOCOS** (bloco 168, 169...): entrada no `worklog.md` com pedido do dono VERBATIM, diagnóstico, implementação, QA e Stage Summary. Comentários no código citam o número do bloco.
4. **Nada implementado sem autorização** (bloco 67): propostas e otimizações viram LISTA para o dono aprovar; mude só o que foi pedido (mais o diagnóstico que justifica).
5. **Contas a receber é intocável** (bloco 90): comissões `A_RECEBER` e recebíveis "não pode se perder de jeito nenhum" — nunca zerar, nunca migrar sem backup espelho.
6. **Git sem força** (blocos 67/72): nunca `push --force`; divergência de permissão (100644/100755) ou commit lixo resolve com `git reset --mixed origin/main`; token só na URL do comando, nunca em config/arquivo.
7. **Caixa exclusivo do David/Deivid (Rota 5)** (blocos 118.3/124/165/166/167): dinheiro + PIX à vista PAGO + BOLETO (a prazo) dele. Outros vendedores, recebimentos do portal e contas a receber de outros vendedores: FORA. Fechar caixa = SÓ admin; ao fechar trava só o à vista e zera; boleto pendente sobrevive ao fechamento e só baixa quando o pagamento a prazo ocorrer.
8. **Casar David/Deivid por ID fixo primeiro** — `DAVID_USER_ID = '7c989927-a148-479c-bf00-11f35bfa66b0'` (src/lib/equipe.ts), fallback regex `/^(david|deivid)/i` (bloco 166: ele foi renomeado e a regex antiga quebrou o caixa; IDs não mudam, nomes mudam).
9. **Cupom fiscal é fiel ao XML autorizado** (blocos 131/151): mini DANFE sai do XML baixado da Focus (`/api/notas/cupom`), nunca montada com dados da venda. Sem XML, avisa e não imprime fiscal.
10. **Boleto oficial = PDF do Inter** (bloco 152); mini boleto 80mm é conveniência (bloco 167). Cancelamento de nota segue prazo SEFAZ (NFC-e 30min / NF-e 24h) validado no servidor.
11. **Pré-venda só tira o pedido** (bloco 39): à vista = entregador cobra na entrega; a prazo = vendedor cobra depois; estoque reservado no registro (bloco 88); comissão só nasce na entrega; só entra em relatório quando ENTREGUE.
12. **Nunca cortar nomes de clientes** (bloco 126): break-words, tudo visível e clicável. E **nunca mexer na ordem dos produtos do PDV** (bloco 89: "em hipótese alguma").

## 4. Zero furos — regras de segurança (obrigatórias em código novo)

O app passou por auditoria em blocos 116/117/140/144. Toda linha nova segue estes padrões — eles existem porque cada um já falhou antes:

- **PIN nunca em texto plano**: login valida bcrypt contra `app_users.pin_hash` no servidor (`/api/login`, rate limit 8 tentativas/IP/10min). Token de sessão HMAC-SHA256, TTL 7 dias (`src/lib/session.ts`), enviado como `Bearer`.
- **Permissão calculada NO SERVIDOR** (bloco 119.2): "ver a tela" não é "poder agir" — guards 403 com nome de quem tem a carga; FECHAR caixa e CANCELAR nota são `isAdminSession`.
- **service_role só no servidor** (`src/lib/serverSupabase.ts::getServiceClient`). Browser usa anon key só nas tabelas operacionais com policy. Tabela nova sensível = RLS FECHADA (sem policy para anon/authenticated) — padrão de `caixa_*`, `webhook_logs`, `xml_*`.
- **Webhook nunca confia no payload**: re-consulta na API de origem antes de dar baixa (Inter mTLS; Focus GET), responde 200 imediato e processa em `after()`, evento persistido em `webhook_logs` (blocos 108/116/167). Nunca processar "boleto pago" apenas por mensagem recebida.
- **Fotos/comprovantes vão para Storage privado** (`fotos-pedidos`, `comprovantes`, `notas-fiscais`) com caminho na coluna + URL assinada 1h — nunca base64 novo (Postgres free 500MB, bloco 69).
- **Idempotência por contrato**: caixa (sale_id+metodo+valor), dedup de pedido 60s, importadores por ref/chave, triggers com dupla checagem NOT EXISTS. Reexecutar qualquer operação nunca duplica dinheiro.
- **Trigger SQL = EXCEPTION swallow** ("kardex NUNCA quebra venda") — erro de ledger não pode matar a venda; e SECURITY DEFINER com checagens explícitas.
- **Sonda de schema antes de usar coluna nova** (`src/lib/serverSchema.ts::hasXxxColumn`, cache 30s): o app funciona ANTES e DEPOIS de o dono rodar o SQL — deploy nunca fica vermelho esperando SQL.
- **Erro nunca vaza credencial**: máscara de token em mensagens (bloco 142 corrigiu vazamento na URL do motivo).
- **QA de produção = somente leitura** quando há risco de mutar dado real (bloco 114): nunca disparar cancelamento/emissão/exclusão de verdade pelo QA.

## 5. Padrões técnicos que NÃO podem quebrar

- **Anti-duplicação em 3 camadas** no envio de venda (bloco 41): carrinho sai da tela antes do await + dedup 60s no servidor + spinner travando botões.
- **`sale_items.precovenda` (sem underscore)** é a coluna real; o TS às vezes usa `preco_venda` — conferir cada select novo.
- **`sales.metodo_pagamento` só aceita DINHEIRO|PIX|A_PRAZO** (CHECK legado no banco). BOLETO/DEPOSITO vão em `detalhe_pagamento` + colunas `inter_boleto_*`; ao gravar da fila, BOLETO grava `A_PRAZO` (fila faz isso certo — copiar o padrão).
- **Acesso ao banco em código novo**: browser → `supabaseClient.ts` (anon) nas tabelas operacionais; servidor → `getServiceClient()`; contagem grande → `fetchAllPages` (`supabaseAll.ts`) porque o PostgREST corta em 1000 linhas (bloco 20).
- **Arquivos novos seguem o padrão de degradação** (sondas + fallback silencioso) e devBridge PRIMEIRO (`if (!isServerSupabaseConfigured()) return devBridge(req)`) — erro 401 no preview quase sempre é bridge na ordem errada (blocos 66/156).
- **iOS**: sem Web Bluetooth (usar navegador Bluefy, `iosPrint.ts`); Safari ignora print() de iframe e print() após await → imprimir pelo documento principal + gesto do usuário (bloco 120); TODO acesso a localStorage em try/catch (SecurityError = tela branca, bloco 118.4).
- **ESC/POS**: fonte pequena = `ESC ! 0x01` (NÃO `GS ! 0x01` = ampliação, bloco 102); Code128 sem NUL terminado; QR com módulo dinâmico; marcadores `[[QR:...]]`/`[[BARCODE:...]]`/`[[PEQ]]`.
- **Papel térmico real = 70mm** (`@page { size: 70mm auto; margin: 0 }`) — área imprimível comprovada ~70,5mm (bloco 163); 80mm é a classe de impressora, 70mm é o papel que não corta à direita.
- **Cron Vercel**: plano Hobby só aceita diário (bloco 108); horário é UTC (`0 10 * * *` = 07:00 BRT).
- **Vercel build**: manter só `bun.lock` (package-lock acidental → npm → next errado → ENOENT, bloco 159); next fixado `16.1.3`; export inexistente em route.ts trava o build inteiro (bloco 103).
- **Componente novo do app doce**: Tailwind artesanal mobile-first `max-w-lg`, cards `rounded-3xl border-gray-100 shadow-sm`, micro-tipografia caixa-alta `font-black` 8–11px, `active:scale-95`, alvos ≥44px, `shrink-0` no cupom, modais com `max-h` + scroll. shadcn/ui existe em `src/components/ui` mas o app doce quase não usa (só Toaster) — não depender de primitivas shadcn ao editar telas doce.

## 6. Caixa e David/Deivid — a área mais sensível

Resumo operacional (detalhes e SQL: references/negocio.md e references/fluxos.md §4):

- **Quem entra no caixa aberto**: venda do David com DINHEIRO/PIX à vista PAGO + A_PRAZO dele como linha BOLETO pendente. Fonte de verdade = **trigger SQL `trg_caixa_david_sales`** (v2 do bloco 167, casa por ID OU nome david|deivid); o POST client-side (`/api/caixa REGISTRAR`) é redundância de defesa.
- **Quando a linha BOLETO sai**: venda vira `PAGO` por QUALQUER caminho (webhook Inter, cron `/api/boletos-sync`, recebimento manual, comprovante do portal) → trigger `trg_baixa_boleto_caixa` grava `caixa_pagamentos.pago_em = now()` e o GET deixa de exibir. Boleto CANCELADO → linha pendente apagada.
- **FECHAR**: só admin (`isAdminSession`), a qualquer momento, trava SOMENTE linhas à vista (`neq metodo BOLETO`), grava snapshot em `caixa_fechamentos_geral` (jsonb `pagamentos`), linhas travadas ganham `fechamento_id` e viram imutáveis (409). Resposta inclui `boletosPendentes` para a UI avisar.
- **Lixeira** do caixa aberto: admin/secretário, linha aberta apenas (fechada = 409); excluir do caixa NÃO toca a venda (bloco 124).
- **POSTO MODELO II** (`d6485c79-9440-4cef-9439-f1dc50a17346`) foi excluído do caixa pelo dono — NÃO recriar.
- **Comissão do David desativada** em todas as camadas (trigger `trg_comissoes_skip_david` + código pula + Financeiro oculto + PAGAR 403).
- **Reclamação de "caixa zerado"** = sequência de diagnóstico obrigatória (lição dos blocos 165/166): (1) SQL pendente? `GET /api/diagnostico-banco` + conferir com o dono se rodou o SQL do bloco; (2) vendedor renomeado? casar por ID; (3) 401/403 silencioso em POST client-side? mover para trigger/servidor; (4) lendo com anon e recebendo `[]` por RLS? ler com service_role.

## 7. Mapa mental do código

| Procurando... | Onde está |
|---|---|
| Telas do app (tudo em `/`) | `src/lib/doce-app.tsx` (shell) + `src/components/doce/**` (33 componentes) |
| Login, perfil, sessão | `src/components/doce/Login.tsx`, `src/app/api/login`, `src/lib/session.ts`, `src/lib/doce-app.tsx` |
| PDV (8 telas) | `src/components/doce/PDV.tsx` |
| Fila de entregas | `src/components/doce/FilaEntregas.tsx` + `src/app/api/pre-venda/route.ts` |
| Caixa | `src/components/doce/CaixaFechamento.tsx` + `src/app/api/caixa` + `src/lib/caixaLedger.ts` + triggers SQL 165/166/167 |
| Fiscal / notas | `src/app/api/notas`, `src/lib/focusNfe.ts`, `src/lib/focusXml.ts`, `src/components/doce/JanelaFiscal.tsx`, portal `src/app/notas/page.tsx` |
| Boleto Inter | `src/lib/interBoleto.ts`, `src/app/api/boletos`, `src/components/doce/BoletoCard.tsx` |
| Mini DANFE / mini boleto 80mm | `src/lib/danfe80Html.ts` + `danfe80.ts` + `code128.ts` + `ModelosImpressao.tsx`; `src/lib/miniBoleto80Html.ts` + `MiniBoletoImpressao.tsx` |
| Impressão (canais) | `src/lib/impressao.ts` (central) + `usbPrint.ts` + `bluetoothPrinterService.ts` + `iosPrint.ts` |
| Webhooks | `src/app/api/webhooks/inter`, `src/app/api/focus/webhook`, `src/app/api/spedy/webhook`, log em `webhook_logs` |
| Configurações | aba SETTINGS com 4 sub-abas + `ConfiguracoesHub.tsx` (ERP) + `src/app/api/configuracoes` + `erpConfig.ts` |
| Equipe/regras de vendedor | `src/lib/equipe.ts` (DAVID_USER_ID), `comissaoPv.ts`, `contaAReceber.ts`, `regraClienteGB.ts` |
| Schema/sondas/SQL | `src/lib/serverSchema.ts`, `sql/bloco*.sql`, `supabase/00-SETUP-COMPLETO-SUPABASE.sql`, diagnóstico `/api/diagnostico-banco` |
| Worklog | `worklog.md` (novos no topo "Task ID:", antigos "## blocoNNN") |

## 8. Fluxos em uma linha (detalhe: references/fluxos.md)

1. **Pronta entrega**: cliente → PRONTA → PDV 8 telas (carrinho → documento → condição → forma → conferência → finalizar) → RPC `processar_venda_v2` baixa carga → à vista nasce PAGO → caixa (se David) → nota escolhida na tela final.
2. **Pré-venda**: cliente → PRE_VENDA → PDV → `POST /api/pre-venda/venda` reserva estoque → fila (separação → check de carga → entregador) → ENTREGUE com pagamento (+foto em Pix/boleto) → comissão nasce → entra em relatórios.
3. **Caixa**: trigger alimenta → polling 20s → FECHAR (admin) trava à vista e zera → boleto pendente continua até `PAGO` da venda.
4. **Fiscal**: JanelaFiscal (NF-e / NFC-e identificada / NFC-e anônima no preço cupom) → Focus v2 → webhook/cron espelham status → mini DANFE do XML → cancelar dentro do prazo (30min/24h) com cascata (arquiva nota + cancela boleto + devolve estoque + exclui venda).
5. **Boleto**: BoletoCard EMITIR (CEP obrigatório, min R$2,50, atrelar NF opcional com fallback) → webhook Inter baixa com re-consulta → cron 10h UTC rede de segurança → mini boleto 80mm opcional.
6. **Portal do cliente**: link `portal_code` → extrato/dívida → pedido online (mín R$200) vira pré-venda na fila → comprovante Pix com foto → admin revisa em Comprovantes.
7. **Configurações**: SETTINGS 4 sub-abas (Geral/Pagamentos/Sistema/Integrações) + hub ERP (Focus, Inter, webhook, impressão).

## 9. Workflow padrão de QUALQUER tarefa

1. **Diagnóstico primeiro** (blocos 70/85/160): sondas, leitura de código, `/api/diagnostico-banco`, dados reais via REST anon (curl com a anon key) — responder perguntas do dono com PROVA antes de mudar nada.
2. **Anunciar plano curto** e começar pelo que o dono pediu (lei 4). Tarefas grandes: design aprovado antes (blocos 121/122).
3. **Implementar seguindo as leis + padrões** (seções 3–5) e o domínio específico da reference correspondente.
4. **QA obrigatório** (seção 10) e registrar no worklog (lei 3) — o número do bloco novo é o MAIS ALTO já usado no worklog + 1 (conferir no arquivo; não presumir).
5. **SQL novo → NO CHAT para copiar/colar** + arquivo `sql/blocoN_*.sql` (lei 2). Deixar claro: "você roda no SQL Editor do Supabase; enquanto não rodar, o app funciona com fallback sem a coluna".
6. **Commit + push na main** (deploy Vercel automático). Conferir deploy pelo status do commit no GitHub (`curl -H "Authorization: token $TOKEN" https://api.github.com/repos/docemaniaexpress25/DOCE-MANIA-OFICIAL/commits/<sha>/status` → SUCCESS). NÃO confiar nos outros domínios vercel (zpac falha sempre; doce-mania-oficial.vercel.app é um Vite antigo — bloco 38).
7. **Terminar com "Teste do dono"**: instruções curtas de verificação na tela/na folha.
8. **Atualizar esta skill** (seção 11) — ela tem que acompanhar o app.

## 10. QA obrigatório e baselines

- **lint**: `bun run lint` — baseline **0 erros / 8 warnings** (comparar antes/depois; qualquer erro novo = corrigir).
- **tsc**: baseline **104 erros** — comparar com `git stash` + diff linha a linha: ZERO erros novos permitidos.
- **E2E local com mock** (`NEXT_PUBLIC_E2E_MOCK=1` + `/api/e2e-supabase`, admin PIN 123456, browser em `127.0.0.1:3000` — mesma origem, senão "Failed to fetch"): testar o fluxo REAL de UI (agent-browser), console sem erros de JS.
- **agent-browser**: `fill` não dispara onChange do React e não grava em teclados de PIN — limpar/digitar com TECLADO (Ctrl+A+Delete, click+type); `innerText` volta uppercase por CSS (usar textContent/toLowerCase); preview pode recarregar entre comandos (fazer fluxos inteiros num único eval).
- **dev.log**: ler `/home/z/my-project/dev.log` (tail) após qualquer mudança de rota/tela.
- **Limitação honesta** sempre declarada: "SQL não rodado pelo sandbox (sem service key) — é o dono que roda"; "PIN real indisponível no sandbox"; "webhook real só testável com boleto pago de verdade".
- **Produção**: QA só leitura em dado real (lei da seção 4). Confirmar PIN atual do admin com o dono antes de testar portais (635241 foi recusado nos blocos 164/165 — pode ter mudado).

## 11. Backup de tudo e autootimização da skill

Esta skill vive em `skills/docemania-expert/` e é versionada no git (exceção no .gitignore) — o git É o backup primário. O ciclo de autootimização garante que ela nunca envelhece:

1. **A cada bloco concluído**: além do worklog, atualize a reference afetada (ex: mudou regra de caixa → `references/negocio.md` e `references/fluxos.md`; API nova → `references/arquitetura.md`; lição nova → tabela de bugs em `references/qa-deploy.md`). Uma linha por mudança, com o número do bloco.
2. **A cada bloco**: rode `bash skills/docemania-expert/scripts/backup-docemania.sh` (snapshot rotativo local de worklog, sql/, supabase/, configs e libs críticas) e depois **commit + push** (backup na nuvem + deploy).
3. **Nunca apagar**: entradas antigas do worklog e regras com "bloco de origem" são a prova histórica; ao substituir uma regra, marque "(revogada no bloco N)" em vez de remover.
4. **Bug novo + lição nova** = linha na tabela de bugs do `references/qa-deploy.md` no mesmo bloco em que foi corrigido — é isso que impede regressão.
5. Pendências resolvidas: mover para "resolvidas" no `references/qa-deploy.md` §6 com o bloco; manter a lista de pendências vivas sempre atualizada.

## 12. Índice das referências — leia só o que a tarefa precisa

| Arquivo | Leia quando... |
|---|---|
| `references/arquitetura.md` | Vai tocar API, lib, tabela, coluna, trigger, RPC, RLS, storage, cron, sonda de schema ou precisa do mapa de 56 rotas / 48 libs |
| `references/negocio.md` | A tarefa envolve regras de caixa, comissão, entrega, pré-venda, cliente GB, estoque, preços, fiscal (regras de negócio) |
| `references/fluxos.md` | Vai implementar/mudar algo nos caminhos de venda, entrega, caixa, fiscal, boleto, portal, configurações (passo a passo com arquivos) |
| `references/impressao-fiscal.md` | Tarefa de impressão térmica, cupom, mini DANFE, mini boleto, ESC/POS, @page, iOS |
| `references/integracoes-webhooks.md` | Tarefa de Inter, Focus, Spedy, Pix, webhook, cron, baixa automática, tokens/secrets das APIs |
| `references/qa-deploy.md` | Antes de commit/QA/deploy; tabela de bugs históricos e padrões de SQL/git/Vercel |
| `references/ui-ux.md` | Tarefa de tela nova, botão, navegação, configurações, portais, padrões visuais |
| `references/roadmap-otimizacoes.md` | Dono pedir otimizações/melhorias/consultoria (estoque, margens, automações, vender mais, portais, sync, segurança, telas) — lista aprovável do bloco 169 + limites do Supabase FREE |

## 13. Estado vivo — pendências em aberto (atualizar a cada bloco)

- **SQL 167 (e confirmar 165/166/157) aguardando o dono rodar** no SQL Editor — caixa 2.0 (pago_em + triggers v2) e webhook_logs só ligam 100% depois.
- **Webhook do Inter**: código pronto (webhook + log + passo a passo no hub ERP); falta o dono cadastrar a URL no Internet Banking PJ e testar com um boleto pago de verdade.
- **Env do Inter na Vercel** (INTER_CLIENT_ID/SECRET/CERT/KEY/P12/P12_SENHA/CONTACORRENTE/AMBIENTE) — se emissão falhar, verificar envs + Redeploy.
- **PIN admin**: confirmar com o dono (recusado nos QA 164/165).
- **Excel NCM/CEST/CFOP pausado** (bloco 161): dono preenche planilha; reimportar via `/api/produtos-fiscal` PATCH. Produto sem NCM sai com 21069090 genérico.
- **CSC/IdCSC NFC-e (SEFAZ-RS)** para autorizar NFC-e de vez.
- **Botão cancelar do portal /notas**: fluxo CANCELAR_AVULSA no ar (bloco 155) — validar com a próxima nota autorizada real.
- **Spedy dormant** (`SPEDY_ENABLED=1` liga), app nativo iOS (Capacitor), cron mais frequente no Vercel Pro — backlog aprovável.
- **REABRIR não estorna caixa por entregador** (OBS do bloco 119.1) — abrir bloco se o dono quiser.

## 14. Bugs históricos que nunca podem voltar (top 12 — tabela completa em references/qa-deploy.md)

1. Renome David→Deivid + regex `/^david/i` → caixa zerado (166): casar por **ID**.
2. SQL do bloco não rodado → feature inerte (165/166/70/75/80/95/98/108): conferir com `/api/diagnostico-banco` e perguntar ao dono.
3. POST client-side fire-and-forget com sessão expirada → 401 silencioso (165): fonte de verdade no servidor/trigger.
4. RLS sem policy → anon vê `[]` e engana diagnóstico (165): ler com service_role.
5. localStorage sem try/catch no iPhone → tela branca eterna (118.4).
6. Safari iOS: print() de iframe/timeout ignorado (120) → documento principal + gesto.
7. `GS ! 0x01` ampliou texto gigante (102) → `ESC ! 0x01`.
8. package-lock.json acidental → build Vercel ENOENT (159) → só bun.lock, next 16.1.3.
9. Gatilho `nfce` não existe no enum da Focus (150b) → hooks = `nfe` + `nfce_contingencia`.
10. Inter recusa cobrança COM notaFiscal (151) → emitir sem o campo + nota na mensagem.
11. Exclusão de venda apagava nota do portal (154) → congelar nota ANTES do delete; exclusão só admin.
12. CSOSN fixo 101 rejeitou SEFAZ (160) → CSOSN segue o destinatário (101 contribuinte c/ IE; 102 não contribuinte/CPF/NFC-e).
