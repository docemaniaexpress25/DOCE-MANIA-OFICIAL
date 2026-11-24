-- BLOCO 215 — CARGAS FISCAL: remessa para venda ambulante (CFOP 5949) da
-- carga do vendedor + devolução automática do remanescente (CFOP 1949).
--
-- Pergunta do dono: "carregamos 50cxs para o vendedor vender a pronta entrega,
-- lá em carga será gerado um documento, por fim quando eu clicar em devolver
-- será feita a devolução tudo automaticamente".
--
-- Cada linha é UM documento fiscal de carga:
--   tipo 'REMESSA'   -> NF-e 55 CFOP 5949 SEM PAGAMENTO (a carga que saiu);
--   tipo 'DEVOLUCAO' -> NF-e 55 de ENTRADA CFOP 1949, finalidade 4, referen-
--                       ciando a chave da remessa (chave_remessa).
-- `itens` guarda o SNAPSHOT (produto/nome/qtd/valor/carregado/vendido/devolve)
-- para a devolução nunca depender de preço/estoque do dia.
-- `payload` guarda o payload Focus (v2.0) montado — rascunho auditable quando
-- a emissão automática não está ligada (FOCUS_NFE_TOKEN ausente).
--
-- Rode no SQL Editor do Supabase. Depois a sonda hasCargasFiscalTable()
-- (cache 30s) autocorrige sem deploy.

create table if not exists cargas_fiscal (
  id uuid primary key default gen_random_uuid(),
  vendedor_id uuid not null,
  vendedor_nome text not null default '',
  tipo text not null,                    -- REMESSA | DEVOLUCAO
  status text not null default 'RASCUNHO', -- RASCUNHO | EMITINDO | AUTORIZADA | REJEITADA | CANCELADA | DEVOLVIDA
  itens jsonb not null default '[]'::jsonb,
  valor_total numeric not null default 0,
  focus_ref text,                        -- REF idempotente na Focus (CARGA-<vendedor>-<data>)
  payload jsonb,                         -- payload v2.0 montado (auditoria/emissão manual)
  nota_numero text,
  nota_serie text,
  nota_chave text,
  nota_protocolo text,
  pdf_url text,
  xml_url text,
  erro text,
  ref_remessa text,                      -- (devolução) focus_ref da remessa devolvida
  chave_remessa text,                    -- (devolução) chave 44 da remessa referenciada
  devolvida_em timestamptz,
  data_autorizacao timestamptz,
  criado_em timestamptz not null default now()
);

alter table cargas_fiscal enable row level security;

create index if not exists cargas_fiscal_vendedor_idx
  on cargas_fiscal (vendedor_id, criado_em desc);

create index if not exists cargas_fiscal_ref_idx
  on cargas_fiscal (focus_ref);
