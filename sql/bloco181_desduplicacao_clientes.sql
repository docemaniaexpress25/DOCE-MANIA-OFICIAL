-- ============================================================================
-- BLOCO 181 — DESDUPLICACAO DO PORTAL CLIENTES FISCAIS (tabela clients)
-- ----------------------------------------------------------------------------
-- CAUSA (dado de producao 18/11): o cadastro (vendedor/admin) criava linha
-- NOVA a cada recadastro de um cliente que ja existia — 14 grupos duplicados,
-- ex.: LANCHERIA REGINA 7x, RADICAL GAMES 5x, MINI MERCADO CHIMARRAO 5x,
-- COELHO 4x, KLIPEL 4x (sempre o MESMO CNPJ) e 4 grupos por nome sem CNPJ.
-- 27 vendas ficaram espalhadas entre linhas duplicadas.
-- O BLOCO 181 ja corrige a CAUSA no app (insertClient agora mescla no cadastro
-- existente). Este script limpa o que ja foi criado:
--   1. DIAGNOSTICO  — lista os grupos (nao altera nada)
--   2. MOVE         — vendas/comprovantes/rotas das linhas EXTRAS para o DONO
--                     do grupo (mais vendas > tem CNPJ > mais antigo)
--   3. COMPLETA     — o cadastro do DONO recebe os dados que so as extras
--                     tinham (preenche vazio; NUNCA sobrescreve o que ja tem)
--   4. EXCLUI       — as linhas extras
--   5. CONFERENCIA  — deve terminar SEM grupos de CNPJ duplicado
-- NAO MESCLA (decisao manual do dono): MERCADO TISATTO — 2 CNPJs distintos
-- (36.418.776/0001-73 x 20.825.226/0001-39) — aparece so no diagnostico.
-- IDEMPOTENTE: pode rodar de novo — depois da 1a vez nao faz nada.
-- RODAR NO: Supabase SQL Editor (projetos doce-mania-oficial e doce-mania-oficial2).
-- ============================================================================

-- ============================================================================
-- 1) DIAGNOSTICO (nao altera nada) — rode so este bloco primeiro se quiser ver
-- ============================================================================
with base as (
  select c.id, c.nome_fantasia, c.nome, c.cnpj, c.telefone, c.ativo, c.created_at,
         regexp_replace(coalesce(c.cnpj, ''), '\D', '', 'g') as cnpj_dig,
         upper(regexp_replace(coalesce(nullif(c.nome_fantasia, ''), c.nome), '\s+', ' ', 'g')) as nome_norm,
         (select count(*) from sales s where s.client_id::text = c.id::text) as vendas
  from clients c
),
cnpj_grupos as (
  select cnpj_dig from base where cnpj_dig <> '' group by 1 having count(*) > 1
),
pares_a as (
  select b.id as extra_id,
         first_value(b.id) over w as keep_id
  from base b
  where b.cnpj_dig <> ''
  window w as (partition by b.cnpj_dig order by b.vendas desc, b.created_at asc, b.id asc)
),
a_linhas as (select extra_id from pares_a union select keep_id from pares_a),
base_b as (
  select * from base b
  where not exists (select 1 from a_linhas a where a.extra_id::text = b.id::text)
),
grupos_b as (
  select nome_norm, count(*) as tamanho, count(distinct nullif(cnpj_dig, '')) as cnpjs_distintos
  from base_b
  where nome_norm is not null and nome_norm <> ''
  group by nome_norm
  having count(*) > 1
),
grupos_b_ok   as (select * from grupos_b where cnpjs_distintos <= 1),
grupos_b_skip as (select * from grupos_b where cnpjs_distintos >  1),
pares_b as (
  select b.id as extra_id,
         first_value(b.id) over w as keep_id
  from base_b b
  join grupos_b_ok g on g.nome_norm = b.nome_norm
  window w as (
    partition by b.nome_norm
    order by b.vendas desc,
             (case when b.cnpj_dig <> '' then 1 else 0 end) desc,
             b.created_at asc, b.id asc
  )
),
pares as (
  select p.extra_id, p.keep_id, 'CNPJ IGUAL' as motivo from pares_a p where p.extra_id <> p.keep_id
  union all
  select p.extra_id, p.keep_id, 'NOME IGUAL (sem conflito de CNPJ)' from pares_b p where p.extra_id <> p.keep_id
)
select 'VAI MESCLAR/EXCLUIR' as acao, p.motivo,
       e.nome_fantasia as extra_nome, e.id::text as extra_id, e.ativo as extra_ativo, e.vendas as extra_vendas, e.created_at as extra_criado,
       k.nome_fantasia as dono_nome,  k.id::text as dono_id,  k.ativo as dono_ativo,  k.vendas as dono_vendas,  k.created_at as dono_criado
