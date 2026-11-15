# DOCE MANIA — Sistema de Gestão (app completo)

Código-fonte completo do sistema **DOCE MANIA ATACADISTA** (mesmo app do deploy
https://sistema-doce-mania1.vercel.app/ e do repositório
https://github.com/docemaniaexpress25/DOCE-MANIA-OFICIAL).

## O que é o sistema

Aplicativo de gestão operacional para a distribuidora, com:

- **Login por usuário + PIN** (bcrypt; perfis ADMIN / VENDEDOR / SECRETARIO / ENTREGADOR)
- **Dashboard do vendedor**: pré-venda, catálogo de produtos, pedidos, comissões, trocas
- **PDV (frente de caixa)** — exclusivo do caixa autorizado (Rota 5 / David)
- **Fila de entregas** (P1/P2/antiguidade) e rotas diárias (Rota 02 etc.)
- **Estoque**: movimentações, Kardex, custo médio congelado, cargas (aceite de carga)
- **Fiscal**: NFC-e/NFe via Focus NFe (importação por REF/chave, DANFE PDF/XML,
  backups mensais), integração Spedy, cupom não fiscal
- **Financeiro**: PIX (QR Code por venda), boletos Inter, contas a receber,
  fechamento de caixa, comprovantes com foto
- **Portal do cliente**: catálogo por código de cliente, pedido e PIX via link
- **Notificações push** (web-push / VAPID) e modo offline com sincronização

## Tecnologia

- Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- Tailwind CSS 4 + shadcn/ui (Radix) + lucide-react + Font Awesome
- Supabase (PostgreSQL) como banco de dados real
- bcryptjs, qrcode, fast-xml-parser, fflate, web-push, recharts, etc.

## Como rodar (3 passos)

```bash
# 1. instalar dependências
npm install

# 2. configurar o ambiente (o arquivo .env.local JÁ VEM pronto no pacote)
#    Ele ativa a "ponte de desenvolvimento": sem segredos locais, as chamadas
#    de API são repassadas ao backend de produção na Vercel, e o app fica
#    100% funcional (login, dados reais, notas, PIX...).

# 3. rodar
npm run dev
# abra http://localhost:3000
```

### Produção (deploy próprio)

```bash
npm run build && npm start
```

No deploy próprio (Vercel ou servidor), configure as variáveis de ambiente
secretas que hoje existem apenas no projeto oficial da Vercel:

| Variável | Para quê |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend das rotas de API (obrigatória em produção) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente Supabase |
| `SESSION_SECRET` | Assinatura HMAC das sessões admin |
| `FOCUS_NFE_TOKEN` + `FOCUS_NFE_*` | Emissão/consulta de NFC-e e NFe |
| `PIX_KEY` / `PIX_NAME` / `PIX_CITY` | Geração de PIX |
| `INTER_CLIENT_ID` / `INTER_CLIENT_SECRET` / `INTER_CERT` / `INTER_P12` / `INTER_P12_SENHA` / `INTER_CONTA_CORRENTE` / `INTER_AMBIENTE` | Boletos Banco Inter |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Push notifications |
| `SPEDY_*` | Integração fiscal Spedy |
| `CRON_SECRET` | Protege `/api/notas-sync` (cron diário) |

Sem `SUPABASE_SERVICE_ROLE_KEY` em **modo dev**, a ponte
(`src/lib/serverSupabase.ts → devBridge`) repassa tudo para
`DM_PROD_URL` (padrão: `https://sistema-doce-mania1.vercel.app`).
Desligue com `DM_DEV_BRIDGE=off`.

## Estrutura

```
src/
  app/page.tsx              -> shell do app (login + dashboards)
  app/notas/                -> painel fiscal (notas, DANFE, XML)
  app/api/                  -> 52 rotas de API (login, users, vendas, PIX,
                               boletos, notas, cargas, estoque, push...)
  components/doce/          -> telas do sistema (Admin, Vendedor, PDV,
                               FilaEntregas, Cupom, WizardPagamento...)
  lib/                      -> regras de negócio (comissão, caixa, PIX,
                               DANFE, fiscal, sessão, Supabase)
  services/                 -> clientes de serviço (vendas, produtos, cargas...)
db/                         -> SQLite placeholder (Prisma não é usado no app real)
sql/, supabase/             -> migrações SQL do histórico (blocos 5–118)
docs/                       -> BOLETOS-INTER.md, NOTAS-FISCAIS.md
worklog.md                  -> histórico completo de desenvolvimento
```

## Login

A lista de usuários aparece na tela inicial (igual ao site); a entrada é
feita com o **PIN de cada usuário**. Os PINs existem apenas como hash
bcrypt no banco de produção — quem conhece os PINs é a equipe.
O login oculto de ENTREGADOR é ativado com 5 toques no logo.
