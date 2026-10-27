-- =============================================================================
-- ValReport 2.0 · Etapa 3b — equipe Premier, imagem enviada e elenco para o report do PC
-- Rode DEPOIS do etapa3.sql: SQL Editor → New query → cole tudo → Run.
-- Pode rodar de novo sem estragar nada. (Se rodar o etapa3.sql de novo, rode este depois.)
-- =============================================================================

-- Confere se a etapa 3a já rodou
do $$ begin
  if to_regclass('public.convites') is null then
    raise exception 'Rode primeiro o supabase/etapa3.sql e depois este arquivo de novo.';
  end if;
end $$;

-- ---------- Equipes: campos do Premier e da imagem ----------
alter table public.equipes
  add column if not exists premier_nome text,
  add column if not exists premier_tag text,
  add column if not exists premier_elenco jsonb,              -- [{puuid, nome, tag}] como a API mostra
  add column if not exists premier_info jsonb,                -- conferência, divisão, pontos, vitórias...
  add column if not exists premier_sincronizado_em timestamptz,
  add column if not exists imagem_enviada_em timestamptz,
  add column if not exists imagem_enviada_por uuid references auth.users (id) on delete set null;

do $$ begin
  alter table public.equipes add constraint equipes_imagem_url_ok
    check (imagem_url is null or imagem_url ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imagem\?v=[0-9]{10,13}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.equipes add constraint equipes_premier_ok
    check (tipo <> 'premier' or (premier_id is not null and jsonb_typeof(premier_elenco) = 'array'));
exception when duplicate_object then null; end $$;

-- ---------- Elenco do Premier ----------
-- A pessoa está no elenco do jogo? (Riot ID verificado e puuid na lista que a API trouxe)
create or replace function public.no_elenco_premier(p_equipe uuid, p_usuario uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.equipes e join public.perfis p on p.id = p_usuario
    where e.id = p_equipe and p.riot_verificado_em is not null and p.riot_puuid is not null
      and coalesce(e.premier_elenco, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('puuid', p.riot_puuid)))
$$;

-- Regras das vagas (etapa 3a) + a regra do Premier: só quem está no elenco do jogo é líder, co-líder ou jogador.
-- Durante a atualização do elenco (valreport.sincronizando) quem sai do elenco vira convidado mesmo com as 8 vagas cheias.
create or replace function public.validar_membro() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tipo text; n int; v_sinc boolean := coalesce(current_setting('valreport.sincronizando', true), '') = 'sim';
begin
  select tipo into v_tipo from public.equipes where id = new.equipe_id for update;
  if tg_op = 'INSERT'
     and not exists (select 1 from public.administradores a where a.usuario_id = new.usuario_id)
     and exists (select 1 from public.membros m join public.equipes e on e.id = m.equipe_id
                 where m.usuario_id = new.usuario_id and m.equipe_id <> new.equipe_id
                   and e.tipo = v_tipo and e.status <> 'recusada') then
    raise exception 'limite_equipes: cada pessoa pode estar em uma equipe própria e em uma equipe Premier.' using errcode = 'P0001';
  end if;
  if new.cargo in ('lider', 'colider', 'jogador') then
    if v_tipo = 'premier' and not public.no_elenco_premier(new.equipe_id, new.usuario_id) then
      raise exception 'elenco_premier: numa equipe Premier, só quem está no elenco do jogo (com o Riot ID verificado) pode ser líder, co-líder ou jogador.'
        using errcode = 'P0001';
    end if;
    select count(*) into n from public.membros
     where equipe_id = new.equipe_id and usuario_id <> new.usuario_id and cargo in ('lider', 'colider', 'jogador');
    if n >= 7 then raise exception 'vagas_jogadores: as 7 vagas de jogador estão ocupadas.' using errcode = 'P0001'; end if;
  elsif not v_sinc then
    select count(*) into n from public.membros
     where equipe_id = new.equipe_id and usuario_id <> new.usuario_id and cargo in ('treinador', 'convidado');
    if n >= 8 then raise exception 'vagas_extras: as 8 vagas de treinador e convidado estão ocupadas.' using errcode = 'P0001'; end if;
  end if;
  if new.cargo in ('colider', 'treinador') then
    select count(*) into n from public.membros where equipe_id = new.equipe_id and usuario_id <> new.usuario_id and cargo = new.cargo;
    if n >= 2 then
      raise exception 'limite_cargo: a equipe já tem 2 %.', case new.cargo when 'colider' then 'co-líderes' else 'treinadores' end using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.validar_membro() from public, anon, authenticated;

-- Sucessão da liderança: numa equipe Premier, só alguém do elenco assume.
create or replace function public.sucessao_lideranca() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_novo uuid; v_premier boolean;
begin
  if not exists (select 1 from public.equipes where id = old.equipe_id) then return null; end if;
  if not exists (select 1 from public.membros where equipe_id = old.equipe_id) then
    if not exists (select 1 from public.dados_equipe where equipe_id = old.equipe_id) then
      delete from public.equipes where id = old.equipe_id;
    end if;
    return null;
  end if;
  if old.cargo <> 'lider' or exists (select 1 from public.membros where equipe_id = old.equipe_id and cargo = 'lider') then
    return null;
  end if;
  v_premier := (select tipo = 'premier' from public.equipes where id = old.equipe_id);
  select usuario_id into v_novo from public.membros m where m.equipe_id = old.equipe_id
     and (not v_premier or public.no_elenco_premier(m.equipe_id, m.usuario_id))
   order by array_position(array['colider', 'jogador', 'treinador', 'convidado']::text[], m.cargo::text), m.entrou_em limit 1;
  if v_novo is null then return null; end if;   -- ninguém do elenco: a administradora resolve pelo painel
  begin
    update public.membros set cargo = 'lider' where equipe_id = old.equipe_id and usuario_id = v_novo;
  exception when others then null;   -- sem vaga: a administradora resolve pelo painel
  end;
  return null;
end $$;
revoke execute on function public.sucessao_lideranca() from public, anon, authenticated;

-- Passar a liderança: quem era líder vira co-líder (ou jogador); numa equipe Premier, se não estiver no elenco, vira convidado.
create or replace function public.passar_lideranca(p_equipe uuid, p_usuario uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_antigo uuid; v_premier boolean;
begin
  if not (public.eh_admin() or public.cargo_em(p_equipe) = 'lider') then
    raise exception 'Somente a líder ou o líder passa a liderança.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.membros where equipe_id = p_equipe and usuario_id = p_usuario) then
    raise exception 'Essa pessoa não está na equipe.' using errcode = 'P0001';
  end if;
  v_premier := (select tipo = 'premier' from public.equipes where id = p_equipe);
  select usuario_id into v_antigo from public.membros where equipe_id = p_equipe and cargo = 'lider';
  if v_antigo = p_usuario then return; end if;
  if v_antigo is not null then
    perform set_config('valreport.sincronizando', 'sim', true);
    update public.membros
       set cargo = case when v_premier and not public.no_elenco_premier(p_equipe, v_antigo) then 'convidado' else 'jogador' end::public.cargo
     where equipe_id = p_equipe and usuario_id = v_antigo;
    perform set_config('valreport.sincronizando', '', true);
  end if;
  update public.membros set cargo = 'lider' where equipe_id = p_equipe and usuario_id = p_usuario;
  -- quem era líder (e joga) vira co-líder, se houver vaga de co-líder
  if v_antigo is not null and (select cargo from public.membros where equipe_id = p_equipe and usuario_id = v_antigo) = 'jogador'
     and (select count(*) from public.membros where equipe_id = p_equipe and cargo = 'colider') < 2 then
    update public.membros set cargo = 'colider' where equipe_id = p_equipe and usuario_id = v_antigo;
  end if;
end $$;

-- Grava o elenco que a API trouxe e ajusta os cargos: quem saiu do elenco vira convidado; se a líder saiu,
-- a liderança passa para alguém do elenco (co-líder, depois jogador, por ordem de entrada).
-- Só a função riot e o PC (chave secreta) chamam.
create or replace function public.premier_aplicar(p_equipe uuid, p_dados jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_elenco jsonb; v_rebaixados int := 0; v_n int; v_lider uuid; v_novo uuid;
begin
  if jsonb_typeof(p_dados -> 'elenco') <> 'array' or coalesce(p_dados ->> 'id', '') !~ '^[0-9a-f-]{36}$' then
    raise exception 'dados_premier: a API não trouxe o elenco.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('puuid', x ->> 'puuid', 'nome', left(x ->> 'nome', 32), 'tag', left(x ->> 'tag', 8))), '[]'::jsonb)
    into v_elenco
    from jsonb_array_elements(p_dados -> 'elenco') x where coalesce(x ->> 'puuid', '') ~ '^[0-9a-f-]{36}$';
  update public.equipes set premier_id = p_dados ->> 'id',
         premier_nome = left(p_dados ->> 'nome', 32), premier_tag = left(p_dados ->> 'tag', 8),
         premier_elenco = v_elenco, premier_info = coalesce(p_dados -> 'info', '{}'::jsonb), premier_sincronizado_em = now()
   where id = p_equipe and tipo = 'premier';
  if not found then raise exception 'Essa equipe não é Premier.' using errcode = 'P0001'; end if;

  perform set_config('valreport.sincronizando', 'sim', true);
  -- a líder fora do elenco: passa a liderança antes de rebaixar
  select usuario_id into v_lider from public.membros where equipe_id = p_equipe and cargo = 'lider';
  if v_lider is not null and not public.no_elenco_premier(p_equipe, v_lider) then
    select usuario_id into v_novo from public.membros m
     where m.equipe_id = p_equipe and m.cargo in ('colider', 'jogador') and public.no_elenco_premier(p_equipe, m.usuario_id)
     order by array_position(array['colider', 'jogador']::text[], m.cargo::text), m.entrou_em limit 1;
    if v_novo is not null then
      update public.membros set cargo = 'convidado' where equipe_id = p_equipe and usuario_id = v_lider;
      update public.membros set cargo = 'lider' where equipe_id = p_equipe and usuario_id = v_novo;
      v_rebaixados := 1;
    end if;   -- ninguém do elenco no site: a liderança continua (o site avisa)
  end if;
  update public.membros m set cargo = 'convidado'
   where m.equipe_id = p_equipe and m.cargo in ('colider', 'jogador') and not public.no_elenco_premier(p_equipe, m.usuario_id);
  get diagnostics v_n = row_count;
  perform set_config('valreport.sincronizando', '', true);
  return jsonb_build_object('elenco', jsonb_array_length(v_elenco), 'viraram_convidados', v_rebaixados + v_n,
                            'lider_fora_do_elenco', v_lider is not null and v_novo is null and not public.no_elenco_premier(p_equipe, v_lider));
end $$;

-- Cria uma equipe Premier (já aprovada: a função riot conferiu na API que quem cria está no elenco)
create or replace function public.premier_criar(p_usuario uuid, p_dados jsonb, p_visibilidade text default 'privada')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_nome text; v_slug text; v_id uuid;
begin
  if not exists (select 1 from public.perfis where id = p_usuario) then
    raise exception 'Complete o cadastro primeiro.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.equipes where premier_id = p_dados ->> 'id') then
    raise exception 'premier_existe: essa equipe Premier já está no ValReport. Peça um convite para a liderança dela.' using errcode = 'P0001';
  end if;
  if coalesce(p_visibilidade, '') not in ('publica', 'privada') then p_visibilidade := 'privada'; end if;
  v_nome := public.validar_nome_equipe(p_dados ->> 'nome');
  v_slug := public.slug_livre(v_nome);
  insert into public.equipes (slug, nome, tipo, status, visibilidade, criado_por, revisado_em, premier_id, premier_elenco)
  values (v_slug, v_nome, 'premier', 'aprovada', p_visibilidade, p_usuario, now(), p_dados ->> 'id', '[]'::jsonb)
  returning id into v_id;
  perform public.premier_aplicar(v_id, p_dados);
  insert into public.membros (equipe_id, usuario_id, cargo, riot_id)
  values (v_id, p_usuario, 'lider', (select riot_id from public.perfis where id = p_usuario and riot_verificado_em is not null));
  return jsonb_build_object('id', v_id, 'slug', v_slug, 'status', 'aprovada');
end $$;

-- Transforma uma equipe própria em Premier, mantendo partidas, membros e convites.
-- Quem não está no elenco do jogo passa a convidado (a liderança promove depois, quando verificar o Riot ID).
create or replace function public.premier_vincular(p_usuario uuid, p_equipe uuid, p_dados jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.equipes; v_conflito text;
begin
  select * into e from public.equipes where id = p_equipe for update;
  if e.id is null then raise exception 'Equipe não encontrada.' using errcode = 'P0001'; end if;
  if not (exists (select 1 from public.administradores where usuario_id = p_usuario)
          or exists (select 1 from public.membros where equipe_id = p_equipe and usuario_id = p_usuario and cargo = 'lider')) then
    raise exception 'Somente a líder ou o líder vincula a equipe ao Premier.' using errcode = '42501';
  end if;
  if e.tipo = 'premier' then raise exception 'Essa equipe já é Premier.' using errcode = 'P0001'; end if;
  if e.status <> 'aprovada' then raise exception 'A equipe precisa estar aprovada.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.equipes where premier_id = p_dados ->> 'id' and id <> p_equipe) then
    raise exception 'premier_existe: essa equipe Premier já está ligada a outra equipe do ValReport.' using errcode = 'P0001';
  end if;
  -- cada pessoa fica em uma equipe Premier só
  select string_agg(p.apelido, ', ') into v_conflito
    from public.membros m join public.perfis p on p.id = m.usuario_id
   where m.equipe_id = p_equipe
     and not exists (select 1 from public.administradores a where a.usuario_id = m.usuario_id)
     and exists (select 1 from public.membros o join public.equipes x on x.id = o.equipe_id
                 where o.usuario_id = m.usuario_id and o.equipe_id <> p_equipe and x.tipo = 'premier' and x.status <> 'recusada');
  if v_conflito is not null then
    raise exception 'limite_equipes: % já está em outra equipe Premier. Essa pessoa precisa sair de lá (ou desta equipe) antes.', v_conflito
      using errcode = 'P0001';
  end if;
  update public.equipes set tipo = 'premier', premier_id = p_dados ->> 'id', premier_elenco = '[]'::jsonb where id = p_equipe;
  return public.premier_aplicar(p_equipe, p_dados) || jsonb_build_object('slug', e.slug);
end $$;

-- ---------- Imagem enviada (Supabase Storage, balde "equipes") ----------
-- Um arquivo por equipe: <id da equipe>/imagem. Até 512 KB; só WebP, JPEG e PNG. O balde é público
-- (a imagem aparece sem login, como os cards do jogo), mas só a liderança envia, troca e apaga.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('equipes', 'equipes', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 524288,
  allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

create or replace function public.pode_mexer_imagem(p_nome text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  if coalesce(p_nome, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/imagem$' then return false; end if;
  v_id := split_part(p_nome, '/', 1)::uuid;
  return exists (select 1 from public.equipes where id = v_id and status = 'aprovada') and public.e_lideranca(v_id);
end $$;

drop policy if exists equipes_imagem_ver on storage.objects;
create policy equipes_imagem_ver on storage.objects for select to authenticated
  using (bucket_id = 'equipes' and public.pode_mexer_imagem(name));
drop policy if exists equipes_imagem_enviar on storage.objects;
create policy equipes_imagem_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'equipes' and public.pode_mexer_imagem(name));
drop policy if exists equipes_imagem_trocar on storage.objects;
create policy equipes_imagem_trocar on storage.objects for update to authenticated
  using (bucket_id = 'equipes' and public.pode_mexer_imagem(name))
  with check (bucket_id = 'equipes' and public.pode_mexer_imagem(name));
drop policy if exists equipes_imagem_apagar on storage.objects;
create policy equipes_imagem_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'equipes' and public.pode_mexer_imagem(name));

-- Depois de enviar o arquivo, o site chama esta função para a equipe passar a usar a imagem
create or replace function public.definir_imagem_equipe(p_equipe uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_url text;
begin
  if not public.pode_mexer_imagem(p_equipe::text || '/imagem') then
    raise exception 'Somente a liderança de uma equipe aprovada troca a imagem.' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'equipes' and name = p_equipe::text || '/imagem') then
    raise exception 'A imagem não chegou. Tente enviar de novo.' using errcode = 'P0001';
  end if;
  v_url := p_equipe::text || '/imagem?v=' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  update public.equipes set imagem_url = v_url, imagem_enviada_em = now(), imagem_enviada_por = auth.uid() where id = p_equipe;
  return v_url;
end $$;

-- Tira a imagem enviada (a equipe volta ao card do jogo). O site apaga o arquivo logo depois.
create or replace function public.remover_imagem_equipe(p_equipe uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.e_lideranca(p_equipe) then
    raise exception 'Somente a liderança da equipe ou a administradora.' using errcode = '42501';
  end if;
  update public.equipes set imagem_url = null, imagem_enviada_em = null, imagem_enviada_por = null where id = p_equipe;
end $$;

-- Painel: imagens enviadas nos últimos 14 dias
create or replace function public.admin_imagens_recentes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.eh_admin() then raise exception 'Somente a administradora.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'slug', e.slug, 'nome', e.nome, 'imagem_url', e.imagem_url, 'enviada_em', e.imagem_enviada_em,
      'enviada_por', (select apelido from public.perfis where id = e.imagem_enviada_por))
      order by e.imagem_enviada_em desc)
    from public.equipes e where e.imagem_url is not null and e.imagem_enviada_em > now() - interval '14 days'), '[]'::jsonb);
end $$;

-- ---------- Páginas: dados do Premier ----------
create or replace function public.minhas_equipes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'slug', e.slug, 'nome', e.nome, 'tipo', e.tipo, 'status', e.status, 'visibilidade', e.visibilidade,
           'imagem_card', e.imagem_card, 'imagem_url', e.imagem_url, 'motivo_recusa', e.motivo_recusa, 'cargo', m.cargo,
           'premier', case when e.tipo = 'premier' then e.premier_nome || '#' || e.premier_tag end,
           'membros', (select count(*) from public.membros x where x.equipe_id = e.id)) order by m.entrou_em), '[]'::jsonb)
  from public.membros m join public.equipes e on e.id = m.equipe_id
  where m.usuario_id = auth.uid()
