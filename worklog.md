# Worklog - DOCE MANIA App

---
Task ID: 1
Agent: main
Task: Implementar impressao Bluetooth nativa via Web Bluetooth API para Android APK

Work Log:
- Analisou implementacao atual: Cupom.tsx (geracao de texto para cupom), printerService.ts (mock com logs, sem impressao real)
- Criou `/src/services/bluetoothPrinterService.ts` - servico completo de impressao Bluetooth:
  - Web Bluetooth API para descoberta e conexao nativa de impressoras
  - Codificacao CP860 (Portugues) para acentuacao correta
  - Comandos ESC/POS (init, align, bold, feed, cut)
  - Suporte a impressoras 56mm (32 colunas) e 80mm (48 colunas)
  - Reconexao automatica a ultima impressora usada (salva em localStorage)
  - Envio em chunks de 100 bytes com retry
  - Barra de progresso de impressao
- Atualizou `Cupom.tsx`:
  - Importacao do novo servico bluetoothPrinter
  - Barra de status Bluetooth (conectado/desconectado/buscanco/imprimindo)
  - Confirmacao nativa `window.confirm()` antes de imprimir
  - Alertas nativos `window.alert()` para erros
  - Barra de progresso de impressao
  - Botao imprimir com loading state
  - Botao desconectar impressora
- Atualizou `PDV.tsx`:
  - Substituiu import de printerService por bluetoothPrinter
  - Confirmacao nativa antes de imprimir pre-pedidos
- Verificou que nao ha outras referencias a printerService no codebase
- Build passou limpo sem erros

Stage Summary:
- Servico de impressao Bluetooth nativo criado em `/src/services/bluetoothPrinterService.ts`
- Cupom.tsx e PDV.tsx atualizados com confirmacoes nativas e integracao Bluetooth
- Suporte a 56mm e 80mm mantido e funcional
- App compilando e rodando corretamente
---
Task ID: 36
Agent: Z.ai Code (sessão principal)
Task: 4 fixes do teste da Rota 2 (reportados pelo dono): (1) WhatsApp preenchido mas tela continua dizendo cadastro incompleto; (2) sem seta pra voltar na tela das informações (fica preso); (3) cliente com CNPJ → abrir opção de CNPJ nota; (4) dados do cliente organizados na parte de baixo do cupom.

Work Log:
- Causa raiz do (1) provada: handleSaveClientInfo fazia setModoSheet(clientInfoModal) com o objeto ANTIGO (sem GPS/WhatsApp recém-salvos) → a tela do modo recalculava "incompleto" com dados velhos. FIX: snapshot atualizado {...clientInfoModal, ...updates} + a tela do modo resolve o client mais recente da lista (clients.find) na render (dupla proteção).
- UX do modal: WhatsApp ganhou máscara progressiva BR ((54) 99999-9999), chip de status EM TEMPO REAL (Localização ok/pendente · WhatsApp ok/pendente — verde quando ok), check no input e mensagens de erro que ensinam o formato ("Digite com DDD — ex: 54 99999-9999").
- FIX (2): modal de informações ganhou seta ← no header + botão Voltar; clientInfoFromModoRef devolve para a tela do modo quando aberto por ela ("Completar cadastro agora") ou fecha na rota. Painel CNPJ nota e painel NFC-e também ganharam Voltar.
- FEATURE (3): botão NF-e virou "CNPJ nota" (violeta, habilitado) para cliente com CNPJ (14 dígitos) e ABRIR painel de confirmação com CNPJ mascarado + razão social + endereço fiscal (nº, bairro, município/UF). Apto (clienteAptoNfe) = botão verde CONFIRMAR NF-e → PDV selo NF-e ESTOQUE 1. Incompleto = "Falta: razão social, município, UF" + COMPLETAR DADOS FISCAIS (abre editor do cliente). Sem CNPJ segue bloqueado (toast). Painel usa client mais recente (edição reflete na hora).
- FEATURE (4): seção DADOS DO CLIENTE no gerador compartilhado do cupom (cupomTexto.ts) na parte de baixo: Nome, End (rua, nº — bairro; NUNCA lat/lng), WhatsApp formatado, CNPJ mascarado + razão social, CPF da NFC-e (extraído do detalhePagamento "COM NOTA: NFC-e (CPF ...)"); quebra de linha correta em 56mm/80mm; seção some se não há nenhum dado.
- Mock E2E: cli-3 Mercado CNPJ (apto), cli-4 Lanchonete CNPJ2 (fiscal incompleto), cli-5 Acougue Sem Tel (GPS sem telefone '0') + dia_roteiro dinâmico (new Date().getDay()) — fim do ajuste manual por dia.
- E2E Agent Browser (iPhone14, rota2user): máscara + chips em tempo real; Salvar e Atender → modo com "Rua Quarta 101 — Fiorita" + "(54) 99765-4321" e card completo (sem âmbar); seta Voltar fechou modal na rota; CNPJ nota do Mercado → painel 12.345.678/0001-99 + MERCADO TESTE LTDA + Av Brasil, 500 — Centro — Caxias do Sul/RS → CONFIRMAR NF-e → PDV "NF-e — ESTOQUE 1 (COM NF)"; Lanchonete → "Falta: razão social, município, UF" + COMPLETAR DADOS FISCAIS; cupom do Emporio renderizou DADOS DO CLIENTE no preview; venda pronta finalizou, card cinza (REABRIR); zero erros no console. .env.local removido após o teste.
- QA: lint 0 erros/11 warnings (baseline exata); tsc 7 (baseline, zero novos).
- Commit 52c9e5d; push f9ca340..52c9e5d para docemaniaexpress25/DOCE-MANIA-OFICIAL; token removido do .git/config após o push.

Stage Summary:
- Vendedor não fica mais preso na tela das informações (seta Voltar) e o WhatsApp que ele digita é reconhecido na hora (chip verde + card completo ao voltar).
- Cliente com CNPJ abre o painel de CNPJ nota com os dados do cadastro; fiscal incompleto mostra exatamente o que falta e leva ao editor.
- Cupom (todas as telas) imprime DADOS DO CLIENTE organizados na parte de baixo: nome, endereço rua—bairro, WhatsApp, CNPJ/CPF da nota.
- Deploy Vercel auto (52c9e5d em main).

---
Task ID: 37
Agent: Z.ai Code (sessão principal)
Task: BLOCO 37 — refinamento do rodapé do cupom (pedido do dono): na parte de baixo destacar se é CUPOM / NF-e / NFC-e e a forma de pagamento entre todas as opções; dados do cliente (endereço/WhatsApp) SOMENTE quando for NF-e ou NFC-e (para bater a nota em outro sistema).

Work Log:
- Contexto: Blocos 35/36 (as 7 correções da Rota 2) já estavam implementados, testados e em produção (origin/main ba90667). Este bloco é o refinamento do item 4 do Bloco 36.
- cupomTexto.ts (gerador compartilhado — vendedor/secretário/entregador/admin imprimem igual):
  - Novo tipoDocumentoDeSale(): >>> CUPOM <<< / >>> NF-e <<< / >>> NFC-e <<< — fonte sales.modo_nota (fluxo Rota 2) com fallback no detalhe "COM NOTA: NF-e/NFC-e" (legado) e CUPOM default (fluxo antigo).
  - Nova formaPagamentoDeSale(): forma CONSOLIDADA entre todas as opções — DINHEIRO, PIX, MISTO (Dinheiro+Pix), BOLETO, CHEQUE, PIX NA DATA — + (A VISTA)/(A PRAZO). Cobre: pronta dinheiro/troco, PIX, MISTO, a prazo Boleto/Cheque nº/bom para/Pix na data, pré-venda "cobrar X na entrega (A PRAZO)" (formaCobrancaDeSale agora aceita CHEQUE) e "PAGO NA VISITA pelo vendedor (X)".
  - Bloco destacado no rodapé: linhas de '=' + tipo centralizado + "PAGAMENTO: <forma> (<condicao>)" (com quebra se não couber em 56mm).
  - DADOS DO CLIENTE agora imprimem SOMENTE quando tipoDoc != CUPOM (NF-e/NFC-e): nome, endereço rua—bairro (nunca lat/lng), WhatsApp, CNPJ, razão, CPF da nota — os dados que o dono usa para bater a nota no outro sistema. No cupom não fiscal o rodapé não mostra nada do cliente.
  - Helper quebra() reutilizado: linhas longas (Info: detalhePagamento) quebram na largura do papel — zero estouro de coluna em 56mm (32) e 80mm (48).
