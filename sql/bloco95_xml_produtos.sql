-- ============================================================================
-- BLOCO 95 — FISCAL: FILA DE PRODUTOS VINDOS DAS XMLs DE COMPRA (Spedy)
-- Rodar no SQL Editor do Supabase (produção). Pode copiar e colar inteiro.
-- IDEMPOTENTE: pode rodar 2x sem duplicar nada (IF NOT EXISTS em tudo).
--
-- O QUE FAZ:
--   Cria as 2 tabelas da aba "XML → Produtos" do admin:
--     xml_importacoes — cabeçalho de cada NF-e de compra importada
--                      (chave UNIQUE = dedupe; xml_text = backup integral)
--     xml_itens       — FILA de sincronização: cada item da nota vira uma
--                      linha PENDENTE com NCM/EAN/unidade/custo da XML, que o
--                      dono VINCULA a um produto existente (completa o fiscal
--                      onde estiver vazio), CRIA produto novo ou IGNORA.
--
-- GARANTIAS (o que este SQL NÃO MEXE):
--   • products — NÃO é alterado. O VINCULAR da fila só preenche
--     ncm/ean/unidade em campos VAZIOS, via API, nunca via SQL.
--   • sales / commissions / contas a receber — nem citadas.
--   • Fluxo de venda (pronta entrega / pré-venda): ZERO mudança — os
--     vendedores em rota seguem vendendo exatamente como sempre.
--   • RLS: ambas com service_role only (nenhuma policy para anon/auth) —
--     só as API routes do app (admin) mexem nelas.
-- ============================================================================

-- ============================================================================
-- PASSO 1 — TABELAS (idempotente)
-- ============================================================================
CREATE TABLE IF NOT EXISTS xml_importacoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave         text NOT NULL,                       -- 44 dígitos (UNIQUE = dedupe)
  origem        text NOT NULL DEFAULT 'UPLOAD',      -- UPLOAD | SPEDY_INBOUND
  emit_cnpj     text,
  emit_nome     text,
  emit_ie       text,
  numero        text,                                -- nNF
  serie         text,
  data_emissao  timestamptz,
  valor_total   numeric(14,2),
  qtd_itens     integer NOT NULL DEFAULT 0,
  xml_text      text,                                -- backup integral da nota
  criado_em     timestamptz NOT NULL DEFAULT now()
);

-- Única por chave: re-importar o mesmo XML cai aqui e não duplica
CREATE UNIQUE INDEX IF NOT EXISTS xml_importacoes_chave_key ON xml_importacoes (chave);
CREATE INDEX IF NOT EXISTS xml_importacoes_criado_em_idx ON xml_importacoes (criado_em DESC);

CREATE TABLE IF NOT EXISTS xml_itens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id  uuid NOT NULL REFERENCES xml_importacoes(id) ON DELETE CASCADE,
  c_prod         text,                               -- código do produto NO FORNECEDOR
  c_ean          text,                               -- EAN/GTIN da XML ('' quando SEM GTIN)
  x_prod         text NOT NULL,                      -- descrição do fornecedor
  ncm            text,
  cfop           text,                               -- CFOP de ENTRADA (não vira CFOP de venda!)
  unidade        text DEFAULT 'UN',
  quantidade     numeric(14,4),
  valor_unitario numeric(14,4),                      -- custo real de compra
  valor_total    numeric(14,4),
  cst_icms       text,                               -- CST da entrada (60 = ST → CSOSN 500 na saída)
  csosn_icms     text,
  produto_id     uuid REFERENCES products(id),       -- vínculo com o catálogo
  status         text NOT NULL DEFAULT 'PENDENTE',   -- PENDENTE | VINCULADO | CRIADO | IGNORADO
  resolvido_em   timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS xml_itens_status_idx ON xml_itens (status);
CREATE INDEX IF NOT EXISTS xml_itens_importacao_idx ON xml_itens (importacao_id);
CREATE INDEX IF NOT EXISTS xml_itens_produto_idx ON xml_itens (produto_id);

-- ---------------------------------------------------------------------------
-- RLS: ligado SEM policy = só service_role (as API routes admin) acessa.
-- ---------------------------------------------------------------------------
ALTER TABLE xml_importacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE xml_itens ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PASSO 2 — CONFERÊNCIA (rodar e conferir a saída)
-- ============================================================================
SELECT 'xml_importacoes' AS tabela, count(*) AS linhas FROM xml_importacoes
UNION ALL
SELECT 'xml_itens', count(*) FROM xml_itens;

-- Estrutura criada:
--   \d xml_importacoes
--   \d xml_itens

-- ============================================================================
-- ROLLBACK (só se quiser desfazer — a fila é toda reconstruída re-importando)
-- ============================================================================
-- DROP TABLE IF EXISTS xml_itens CASCADE;
-- DROP TABLE IF EXISTS xml_importacoes CASCADE;
