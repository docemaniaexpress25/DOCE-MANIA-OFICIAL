-- ============================================================
-- BLOCO 11 — Correções do fluxo de carga (carga zerada / sync)
-- Rodar no SQL Editor do Supabase. Sem destruição de dados.
-- ============================================================

-- 1) Cancela cargas pendentes ZERADAS (bug histórico de envio no admin:
--    o rascunho nascia vazio e o payload saía com tudo 0).
--    Com a correção no app, o botão "ACEITAR CARGA" também bloqueia
--    carga vazia — este UPDATE limpa as lixeiras que já estão no banco.
update cargas_pendentes
   set status = 'CANCELADA_ZERADA'
 where status = 'PENDENTE'
   and coalesce((
         select sum(coalesce((it->>'quantidade')::int, 0))
           from jsonb_array_elements(itens) it
       ), 0) <= 0;

-- 2) A pendente antiga de 11/09 (vendedor addfae58..., 1.321 unidades)
--    ficou travada porque o fluxo de aceite falhava em silêncio.
--    Com o app corrigido, o vendedor consegue aceitá-la pela aba
--    Minha Carga (vai substituir a carga atual pelos itens do dia 11).
--    Se preferir CANCELAR essa carga antiga, rode:
-- update cargas_pendentes
--    set status = 'CANCELADA_ADMIN'
--  where id = '6313c338-e8e9-44cc-8bb3-e125df8defa9';

-- 3) (OPCIONAL — só DEPOIS do deploy do app) Fechar o aceite direto via
--    chave anônima. O app agora aceita carga via /api/cargas/aceitar
--    (sessão + validação de dono), então o caminho antigo pode ser
--    revogado para endurecer a segurança:
-- revoke execute on function aceitar_carga_vendedor(uuid) from anon;