- QA: lint 0 erros/11 warnings (baseline exata); tsc 7 erros pré-existentes (baseline, zero novos).
- Teste funcional (bun, scripts temporários removidos): 11 cenários × 56mm/80mm — pronta dinheiro+troco / PIX / MISTO / a prazo CHEQUE / BOLETO / PIX NA DATA, pré-venda "cobrar BOLETO na entrega (A PRAZO)", pré-venda "PAGO NA VISITA (PIX)", NF-e modoNota, NFC-e CPF, legado fallback detalhe — todos com bloco destacado correto e zero estouros.
- E2E Agent Browser (iPhone 14, rota2user, mock E2E): cupom da pré-venda 1 = ">>> CUPOM <<<" + "PAGAMENTO: DINHEIRO (A VISTA)" SEM dados do cliente; cupom da pré-venda 2 = "PAGAMENTO: PIX (A PRAZO)" + Vencimento; venda NF-e real (Mercado CNPJ → PRONTA ENTREGA → CNPJ NOTA → CONFIRMAR NF-E → PDV "NF-E — ESTOQUE 1 (COM NF)" → wizard à vista DINHEIRO) → cupom final no histórico do cliente = ">>> NF-e <<<" + "PAGAMENTO: DINHEIRO (A VISTA)" + DADOS DO CLIENTE (Nome/End/WhatsApp); card do Mercado ficou REABRIR (cinza); zero erros no console. .env.local removido após o teste; dev server reiniciado limpo.
- Commit 66a9eb3; push ba90667..66a9eb3 para docemaniaexpress25/DOCE-MANIA-OFICIAL; token removido do .git/config após o push; deploy Vercel confirmado (HTTP 200, last-modified novo).

Stage Summary:
- Rodapé de TODO cupom (todas as telas) agora termina com bloco destacado: tipo do documento (CUPOM/NF-e/NFC-e) + forma de pagamento consolidada entre todas as opções.
- Dados do cliente no rodapé só saem em NF-e/NFC-e (bater nota); cupom fica limpo.
- Zero estouros de coluna (Info quebra linhas agora).
- Deploy em produção via Vercel (66a9eb3).

---
Task ID: 38
Agent: Z.ai Code (sessão principal)
Task: BLOCO 38 — rodapé do cupom ENXUTO (nova regra do dono: o cupom é a base da SEPARAÇÃO dos itens) + auditoria do deploy.

Work Log:
- cupomTexto.ts: a parte de baixo imprime SOMENTE (1) tipo destacado (>>> CUPOM <<< / >>> NF-e <<< / >>> NFC-e <<<); (2) NF-e → linha "NF-e: <CNPJ do cliente>" (só se o cadastro tiver CNPJ 14 dígitos); (3) NFC-e → linha "CPF: <cpf>" se identificado na nota (detalhePagamento); (4) forma de pagamento destacada (DINHEIRO/PIX/MISTO/BOLETO/CHEQUE/PIX NA DATA) + QUANTOS DIAS no a prazo — "(A PRAZO - 7 DIAS)" (dias = vencimento - data da venda; "(A VISTA)" não mostra dias; prazo sem vencimento mostra só "(A PRAZO)"). REMOVIDO do rodapé: nome, endereço, WhatsApp, razão social e a seção DADOS DO CLIENTE inteira (nome continua no topo do cupom).
- QA: lint 0 erros/11 warnings (baseline exata); tsc 7 (baseline, zero novos).
- Teste funcional (bun, temporários removidos): 10 cenários × 56mm/80mm, zero estouros — NF-e à vista com CNPJ, NF-e prazo 7 dias, NF-e sem CNPJ (sem linha), NFC-e com CPF, NFC-e sem CPF, CUPOM à vista, CUPOM cheque 15 dias, pré-venda prazo 7 dias, pré-venda pago na visita, prazo sem vencimento.
- E2E Agent Browser (iPhone14, rota2user, mock): cupom pré-venda = ">>> CUPOM <<<" + "PAGAMENTO: DINHEIRO (A VISTA)" sem dados do cliente; cupom NF-e = ">>> NF-e <<<" + pagamento, sem dados do cliente; cupom pré-venda a prazo = "PAGAMENTO: PIX (A PRAZO - 7 DIAS)" com quebra correta em 56mm; cards REABRIR (cinza); zero erros no console. .env.local removido; dev server reiniciado limpo.
- Commit bbabf42 + push e830a02..bbabf42; token removido do .git/config.
- AUDITORIA DE DEPLOY (importante p/ próximas sessões): (a) o commit do Bloco 37 (66a9eb3) FALHOU em TODOS os 4 projetos Vercel da conta — nunca chegou à produção; o last-modified 21:48 que eu tinha confirmado era o deploy do Bloco 36. Sem impacto: o Bloco 38 substitui o rodapé do 37 (regra final do dono) e buildou com sucesso. Falha provável: concorrência de fila no plano free (4 projetos buildando o mesmo commit). (b) A conta tem 4 projetos Vercel conectados ao repo: doce-mania-oficial-zpac (SEMPRE falha — config antiga quebrada), doce-mania-teste, doce-mania-oficial e doce-mania-oficial2. (c) O domínio doce-mania-oficial.vercel.app NÃO serve o app Next — serve um app Vite antigo (BASE OPERACIONAL V1.0, assets/index-*.js, /api/login dá 404). O app Next REAL está no doce-mania-oficial2.vercel.app (verificado: /api/login responde {"ok":false,"error":"PIN incorreto..."} = endpoint nosso; resposta fresca age:8). (d) Status do commit bbabf42: doce-mania-oficial2 SUCCESS, doce-mania-teste SUCCESS, doce-mania-oficial SUCCESS, zpac failure → o Bloco 38 está em produção no app Next.
- Commit/push do worklog separado (e830a02..).

Stage Summary:
- Rodapé de TODO cupom: bloco destacado com tipo do documento + documento fiscal (CNPJ na NF-e, CPF na NFC-e) + forma de pagamento com quantos dias. Nada mais — sem nome, endereço ou WhatsApp (cupom = base da separação).
- Deploy: código em produção no doce-mania-oficial2.vercel.app (app Next real). zpac sempre falha (projeto antigo); doce-mania-oficial.vercel.app é o app Vite V1 antigo, NÃO usar para verificar deploy.
- Padrão de verificação de deploy a partir de agora: commit status no GitHub (API) + testar /api/login no domínio — NÃO confiar em last-modified do doce-mania-oficial.vercel.app.

---
Task ID: bloco39-fluxo-prevenda
Agent: Z.ai Code (sessão principal)
Task: Chefe: "estamos na pré venda e eu seleciono que quero a vista e ele já pede pra receber o dinheiro na hora.. reveja esse fluxo — pré venda só tira o pedido e quem faz o recebimento é o entregador se for a vista ou no prazo o vendedor na próxima visita ou data acordado". OBS: sandbox resetou de novo (my-project virou template com commits UUID) — repo re-clonado do GitHub (HEAD e11364b = Bloco 38 + worklog).

