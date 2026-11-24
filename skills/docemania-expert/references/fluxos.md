# FLUXOS DOCEMANIA — passo a passo com arquivos

Como os dados fluem de ponta a ponta. Ao mudar qualquer etapa, confira os arquivos citados — um fluxo "não quebra" quando TODOS os caminhos convergem no mesmo estado final (idempotência) e a permissão é validada no servidor.

## 1. Fluxo de venda — PRONTA ENTREGA (vende da carga da van)

1. Vendedor abre cliente no `VendedorDashboard` → modo **PRONTA** (`modoSheet`) + documento (NFE/NFCE/CUPOM) → `PDV.tsx`. Catálogo = carga da van (qty 0 não aparece; cliente GB só itens com Preço GB > 0). GPS automático.
2. Telas do PDV (8 telas, bloco 122): **3 CART** (busca produto, preço editado por item, switch preço-tabela → precoMinimo/preço GB, trocas com autocomplete + valor custo, OBS) → **4 DOC** (NF-e/NFC-e+CUPOM; pulada se van SEM NF) → **5 CONDICAO** (A VISTA / A PRAZO com vencimento +7d) → **6 FORMA** (à vista: DINHEIRO/PIX/MISTO com slot Pix 1 ou 2; a prazo: BOLETO/CHEQUE/DINHEIRO_DATA/PIX_DATA) → **7** cupom de CONFERÊNCIA → **8 FINALIZAR** (soma de trocas, ka-ching, haptics, push).
3. `finalizarAposConferencia` (PDV:970) → `processSale` (`doce-app.tsx:751`) → `saleService.insertSale` → **RPC `processar_venda_v2`** (baixa carga, grava sale+items) → atualiza modo_nota. Anti-duplicação 3 camadas (41).
4. À vista **nasce PAGO** (152). Se David: trigger `trg_caixa_david_sales` insere DINHEIRO/PIX no caixa (POST `/api/caixa REGISTRAR` é redundância). Caixa à vista aparece DEPOIS da emissão da nota (153 — card de dinheiro/pix na TELA FINAL).
5. Tela SUCESSO mostra comissão (Σ qtd×preço×%) + `BoletoCard` (se a prazo — gerado MAIS TARDE com a data combinada, 153) + documento fiscal escolhido (`POST /api/notas EMITIR`; rejeitada reemite com ref `-r2`).

## 2. Fluxo de venda — PRÉ-VENDA (vende do estoque central)

1. Modo **PRE_VENDA** no mesmo PDV; catálogo = saldo do estoque principal > 0.
2. `registrarPreVendaFluxo` (PDV:1052) → `processPreVenda` → **`POST /api/pre-venda/venda`**: sessão VENDEDOR, dedup 60s, **RESERVA estoque** (`estoque_baixado=true`), nasce `PRE_VENDA` + `entrega_status=PENDENTE` + `status_pagamento=PENDENTE`; à vista = entregador cobra; a prazo = vendedor cobra; devolve `comissaoPrevista` + avisos de saldo.
3. Fila (`FilaEntregas.tsx`): card entra com badge; push "Novo Pedido"; secretário SEPARA (`SecretarioView.tsx` — alarme, cupom idêntico, EDITAR_PEDIDO via `EditorPedido.tsx`, trocas visíveis).
4. Admin: **CHECK DE CARGA** (carregadoEm) + **aloca entregador** (exclusivo; DESALOCAR admin); impressão da lista só com carregados.
5. Entregador abre card → GPS → **ENTREGUE** (pagamentos; foto obrigatória Pix/Boleto/a-prazo sem pgto) ou **FALHOU** (motivo fixo) + REABRIR. Vendedor pode entregar a PRÓPRIA venda (comissão PE) só com carga confirmada no nome dele (120.1).
6. `POST /api/pre-venda` ação ENTREGUE: entrega_status=ENTREGUE, pagamento baixa/parcial + log `detalhe_pagamento`, metodo correto (BOLETO grava A_PRAZO), **comissão nasce** (`registrarComissaoPreVenda` — pula David por ID), **caixa do David** (trigger), baixa estoque idempotente (`baixar_estoque_principal`), evento GPS+foto, push.
7. Comissão vira DISPONIVEL quando venda → PAGO (`receiveAccount` → `commissionService.updateCommissionStatus`). Pré-venda entra em relatórios só ENTREGUE (data_venda = data entrega).
8. Cancelamento: `deleteSale` arquiva a nota ANTES (`ARQUIVAR_NOTA_EXCLUSAO`); pendentes usam `EXCLUIR_VENDA` (admin). Portal `/pedido/[codigo]` também cria pré-venda (checkout Pix/Dinheiro, mín R$200).
9. Admin clona venda rejeitada no portal `/notas` (acao CLONAR).

