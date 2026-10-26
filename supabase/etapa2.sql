-- =============================================================================
-- ValReport 2.0 · Etapa 2a — perfil personalizável, Riot ID verificado e busca
-- (o Riot ID é confirmado à mão: a pessoa pede, a administradora ou a liderança confirma)
-- Rode DEPOIS do etapa1.sql: SQL Editor → New query → cole tudo → Run.
-- Pode rodar de novo sem estragar nada. Se um dia rodar o etapa1.sql de novo, rode este logo depois.
-- =============================================================================

-- ---------- Perfil: novos campos ----------
alter table public.perfis
  add column if not exists bio text not null default '',
  add column if not exists agentes text[] not null default '{}',      -- até 5, em ordem
  add column if not exists funcoes text[] not null default '{}',      -- até 3, em ordem de preferência
  add column if not exists cor text,                                   -- cor de destaque (#rrggbb)
  add column if not exists historico_publico boolean not null default true,
  -- Riot ID: só a função "riot" (desafio do card) ou a administradora preenchem
  add column if not exists riot_id text,
  add column if not exists riot_puuid text,
  add column if not exists riot_card text,
  add column if not exists riot_titulo text,
  add column if not exists riot_nivel int,
  add column if not exists riot_verificado_em timestamptz,
  add column if not exists riot_atualizado_em timestamptz,
  add column if not exists riot_id_pedido text;                        -- Riot ID que a pessoa pediu para confirmarem

-- Um Riot ID (puuid) só pode estar ligado a uma conta
create unique index if not exists perfis_riot_puuid_unico on public.perfis (riot_puuid) where riot_puuid is not null;
create index if not exists perfis_riot_id_busca on public.perfis (lower(riot_id));

-- Desafio do card em andamento (um por pessoa). Só a função "riot" lê e escreve.
create table if not exists public.desafios_riot (
  usuario_id uuid primary key references public.perfis (id) on delete cascade,
  riot_id text not null,
  riot_puuid text not null,
  card_inicial text not null,
  card_trocado text,
  passo smallint not null default 1 check (passo in (1, 2)),
  expira_em timestamptz not null,
  ultimo_pedido timestamptz not null default now(),
  criado_em timestamptz not null default now()
);
alter table public.desafios_riot enable row level security;
revoke all on public.desafios_riot from anon, public, authenticated;

-- ---------- Validação dos campos novos ----------
-- Roda com a permissão de quem chamou (invoker): assim sabe se é a função "riot" (service_role) ou uma pessoa.
create or replace function public.validar_perfil_2() returns trigger
language plpgsql set search_path = '' as $$
declare v_mudou_riot boolean;
begin
  new.bio := btrim(coalesce(new.bio, ''));
  if char_length(new.bio) > 200 then
    raise exception 'bio: a bio pode ter até 200 caracteres.' using errcode = 'P0001';
  end if;

  new.agentes := coalesce(new.agentes, '{}');
  if cardinality(new.agentes) > 5 then
    raise exception 'agentes: escolha até 5 agentes.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(new.agentes) a where a !~ '^[[:alpha:]][[:alpha:] /.-]{1,19}$')
     or (select count(distinct a) from unnest(new.agentes) a) <> cardinality(new.agentes) then
    raise exception 'agentes: lista de agentes inválida.' using errcode = 'P0001';
  end if;

  new.funcoes := coalesce(new.funcoes, '{}');
  if cardinality(new.funcoes) > 3
     or exists (select 1 from unnest(new.funcoes) f where f not in ('Duelista', 'Iniciador', 'Controlador', 'Sentinela', 'Flex'))
     or (select count(distinct f) from unnest(new.funcoes) f) <> cardinality(new.funcoes) then
    raise exception 'funcoes: escolha até 3 funções diferentes.' using errcode = 'P0001';
  end if;

  if new.cor is not null then
    new.cor := lower(btrim(new.cor));
    if new.cor = '' then new.cor := null;
    elsif new.cor !~ '^#[0-9a-f]{6}$' then
      raise exception 'cor: cor de destaque inválida.' using errcode = 'P0001';
    end if;
  end if;

  -- Pedido de verificação: a própria pessoa escreve; quem confirma é a administradora (ou a liderança, na etapa 3)
  new.riot_id_pedido := nullif(btrim(coalesce(new.riot_id_pedido, '')), '');
  if new.riot_id_pedido is not null and new.riot_id_pedido !~ '^[^#]{3,16}#[A-Za-z0-9]{2,5}$' then
    raise exception 'riot_pedido: escreva o Riot ID no formato Nome#TAG.' using errcode = 'P0001';
  end if;

  -- O Riot ID verificado só muda pela função "riot" ou pela administradora
  if tg_op = 'INSERT' then
    v_mudou_riot := num_nonnulls(new.riot_id, new.riot_puuid, new.riot_card, new.riot_titulo, new.riot_nivel,
                                 new.riot_verificado_em, new.riot_atualizado_em) > 0;
  else
    v_mudou_riot := (new.riot_id, new.riot_puuid, new.riot_card, new.riot_titulo, new.riot_nivel, new.riot_verificado_em, new.riot_atualizado_em)
                    is distinct from
                    (old.riot_id, old.riot_puuid, old.riot_card, old.riot_titulo, old.riot_nivel, old.riot_verificado_em, old.riot_atualizado_em);
  end if;
  if v_mudou_riot and current_user not in ('service_role', 'postgres', 'supabase_admin') and not public.eh_admin() then
    raise exception 'O Riot ID só é confirmado pela administradora ou pela liderança da equipe.' using errcode = '42501';
  end if;
  if v_mudou_riot and new.riot_verificado_em is not null then
    new.riot_id_pedido := null;   -- confirmado: o pedido some
  end if;
  return new;
end $$;

drop trigger if exists validar_perfil_2 on public.perfis;
create trigger validar_perfil_2 before insert or update on public.perfis
  for each row execute function public.validar_perfil_2();

-- A própria pessoa edita o perfil (os campos do Riot ID ficam de fora)
grant update (apelido, bio, agentes, funcoes, cor, historico_publico, riot_id_pedido) on public.perfis to authenticated;

-- Painel: pedidos de verificação do Riot ID (só a administradora)
create or replace function public.admin_pedidos_riot() returns table (id uuid, riot_id_pedido text, riot_id text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.eh_admin() then raise exception 'Somente a administradora.' using errcode = '42501'; end if;
  return query select p.id, p.riot_id_pedido, p.riot_id from public.perfis p;
end $$;
revoke execute on function public.admin_pedidos_riot() from public, anon;
grant execute on function public.admin_pedidos_riot() to authenticated;

-- ---------- Quem pode ver o perfil de quem ----------
-- Perfil público: conta verificada, que não pediu exclusão. Quem tem 16 ou 17 anos (modo protegido)
-- só aparece para quem é da mesma equipe.
create or replace function public.pode_ver_perfil(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    p_id = auth.uid()
    or public.eh_admin()
    or exists (select 1 from public.membros a join public.membros b on a.equipe_id = b.equipe_id
               where a.usuario_id = auth.uid() and b.usuario_id = p_id)
    or exists (select 1 from public.perfis p
               where p.id = p_id and p.riot_verificado_em is not null and p.exclusao_solicitada_em is null
                 and not public.eh_protegido(p.id)))
$$;

-- Busca por nick#tag (ou parte dele), como no Tracker. Até 8 resultados.
create or replace function public.buscar_jogadores(p_termo text)
returns table (apelido text, riot_id text, riot_card text, cor text, mesma_equipe boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_termo text := lower(btrim(coalesce(p_termo, '')));
begin
  if auth.uid() is null then raise exception 'Faça login primeiro.' using errcode = '42501'; end if;
  if char_length(v_termo) < 2 then return; end if;
  v_termo := replace(replace(replace(v_termo, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select p.apelido, p.riot_id, p.riot_card, p.cor,
           exists (select 1 from public.membros a join public.membros b on a.equipe_id = b.equipe_id
                   where a.usuario_id = auth.uid() and b.usuario_id = p.id)
    from public.perfis p
    where p.riot_verificado_em is not null and p.riot_id is not null
      and (lower(p.riot_id) like v_termo || '%' or lower(p.riot_id) like '%' || v_termo || '%#%' or lower(p.apelido) like v_termo || '%')
      and public.pode_ver_perfil(p.id)
    order by (lower(p.riot_id) like v_termo || '%') desc, p.riot_id
    limit 8;
end $$;

-- Perfil público completo por Riot ID (nome#tag). Nada interno das equipes sai daqui.
create or replace function public.perfil_publico(p_riot_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.perfis;
begin
  if auth.uid() is null then raise exception 'Faça login primeiro.' using errcode = '42501'; end if;
  select * into p from public.perfis where lower(riot_id) = lower(btrim(p_riot_id)) and riot_verificado_em is not null;
  if p.id is null or not public.pode_ver_perfil(p.id) then return null; end if;
  return jsonb_build_object(
    'apelido', p.apelido, 'bio', p.bio, 'agentes', to_jsonb(p.agentes), 'funcoes', to_jsonb(p.funcoes), 'cor', p.cor,
    'riot_id', p.riot_id, 'riot_card', p.riot_card, 'riot_titulo', p.riot_titulo, 'riot_nivel', p.riot_nivel,
    'verificado_em', p.riot_verificado_em, 'membro_desde', p.criado_em,
    'historico_publico', p.historico_publico, 'eh_voce', p.id = auth.uid(),
    'protegido', public.eh_protegido(p.id),
    'equipes', coalesce((
      select jsonb_agg(jsonb_build_object('nome', e.nome, 'slug', e.slug, 'tipo', e.tipo,
                                          'cargo', case when public.eh_membro(e.id) then m.cargo::text end) order by m.entrou_em)
      from public.membros m join public.equipes e on e.id = m.equipe_id
      where m.usuario_id = p.id and e.status = 'aprovada' and (e.visibilidade = 'publica' or public.eh_membro(e.id))), '[]'::jsonb));
end $$;

revoke execute on function public.pode_ver_perfil(uuid), public.buscar_jogadores(text), public.perfil_publico(text) from public, anon;
grant execute on function public.pode_ver_perfil(uuid), public.buscar_jogadores(text), public.perfil_publico(text) to authenticated;
revoke execute on function public.validar_perfil_2() from public, anon, authenticated;

-- Conferência: deve mostrar as colunas novas
select count(*) as colunas_novas from information_schema.columns
where table_schema = 'public' and table_name = 'perfis'
  and column_name in ('bio', 'agentes', 'funcoes', 'cor', 'historico_publico', 'riot_id', 'riot_puuid', 'riot_card',
                      'riot_titulo', 'riot_nivel', 'riot_verificado_em', 'riot_atualizado_em', 'riot_id_pedido');
