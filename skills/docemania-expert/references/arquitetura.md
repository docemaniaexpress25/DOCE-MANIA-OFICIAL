# ARQUITETURA DOCEMANIA — APIs, libs, banco de dados

Mapa técnico completo. Fontes: código em produção + SQL consolidado + `/api/diagnostico-banco` (le o OpenAPI do PostgREST e confere por bloco SQL o que está aplicado — usar sempre para conferir se SQL do dono rodou).

## 1. Padrões transversais das APIs (56 rotas em `src/app/api/**/route.ts`)

- **Servidor**: TODAS as rotas usam `getServiceClient()` (`src/lib/serverSupabase.ts:11`) com `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS).
- **devBridge** (`serverSupabase.ts:55`): no sandbox sem service key, a rota repassa a request para `https://sistema-doce-mania1.vercel.app` (env `DM_PROD_URL`). **Ordem obrigatória: devBridge → sessão** — validar sessão ANTES da bridge dá 401 com token válido (bug dos blocos 66/156).
- **Guards**: `sessionFromRequest(req)` (`src/lib/session.ts:62`) valida token HMAC Bearer (TTL 7d); `isAdminSession(req)` exige perfil ADMIN. Perfis: `ADMIN | VENDEDOR | ENTREGADOR | SECRETARIO`.
- **Guard David/Deivid**: `isDavidVendedor(id,nome)` / `isDavidNome` / `DAVID_USER_ID` em `src/lib/equipe.ts`. Usado em `/api/caixa` (POST REGISTRAR → 403 se não for dele), `/api/pre-venda` (ledger na entrega), `/api/comissoes` (PAGAR 403), trigger `trg_comissoes_skip_david`.
- **Browser (anon key)** acessa direto apenas tabelas operacionais com policy `anon_full_access` (ver §4).

## 2. Inventário de rotas

### Vendas / PDV / pré-venda / entregas
| Rota | Métodos | O que faz | Guard |
|---|---|---|---|
| `api/pre-venda` | GET, POST | Fila de entregas. GET: rota de hoje (`?all=1` admin, `?config=1` % comissão). POST ações: `GERAR_ROTA`, `INICIAR_ROTA`, `ENTREGUE` (DINHEIRO/PIX parcial; PIX/BOLETO exigem foto; gera comissão; registra caixa se David), `FALHOU`, `REABRIR`, `EXCLUIR_VENDA` (admin, congelando a nota — 154), `SET_CONFIG`, `EDITAR_PEDIDO`, `CHECK_CARGA`, `ORDEM_ENTREGA`, `TROCAR_DOC_FISCAL`, `DESALOCAR`, `ARQUIVAR_NOTA_EXCLUSAO` | sessão; ações de fila admin/secretário; entrega só da carga no SEU nome (403 com nome do dono) |
| `api/pre-venda/venda` | POST | Cria PRE_VENDA; estoque reservado (`estoque_baixado=true`, 88); `condicao AVISTA/APRAZO`, vencimento +7d default; dedup 60s | sessão (vendedor_id da sessão) |
| `api/pre-venda/foto` | GET | Foto base64 de comprovante/boleto da entrega | sessão; admin/entregador/dono da rota |
| `api/sales/trocas` | POST | Anotação de trocas (imprime no cupom) | sessão; próprio/admin |
| `api/estoque/movimentos` | GET, POST | Kardex (108); POST → RPC `registrar_movimento_estoque` | sessão admin/secretário |
| `api/secretario/estoque` | POST | Whitelist: só `products.estoque_principal` (secretário não mexe em preço) | sessão SECRETARIO/ADMIN |
| `api/cargas` | POST | Carga da van MODO `COM_NF|SEM_NF` (APLICAR/PENDENTE) | sessão admin |
| `api/cargas/aceitar` | POST | Vendedor aceita carga pendente (RPC `aceitar_carga_vendedor`); bloqueia carga zerada | sessão (carga do próprio) |
| `api/admin/lucro-rotas` | GET | Lucro por rota do mês (faturamento − custo congelado) | admin |
| `api/vendedor/lucro-rota` | GET, POST, DELETE | Lucro da própria rota + despesas (`seller_expenses`) | sessão (própria) |

