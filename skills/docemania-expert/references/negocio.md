# REGRAS DE NEGÓCIO DOCEMANIA (consolidadas dos blocos, com origem)

Regras ditas pelo dono ao longo de 167 blocos. Se uma tarefa contradiz qualquer regra daqui, a regra vence — ou o dono a revoga explicitamente (e então marque "(revogada no bloco N)" aqui).

## 1. Caixa (blocos 118 → 118.3 → 124 → 165 → 166 → 167)

- **Caixa EXCLUSIVO do vendedor David/Deivid (Rota 5)**. Outros vendedores têm fluxo de comissão e NÃO têm caixa; aba CAIXA só existe para David (vendedor) e admin. (118.3, 119)
- **Entra no caixa aberto**: dinheiro e Pix À VISTA com `status_pagamento=PAGO` + vendas A_PRAZO dele como linha **BOLETO pendente** ("dinheiro, pix e boletos"). (118.3 + 165/167)
- **NÃO entra**: recebimento de contas a receber de outros, Pix/comprovante do portal do cliente (origem RECEBIMENTO/PORTAL → recusados com 400), vendas de outros vendedores. (118.3)
- **A linha BOLETO só baixa quando o pagamento a prazo ocorrer** — venda vira PAGO por qualquer caminho (webhook Inter, cron boletos-sync, recebimento manual, comprovante portal) → trigger `trg_baixa_boleto_caixa` grava `pago_em` e some da lista aberta. Boleto CANCELADO → linha pendente apagada. (167)
- **Fechamento**: EXCLUSIVO do admin, a qualquer momento ("o caixa deve sempre atualizar e deverá ser fechado somente pelo admin"); ao fechar zera e recomeça; **trava somente o à vista** — boleto pendente sobrevive ao fechamento. Snapshot completo em `caixa_fechamentos_geral` (linhas ganham fechamento_id e viram imutáveis 409). (118, 167)
- **Sempre atualiza**: polling 20s + refresh em visibilitychange no CaixaFechamento. (167)
- **Fonte de verdade = trigger SQL**, não o POST client-side (401 silencioso já causou caixa zerado — 165). POST `/api/caixa REGISTRAR` é defesa redundante (só David; 400 para a prazo de OUTRO vendedor; 403 "Caixa é exclusivo do vendedor David").
- **Lixeira** no caixa ABERTO: admin/secretário; linha presa em fechamento é imutável (409); excluir do caixa NÃO toca a venda. (124; uuid inválido = 400 — 124.1)
- **POSTO MODELO II** (sale `d6485c79-9440-4cef-9439-f1dc50a17346`) excluído do caixa pelo dono — nunca recriar. (124)
- Caixa não zera por dia desde o bloco 57; caixa por entregador (janela desde o último fechamento DELE) desde o 96 — separado do caixa geral do David.
- **Diagnóstico de "caixa zerado"** (lição 165/166, nesta ordem): (1) SQL pendente? `/api/diagnostico-banco` + perguntar ao dono; (2) renome do vendedor? casar por ID `7c989927-a148-479c-bf00-11f35bfa66b0`; (3) 401/403 silencioso em POST? mover para trigger; (4) `[]` por RLS? ler com service_role.

## 2. Comissões (blocos 14/23/90/91/98/118/166)

- **Comissão do David/Deivid DESATIVADA em todas as camadas**: trigger `trg_comissoes_skip_david` descarta insert + `registrarComissaoPreVenda` pula (por ID primeiro!) + Financeiro oculto no app dele + `/api/comissoes PAGAR` 403. (118, 166)
- Vendedor que **entrega a própria venda** ganha comissão de PRONTA ENTREGA (percentual do produto). (98)
- **Percentuais**: pronta entrega default 10% (`comissao_percentual` por produto), pré-venda default 5% (`comissao_pv_percentual`). Regra única em `src/lib/comissaoPv.ts`. (14/23)
- Comissão de pré-venda **só nasce na entrega** (ENTREGUE → registrarComissaoPreVenda); nasce `A_RECEBER` quando a venda não quitou; vira `DISPONIVEL` quando `PAGO` (inclusive via boletos-sync). 
- **A_RECEBER é intocável** — SQL de zeragem só tocou PAGO/DISPONIVEL: "não pode se perder de jeito nenhum". (90)
- Repasses: FIFO por valor_pago em `/api/comissoes PAGAR`; recibo com aceite (`commission_payment_logs.aceitado/aceite_em`). Histórico limpo por SQL quando o pagamento passou a ser pelo app. (91)

## 3. Entregas / fila (blocos 13/61/96/97/98/99/113/114/119/119.1/119.2/120.1/126)