Work Log:
- Cadeia do problema provada: o wizard Rota 2 (Bloco 27) aplicava na PRÉ-VENDA a regra da PRONTA ENTREGA — passo FORMA pedia "Valor recebido" com troco (e QR de Pix/Misto) e o confirm mandava pagoNaVisita=true para a API, que gravava o pedido como "PAGO NA VISITA pelo vendedor (DINHEIRO) — entrega sem cobranca" com valor_pago=total/status PAGO. Ou seja: vendedor "recebia" na visita e o entregador não cobrava nada — o contrário da regra.
- FIX WizardPagamento.tsx (isPreVenda): passo CONDIÇÃO com textos próprios ("À vista — Entregador recebe na entrega", "A prazo — Você cobra na data ou próxima visita", aviso "SEM DINHEIRO NA VISITA — pré-venda só anota o pedido — quem recebe é o ENTREGADOR na entrega"); passo FORMA à vista = só DINHEIRO/PIX (grid 2 col, MISTO removido), SEM campo valor recebido, SEM troco, SEM QR de Pix, com aviso "ENTREGADOR RECEBE O DINHEIRO/PIX NA ENTREGA — você não recebe nada na visita"; validação de recebimento pulada (proximo() com !isPreVenda); payload sem valorRecebido na pré-venda; RESUMO sem a linha "Recebido / troco"; avisoChave da pré-venda: à vista = "ENTREGADOR QUE RECEBE NA ENTREGA — você só anota o pedido. Na entrega, o entregador cobra X — nada a receber agora", a prazo = "QUEM COBRA É VOCÊ, VENDEDOR — você cobra X na próxima visita ou no vencimento dd/mm/aaaa".
- FIX PDV.tsx: removido o pagoNaVisita do confirm do wizard (pré-venda NUNCA mais nasce PAGO na visita — o toggle manual do EditorPedido segue existindo para exceção consciente); comentários atualizados (BLOCO 39).
- Gravação (API pre-venda/venda, branch pagoNaVisita=false — fluxo antigo que volta a valer): à vista → metodo A_PRAZO, valor_pago 0, status PENDENTE, "PRE-VENDA — cobrar DINHEIRO/PIX na entrega (A VISTA)"; a prazo → "cobrar BOLETO/CHEQUE/PIX na entrega (A PRAZO)" + data_vencimento. Fila do entregador já trata ambos (FilaEntregas: A VISTA DINHEIRO/PIX !PAGO_VISITA → cobrança na entrega; A PRAZO → "vendedor recebe na próxima visita").
- PRONTA ENTREGA intocada: mesmo wizard mantém recebimento na hora (valor recebido, troco, QR pix, MISTO) — verificado no navegador.
- Cupom (cupomTexto.ts) testado com bun em 56mm/80mm para os novos padrões e legado: "cobrar DINHEIRO/PIX na entrega (A VISTA)" → "Pagamento na entrega: DINHEIRO/PIX (A VISTA)" + rodapé "PAGAMENTO: DINHEIRO (A VISTA)"; "cobrar BOLETO na entrega (A PRAZO)" → "(A PRAZO - 7 DIAS)"; legado "PAGO NA VISITA pelo vendedor (DINHEIRO)" (pedidos antigos) → "DINHEIRO (A VISTA)". Zero estouros.
- E2E Agent Browser (mock E2E, rota2user/123456): pré-venda Emporio a vista = wizard 3 passos SEM pedir valor (só Dinheiro/PIX), resumo sem Recebido/troco, PEDIDO REGISTRADO; banco do mock gravou PENDENTE valor_pago 0 "PRE-VENDA — cobrar DINHEIRO na entrega (A VISTA)" modo_nota CUPOM; pré-venda Padaria a prazo = Boleto 7D, resumo "Você cobra Boleto na próxima visita ou no vencimento 27/10/2026", gravado "cobrar BOLETO na entrega (A PRAZO)" venc +8d; cards ficaram cinza (REABRIR); pronta entrega Mercado continua com "2. FORMA DO PAGAMENTO AGORA — DINHEIRO/PIX/MISTO + VALOR RECEBIDO"; zero erros no console e no dev.log. .env.local removido após o teste.
- QA: lint 0 erros/11 warnings (baseline exata); tsc 7 (baseline, zero novos).
- Commit fa3acf9; push e11364b..fa3acf9 (token apenas na URL do comando, nada no config).

Stage Summary:
- Pré-venda voltou a ser o que o dono definiu: SO TIRA O PEDIDO. À vista = ENTREGADOR recebe na entrega (pedido PENDENTE "cobrar X na entrega (A VISTA)"); a prazo = VENDEDOR cobra na próxima visita ou na data acordada (vencimento gravado).
- Ninguém mais "recebe" nada na visita da pré-venda: sem valor recebido, sem troco, sem QR, sem MISTO, sem PAGO NA VISITA automático (toggle manual do editor continua para exceção).
- Pronta entrega intocada (recebimento na hora com troco/QR/misto); pedidos antigos PAGO NA VISITA continuam legíveis na fila e no cupom.
---
Task ID: bloco40-cupom-escolhas
Agent: Z.ai Code (sessão principal)
Task: Chefe (teste tela a tela Rota 2): "escolhi a forma de pagamento e escolhi com nfe! porem nao aparece no cupom que eu fiz essas escolhas! devera aparecer na parte inferior, vc precisa escrever no cupom os dados da venda! se for so cupom ou nfe ou nfc, se tem o cpf caso nfc, forma de pagamento, e prazo, e tbm pq voce ta pedindo foto de comprovante no momento qu estou gerando a pre venda, por favor analise todo o fluxo e deixe isso correto." OBS: sandbox resetou de novo — repo re-clonado (HEAD 158839d = Bloco 39 + worklog), bun install, dev server refeito.

Work Log:
- Diagnóstico completo do fluxo (tela a tela reproduzido no mock): (a) o PDV de pre-venda mostrava o cupom-anteiro ANTES do wizard com DEFAULTS ("Metodo: DINHEIRO", ">>> CUPOM <<<", "PAGAMENTO: DINHEIRO (A VISTA)") — o vendedor imprimia esse cupom e as escolhas (NF-e no atendimento + forma no wizard) nao apareciam; (b) depois de registrar NENHUM cupom era oferecido — o certo so aparecia reabrindo pela fila; (c) o saleOf da FilaEntregas RECONSTRUIA o detalhe do zero ("cobrar X na entrega") SEM o sufixo "COM NOTA: NF-e/NFC-e" nem modo_nota → cupom da fila saia sempre CUPOM; cupom de pedido ENTREGUE virava "BOLETO (A PRAZO)" por hardcode metodoPagamento 'A_PRAZO'; (d) a API da fila nao passava detalhePagamento/metodoPagamento/modoNota/cnpj para o front; (e) o modal "Pedido Registrado!" pedia FOTO DE COMPROVANTE na pre-venda a prazo (isPrazo && !comprovanteFoto escondia o OK) — travava o vendedor na camera, sendo que na pre-venda nada e recebido/assinado na visita.
- FIX PDV.tsx: pre-venda (wizard) nao tem mais o preview enganoso — botao "IR PARA PAGAMENTO" vai direto ao wizard; novo estado cupomPosRegistro: o botao final (VER CUPOM DO PEDIDO na pre-venda / OK — Ver cupom da venda na pronta entrega) abre o CUPOM REAL (com print/copy/WhatsApp/FECHAR e allowNota na pronta entrega — emissao NF-e/NFC-e preservada); foto de comprovante SO na pronta entrega a prazo (condicao ganhou !isPreVenda).
- FIX FilaEntregas.tsx: saleOf usa p.detalhePagamento (raw, com COM NOTA) + p.modoNota + p.metodoPagamento real + tipoVenda/entregaStatus; FilaItem.cliente ganhou cnpj (clientOf repassa para o rodape "NF-e: <cnpj>").
- FIX /api/pre-venda/route.ts: enrichFila/enrichParadas devolvem detalhePagamento/metodoPagamento/modoNota/cnpj; selects ganham modo_nota via sonda hasModoVendaColumn (salesColsComModo) — pre-SQL a fila nao quebra; CLIENT_COLS_BASE + cnpj.
- FIX /api/pre-venda/venda/route.ts: insert .select() dinamico devolve modo_nota (as unknown as Promise<any> — select dinamico quebra o parser de tipos do supabase-js: GenericStringError, +2 erros tsc corrigidos).
- FIX doce-app.tsx: mapeamento do pedido le s.metodo_pagamento/s.modo_nota reais (antes metodoPagamento 'A_PRAZO' hardcode).
- FIX cupomTexto.ts: Data/Vencimento/DIAS do prazo calculados em America/Sao_Paulo (cupom unico; em aparelho UTC o vencimento e os dias saiam +1 — sandbox mostrou 8 DIAS para prazo de 7).
- FIX mock E2E: POST agora responde objeto quando Accept vnd.pgrst.object (.single()) — sem isso o pedido mapeava vazio (cupom R$ 0.00) no teste.
- QA: lint 0 erros/11 warnings (baseline exata); tsc 7 (baseline, zero novos).
- E2E Agent Browser (mock, rota2user/123456): (1) pre-venda Mercado CNPJ + NF-e + DINHEIRO a vista = wizard 3 passos sem recebimento, PEDIDO REGISTRADO sem foto, VER CUPOM DO PEDIDO = ">>> NF-e <<< + NF-e: 12.345.678/0001-99 + PAGAMENTO: DINHEIRO (A VISTA)"; (2) pre-venda Emporio + Boleto 7D = modal SEM foto + cupom "BOLETO (A PRAZO - 7 DIAS)" + vencimento; (3) fila: cupom do pedido NF-e correto (antes CUPOM) e cupom do PIX a prazo = "PIX (A PRAZO - 7 DIAS)" + Vencimento 28/10 (SP); (4) pedido NFC-e com CPF (API): ">>> NFC-e <<< + CPF: 123.456.789-09 + PAGAMENTO: PIX (A VISTA)"; (5) PRONTA ENTREGA a prazo MANTEM "Tirar Foto do Comprovante" + Emitir NFC-e + BoletoCard; zero erros no console/dev.log. .env.local removido; dev server reiniciado limpo.
- Commit 8f9d77b; push 158839d..8f9d77b com token na URL do comando (nada no config); token removido do remote apos o push.
- Deploy: GitHub commit status = doce-mania-oficial2 SUCCESS (app Next real), doce-mania-oficial SUCCESS, doce-mania-teste SUCCESS, zpac failure (sempre falha — projeto antigo); /api/login responde endpoint nosso com age:0.

