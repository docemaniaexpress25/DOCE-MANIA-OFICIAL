# API Inter — Cobrança V3 (Bolepix): GET /cobranca/v3/cobrancas

> Pesquisa verificada em 24/11/2026. Fonte primária: spec OpenAPI oficial do portal
> (redocusaurus/swagger-cobranca-bolepix-yaml.yaml), servida em
> `https://developers.inter.co/redocusaurus/swagger-cobranca-bolepix.yaml` —
> página da referência: https://developers.inter.co/references/cobranca-bolepix
> Cópia local da spec: `docs/specs/swagger-cobranca-bolepix.yaml` (e a V2
> deprecada em `docs/specs/swagger-cobranca-v2-deprecated.yaml`).

## 1. Parâmetros aceitos (operationId `pesquisaCobranca`)

Query (nomes EXATOS na URL):

| Parâmetro | Obrigatório | Tipo/formato | Observação |
|---|---|---|---|
| `dataInicial` | **SIM** | `date` (YYYY-MM-DD) | "Data de vencimento do título" |
| `dataFinal` | **SIM** | `date` (YYYY-MM-DD) | "Data de fim do filtro" |
| `filtrarDataPor` | não | enum | `VENCIMENTO` (default), `EMISSAO`, `PAGAMENTO` |
| `situacao` | não | enum SituacaoCobrancaEnum | filtro por situação |
| `pessoaPagadora` | não | string | nome do pagador |
| `cpfCnpjPessoaPagadora` | não | string (1–18) | CPF/CNPJ do pagador |
| `seuNumero` | não | string (max 15) | seu número |
| `tipoCobranca` | não | enum | `SIMPLES`, `PARCELADO`, `RECORRENTE` |
| `paginacao.itensPorPagina` | não | int32, default **100**, **máx 1000** | = "size" |
| `paginacao.paginaAtual` | não | int32, default **0** | = "page" (0-based) |
| `ordenarPor` | não | enum, default **PESSOA_PAGADORA** | ver §3 |
| `tipoOrdenacao` | não | enum, default **ASC** | `ASC`/`DESC` |

Header opcional: `x-conta-corrente` (só quando a app tem >1 conta corrente).

**NÃO EXISTEM em V3:** `size`, `page`, `status`, `cpfCnpj`, `email`.
(`size`/`page`/`cpfCnpj`/`email` eram da API antiga: V2 `GET /cobranca/v2/boletos`
usava `nome`, `email`, `cpfCnpj`, `itensPorPagina`, `paginaAtual` — API
**descontinuada em 18/05/2026**.)

Escopo: `boleto-cobranca.read`. Rate limit: 120/min produção, 10/min sandbox.

## 2. Paginação

- `paginacao.paginaAtual` é **0-based** (default 0 — "Se não for informada, assumirá que será 0").
- `paginacao.itensPorPagina` default **100**, máximo **1000**, mínimo 1.
- SDK oficial Java começa em `page = 0` e itera até `totalPaginas` (confirma 0-based).

## 3. Ordenação

- `ordenarPor` **default = PESSOA_PAGADORA** (alfabética por nome do pagador!), `ASC`.
- NÃO vem ordenada por emissão/vencimento por padrão. Para cronológico:
  `ordenarPor=DATA_EMISSAO` ou `DATA_VENCIMENTO` (com `tipoOrdenacao=ASC|DESC`).
- Opções: PESSOA_PAGADORA, TIPO_COBRANCA, CODIGO_COBRANCA, IDENTIFICADOR,
  DATA_EMISSAO, DATA_VENCIMENTO, VALOR, STATUS.

## 4. Formato da resposta (schema `CobrancasResponse`)

```json
{
  "totalPaginas": 5,
  "totalElementos": 250,
  "tamanhoPagina": 50,
  "primeiraPagina": true,
  "ultimaPagina": false,
  "numeroDeElementos": 50,
  "cobrancas": [
    {
      "cobranca": {
        "codigoSolicitacao": "uuid",
        "seuNumero": "123456",
        "situacao": "A_RECEBER",
        "dataSituacao": "2024-12-31",
        "dataEmissao": "...",
        "dataVencimento": "YYYY-MM-DD",
        "valorNominal": "100.50",
        "valorTotalRecebido": "100.50",
        "origemRecebimento": "BOLETO|PIX",
        "tipoCobranca": "SIMPLES",
        "pagador": { "nome": "...", "cpfCnpj": "01234567890" }
      },
      "boleto": { "nossoNumero": "...", "codigoBarras": "...(44)", "linhaDigitavel": "...(47)" },
      "pix": { "txid": "...", "pixCopiaECola": "..." }
    }
  ]
}
```

