-- ============================================================
-- BLOCO 25 — BOLETO BANCARIO INTER (Cobranca V3 = Boleto com Pix)
-- Rodar no SQL Editor do Supabase. Idempotente (pode rodar 2x).
-- ============================================================
--
-- Por que: a venda precisa guardar a cobranca gerada na API do
-- Inter (codigoSolicitacao, linha digitavel, codigo de barras,
-- PIX copia-e-cola, situacao) para o vendedor consultar/reenviar
-- o boleto depois. Prefixo inter_ para nao confundir com a foto
-- do comprovante de entrega (entrega_eventos.foto, Bloco 6).
--
-- sales.nota_chave: chave de acesso (44 digitos) da NF-e
-- autorizada na Focus — necessaria para ATRELAR a nota ao
-- boleto no campo notaFiscal.chaveNFe da API Cobranca V3.
--
-- O app usa esses nomes de coluna exatamente (nao renomear):
--   sales.inter_boleto_status, sales.inter_boleto_codigo,
--   sales.inter_boleto_seu_numero, sales.inter_boleto_linha,
--   sales.inter_boleto_barras, sales.inter_boleto_pix,
--   sales.inter_boleto_vencimento, sales.inter_boleto_valor,
--   sales.inter_boleto_erro, sales.inter_boleto_em,
--   sales.nota_chave
-- ============================================================

alter table sales add column if not exists inter_boleto_status        text;
alter table sales add column if not exists inter_boleto_codigo        text;
alter table sales add column if not exists inter_boleto_seu_numero    text;
alter table sales add column if not exists inter_boleto_linha         text;
alter table sales add column if not exists inter_boleto_barras        text;
alter table sales add column if not exists inter_boleto_pix           text;
alter table sales add column if not exists inter_boleto_vencimento    date;
alter table sales add column if not exists inter_boleto_valor         numeric(10,2);
alter table sales add column if not exists inter_boleto_erro          text;
alter table sales add column if not exists inter_boleto_em            timestamptz;
alter table sales add column if not exists nota_chave                 text;

create index if not exists idx_sales_inter_boleto_status
  on sales (inter_boleto_status) where inter_boleto_status is not null;
create index if not exists idx_sales_nota_chave
  on sales (nota_chave) where nota_chave is not null;
