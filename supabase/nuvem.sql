-- =============================================================================
-- ValReport 2.0 · Coleta na nuvem (sem depender do PC)
-- 1. Um espaço privado ("coleta") para a pasta dados: partidas, estado, elo e log. Só a chave secreta acessa.
-- 2. A configuração da coleta (o antigo config.json) no banco, com histórico, editável pelo Painel.
-- 3. O registro dos disparos do "Sincronizar na hora" (no máximo 1 por minuto e 30 por hora).
-- Rode DEPOIS do sync.sql: SQL Editor → New query → cole tudo → Run. Pode rodar de novo sem estragar nada.
-- =============================================================================

do $$ begin
  if to_regclass('public.sync_pedidos') is null then
    raise exception 'Rode primeiro o supabase/sync.sql e depois este arquivo de novo.';
  end if;
end $$;

-- ---------- 1. Espaço privado da coleta (sem nenhuma regra de acesso: só a chave secreta entra) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('coleta', 'coleta', false, 209715200)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- ---------- 2. Configuração da coleta ----------
create table if not exists public.config_coleta (
  equipe_id uuid primary key references public.equipes (id) on delete cascade,
  config jsonb not null,
  versao int not null default 1,
  origem text not null default 'site' check (origem in ('site', 'pc')),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid references auth.users (id) on delete set null
);
create table if not exists public.config_coleta_historico (
  id bigint generated always as identity primary key,
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  versao int not null,
  config jsonb not null,
  origem text not null,
  salvo_em timestamptz not null,
  salvo_por uuid references auth.users (id) on delete set null
);
create index if not exists config_coleta_historico_equipe on public.config_coleta_historico (equipe_id, versao desc);
alter table public.config_coleta enable row level security;
alter table public.config_coleta_historico enable row level security;
revoke all on public.config_coleta, public.config_coleta_historico from anon, public, authenticated;

-- Confere a configuração antes de guardar: devolve o problema em texto (ou nada, se estiver tudo certo)
create or replace function public.config_coleta_problema(p jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare r text; n numeric; f text;
  limites constant jsonb := '{"janela_dias": [1, 365], "janela_referencia_dias": [7, 3650], "max_paginas_por_jogador": [1, 10],
    "amostra_minima_rounds": [10, 5000], "min_partidas_grupo": [1, 50], "destaque_impacto_pct": [0, 500],
    "observar_impacto_pct": [-500, 0], "max_rounds_no_resumo": [0, 30], "validacao_por_jogador": [0, 20]}';
begin
  if jsonb_typeof(p) is distinct from 'object' then return 'a configuração precisa ser um objeto JSON.'; end if;
  if octet_length(p::text) > 65536 then return 'a configuração passou de 64 KB.'; end if;
  if p::text ~* 'discord(app)?\.com/api/webhooks|HDEV-|sb_secret_' then
    return 'a configuração não pode ter chaves nem webhooks (eles ficam nos segredos do GitHub).';
  end if;
  if jsonb_typeof(p -> 'jogadores') is distinct from 'array' then return '"jogadores" precisa ser uma lista de Riot IDs.'; end if;
  if jsonb_array_length(p -> 'jogadores') > 40 then return 'no máximo 40 jogadores.'; end if;
  for r in select x from jsonb_array_elements_text(p -> 'jogadores') x loop
    if r !~ '^[^#[:cntrl:]]{1,16}#[^#[:cntrl:]]{1,5}$' then return format('Riot ID inválido: "%s" (use Nome#TAG).', left(r, 40)); end if;
  end loop;
  if p ? 'apelidos' and jsonb_typeof(p -> 'apelidos') is distinct from 'object' then return '"apelidos" precisa ser um objeto.'; end if;
  if p ? 'filas_incluidas' then
    if jsonb_typeof(p -> 'filas_incluidas') is distinct from 'array' or jsonb_array_length(p -> 'filas_incluidas') = 0 then
      return '"filas_incluidas" precisa ter pelo menos uma fila.';
    end if;
    for r in select x from jsonb_array_elements_text(p -> 'filas_incluidas') x loop
      if r not in ('competitive', 'premier', 'custom', 'unrated', 'swiftplay', 'hurm', 'deathmatch', 'spikerush') then
        return format('fila desconhecida: "%s".', left(r, 30));
      end if;
    end loop;
  end if;
  for f in select jsonb_object_keys(limites) loop
    if p ? f then
      if jsonb_typeof(p -> f) is distinct from 'number' then return format('"%s" precisa ser um número.', f); end if;
      n := (p ->> f)::numeric;
      if n < (limites -> f ->> 0)::numeric or n > (limites -> f ->> 1)::numeric then
        return format('"%s" precisa ficar entre %s e %s.', f, limites -> f ->> 0, limites -> f ->> 1);
      end if;
    end if;
  end loop;
  if p ? 'regiao' and (p ->> 'regiao') not in ('br', 'na', 'latam', 'eu', 'ap', 'kr') then return 'região inválida.'; end if;
  return null;