from pares p
join lateral (select * from base where base.id::text = p.extra_id::text) e on true
join lateral (select * from base where base.id::text = p.keep_id::text)  k on true
order by e.nome_fantasia, e.created_at;

-- NAO MESCLADO (decidir manualmente no portal): nomes com 2+ CNPJs diferentes
with base as (
  select c.id, c.nome_fantasia, c.cnpj,
         regexp_replace(coalesce(c.cnpj, ''), '\D', '', 'g') as cnpj_dig,
         upper(regexp_replace(coalesce(nullif(c.nome_fantasia, ''), c.nome), '\s+', ' ', 'g')) as nome_norm
  from clients c
),
grupos_skip as (
  select nome_norm, count(distinct nullif(cnpj_dig, '')) as cnpjs_distintos
  from base
  where nome_norm is not null and nome_norm <> ''
  group by nome_norm
  having count(*) > 1 and count(distinct nullif(cnpj_dig, '')) > 1
)
select b.nome_fantasia as nome, b.cnpj, b.nome_norm as grupo
from base b
join grupos_skip g on g.nome_norm = b.nome_norm
order by b.nome_norm, b.created_at;

-- ============================================================================
-- 2) MOVE vendas/comprovantes/rotas das EXTRAS para o DONO do grupo
--    (statement independente — pode rodar sozinho; idempotente)
-- ============================================================================
with base as (
  select c.id, c.cnpj,
         regexp_replace(coalesce(c.cnpj, ''), '\D', '', 'g') as cnpj_dig,
         upper(regexp_replace(coalesce(nullif(c.nome_fantasia, ''), c.nome), '\s+', ' ', 'g')) as nome_norm,
         (select count(*) from sales s where s.client_id::text = c.id::text) as vendas
  from clients c
),
cnpj_grupos as (
  select cnpj_dig from base where cnpj_dig <> '' group by 1 having count(*) > 1
),
pares_a as (
  select b.id as extra_id,
         first_value(b.id) over w as keep_id
  from base b
  where b.cnpj_dig <> ''
  window w as (partition by b.cnpj_dig order by b.vendas desc, b.created_at asc, b.id asc)
),
a_linhas as (select extra_id from pares_a union select keep_id from pares_a),
base_b as (
  select * from base b
  where not exists (select 1 from a_linhas a where a.extra_id::text = b.id::text)
),
grupos_b_ok as (
  select nome_norm
  from base_b
  where nome_norm is not null and nome_norm <> ''
  group by nome_norm
  having count(*) > 1 and count(distinct nullif(cnpj_dig, '')) <= 1
),
pares_b as (
  select b.id as extra_id,
         first_value(b.id) over w as keep_id
  from base_b b
  join grupos_b_ok g on g.nome_norm = b.nome_norm
  window w as (
    partition by b.nome_norm
    order by b.vendas desc,
             (case when b.cnpj_dig <> '' then 1 else 0 end) desc,
             b.created_at asc, b.id asc
  )
),
pares as (
  select extra_id::text as extra_id, keep_id::text as keep_id from pares_a where extra_id <> keep_id
  union all
  select extra_id::text as extra_id, keep_id::text as keep_id from pares_b where extra_id <> keep_id
),
movidos as (
  update sales s
     set client_id = p.keep_id::uuid
  from pares p
  where s.client_id::text = p.extra_id
  returning s.id
)
select count(*) as vendas_movidas from movidos;

