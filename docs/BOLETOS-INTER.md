# Boletos do Banco Inter (Bloco 25)

Geração de **boleto com PIX** (Cobrança V3) direto na venda, pelo app, via **API Cobrança do Inter**.
Docs oficiais: https://developers.inter.co/references/cobranca-bolepix

## Como funciona no app

1. Vendedor fecha a venda → no Cupom aparece o card **"Boleto bancário (boleto + pix)"** → botão **"Gerar Boleto"**.
2. O vendedor confirma **valor** (pré-preenchido com o saldo em aberto), **vencimento** (pré-hoje+7) e, se quiser, marca **"Atrelar NF-e"** (aparece quando a venda já tem nota AUTORIZADA).
3. O servidor chama a API do Inter (`POST /cobranca/v3/cobrancas`) com:
   - **pagador** = cadastro do cliente (nome, CPF/CNPJ, endereço). Cliente sem documento no cadastro aceita informar o CPF/CNPJ na tela.
   - **formasRecebimento** = `BOLETO + PIX` (o boleto sai com QR Code de PIX — chave Pix da conta do Inter).
   - **notaFiscal.chaveNFe** = chave de 44 dígitos da NF-e autorizada (quando marcado "Atrelar").
4. O Inter processa de forma **assíncrona** (`EM_PROCESSAMENTO` → `A_RECEBER`). O app consulta e mostra:
   - **Linha digitável** (toque para copiar), **PIX copia-e-cola** (toque para copiar), **PDF** e **Enviar pelo WhatsApp**.
5. Botão **"Atualizar"** consulta o Inter (situação: `A_RECEBER`, `RECEBIDO`, `ATRASADO`...).
6. **ADMIN** pode cancelar a cobrança no Inter (`POST .../cancelar` com motivo).

> Reemissão: se o boleto falhou/expirou, o botão "Gerar Novamente" emite um novo com sufixo `-r2`, `-r3`... (o Inter bloqueia cobrança idêntica em 30 min — o sufixo contorna).

## O que o DONO precisa fazer (uma vez só)

### 1. Internet Banking PJ do Inter — criar a aplicação

1. Entre no **Internet Banking (web) da conta PJ** → menu **Desenvolvedor** (ou "API") → **Aplicativos** → **Novo aplicativo**.
2. Ative a API **Cobrança (Boleto com Pix)** e os escopos:
   - `boleto-cobranca.read`
   - `boleto-cobranca.write`
3. No detalhe do aplicativo, copie:
   - **Client Id**
   - **Client Secret**
4. **Gere o certificado da aplicação** (o IB entrega o arquivo `.crt`/`.pem` e a **chave privada**, com senha). ⚠️ Guarde a chave privada com muito cuidado — ela é a identidade da empresa na API.
5. Se a conta tiver **mais de uma conta corrente**, anote o número da conta que vai receber (sem zeros à esquerda) — header `x-conta-corrente`.
6. Confira se a conta tem uma **chave Pix** cadastrada (para o boleto sair com QR Code Pix).

### 2. Vercel — variáveis de ambiente (Settings → Environment Variables)

| Variável | Valor |
|---|---|
| `INTER_CLIENT_ID` | Client Id da aplicação |
| `INTER_CLIENT_SECRET` | Client Secret da aplicação |
| `INTER_CERT` | conteúdo do certificado (PEM) — colar com `\n` ou em uma linha |
| `INTER_KEY` | conteúdo da chave privada (PEM) — ⚠️ segredo, nunca no chat |
| `INTER_CONTA_CORRENTE` | (opcional) número da conta corrente |
| `INTER_AMBIENTE` | (opcional) `sandbox` para testes; sem valor = produção |

> Alternativa ao par CERT/KEY: `INTER_P12` (arquivo .p12 em base64) + `INTER_P12_SENHA`.

Depois de salvar: **Redeploy** do projeto.

### 3. Supabase — rode o SQL do Bloco 25 (SQL Editor)

```sql
-- arquivo: sql/bloco25_boleto_inter.sql (copiar/colar inteiro)
```

Cria as colunas `sales.inter_boleto_*` e `sales.nota_chave` (chave de acesso da NF-e, para o campo `notaFiscal.chaveNFe` do boleto).

### 4. Teste

1. Faça uma venda (ou use uma com saldo em aberto) → Cupom → **Gerar Boleto**.
2. Confirme vencimento/valor → o card passa a `BOLETO A RECEBER` com linha digitável + PIX.
3. Toque em **PDF** (abre o boleto) e **Enviar** (WhatsApp com linha digitável e PIX).

## Custos/rates (API Inter)

- Rate limit: 120 chamadas/min por endpoint; token: 5 chamadas/min (o app cacheia por 55 min).
- Tarifas de boleto conforme o plano da conta PJ no Inter (mesma tarifa da emissão manual).
- Vencimento para o mesmo dia só pode ser emitido até 19h59 (regra do Inter).

## Segurança

- As credenciais do Inter ficam **somente no servidor** (Vercel env vars + mTLS). O app/celular nunca as vê.
- Vendedor só gera/consulta boleto das **próprias vendas**; admin em todas.
- Cancelamento de boleto: **somente ADMIN**.