Stage Summary:
- O cupom agora e o que o dono pediu: a parte de baixo mostra SEMPRE as escolhas da venda — tipo do documento (CUPOM/NF-e/NFC-e), CNPJ na NF-e, CPF na NFC-e identificada, forma de pagamento (DINHEIRO/PIX/MISTO/BOLETO/CHEQUE/PIX NA DATA) e quantos dias no a prazo — e o vendedor imprime o cupom CERTO na hora (botao VER CUPOM DO PEDIDO / OK — Ver cupom da venda), sem precisar reabrir pela fila.
- Foto de comprovante sai da pre-venda (regra: pre-venda so anota o pedido) e fica SO na pronta entrega a prazo.
- Cupom da fila/pedidos/entregues agora le os dados reais da venda (NF-e/NFC-e + CPF + forma + prazo), inclusive pedidos antigos com o sufixo no detalhe.
- Pendentes mantidos: Bluetooth da impressora (nunca investigado); plano NF de entrada XML (aguardando autorizacao).
---
Task ID: bloco41-44-pdv-observacao-dedup
Agent: Z.ai Code (sessão principal)
Task: Chefe (teste pré-venda Rota 2): "esta demorando muito pra finalizar veja o pq disso, nao pode acontecer de duplicar pedido, na tela de pedido registrado a vista nao precisa aparecer o botão de boleto! quero que crie no cupom um campo de observaçao com o sistema de switch, assim como é o de trocas! otimize os botoes switch que aparecem nessa tela para nao ocupar o espaço de visualizar os produtos no pdv!"

Work Log:
- Diagnóstico da DEMORA: POST /api/pre-venda/venda fazia ~7 roundtrips SEQUENCIAIS ao Supabase (SELECT cliente -> 2 sondas de schema -> INSERT sale -> INSERT itens -> SELECT produtos (aviso) -> comissão), cada um pagando a latência da rede. FIX (route.ts): onda 1 em Promise.all (cliente + sondas modoVenda/estoquesNota + query anti-duplicação); onda final em Promise.all (aviso de estoque + comissaoPvDeItens) — de ~7 esperas para 4 ondas (~40-50% mais rápido em produção).
- ANTI-DUPLICAÇÃO em 3 camadas: (a) PDV limpa o carrinho ANTES do await (localStorage + estado) — se o vendedor recarregar/desistir durante a demora o pedido não se repete; em falha o carrinho volta para a tela; (b) servidor: pedido idêntico do MESMO vendedor/cliente/valor registrado há <60s (PRE_VENDA pendente) devolve o EXISTENTE com dedup:true em vez de criar outro — testado com 2 POSTs curl idênticos = mesmo sale.id; (c) UI: botão final do wizard e botão do fluxo antigo agora com spinner "Registrando pedido..."/"Finalizando..." + disabled (prop enviando no WizardPagamento trava TODOS os botões); isFinalizingRef já existia.
- Boleto no PEDIDO REGISTRADO: a condição usava saldo>0 — na pré-venda a vista o pedido nasce valor_pago=0 (entregador que cobra), então o BoletoCard aparecia indevidamente. FIX: boleto só quando !(isPreVenda && !isPrazo) — pré-venda A VISTA sem boleto (regra do dono); pré-venda a prazo e pronta entrega a prazo mantêm (boleto a prazo na entrega).
- OBSERVAÇÃO no cupom com switch: novo estado isObsActive/obsTexto no PDV; a observação grava na coluna trocas como linha "OBS: ..." (mesmo padrão do portal do cliente — SEM SQL novo); cupomTexto separa linhas "OBS:" das trocas e imprime bloco próprio "OBSERVACAO:" (legado/portal sem prefixo continua como TROCAS — testado); campo próprio sale.observacoes também imprime (futuro).
- SWITCHES COMPACTOS: rodapé do PDV tinha 3 blocos fixos (Preço Tabela full-width + Troca/Pré-Pedido + textarea de trocas SEMPRE visível) ~130px. Agora: UMA linha de chips (SwitchChip compacto w-8 h-5): TABELA | TROCA/DESC. | OBS. | PRÉ-PEDIDO (só na pronta entrega) + badge "todos no mínimo" quando tabela liga; campos (desconto R$, textarea trocas, textarea observação) abrem SÓ quando o switch deles está ligado; padding da grade de produtos agora dinâmico (era 280px fixo → 205px base + campo aberto) — a grade mostra mais produtos.
- QA: lint 0 erros/11 warnings (baseline exata); tsc 7 (baseline, zero novos).
- E2E Agent Browser (mock E2E, rota2user/123456): pré-venda Lanchonete SÓ CUPOM (estoque 2 sem NF): footer compacto (TABELA | TROCA/DESC. | OBS. | — sem PRÉ-PEDIDO), 3 unidades, OBS digitada via textarea ("Entregar na porta dos fundos / conferir caixa antes"), wizard À VISTA/DINHEIRO = modal PEDIDO REGISTRADO SEM boleto e SEM foto, VER CUPOM DO PEDIDO = cupom com bloco "OBSERVACAO: Entregar na porta dos fundos / conferir caixa antes" + rodapé ">>> CUPOM <<< + PAGAMENTO: DINHEIRO (A VISTA)"; pré-venda Acougue A PRAZO/Boleto 7D = modal SEM foto ("AGUARDANDO PAGAMENTO"), BoletoCard monta (no mock o serviço Inter responde indisponível — igual antes); dedup da API: 2 POSTs idênticos → mesmo sale.id + dedup:true; cupom 56/80mm testado via bun (trocas+obs / só obs / legado portal / NF-e a prazo 7 dias) — zero estouros de linha; zero erros no console e no dev.log. .env.local removido após o teste; dev server reiniciado limpo.
- Commit 2e9e0cd; push 99a29df..2e9e0cd com token apenas na URL do comando; remote limpo depois.
- Deploy: doce-mania-oficial SUCCESS, doce-mania-oficial2 SUCCESS (app Next real — healthcheck POST /api/login responde "Usuario nao encontrado." como esperado), doce-mania-teste SUCCESS (zpac failure = projeto antigo, sempre falha).