### Clientes / portais
| Rota | Métodos | O que faz | Guard |
|---|---|---|---|
| `api/cliente/[codigo]` | GET | Portal do cliente: extrato por `portal_code` (credencial do link); sugestões RPC `get_sugestoes_cliente` | **anon** (portal_code) |
| `api/cliente/[codigo]/catalogo` | GET | Catálogo pedido online (estoque central, bloqueio por débito) | anon |
| `api/cliente/[codigo]/pedido` | POST | Pedido online → PRE_VENDA na fila; vendedor = rota do cliente; mínimo R$200 | anon |
| `api/cliente/[codigo]/pix` | POST | BR Code do saldo devedor (txid único, valor embutido) | anon |
| `api/cliente/[codigo]/comprovante` | POST | Cliente envia foto comprovante Pix → PENDENTE | anon |
| `api/clientes/excluir` | POST | Com vendas → desativa | admin |
| `api/clientes/contato` | POST | Telefone/pin localização/endereço (72) | sessão |
| `api/comprovantes` (+`/foto`, `/revisar`) | GET/POST | Revisão: CONFIRMAR baixa `valor_pago`+`PAGO`; REJEITAR guarda motivo | admin |
| `api/cnpj` | GET | Autocomplete Receita (BrasilAPI→Minha Receita→OpenCNPJ), cache 24h | sessão |
| `api/ean` | GET | Autocomplete GTIN (GoUp→Cosmos→Open Food Facts) | sessão |

### Caixa
| Rota | Métodos | O que faz | Guard |
|---|---|---|---|
| `api/caixa` | GET, POST | GET: ledger aberto (fechamento_id null E (metodo != BOLETO OU pago_em null); fallback se coluna pago_em não existe) + histórico. POST `REGISTRAR` (só David, origem VENDA/ENTREGA/AJUSTE), `EXCLUIR` (admin/secretário, linha aberta → 409 se fechada), `FECHAR` (**só admin**: trava só À VISTA `neq metodo BOLETO`, snapshot `caixa_fechamentos_geral`, resposta com `boletosPendentes`) | sessão; FECHAR admin |
| `api/caixa/fechamento` | GET | Detalhe de fechamento (jsonb `pagamentos`) | sessão |
| `api/caixa/foto` | GET | Comprovante (URL assinada 1h ou dataURL) | sessão |

### Fiscal
| Rota | Métodos | O que faz | Guard |
|---|---|---|---|
| `api/notas` | GET, POST | Focus v2 flat `EMITIR/CONSULTAR/CANCELAR` (cancelar admin, prazo SEFAZ + cascata 147); NFC-e anônima = preço cupom | sessão; próprio/admin |
| `api/notas/cupom` | GET | Cupom fiscal 80mm a partir do **XML autorizado** (fonte `XML` obrigatória) | sessão |
| `api/notas-admin` | GET, POST | Portal `/notas`: `AUTH` (PIN bcrypt dos ADMINs ativos), `EDITAR`, `CLONAR`, `CANCELAR_AVULSA` | AUTH=PIN; resto admin |
| `api/notas-sync` | GET | Cron `0 12 * * *`: reconsulta Focus para EMITINDO (máx 15/rodada) | `Bearer CRON_SECRET` ou admin |
| `api/notas-arquivo` | GET | PDF/XML do bucket `notas-fiscais` (token aceito na query para links `<a>` — bloco 142) | sessão (vendedor só próprias) |
| `api/notas-compartilhar` | GET | DANFE/XML por **token HMAC** (WhatsApp; expira 7d) | token `shareLinks` |
| `api/notas-importar` | POST | `IMPORTAR` (lotes 6), `AVULSAS` (BACKUPS mensais Focus primeiro — 142; máscara de token no erro), `XML_LOTE` | admin |
| `api/focus/webhook` | GET, POST | Valida `x-dm-token`, 200 imediato, processa em `after()` reconsultando a Focus; nota sem venda → importa AVULSA (142) | header segredo |
| `api/spedy` | GET, POST | TESTAR/SINCRONIZAR/IMPORTAR_INBOUND/ENVIAR_CERTIFICADO | admin |
| `api/spedy/webhook` | POST, GET | Standard Webhooks (webhook-id/timestamp/signature), dedup por id; sem `SPEDY_ENABLED=1` só armazena | assinatura HMAC |
| `api/produtos-fiscal` | GET, PATCH | Portal `/fiscal-produtos`: planilha NCM/CEST/CFOP/EAN; PATCH valida SEFAZ (NCM 8, CEST 7, CFOP 4 saída 5/6/7, GTIN 8-14, unidade ≤6, origem 0..8); vazio = null | admin (sessão portal fiscal) |
| `api/xml-importacao` (+`/itens`) | GET, POST | Importa XML compra (dedup chave 44d); fila VINCULAR/CRIAR/IGNORAR/REABRIR/ENTRADA_ESTOQUE (RPC kardex)/ENTRADA_LOTE | admin |
| `api/diagnostico-banco` | GET | Lê OpenAPI PostgREST; confere blocos SQL + backups mensais da conta | admin/secretário |

