-- =============================================================================
-- ValReport 2.0 · Comentários das partidas e dos rounds (no lugar das "Notas da IGL")
-- Toda a equipe comenta (convidados não veem); cada pessoa edita e apaga os seus; líder e co-líderes apagam
-- qualquer um. As notas que a IGL escreveu no editar_notas.bat viram comentários dela (botão no site).
-- Rode DEPOIS do taticas.sql: SQL Editor → New query → cole tudo → Run. Pode rodar de novo sem estragar nada.
-- =============================================================================

do $$ begin
  if to_regclass('public.taticas') is null then
    raise exception 'Rode primeiro o supabase/taticas.sql e depois este arquivo de novo.';
  end if;
end $$;

create table if not exists public.comentarios (
  id uuid primary key default gen_random_uuid(),
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  partida text not null check (partida ~ '^[0-9a-f-]{36}$'),
  round int check (round between 1 and 60),             -- vazio = comentário da partida inteira
  autor_id uuid references auth.users (id) on delete set null,
  texto text not null check (char_length(btrim(texto)) between 1 and 2000),
  origem text,                                           -- "notas_pc" = veio do editor de notas do PC
  criado_em timestamptz not null default now(),
  editado_em timestamptz
);
create index if not exists comentarios_partida on public.comentarios (equipe_id, partida, criado_em);
create index if not exists comentarios_autor on public.comentarios (autor_id, criado_em);
create unique index if not exists comentarios_origem_unica on public.comentarios (equipe_id, partida, coalesce(round, 0), origem) where origem is not null;
alter table public.comentarios enable row level security;
revoke all on public.comentarios from anon, public, authenticated;   -- tudo passa pelas funções abaixo

-- Quem lê e escreve: a equipe aprovada (líder, co-líderes, treinadores e jogadores) e a administradora
create or replace function public.pode_comentar(p_equipe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.equipes where id = p_equipe and status = 'aprovada')
     and (public.eh_admin() or coalesce(public.cargo_em(p_equipe) in ('lider', 'colider', 'treinador', 'jogador'), false))
$$;
-- Quem apaga o comentário de outra pessoa e traz as notas do PC: líder, co-líderes e a administradora
create or replace function public.lidera_comentarios(p_equipe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.eh_admin() or coalesce(public.cargo_em(p_equipe) in ('lider', 'colider'), false)
$$;

-- Um comentário como o site mostra
create or replace function public.comentario_json(c public.comentarios) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'round', c.round, 'texto', c.texto, 'criado_em', c.criado_em, 'editado_em', c.editado_em,
    'origem', c.origem, 'eu', c.autor_id = auth.uid(),
    'autor', coalesce((select apelido from public.perfis where id = c.autor_id), 'Conta apagada'),
    'autor_card', (select riot_card from public.perfis where id = c.autor_id),
    'autor_cor', (select cor from public.perfis where id = c.autor_id),
    'autor_cargo', (select m.cargo from public.membros m where m.equipe_id = c.equipe_id and m.usuario_id = c.autor_id))
$$;

