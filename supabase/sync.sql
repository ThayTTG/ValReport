-- =============================================================================
-- ValReport 2.0 · Sync da administradora
-- A página "Sync" do Painel mostra o que ficou faltando (partidas incompletas, elo desatualizado, contas sem
-- card, erros da coleta) e cria pedidos; a coleta de 20 em 20 minutos do PC pega os pedidos, refaz e marca
-- como feitos. O PC também manda o estado dele a cada coleta (é assim que a página sabe se ele está ligado).
-- Rode DEPOIS do comentarios.sql: SQL Editor → New query → cole tudo → Run. Pode rodar de novo sem estragar nada.
-- =============================================================================

do $$ begin
  if to_regclass('public.comentarios') is null then
    raise exception 'Rode primeiro o supabase/comentarios.sql e depois este arquivo de novo.';
  end if;
end $$;

-- Pedidos: "buscar de novo" uma partida, o elo ou o card de alguém, "sincronizar tudo" ou "reenviar ao site"
create table if not exists public.sync_pedidos (
  id uuid primary key default gen_random_uuid(),
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  tipo text not null check (tipo in ('tudo', 'partida', 'elo', 'card', 'site')),
  alvo text check (char_length(alvo) between 1 and 80),
  status text not null default 'pendente' check (status in ('pendente', 'fazendo', 'feito', 'erro', 'cancelado')),
  resultado text check (char_length(resultado) <= 1000),
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  concluido_em timestamptz
);
create index if not exists sync_pedidos_equipe on public.sync_pedidos (equipe_id, criado_em desc);
-- Um pedido aberto por coisa: clicar duas vezes em "Buscar de novo" não cria dois
create unique index if not exists sync_pedidos_aberto on public.sync_pedidos (equipe_id, tipo, coalesce(alvo, ''))
  where status in ('pendente', 'fazendo');
alter table public.sync_pedidos enable row level security;
revoke all on public.sync_pedidos from anon, public, authenticated;

-- O que o PC viu na última coleta (o "diagnóstico") e quando ele apareceu pela última vez
create table if not exists public.sync_estado (
  equipe_id uuid primary key references public.equipes (id) on delete cascade,
  estado jsonb not null default '{}'::jsonb,
  versao text check (char_length(versao) <= 40),
  pc_visto_em timestamptz not null default now()
);
alter table public.sync_estado enable row level security;
revoke all on public.sync_estado from anon, public, authenticated;