### Boletos / Pix / comissões / config / infra
| Rota | Métodos | O que faz | Guard |
|---|---|---|---|
| `api/boletos` | GET, POST | Inter Cobrança V3: `EMITIR` (pagador do cliente, CEP obrigatório, min R$2,50, atrelar NF com **fallback SEM notaFiscal** — 151), `CONSULTAR`, `PDF` (pdfBase64), `CANCELAR` (admin; nota cancelada → `finalizarVendaCancelada` 147) | sessão; próprio/admin; CANCELAR admin |
| `api/boletos-sync` | GET | Cron `0 10 * * *` (145/167): reconsulta até 15 cobranças; baixa RECEBIDO→PAGO; comissão A_RECEBER→DISPONIVEL | `Bearer CRON_SECRET` ou admin |
| `api/webhooks/inter` | GET, POST | **Webhook pagamento Inter**: reconsulta a cobrança (mTLS, nunca confiar no payload), baixa `valor_pago=valor_total`+`PAGO`, persiste TODO evento em `webhook_logs`, 200 sempre; baixa no caixa via trigger SQL | público (segurança = re-consulta) |
| `api/webhooks/inter-log` | GET | Últimos 60 eventos do webhook (167) | admin/secretário |
| `api/pix/venda` | GET | BR Code com valor para o PDV (chave `app_settings.pix_chave_entrega` ou env `PIX_KEY`) | sessão |
| `api/comissoes` | GET, POST | `PAGAR` (FIFO por valor_pago), `RECIBO` (aceite), GET saldo | sessão; PAGAR admin |
| `api/configuracoes` | GET, POST | Status Focus/Inter/webhooks, `erp_config`, `INSTALAR_WEBHOOK`/`REMOVER_WEBHOOK` (Focus `/v2/hooks` — gatilhos OFICIAIS do enum: `nfe` + `nfce_contingencia`; `nfce` NÃO existe no enum — 150b) | admin |
| `api/configuracoes/qr-catalogo` | GET | Flag `qrCatalogoNoCupom` (default LIGADO) | sessão |
| `api/admin/catalogo` (+`/foto`) | GET, POST | Portal catálogo; upload foto → bucket `product-images` | admin |
| `api/users` | GET, POST, PUT, DELETE | GET **anon** devolve id/nome/perfil/ativo/rota (tela de login); resto admin; PIN → bcrypt | GET anon; resto admin |
| `api/login` | POST | `{userId, pin}` → bcrypt + rate limit 8/10min → token HMAC | público |
| `api/location` | POST, GET | Última localização (`user_locations`); GET `?all=1` admin | sessão; GET admin |
| `api/daily-route` | GET, POST | Rota do dia do vendedor (servidor é fonte da verdade — 87) | sessão |
| `api/send-push` | POST | Web-push VAPID para todos (`push_tokens`) — público (risco conhecido) | público |
| `api/e2e-supabase/[...path]` | GET/POST/PATCH/DELETE | Mock PostgREST para E2E local (`NEXT_PUBLIC_E2E_MOCK=1`) | flag env |
| `api` | GET | Health check `{"message":"Hello, world!"}` | público |

