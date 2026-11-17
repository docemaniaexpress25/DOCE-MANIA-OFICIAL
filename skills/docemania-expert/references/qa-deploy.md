# QA, DEPLOY, GIT E SQL — padrões obrigatórios

## 1. Baselines (comparar SEMPRE antes/depois)

- **lint** (`bun run lint`): **0 erros / 8 warnings**. Qualquer erro novo = corrigir antes de commit.
- **tsc**: **104 erros** = baseline. Método do diff rigoroso: `npx tsc --noEmit > /tmp/antes.txt` antes; após mudanças, `git stash` → novo tsc → comparar linha a linha → `git stash pop`; ZERO erros novos nos arquivos tocados.
- **dev.log**: tail de `/home/z/my-project/dev.log` após mudanças (procurar erros de runtime, API falhando, hydration).
- Dev server: `bun run dev` em background, porta 3000, nunca `bun run build`.

## 2. E2E com agent-browser

- **Mock**: `NEXT_PUBLIC_E2E_MOCK=1` + `/api/e2e-supabase/[...path]` (PostgREST fake). Admin PIN **123456** no mock. Remover `.env.local` do mock ao terminar.
- **Browser em `127.0.0.1:3000`** (não localhost — CORS "Failed to fetch").
- **Armadilhas comprovadas**:
  - `fill ""` não dispara onChange do React (estado interno não muda) → limpar com TECLADO (Ctrl+A+Delete) e digitar com type.
  - Teclados de PIN (componentes custom) não aceitam fill → click + type.
  - `innerText` volta UPPERCASE por CSS → usar `textContent`/toLowerCase nos asserts.
  - Preview pode recarregar entre comandos (sandbox mata processos) → fazer fluxo inteiro num único eval; clicar "Recarregar" na tela de erro do SafeBoundary se necessário.
  - Chunks estáticos não contêm textos de telas pós-login (só aparecem após montagem).
- Console: zerar erros de JS (warnings de push permission são esperados no headless).
- **Produção = só leitura**: nunca POST que mude dado real (vendas/notas/caixa). Confirmar PIN admin com o dono antes de portais (635241 recusado nos blocos 164/165).

## 3. Git — fluxo seguro

- Branch de trabalho: **main** (push = deploy Vercel automático).
- **NUNCA `push --force`**. Divergências conhecidas:
  - Commit lixo de checkpoint (UUID, non-fast-forward) → `git reset --mixed origin/main` e recommit limpo.
  - Divergência de permissão 100644/100755 em mesmo blob → conteúdo idêntico: `git reset --hard origin/main` após conferir blob.
- Token GitHub: já embutido no remote (`git remote -v`); em curl usar na URL da requisição e nunca salvar em arquivo/config. Formato de conferência de deploy:
  ```bash
  curl -H "Authorization: token $TOKEN" https://api.github.com/repos/docemaniaexpress25/DOCE-MANIA-OFICIAL/commits/<sha>/status
  # state "SUCCESS" = Vercel publicou
  ```
- **DOMÍNIOS**: confiar só em `https://sistema-doce-mania1.vercel.app`. `zpac` falha sempre; `doce-mania-oficial.vercel.app` é um Vite antigo; `doce-mania-oficial2` aparece no histórico — não usar para QA.
- Commit message padrão: `blocoNNN: <resumo dos entregáveis>` (exemplos reais no histórico).

## 4. Vercel — build e cron

- **Só `bun.lock`** no repo (package-lock.json acidental → Vercel usa npm → next 16.3.1 → ENOENT; fix: remover lock + next fixado "16.1.3"; `standalone` só fora da Vercel).
- **Export inexistente em route.ts trava o build inteiro** (Turbopack; `ignoreBuildErrors` não cobre) — provar que route.ts carrega.
- **Cron**: plano Hobby aceita só diário (`*/5` rejeita o deploy INTEIRO). Horários em UTC (0 10 * * * = 07h BRT). Crons atuais: `/api/boletos-sync` (0 10), `/api/notas-sync` (0 12).
- Deploy às vezes não sai por concorrência no plano free → re-checar status do commit.

## 5. SQL — padrão do dono

- **SQL NOVA vai NO CHAT para copiar/colar** (obrigatório — pedido verbatim do dono) + arquivo `sql/blocoN_*.sql` no repo.
- **Sempre idempotente**: `add column if not exists`, `create table if not exists`, `create or replace function`, triggers com `drop trigger if exists` + `create trigger`, guardas NOT EXISTS por chave natural.
- Operação destrutiva = **backup espelho antes** (CREATE TABLE ..._backup AS SELECT) + rollback comentado no fim + SELECT de conferência esperado no fim (ex: "esperado: BOLETO 4/2898.37, DINHEIRO 5/3207.40, PIX 2/2690.46").
- **Trigger plpgsql padrão**: `SECURITY DEFINER`, dupla checagem NOT EXISTS, `EXCEPTION WHEN OTHERS` com swallow ("kardex NUNCA quebra venda") — erro de ledger não mata a venda.
- **Enquanto o SQL não rodar**: o código usa sonda de schema (`serverSchema.ts`) e degrada com fallback — app funciona antes/depois. Conferência se rodou: `GET /api/diagnostico-banco`.
- Tabela nova sensível = RLS fechada (REVOKE anon/authenticated; service_role only).

## 6. Tabela de bugs históricos (nunca repetir; atualizar a cada bloco novo)

