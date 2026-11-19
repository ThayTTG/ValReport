-- ValReport v26: elo oculto mais robusto e o botão "Atualizar" do site (o das setinhas, no topo) pede a coleta na hora.
-- A coleta refaz o site inteiro (estatísticas, atributos, Índice, recordes...), mesmo sem partida nova:
-- serve para quando a liderança tira uma partida das contas, alguém esconde o elo ou o cálculo muda.
--
-- Quem chama: o site, pela função do Vercel (/api/disparar com {"modo": "atualizar"}), com o login de quem clicou.
-- Quem decide: este banco. Chama quando TUDO isto vale:
--   1. quem pede é integrante da equipe;
--   2. ninguém chamou a nuvem nos últimos 4 minutos (uma execução leva de 2 a 4 minutos);
--   3. o botão chamou a nuvem menos de 8 vezes na última hora.
--
-- Precisa do nuvem.sql e do visita.sql. Aplicar: SQL Editor do Supabase > colar este arquivo inteiro > Run.
-- Pode rodar mais de uma vez.

alter table public.nuvem_disparos add column if not exists origem text not null default 'admin';

create or replace function public.nuvem_disparo_manual(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_eq uuid; v_ultimo timestamptz; v_hora int;
begin
  v_eq := public.sync_equipe(p_slug);
  if v_eq is null then raise exception 'sync_equipe: equipe não encontrada.' using errcode = 'P0001'; end if;
  if not public.eh_membro(v_eq) then raise exception 'Só quem é da equipe atualiza os dados.' using errcode = '42501'; end if;

  perform pg_advisory_xact_lock(hashtext('nuvem_disparo_visita'), hashtext(v_eq::text));   -- a mesma trava da visita

  select max(em) into v_ultimo from public.nuvem_disparos where equipe_id = v_eq;
  if v_ultimo > now() - interval '4 minutes' then
    return jsonb_build_object('pode', false, 'codigo', 'recente', 'ultimo', v_ultimo);
  end if;
  select count(*) into v_hora from public.nuvem_disparos where equipe_id = v_eq and origem = 'atualizar' and em > now() - interval '1 hour';
  if v_hora >= 8 then
    return jsonb_build_object('pode', false, 'codigo', 'limite', 'ultimo', v_ultimo);
  end if;

  insert into public.nuvem_disparos (equipe_id, por, origem) values (v_eq, auth.uid(), 'atualizar');
  delete from public.nuvem_disparos where equipe_id = v_eq and em < now() - interval '7 days';
  return jsonb_build_object('pode', true, 'ultimo', v_ultimo);
end $$;

revoke execute on function public.nuvem_disparo_manual(text) from public, anon, authenticated;
grant execute on function public.nuvem_disparo_manual(text) to authenticated;

-- v26: o elo oculto vale também para quem ainda não confirmou o Riot ID ou trocou de nick (mesma função do planejamento.sql)
-- ---------- Elenco para a coleta: agora leva a escolha de mostrar o elo ----------
create or replace function public.pc_elenco_equipe(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('equipe', jsonb_build_object('slug', e.slug, 'nome', e.nome, 'tipo', e.tipo,
                                                         'premier', case when e.tipo = 'premier' then e.premier_nome || '#' || e.premier_tag end),
    'membros', coalesce((select jsonb_agg(jsonb_build_object(
        'apelido', p.apelido, 'cargo', m.cargo, 'protegido', public.eh_protegido(m.usuario_id),
        'riot_id', case when p.riot_verificado_em is not null then p.riot_id end,
        'puuid', case when p.riot_verificado_em is not null then p.riot_puuid end,
        'mostrar_elo', coalesce(p.mostrar_elo, true),
        -- v26: para esconder o elo também de quem ainda não confirmou o Riot ID ou trocou de nick
        'elo_oculto_ids', case when p.mostrar_elo is false then
          to_jsonb(array_remove(array[lower(p.riot_id), lower(p.riot_id_pedido), p.riot_puuid], null)) end) order by m.entrou_em)
      from public.membros m join public.perfis p on p.id = m.usuario_id where m.equipe_id = e.id), '[]'::jsonb))
  from public.equipes e where e.slug = p_slug and e.status = 'aprovada'
$$;

revoke execute on function public.pc_elenco_equipe(text) from public, anon, authenticated;
grant execute on function public.pc_elenco_equipe(text) to service_role;

-- Conferência: deve mostrar true
select exists (select 1 from pg_proc where proname = 'nuvem_disparo_manual') as atualizar_pronto;

-- =====================================================================
-- v34: manter alguém como jogador numa equipe Premier, mesmo fora do elenco do jogo
-- (ex.: quem joga com a equipe mas não está no elenco oficial do Premier). Precisa do etapa3b.sql.
-- A liderança marca a pessoa em Membros e convites; a sincronização do Premier não rebaixa mais quem está marcado.
-- =====================================================================
alter table public.membros add column if not exists liberado_premier boolean not null default false;

-- Só o elenco do jogo (sem a liberação)
create or replace function public.no_elenco_premier_jogo(p_equipe uuid, p_usuario uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.equipes e join public.perfis p on p.id = p_usuario
    where e.id = p_equipe and p.riot_verificado_em is not null and p.riot_puuid is not null
      and coalesce(e.premier_elenco, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('puuid', p.riot_puuid)))
$$;
-- "Pode jogar pela equipe Premier": está no elenco do jogo OU a liderança liberou.
-- Todas as regras do Premier (cargos, sincronização, sucessão da liderança) usam esta função.
create or replace function public.no_elenco_premier(p_equipe uuid, p_usuario uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.no_elenco_premier_jogo(p_equipe, p_usuario)
      or exists (select 1 from public.membros m where m.equipe_id = p_equipe and m.usuario_id = p_usuario and m.liberado_premier)
$$;

-- Liberar (ou tirar a liberação). Quem perde a liberação e está fora do elenco volta a convidado.
create or replace function public.premier_liberar(p_equipe uuid, p_usuario uuid, p_liberar boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.eh_admin() or public.e_lideranca(p_equipe)) then
    raise exception 'Somente a liderança muda isso.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.equipes where id = p_equipe and tipo = 'premier') then
    raise exception 'Essa equipe não é Premier.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.membros where equipe_id = p_equipe and usuario_id = p_usuario) then
    raise exception 'Essa pessoa não está na equipe.' using errcode = 'P0001';
  end if;
  if coalesce(p_liberar, false) then
    update public.membros set liberado_premier = true where equipe_id = p_equipe and usuario_id = p_usuario;
  else
    perform set_config('valreport.sincronizando', 'sim', true);
    update public.membros
       set liberado_premier = false,
           cargo = case when cargo in ('colider', 'jogador') and not public.no_elenco_premier_jogo(p_equipe, p_usuario) then 'convidado' else cargo end::public.cargo
     where equipe_id = p_equipe and usuario_id = p_usuario;
    perform set_config('valreport.sincronizando', '', true);
  end if;
end $$;

-- Quem está liberado (para a página Membros mostrar o selo e o botão)
create or replace function public.premier_liberados(p_equipe uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(m.usuario_id), '[]'::jsonb) from public.membros m
   where m.equipe_id = p_equipe and m.liberado_premier and (public.eh_membro(p_equipe) or public.eh_admin())
$$;

revoke execute on function public.no_elenco_premier_jogo(uuid, uuid), public.no_elenco_premier(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.premier_liberar(uuid, uuid, boolean), public.premier_liberados(uuid) from public, anon;
grant execute on function public.premier_liberar(uuid, uuid, boolean), public.premier_liberados(uuid) to authenticated;

-- Conferência: deve mostrar true
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'membros' and column_name = 'liberado_premier') as liberar_pronto;

-- =====================================================================
-- v35: co-líderes também definem cargos (de jogadores, treinadores e convidados, entre esses três cargos).
-- Só a liderança principal promove a co-líder, mexe em outros co-líderes ou passa a liderança.
-- =====================================================================
create or replace function public.definir_cargo(p_equipe uuid, p_usuario uuid, p_cargo public.cargo)
returns void language plpgsql security definer set search_path = '' as $$
declare v_eu public.cargo := public.cargo_em(p_equipe); v_atual public.cargo;
begin
  if not (public.eh_admin() or v_eu in ('lider', 'colider')) then
    raise exception 'Somente a liderança da equipe define cargos.' using errcode = '42501';
  end if;
  if p_cargo = 'lider' then raise exception 'Para trocar a liderança, use "Passar a liderança".' using errcode = 'P0001'; end if;
  select cargo into v_atual from public.membros where equipe_id = p_equipe and usuario_id = p_usuario;
  if v_atual is null then raise exception 'Essa pessoa não está na equipe.' using errcode = 'P0001'; end if;
  if v_atual = 'lider' then raise exception 'Para mudar o cargo da liderança, passe a liderança antes.' using errcode = 'P0001'; end if;
  if not public.eh_admin() and v_eu = 'colider' then
    if p_usuario = auth.uid() then raise exception 'Você não muda o próprio cargo.' using errcode = 'P0001'; end if;
    if v_atual = 'colider' or p_cargo = 'colider' then
      raise exception 'Só a líder ou o líder promove ou muda co-líderes.' using errcode = '42501';
    end if;
  end if;
  update public.membros set cargo = p_cargo where equipe_id = p_equipe and usuario_id = p_usuario;
end $$;
revoke execute on function public.definir_cargo(uuid, uuid, public.cargo) from public, anon;
grant execute on function public.definir_cargo(uuid, uuid, public.cargo) to authenticated;

-- =====================================================================
-- v36: índice de busca das táticas para o Ctrl+K (título, mapa, seções e títulos dos blocos). Precisa do taticas.sql.
-- =====================================================================
create or replace function public.taticas_indice(p_equipe uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.pode_ver_taticas(p_equipe) then raise exception 'Só a equipe vê as táticas (convidados não).' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'titulo', t.titulo, 'mapa', t.mapa, 'lado', t.lado,
      'secoes', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s ->> 'id', 'nome', left(s ->> 'nome', 60),
          'itens', coalesce((select jsonb_agg(left(coalesce(nullif(b ->> 'titulo', ''), nullif(b ->> 'legenda', ''), nullif(b ->> 'nome', '')), 80))
                             from jsonb_array_elements(case when jsonb_typeof(s -> 'blocos') = 'array' then s -> 'blocos' else '[]'::jsonb end) b
                             where coalesce(nullif(b ->> 'titulo', ''), nullif(b ->> 'legenda', ''), nullif(b ->> 'nome', '')) is not null), '[]'::jsonb)))
        from jsonb_array_elements(case when jsonb_typeof(t.conteudo -> 'secoes') = 'array' then t.conteudo -> 'secoes' else '[]'::jsonb end) s), '[]'::jsonb))
      order by coalesce(t.publicada_em, t.criado_em) desc)
    from public.taticas t where t.equipe_id = p_equipe and t.conteudo is not null), '[]'::jsonb);