-- ---------- Apoio ----------
create or replace function public.sync_equipe(p_slug text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.equipes where slug = p_slug and status = 'aprovada'
$$;

-- Alvo de cada tipo: partida = id da partida; elo e card = Riot ID (Nome#TAG); tudo e site = nenhum
create or replace function public.sync_alvo_valido(p_tipo text, p_alvo text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_tipo
    when 'tudo' then p_alvo is null
    when 'site' then p_alvo is null
    when 'partida' then coalesce(p_alvo ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
    when 'elo' then coalesce(p_alvo ~ '^[^#[:cntrl:]]{1,16}#[^#[:cntrl:]]{1,5}$', false)
    when 'card' then coalesce(p_alvo ~ '^[^#[:cntrl:]]{1,16}#[^#[:cntrl:]]{1,5}$', false)
    else false end
$$;

create or replace function public.sync_pedido_json(s public.sync_pedidos) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'tipo', s.tipo, 'alvo', s.alvo, 'status', s.status, 'resultado', s.resultado,
    'criado_em', s.criado_em, 'iniciado_em', s.iniciado_em, 'concluido_em', s.concluido_em,
    'criado_por', (select apelido from public.perfis where id = s.criado_por))
$$;

-- ---------- Para a administradora (site) ----------
create or replace function public.admin_sync_painel(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_eq uuid;
begin
  if not public.eh_admin() then raise exception 'Somente a administradora vê o Sync.' using errcode = '42501'; end if;
  v_eq := public.sync_equipe(p_slug);
  if v_eq is null then raise exception 'sync_equipe: equipe não encontrada.' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'equipe', (select jsonb_build_object('slug', slug, 'nome', nome) from public.equipes where id = v_eq),
    'estado', (select estado from public.sync_estado where equipe_id = v_eq),
    'versao', (select versao from public.sync_estado where equipe_id = v_eq),
    'pc_visto_em', (select pc_visto_em from public.sync_estado where equipe_id = v_eq),
    'envio_em', (select max(atualizado_em) from public.dados_equipe where equipe_id = v_eq),
    'arquivos', (select count(*) from public.dados_equipe where equipe_id = v_eq),
    'agora', now(),
    'pedidos', coalesce((select jsonb_agg(public.sync_pedido_json(s) order by s.criado_em desc)
                         from (select * from public.sync_pedidos where equipe_id = v_eq order by criado_em desc limit 40) s), '[]'::jsonb));
end $$;

create or replace function public.admin_sync_pedir(p_slug text, p_tipo text, p_alvo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_eq uuid; v_alvo text := nullif(btrim(coalesce(p_alvo, '')), ''); s public.sync_pedidos;
begin
  if not public.eh_admin() then raise exception 'Somente a administradora pede sincronização.' using errcode = '42501'; end if;
  v_eq := public.sync_equipe(p_slug);
  if v_eq is null then raise exception 'sync_equipe: equipe não encontrada.' using errcode = 'P0001'; end if;
  if p_tipo = 'partida' then v_alvo := lower(v_alvo); end if;
  if not public.sync_alvo_valido(p_tipo, v_alvo) then
    raise exception 'sync_invalido: pedido inválido (confira o tipo e o alvo).' using errcode = 'P0001';
  end if;
  -- Já tem um igual na fila: devolve o mesmo
  select * into s from public.sync_pedidos
   where equipe_id = v_eq and tipo = p_tipo and coalesce(alvo, '') = coalesce(v_alvo, '') and status in ('pendente', 'fazendo');
  if s.id is not null then return public.sync_pedido_json(s) || jsonb_build_object('ja_existia', true); end if;
  if (select count(*) from public.sync_pedidos where equipe_id = v_eq and status in ('pendente', 'fazendo')) >= 40 then
    raise exception 'sync_fila: já há 40 pedidos na fila. Espere o PC atender alguns.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.sync_pedidos where criado_por = auth.uid() and criado_em > now() - interval '1 hour') >= 80 then
    raise exception 'sync_cedo: muitos pedidos na última hora. Espere um pouco.' using errcode = 'P0001';
  end if;
  insert into public.sync_pedidos (equipe_id, tipo, alvo, criado_por) values (v_eq, p_tipo, v_alvo, auth.uid()) returning * into s;
  -- Guarda só os 200 pedidos mais recentes de cada equipe
  delete from public.sync_pedidos where equipe_id = v_eq and status not in ('pendente', 'fazendo')
     and id not in (select id from public.sync_pedidos where equipe_id = v_eq order by criado_em desc limit 200);
  return public.sync_pedido_json(s);
end $$;

create or replace function public.admin_sync_cancelar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.sync_pedidos;
begin
  if not public.eh_admin() then raise exception 'Somente a administradora cancela pedidos.' using errcode = '42501'; end if;
  update public.sync_pedidos set status = 'cancelado', concluido_em = now(), resultado = 'Cancelado no site.'
   where id = p_id and status = 'pendente' returning * into s;
  if s.id is null then raise exception 'sync_pedido: só dá para cancelar pedidos que ainda esperam o PC.' using errcode = 'P0001'; end if;
  return public.sync_pedido_json(s);
end $$;

-- ---------- Para o PC (chave secreta) ----------
-- Pega os pedidos da fila (no máximo p_limite) e marca como "fazendo". O que ficou "fazendo" por mais de
-- 45 minutos (o PC desligou no meio) volta para a fila.
create or replace function public.pc_sync_pegar(p_slug text, p_limite int default 10) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_eq uuid := public.sync_equipe(p_slug); v jsonb;
begin
  if v_eq is null then return '[]'::jsonb; end if;
  update public.sync_pedidos set status = 'pendente', iniciado_em = null
   where equipe_id = v_eq and status = 'fazendo' and iniciado_em < now() - interval '45 minutes';
  with escolhidos as (
    select id from public.sync_pedidos where equipe_id = v_eq and status = 'pendente'
     order by (tipo = 'tudo'), criado_em limit greatest(1, least(coalesce(p_limite, 10), 20)) for update skip locked),
  marcados as (
    update public.sync_pedidos s set status = 'fazendo', iniciado_em = now()
      from escolhidos e where s.id = e.id returning s.*)
  select coalesce(jsonb_agg(public.sync_pedido_json(m) order by m.criado_em), '[]'::jsonb) into v from marcados m;
  return v;
end $$;

-- Conclui um pedido: feito, erro, ou "pendente" (fez uma parte; o resto fica para a próxima coleta)
create or replace function public.pc_sync_concluir(p_id uuid, p_status text, p_resultado text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('feito', 'erro', 'pendente') then raise exception 'sync_status: status inválido.' using errcode = 'P0001'; end if;
  update public.sync_pedidos
     set status = p_status, resultado = left(nullif(btrim(coalesce(p_resultado, '')), ''), 1000),
         concluido_em = case when p_status = 'pendente' then null else now() end,
         iniciado_em = case when p_status = 'pendente' then null else iniciado_em end
   where id = p_id and status = 'fazendo';
end $$;

-- O estado que o PC viu (até 300 KB) e o "sinal de vida" dele
create or replace function public.pc_sync_estado(p_slug text, p_estado jsonb, p_versao text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_eq uuid := public.sync_equipe(p_slug);
begin
  if v_eq is null then raise exception 'sync_equipe: equipe não encontrada.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_estado) is distinct from 'object' or octet_length(p_estado::text) > 300000 then
    raise exception 'sync_estado: o estado precisa ser um objeto de até 300 KB.' using errcode = 'P0001';
  end if;
  insert into public.sync_estado (equipe_id, estado, versao, pc_visto_em) values (v_eq, p_estado, left(p_versao, 40), now())
  on conflict (equipe_id) do update set estado = excluded.estado, versao = excluded.versao, pc_visto_em = now();
end $$;

-- ---------- Permissões das funções ----------
revoke execute on function public.sync_equipe(text), public.sync_alvo_valido(text, text), public.sync_pedido_json(public.sync_pedidos),
  public.admin_sync_painel(text), public.admin_sync_pedir(text, text, text), public.admin_sync_cancelar(uuid),
  public.pc_sync_pegar(text, int), public.pc_sync_concluir(uuid, text, text), public.pc_sync_estado(text, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.admin_sync_painel(text), public.admin_sync_pedir(text, text, text), public.admin_sync_cancelar(uuid)
  to authenticated;
grant execute on function public.pc_sync_pegar(text, int), public.pc_sync_concluir(uuid, text, text), public.pc_sync_estado(text, jsonb, text)
  to service_role;

-- Conferência: deve mostrar "sync_pedidos" e 0 linhas no começo
select 'sync_pedidos' as tabela, count(*) as linhas from public.sync_pedidos;
