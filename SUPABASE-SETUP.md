# SUPABASE — O que precisa existir no banco (guia completo)

Este documento responde: **"o que preciso criar no Supabase para o sistema DOCE MANIA funcionar?"**

> O script pronto e idempotente está em **`sql/00-SETUP-COMPLETO-SUPABASE.sql`** — basta abrir o
> SQL Editor do Supabase, colar o arquivo inteiro e rodar. Ele cria tabelas, colunas, funções (RPCs),
> triggers, índices, buckets e policies sem quebrar nada que já exista.

---

## 1. Resumo rápido

O app **NÃO usa o Prisma/SQLite local**. Todo o dado real fica no **Supabase (PostgreSQL)**:

| Camada | Acesso |
| --- | --- |
| API routes (`/api/*`) | Supabase com `SUPABASE_SERVICE_ROLE_KEY` (bypassa RLS) |
| Browser (services em `src/services`) | Supabase com a **anon key** direto nas tabelas operacionais |
| Storage | buckets `product-images` (público), `notas-fiscais`, `comprovantes`, `fotos-pedidos` (privados) |

Importante: **seu banco de produção atual (projeto `eyjhqjrczzpfthsddlpg`) já tem tudo isso aplicado** —
o sistema está rodando na Vercel. Este setup serve para (a) recriar o banco do zero em um projeto novo,
ou (b) conferir/consolidar o que já existe.

---

## 2. Tabelas (27)

### Dados operacionais (browser usa anon direto — policy permissiva)
| Tabela | Para quê |
| --- | --- |
| `app_users` | Usuários + perfis (ADMIN/VENDEDOR/ENTREGADOR/SECRETARIO), PIN bcrypt, flags `pre_venda`/`rota2` |
| `clients` | Clientes, rota, `portal_code` (portais /cliente e /pedido), cliente especial GB, modo cupom |
| `products` | Catálogo, preços (venda/mínimo/custo/cupom/GB), comissão PE+PV, 3 estoques (principal/nota/semnf), fiscal (NCM/CEST/CFOP/EAN), foto, obs |
| `sales` | Vendas (PRONTA/PRE_VENDA), entrega, trocas, prioridade, fiscal (`nota_*`), boleto Inter (`inter_boleto_*`) |
| `sale_items` | Itens da venda + `custo_unitario` congelado (Bloco 80) |
| `commissions` | Comissões por venda (A_RECEBER/DISPONIVEL/PAGO) + `valor_pago` FIFO |
| `commission_payment_logs` | Histórico dos repasses pagos |
| `seller_expenses` | Despesas do vendedor (abatem no lucro da rota) |
| `cargas` | Estoque da VAN por vendedor |
| `cargas_pendentes` | Cargas enviadas aguardando aceite do vendedor |
| `app_settings` | Linha única `global_settings`: logo, margens, PIX, ordem PDV/portal, melhorias, `erp_config` |
| `app_config` | Chave/valor (`comissao_pre_venda_pct`) |
| `system_messages` | Avisos internos (sino do vendedor) |
| `product_categories` / `product_subcategories` | Categorias do catálogo |
| `payment_comprovantes` | Comprovantes Pix enviados pelo portal do cliente |
| `push_tokens` | Tokens de notificação push (VAPID) |

### Servidor (RLS fechada — só service_role das APIs)
| Tabela | Para quê |
| --- | --- |
| `entrega_rotas` / `entrega_eventos` | Rotas de entrega + timeline com GPS/foto |
| `caixa_fechamentos` | Fechamento de caixa por entregador (Bloco 13) |
| `caixa_fechamentos_geral` / `caixa_pagamentos` | Caixa do David/R5: ledger de pagamentos + snapshot do fechamento (Bloco 118) |
| `daily_routes` | Rota do dia do vendedor (clientes selecionados/pulados) |
| `user_locations` | Última posição GPS por usuário |
| `xml_importacoes` / `xml_itens` | Fila fiscal: XMLs de compra → vincular/criar produtos |
| `spedy_webhook_events` / `notas_recebidas` | Integração Spedy (compras, DFe) |
| `estoque_movimentos` | KARDEX — todo movimento de estoque (Bloco 108) |

---

## 3. Funções (RPCs) e triggers

**Com corpo oficial no repo (copiados no setup):**
- `baixar_estoque_principal(p_sale_id)` — baixa estoque de casa ao entregar (modo-aware, Bloco 29)
- `pre_venda_estorna_item` / `pre_venda_estorna_venda` / `pre_venda_atualiza_rota` + triggers — estorno na exclusão
- `setar_custo_unitario_venda` + trigger `trg_custo_unitario_sale_items` — congela custo (Bloco 80)
- `trg_sale_items_kardex` + trigger `trg_kardex_sale_items` — SAÍDA/ESTORNO no Kardex (Bloco 108)
- `registrar_movimento_estoque(...)` — entrada/saída atômica de estoque
- `aceitar_carga_vendedor(p_carga_pendente_id)` — aceite de carga (Bloco 11B)
- `trg_comissoes_skip_david` + trigger — não calcula comissão para o David/R5 (Bloco 118)
- `clean_old_push_tokens()`