end $$;
revoke execute on function public.taticas_indice(uuid) from public, anon;
grant execute on function public.taticas_indice(uuid) to authenticated;

-- =====================================================================
-- v45: contexto de cada partida (Ranked · Scrim · Oficial · Treino · Personalizada · Outra)
-- O site descobre sozinho (fila e agenda); aqui fica só o que a liderança marcou à mão (e o adversário).
-- =====================================================================
create table if not exists public.partidas_contexto (
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  partida_id text not null check (partida_id ~ '^[0-9a-f-]{36}$'),
  contexto text not null check (contexto in ('ranked', 'scrim', 'oficial', 'treino', 'personalizada', 'outra')),
  adversario text check (char_length(adversario) <= 40),
  por uuid references auth.users (id) on delete set null,
  em timestamptz not null default now(),
  primary key (equipe_id, partida_id)
);
alter table public.partidas_contexto enable row level security;
revoke all on public.partidas_contexto from anon, public, authenticated;

create or replace function public.partidas_contexto_listar(p_equipe uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.eh_membro(p_equipe) or public.eh_admin()) then raise exception 'Só a equipe vê isso.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('partida', c.partida_id, 'contexto', c.contexto, 'adversario', c.adversario,
                    'por', (select apelido from public.perfis where id = c.por), 'em', c.em))
                   from public.partidas_contexto c where c.equipe_id = p_equipe), '[]'::jsonb);