update payment_comprovantes pc
   set client_id = p.keep_id::uuid
from (
  with base as (
    select c.id, c.cnpj,
           regexp_replace(coalesce(c.cnpj, ''), '\D', '', 'g') as cnpj_dig,
           upper(regexp_replace(coalesce(nullif(c.nome_fantasia, ''), c.nome), '\s+', ' ', 'g')) as nome_norm,
           (select count(*) from sales s where s.client_id::text = c.id::text) as vendas
    from clients c
  ),
  cnpj_grupos as (select cnpj_dig from base where cnpj_dig <> '' group by 1 having count(*) > 1),
  pares_a as (
    select b.id as extra_id, first_value(b.id) over w as keep_id
    from base b where b.cnpj_dig <> ''
    window w as (partition by b.cnpj_dig order by b.vendas desc, b.created_at asc, b.id asc)
  ),
  a_linhas as (select extra_id from pares_a union select keep_id from pares_a),
  base_b as (select * from base b where not exists (select 1 from a_linhas a where a.extra_id::text = b.id::text)),
  grupos_b_ok as (
    select nome_norm from base_b
    where nome_norm is not null and nome_norm <> ''
    group by nome_norm
    having count(*) > 1 and count(distinct nullif(cnpj_dig, '')) <= 1
  ),
  pares_b as (
    select b.id as extra_id, first_value(b.id) over w as keep_id
    from base_b b join grupos_b_ok g on g.nome_norm = b.nome_norm
    window w as (partition by b.nome_norm
                 order by b.vendas desc, (case when b.cnpj_dig <> '' then 1 else 0 end) desc, b.created_at asc, b.id asc)
  )
  select extra_id::text as extra_id, keep_id::text as keep_id from pares_a where extra_id <> keep_id
  union all
  select extra_id::text as extra_id, keep_id::text as keep_id from pares_b where extra_id <> keep_id
) p
where pc.client_id::text = p.extra_id;

update daily_routes dr
   set client_id = p.keep_id::uuid
from (
  with base as (
    select c.id, c.cnpj,
           regexp_replace(coalesce(c.cnpj, ''), '\D', '', 'g') as cnpj_dig,
           upper(regexp_replace(coalesce(nullif(c.nome_fantasia, ''), c.nome), '\s+', ' ', 'g')) as nome_norm,
           (select count(*) from sales s where s.client_id::text = c.id::text) as vendas
    from clients c
  ),
  cnpj_grupos as (select cnpj_dig from base where cnpj_dig <> '' group by 1 having count(*) > 1),
  pares_a as (
    select b.id as extra_id, first_value(b.id) over w as keep_id
    from base b where b.cnpj_dig <> ''
    window w as (partition by b.cnpj_dig order by b.vendas desc, b.created_at asc, b.id asc)
  ),
  a_linhas as (select extra_id from pares_a union select keep_id from pares_a),
  base_b as (select * from base b where not exists (select 1 from a_linhas a where a.extra_id::text = b.id::text)),
  grupos_b_ok as (
    select nome_norm from base_b
    where nome_norm is not null and nome_norm <> ''
    group by nome_norm
    having count(*) > 1 and count(distinct nullif(cnpj_dig, '')) <= 1
  ),
  pares_b as (
    select b.id as extra_id, first_value(b.id) over w as keep_id
    from base_b b join grupos_b_ok g on g.nome_norm = b.nome_norm
    window w as (partition by b.nome_norm
                 order by b.vendas desc, (case when b.cnpj_dig <> '' then 1 else 0 end) desc, b.created_at asc, b.id asc)
  )
  select extra_id::text as extra_id, keep_id::text as keep_id from pares_a where extra_id <> keep_id
  union all
  select extra_id::text as extra_id, keep_id::text as keep_id from pares_b where extra_id <> keep_id
) p
where dr.client_id::text = p.extra_id;

