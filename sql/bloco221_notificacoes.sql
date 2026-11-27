-- ============================================================================
-- BLOCO 221 — NOTIFICACOES DE BAIXA (aviso aos admins) + LOG DE BAIXAS
-- ---------------------------------------------------------------------------
-- O que faz:
--   1. Cria a tabela `notificacoes`: cada baixa automatica (webhook do Inter,
--      cron/auto-sync, consulta manual) grava um aviso aqui e o SINO do app
--      do admin mostra ("toda baixa a gente seja comunicado").
--   2. Reafirma as colunas de origem da baixa em `sales` (SQL 172): se ainda
--      nao rodou, cria `baixa_origem` e `baixa_em` — o Log de Baixas depende
--      delas. Se ja rodou, nada muda (idempotente).
--
-- Como rodar: Supabase > SQL Editor > colar TUDO e clicar em RUN.
-- Seguro para rodar quantas vezes quiser (idempotente).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- PARTE A — TABELA NOTIFICACOES (aviso no sino do admin a cada baixa)
-- ---------------------------------------------------------------------------
create table if not exists public.notificacoes (
  id          uuid primary key default gen_random_uuid(),
  perfil_alvo text not null default 'ADMIN',   -- quem recebe (hoje: ADMIN)
  tipo        text not null default 'BAIXA_BOLETO',
  titulo      text not null,
  mensagem    text not null,
  sale_id     text,
  origem      text,                             -- WEBHOOK_INTER / CRON_INTER / MANUAL / PIX_PORTAL
  valor       numeric,
  lida        boolean not null default false,
  criado_em   timestamptz not null default now()
);

-- RLS fechada: o app le/escreve SOMENTE pela API do sistema (service_role).
alter table public.notificacoes enable row level security;
revoke all on public.notificacoes from anon, authenticated;

create index if not exists idx_notif_admin_criado
  on public.notificacoes (perfil_alvo, criado_em desc);
create index if not exists idx_notif_nao_lidas
  on public.notificacoes (lida) where lida = false;

-- ---------------------------------------------------------------------------
-- PARTE B — ORIGEM DA BAIXA EM SALES (reafirma o SQL 172, idempotente)
-- ---------------------------------------------------------------------------
alter table public.sales add column if not exists baixa_origem text;
alter table public.sales add column if not exists baixa_em timestamptz;

create index if not exists idx_sales_baixa_em
  on public.sales (baixa_em desc) where baixa_origem is not null;

-- ---------------------------------------------------------------------------
-- PRONTO. A partir daqui:
--   * cada boleto/parcela pago vira um AVISO no sino do app (todas as abas);
--   * o "Log de Baixas" (novo card da HOME do admin) lista cada baixa com
--     cliente, valor, origem e hora;
--   * o sync roda varias vezes por dia (cron 07h + auto-sync de 60 em 60 min
--     enquanto o sistema e usado) — sem mudanca na Vercel.
-- ============================================================================
