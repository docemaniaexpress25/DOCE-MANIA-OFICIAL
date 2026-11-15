-- BLOCO 62 — Chave Pix do recebimento editavel em Configuracoes
-- O QR Code do Pix a vista cobrado na entrega (e o portal do cliente) passa a
-- usar esta chave quando estiver configurada. Sem ela, continua o padrao
-- (env PIX_KEY / CPF 01735712043).
-- Rodar no SQL Editor do Supabase.

alter table app_settings add column if not exists pix_chave_entrega text;