| # | Bug | Bloco | Lição |
|---|-----|-------|-------|
| 1 | Renome David→Deivid + regex `/^david/i` → caixa zerado | 166 | Casar por ID fixo primeiro; nome só fallback david\|deivid |
| 2 | SQL do bloco não rodado → feature inerte | 165/166/70/75/80/95/98/108/157 | Conferir `/api/diagnostico-banco` + perguntar ao dono |
| 3 | POST client-side fire-and-forget com sessão expirada → 401 silencioso | 165 | Fonte de verdade no servidor/trigger |
| 4 | Bloco não chamava a API que pensava (só texto no detalhe) | 165 | Testar o gancho de dados, não só a UI |
| 5 | RLS sem policy → anon vê `[]` e engana diagnóstico | 165 | Ler com service_role; anon vazio é inconclusivo |
| 6 | localStorage SecurityError no iPhone → tela branca eterna | 118.4 | try/catch total + ErrorBoundary global |
| 7 | Safari iOS ignora print() de iframe/timeout | 120 | Documento principal + gesto do usuário |
| 8 | iOS sem Web Bluetooth | 82 | Navegador Bluefy (`iosPrint.ts`) |
| 9 | `GS ! 0x01` = ampliação (trocas GIGANTES) | 102 | Fonte pequena = `ESC ! 0x01`; testar no papel real |
| 10 | CODE128 NUL corrompeu buffer | 85 | Sem NUL; QR módulo dinâmico 576 dots |
| 11 | Checkpoint do sandbox restaurou .git antigo → commits lixo UUID + 100644/100755 | 67/68/73 | `git reset --mixed origin/main`; nunca force |
| 12 | package-lock.json acidental → Vercel npm → ENOENT | 159 | Só bun.lock; next fixado 16.1.3 |
| 13 | Cron `*/5` rejeitou o deploy no Hobby | 108 | Cron diário |
| 14 | Gatilho `nfce` não existe no enum da Focus | 150b | Seguir o SCHEMA da doc; hooks = nfe + nfce_contingencia |
| 15 | `erro_autorizacao` tratado como processando | 116 | Mapear todos os status v2 explicitamente |
| 16 | Kardex GET: embed products sem FK quebrou | 108.1 | Embed exige FK; resolver em memória |
| 17 | Coluna inexistente (`qtd_pendentes`) + dois SQL "bloco 95" | 95xml | Nomes de SQL únicos; coluna só existe se criada |
| 18 | Export inexistente em route.ts travou build | 103 | Provar que route.ts carrega |
| 19 | Token de produção validado com segredo local → 401 | 66/156 | devBridge ANTES da validação de sessão |
| 20 | Rate limit Focus 100 req/min | 141 | Lotes de 6-8; Retry-After |
| 21 | agent-browser fill não grava em PIN/onChange | 157 | Teclado humano (Ctrl+A+Delete / click+type) |
| 22 | Preview recarrega entre comandos | 81/101/72 | Fluxo inteiro num único eval |
| 23 | Mock CORS 127.0.0.1×localhost | 86/70b | Mesma origem obrigatória |
| 24 | innerText uppercase por CSS | 81/86/64 | textContent/toLowerCase |
| 25 | Flex esmagou cupom | 78 | shrink-0 + my-auto + rolagem real |
| 26 | NFC anônima sem modoCupom saiu preço cheio | 137 | Regra de preço por CONDIÇÃO (anônima), não por flag |
| 27 | Inter recusa cobrança COM notaFiscal | 151 | Fallback sem o campo + nota na mensagem |
| 28 | Portal sem canceladas/pendentes + `podeCancelar` exigia `!avulsa` | 150/155 | Portal mostra TODOS os documentos; botões por estado real |
| 29 | CSOSN 101 para não contribuinte → rejeição SEFAZ | 160 | CSOSN segue o destinatário |
| 30 | Venda à vista nascia "em aberto" | 139→152 | À vista nasce PAGO |
| 31 | Exclusão de venda apagou nota do portal | 154 | Congelar nota ANTES do delete; exclusão só admin |
| 32 | Estoque negativo (RPC sem conferência) | 70 | GREATEST(0,...)+CHECK proposto, aguardando dono |
| 33 | Entregador fixo id "ENTREGADOR" nunca batia UUID | 119.2 | Permissão calculada no SERVIDOR |
| 34 | 4 projetos Vercel / deploy não sai | 38/82 | Conferir commit status; app real = sistema-doce-mania1 |
| 35 | PIN admin 635241 recusado | 164/165 | Confirmar PIN com o dono antes de QA |

## 7. Pendências — resolvidas e vivas

**Resolvidas recentemente** (mover para cá quando fechar):
- Bloco 166: caixa do Deivid (renome + SQL não rodado) — fix por ID + SQL entregue no chat.
- Bloco 167: caixa 2.0 + webhook com log + mini boleto + configurações em sub-abas + cron boletos-sync.

**Vivas** (fonte viva: SKILL.md §13 — manter as duas listas em sincronia):
- SQL 167 (+165/166/157) aguardando o dono rodar; webhook Inter aguardando cadastro da URL no IB PJ + teste real; envs Inter na Vercel; PIN admin a confirmar; Excel NCM/CEST/CFOP pausado (161); CSC/IdCSC NFC-e; cancelamento de avulsa a validar em produção; Spedy dormant; REABRIR não estorna caixa por entregador; app iOS (Capacitor) e cron Pro no backlog.
