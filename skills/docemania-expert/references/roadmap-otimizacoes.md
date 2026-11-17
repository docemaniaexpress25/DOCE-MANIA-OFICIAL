# ROADMAP DE OTIMIZAÇÕES DOCEMANIA — consultoria aprovável (bloco 169)

Gerado por pedido do dono (16/11): "me fale usando a mega skill tudo sobre estoque, personalização de venda para cada clientes, automações, margens de lucro, como vender mais para os mesmos, otimização dos portais, Sync, segurança, otimização de fluxo e sistemas, funcionalidades extras, otimização de telas e botões. Tudo dentro do plano gratuito do supabase, cuidar pra não passar os limites".

REGRA (lei 4): NADA aqui foi implementado — é lista para o dono aprovar item por item. Cada item cita origem de dados e custo/risco. Ao aprovar, vira bloco com SQL no chat (lei 2).

## 0. Limites do Supabase FREE (obrigatório respeitar em qualquer proposta)

| Recurso | Free | Situação DOCEMANIA (medido 16/11 via REST anon) |
|---|---|---|
| Banco (Postgres) | 500 MB | sales 1.494 · sale_items 12.358 · commissions 1.489 ≈ <15 MB. Folga ~97%. Kardex/ledger caixa/webhook_logs crescem ~1 linha por evento — décadas de margem com purge simples |
| Storage | 1 GB (egress storage 2 GB/mês) | fotos comprimidas no upload (compressImage em FilaEntregas) + notas PDF/XML. ~100 notas/mês ≈ ~10-15 MB/ano. NUNCA apagar comprovante/nota (prova fiscal + lei 5) |
| Egress global | 5 GB/mês | vilões: imagens públicas do catálogo (product-images) em cada abertura de portal + polling 20s do caixa + selects largos. Controlável com select de colunas específicas e paginação |
| Backups automáticos | NÃO incluídos (PITR 7d é pago) | aba Backup do admin (export CSV/JSON: clientes, vendas, comissões, produtos, vendedores, cargas, despesas, financeiro, completo) + script local + git. Reforço proposto no item S5 |
| Realtime | 200 conexões / 2M msgs | NÃO usar agora: RLS fechada nas tabelas sensíveis impede anon de receber postgres_changes; polling 20s do caixa é previsível e barato |
| Cron | pg_cron disponível | app usa cron Vercel Hobby (só diário, UTC). Triggers SQL fazem o tempo real de verdade (custo zero) |
| Pausa por inatividade | pausa após ~7 dias sem requisição | app é diário + 2 crons Vercel → nunca pausa |
| Conexões diretas | ~60 | não é risco: acesso é 100% PostgREST (HTTP), sem pool de conexão Postgres |

Disciplina de egress (aplicar em qualquer tela nova): `select` só das colunas usadas (nunca `select=*` em lista grande), paginação/limite, catálogo com cache no cliente, imagens otimizadas e lazy.

## 1. ESTOQUE (existe hoje: kardex atômico + EXCEPTION swallow 108; entrada sempre no Estoque Total; cupom→Estoque 2, NF→Estoque 1, contadores editáveis 75; reserva na pré-venda 88; estorno automático ao excluir; carga COM_NF/SEM_NF com aceite 95.1; importação XML de compra com entrada de estoque; estoque negativo PERMITIDO — proposta do bloco 70 parada por autorização)

Propostas (aprováveis):
- **E1 — Estoque mínimo + lista de reposição** (SQL leve: `alter table products add column if not exists estoque_minimo int default 0` + coluna na tela de produto + card "Repor" no dashboard admin e no vendedor com produtos abaixo). Custo baixo, risco zero, alto impacto operacional.
- **E2 — Fechar o estoque negativo** (bloco 70): `GREATEST(0, ...)` nos RPCs + `CHECK` — muda comportamento (venda grande sem saldo passa a bloquear) → precisa aprovação explícita e backup espelho antes (lei 5 padrão).
- **E3 — Curva ABC de estoque**: ranking por giro e margem a partir de sale_items (custo congelado) — aba/card novo nos Relatórios (primeiro ler o que REPORTS já mostra — ui-ux.md §2).
- **E4 — Aviso de ruptura na geração de rota**: comparar itens pendentes × estoque disponível ao GERAR_ROTA → banner "faltam X unidades de Y".
- **E5 — Contagem cíclica**: tela de conferência por família (usa o mesmo POST de AJUSTE do kardex, com motivo obrigatório) para fechar o mês sem inventário parado.