end $$;

-- p_contexto '' (ou nulo) volta para o automático
create or replace function public.partida_definir_contexto(p_equipe uuid, p_partida text, p_contexto text, p_adversario text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.eh_admin() or public.e_lideranca(p_equipe) or public.cargo_em(p_equipe) = 'treinador') then
    raise exception 'Só a liderança e os treinadores mudam o contexto da partida.' using errcode = '42501';
  end if;
  if coalesce(p_partida, '') !~ '^[0-9a-f-]{36}$' then raise exception 'partida: inválida.' using errcode = 'P0001'; end if;
  if coalesce(p_contexto, '') = '' then
    delete from public.partidas_contexto where equipe_id = p_equipe and partida_id = p_partida;
    return;
  end if;
  if p_contexto not in ('ranked', 'scrim', 'oficial', 'treino', 'personalizada', 'outra') then
    raise exception 'contexto: inválido.' using errcode = 'P0001';
  end if;
  insert into public.partidas_contexto (equipe_id, partida_id, contexto, adversario, por)
  values (p_equipe, p_partida, p_contexto, nullif(left(btrim(coalesce(p_adversario, '')), 40), ''), auth.uid())
  on conflict (equipe_id, partida_id) do update set contexto = excluded.contexto, adversario = excluded.adversario, por = auth.uid(), em = now();
