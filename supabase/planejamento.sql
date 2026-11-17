-- =============================================================================
-- ValReport · Planejamento da equipe (v25)
--   Map pool (voto de mapas + pontos definidos pela liderança), comps e defaults por mapa (com print do lugar),
--   guia de calls, agenda (treinos, scrims, campeonatos) com presença, partidas fora das estatísticas,
--   elo opcional no perfil e a função "Playmaker".
-- Só a equipe vê (convidados não); líder, co-líderes e treinadores editam (a mesma regra das Táticas).
-- Rode DEPOIS do taticas.sql: SQL Editor → New query → cole tudo → Run. Pode rodar de novo sem estragar nada.
-- =============================================================================

do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'taticas') then
    raise exception 'Rode primeiro o supabase/taticas.sql e depois este arquivo de novo.';
  end if;
end $$;

-- ---------- Quem vê e quem edita ----------
create or replace function public.pode_ver_planejamento(p_equipe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.equipes where id = p_equipe and status = 'aprovada')
     and (public.eh_admin() or coalesce(public.cargo_em(p_equipe) in ('lider', 'colider', 'treinador', 'jogador'), false))
$$;
create or replace function public.pode_editar_planejamento(p_equipe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.equipes where id = p_equipe and status = 'aprovada')
     and (public.eh_admin() or coalesce(public.cargo_em(p_equipe) in ('lider', 'colider', 'treinador'), false))
$$;
create or replace function public.plan_erro(p_motivo text) returns void
language plpgsql immutable set search_path = '' as $$
begin raise exception '%', p_motivo using errcode = 'P0001'; end $$;
create or replace function public.plan_checar(p_equipe uuid, p_editar boolean) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Faça login primeiro.' using errcode = '42501'; end if;
  if p_editar and not public.pode_editar_planejamento(p_equipe) then
    raise exception 'Só a liderança e os treinadores mudam isso.' using errcode = '42501';
  end if;
  if not public.pode_ver_planejamento(p_equipe) then
    raise exception 'Só a equipe vê o planejamento.' using errcode = '42501';
  end if;
end $$;