## 2. PERSONALIZAÇÃO DE VENDA POR CLIENTE (existe hoje: cliente especial GB só nas Rotas 3/4 com preço GB e piso 70/71/73/73b/157; preco_minimo; preco_cupom; observações; roteirização dia_roteiro/ordem; ClientHistory; get_sugestoes_cliente no portal; avisos >25d sem compra)

Propostas:
- **P1 — Tabela de preço por cliente** (extensão do modelo GB): coluna jsonb `precos_personalizados` em clients (product_id→preço, só os que divergem) — PDV mostra preço já aplicado com badge "preço especial" e respeita preco_minimo. Regra de preço → design aprovado antes (blocos 121/122).
- **P2 — Condição padrão por cliente**: `prazo_padrao_dias` (7/14/21) → PDV pré-seleciona vencimento na pré-venda.
- **P3 — Sugestão de recompra no PDV** (ver V2): card no cliente aberto "Ele costuma levar: ..." com adicionar em 1 toque (usa get_sugestoes_cliente, que já existe).
- **P4 — Política de crédito**: bloqueio de A_PRAZO no PDV quando cliente tem venda vencida > X dias ou dívida > R$ Y (parametrizável nas Configurações › Sistema). Portal do pedido online JÁ bloqueia por débito — replicar a regra no PDV.
- **P5 — Obs do cliente no cupom**: linha de observação cadastrada impressa no cupom (padrão trocas).

## 3. AUTOMAÇÕES (existe hoje: 7 triggers SQL — caixa David v2, baixa boleto no caixa, custo congelado, kardex, estorno, recontagem rota, skip comissão David; webhooks Inter + Focus com log; crons boletos-sync 07h e notas-sync 09h BRT; push VAPID; alarme de pedido novo no secretário; comissão automática na entrega; comprovante portal → revisão)

Propostas:
- **A1 — Push quando boleto baixa**: no webhook Inter (após confirmar RECEBIDO) chamar send-push ao admin — código de webhook e push já existem; só acoplar. (já no backlog da skill §7)
- **A2 — Push quando nota rejeitada**: no webhook Focus, `erro_autorizacao` → push "NF-e X rejeitada: motivo" para o admin corrigir na hora.
- **A3 — Cron de vencidos no boletos-sync**: a rodada diária já reconsulta cobranças — acrescentar: venda a prazo vencida há >3 dias e não paga → item na lista "Cobranças em atraso" do dashboard (sem custo; usa o mesmo GET).
- **A4 — Purge automático (proteção do 500 MB)**: SQL idempotente no cron — deletar webhook_logs >90 dias, user_locations >30 dias, entrega_eventos sem foto >180 dias. Nunca tocar em comprovantes/notas/vendas/comissões (lei 5 + prova fiscal).
- **A5 — Limpar push_tokens inválidos**: agendar o RPC clean_old_push_tokens (já existe, sem agendamento) no mesmo cron.

## 4. MARGENS DE LUCRO (existe hoje: custo congelado no momento da venda — trigger setar_custo_unitario_venda 80/79; margem global 35% nas Configurações › Sistema; preco_minimo e preço mínimo global; lucro por rota admin/vendedor + despesas seller_expenses; trocas anotadas a CUSTO)

Propostas:
- **M1 — Relatório de margem por produto** (ABC de margem): `precovenda − custo_unitario` por item do mês — ranking top/bottom no REPORTS. Tudo já está no banco; é query + tela.
- **M2 — Painel "Resultado do mês"**: consolidado único: faturamento − custo − comissões pagas − despesas (dados existentes, um card).
- **M3 — Atualizar custo pela compra XML**: ao ENTRADA_ESTOQUE do importador, checkbox "atualizar preço de custo dos produtos pelo XML" — margem nunca fica velha.
- **M4 — Alerta de margem no PDV**: se preço digitado < preco_minimo ou < custo + 5%, warn na conferência (não bloqueia — avisa; bloqueio total só se o dono quiser).
- **M5 — Margem real por cliente**: soma margem dos itens por cliente no mês (quem dá lucro de verdade, não só faturamento) — complementa o relatório de faturamento existente.

## 5. VENDER MAIS PARA OS MESMOS (existe hoje: avisos >25d sem compra; portal com catálogo + pedido online mín R$200 + bloqueio por débito; QR do catálogo no cupom com switch; sugestões RPC; WhatsApp compartilha DANFE/boleto com token 7d)