end $$;
revoke execute on function public.partidas_contexto_listar(uuid), public.partida_definir_contexto(uuid, text, text, text) from public, anon;
grant execute on function public.partidas_contexto_listar(uuid), public.partida_definir_contexto(uuid, text, text, text) to authenticated;

-- =====================================================================
-- v47: rounds revisados (fila de VOD review): quem da equipe já reviu cada round
-- =====================================================================
create table if not exists public.rounds_revisados (
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  partida_id text not null check (partida_id ~ '^[0-9a-f-]{36}$'),
  n smallint not null check (n between 1 and 60),
  por uuid references auth.users (id) on delete set null,
  em timestamptz not null default now(),
  primary key (equipe_id, partida_id, n)
);
alter table public.rounds_revisados enable row level security;
revoke all on public.rounds_revisados from anon, public, authenticated;

create or replace function public.rounds_revisados_listar(p_equipe uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.eh_membro(p_equipe) or public.eh_admin()) then raise exception 'Só a equipe vê isso.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('partida', r.partida_id, 'n', r.n, 'por', (select apelido from public.perfis where id = r.por), 'em', r.em))
                   from public.rounds_revisados r where r.equipe_id = p_equipe), '[]'::jsonb);
end $$;

create or replace function public.round_marcar_revisado(p_equipe uuid, p_partida text, p_n int, p_sim boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.eh_admin() or coalesce(public.cargo_em(p_equipe)::text, 'convidado') <> 'convidado') then
    raise exception 'Só a equipe marca rounds revisados (convidados não).' using errcode = '42501';
  end if;
  if coalesce(p_partida, '') !~ '^[0-9a-f-]{36}$' or p_n is null or p_n not between 1 and 60 then raise exception 'round: inválido.' using errcode = 'P0001'; end if;
  if coalesce(p_sim, false) then
    insert into public.rounds_revisados (equipe_id, partida_id, n, por) values (p_equipe, p_partida, p_n, auth.uid())
    on conflict (equipe_id, partida_id, n) do update set por = auth.uid(), em = now();
  else
    delete from public.rounds_revisados where equipe_id = p_equipe and partida_id = p_partida and n = p_n;
  end if;
end $$;
revoke execute on function public.rounds_revisados_listar(uuid), public.round_marcar_revisado(uuid, text, int, boolean) from public, anon;
grant execute on function public.rounds_revisados_listar(uuid), public.round_marcar_revisado(uuid, text, int, boolean) to authenticated;

-- =====================================================================
-- Conferência final: todas as colunas devem mostrar true
-- =====================================================================
select exists (select 1 from pg_proc where proname = 'nuvem_disparo_manual') as botao_atualizar,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'membros' and column_name = 'liberado_premier') as manter_jogador_premier,
       coalesce((select prosrc like '%v_eu in (''lider'', ''colider'')%' from pg_proc where proname = 'definir_cargo' limit 1), false) as colider_define_cargos,
       exists (select 1 from pg_proc where proname = 'taticas_indice') as busca_taticas,
       exists (select 1 from pg_proc where proname = 'partida_definir_contexto') as contexto_partidas,
       exists (select 1 from pg_proc where proname = 'round_marcar_revisado') as rounds_revisados;