$$;

-- Página da equipe (etapa 3a) + Premier: nome#tag, conferência e, para os membros, o elenco do jogo
-- (marcando quem já está no site) e o selo "no elenco" de cada membro.
create or replace function public.equipe_detalhes(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare e public.equipes; v_membro boolean; v_lider boolean; v_ocultos int;
begin
  if auth.uid() is null then raise exception 'Faça login primeiro.' using errcode = '42501'; end if;
  select * into e from public.equipes where slug = p_slug;
  if e.id is null then return null; end if;
  v_membro := public.eh_membro(e.id) or public.eh_admin();
  if not v_membro and not (e.visibilidade = 'publica' and e.status = 'aprovada') then return null; end if;
  v_lider := public.e_lideranca(e.id);
  select count(*) into v_ocultos from public.membros m
   where m.equipe_id = e.id and not v_membro and public.eh_protegido(m.usuario_id);
  return jsonb_build_object(
    'id', e.id, 'slug', e.slug, 'nome', e.nome, 'tipo', e.tipo, 'status', e.status, 'visibilidade', e.visibilidade,
    'imagem_card', e.imagem_card, 'imagem_url', e.imagem_url, 'motivo_recusa', case when v_membro then e.motivo_recusa end,
    'criado_em', e.criado_em, 'meu_cargo', public.cargo_em(e.id), 'sou_membro', public.eh_membro(e.id),
    'admin', public.eh_admin(), 'lideranca', v_lider, 'ocultos', v_ocultos,
    'premier', case when e.tipo = 'premier' then jsonb_build_object(
        'nome', e.premier_nome, 'tag', e.premier_tag, 'info', e.premier_info, 'sincronizado_em', e.premier_sincronizado_em,
        'elenco', case when v_membro then (
          select coalesce(jsonb_agg(jsonb_build_object('nome', x ->> 'nome', 'tag', x ->> 'tag',
                   'no_site', exists (select 1 from public.membros m join public.perfis p on p.id = m.usuario_id
                                      where m.equipe_id = e.id and p.riot_puuid = x ->> 'puuid' and p.riot_verificado_em is not null))), '[]'::jsonb)
          from jsonb_array_elements(e.premier_elenco) x) end) end,
    'vagas', jsonb_build_object(
      'jogadores', (select count(*) from public.membros where equipe_id = e.id and cargo in ('lider', 'colider', 'jogador')),
      'extras', (select count(*) from public.membros where equipe_id = e.id and cargo in ('treinador', 'convidado'))),
    'membros', coalesce((
      select jsonb_agg(jsonb_build_object(
               'usuario_id', case when v_membro then m.usuario_id end,
               'apelido', p.apelido, 'cargo', m.cargo, 'entrou_em', m.entrou_em,
               'riot_id', case when p.riot_verificado_em is not null then p.riot_id end,
               'riot_card', p.riot_card, 'cor', p.cor,
               'riot_id_pedido', case when v_lider then p.riot_id_pedido end,
               'protegido', case when v_membro then public.eh_protegido(m.usuario_id) end,
               'no_elenco', case when e.tipo = 'premier' and v_membro then public.no_elenco_premier(e.id, m.usuario_id) end,
               'eu', m.usuario_id = auth.uid())
             order by array_position(array['lider', 'colider', 'treinador', 'jogador', 'convidado']::text[], m.cargo::text), m.entrou_em)
      from public.membros m join public.perfis p on p.id = m.usuario_id
      where m.equipe_id = e.id and (v_membro or not public.eh_protegido(m.usuario_id))), '[]'::jsonb));
end $$;

-- ---------- Para o PC (chave secreta): elenco do report e equipes Premier para atualizar ----------
-- Membros da equipe com o apelido do site e o Riot ID verificado (o PC acha cada pessoa pelo puuid).
create or replace function public.pc_elenco_equipe(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('equipe', jsonb_build_object('slug', e.slug, 'nome', e.nome, 'tipo', e.tipo,
                                                         'premier', case when e.tipo = 'premier' then e.premier_nome || '#' || e.premier_tag end),
    'membros', coalesce((select jsonb_agg(jsonb_build_object(
        'apelido', p.apelido, 'cargo', m.cargo, 'protegido', public.eh_protegido(m.usuario_id),
        'riot_id', case when p.riot_verificado_em is not null then p.riot_id end,
        'puuid', case when p.riot_verificado_em is not null then p.riot_puuid end) order by m.entrou_em)
      from public.membros m join public.perfis p on p.id = m.usuario_id where m.equipe_id = e.id), '[]'::jsonb))
  from public.equipes e where e.slug = p_slug and e.status = 'aprovada'
$$;

create or replace function public.pc_equipes_premier() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'slug', e.slug, 'premier_id', e.premier_id,
                                               'sincronizado_em', e.premier_sincronizado_em) order by e.premier_sincronizado_em nulls first), '[]'::jsonb)
  from public.equipes e where e.tipo = 'premier' and e.status = 'aprovada'