-- ============================================================================
-- 3) COMPLETA o DONO com dados que so as EXTRAS tinham (preenche vazio,
--    NUNCA sobrescreve o que ja esta no cadastro)
-- ============================================================================
with base as (
  select c.id, c.cnpj,
         regexp_replace(coalesce(c.cnpj, ''), '\D', '', 'g') as cnpj_dig,
         upper(regexp_replace(coalesce(nullif(c.nome_fantasia, ''), c.nome), '\s+', ' ', 'g')) as nome_norm,
         (select count(*) from sales s where s.client_id::text = c.id::text) as vendas
  from clients c
),
cnpj_grupos as (select cnpj_dig from base where cnpj_dig <> '' group by 1 having count(*) > 1),
pares_a as (
  select b.id as extra_id, first_value(b.id) over w as keep_id
  from base b where b.cnpj_dig <> ''
  window w as (partition by b.cnpj_dig order by b.vendas desc, b.created_at asc, b.id asc)
),
a_linhas as (select extra_id from pares_a union select keep_id from pares_a),
base_b as (select * from base b where not exists (select 1 from a_linhas a where a.extra_id::text = b.id::text)),
grupos_b_ok as (
  select nome_norm from base_b
  where nome_norm is not null and nome_norm <> ''
  group by nome_norm
  having count(*) > 1 and count(distinct nullif(cnpj_dig, '')) <= 1
),
pares_b as (
  select b.id as extra_id, first_value(b.id) over w as keep_id
  from base_b b join grupos_b_ok g on g.nome_norm = b.nome_norm
  window w as (partition by b.nome_norm
               order by b.vendas desc, (case when b.cnpj_dig <> '' then 1 else 0 end) desc, b.created_at asc, b.id asc)
),
pares as (
  select extra_id::text as extra_id, keep_id::text as keep_id from pares_a where extra_id <> keep_id
  union all
  select extra_id::text as extra_id, keep_id::text as keep_id from pares_b where extra_id <> keep_id
),
valores_extras as (
  select p.keep_id,
         max(c.cnpj)                as cnpj,
         max(c.razao_social)        as razao_social,
         max(c.inscricao_estadual)  as inscricao_estadual,
         max(c.telefone)            as telefone,
         max(c.endereco)            as endereco,
         max(c.endereco_numero)     as endereco_numero,
         max(c.bairro)              as bairro,
         max(c.endereco_cep)        as endereco_cep,
         max(c.endereco_municipio)  as endereco_municipio,
         max(c.endereco_uf)         as endereco_uf
  from clients c
  join pares p on p.extra_id = c.id::text
  group by p.keep_id
)
update clients k
   set cnpj               = coalesce(nullif(k.cnpj, ''), v.cnpj),
       razao_social       = coalesce(nullif(k.razao_social, ''), v.razao_social),
       inscricao_estadual = coalesce(nullif(k.inscricao_estadual, ''), v.inscricao_estadual),
       telefone           = coalesce(nullif(k.telefone, ''), v.telefone),
       endereco           = coalesce(nullif(k.endereco, ''), v.endereco),
       endereco_numero    = coalesce(nullif(k.endereco_numero, ''), v.endereco_numero),
       bairro             = coalesce(nullif(k.bairro, ''), v.bairro),
       endereco_cep       = coalesce(nullif(k.endereco_cep, ''), v.endereco_cep),
       endereco_municipio = coalesce(nullif(k.endereco_municipio, ''), v.endereco_municipio),
       endereco_uf        = coalesce(nullif(k.endereco_uf, ''), v.endereco_uf)