## 3. src/lib/ (48 arquivos — os críticos)

**Infra**: `supabase-config.ts` (URL + anon key hardcoded) · `supabaseClient.ts` (anon, browser) · `serverSupabase.ts` (service_role + devBridge) · `session.ts` (HMAC, TTL 7d) · `serverSchema.ts` (20+ sondas `hasXxxColumn`, cache 30s — DEGRADE queries em bancos antigos!) · `supabaseAll.ts` (`fetchAllPages` anti-corte 1000 linhas) · `types.ts` (PaymentMethod = DINHEIRO|PIX|A_PRAZO; ReceiveMethod +BOLETO,DEPOSITO) · `erpConfig.ts` (jsonb switches: nfeAutoPe, cupomDuploNfc, boletoAutoAReceber, qrCatalogoNoCupom, boletoMensagemPadrao, emitente) · `shareLinks.ts` (token HMAC 7d).

**Regras**: `equipe.ts` (DAVID_USER_ID + isDavidNome `/^(david|deivid)/i` + isDavidVendedor) · `caixaLedger.ts` (registrarPagamentoCaixa idempotente; CaixaMetodo DINHEIRO|PIX|DEPOSITO|BOLETO; CaixaOrigem VENDA|ENTREGA|RECEBIMENTO|PORTAL|AJUSTE; trigger SQL é a fonte principal) · `comissaoPv.ts` (PE 10% / PV 5% por produto) · `contaAReceber.ts` (ehContaAReceber = ENTREGUE/PRONTA não PAGO) · `regras-fiscais.ts` (`FISCAL_OBRIGATORIO=false` armado-desligado; prazoCancelamentoNota NFC-e 30min/NF-e 24h; cargaBloqueadaPorNota) · `cascataCancelamento.ts` (arquivarNotaDaVenda; finalizarVendaCancelada) · `regraClienteGB.ts` (ROTAS_CLIENTE_GB = ROTA_03/ROTA_04) · `trocasTexto.ts` · `validaDoc.ts` (CPF/CNPJ módulo 11) · `pix.ts` (BR Code EMV QRCPS-MPM + CRC16; PIX_KEY default CPF 01735712043, PIX_NAME DOCE MANIA, PIX_CITY SAO PAULO) · `pushSender.ts` (VAPID).

**Fiscal**: `focusNfe.ts` (v2 flat, emitente por env sobrescrito por erp_config) · `focusXml.ts` (parser XML autorizado) · `focusArquivos.ts` (bucket notas-fiscais + backups mensais `/v2/backups/{cnpj}`) · `notasArquivo.ts` (resposta única p/ arquivo+compartilhar) · `xmlCompra.ts` (parser NF-e compra, matching EAN→cProd→Jaccard ≥0.55) · `xmlNotas.ts` (XML saída terceiros) · `spedy.ts` (dormant).

**Banco**: `interBoleto.ts` (OAuth2 + mTLS; POST /cobranca/v3/cobrancas; token cacheado 55min; base cdpj.partners.bancointer.com.br; seuNumero `DM<saleId>`, reemissão sufixo `-r2`).

**Impressão**: ver references/impressao-fiscal.md.

**Autocomplete**: `cnpjAutocomplete.ts`, `eanAutocomplete.ts`, `endereco.ts` (ViaCEP + Nominatim — nunca sobrescrever o que o usuário digitou).

## 4. Banco de dados (schema real)