$$;

-- ---------- Permissões das funções ----------
revoke execute on function public.no_elenco_premier(uuid, uuid), public.premier_aplicar(uuid, jsonb),
  public.premier_criar(uuid, jsonb, text), public.premier_vincular(uuid, uuid, jsonb),
  public.pc_elenco_equipe(text), public.pc_equipes_premier()
  from public, anon, authenticated;
grant execute on function public.premier_aplicar(uuid, jsonb), public.premier_criar(uuid, jsonb, text),
  public.premier_vincular(uuid, uuid, jsonb), public.pc_elenco_equipe(text), public.pc_equipes_premier()
  to service_role;
revoke execute on function public.pode_mexer_imagem(text), public.definir_imagem_equipe(uuid), public.remover_imagem_equipe(uuid),
  public.admin_imagens_recentes(), public.minhas_equipes(), public.equipe_detalhes(text), public.passar_lideranca(uuid, uuid)
  from public, anon;
grant execute on function public.pode_mexer_imagem(text), public.definir_imagem_equipe(uuid), public.remover_imagem_equipe(uuid),
  public.admin_imagens_recentes(), public.minhas_equipes(), public.equipe_detalhes(text), public.passar_lideranca(uuid, uuid)
  to authenticated;

-- Conferência: deve mostrar o balde "equipes" público, com 524288 bytes de limite, e 4 regras de imagem
select b.id as balde, b.public as publico, b.file_size_limit as limite_bytes,
       (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'equipes_imagem_%') as regras
from storage.buckets b where b.id = 'equipes';