Propostas:
- **V1 — Ciclo de recompra personalizado**: intervalo médio entre compras por cliente (GROUP BY simples) → aba Avisos passa a dizer "Cliente X costuma comprar a cada 15 dias, está a 18" em vez de regra única de 25d.
- **V2 — Recompra sugerida no PDV** (ver P3) — maior conversor de ticket médio: vendedor não precisa lembrar o que o cliente costuma levar.
- **V3 — Campanha de reativação**: lista Inativos 30/60/90 dias com botão WhatsApp (wa.me) com mensagem pronta + link do portal do cliente. Zero infra (link na frente).
- **V4 — Upsell no fechamento**: "quem levou este também levou..." (co-ocorrência de sale_items; query 1x/dia cacheada em app_config para não pesar no banco).
- **V5 — Ajuda para bater o mínimo no portal**: banner "faltam R$ 34 para o mínimo" com sugestões do histórico (min R$200 já existe).

## 6. OTIMIZAÇÃO DOS PORTAIS (existe hoje: /notas PC 1600px com filtros-chip/KPIs/sticky; /fiscal-produtos; /entradas; portal cliente com extrato/Pix/comprovante; pedido online; sessão PIN compartilhada; rate limit AUTH)

Propostas:
- **O1 — /notas mais leve**: carregar 100 notas por vez (botão "carregar mais") em vez de fetchAllPages completo — reduz egress e tempo de abertura (1953 linhas de tela).
- **O2 — PDF/XML sob demanda**: já é URL assinada 1h — garantir que o painel não baixe nada até o clique (conferir e, se necessário, adiar para onclick).
- **O3 — Portal cliente mobile-first check**: revisar /cliente/[codigo] e /pedido/[codigo] no iPhone de verdade (é o rosto da empresa para o cliente).
- **O4 — Selo de confiança no portal**: "sua dívida atual", "vencimento", "última compra" já existem no extrato — adicionar "prazo médio" e "pedidos feitos" (dados já no banco).
- **O5 — Cache do catálogo público**: pedido online cacheia catálogo 5 min no cliente (menos egress; estoque continua consultado no ato do pedido).

## 7. SYNC (existe hoje: polling 20s + visibilitychange no caixa 167; crons Vercel diários; webhooks Inter/Focus com re-consulta; PWA manifest+sw.js; GPS user_locations; dedup 60s)

Decisão técnica recomendada: **manter polling, não adotar Supabase Realtime** — RLS fechada das tabelas sensíveis impede anon de assinar postgres_changes, e abrir RLS só para Realtime é furo. O tempo real de verdade do app são as TRIGGERS SQL (custo zero, no banco).
Propostas:
- **S1 — Payload menor do polling do caixa**: GET retorna só agregados quando `?lite=1` (totais + contagem) — o detalhe só ao expandir. Menos egress, mesma sensação de tempo real.
- **S2 — Fila offline do PDV** (EXTRA, risco médio): sw.js + fila localStorage (try/catch!) com reenvio quando volta a internet, dedup 60s já existe. Só com design aprovado — venda offline pode divergir de estoque/carga.
- **S3 — Indicador de sync visível**: reusar o hint "Atualiza sozinho a cada 20s · HH:MM:SS" (167) em Entregas e Comprovantes.

## 8. SEGURANÇA (existe hoje: bcrypt + rate limit 8/10min no login E no AUTH do portal fiscal; HMAC TTL 7d; permissão no servidor; RLS fechada nas sensíveis; webhook re-consulta na fonte; storage privado URL assinada; idempotência; máscara de token; QA prod só leitura)

Furos reais conhecidos (fechar em fases, com design aprovado — não é mudança de 1 dia):
- **X1 — `send-push` é público** (backlog da skill §7): guard de sessão admin + validar payload. 1h de trabalho, risco baixo.
- **X2 — Policy `anon_full_access` (using true) em 16 tabelas** com anon key no bundle: qualquer um com a URL+key lê/ESCREVE clients/products/sales/sale_items/commissions/app_settings/push_tokens. Plano faseado: (f1) escritas que o browser faz hoje → rotas API server-side com sessão; (f2) policy de clients por portal_code para o portal; (f3) fechar escrita anon; (f4) por fim, leitura. MIGRAÇÃO GRANDE — cada fase com QA completo e backup espelho (lei 5). Até lá, mitigação: rotacionar anon key é inviável (está no bundle) — a proteção real é a faseada.
- **X3 — PIN admin**: confirmar com o dono (recusado nos QA 164/165) — rotina de troca de PIN já existe nas Configurações.
- **X4 — Backup reforçado (S5)**: botão "Backup semanal na nuvem" → POST admin que grava JSON das tabelas críticas em bucket PRIVADO `backups-app` com nome datado (rotação 8 semanas). Complementa a aba Backup existente (export manual). Grátis; protege contra o free não ter PITR.
- **X5 — Uso do Supabase no diagnóstico**: `/api/diagnostico-banco` passa a mostrar também contagens de linhas das tabelas pesadas (alerta antecipado de 500MB/1GB).

