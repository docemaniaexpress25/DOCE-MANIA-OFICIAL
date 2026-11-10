-- ============================================================================
-- BLOCO 108 — KARDEX DE ESTOQUE + MODO CUPOM (NFC anônima com preço cupom)
-- ============================================================================
-- Rodar no SQL Editor do Supabase. Idempotente (pode rodar quantas vezes
-- quiser). Degradação graciosa no app: enquanto NÃO rodar, a tela de
-- movimentações mostra aviso e o modo cupom continua funcionando com
-- fallback (preço de custo) — nada quebra.
--
-- IMPORTANTE — ESTE SQL NÃO MUDA A ROTINA DE VENDA:
--   Nada aqui liga NFC automática, não muda preço, não mexe no estoque
--   existente e não altera nenhum fluxo. As rotas continuam vendendo
--   só cupom EXATAMENTE como hoje. Todo switch nasce OFF e só liga
--   depois, na tela Configurações > ERP Fiscal & Automações.
--
-- 1. estoque_movimentos — o KARDEX: TODO movimento de estoque registrado
--    (entrada XML/manual, saída de venda, ajuste, estorno) com quem fez,
--    quando, custo e saldo após. O admin vê TODAS as entradas e saídas.
-- 2. Trigger em sale_items — registra SAÍDA na venda e ESTORNO na exclusão
--    AUTOMATICAMENTE (aprovado a falhas: se o kardex falhar, a venda segue).
--    Blindado: funciona MESMO SEM o Bloco 80 (custo_unitario fica NULL
--    em vez de quebrar) e aceita produto_id OU product_id.
-- 3. RPC registrar_movimento_estoque — entrada/saída manual ATÔMICA
--    (grava movimento + atualiza estoque_principal na mesma transação).
-- 4. products.preco_cupom — o "preço da caixa" para o MODO CUPOM: cliente
--    que quer só cupom paga o preço normal da venda, mas a NFC-e anônima
--    que alimenta a fiscal sai com ESTE preço (0 = usa o preço de custo).
-- 5. clients.modo_cupom — marca o cliente que "quer somente cupom"
--    (sem NF-e e sem NFC-e identificada).
-- 6. app_settings.erp_config — central de automações (liga/desliga) que a
--    tela ERP Fiscal & Automações grava (emitente Focus, switches).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. KARDEX — estoque_movimentos
-- ---------------------------------------------------------------------------
create table if not exists estoque_movimentos (
  id             uuid primary key default gen_random_uuid(),
  produto_id     uuid not null,
  tipo           text not null check (tipo in ('ENTRADA','SAIDA','AJUSTE','ESTORNO')),
  origem         text not null default 'MANUAL',   -- VENDA | MANUAL | XML | CARGA
  referencia     text,                             -- sale_id / identificador do XML / obs
  quantidade     numeric(12,3) not null,           -- SEMPRE positiva (o tipo define a direção)
  custo_unitario numeric(12,4),                    -- custo congelado no momento (quando houver)
  saldo_apos     numeric(12,3),                    -- estoque_principal após movimento manual
  usuario_id     uuid,
  usuario_nome   text,
  criado_em      timestamptz not null default now()
);

alter table estoque_movimentos enable row level security;
-- RLS fechada de propósito (sem políticas): só o service_role das APIs do
-- app enxerga o kardex. Nenhum usuário direto mexe no histórico.
create index if not exists idx_kardex_produto on estoque_movimentos (produto_id, criado_em desc);
create index if not exists idx_kardex_tipo    on estoque_movimentos (tipo, criado_em desc);
create index if not exists idx_kardex_data    on estoque_movimentos (criado_em desc);
create index if not exists idx_kardex_ref     on estoque_movimentos (referencia);

-- ---------------------------------------------------------------------------
-- 2. TRIGGER — toda venda registra SAÍDA; exclusão registra ESTORNO.
--    SECURITY DEFINER + EXCEPTION swallow: o kardex NUNCA pode quebrar uma
--    venda (regra "aprovado a falhas" do dono).
--    BLINDAGEM: lê as colunas via to_jsonb(NEW/OLD) — se o Bloco 80 ainda
--    não rodou (custo_unitario ausente) o custo vem NULL e o movimento é
--    gravado do mesmo jeito; e funciona com produto_id OU product_id
--    (a tabela real tem as duas).
-- ---------------------------------------------------------------------------
create or replace function trg_sale_items_kardex()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v         jsonb := to_jsonb(coalesce(new, old));
  v_produto uuid;
  v_qtd     numeric;
  v_custo   numeric;
begin
  -- produto: tenta produto_id, cai para product_id (legado). Nulo = pula.
  v_produto := nullif(v->>'produto_id', '')::uuid;
  if v_produto is null then
    v_produto := nullif(v->>'product_id', '')::uuid;
  end if;
  if v_produto is null then
    return coalesce(new, old);
  end if;

  v_qtd := nullif(v->>'quantidade', '')::numeric;
  if v_qtd is null or v_qtd = 0 then
    return coalesce(new, old);
  end if;

  -- custo congelado (Bloco 80). Ausente = NULL, sem erro.
  v_custo := nullif(v->>'custo_unitario', '')::numeric;

  if (tg_op = 'INSERT') then
    insert into estoque_movimentos (produto_id, tipo, origem, referencia, quantidade, custo_unitario)
    values (v_produto, 'SAIDA', 'VENDA', v->>'sale_id', v_qtd, v_custo);
  elsif (tg_op = 'DELETE') then
    insert into estoque_movimentos (produto_id, tipo, origem, referencia, quantidade, custo_unitario)
    values (v_produto, 'ESTORNO', 'VENDA', v->>'sale_id', v_qtd, v_custo);
  end if;
  return coalesce(new, old);