Stage Summary:
- Finalizar pré-venda ficou mais rápido (ondas paralelas na API) e NÃO DUPLICA mais: carrinho sai antes do envio + dedup de 60s no servidor + botão com spinner travado durante o registro.
- PEDIDO REGISTRADO à vista não mostra mais botão de boleto (a cobrança é do entregador na entrega); a prazo continua com o boleto na entrega.
- PDV tem switch OBS. (como o de trocas): o texto sai impresso no cupom no bloco OBSERVAÇÃO — grava na coluna trocas com prefixo "OBS:" (sem SQL novo, mesmo padrão do portal).
- Rodapé do PDV compacto numa linha só: TABELA | TROCA/DESC. | OBS. | PRÉ-PEDIDO (PE) — campos só quando o switch liga; grade de produtos mostra mais itens.
- Pendentes mantidos: Bluetooth da impressora (nunca investigado); plano NF de entrada XML (aguardando autorização).
---
Task ID: blocos45-52-cupom-email-cheque-gif
Agent: Z.ai Code (sessão principal)
Task: Chefe (teste Rota 2): "no cupom! quando não houver trocas! nao precisa aparecer a palavra trocas no cupom! no cupom abaixo dos dados da nota onde hoje aparece forma da venda e forma de pagamento, ex: abaixo do cnpj quando for nf-e colocar o email do cliente para facilitar nossa vida no envio do xml, na tela de pre venda iniciando atendimento, quando optei por nfe temos o botao de confirmar nfe e outro de só cupom! exclua esse botão de só cupom! se a venda for com nfe na condiçao de prazo nao permita pix na data, apenas boleto ou cheque! no modo com nfe selecionando forma de pagamento por cheque nao peça o numero do cheque na pre venda e sim somente na entrega! no cheque nao precisa de data bom para: e tambem a data de vencimento do cheque! apenas bom para! no cheque poderiamos ter a opçoes de clicagem 7dias 14dias 21 dias 30dias assim como no boleto! se confirmar pagamento com cheque nao precisa ter o botao de gerar boleto no pedido registrado! se a venda for nfc! perguntar se é com colocar o cpf ou nao! na tela de registrar pedido quando clicarmos e o sistema estiver processando coloque um gif para identificar e a msg de nao fecha a tela! quando for nfc com cpf devera aparecer o cpf no cupom!"

Work Log:
- Bloco 45 (TROCAS fantasma): cupomTexto agora FILTRA linhas da coluna trocas sem letra/numero ("-", "—", "...") — a palavra TROCAS so aparece quando o vendedor anotou troca de verdade; a observacao do PORTAL do cliente passa a gravar com prefixo "OBS: " (api cliente/pedido) e sai no bloco OBSERVACAO do cupom — nunca mais como TROCAS (pedidos antigos do PDV continuam legiveis).
- Bloco 46 (EMAIL no cupom): rodape do cupom imprime "EMAIL: <email do cliente>" logo abaixo dos dados da nota (ex.: abaixo do CNPJ na NF-e; abaixo do CPF na NFC-e; abaixo do >>> CUPOM <<<) — para o envio do XML da NF-e. So imprime se o cadastro tiver email. A fila/secretario agora recebem clients.email: API pre-venda levou email ao CLIENT_COLS com degradacao em 4 tiers (bancos antigos sem a coluna nao quebram); FilaEntregas e SecretarioView repassam no clientOf; o PDV ja tinha o email (clientService).
- Bloco 47: painel "CNPJ nota" do atendimento perde o botao "So cupom" — ficou "Confirmar NF-e" + "Voltar" full-width (quem abriu o painel ja decidiu; o botao grande "So cupom" da tela anterior continua).
- Bloco 48 (NF-e a prazo sem Pix na data): wizard a prazo mostra so Boleto/Cheque quando o modo fixado e NF-e (grid 2 colunas); trava de seguranca no confirm; no passo NOTA legado escolher NF-e reseta Pix na data -> Boleto.
- Bloco 49 (cheque enxuto): na PRE-VENDA com NF-e o campo "Numero do cheque" sai do wizard e vira o aviso "Cheque sera coletado na entrega — o numero e anotado na entrega, nao aqui" (resumo mostra "anota na entrega"); o cheque tem UMA data so: "Bom para" (o campo duplicado "Data de vencimento" some para cheque) e ganhou os MESMOS atalhos de clicagem do boleto (7D/14D/21D/30D); vencimento gravado do pedido = bom para; pronta entrega com cheque mantem o campo numero (opcional).
- Bloco 50 (cheque = sem boleto): modal de resultado ganhou formaAtraso (setado no wizard e no fluxo antigo, pre-venda e pronta entrega); pagamento confirmado em CHEQUE NAO monta o BoletoCard; a prazo Boleto continua montando (regressao testada) e a vista continua sem boleto (Bloco 41).
- Bloco 51 (GIF nao feche a tela): quando enviando, o wizard abre overlay na TELA INTEIRA (z-300) com spinner grande girando + icone do fluxo pulsando no centro + "NAO FECHE A TELA" + "Registrando seu pedido no sistema.../Concluindo sua venda..." + aviso de aguardar (role=alert aria-live) — capturado no E2E via MutationObserver (2x); todos os botoes ja ficam travados (prop enviando).
- Bloco 52 (NFC-e com CPF no cupom): BUG REAL encontrado e corrigido — o CPF digitado no painel NFC-e do atendimento NAO chegava ao PDV: nfcCpfInicial passava com condicao nfcCpfModoPanel ? nfcCpfModo : '', mas o painel fecha (setNfcCpfModoPanel(false) no abrirNoModo) ANTES do PDV montar, entao era sempre ''. Agora passa nfcCpfModo direto; a venda grava "COM NOTA: NFC-e (CPF ...)" e o cupom imprime o CPF MASCARADO (000.000.000-00 — o wizard grava so digitos). A pergunta "CPF na nota?" da NFC-e ja existia (Confirmar NFC-e / Sem CPF) — verificada no E2E.
- QA: lint 0 erros/11 warnings (baseline exata); tsc 7 erros (baseline, zero novos); cupom testado via bun em 56/80mm (NF-e CNPJ+email / NF-e sem email / NFC-e CPF mascarado / NFC-e sem CPF / CUPOM sem trocas / trocas lixo filtradas / trocas reais + obs / portal obs / cheque 14 dias) — zero estouros de linha.
- E2E Agent Browser (mock E2E, rota2user/123456): painel CNPJ nota = "CONFIRMAR NF-E" + "VOLTAR" SEM "So cupom"; pre-venda Mercado CNPJ NF-e a prazo = wizard so BOLETO/CHEQUE; CHEQUE = aviso "Cheque sera coletado na entrega" sem campo numero + atalhos 7D/14D/21D/30D + somente "Bom para"; 14D -> resumo "Cheque nº: anota na entrega" + vencimento +14d; GIF "NAO FECHE A TELA" visto durante o registro; modal SEM boleto e SEM foto; cupom = ">>> NF-e <<< + NF-e: 12.345.678/0001-99 + EMAIL: fiscal@teste.com + PAGAMENTO: CHEQUE (A PRAZO - 14 DIAS)"; NFC-e com CPF 123.456.789-09 = cupom ">>> NFC-e <<< + CPF: 123.456.789-09 + EMAIL"; pre-venda Emporio SO CUPOM a vista = cupom SEM TROCAS + EMAIL: emporio@teste.com; regressao: pre-venda Padaria a prazo BOLETO 7D = modal com AGUARDANDO PAGAMENTO + comissao + BoletoCard montado (no mock o Inter responde indisponivel, igual antes); zero erros no dev.log (o erro de parsing do console foi o estado INTERMEDIARIO do HMR entre duas edicoes do comentario de props — corrigido na sequencia e comprovado por lint/tsc/funcional). .env.local removido apos o teste.
- Commit d4a10fe; push 8812d88..d4a10fe com token apenas na URL do comando; remote limpo depois.
- Deploy: doce-mania-oficial2 SUCCESS ("Deployment has completed" — app Next real; healthcheck POST /api/login responde 400 com body invalido = app respondendo), doce-mania-oficial SUCCESS, doce-mania-teste SUCCESS, zpac failure (projeto antigo, sempre falha).