- Array = chave **`cobrancas`** (não `itens`).
- Paginação: **`totalPaginas`** (não existe `qtdPaginas`), `totalElementos`,
  `tamanhoPagina`, `primeiraPagina`, `ultimaPagina`, `numeroDeElementos`.
- `boleto` pode faltar se situação = EM_PROCESSAMENTO; `pix` pode faltar se não houver Pix.

## 5. Valores de `situacao` (SituacaoCobrancaEnum)

`RECEBIDO`, `A_RECEBER`, `MARCADO_RECEBIDO`, `ATRASADO`, `CANCELADO`,
`EXPIRADO`, `FALHA_EMISSAO`, `EM_PROCESSAMENTO`, `PROTESTO`.

- **Boleto VENCIDO e não pago = `ATRASADO`** (changelog oficial de migração:
  "ATRASADO (substitui VENCIDO)").
- `EXPIRADO` = título fora do prazo, não pode mais ser pago (no mundo boleto/CIP
  do Inter o título expirado é removido da base da CIP — changelog 18/10/2022).
- Mapeamento V2→V3: RECEBIDO←PAGO, A_RECEBER←EMABERTO, ATRASADO←VENCIDO,
  CANCELADO←CANCELADO; novos: MARCADO_RECEBIDO, FALHA_EMISSAO,
  EM_PROCESSAMENTO, PROTESTO, EXPIRADO.

## 6. Limite da janela dataInicial→dataFinal

**Indefinido / não documentado**: nem a spec V3 nem a V2 deprecada declaram
limite de dias (não há "180 dias" na spec). A paginação (`itensPorPagina` máx
1000) é o mecanismo previsto. O "180 dias" usado no projeto é convenção interna
(`JANELA_DIAS` em `src/app/api/cobrancas/route.ts`), não limite da API.

## Corroboração externa

- SDK oficial Java (inter-co/pj-sdk-java): `inter/sdk/billing/billing/BillingClient.java`
  monta `?dataInicial=..&dataFinal=..&paginacao.paginaAtual=..&paginacao.itensPorPagina=..&filtrarDataPor=..&situacao=..&pessoaPagadora=..&cpfCnpjPessoaPagadora=..&seuNumero=..&tipoCobranca=..&ordenarPor=..&tipoOrdenacao=..`
  https://github.com/inter-co/pj-sdk-java
- SDK oficial C# (inter-co/pj-sdk-csharp): idem, `BillingPage` com
  `[JsonPropertyName("cobrancas")]`, `totalPaginas`, etc.
  https://github.com/inter-co/pj-sdk-csharp
- Changelog oficial da migração V2→V3 (18/05/2026 e 05/12/2025):
  https://developers.inter.co/changelog/18/05/2026 e /changelog/05/12/2025
  (mostra response de lista com `cobrancas[]`, `totalPaginas`... e o mapa de situações).

## ⚠️ Divergência encontrada no código do projeto

`src/lib/interBoleto.ts` → `listarCobrancas()`:
- envia `size=` e `page=` (parâmetros inexistentes em V3) em vez de
  `paginacao.itensPorPagina` / `paginacao.paginaAtual`;
- procura array em `data.itens` em vez de **`data.cobrancas`**;
- usa `qtdPaginas` em vez de **`totalPaginas`**.

Resultado esperado: a coleção volta vazia (chave errada) e sem paginação
efetiva (parâmetros ignorados pela API). Correção sugerida:

```ts
const qs = new URLSearchParams({
  dataInicial: opts.dataInicial,
  dataFinal: opts.dataFinal,
  'paginacao.itensPorPagina': String(size),
  'paginacao.paginaAtual': String(pagina),
});
// array: data.cobrancas ; paginas: data.totalPaginas
// size pode ir até 1000 (default 100)
```
