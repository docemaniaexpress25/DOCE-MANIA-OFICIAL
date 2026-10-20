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