Stage Summary:
- Cupom: TROCAS so aparece com troca de verdade (portal imprime observacao no bloco OBSERVACAO); E-MAIL do cliente no rodape abaixo dos dados da nota (XML da NF-e); CPF da NFC-e mascarado e — com o bug do Bloco 52 corrigido — o CPF digitado no atendimento agora CHEGA no cupom.
- Atendimento: painel CNPJ nota sem "So cupom"; NFC-e pergunta o CPF (Confirmar NFC-e / Sem CPF).
- Wizard: NF-e a prazo so Boleto/Cheque; cheque com numero SO na entrega, uma data unica "Bom para" com atalhos 7/14/21/30; GIF "NAO FECHE A TELA" enquanto registra.
- Resultado: pagamento em CHEQUE nao mostra botao de boleto; a prazo Boleto continua com o BoletoCard; a vista continua sem boleto.
- Pendentes mantidos: Bluetooth da impressora (nunca investigado); plano NF de entrada XML (aguardando autorizacao).
---
Task ID: blocos54-58-cupom-caixa-carga
Agent: Z.ai Code (sessão principal)
Task: Chefe: "tela de pedido registrado! nao colocar aguardando pagamento! se for a vista tem que informar que o entregador recebe na entrega! se for a prazo o proprio vendedor recebe no dia da visita ou na data de recebimento! tenta deixar a escrita pagamento cheque a prazo 7 dias na mesma linha ou alinhado na formataçao do cupom, retire os avisos de sem dinheiro no a prazo, assim como o cheque sera coletado na entrega pois o vendedor ja sabe disso! o caixa de entregas nao devera ser zerado todo dia e sim somente quando clicar no botao pelo admin! crie um sistema onde o admin da um check em pedidos carregados! pois na fila podera haver pedidos carregados no veiculos e outros que ainda nao foram! ai saberemos quantos tem no veiculo e qual esta carregado!"

Work Log:
- BLOCO 54 (modal Pedido Registrado): o badge "Aguardando Pagamento" SAIU. A VISTA (pre-venda): chip verde "Entregador recebe na entrega" (fa-truck-fast). A PRAZO: chip ambar "Você recebe na próxima visita ou na data de recebimento" (na pronta entrega a prazo: "Você recebe na data de recebimento"). PDV.tsx (modal saleResultModal).
- BLOCO 55 (cupom): linha do PAGAMENTO agora em 3 tentativas — (1) completa com parenteses ("PAGAMENTO: CHEQUE (A PRAZO - 7 DIAS)" = 80mm); (2) em 56mm COMPACTA sem parenteses e sai na MESMA LINHA ("PAGAMENTO: CHEQUE A PRAZO 7 DIAS" = 32/32 colunas exatas); (3) quando nem assim cabe (14/21/30 dias, misto) — DUAS linhas ALINHADAS, ambas centralizadas ("PAGAMENTO: CHEQUE" / "A PRAZO 14 DIAS", "PAGAMENTO: DINHEIRO + PIX" / "A VISTA"). cupomTexto.ts — testado via bun em 56/80mm com cheque 7/14d, boleto 21d, pix na data 30d, dinheiro/misto a vista e pre-venda a prazo.
- BLOCO 56 (avisos que o vendedor ja sabe): WizardPagamento perdeu (a) o banner do passo 1 ("SEM DINHEIRO NA ENTREGA/NA VISITA/DINHEIRO SO NA VISITA"), (b) o card "Sem dinheiro no a prazo" do passo 2, (c) o card "Cheque será coletado na entrega" (o comportamento continua: na pre-venda NF-e o numero do cheque NAO e pedido, so o Bom para); resumo do a prazo agora so diz "Você cobra X no vencimento dd/mm" (sem "sem dinheiro"/"capital"). EditorPedido perdeu o aviso "Sem dinheiro na entrega — vendedor cobra na visita".
- BLOCO 57 (caixa NAO zera por dia): getFila agora busca o ULTIMO caixa_fechamentos (max criado_em) e soma os eventos ENTREGUE desde la (sem fechamento anterior: teto de 60 dias p/ egress). Resposta: caixa: { dinheiroHoje, pixHoje, desde }. Parser de motivo extraido em partesDeMotivo() (reusado no caixa e na conferencia — removeu duplicacao). UI: card "Caixa em aberto (estimado)" com "desde dd/mm HH:MM" ou "sem fechamento anterior"; aviso do entregador "O caixa so zera quando o admin fecha"; sheet do fechamento com "Dinheiro em especie em aberto (desde...)" e botao "Fechar caixa (a conta recomeca do zero)".
- BLOCO 58 (check de carga): SQL NOVO sql/bloco58_check_carga.sql (sales.carga_confirmada_em timestamptz + carga_confirmada_por uuid — RODAR NO SUPABASE); sonda hasCargaCheckColumns() (serverSchema.ts) degrada graciosamente sem o SQL; FILA_COLS leva carga_confirmada_em quando a sonda ok; enrichFila mapeia carregadoEm; acao POST CHECK_CARGA (so admin; resolve uuid do pseudo-usuario p/ carga_confirmada_por; 503 com mensagem clara se o SQL nao rodou). UI (FilaEntregas): badge verde "No veículo" no card carregado; botao "Carregar"/"Carregado" (toggle, so ADMIN, pendentes); contador "No veículo: X/Y" no resumo (nao aparece pro vendedor); lista impressa marca "✓" no nome dos carregados. Update OTIMISTA (sem recarregar a fila — economiza egress; reverte com load se falhar).
- QA: lint 0 erros/11 warnings (baseline exata); tsc 7 erros pre-existentes (baseline, zero novos); cupom 56/80mm testado via bun (zero estouros de linha).
- E2E Agent Browser (mock E2E, vendedor rota2user + admin adminuser PIN 123456): A1 pre-venda Emporio SO CUPOM a prazo BOLETO 7D = wizard SEM avisos "sem dinheiro" nos passos 1 e 2, modal "TEM Pedido Registrado + Você recebe na próxima visita ou na data de recebimento + FALTA Aguardando", cupom "PAGAMENTO: BOLETO A PRAZO 7 DIAS" (56mm, uma linha); A2 pre-venda Padaria (cadastro incompleto -> Atender sem preencher) A VISTA DINHEIRO = modal "Entregador recebe na entrega" + FALTA Aguardando + FALTA Gerar Boleto + cupom "PAGAMENTO: DINHEIRO (A VISTA)"; A3 pre-venda Mercado CNPJ -> CNPJ nota -> Confirmar NF-e a prazo = SEM Pix na data; CHEQUE = SEM "Cheque será coletado" + TEM "Bom para" + SEM campo numero + atalhos 7D/14D/21D/30D; B admin Entregas = card "Caixa em aberto (estimado)" + "sem fechamento anterior", botao Carregar -> contador "No veículo: 1/4" + botao vira "Carregado" -> descarregar -> 0/4 (update otimista instantaneo); zero erros no console/dev.log. .env.local removido apos o teste; script auxiliar e2e removido.
- A FAZER PELO DONO: rodar sql/bloco58_check_carga.sql no SQL Editor do Supabase (idempotente; sem isso o botao de check responde "Banco desatualizado: rode o Bloco 58 do SQL").
- Commit + push com token apenas na URL do comando; remote limpo depois.

Stage Summary:
- Tela de PEDIDO REGISTRADO agora diz QUEM recebe e QUANDO: a vista = entregador na entrega; a prazo = o proprio vendedor na proxima visita ou na data — "Aguardando Pagamento" saiu de vez.
- Cupom: "PAGAMENTO: CHEQUE A PRAZO 7 DIAS" sai na MESMA LINHA em 56mm (e quando o prazo e maior, duas linhas alinhadas e centralizadas).
- Wizard/editor sem os avisos "sem dinheiro no a prazo" e "cheque sera coletado na entrega" — o vendedor ja sabe a regra.
- CAIXA DE ENTREGAS acumula desde o ULTIMO fechamento do admin (nao zera a meia-noite); so recomeca quando o admin clica em Fechar caixa.
- NOVO: check de carga — o admin marca o pedido CARREGADO no veiculo (botao no card da fila); badge "No veículo", contador "No veículo: X/Y" e ✓ na lista impressa. Depende do SQL do Bloco 58 (sql/bloco58_check_carga.sql).
- Pendentes mantidos: Bluetooth da impressora (nunca investigado); plano NF de entrada XML (aguardando autorizacao).