## 9. FLUXO E SISTEMAS (existe hoje: fila contínua P1/P2/antiguidade com drag; cupom de conferência; PDV 8 telas lineares; cascata de cancelamento; sondas de schema + fallback; idempotência em tudo; crons + webhooks + triggers como rede tripla)

Propostas:
- **F1 — Pré-seleção de condição/forma**: PDV memoriza última condição/forma usada por vendedor (localStorage try/catch) — menos 2 toques por venda. NÃO mexe na ordem dos produtos (lei 12/bloco 89) nem nas 8 telas.
- **F2 — Resumo do dia no HOME admin**: card único com vendas, recebido, boletos emitidos/baixados, pendências da fila (dados existentes).
- **F3 — Conciliação Pix via extrato Inter** (escopo novo): API de extrato do Inter daria baixa automática do Pix recebido (hoje é manual por foto). Requer nova env/permissão no IB PJ + design — listar como aprovável, não urgente.
- **F4 — Encurtar fila**: botão "próxima não separada" no SecretarioView pula direto para o próximo pedido (fila contínua já existe; é atalho de navegação).

## 10. FUNCIONALIDADES EXTRAS (backlog aprovável)
- **X-Extra1** — App nativo iOS (Capacitor) para Bluetooth sem Bluefy (backlog da skill §13).
- **X-Extra2** — Spedy ligável (`SPEDY_ENABLED=1` + SQL do bloco 95) — fiscal alternativo pronto em modo dormido.
- **X-Extra3** — Relatório PDF A4 mensal consolidado (padrão @media print do impressao-fiscal.md).
- **X-Extra4** — Lembrete de vencimento por WhatsApp ao cliente (link wa.me com mensagem + QR/boleto) manual ou semi-automático no cron de vencidos (A3).
- **X-Extra5** — Campo "cliente prefere contato por" no cadastro (zap/telefone) para guiar a campanha V3.

## 11. TELAS E BOTÕES (existe hoje: padrões ui-ux.md — mobile-first max-w-lg, cards rounded-3xl, micro-tipografia, alvos 44px, active:scale-95, ConfirmModal destrutivo, status colorido consistente, seta voltar no PDV, banner autoexplicativo, badges de fila)

Propostas:
- **T1 — Auditoria de toques no fluxo nº 1 (pronta entrega)**: medir toques reais hoje e cortar os que F1 não corta; manter fluxo linear com preview (nada de atalho que pule conferência — bloco 100/122).
- **T2 — Badge de contagem em TODA aba com fila**: Comprovantes já tem; replicar em Entregas (pendentes), Caixa (boletos pendentes), Contas a Receber (vencidos hoje).
- **T3 — Totais do caixa em fonte maior**: os 3 números que o dono olha (dinheiro/pix/boletos) com hierarquia tipográfica clara + último fechamento visível no topo.
- **T4 — Filtros salvos nos portais de PC** (/notas: período/estado na localStorage try/catch).
- **T5 — Skeleton loading padrão** nas telas que hoje mostram spinner girando (fila, caixa, portais).

## Priorização sugerida (impacto × custo × risco) — o dono escolhe os números

| Onda | Itens | Por quê primeiro |
|---|---|---|
| **Onda 1 (rápidos, risco zero)** | E1, A1, A2, A4, M4, S3, T2, X1, F1 | SQL leve ou acoplamento de código existente; resultado visível em 1 bloco |
| **Onda 2 (relatórios/margem)** | M1, M2, M5, E3, F2, O1, X5 | só leitura — não mexem em operação |
| **Onda 3 (vendas/margem de verdade)** | V1, V2, V3, V5, P2, P4, M3, E4, O5 | mudam fluxo de venda → design aprovado antes (121/122) |
| **Onda 4 (estrutural)** | E2, P1, X2 fases 1-2, X4, X-Extra* | mudança de regra/segurança → cada fase com backup espelho + QA |
| **Não fazer no free** | Supabase Realtime (decisão S), cron <24h (Vercel Hobby), PITR automático, apagar histórico fiscal/comprovante | limites/leis |

## Como acompanhar os limites (rotina do dono)
1. 1x/mês: painel Usage do Supabase (5 min) — banco, storage, egress.
2. A qualquer hora: aba Backup → backup completo JSON (baixa e guarda no PC/Drive).
3. A qualquer hora: Configurações → ERP → log do webhook (auditoria de cobrança).
4. `/api/diagnostico-banco` + X5 (quando aprovado) mostram contagem por tabela.