-- ---------- Tabelas (tudo passa pelas funções abaixo) ----------
-- Uma linha por equipe: pool de mapas, pontos manuais, calls e a configuração da agenda
create table if not exists public.planejamento (
  equipe_id uuid primary key references public.equipes (id) on delete cascade,
  pool text[] not null default array['Abyss', 'Bind', 'Corrode', 'Haven', 'Lotus', 'Summit', 'Sunset'],
  pontos_manuais jsonb,                          -- { "Haven": 30, ... } ou vazio (vale a votação)
  pontos_manuais_por uuid references auth.users (id) on delete set null,
  pontos_manuais_em timestamptz,
  calls jsonb,                                   -- { lista: [{ codigo, alt, titulo, texto }], nota }
  tipos_evento jsonb not null default '[]'::jsonb,
  fuso text not null default 'America/Sao_Paulo',
  atualizado_em timestamptz not null default now()
);
create table if not exists public.votos_mapas (
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  ranking text[] not null,
  atualizado_em timestamptz not null default now(),
  primary key (equipe_id, usuario_id)
);
-- Comp e posições de ataque/defesa de cada mapa: { comp: [5 × {agente, usuario}], ataque: [5 × {rotulo, lugar, usuario, foto}], defesa: [...] }
create table if not exists public.defaults_mapas (
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  mapa text not null check (char_length(mapa) between 2 and 30),
  conteudo jsonb not null default '{}'::jsonb,
  atualizado_por uuid references auth.users (id) on delete set null,
  atualizado_em timestamptz not null default now(),
  primary key (equipe_id, mapa)
);
create table if not exists public.agenda_eventos (
  id uuid primary key default gen_random_uuid(),
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 80),
  tipo text not null default '' check (char_length(tipo) <= 40),
  data date not null,
  dia_todo boolean not null default false,
  inicio text not null default '' check (inicio = '' or inicio ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  fim text not null default '' check (fim = '' or fim ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  repete_dias smallint[],                        -- 0 = domingo … 6 = sábado (vazio = não repete)
  repete_ate date,
  canceladas date[] not null default '{}',       -- dias da série que foram cancelados
  local text not null default '' check (char_length(local) <= 300),
  adversario text not null default '' check (char_length(adversario) <= 80),
  mapa text not null default '' check (char_length(mapa) <= 30),
  notas text not null default '' check (char_length(notas) <= 2000),
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists agenda_eventos_equipe on public.agenda_eventos (equipe_id, data);
create table if not exists public.agenda_presencas (
  evento_id uuid not null references public.agenda_eventos (id) on delete cascade,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  dia date not null,
  status text not null check (status in ('vou', 'talvez', 'nao')),
  atualizado_em timestamptz not null default now(),
  primary key (evento_id, usuario_id, dia)
);
-- Partidas que não contam nas estatísticas de um jogador (outra pessoa jogou na conta, jogou passando mal…)
create table if not exists public.partidas_excluidas (
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  partida_id text not null check (partida_id ~ '^[0-9a-f-]{36}$'),
  slug text not null check (slug ~ '^[a-z0-9_-]{1,40}$'),
  motivo text not null default '' check (char_length(motivo) <= 140),
  resumo jsonb not null default '{}'::jsonb,     -- mapa, data, agente e placar, para listar mesmo fora dos dados
  por uuid references auth.users (id) on delete set null,
  em timestamptz not null default now(),
  primary key (equipe_id, partida_id, slug)
);

alter table public.planejamento enable row level security;
alter table public.votos_mapas enable row level security;
alter table public.defaults_mapas enable row level security;
alter table public.agenda_eventos enable row level security;
alter table public.agenda_presencas enable row level security;
alter table public.partidas_excluidas enable row level security;
revoke all on public.planejamento, public.votos_mapas, public.defaults_mapas, public.agenda_eventos, public.agenda_presencas, public.partidas_excluidas
  from anon, public, authenticated;

-- ---------- Validação de textos ----------
create or replace function public.plan_texto(p_v jsonb, p_max int, p_campo text) returns text
language plpgsql immutable set search_path = '' as $$
declare t text;
begin
  if p_v is null or jsonb_typeof(p_v) = 'null' then return ''; end if;
  if jsonb_typeof(p_v) <> 'string' then perform public.plan_erro(p_campo || ': formato inválido.'); end if;
  t := btrim(p_v #>> '{}');
  if char_length(t) > p_max then perform public.plan_erro(p_campo || ': até ' || p_max || ' caracteres.'); end if;
  return t;
end $$;
create or replace function public.plan_mapa_ok(p_mapa text) returns boolean
language sql immutable set search_path = '' as $$ select coalesce(p_mapa, '') ~ '^[[:alpha:]][[:alpha:] ''.-]{1,29}$' $$;

-- Membro da equipe que pode aparecer no planejamento (convidados não)
create or replace function public.plan_membro_ok(p_equipe uuid, p_usuario text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  if coalesce(p_usuario, '') = '' then return null; end if;
  if p_usuario !~ '^[0-9a-f-]{36}$' then perform public.plan_erro('jogador: inválido.'); end if;
  v := p_usuario::uuid;
  if not exists (select 1 from public.membros where equipe_id = p_equipe and usuario_id = v) then   -- v33: convidados também
    perform public.plan_erro('jogador: essa pessoa não está na equipe.');
  end if;
  return v;
end $$;

-- ---------- Ler tudo de uma vez ----------
create or replace function public.planejamento_ler(p_equipe uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare pl public.planejamento;
begin
  perform public.plan_checar(p_equipe, false);
  select * into pl from public.planejamento where equipe_id = p_equipe;
  return jsonb_build_object(
    'pode_editar', public.pode_editar_planejamento(p_equipe),
    'eu', auth.uid(),
    'pool', to_jsonb(coalesce(pl.pool, array['Abyss', 'Bind', 'Corrode', 'Haven', 'Lotus', 'Summit', 'Sunset'])),
    'pontos_manuais', pl.pontos_manuais,
    'pontos_manuais_em', pl.pontos_manuais_em,
    'pontos_manuais_por', (select p.apelido from public.perfis p where p.id = pl.pontos_manuais_por),
    'calls', pl.calls,
    'tipos_evento', coalesce(pl.tipos_evento, '[]'::jsonb),
    'fuso', coalesce(pl.fuso, 'America/Sao_Paulo'),
    'membros', coalesce((
      select jsonb_agg(jsonb_build_object('usuario_id', m.usuario_id, 'apelido', p.apelido, 'cargo', m.cargo,
               'riot_card', p.riot_card, 'cor', p.cor, 'agentes', to_jsonb(p.agentes), 'funcoes', to_jsonb(p.funcoes))
             order by array_position(array['lider', 'colider', 'jogador', 'treinador']::text[], m.cargo::text), m.entrou_em)
      from public.membros m join public.perfis p on p.id = m.usuario_id
      where m.equipe_id = p_equipe and m.cargo <> 'convidado'), '[]'::jsonb),
    -- v33: convidados (sub, stand-in) podem entrar na comp e nas posições; não votam nem contam na agenda
    'convidados', coalesce((
      select jsonb_agg(jsonb_build_object('usuario_id', m.usuario_id, 'apelido', p.apelido, 'cargo', m.cargo,
               'riot_card', p.riot_card, 'cor', p.cor, 'agentes', to_jsonb(p.agentes), 'funcoes', to_jsonb(p.funcoes)) order by m.entrou_em)
      from public.membros m join public.perfis p on p.id = m.usuario_id
      where m.equipe_id = p_equipe and m.cargo = 'convidado'), '[]'::jsonb),
    'votos', coalesce((
      select jsonb_agg(jsonb_build_object('usuario_id', v.usuario_id, 'ranking', to_jsonb(v.ranking), 'em', v.atualizado_em))
      from public.votos_mapas v where v.equipe_id = p_equipe
        and exists (select 1 from public.membros m where m.equipe_id = p_equipe and m.usuario_id = v.usuario_id)), '[]'::jsonb),
    'defaults', coalesce((select jsonb_object_agg(d.mapa, d.conteudo) from public.defaults_mapas d where d.equipe_id = p_equipe), '{}'::jsonb));
end $$;

-- ---------- Map pool ----------
create or replace function public.planejamento_garantir(p_equipe uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.planejamento (equipe_id) values (p_equipe) on conflict do nothing
$$;
create or replace function public.pool_de(p_equipe uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((select pool from public.planejamento where equipe_id = p_equipe), array['Abyss', 'Bind', 'Corrode', 'Haven', 'Lotus', 'Summit', 'Sunset'])
$$;

-- Ranking do favorito ao ban: precisa ter exatamente os mapas da pool, sem repetir
create or replace function public.votar_mapas(p_equipe uuid, p_ranking text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_pool text[] := public.pool_de(p_equipe);
begin
  perform public.plan_checar(p_equipe, false);
  if p_ranking is null or cardinality(p_ranking) <> cardinality(v_pool)
     or (select count(distinct x) from unnest(p_ranking) x) <> cardinality(v_pool)
     or exists (select 1 from unnest(p_ranking) x where not x = any (v_pool)) then
    perform public.plan_erro('voto: ordene todos os mapas da pool, sem repetir.');
  end if;
  insert into public.votos_mapas (equipe_id, usuario_id, ranking) values (p_equipe, auth.uid(), p_ranking)
  on conflict (equipe_id, usuario_id) do update set ranking = excluded.ranking, atualizado_em = now();
end $$;

-- Liderança: pontos à mão (valem no lugar da votação). Vazio = volta a valer a votação.
create or replace function public.definir_pontos_manuais(p_equipe uuid, p_pontos jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_pool text[] := public.pool_de(p_equipe); k text; v jsonb;
begin
  perform public.plan_checar(p_equipe, true);
  perform public.planejamento_garantir(p_equipe);
  if p_pontos is null or jsonb_typeof(p_pontos) = 'null' or p_pontos = '{}'::jsonb then
    update public.planejamento set pontos_manuais = null, pontos_manuais_por = null, pontos_manuais_em = null, atualizado_em = now()
    where equipe_id = p_equipe;
    return;
  end if;
  if jsonb_typeof(p_pontos) <> 'object' then perform public.plan_erro('pontos: formato inválido.'); end if;
  for k, v in select * from jsonb_each(p_pontos) loop
    if not k = any (v_pool) then perform public.plan_erro('pontos: ' || k || ' não está na pool.'); end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric) or (v #>> '{}')::int not between 0 and 9999 then
      perform public.plan_erro('pontos: use números inteiros de 0 a 9999.');
    end if;
  end loop;
  update public.planejamento set pontos_manuais = p_pontos, pontos_manuais_por = auth.uid(), pontos_manuais_em = now(), atualizado_em = now()
  where equipe_id = p_equipe;
end $$;

-- Liderança: começar uma votação nova (apaga os votos)
create or replace function public.limpar_votos_mapas(p_equipe uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.plan_checar(p_equipe, true);
  delete from public.votos_mapas where equipe_id = p_equipe;
  get diagnostics n = row_count;
  return n;
end $$;

-- Liderança: trocar os mapas da pool (quando a Riot muda a rotação). Pontos manuais de mapas que saíram somem.
create or replace function public.definir_pool(p_equipe uuid, p_pool text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.plan_checar(p_equipe, true);
  if p_pool is null or cardinality(p_pool) not between 3 and 12
     or (select count(distinct x) from unnest(p_pool) x) <> cardinality(p_pool)
     or exists (select 1 from unnest(p_pool) x where not public.plan_mapa_ok(x)) then
    perform public.plan_erro('pool: escolha de 3 a 12 mapas diferentes.');
  end if;
  perform public.planejamento_garantir(p_equipe);
  update public.planejamento
     set pool = p_pool,
         pontos_manuais = nullif((select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(pontos_manuais) e(k, v) where k = any (p_pool)), '{}'::jsonb),
         atualizado_em = now()
   where equipe_id = p_equipe;
end $$;

-- ---------- Comps e defaults por mapa ----------
create or replace function public.salvar_default_mapa(p_equipe uuid, p_mapa text, p_conteudo jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare out_comp jsonb := '[]'::jsonb; out_lado jsonb; out jsonb := '{}'::jsonb; it jsonb; lado text; ag text; foto text; agentes text[] := '{}';
        px numeric; py numeric; ponto jsonb;
begin
  perform public.plan_checar(p_equipe, true);
  if not public.plan_mapa_ok(p_mapa) then perform public.plan_erro('mapa: inválido.'); end if;
  if p_conteudo is null or jsonb_typeof(p_conteudo) <> 'object' then perform public.plan_erro('conteúdo inválido.'); end if;
  -- comp: até 5 vagas, agente sem repetir
  if jsonb_typeof(coalesce(p_conteudo -> 'comp', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_conteudo -> 'comp', '[]'::jsonb)) > 5 then
    perform public.plan_erro('comp: até 5 agentes.');
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_conteudo -> 'comp', '[]'::jsonb)) loop
    ag := public.plan_texto(it -> 'agente', 20, 'agente');
    if ag <> '' and ag !~ '^[[:alpha:]][[:alpha:] /.-]{1,19}$' then perform public.plan_erro('agente: inválido.'); end if;
    if ag <> '' and ag = any (agentes) then perform public.plan_erro('comp: ' || ag || ' está duas vezes.'); end if;
    if ag <> '' then agentes := agentes || ag; end if;
    out_comp := out_comp || jsonb_build_object('agente', ag, 'usuario', public.plan_membro_ok(p_equipe, it ->> 'usuario'));
  end loop;
  out := jsonb_build_object('comp', out_comp);
  foreach lado in array array['ataque', 'defesa'] loop
    out_lado := '[]'::jsonb;
    if jsonb_typeof(coalesce(p_conteudo -> lado, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_conteudo -> lado, '[]'::jsonb)) > 5 then
      perform public.plan_erro(lado || ': até 5 posições.');
    end if;
    for it in select * from jsonb_array_elements(coalesce(p_conteudo -> lado, '[]'::jsonb)) loop
      foto := public.plan_texto(it -> 'foto', 120, 'foto');
      if foto <> '' and foto !~ ('^' || p_equipe::text || '/[a-f0-9]{16,32}\.(webp|jpg|png)$') then perform public.plan_erro('foto: arquivo inválido.'); end if;
      -- v33: ponto marcado no minimapa (0 a 1 em x e y), no lugar do callout achado pelo nome
      ponto := null;
      if jsonb_typeof(it -> 'ponto') = 'object' and jsonb_typeof(it -> 'ponto' -> 'x') = 'number' and jsonb_typeof(it -> 'ponto' -> 'y') = 'number' then
        px := (it -> 'ponto' ->> 'x')::numeric; py := (it -> 'ponto' ->> 'y')::numeric;
        if px < 0 or px > 1 or py < 0 or py > 1 then perform public.plan_erro('ponto: fora do mapa.'); end if;
        ponto := jsonb_build_object('x', round(px, 4), 'y', round(py, 4));
      end if;
      out_lado := out_lado || jsonb_build_object('rotulo', public.plan_texto(it -> 'rotulo', 40, 'posição'), 'lugar', public.plan_texto(it -> 'lugar', 40, 'lugar'),
                                                 'usuario', public.plan_membro_ok(p_equipe, it ->> 'usuario'), 'foto', nullif(foto, ''), 'ponto', ponto);
    end loop;
    out := out || jsonb_build_object(lado, out_lado);
  end loop;
  insert into public.defaults_mapas (equipe_id, mapa, conteudo, atualizado_por) values (p_equipe, p_mapa, out, auth.uid())
  on conflict (equipe_id, mapa) do update set conteudo = excluded.conteudo, atualizado_por = auth.uid(), atualizado_em = now();
end $$;

-- ---------- Calls ----------
create or replace function public.salvar_calls(p_equipe uuid, p_calls jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare lista jsonb := '[]'::jsonb; it jsonb; cod text;
begin
  perform public.plan_checar(p_equipe, true);
  if p_calls is null or jsonb_typeof(p_calls) <> 'object' or jsonb_typeof(coalesce(p_calls -> 'lista', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_calls -> 'lista', '[]'::jsonb)) > 40 then
    perform public.plan_erro('calls: até 40 calls.');
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_calls -> 'lista', '[]'::jsonb)) loop
    cod := upper(public.plan_texto(it -> 'codigo', 20, 'call'));
    if cod = '' then continue; end if;
    lista := lista || jsonb_build_object('codigo', cod, 'alt', public.plan_texto(it -> 'alt', 20, 'variação'),
                                         'titulo', public.plan_texto(it -> 'titulo', 60, 'significado'), 'texto', public.plan_texto(it -> 'texto', 600, 'explicação'));
  end loop;
  perform public.planejamento_garantir(p_equipe);
  update public.planejamento set calls = jsonb_build_object('lista', lista, 'nota', public.plan_texto(p_calls -> 'nota', 1500, 'mensagem')), atualizado_em = now()
  where equipe_id = p_equipe;
end $$;

-- ---------- Agenda ----------
create or replace function public.agenda_ler(p_equipe uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.plan_checar(p_equipe, false);
  return jsonb_build_object(
    'eventos', coalesce((select jsonb_agg(to_jsonb(e) - 'equipe_id' - 'criado_por' order by e.data)
                         from public.agenda_eventos e where e.equipe_id = p_equipe
                           and (e.data >= current_date - 120 or e.repete_ate is null or e.repete_ate >= current_date - 120)), '[]'::jsonb),
    'presencas', coalesce((select jsonb_agg(jsonb_build_object('evento', p.evento_id, 'usuario', p.usuario_id, 'dia', p.dia, 'status', p.status))
                           from public.agenda_presencas p join public.agenda_eventos e on e.id = p.evento_id
                           where e.equipe_id = p_equipe and p.dia >= current_date - 120), '[]'::jsonb));
end $$;

create or replace function public.agenda_salvar(p_equipe uuid, p_evento jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_dias smallint[]; v_inicio text; v_fim text; v_dia_todo boolean; v_ate date; v_mapa text;
begin
  perform public.plan_checar(p_equipe, true);
  if p_evento is null or jsonb_typeof(p_evento) <> 'object' then perform public.plan_erro('evento inválido.'); end if;
  if coalesce(p_evento ->> 'titulo', '') !~ '\S' then perform public.plan_erro('nome: dê um nome ao evento.'); end if;
  if coalesce(p_evento ->> 'data', '') !~ '^\d{4}-\d{2}-\d{2}$' then perform public.plan_erro('data: inválida.'); end if;
  v_dia_todo := coalesce((p_evento ->> 'dia_todo')::boolean, false);
  v_inicio := case when v_dia_todo then '' else public.plan_texto(p_evento -> 'inicio', 5, 'início') end;
  v_fim := case when v_dia_todo then '' else public.plan_texto(p_evento -> 'fim', 5, 'fim') end;
  if jsonb_typeof(p_evento -> 'repete_dias') = 'array' and jsonb_array_length(p_evento -> 'repete_dias') > 0 then
    select array_agg(distinct x::smallint order by x::smallint) into v_dias from jsonb_array_elements_text(p_evento -> 'repete_dias') x;
    if exists (select 1 from unnest(v_dias) d where d not between 0 and 6) then perform public.plan_erro('repetição: dias inválidos.'); end if;
    v_ate := nullif(p_evento ->> 'repete_ate', '')::date;
    if v_ate is not null and v_ate < (p_evento ->> 'data')::date then perform public.plan_erro('repetição: a data final é antes do começo.'); end if;
  end if;
  if v_inicio !~ '^(([01][0-9]|2[0-3]):[0-5][0-9])?$' or v_fim !~ '^(([01][0-9]|2[0-3]):[0-5][0-9])?$' then
    perform public.plan_erro('horário: use o formato HH:MM (ex.: 20:00).');
  end if;
  v_mapa := public.plan_texto(p_evento -> 'mapa', 30, 'mapa');
  if v_mapa <> '' and not public.plan_mapa_ok(v_mapa) then perform public.plan_erro('mapa: inválido.'); end if;
  v_id := nullif(p_evento ->> 'id', '')::uuid;
  if v_id is not null then
    update public.agenda_eventos set
      titulo = public.plan_texto(p_evento -> 'titulo', 80, 'nome'), tipo = public.plan_texto(p_evento -> 'tipo', 40, 'tipo'),
      data = (p_evento ->> 'data')::date, dia_todo = v_dia_todo, inicio = v_inicio, fim = v_fim,
      repete_dias = v_dias, repete_ate = v_ate,
      canceladas = coalesce((select array_agg(distinct x::date) from jsonb_array_elements_text(coalesce(p_evento -> 'canceladas', '[]'::jsonb)) x), '{}'),
      local = public.plan_texto(p_evento -> 'local', 300, 'local'), adversario = public.plan_texto(p_evento -> 'adversario', 80, 'adversário'),
      mapa = v_mapa, notas = public.plan_texto(p_evento -> 'notas', 2000, 'observações'), atualizado_em = now()
    where id = v_id and equipe_id = p_equipe;
    if not found then perform public.plan_erro('evento: não encontrado.'); end if;
  else
    insert into public.agenda_eventos (equipe_id, titulo, tipo, data, dia_todo, inicio, fim, repete_dias, repete_ate, local, adversario, mapa, notas, criado_por)
    values (p_equipe, public.plan_texto(p_evento -> 'titulo', 80, 'nome'), public.plan_texto(p_evento -> 'tipo', 40, 'tipo'), (p_evento ->> 'data')::date,
            v_dia_todo, v_inicio, v_fim, v_dias, v_ate, public.plan_texto(p_evento -> 'local', 300, 'local'),
            public.plan_texto(p_evento -> 'adversario', 80, 'adversário'), v_mapa, public.plan_texto(p_evento -> 'notas', 2000, 'observações'), auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.agenda_apagar(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_equipe uuid;
begin
  select equipe_id into v_equipe from public.agenda_eventos where id = p_id;
  if v_equipe is null then perform public.plan_erro('evento: não encontrado.'); end if;
  perform public.plan_checar(v_equipe, true);
  delete from public.agenda_eventos where id = p_id;
end $$;

-- Presença: cada um marca a sua, em cada dia do evento. Vazio = desmarcar.
create or replace function public.agenda_presenca(p_evento uuid, p_dia date, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_equipe uuid;
begin
  select equipe_id into v_equipe from public.agenda_eventos where id = p_evento;
  if v_equipe is null then perform public.plan_erro('evento: não encontrado.'); end if;
  perform public.plan_checar(v_equipe, false);
  if p_dia is null then perform public.plan_erro('dia: inválido.'); end if;
  if coalesce(p_status, '') = '' then
    delete from public.agenda_presencas where evento_id = p_evento and usuario_id = auth.uid() and dia = p_dia;
  elsif p_status in ('vou', 'talvez', 'nao') then
    insert into public.agenda_presencas (evento_id, usuario_id, dia, status) values (p_evento, auth.uid(), p_dia, p_status)
    on conflict (evento_id, usuario_id, dia) do update set status = excluded.status, atualizado_em = now();
  else
    perform public.plan_erro('presença: inválida.');
  end if;
end $$;

-- Tipos de evento (nome e cor) e fuso da agenda
create or replace function public.agenda_configurar(p_equipe uuid, p_tipos jsonb, p_fuso text) returns void
language plpgsql security definer set search_path = '' as $$
declare it jsonb; out jsonb := '[]'::jsonb;
begin
  perform public.plan_checar(p_equipe, true);
  if p_tipos is null or jsonb_typeof(p_tipos) <> 'array' or jsonb_array_length(p_tipos) not between 1 and 20 then
    perform public.plan_erro('tipos: de 1 a 20 tipos.');
  end if;
  for it in select * from jsonb_array_elements(p_tipos) loop
    if coalesce(it ->> 'id', '') !~ '^[a-z0-9_-]{1,40}$' or coalesce(it ->> 'cor', '') !~ '^#[0-9a-fA-F]{6}$' then
      perform public.plan_erro('tipos: formato inválido.');
    end if;
    out := out || jsonb_build_object('id', it ->> 'id', 'nome', coalesce(nullif(public.plan_texto(it -> 'nome', 30, 'tipo'), ''), 'Sem nome'), 'cor', lower(it ->> 'cor'));
  end loop;
  if coalesce(p_fuso, '') not in ('America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco', 'America/Noronha', 'Europe/Lisbon', 'UTC') then
    perform public.plan_erro('fuso: inválido.');
  end if;
  perform public.planejamento_garantir(p_equipe);
  update public.planejamento set tipos_evento = out, fuso = p_fuso, atualizado_em = now() where equipe_id = p_equipe;
end $$;

-- ---------- Partidas fora das estatísticas ----------
create or replace function public.partidas_excluidas_listar(p_equipe uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Faça login primeiro.' using errcode = '42501'; end if;
  if not (public.eh_membro(p_equipe) or public.eh_admin()) then raise exception 'Só a equipe vê.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('partida', x.partida_id, 'slug', x.slug, 'motivo', x.motivo, 'resumo', x.resumo, 'em', x.em,
                                                       'por', (select p.apelido from public.perfis p where p.id = x.por)) order by x.em desc)
                   from public.partidas_excluidas x where x.equipe_id = p_equipe), '[]'::jsonb);
end $$;

-- Liderança (e treinadores): tirar ou devolver uma partida das contas de um jogador
create or replace function public.excluir_partida(p_equipe uuid, p_partida text, p_slug text, p_excluir boolean,
                                                  p_motivo text default '', p_resumo jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.plan_checar(p_equipe, true);
  if coalesce(p_partida, '') !~ '^[0-9a-f-]{36}$' or coalesce(p_slug, '') !~ '^[a-z0-9_-]{1,40}$' then
    perform public.plan_erro('partida: inválida.');
  end if;
  if not p_excluir then
    delete from public.partidas_excluidas where equipe_id = p_equipe and partida_id = p_partida and slug = p_slug;
    return;
  end if;
  if char_length(coalesce(p_motivo, '')) > 140 then perform public.plan_erro('motivo: até 140 caracteres.'); end if;
  if p_resumo is not null and (jsonb_typeof(p_resumo) <> 'object' or char_length(p_resumo::text) > 600) then
    perform public.plan_erro('resumo: inválido.');
  end if;
  insert into public.partidas_excluidas (equipe_id, partida_id, slug, motivo, resumo, por)
  values (p_equipe, p_partida, p_slug, btrim(coalesce(p_motivo, '')), coalesce(p_resumo, '{}'::jsonb), auth.uid())
  on conflict (equipe_id, partida_id, slug) do update set motivo = excluded.motivo, por = auth.uid(), em = now();
end $$;

-- Para a coleta (chave secreta): o que fica fora das contas
create or replace function public.pc_partidas_excluidas(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('partida', x.partida_id, 'slug', x.slug)), '[]'::jsonb)
  from public.partidas_excluidas x join public.equipes e on e.id = x.equipe_id where e.slug = p_slug
$$;

-- ---------- Elo opcional (Meu perfil) ----------
alter table public.perfis add column if not exists mostrar_elo boolean not null default true;
grant update (mostrar_elo) on public.perfis to authenticated;

-- ---------- Arquivos: prints do lugar de cada posição ----------
-- <equipe>/<nome aleatório>.<extensão>. Só a equipe abre (endereços temporários); só a liderança envia e apaga.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('planejamento', 'planejamento', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

create or replace function public.pode_arquivo_planejamento(p_nome text, p_editar boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_equipe uuid;
begin
  if coalesce(p_nome, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-f0-9]{16,32}\.(webp|jpg|png)$' then return false; end if;
  v_equipe := split_part(p_nome, '/', 1)::uuid;
  return case when p_editar then public.pode_editar_planejamento(v_equipe) else public.pode_ver_planejamento(v_equipe) end;
end $$;

drop policy if exists planejamento_arquivo_ver on storage.objects;
create policy planejamento_arquivo_ver on storage.objects for select to authenticated
  using (bucket_id = 'planejamento' and public.pode_arquivo_planejamento(name, false));
drop policy if exists planejamento_arquivo_enviar on storage.objects;
create policy planejamento_arquivo_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'planejamento' and public.pode_arquivo_planejamento(name, true));
drop policy if exists planejamento_arquivo_trocar on storage.objects;
create policy planejamento_arquivo_trocar on storage.objects for update to authenticated
  using (bucket_id = 'planejamento' and public.pode_arquivo_planejamento(name, true))
  with check (bucket_id = 'planejamento' and public.pode_arquivo_planejamento(name, true));
drop policy if exists planejamento_arquivo_apagar on storage.objects;
create policy planejamento_arquivo_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'planejamento' and public.pode_arquivo_planejamento(name, true));

-- ---------- Função "Playmaker" no perfil ----------
-- (a mesma validação do etapa2.sql, agora aceitando Playmaker)
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
     or exists (select 1 from unnest(new.funcoes) f where f not in ('Duelista', 'Iniciador', 'Controlador', 'Sentinela', 'Playmaker', 'Flex'))
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

-- ---------- Permissões das funções ----------
revoke execute on function public.plan_erro(text), public.plan_checar(uuid, boolean), public.plan_texto(jsonb, int, text), public.plan_mapa_ok(text),
  public.plan_membro_ok(uuid, text), public.planejamento_garantir(uuid), public.pool_de(uuid), public.pc_partidas_excluidas(text),
  public.pc_elenco_equipe(text), public.validar_perfil_2()
  from public, anon, authenticated;
revoke execute on function public.pode_ver_planejamento(uuid), public.pode_editar_planejamento(uuid), public.planejamento_ler(uuid),
  public.votar_mapas(uuid, text[]), public.definir_pontos_manuais(uuid, jsonb), public.limpar_votos_mapas(uuid), public.definir_pool(uuid, text[]),
  public.salvar_default_mapa(uuid, text, jsonb), public.salvar_calls(uuid, jsonb), public.agenda_ler(uuid), public.agenda_salvar(uuid, jsonb),
  public.agenda_apagar(uuid), public.agenda_presenca(uuid, date, text), public.agenda_configurar(uuid, jsonb, text),
  public.partidas_excluidas_listar(uuid), public.excluir_partida(uuid, text, text, boolean, text, jsonb), public.pode_arquivo_planejamento(text, boolean)
  from public, anon;
grant execute on function public.pode_ver_planejamento(uuid), public.pode_editar_planejamento(uuid), public.planejamento_ler(uuid),
  public.votar_mapas(uuid, text[]), public.definir_pontos_manuais(uuid, jsonb), public.limpar_votos_mapas(uuid), public.definir_pool(uuid, text[]),
  public.salvar_default_mapa(uuid, text, jsonb), public.salvar_calls(uuid, jsonb), public.agenda_ler(uuid), public.agenda_salvar(uuid, jsonb),
  public.agenda_apagar(uuid), public.agenda_presenca(uuid, date, text), public.agenda_configurar(uuid, jsonb, text),
  public.partidas_excluidas_listar(uuid), public.excluir_partida(uuid, text, text, boolean, text, jsonb), public.pode_arquivo_planejamento(text, boolean)
  to authenticated;
grant execute on function public.pc_partidas_excluidas(text), public.pc_elenco_equipe(text) to service_role;

-- Conferência: deve mostrar 6 tabelas, o balde "planejamento" privado e 4 regras de arquivo
select (select count(*) from information_schema.tables where table_schema = 'public'
          and table_name in ('planejamento', 'votos_mapas', 'defaults_mapas', 'agenda_eventos', 'agenda_presencas', 'partidas_excluidas')) as tabelas,
       (select public from storage.buckets where id = 'planejamento') as balde_publico,
       (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'planejamento_arquivo_%') as regras;