---
Task ID: bloco59-ordem-rapida
Agent: Z.ai Code (principal)
Task: "o sistema de ordem de entrega para impressao é lento e nao atualiza na hora, tem que recarregar a pagina para ver a mudança. então otimize para que funcione de verdade e rapidamente"

Work Log:
- Diagnóstico (causa raiz): em FilaEntregas.tsx, quando a ordem manual está ativa, `listaOrdenada` devolvia a fila na ordem BRUTA do banco (não ordenava por ordemEntrega). O update otimista do moverOrdem só trocava o NÚMERO de ordem de cada item — o array continuava na mesma posição — então o card NÃO andava na tela; a ordem nova só aparecia no próximo load()/F5 (que busca a fila já ordenada da API). Exatamente o sintoma relatado ("tem que recarregar a página").
- FIX PRINCIPAL (FilaEntregas.tsx): `listaOrdenada` agora ordena por `ordemEntrega` (desempate por antiguidade — mesma regra do servidor) via novo comparador module-scope `compararOrdemEntrega()` (usado pela fila na tela, pela impressão e pela gravação — as três seguem sempre a mesma lista).
- Gravação DEBOUNCED (350ms) + coalescida: `agendarGravacaoOrdem()` + `gravarOrdemAgora()`; cliques rápidos de seta saem em UM request; seta nunca mais fica travada esperando rede (antes ficava desabilitada durante o POST). Serialização via `gravandoOrdemRef` + regravar pendente se clicar durante o save.
- Delta agora é baseado em `ordemSalvaRef` (Map do que JÁ está gravado no servidor, sincronizado a cada load()) — manda só os pares que mudaram (egress mínimo); delta vazio = nenhum request.
- `setPrioridade` (P1/P2): virou otimista + semGps=true + sem reload da fila. Antes: esperava GPS (até 6s) e recarregava a fila INTEIRA (4 SELECTs). Se falhar, load(true) reverte.
- Servidor (api/pre-venda/route.ts): ORDEM_ENTREGA não espera mais o logEventoSeguro para responder (log fire-and-forget com .catch) — resposta mais rápida.
- Limpeza: clearTimeout do timer de ordem no unmount; checks `mounted.current` após awaits.
- QA: lint 0 erros/11 warnings (baseline exata); tsc 7 erros pré-existentes (baseline exata).
- E2E (Agent Browser, mock E2E, script único server+browser por limitação da sandbox; .env.local removido depois):
  T0 ordem inicial [Emporio, Padaria]; T1 DOWN → ordem troca em 60ms SEM reload (probe window 42 vivo; leitura in-page pós-flush do React); T2 toast de gravação; T3 F5 → persistiu [Padaria, Emporio]; T4 lista de impressão segue a ordem nova; T5 UP → volta na hora + persiste após F5; T6 P1 → badge na hora + toast; T7 cliques rápidos DOWN+UP coalescidos → estado íntegro e persistido. dev.log sem erros.
- Commit f457488 pushed; Vercel: doce-mania-oficial / oficial2 / teste = SUCCESS; -zpac (preview) failure PRÉ-EXISTENTE (idêntico no commit anterior 0666db9, sem domínio ativo). Healthcheck produção: oficial2 site 200 + API pre-venda respondendo com guard de sessão.

Stage Summary:
- Ordem de entrega agora funciona de verdade e rápido: card anda NA HORA (~0ms, otimista), gravação coalescida em 1 request (~350ms após o último clique), sem GPS, sem reload da fila; impressão segue sempre a mesma lista ordenada; P1/P2 instantâneo.
- Egress por clique de seta caiu de ~5 SELECTs (fila inteira) para 0-2 UPDATEs de delta (e 0 request se o estado volta ao original antes do debounce).
- Arquivos: src/components/doce/FilaEntregas.tsx (comparador + listaOrdenada sort + moverOrdem/agendarGravacaoOrdem/gravarOrdemAgora + setPrioridade otimista), src/app/api/pre-venda/route.ts (log não bloqueia resposta).
- Nada a fazer pelo dono (sem SQL neste bloco). Pendências antigas mantidas: Bluetooth da impressora; NF de entrada XML (aguardando autorização).

---
Task ID: bloco60-rota2-aprazo-overlay
Agent: Z.ai Code (principal)
Task: "continuamos o fluxo!! na pre venda rota2... na venda com cupom venda a prazo teremos boleto, cheque (na tela do vendedor nao deve pedir numero do cheque) pix na data, ou dinheiro na data! quando confirma uma entrega tbm precisamos daquele gif de carregando nao fechar tela etc"

Work Log:
- WizardPagamento.tsx (ROTA 2, a prazo): cupom/NFC-e agora tem QUATRO formas — Boleto, Cheque, Pix na data e DINHEIRO NA DATA (grid 2x2). NF-e a prazo continua só Boleto/Cheque (Bloco 48) e a trava de segurança do confirmar() também barra Dinheiro na data na NF-e.
- BLOCO 60 (regra do dono): o campo "Número do cheque" SAIU da tela do vendedor em TODOS os modos — só o "Bom para" (com atalhos 7/14/21/30D). Estado chequeNumero removido; resumo mostra "anota na entrega" (pré-venda) / "—".
- avisoChave do Dinheiro na data: "Você recebe o dinheiro do cliente na data combinada (dd/mm)".
- PDV.tsx: pronta entrega a prazo ganhou "Dinheiro na data" no detalhe (era "Pix na data" no fallback); cheque sem nº no detalhe.
- API /api/pre-venda/venda já aceitava DINHEIRO a prazo (formasValidas) — sem mudança de backend; cupom (cupomTexto.ts) já imprime "DINHEIRO (A PRAZO - X DIAS)" pelo parse do detalhe.
- FilaEntregas.tsx: overlay "NÃO FECHE A TELA" na confirmação de entrega (mesmo padrão do Bloco 51 do wizard): spinner + fa-truck-fast + "Confirmando a entrega no sistema..." + aviso. BUG CORRIGIDO NO CAMINHO: `busy` na ENTREGUE guarda o saleId (não 'ENTREGUE'), então o overlay usa estado NOVO `confirmandoEntrega` (true no início de confirmarEntrega, false no finally — cobre todos os caminhos: dinheiro, pix, misto, já pago, a prazo/boleto/sem cobrança).
- QA: lint 0 erros/11 warnings e tsc 7 erros pré-existentes (baselines exatas).
- E2E (Agent Browser + mock; .env.local removido): F1 wizard: 4 formas presentes ["Boleto","Cheque","Pix na data","Dinheiro na data"]; cheque SEM campo número + com "Bom para"; resumo "Dinheiro na data"/a prazo/só cupom; modal "próxima visita"; cupom com PAGAMENTO/DINHEIRO/A PRAZO/7 DIAS. F2 pedido à vista ok. F3 admin: overlay visível em 200/500/900ms com toast de confirmação em ~1.4s, overlay some sozinho, entrega gravada (Entregues: 1 pos-reload).
- Lições E2E: menu vendedor = "Rota do Dia" (não ROTA DO DIA); botões grandes têm subtítulo dentro do <button> (usar includes, não igualdade); mock de cliente: rota ROTA_02 ok; GPS em headless falha rápido (override para simular GPS lento no teste do overlay).
- Commit + push; Vercel oficial/oficial2/teste = SUCCESS (-zpac preview failure pré-existente).