### Tabelas (schema public)
- **app_users**: id, nome, email, perfil, ativo, telefone, whatsapp, foto, placa_veiculo, rota (default ROTA_01), rota2, pin_hash (bcrypt), pre_venda, criado_em
- **clients**: nome_fantasia, nome, ativar_cnpj, cnpj, telefone, endereco, bairro, ativo, localizacao, dia_roteiro, ordem, observacoes, pin_localizacao, rota, portal_code (único), razao_social, endereco_numero/cep/municipio/uf, email, cliente_especial_gb, modo_cupom, criado_em
- **products**: nome, preco_custo, preco_venda, preco_minimo, comissao_percentual (PE 10), comissao_pv_percentual (PV 5), estoque_principal, estoque_van (legado), ativo, category_id, subcategory_id, ncm, cest, cfop, ean, unidade, origem, codigo (único parcial), codigo_especial_gb, preco_especial_gb, preco_cupom, imagem, unidades_por_caixa, obs, familia_catalogo, estoque_nota, estoque_semnf, produto_teste, csosn, unidade_fiscal, peso_kg, st_entrada, cfop_padrao, spedy_product_id
- **sales** (coração): vendedor_id, client_id, valor_total, valor_pago, metodo_pagamento (default DINHEIRO), detalhe_pagamento, status_pagamento (PENDENTE|PAGO|PARCIAL), status, data_venda, data_vencimento, comprovante_foto, tipo_venda (PRONTA|PRE_VENDA), entrega_status (PENDENTE|EM_ROTA|ENTREGUE|FALHOU), entrega_seq, estoque_baixado, route_id, nota_status (EMITINDO|AUTORIZADA|REJEITADA|CANCELADA), nota_tipo (NFE|NFCE), nota_numero, nota_ref, nota_pdf_url, nota_xml_url, nota_erro, nota_chave, nota_emitida_em, trocas, trocas_valor, prioridade, separado, separado_em, entregador_id, ordem_entrega, modo_nota (NFE|NFCE|CUPOM), carga_confirmada_em/por + inter_boleto_status (NAO_GERADO|EM_PROCESSAMENTO|A_RECEBER|RECEBIDO|ATRASADO|CANCELADO|EXPIRADO|FALHA_EMISSAO|MARCADO_RECEBIDO|PROTESTO), inter_boleto_codigo, inter_boleto_seu_numero, inter_boleto_linha, inter_boleto_barras, inter_boleto_pix, inter_boleto_vencimento, inter_boleto_valor, inter_boleto_erro, inter_boleto_em
- **sale_items**: sale_id, produto_id (+ product_id legado), quantidade, **precovenda** (SEM underscore!), custo_unitario (congelado)
- **commissions**: sale_id, seller_id, valor_comissao, valor_base, percentual, status (A_RECEBER|DISPONIVEL|PAGO), valor_pago — atenção: código usa `.eq('vendedor_id')` em pontos e seller_id no SQL
- **commission_payment_logs**: seller_id, valor_pago, aceitado, aceite_em
- **seller_expenses**, **cargas** (vendedor_id, produto_id, quantidade, modo_nota), **cargas_pendentes** (itens jsonb, status, modo_nota)
- **app_settings** (linha global_settings): logo, margens, pix1/pix2, pix_chave, pix_chave_entrega, product_order/client_order/catalogo_order, company_name/cnpj, melhor_*, erp_config jsonb
- **app_config** (chave/valor: comissao_pre_venda_pct='50'), **system_messages**
- **product_categories/product_subcategories**
- **payment_comprovantes**: sale_id, client_id, valor, txid, foto (Storage), status (PENDENTE|CONFIRMADO|REJEITADO), review_note, reviewed_at
- **entrega_rotas** (vendedor_id, data, status GERADA|EM_ROTA|CONCLUIDA, total_paradas, unique(vendedor,data)) · **entrega_eventos** (route_id, sale_id, user_id, status, motivo, foto, lat, lng)
- **caixa_fechamentos** (por entregador, bloco 13) · **caixa_fechamentos_geral** (118: janela_inicio, fechado_em/por, total_dinheiro/pix/deposito/geral, qtde_pagamentos, pagamentos jsonb)
- **caixa_pagamentos** (ledger): origem, sale_id, cliente, vendedor, metodo (DINHEIRO|PIX|DEPOSITO|BOLETO), valor, comprovante, detalhe, usuario_id/nome, fechamento_id (null=aberto), **pago_em** (167)
- **webhook_logs** (167): origem (INTER), evento jsonb, codigo, seu_numero, sale_id, resultado, processado — RLS fechada
- **daily_routes**, **push_tokens**, **user_locations**
- **xml_importacoes** (chave 44d única) + **xml_itens** (c_prod/c_ean/x_prod/ncm/cest/cfop/unidade/quantidade/valor_unitario, produto_id, status PENDENTE|VINCULADO|CRIADO|IGNORADO, entrada_estoque_em)
- **spedy_webhook_events** + **notas_recebidas**
- **estoque_movimentos** (kardex): produto_id, tipo (ENTRADA|SAIDA|AJUSTE|ESTORNO), origem (VENDA|MANUAL|XML|CARGA), referencia, quantidade, custo_unitario, saldo_apos