## 3. Fluxo de entrega — estados e permissões

- Estados: PENDENTE → (separado) → carregado (`carga_confirmada_em`) → EM_ROTA/ENTREGUE/FALHOU.
- **Permissão de receber** (server-side, `enrichFila`): vendedor = carga confirmada no nome DELE; entregador = tudo no nome DELE; outros cards só conferência (sem botões). Admin: tudo.
- Caixa do ENTREGADOR (separado do caixa do David): por entregador, dinheiro/pix/a receber desde o último fechamento DELE; admin fecha via FECHAR_CAIXA/CONFIRMAR_CAIXA.
- Ordem: P1/P2 + drag (ORDEM_ENTREGA) + lista imprimível; WhatsApp "a caminho" (melhoria).
- Rota do dia do vendedor = conceito separado (`dailyRouteService` + `/api/daily-route`): ordem de visita, pulados sincronizados entre aparelhos (servidor é fonte da verdade, 87); Roteiro Semanal (WEEKLY).

## 4. Fluxo do CAIXA (regra 167 — leia references/negocio.md §1 para as regras)

1. **Alimentação**: trigger `trg_caixa_david_sales` (SQL 167 v2) reage a INSERT/UPDATE em `sales`: venda do David (ID `7c989927-a148-479c-bf00-11f35bfa66b0` OU nome `david|deivid`) à vista DINHEIRO/PIX PAGO → insere linha caixa; A_PRAZO → insere linha BOLETO pendente (idempotente por venda toda, não por fechamento).
2. **Leitura**: `GET /api/caixa` → ledger aberto = `fechamento_id IS NULL AND (metodo != 'BOLETO' OR pago_em IS NULL)` + histórico de fechamentos. Fallback se `pago_em` não existe (sonda/erro 42703).
3. **UI** (`CaixaFechamento.tsx`): polling 20s + visibilitychange; card herói; conferência por forma; card amber "Boletos pendentes (a prazo) — não fecham o caixa"; log completo de cada pagamento; lixeira (admin/secretário) só em linha aberta.
4. **FECHAR** (`POST /api/caixa FECHAR`, só admin): trava SOMENTE à vista (`neq metodo BOLETO`); snapshot em `caixa_fechamentos_geral` (pagamentos jsonb); linhas ganham `fechamento_id` (imutáveis 409); resposta com `boletosPendentes {qtde, valor}`; UI mostra "Total a fechar (à vista)".
5. **Baixa do boleto**: venda → PAGO por qualquer caminho (webhook Inter, cron, recebimento manual, comprovante portal) → trigger `trg_baixa_boleto_caixa` grava `pago_em=now()` → some do aberto sozinha. Boleto cancelado → linha apagada.

## 5. Fluxo FISCAL

1. **Emissão**: `JanelaFiscal.tsx` (botão FISCAL do Cupom): NF-e (CNPJ válido + razão social), NFC-e identificada (doc do cadastro, preço normal), NFC-e ANÔNIMA (sem consumidor, itens no `preco_cupom`; exige `erp_config.cupomDuploNfc` no servidor). `POST /api/notas EMITIR` → Focus v2 flat (`focusNfe.ts`) → `nota_status=EMITINDO`.
2. **Espelhamento de status**: webhook Focus (`/api/focus/webhook` — token `x-dm-token`, 200 + after()) reconsulta e espelha `sales.nota_*`; nota sem venda → importa AVULSA. Cron `/api/notas-sync` (12h UTC) reconsulta EMITINDO. Portal tem botão SINCRONIZAR.
3. **Cupom/mini DANFE**: com nota AUTORIZADA → "Imprimir Mini-DANFE" → `/api/notas/cupom` baixa XML autorizado → `danfeFiscal80()` → USB imprime HTML 70mm / BT imprime texto 48 col. "Abrir DANFE A4" = link do PDF na Focus.
4. **Cancelar** (só admin, prazo NFC-e 30min/NF-e 24h, justificativa ≥15): `POST /api/notas CANCELAR` (venda do app) ou `/api/notas-admin CANCELAR_AVULSA` (avulsa Focus) → **cascata** (`cascataCancelamento.ts`): arquiva nota no portal, cancela boleto no Inter, devolve estoque, exclui venda. Boleto vivo após cancelamento → aviso para cancelar em Ações › Boleto.
5. **Pendências e rejeitadas**: badge NOTA PENDENTE; painel NOTAS_PENDENTES nos dashboards; rejeitada reemite com ref `-r2`.
6. **Importação**: portal /notas — XML em lote (drag-and-drop), Buscar TODAS NA FOCUS (backups mensais `/v2/backups/{cnpj}` → ZIP → chaves novas → avulsa com PDF/XML), colar ref/chave, avulsas idempotentes.