- **Fila contínua** (sem "fechar dia"); ordem: **P1 vermelho topo → P2 âmbar → antiguidade**; admin reordena arrastando (dnd-kit) e define prioridade. (13/61/99)
- **Só recebe entrega CARREGADA NO SEU NOME**: cálculo `minhaCarga`/`donoRecebimento` NO SERVIDOR (403 com nome de quem tem a carga). (119/119.2)
- **Vendedor**: exige `carga_confirmada_em` + `entregador_id` = ele (120.1); **Entregador**: recebe tudo carregado no nome dele (119.2); as demais aparecem para conferência SEM botões (119).
- **Quem define o entregador é o admin**; DESALOCAR admin-only (99); secretário carrega/descarrega mas não recebe nem desaloca (114/99). Vendedores são os entregadores (97) — login fixo `userId='ENTREGADOR'` (PIN 1234) só existe se não houver usuário real (revelado por 5 toques no logo).
- **ENTREGUE**: DINHEIRO com troco; **foto obrigatória** em PIX/BOLETO/a-prazo sem pagamento; MISTO soma dinheiro+pix; "JÁ PAGO"/"NÃO COBROU" existem. **FALHOU**: motivos fixos (Cliente ausente/Recusou/Endereço errado/Loja fechada/Outro) + REABRIR. (13/40/98)
- Efeitos do ENTREGUE: entrega_status=ENTREGUE, baixa/parcial do pagamento + log em `detalhe_pagamento`, `metodo_pagamento` correto respeitando CHECK (BOLETO grava A_PRAZO), comissão gerada, caixa do David, baixa estoque idempotente, evento com GPS+foto, push ao vendedor.
- **NUNCA cortar nomes de clientes** — break-words; card 100% visível/clicável. (126)
- Cupom é a base da SEPARAÇÃO — secretário vê cupom idêntico ao do vendedor, alarme em pedido novo, SEPARADO, EDITAR_PEDIDO. (13/113)

## 4. Pré-venda × pronta entrega (blocos 39/40/88/100/122/152/153)

- **Pré-venda só tira o pedido**: à vista = entregador cobra na entrega; a prazo = vendedor cobra depois (data/vencimento). Não emite nota na hora — admin bate a nota na fila (109). (39/109)
- **Reserva de estoque no registro** (`estoque_baixado` guard idempotente). (88)
- Pré-venda só efetiva nos relatórios quando ENTREGUE; `data_venda` passa a ser a data da entrega.
- **Pronta entrega**: cupom de CONFERÊNCIA antes de finalizar (100/122); **à vista nasce PAGO** (152); caixa à vista aparece DEPOIS da emissão da nota (153); boleto do prazo gerado MAIS TARDE com a data combinada (153); à vista = entregador cobra? NÃO — pronta entrega é paga na hora (dinheiro/pix/misto).
- Fluxo do PDV em **8 telas lineares com seta voltar** (122): CART → DOC → CONDICAO → FORMA → FINALIZAR/SUCESSO (+ PRE_PEDIDO_PREVIEW).
- Anti-duplicação em 3 camadas (41).

## 5. Fiscal (blocos 108/116/123/128/129/130/137/138/144/151/152/154/155/160)

- **NFC-e ANÔNIMA sai no PREÇO CUPOM** (`products.preco_cupom` > 0 → senão custo → senão preço venda); venda real não muda; vale para TODA emissão anônima. Cupom físico e NFC identificada saem no preço digitado. (108/137)
- NFC-e identificada leva destinatário/endereço/cidade do cadastro (128/129). NF-e exige CNPJ + email (77/140). Cadastro **sem CPF, só CNPJ** (138).
- **CSOSN segue o destinatário**: contribuinte com IE → 101; não contribuinte/CPF/ISENTO → 102; NFC-e sempre 102. (160)
- **GTIN tributável obrigatório** quando há cEAN. (130)
- **Cancelamento**: NFC-e 30min / NF-e 24h após autorização; botão some fora do prazo; validado no servidor; justificativa ≥15 chars. (144)
- **Cupom fiscal 80mm fiel ao XML autorizado** — sem XML não imprime fiscal. (131/151)
- **Nota sobrevive à exclusão da venda** (congelada como avulsa em 3 caminhos + reconstituirOrfas + botão Buscar TODAS). (154) **Exclusão de venda SÓ ADMIN.** (154)
- **FISCAL_OBRIGATORIO=false** (armado, desligado) — quando ligar: pronta entrega exige NF/NFC + boleto antes de concluir; carga bloqueada sem nota. (123)
- Notas do painel da Focus entram pelo BACKUP mensal + webhook; NFC-e do painel não tem consulta por chave (404) — arquiva direto do ZIP. (142)
- CSC/IdCSC (SEFAZ-RS) pendente para NFC-e autorizar de vez. (116/130)