### Triggers (fontes de verdade)
| Trigger | Tabela | Efeito |
|---|---|---|
| `trg_pre_venda_estorna_item/venda` | sale_items/sales | Devolve estoque ao excluir (respeita modo_nota) |
| `trg_pre_venda_atualiza_rota` | sales | Reconta total_paradas |
| `setar_custo_unitario_venda` (80) | sale_items | Congela custo_unitario BEFORE INSERT |
| `trg_kardex_sale_items` (108) | sale_items | Grava SAIDA/ESTORNO no kardex |
| `trg_comissoes_skip_david` (118) | commissions | Anula comissão do David (BEFORE INSERT) |
| `trg_caixa_david_sales` (165→166→167 v2) | sales | Venda do David (ID 7c989927 OU nome david|deivid): DINHEIRO/PIX PAGO → insere no caixa; A_PRAZO → BOLETO pendente; idempotente olhando TODAS as linhas da venda (fechadas ou não — fix 167) |
| `trg_baixa_boleto_caixa` (167) | sales | Venda → PAGO: `pago_em=now()` na linha BOLETO; boleto CANCELADO: apaga linha pendente |

### RPCs
`processar_venda_v2` (venda pronta + baixa da VAN), `excluir_venda_estornar_estoque`, `apply_carga_admin`, `aceitar_carga_vendedor`, `baixar_estoque_principal` (respeita modo_nota), `registrar_movimento_estoque` (kardex atômico), `get_sugestoes_cliente`, `clean_old_push_tokens`.

### RLS e Storage
- **Policy `anon_full_access`** (using true) nas tabelas que o browser usa direto: app_users, clients, products, sales, sale_items, commissions, commission_payment_logs, seller_expenses, cargas, cargas_pendentes, app_settings, app_config, system_messages, product_categories/subcategories, payment_comprovantes, push_tokens.
- **RLS fechada** (sem policy; service_role only): entrega_rotas/eventos, caixa_*, daily_routes, user_locations, xml_*, spedy_webhook_events, notas_recebidas, estoque_movimentos, **webhook_logs**.
- **Buckets**: `product-images` (público) · `notas-fiscais`, `comprovantes`, `fotos-pedidos` (privados, URL assinada 1h; caminhos NFE/{ref}.pdf|.xml|-can.xml).
- Seed: admin pin_hash crypt('123456') só se tabela vazia.
- **SQL consolidado**: `supabase/00-SETUP-COMPLETO-SUPABASE.sql` + `sql/bloco*.sql` (35+ arquivos, idempotentes).

## 5. Infra
- **Vercel crons** (vercel.json, UTC): `/api/notas-sync` `0 12 * * *` (09h BRT), `/api/boletos-sync` `0 10 * * *` (07h BRT). Hobby = só diário.
- **Headers**: X-Frame-Options ALLOWALL (embeds), nosniff, XSS-Protection.
- **PWA**: public/manifest.json + sw.js.
- **Sessão**: token HMAC `base64url(payload).base64url(sig)`, `{sub, perfil, exp}`, segredo = SESSION_SECRET ou derivado da service key; localStorage `dm_session_token`; portais fiscais usam `dm_notas_admin_token`.