## 6. Fluxo de BOLETO (Inter)

1. **Emissão** (`BoletoCard.tsx` → `POST /api/boletos EMITIR` → `interBoleto.ts` OAuth2+mTLS): pagador do cliente, CEP obrigatório, min R$2,50, valor = saldo da venda, vencimento combinado; checkbox ATRELAR NF-e com **fallback SEM notaFiscal** (Inter recusa com nota — 151); nota vai na mensagem (linha 2 = mensagem padrão do hub, 152). Assíncrono: EM_PROCESSAMENTO → A_RECEBER. seuNumero `DM<saleId>`; reemissão `-r2`.
2. **Baixa automática** (3 caminhos convergem no mesmo UPDATE de sales): webhook `POST /api/webhooks/inter` (reconsulta a cobrança antes de baixar; persiste evento em `webhook_logs`; 200 sempre) · cron `/api/boletos-sync` (10h UTC, até 15 cobranças; comissão A_RECEBER→DISPONIVEL) · revisão manual de comprovante/recebimento.
3. **Efeitos da baixa**: `valor_pago=valor_total`, `status_pagamento=PAGO`, `inter_boleto_status=RECEBIDO` → trigger caixa grava `pago_em` → comissão DISPONIVEL.
4. **Impressão**: "Mini Boleto (80mm)" no BoletoCard (quando há linha/barras/pix) → `MiniBoletoImpressao.tsx` → USB (HTML 70mm `miniBoleto80Html.ts`) ou BT (texto 48 col `comprovanteBoletoTexto`). **Boleto oficial = PDF do Inter** (PDF acao → blob → WhatsApp).
5. **Cancelar boleto** (admin): `/api/boletos CANCELAR`; nota cancelada → `finalizarVendaCancelada` tenta cancelar o boleto junto.

## 7. Fluxo do PORTAL DO CLIENTE (`/cliente/[codigo]`, credencial = portal_code)

1. GET `/api/cliente/[codigo]`: extrato (sales + payment_comprovantes), dívida (ENTREGUE/PRONTA não PAGO), stats, sugestões (RPC), DANFE/XML por download.
2. Pagamento: QR Pix do saldo (BR Code com valor+txid) → cliente envia FOTO do comprovante → `payment_comprovantes` PENDENTE → admin revisa em Comprovantes Pix (CONFIRMAR baixa valor_pago+PAGO / REJEITAR com motivo).
3. Pedido online `/pedido/[codigo]`: catálogo por família (estoque central), mín R$200, checkout Pix/Dinheiro → nasce PRE_VENDA na fila com vendedor = rota do cliente.

## 8. Fluxo de configurações e estoque (admin)

- **SETTINGS** (4 sub-abas, 167): Geral (empresa, logo) / Pagamentos (Pix 1/2 + chave recebimento) / Sistema (margem 35%, mínimo, melhorias) / Integrações (atalhos). Hub ERP (`ConfiguracoesHub.tsx`): Focus (emitente, switches, webhook INSTALAR/REMOVER), Inter (autoBoletoAReceber, mensagem padrão, LOG webhook), QR catálogo, impressão.
- **Estoque**: ajuste manual (admin — posição, preço, tudo; secretário — só qty `estoque_principal`), entrada por XML (Portal de Entradas: fila xml_itens → VINCULAR/CRIAR/IGNORAR → ENTRADA_ESTOQUE/ENTRADA_LOTE), carga da van SEM modo (estoque central único — Bloco 217; → cargas_pendentes → aceite do vendedor), kardex (`estoque_movimentos`, `/api/estoque/movimentos`), DnD no Estoque Central (ordem do PDV — não mexer, 89).

## 9. Onde cada dado aparece (checklist de consistência)

Ao mudar um fluxo de pagamento/venda, confira TODOS os destinos:
- **Venda à vista do David PAGO** → caixa (trigger) → Contas a Receber NÃO (ja pago) → comissão NÃO (desativada) → relatórios/lucro (custo congelado) → cupom.
- **Venda a prazo do David** → linha BOLETO no caixa + Contas a Receber + boleto opcional → baixa: webhook/cron/manual → PAGO → caixa libera (pago_em) → A_RECEBER vira DISPONIVEL (outros vendedores) → relatórios.
- **Pré-venda entregue** → fila → comissão A_RECEBER → PAGO na entrega/boletos-sync → caixa do David se ele receber.
- **Nota emitida** → sales.nota_* → portal /notas → bucket notas-fiscais → mini DANFE do XML → cancelamento com cascata.