Stage Summary:
- ROTA 2 a prazo (cupom/NFC-e): Boleto, Cheque (sem nº na tela), Pix na data e Dinheiro na data — todos gravam, entram na fila (badge "A prazo") e imprimem no cupom.
- Confirmação de entrega com GIF "NÃO FECHE A TELA" (mesmo visual do pedido) — evita sair/duplo clique durante GPS+gravação.
- Nada a fazer pelo dono (sem SQL). Pendências antigas: Bluetooth impressora; NF entrada XML.
---
Task ID: bloco61-posicao-kanban
Agent: Z.ai Code (principal)
Task: "na tela de entrega no card da entrega antes do nome do cliente vc coloca um #, poderiamos utilizar esse espaço pra colocar a posiçao de entrega. seria interessante ao inves de um sistema de setas pra cima e pra baixo algo estilo kambam de arrastar arrastou soltou fica na ordem correta! sera que rola isso."

Work Log:
- ROLA SIM: implementado com dnd-kit (ja estava no package.json — @dnd-kit/core 6.3.1 + sortable 10.0.0 + utilities, sem instalar nada novo).
- Badge do card: o "#" vira a POSICAO da entrega na rota (1..N da listaOrdenada — mesma numeracao da lista impressa). P1/P2 mantem o badge de prioridade; falha/ok mantem os icones.
- Setas UP/DOWN do Bloco 31 REMOVIDAS. No lugar: arrastar-e-soltar estilo kanban — DndContext + SortableContext (verticalListSortingStrategy) em volta de TODA a fila pendente (funciona na lista unica da ordem manual E nos grupos P1/P2/normal).
- Handle de arrasto = o PROPRIO badge da posicao (cursor-grab + touch-none + title "Arraste para mudar a posição na rota"). So ADMIN pode arrastar (mesma regra das setas); vendedor/entregador veem o numero e nao arrastam.
- PointerSensor com activationConstraint distance 8px (nao rouba scroll nem clique dos botoes) + KeyboardSensor com sortableKeyboardCoordinates (espaco pega, setas movem, espaco solta — acessibilidade). MeasuringStrategy.Always.
- onDragEnd -> aplicarOrdem(arrayMove(listaOrdenada, from, to)): reuso INTEGRAL do mecanismo do Bloco 59 (setData otimista + agendarGravacaoOrdem: debounce 350ms, delta vs ordemSalvaRef, sem GPS, sem reload, toast de confirmacao, reverter com load(true) se falhar). Arrastar no modo agrupado ativa a ordem manual na hora.
- Badge externo pequeno de numero (que existia a esquerda no modo manual) removido — a posicao agora vive dentro do card, no lugar do #.
- Textos atualizados: "Ordem da rota — arraste pelo número para ordenar" (secao), dica para admin no modo agrupado, impressao "Ordem definida pelo admin (arrastar-e-soltar na fila)".
- QA: lint 0 erros/11 warnings (baseline exata); tsc 7 erros pre-existentes (baseline exata, nenhum erro novo).
- E2E (Agent Browser, mock, mouse REAL via mouse move/down/up — pointer events do dnd-kit; .env.local e script removidos): T1 badges mostram "Emporio Teste:1 | Padaria Dois:2" (sem #); T2 drag 1->2: ordem trocou NA HORA ("Padaria Dois:1 | Emporio Teste:2"); T3 toast de gravacao true; T4 F5 persistiu a ordem nova; T5 lista de impressao seguiu ("1:Padaria Dois | 2:Emporio Teste") com window.print chamado; T6 zero erros de console. Server reiniciado limpo (sem mock).
- Commit 91c3a4c pushed (repo docemaniaexpress25/DOCE-MANIA-OFICIAL — ATENCAO: URL correta esta aqui no worklog, NAO e Aireszeta/docemania-app); Vercel: doce-mania-oficial / oficial2 / teste = SUCCESS (zpac pending/failure pre-existente).

Stage Summary:
- Card de entrega mostra a POSICAO na rota (1..N) no lugar do "#", e o admin ordena ARRASTANDO (kanban) pelo proprio numero — mouse, toque e teclado. Solto, o card encaixa na hora, grava coalescido (Bloco 59) e a impressao segue a mesma ordem.
- Nada a fazer pelo dono (sem SQL). Pendencias antigas mantidas: Bluetooth da impressora; NF entrada XML.
---
Task ID: bloco62-chave-pix-config
Agent: Z.ai Code (principal)
Task: "em entregas quando a venda for no pix a vista vc esta gerando um qr code com o valor da venda na chave cpf 01735712043! crie em configuraçoes a chance de editar essa chave podendo ser outra chave valida tipo cpf, cnpj, telefone etc! faça isso"

Work Log:
- src/lib/pix.ts: buildPixPayload(value, txid, chaveOverride?) — a chave pode vir das Configuracoes; sem override segue o padrao (env PIX_KEY / CPF 01735712043).
- NOVO normalizarChavePix(): detecta e valida os 5 tipos do Bacen — CPF (DV real), CNPJ (DV real), TELEFONE (10-11 digitos com DDD -> +55...; 12-13 iniciando 55 -> +...), EMAIL, ALEATORIA/EVP (32 hex ou UUID). AMBIGUIDADE 11 DIGITOS resolvida: bate DV de CPF -> CPF; senao com DDD plausivel [1-9][1-9] -> TELEFONE. TESTE UNITARIO pego no bun (o CPF do dono 01735712043 foi detectado como TELEFONE na 1a versao — corrigido antes do deploy).
- formatPixKey(): agora formata CPF, CNPJ e telefone ((54) 99976-5432) para exibicao.
- lerChavePixEntrega(supabase): le app_settings.pix_chave_entrega (degradacao graciosa: coluna pendente/invalida/vazia -> undefined -> padrao).
- PIX_QRCODE (api/pre-venda) e portal (api/cliente/[codigo]/pix) usam a chave configurada.
- appSettingsService: campo pixChave (coluna pix_chave_entrega) no get (COLS leves + fallback select *) e no update; retry generalizado quando a coluna nao existe ainda (padrao Bloco 23 de catalogo_order).
- doce-app.tsx: state pixChave + updateSetting('pixChave') + props no AdminDashboard.
- AdminDashboard (Configuracoes > card Pix / QR Code): novo campo "Chave do recebimento (QR gerado na entrega)" com CHIP em tempo real ("CPF válida", "CNPJ válida", "TELEFONE válida", "EMAIL", "ALEATORIA", erro em vermelho, ou "Padrão: CPF 017.357.120-43" quando vazio). Salva automático por tecla (padrao da tela); backend normaliza (pontos/tracos ok) e valida no uso.
- SQL: sql/bloco62_pix_chave_entrega.sql (alter table app_settings add column if not exists pix_chave_entrega text) — ENTREGAR AO DONO.
- Mock E2E: settings com id 'global_settings' + pix_chave_entrega + suporte a upsert (Prefer resolution=merge-duplicates) no POST.
- QA: lint 0 erros/11 warnings; tsc 7 erros pre-existentes (baseline exata).
- E2E (Agent Browser, mock; .env.local/script removidos): T1 campo + chip padrao; T2 digitou 54999765432 -> chip "TELEFONE válida" + QR1 chave "+5554999765432"; T3 reload persistiu; T4 limpou -> chip padrao + QR2 chave "01735712043"; T5 CNPJ 11222333000181 -> chip "CNPJ válida" + QR3 chave "11222333000181"; zero erros console. Licao: "Configurações" tem CEDILHA — includes('configurac') nunca casa, usar 'configura'. Licao 2: browser daemon mantem localStorage — localStorage.clear() antes do login. Licao 3: aba ativa persiste — botao voltar (i.fa-arrow-left) antes de trocar de aba.
- Commit ea9d98e pushed; Vercel doce-mania-oficial / oficial2 / teste = SUCCESS (zpac pre-existente).

Stage Summary:
- O QR do Pix a vista na entrega (e o portal do cliente) usa a chave que o admin quiser — CPF, CNPJ, telefone, e-mail ou chave aleatoria — editada em Configuracoes > Pix / QR Code > "Chave do recebimento", com validacao de digito verificador na hora. Vazio = padrao atual (CPF 01735712043).
- SQL unico pro dono: alter table app_settings add column if not exists pix_chave_entrega text; (sql/bloco62_pix_chave_entrega.sql) — ate rodar, o sistema usa o padrao sem quebrar.
- Pendencias antigas mantidas: Bluetooth da impressora; NF entrada XML.