exception when others then
  -- Kardex é observador: qualquer falha aqui NUNCA bloqueia a venda.
  return coalesce(new, old);
end $$;

drop trigger if exists trg_kardex_sale_items on sale_items;
create trigger trg_kardex_sale_items
  after insert or delete on sale_items
  for each row execute function trg_sale_items_kardex();

-- ---------------------------------------------------------------------------
-- 3. RPC ATÔMICO — entrada/saída manual (XML, ajuste, devolução):
--    grava o movimento E atualiza o estoque_principal na MESMA transação.
--    Retorno: {"ok":true,"saldo":N} ou {"ok":false,"erro":"..."}
-- ---------------------------------------------------------------------------
create or replace function registrar_movimento_estoque(
  p_produto_id     uuid,
  p_tipo           text,        -- 'ENTRADA' | 'SAIDA'
  p_quantidade     numeric,
  p_origem         text default 'MANUAL',
  p_referencia     text default null,
  p_custo_unitario numeric default null,
  p_usuario_id     uuid default null,
  p_usuario_nome   text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta numeric;
  v_novo  numeric;
begin
  if p_quantidade is null or p_quantidade <= 0 then
    return json_build_object('ok', false, 'erro', 'Quantidade deve ser maior que zero.');
  end if;
  if p_tipo not in ('ENTRADA','SAIDA') then
    return json_build_object('ok', false, 'erro', 'Tipo deve ser ENTRADA ou SAIDA.');
  end if;

  v_delta := case p_tipo when 'ENTRADA' then p_quantidade else -p_quantidade end;

  update products
     set estoque_principal = greatest(0, coalesce(estoque_principal, 0) + v_delta)
   where id = p_produto_id
  returning estoque_principal into v_novo;

  if not found then
    return json_build_object('ok', false, 'erro', 'Produto não encontrado.');
  end if;

  insert into estoque_movimentos
    (produto_id, tipo, origem, referencia, quantidade, custo_unitario, saldo_apos, usuario_id, usuario_nome)
  values
    (p_produto_id, p_tipo, coalesce(p_origem, 'MANUAL'), p_referencia, p_quantidade,
     p_custo_unitario, v_novo, p_usuario_id, p_usuario_nome);

  return json_build_object('ok', true, 'saldo', v_novo);
exception when others then
  return json_build_object('ok', false, 'erro', sqlerrm);
end $$;

-- RPC só para o service_role (as APIs do app) — o público não mexe no estoque.
revoke execute on function registrar_movimento_estoque(uuid, text, numeric, text, text, numeric, uuid, text) from public;
revoke execute on function registrar_movimento_estoque(uuid, text, numeric, text, text, numeric, uuid, text) from anon;
revoke execute on function registrar_movimento_estoque(uuid, text, numeric, text, text, numeric, uuid, text) from authenticated;

-- ---------------------------------------------------------------------------
-- 4. MODO CUPOM — preço da "caixa" por produto (NFC anônima)
--    0 = sem preço cupom → a NFC usa o PREÇO DE CUSTO do produto.
-- ---------------------------------------------------------------------------
alter table products add column if not exists preco_cupom numeric(12,2) not null default 0;

-- ---------------------------------------------------------------------------
-- 5. Cliente que "quer somente cupom" (sem NF-e / NFC identificada)
-- ---------------------------------------------------------------------------
alter table clients add column if not exists modo_cupom boolean not null default false;

-- ---------------------------------------------------------------------------
-- 6. Central de automações (ERP Fiscal & Automações)
--    jsonb único: novas opções entram sem ALTER de novo.
--    chaves: nfeAutoPe, cupomDuploNfc, boletoAutoAReceber,
--            emitente { cnpj, ie, razao, fantasia, logradouro, numero,
--                       bairro, municipio, uf, cep, regime }
--    Tudo OFF/por padrão — nada muda na rotina até o dono ligar na tela.
-- ---------------------------------------------------------------------------
alter table app_settings add column if not exists erp_config jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- VERIFICAÇÃO (rode um a um depois de aplicar):
--   1) select count(*) from estoque_movimentos;                       -- deve dar 0
--   2) select nome, preco_cupom from products limit 5;                -- coluna existe
--   3) select modo_cupom, count(*) from clients group by 1;           -- coluna existe
--   4) select erp_config from app_settings where id = 'global_settings';
--
-- TESTE DO KARDEX (opcional, ao vivo):
--   5) select registrar_movimento_estoque(
--        (select id from products limit 1), 'ENTRADA', 5, 'MANUAL', 'teste-108');
--      → {"ok": true, "saldo": N}
--   6) select * from estoque_movimentos order by criado_em desc limit 5;
--   7) desfaz o teste: select registrar_movimento_estoque(
--        (select id from products limit 1), 'SAIDA', 5, 'MANUAL', 'rollback teste-108');
--   A partir de agora, TODA venda nova gravará SAÍDA sozinha (trigger), e
--   exclusão de item gravará ESTORNO. Edição de venda = estorno + saída nova.
--
-- ROLLBACK COMPLETO (se um dia precisar):
--   drop trigger if exists trg_kardex_sale_items on sale_items;
--   drop function if exists trg_sale_items_kardex();
--   drop function if exists registrar_movimento_estoque(uuid, text, numeric, text, text, numeric, uuid, text);
--   drop table if exists estoque_movimentos;
--   alter table products drop column if exists preco_cupom;
--   alter table clients drop column if exists modo_cupom;
--   alter table app_settings drop column if exists erp_config;
-- ----------------------------------------------------------------------------