create or replace function public.comentarios_listar(p_equipe uuid, p_partida text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.pode_comentar(p_equipe) then raise exception 'Só a equipe vê os comentários (convidados não).' using errcode = '42501'; end if;
  return jsonb_build_object('pode_apagar_todos', public.lidera_comentarios(p_equipe),
    'comentarios', coalesce((select jsonb_agg(public.comentario_json(c) order by c.round nulls first, c.criado_em)
                             from public.comentarios c where c.equipe_id = p_equipe and c.partida = p_partida), '[]'::jsonb));
end $$;

create or replace function public.comentario_criar(p_equipe uuid, p_partida text, p_round int, p_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.comentarios; v_texto text := btrim(coalesce(p_texto, ''));
begin
  if not public.pode_comentar(p_equipe) then raise exception 'Só a equipe comenta (convidados não).' using errcode = '42501'; end if;
  if coalesce(p_partida, '') !~ '^[0-9a-f-]{36}$' then raise exception 'comentario_invalido: partida inválida.' using errcode = 'P0001'; end if;
  if p_round is not null and p_round not between 1 and 60 then raise exception 'comentario_invalido: round inválido.' using errcode = 'P0001'; end if;
  if v_texto = '' then raise exception 'comentario_invalido: escreva alguma coisa antes de enviar.' using errcode = 'P0001'; end if;
  if char_length(v_texto) > 2000 then raise exception 'comentario_invalido: o comentário passou de 2000 caracteres.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.dados_equipe d, jsonb_array_elements(case when jsonb_typeof(d.conteudo) = 'array' then d.conteudo else '[]'::jsonb end) x
                 where d.equipe_id = p_equipe and d.caminho = 'partidas.json' and x ->> 'id' = p_partida) then
    raise exception 'comentario_invalido: essa partida não é da equipe.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.comentarios where autor_id = auth.uid() and criado_em > now() - interval '1 minute') >= 10 then
    raise exception 'comentario_cedo: muitos comentários seguidos. Espere um minutinho.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.comentarios where equipe_id = p_equipe and partida = p_partida) >= 500 then
    raise exception 'comentario_limite: esta partida chegou a 500 comentários.' using errcode = 'P0001';
  end if;
  insert into public.comentarios (equipe_id, partida, round, autor_id, texto)
  values (p_equipe, p_partida, p_round, auth.uid(), v_texto) returning * into c;
  return public.comentario_json(c);
end $$;

create or replace function public.comentario_editar(p_id uuid, p_texto text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.comentarios; v_texto text := btrim(coalesce(p_texto, ''));
begin
  select * into c from public.comentarios where id = p_id;
  if c.id is null or c.autor_id is distinct from auth.uid() or not public.pode_comentar(c.equipe_id) then
    raise exception 'Só quem escreveu edita o comentário.' using errcode = '42501';
  end if;
  if v_texto = '' then raise exception 'comentario_invalido: o comentário não pode ficar vazio (para tirar, apague).' using errcode = 'P0001'; end if;
  if char_length(v_texto) > 2000 then raise exception 'comentario_invalido: o comentário passou de 2000 caracteres.' using errcode = 'P0001'; end if;
  update public.comentarios set texto = v_texto, editado_em = now() where id = p_id returning * into c;
  return public.comentario_json(c);
end $$;

create or replace function public.comentario_apagar(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.comentarios;
begin
  select * into c from public.comentarios where id = p_id;
  if c.id is null or not (
       (c.autor_id = auth.uid() and public.pode_comentar(c.equipe_id))
    or (public.lidera_comentarios(c.equipe_id) and exists (select 1 from public.equipes where id = c.equipe_id and status = 'aprovada'))) then
    raise exception 'Só quem escreveu, o líder e os co-líderes apagam o comentário.' using errcode = '42501';
  end if;
  delete from public.comentarios where id = p_id;
end $$;

-- Quais partidas e rounds têm comentário (para os selos nas listas e na linha do tempo dos rounds)
create or replace function public.comentarios_contagem(p_equipe uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.pode_comentar(p_equipe) then coalesce((
    select jsonb_object_agg(partida, jsonb_build_object('t', total, 'r', rounds))
    from (select partida, count(*) as total,
                 coalesce(jsonb_agg(distinct round) filter (where round is not null), '[]'::jsonb) as rounds
          from public.comentarios where equipe_id = p_equipe group by partida) x), '{}'::jsonb)
  else '{}'::jsonb end
$$;

-- Notas do editar_notas.bat (notas.json) que ainda não viraram comentários
create or replace function public.comentarios_notas_pc(p_equipe uuid)
returns table (partida text, round int, texto text)
language sql stable security definer set search_path = '' as $$
  with n as (
    select p.key as partida, null::int as round, p.value ->> 'texto' as texto
      from public.dados_equipe d, jsonb_each(case when jsonb_typeof(d.conteudo -> 'partidas') = 'object' then d.conteudo -> 'partidas' else '{}'::jsonb end) p
     where d.equipe_id = p_equipe and d.caminho = 'notas.json' and jsonb_typeof(p.value) = 'object'
    union all
    select p.key, r.key::int, r.value #>> '{}'
      from public.dados_equipe d, jsonb_each(case when jsonb_typeof(d.conteudo -> 'partidas') = 'object' then d.conteudo -> 'partidas' else '{}'::jsonb end) p,
           jsonb_each(case when jsonb_typeof(p.value) = 'object' and jsonb_typeof(p.value -> 'rounds') = 'object' then p.value -> 'rounds' else '{}'::jsonb end) r
     where d.equipe_id = p_equipe and d.caminho = 'notas.json' and jsonb_typeof(r.value) = 'string' and r.key ~ '^[0-9]{1,2}$'
  )
  select n.partida, n.round, left(btrim(n.texto), 2000) from n
   where n.partida ~ '^[0-9a-f-]{36}$' and btrim(coalesce(n.texto, '')) <> '' and (n.round is null or n.round between 1 and 60)
     and not exists (select 1 from public.comentarios c where c.equipe_id = p_equipe and c.partida = n.partida
                       and coalesce(c.round, 0) = coalesce(n.round, 0) and c.origem = 'notas_pc')
$$;

create or replace function public.comentarios_pendentes(p_equipe uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case when public.lidera_comentarios(p_equipe) then (select count(*)::int from public.comentarios_notas_pc(p_equipe)) else 0 end
$$;

-- Traz as notas do PC como comentários de quem clicou (a IGL)
create or replace function public.comentarios_importar_notas(p_equipe uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not (public.lidera_comentarios(p_equipe) and public.pode_comentar(p_equipe)) then
    raise exception 'Só o líder e os co-líderes trazem as notas do PC.' using errcode = '42501';
  end if;
  insert into public.comentarios (equipe_id, partida, round, autor_id, texto, origem)
  select p_equipe, x.partida, x.round, auth.uid(), x.texto, 'notas_pc' from public.comentarios_notas_pc(p_equipe) x
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Permissões das funções ----------
revoke execute on function public.comentario_json(public.comentarios), public.comentarios_notas_pc(uuid) from public, anon, authenticated;
revoke execute on function public.pode_comentar(uuid), public.lidera_comentarios(uuid), public.comentarios_listar(uuid, text),
  public.comentario_criar(uuid, text, int, text), public.comentario_editar(uuid, text), public.comentario_apagar(uuid),
  public.comentarios_contagem(uuid), public.comentarios_pendentes(uuid), public.comentarios_importar_notas(uuid)
  from public, anon;
grant execute on function public.comentarios_listar(uuid, text), public.comentario_criar(uuid, text, int, text),
  public.comentario_editar(uuid, text), public.comentario_apagar(uuid), public.comentarios_contagem(uuid),
  public.comentarios_pendentes(uuid), public.comentarios_importar_notas(uuid)
  to authenticated;
revoke execute on function public.pode_comentar(uuid), public.lidera_comentarios(uuid) from authenticated;

-- Conferência: deve mostrar "comentarios" e 0 linhas no começo
select 'comentarios' as tabela, count(*) as linhas from public.comentarios;