## 6. Clientes / preços / catálogo (blocos 70/71/73/73b/89/126/127/129/138/153/157)

- **Cliente ESPECIAL GB** só nas Rotas 3 (Edipo) e 4 (Gil); PDV de cliente GB mostra só produtos com **Preço GB > 0**; GB não tem preço mínimo (piso = preço GB); **Código Especial GB sobe na NF** do cliente GB. (70/71/73/73b/157)
- **CEP obrigatório** no cadastro (boleto Inter exige); cidade/CEP/UF preenchem sozinhos (ViaCEP/GPS); **nunca sobrescrever o que o usuário digitou**. (129/153)
- QR do catálogo no cupom com switch admin (`erp_config.qrCatalogoNoCupom`, default LIGADO). (127)
- Catálogo = espelho do estoque central, agrupado por família; **"em hipótese alguma mexa na ordem que aparece no PDV"**. (89)
- Trocas com VALOR DE CUSTO (não venda). (98/100)

## 7. Estoque / carga (blocos 75/80/88/95/95.1/108/108.1)

- **ESTOQUE CENTRAL ÚNICO (Bloco 217)**: existe UM só saldo — `products.estoque_principal` — que abastece a VAN (pronta entrega) e o próprio CENTRAL (pré-venda). A regra de ESTOQUE 1/ESTOQUE 2 (contadores `estoque_nota`/`estoque_semnf` dos blocos 29/75) foi REMOVIDA: colunas dropadas e RPCs (baixa/estorno da pré-venda) baixam sempre o central. `sales.modo_nota` continua — é o DOCUMENTO da venda (NFE/NFCE/CUPOM), não estoque. (217)
- **Custo congelado no momento da venda** ("SEMPRE VALE O PREÇO DE CUSTO NO MOMENTO DA VENDA") — trigger `setar_custo_unitario_venda`; lucro por rota usa custo congelado. (80/79)
- Kardex completo (`estoque_movimentos`) com RPC atômico; EXCEPTION swallow ("kardex NUNCA quebra venda"). (108)
- Carga da van: SEM modo (Bloco 217 removeu COM_NF/SEM_NF) — sai do estoque central, delta van × casa no servidor (`/api/cargas` APLICAR/PENDENTE); aceite do vendedor bloqueia carga zerada; ENTRADA_LOTE idempotente. (95.1/108/217)
- Estoque negativo: RPCs sem conferência de saldo (análise bloco 70) — proposta GREATEST(0,...)+CHECK aguardando autorização; NÃO implementar sem o dono aprovar.

## 8. Configurações (bloco 167)

Aba SETTINGS em **4 sub-abas**: **GERAL** (Dados da Empresa, Logo) · **PAGAMENTOS** (Pix 1/2 + QR + chave do recebimento `pixChave` — valida CPF/CNPJ/telefone/email/aleatória; default CPF 017.357.120-43) · **SISTEMA** (Margem Global 35%, preço mínimo, melhorias liga/desliga: Trocas na separação, Avisar vendedor, Zap cliente, Bairro em destaque, Foto entrega) · **INTEGRAÇÕES** (atalhos Catálogo Portal / ERP Fiscal / Kardex).
Hub **ERP Fiscal** (`ConfiguracoesHub.tsx`): Focus NFe (status, emitente, nfeAutoPe, cupomDuploNfc, webhook instalado) · Boletos Inter (status, boletoAutoAReceber, mensagem padrão linha2 máx 78 chars, LOG do webhook + passo a passo de ativação) · QR catálogo no cupom · Impressão (reforço, ModelosImpressao).
Persistência: `app_settings` via `appSettingsService` (lado ERP em `erp_config` jsonb via `/api/configuracoes`).

## 9. Login / perfis (blocos 5/13/19/97/119.2/140)

- Perfis: ADMIN (tudo), VENDEDOR (dashboard próprio), ENTREGADOR (FilaEntregas modo ENTREGADOR, salário fixo), SECRETARIO (Separação + Estoque).
- Login por usuário + PIN (4-8 dígitos) validado no servidor (bcrypt + rate limit 8/10min). Acessos fixos ENTREGADOR/SECRETARIO (PIN 1234) revelados por **5 toques no logo** e somem se existir usuário real desses perfis.
- Portal fiscal `/notas`, `/fiscal-produtos`, `/entradas`: PIN do admin contra TODOS os ADMINs ativos → token compartilhado entre os 3 portais.
- Portal do cliente: sem PIN — credencial é o `portal_code` de 12 chars no link.
