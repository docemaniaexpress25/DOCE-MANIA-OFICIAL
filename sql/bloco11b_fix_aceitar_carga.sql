-- ============================================================
-- BLOCO 11B — Correção DEFINITIVA do aceite de carga do vendedor
-- Rodar no SQL Editor do Supabase. Sem destruição de dados.
-- ============================================================
--
-- ERRO CAPTURADO EM PRODUÇÃO (testado 21/09/2026 na pendente real
-- 4a99b4b6-c55a-4784-acd0-5e3c63804d8f):
--
--   23502: null value in column "produto_id" of relation "cargas"
--          violates not-null constraint
--   Failing row contains (dad7ec65-..., null, 4, ...)
--
-- CAUSA RAIZ: o RPC aceitar_carga_vendedor lia a chave do produto no
--   JSON com o nome errado (esperava "produtoId"; as linhas gravam
--   "produtoid" em minúsculas — veja cargaService.insertCargaPendente).
--   Resultado: produto_id saía NULL em TODOS os aceites → a função
--   inteira abortava → o vendedor NUNCA conseguia receber a carga.
--   (É por isso que a pendente de 11/09 estava travada desde sempre:
--   o aceite sempre falhou, o app antigo só engolia o erro.)
--
-- Esta versão corrige a chave, trava a linha contra aceite duplo,
-- recusa carga vazia e ainda funciona tanto por "produtoid" quanto
-- por "produtoId" (à prova de chave maiúscula/minúscula).
-- ============================================================

create or replace function aceitar_carga_vendedor(p_carga_pendente_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vendedor uuid;
  v_itens    jsonb;
  v_status   text;
  v_total    int;
begin
  -- Trava a linha para impedir aceite duplo em paralelo
  select vendedor_id, coalesce(itens, '[]'::jsonb), status
    into v_vendedor, v_itens, v_status
    from cargas_pendentes
   where id = p_carga_pendente_id
     for update;

  if not found then
    raise exception 'Carga pendente nao encontrada (ja aceita ou cancelada?). Atualize a tela.';
  end if;

  if v_status is distinct from 'PENDENTE' then
    raise exception 'Esta carga nao esta mais pendente (status: %).', v_status;
  end if;

  -- Guarda anti-carga-zerada (mesma regra do app)
  select coalesce(sum(coalesce((it->>'quantidade')::int, 0)), 0)
    into v_total
    from jsonb_array_elements(v_itens) it;

  if v_total <= 0 then
    raise exception 'Esta carga veio VAZIA (soma 0). Peca ao admin para reenviar.';
  end if;

  -- Substitui a carga atual da van pela carga aprovada
  delete from cargas where vendedor_id = v_vendedor;

  insert into cargas (vendedor_id, produto_id, quantidade)
  select distinct on (chave)
         v_vendedor,
         chave::uuid,
         qtd
    from (
      select coalesce(it->>'produtoid', it->>'produtoId') as chave,
             coalesce((it->>'quantidade')::int, 0)        as qtd
        from jsonb_array_elements(v_itens) it
    ) x
   where chave is not null
     and qtd > 0
   order by chave, qtd desc;

  update cargas_pendentes
     set status = 'ACEITA'
   where id = p_carga_pendente_id;
end;
$$;

-- ------------------------------------------------------------
-- 1) Cancela a pendente ZERADA de 16/09 (87 itens com soma 0).
--    Ela fica dando "erro" no aceite e não serve pra nada.
-- ------------------------------------------------------------
update cargas_pendentes
   set status = 'CANCELADA_ZERADA'
 where status = 'PENDENTE'
   and coalesce((
         select sum(coalesce((it->>'quantidade')::int, 0))
           from jsonb_array_elements(itens) it
       ), 0) <= 0;

-- ------------------------------------------------------------
-- 2) OPCIONAL — decidir o destino da pendente antiga de 11/09
--    (vendedor addfae58..., 1.321 unidades).
--    Com o RPC corrigido o vendedor CONSEGUE aceitá-la, mas a carga
--    da van dele será SUBSTITUÍDA pelos itens ANTIGOS de 11/09
--    (a carga atual dele tem 1.371 unidades mais recentes).
--    Se NÃO quiser isso, cancele descomentando abaixo:
-- ------------------------------------------------------------
-- update cargas_pendentes
--    set status = 'CANCELADA_ADMIN'
--  where id = '6313c338-e8e9-44cc-8bb3-e125df8defa9';

-- ------------------------------------------------------------
-- 3) OPCIONAL — só DEPOIS que todos os celulares estiverem com o
--    app atualizado: fechar o aceite direto via chave anônima
--    (o app novo aceita via /api/cargas/aceitar com sessão).
-- ------------------------------------------------------------
-- revoke execute on function aceitar_carga_vendedor(uuid) from anon;