end $$;

create or replace function public.config_coleta_json(p_equipe uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('config', c.config, 'versao', c.versao, 'origem', c.origem, 'atualizado_em', c.atualizado_em,
    'atualizado_por', (select apelido from public.perfis where id = c.atualizado_por),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('versao', h.versao, 'origem', h.origem, 'salvo_em', h.salvo_em,
                              'salvo_por', (select apelido from public.perfis where id = h.salvo_por)) order by h.versao desc)
                           from (select * from public.config_coleta_historico where equipe_id = p_equipe order by versao desc limit 30) h), '[]'::jsonb))
  from public.config_coleta c where c.equipe_id = p_equipe
$$;

-- Guarda (a versão anterior vai para o histórico; ficam as 30 mais recentes)
create or replace function public.config_coleta_gravar(p_equipe uuid, p_config jsonb, p_origem text, p_por uuid, p_versao_base int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare atual public.config_coleta; problema text := public.config_coleta_problema(p_config);
begin
  if problema is not null then raise exception 'config_invalida: %', problema using errcode = 'P0001'; end if;
  select * into atual from public.config_coleta where equipe_id = p_equipe for update;
  if atual.equipe_id is null then
    insert into public.config_coleta (equipe_id, config, versao, origem, atualizado_por) values (p_equipe, p_config, 1, p_origem, p_por);
  else
    if p_versao_base is not null and p_versao_base <> atual.versao then
      raise exception 'config_conflito: alguém salvou a configuração enquanto você editava (agora está na versão %). Abra de novo.', atual.versao
        using errcode = 'P0001';
    end if;
    if atual.config = p_config then return public.config_coleta_json(p_equipe); end if;
    insert into public.config_coleta_historico (equipe_id, versao, config, origem, salvo_em, salvo_por)
    values (p_equipe, atual.versao, atual.config, atual.origem, atual.atualizado_em, atual.atualizado_por);
    update public.config_coleta set config = p_config, versao = atual.versao + 1, origem = p_origem, atualizado_em = now(), atualizado_por = p_por
     where equipe_id = p_equipe;
    delete from public.config_coleta_historico where equipe_id = p_equipe
       and id not in (select id from public.config_coleta_historico where equipe_id = p_equipe order by versao desc limit 30);
  end if;
  return public.config_coleta_json(p_equipe);
end $$;

create or replace function public.admin_config_ler(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_eq uuid;
begin
  if not public.eh_admin() then raise exception 'Somente a administradora vê a configuração da coleta.' using errcode = '42501'; end if;
  v_eq := public.sync_equipe(p_slug);
  if v_eq is null then raise exception 'sync_equipe: equipe não encontrada.' using errcode = 'P0001'; end if;
  return coalesce(public.config_coleta_json(v_eq), jsonb_build_object('config', null, 'versao', 0, 'historico', '[]'::jsonb));
end $$;

create or replace function public.admin_config_salvar(p_slug text, p_config jsonb, p_versao_base int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_eq uuid;
begin
  if not public.eh_admin() then raise exception 'Somente a administradora muda a configuração da coleta.' using errcode = '42501'; end if;
  v_eq := public.sync_equipe(p_slug);
  if v_eq is null then raise exception 'sync_equipe: equipe não encontrada.' using errcode = 'P0001'; end if;
  return public.config_coleta_gravar(v_eq, p_config, 'site', auth.uid(), p_versao_base);
end $$;

create or replace function public.admin_config_versao(p_slug text, p_versao int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_eq uuid; v jsonb;
begin
  if not public.eh_admin() then raise exception 'Somente a administradora vê a configuração da coleta.' using errcode = '42501'; end if;
  v_eq := public.sync_equipe(p_slug);
  select config into v from public.config_coleta_historico where equipe_id = v_eq and versao = p_versao;
  if v is null then raise exception 'config_versao: essa versão não está mais guardada.' using errcode = 'P0001'; end if;
  return v;
end $$;

-- Para a nuvem (e para o enviar_para_nuvem.bat do PC)
create or replace function public.pc_config_ler(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.config_coleta_json(public.sync_equipe(p_slug))
$$;
create or replace function public.pc_config_enviar(p_slug text, p_config jsonb, p_substituir boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_eq uuid := public.sync_equipe(p_slug);
begin
  if v_eq is null then raise exception 'sync_equipe: equipe não encontrada.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.config_coleta where equipe_id = v_eq) and not coalesce(p_substituir, false) then
    return public.config_coleta_json(v_eq) || jsonb_build_object('ja_existia', true);
  end if;
  return public.config_coleta_gravar(v_eq, p_config, 'pc', null, null);
end $$;

-- ---------- 3. Disparos do "Sincronizar na hora" ----------
create table if not exists public.nuvem_disparos (
  id bigint generated always as identity primary key,
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  por uuid references auth.users (id) on delete set null,
  em timestamptz not null default now()
);
create index if not exists nuvem_disparos_equipe on public.nuvem_disparos (equipe_id, em desc);
alter table public.nuvem_disparos enable row level security;
revoke all on public.nuvem_disparos from anon, public, authenticated;

-- A função do site (api/disparar) pergunta aqui, com o login de quem clicou, se pode disparar a nuvem agora
create or replace function public.admin_nuvem_disparo(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_eq uuid; v_ultimo timestamptz;
begin
  if not public.eh_admin() then raise exception 'Somente a administradora dispara a coleta.' using errcode = '42501'; end if;
  v_eq := public.sync_equipe(p_slug);
  if v_eq is null then raise exception 'sync_equipe: equipe não encontrada.' using errcode = 'P0001'; end if;
  select max(em) into v_ultimo from public.nuvem_disparos where equipe_id = v_eq;
  if v_ultimo > now() - interval '1 minute' then
    return jsonb_build_object('pode', false, 'motivo', 'A nuvem foi chamada há menos de 1 minuto; ela já vai pegar este pedido.', 'ultimo', v_ultimo);
  end if;
  if (select count(*) from public.nuvem_disparos where equipe_id = v_eq and em > now() - interval '1 hour') >= 30 then
    return jsonb_build_object('pode', false, 'motivo', 'Muitas chamadas na última hora; a coleta de 20 em 20 minutos pega os pedidos.', 'ultimo', v_ultimo);
  end if;
  insert into public.nuvem_disparos (equipe_id, por) values (v_eq, auth.uid());
  delete from public.nuvem_disparos where equipe_id = v_eq and em < now() - interval '7 days';
  return jsonb_build_object('pode', true, 'ultimo', v_ultimo);
end $$;

-- ---------- Permissões das funções ----------
revoke execute on function public.config_coleta_problema(jsonb), public.config_coleta_json(uuid),
  public.config_coleta_gravar(uuid, jsonb, text, uuid, int), public.admin_config_ler(text), public.admin_config_salvar(text, jsonb, int),
  public.admin_config_versao(text, int), public.pc_config_ler(text), public.pc_config_enviar(text, jsonb, boolean),
  public.admin_nuvem_disparo(text)
  from public, anon, authenticated;
grant execute on function public.admin_config_ler(text), public.admin_config_salvar(text, jsonb, int), public.admin_config_versao(text, int),
  public.admin_nuvem_disparo(text)
  to authenticated;
grant execute on function public.pc_config_ler(text), public.pc_config_enviar(text, jsonb, boolean) to service_role;

-- Conferência: deve mostrar "coleta" (o espaço privado) e false (não é público)
select id as espaco, public as publico from storage.buckets where id = 'coleta';