from valores_extras v
where k.id::text = v.keep_id
  and ( (nullif(k.cnpj, '') is null and v.cnpj is not null)
     or (nullif(k.razao_social, '') is null and v.razao_social is not null)
     or (nullif(k.inscricao_estadual, '') is null and v.inscricao_estadual is not null)
     or (nullif(k.telefone, '') is null and v.telefone is not null)
     or (nullif(k.endereco, '') is null and v.endereco is not null)
     or (nullif(k.endereco_numero, '') is null and v.endereco_numero is not null)
     or (nullif(k.bairro, '') is null and v.bairro is not null)
     or (nullif(k.endereco_cep, '') is null and v.endereco_cep is not null)
     or (nullif(k.endereco_municipio, '') is null and v.endereco_municipio is not null)
     or (nullif(k.endereco_uf, '') is null and v.endereco_uf is not null) );

-- ============================================================================
-- 4) EXCLUI as linhas extras (ja sem vendas/comprovantes/rotas)
-- ============================================================================
with base as (
  select c.id, c.cnpj,
         regexp_replace(coalesce(c.cnpj, ''), '\D', '', 'g') as cnpj_dig,
         upper(regexp_replace(coalesce(nullif(c.nome_fantasia, ''), c.nome), '\s+', ' ', 'g')) as nome_norm,
         (select count(*) from sales s where s.client_id::text = c.id::text) as vendas
  from clients c
),
cnpj_grupos as (select cnpj_dig from base where cnpj_dig <> '' group by 1 having count(*) > 1),
pares_a as (
  select b.id as extra_id, first_value(b.id) over w as keep_id
  from base b where b.cnpj_dig <> ''
  window w as (partition by b.cnpj_dig order by b.vendas desc, b.created_at asc, b.id asc)
),
a_linhas as (select extra_id from pares_a union select keep_id from pares_a),
base_b as (select * from base b where not exists (select 1 from a_linhas a where a.extra_id::text = b.id::text)),
grupos_b_ok as (
  select nome_norm from base_b
  where nome_norm is not null and nome_norm <> ''
  group by nome_norm
  having count(*) > 1 and count(distinct nullif(cnpj_dig, '')) <= 1
),
pares_b as (
  select b.id as extra_id, first_value(b.id) over w as keep_id
  from base_b b join grupos_b_ok g on g.nome_norm = b.nome_norm
  window w as (partition by b.nome_norm
               order by b.vendas desc, (case when b.cnpj_dig <> '' then 1 else 0 end) desc, b.created_at asc, b.id asc)
),
pares as (
  select extra_id::text as extra_id, keep_id::text as keep_id from pares_a where extra_id <> keep_id
  union all
  select extra_id::text as extra_id, keep_id::text as keep_id from pares_b where extra_id <> keep_id
),
excluidas as (
  delete from clients c
  using pares p
  where c.id::text = p.extra_id
  returning c.id
)
select count(*) as clientes_excluidos from excluidas;

-- ============================================================================
-- 5) CONFERENCIA FINAL — a 1a consulta DEVE vir VAZIA (zero CNPJ duplicado);
--    a 2a deve mostrar so MERCADO TISATTO (2 CNPJs — decisao manual do dono)
-- ============================================================================
select 'CNPJ AINDA DUPLICADO (deve ser VAZIO)' as aviso, c.cnpj, count(*) as linhas
from clients c
where regexp_replace(coalesce(c.cnpj, ''), '\D', '', 'g') <> ''
group by c.cnpj
having count(*) > 1;

select 'NOME AINDA DUPLICADO (so TISATTO deve aparecer)' as aviso,
       upper(regexp_replace(coalesce(nullif(c.nome_fantasia, ''), c.nome), '\s+', ' ', 'g')) as grupo,
       count(*) as linhas
from clients c
group by 2
having count(*) > 1
order by 2;