**Sem corpo no repo — reconstruídas pelo comportamento do código (INFERIDO, marcardas no SQL):**
- `processar_venda_v2(...)` → grava venda + itens + baixa a van (retorna `sale_id`)
- `excluir_venda_estornar_estoque(p_sale_id)` → estorna van, apaga rastros e a venda
- `apply_carga_admin(p_vendedor_id, p_itens)` → substitui carga da van
- `get_sugestoes_cliente(p_client_id)` → sugestões do portal (`produto_id`, `nome`)

> **Atenção:** as versões inferidas cobrem o caminho básico do app. No banco de produção as funções
> originais têm detalhes que não estão no repo. Se for recriar um banco novo e algo divergir
> (ex.: comissão gravada pelo RPC), ajustamos a função juntos.

---

## 4. Storage (4 buckets)

| Bucket | Público | Uso |
| --- | --- | --- |
| `product-images` | SIM | Fotos do catálogo (URL pública direta) |
| `notas-fiscais` | não | DANFE PDF / XML arquivados das notas (Focus) |
| `comprovantes` | não | Comprovantes Pix do portal do cliente |
| `fotos-pedidos` | não | Fotos de entrega/caixa |

O app cria os buckets automaticamente se faltarem, mas o setup já garante.

---

## 5. Variáveis de ambiente (Vercel / `.env.local`)

### Obrigatórias (produção)
| Variável | Para quê |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (browser) |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend das API routes (**obrigatória**) |
| `SESSION_SECRET` | Assinatura HMAC das sessões (fallback: derivada da service key) |

### Fiscal — Focus NFe
`FOCUS_NFE_TOKEN` · `FOCUS_NFE_AMBIENTE` (produção/homologação) · `FOCUS_NFE_NATUREZA` ·
`FOCUS_NFE_UF_EMITENTE` (RS) · `FOCUS_NFE_CNPJ` · `FOCUS_NFE_IE` · `FOCUS_NFE_RAZAO` ·
`FOCUS_NFE_FANTASIA` · `FOCUS_NFE_LOGRADOURO` · `FOCUS_NFE_NUMERO` · `FOCUS_NFE_BAIRRO` ·
`FOCUS_NFE_MUNICIPIO` · `FOCUS_NFE_CEP` · `FOCUS_NFE_REGIME` · `FOCUS_WEBHOOK_SECRET`

### Banco Inter (boletos)
`INTER_CLIENT_ID` · `INTER_CLIENT_SECRET` · `INTER_CERT`+`INTER_KEY` **ou** `INTER_P12`+`INTER_P12_SENHA` ·
`INTER_CONTA_CORRENTE` · `INTER_AMBIENTE`

### PIX
`PIX_KEY` · `PIX_NAME` · `PIX_CITY` (podem ser sobrescritos no app: Configurações → chave de entrega)

### Push (notificações)
`VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

### Spedy (fiscal alternativa — dormente)
`SPEDY_API_KEY` · `SPEDY_AMBIENTE` · `SPEDY_EMPRESA_ID` · `SPEDY_NATUREZA` ·
`SPEDY_UF_EMITENTE` · `SPEDY_WEBHOOK_SECRET` · `SPEDY_ENABLED` (só liga com `=1`)

### Opcionais / utilidades
| Variável | Para quê |
| --- | --- |
| `CRON_SECRET` | Protege o cron `/api/notas-sync` (diário 12h UTC) e o webhook Focus |
| `GOUP_API_KEY` / `COSMOS_TOKEN` | Autocomplete de EAN (fontes pagas; sem elas usa Open Food Facts) |
| `DM_PROD_URL` / `DM_DEV_BRIDGE` | Ponte de desenvolvimento (abaixo) |

---

## 6. Desenvolvimento local — a "ponte de desenvolvimento"

Sem `SUPABASE_SERVICE_ROLE_KEY` no `.env.local`, o backend local **repassa automaticamente** as
chamadas de API para o deploy de produção (`DM_PROD_URL`, default `https://sistema-doce-mania1.vercel.app`).

- O app local fica **100% funcional** (login, dados reais, notas, PIX) — é assim que ele roda neste ambiente.
- Desligar: `DM_DEV_BRIDGE=off`.
- Para operar com banco PRÓPRIO local, configure `SUPABASE_SERVICE_ROLE_KEY` + URL do seu projeto.

---

## 7. Cron

`vercel.json` agenda `GET /api/notas-sync` diariamente às **12:00 UTC** (09h Brasília):
reconsulta as notas em status `EMITINDO` na Focus e espelha o resultado. Protegido por `CRON_SECRET`.

---

## 8. Checklist de verificação

1. Rode o `sql/00-SETUP-COMPLETO-SUPABASE.sql` no SQL Editor.
2. Confirme: `select routine_name from information_schema.routines where routine_schema='public' and routine_type='FUNCTION';`
   deve listar `processar_venda_v2`, `registrar_movimento_estoque`, `baixar_estoque_principal`, etc.
3. Confirme os buckets: `select id, public from storage.buckets;`
4. No app, entre como ADMIN e abra **`/api/diagnostico-banco`** — ele checa por bloco SQL o que está
   aplicado e o que falta (tabelas, colunas, RPCs).
5. Login inicial do admin criado pelo seed: PIN **123456** (troque no primeiro acesso).
   Os PINs dos usuários reais existem só como hash — quem conhece é a equipe.
