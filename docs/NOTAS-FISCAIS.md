# Notas Fiscais (NF-e / NFC-e) — Bloco 10

Emissão de nota no cliente na venda de pronta entrega, via **Focus NFe** (https://focusnfe.com.br).

## Como funciona no app

1. Vendedor fecha a venda no PDV → no modal de venda finalizada aparece **"Emitir Nota Fiscal"**.
2. O app chama `POST /api/notas { acao: 'EMITIR', saleId }` (server-side, service_role).
3. O servidor decide o documento automaticamente:
   - Cliente com **CNPJ válido** → **NF-e (modelo 55)** — o caso das mercearias.
   - Sem CNPJ válido → **NFC-e (modelo 65)** de consumidor.
4. A Focus assina o XML com o certificado A1 da empresa, envia à SEFAZ e devolve:
   - `AUTORIZADA` → botão **"Abrir DANFE (PDF)"** (manda pro WhatsApp do cliente).
   - `REJEITADA` → mostra o motivo da SEFAZ e permite reemitir (ref com sufixo `-r2`, `-r3`...).
5. Status também aparece no histórico de vendas (badge NF) e no detalhe da venda (Cupom).
6. **ADMIN** pode cancelar nota: `POST /api/notas { acao: 'CANCELAR', saleId, justificativa }` (just. mín. 15 caracteres).

## Passo a passo (uma vez só)

### 1. Supabase — rode o SQL do Bloco 10 (SQL Editor)

```sql
-- ===== BLOCO 10: NOTAS FISCAIS =====
alter table sales add column if not exists nota_status text;
alter table sales add column if not exists nota_tipo text;      -- NFE | NFCE
alter table sales add column if not exists nota_ref text;       -- ref idempotente na Focus
alter table sales add column if not exists nota_numero text;
alter table sales add column if not exists nota_pdf_url text;
alter table sales add column if not exists nota_xml_url text;
alter table sales add column if not exists nota_erro text;
alter table sales add column if not exists nota_emitida_em timestamptz;

alter table clients add column if not exists razao_social text;
alter table clients add column if not exists inscricao_estadual text;
alter table clients add column if not exists endereco_numero text;
alter table clients add column if not exists endereco_cep text;
alter table clients add column if not exists endereco_municipio text;
alter table clients add column if not exists endereco_uf text;

alter table products add column if not exists ncm text;
alter table products add column if not exists cest text;
alter table products add column if not exists cfop text;

create index if not exists idx_sales_nota_status on sales (nota_status) where nota_status is not null;
```

> Nada quebra antes do SQL rodar: a rota responde 503 com instruções (probe `serverSchema`).

### 2. Contador — alinhe códigos fiscais

- Confirme o regime (Simples Nacional → CSOSN `102` já é o padrão do payload).
- Pegue os **NCM** por grupo de produto (ex.: salgados de milho, batata, bebidas) e cadastre na tabela `products.ncm` (a API usa fallback `21069090` se vazio).
- CFOP é automático: `5102` (mesma UF) / `6102` (outra UF).

### 3. Certificado + SEFAZ

1. Compre o **certificado digital e-CNPJ A1** (~R$ 150–350/ano — Valid, Certisign, Serasa, Soluti).
2. Faça o **credenciamento na SEFAZ-RS** para NF-e/NFC-e (gratuito, online; homologação → produção).

### 4. Focus NFe

1. Crie a conta em focusnfe.com.br, cadastre a empresa (CNPJ, IE, endereço) e **suba o certificado A1** no painel.
2. Copie o **token de homologação** (e depois o de produção).
3. No Vercel, adicione as env vars e faça **Redeploy**:

| Env var | Valor |
|---|---|
| `FOCUS_NFE_TOKEN` | token da Focus (homologação primeiro) |
| `FOCUS_NFE_AMBIENTE` | `homologacao` → depois `producao` |
| `FOCUS_NFE_NATUREZA` | (opcional, default `Venda de mercadoria`) |
| `FOCUS_NFE_UF_EMITENTE` | (opcional, default `RS`) |

### 5. Teste e produção

1. Com `FOCUS_NFE_AMBIENTE=homologacao`, complete o cadastro fiscal de 2–3 clientes (CNPJ, razão social, IE, endereço completo, município, UF) e emita notas de teste.
2. Ajuste rejeições que aparecerem (cadastro do cliente, NCM do produto).
3. Troque para `producao` e valide a primeira nota real.

## Custo

- Focus NFe: **R$ 89,90/mês** inclui 100 notas; adicional ~**R$ 0,10/nota** (sem setup, sem fidelidade).
- Certificado A1: ~R$ 150–350/**ano**.
- Total estimado no volume atual (~200 vendas/mês): **~R$ 100–130/mês**.

## Arquivos

- `src/lib/focusNfe.ts` — cliente da API Focus v2 + validadores (CNPJ, endereço) + montagem do payload.
- `src/app/api/notas/route.ts` — EMITIR / CONSULTAR / CANCELAR (auth por sessão; vendedor só nas próprias vendas).
- `src/services/notaService.ts` — chamadas do browser.
- `src/components/doce/PDV.tsx` — botão no fechamento da venda.
- `src/components/doce/Cupom.tsx` — seção Nota Fiscal no detalhe da venda.
- `src/components/doce/VendedorDashboard.tsx` — badge NF no histórico.
- `src/components/doce/AdminDashboard.tsx` — dados fiscais no cadastro do cliente.

## Autocomplete de CNPJ (Bloco 10.1)

No cadastro de cliente (Admin **e** Vendedor), ao digitar o CNPJ completo
(14 dígitos) o app busca automaticamente na Receita Federal:

- **Razão social** e nome fantasia
- **Endereço oficial** (logradouro, número, bairro, município, UF, CEP)
- **Telefone** (só preenche se o campo estiver vazio)
- **Situação cadastral** — avisa se o CNPJ não estiver ATIVA
- **Simples Nacional / MEI** — aparece no feedback do formulário

### Como funciona

- Rota server-side `GET /api/cnpj?cnpj=...` (autenticada por sessão).
- Fontes em cascata: **BrasilAPI** → **minhareceita.org** (fallback).
- Cache em memória de 24h por instância (reconsulta não bate na fonte).
- Sem SQL novo, sem env var, sem chave de API, sem custo.

### Regra NF-e × NFC-e (automática no momento de emitir)

| Cadastro do cliente | Documento emitido |
| --- | --- |
| Com CNPJ válido | **NF-e (modelo 55)** — nota de entrada para a mercearia/rede |
| Sem CNPJ | **NFC-e (modelo 65)** — consumidor não identificado |

Inscrição Estadual não é pública na Receita — continua manual
(`ISENTO` para Simples Nacional, ou a IE que o cliente informar).

### Arquivos novos

- `src/app/api/cnpj/route.ts` — consulta Receita + cache + normalização.
- `src/lib/cnpjAutocomplete.ts` — máscara, busca e feedback (client-side).
