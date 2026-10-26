-- =============================================================================
-- ValReport 2.0 · Etapa 3a — equipes, cargos, vagas, convites e aprovações
-- Rode DEPOIS do etapa1.sql e do etapa2.sql: SQL Editor → New query → cole tudo → Run.
-- Pode rodar de novo sem estragar nada. (Se rodar uma etapa anterior de novo, rode as seguintes depois.)
-- =============================================================================

-- Confere se a etapa 2 (versão com o pedido de verificação) já rodou
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'perfis' and column_name = 'riot_id_pedido') then
    raise exception 'Rode primeiro o supabase/etapa2.sql (a versão nova) e depois este arquivo de novo.';
  end if;
end $$;

-- ---------- Equipes: campos novos ----------
alter table public.equipes
  add column if not exists criado_por uuid references auth.users (id) on delete set null,
  add column if not exists imagem_card text,              -- card do jogo usado como imagem da equipe
  add column if not exists imagem_url text,               -- imagem enviada (etapa 3b)
  add column if not exists premier_id text,               -- equipe Premier (etapa 3b)
  add column if not exists motivo_recusa text,
  add column if not exists revisado_em timestamptz;
create unique index if not exists equipes_premier_unica on public.equipes (premier_id) where premier_id is not null;

do $$ begin
  alter table public.equipes add constraint equipes_imagem_card_ok check (imagem_card is null or imagem_card ~ '^[0-9a-f-]{36}$');
exception when duplicate_object then null; end $$;

-- A Juventus nasceu antes desta etapa: a criadora é a administradora
update public.equipes set criado_por = (select usuario_id from public.administradores limit 1)
where slug = 'juventus-academy' and criado_por is null;

-- ---------- Convites (links) ----------
create table if not exists public.convites (
  codigo text primary key check (codigo ~ '^[a-z0-9]{16,40}$'),
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz,                                  -- vazio = não vence
  usos_max int check (usos_max is null or usos_max between 1 and 100),   -- vazio = ilimitado
  usos int not null default 0,
  revogado_em timestamptz
);
alter table public.convites enable row level security;
revoke all on public.convites from anon, public, authenticated;

-- ---------- Regras das vagas e dos cargos ----------
-- 1 líder por equipe
create unique index if not exists membros_um_lider on public.membros (equipe_id) where cargo = 'lider';

-- Uma equipe própria e uma Premier por pessoa; 7 jogadores (líder e co-líderes jogam) + 8 extras;
-- até 2 co-líderes e até 2 treinadores. A administradora não tem o limite de equipes (para testar e cuidar delas).
create or replace function public.validar_membro() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_tipo text; n int;
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
    select count(*) into n from public.membros
     where equipe_id = new.equipe_id and usuario_id <> new.usuario_id and cargo in ('lider', 'colider', 'jogador');
    if n >= 7 then raise exception 'vagas_jogadores: as 7 vagas de jogador estão ocupadas.' using errcode = 'P0001'; end if;
  else
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
drop trigger if exists validar_membro on public.membros;
create trigger validar_membro before insert or update of cargo on public.membros
  for each row execute function public.validar_membro();
revoke execute on function public.validar_membro() from public, anon, authenticated;

-- Se a liderança sair da equipe por qualquer caminho (conta apagada, removida pela administradora),
-- a liderança passa sozinha para a próxima pessoa: co-líder, depois jogador, treinador e convidado (quem entrou antes).
-- Equipe que ficou sem ninguém e sem partidas guardadas é encerrada.
create or replace function public.sucessao_lideranca() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_novo uuid;
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
  select usuario_id into v_novo from public.membros where equipe_id = old.equipe_id
   order by array_position(array['colider', 'jogador', 'treinador', 'convidado']::text[], cargo::text), entrou_em limit 1;
  begin
    update public.membros set cargo = 'lider' where equipe_id = old.equipe_id and usuario_id = v_novo;
  exception when others then null;   -- sem vaga: a administradora resolve pelo painel
  end;
  return null;
end $$;
drop trigger if exists sucessao_lideranca on public.membros;
create trigger sucessao_lideranca after delete on public.membros
  for each row execute function public.sucessao_lideranca();
revoke execute on function public.sucessao_lideranca(), public.validar_perfil() from public, anon, authenticated;

-- ---------- Funções de apoio ----------
create or replace function public.e_lideranca(p_equipe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.eh_admin() or coalesce(public.cargo_em(p_equipe) in ('lider', 'colider'), false)
$$;

create or replace function public.slug_livre(p_nome text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_base text; v_slug text; i int := 1;
begin
  v_base := translate(lower(p_nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
  v_base := btrim(regexp_replace(v_base, '[^a-z0-9]+', '-', 'g'), '-');
  v_base := left(v_base, 32);
  if char_length(v_base) < 3 then v_base := 'equipe-' || coalesce(nullif(v_base, ''), 'nova'); end if;
  v_slug := v_base;
  while exists (select 1 from public.equipes where slug = v_slug) loop
    i := i + 1;
    v_slug := v_base || '-' || i;
  end loop;
  return v_slug;
end $$;

create or replace function public.validar_nome_equipe(p_nome text) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := regexp_replace(btrim(coalesce(p_nome, '')), '\s+', ' ', 'g');
begin
  if char_length(v) not between 2 and 40 or v ~ '[<>{}\\[:cntrl:]]' then
    raise exception 'nome: o nome da equipe precisa ter de 2 a 40 caracteres, sem < > { }.' using errcode = 'P0001';
  end if;
  return v;
end $$;

-- ---------- Criar e cuidar da equipe ----------
create or replace function public.criar_equipe(p_nome text, p_visibilidade text default 'privada', p_imagem_card text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_nome text; v_id uuid; v_slug text; v_status text;
begin
  if auth.uid() is null then raise exception 'Faça login primeiro.' using errcode = '42501'; end if;
  if not exists (select 1 from public.perfis where id = auth.uid()) then
    raise exception 'Complete o cadastro primeiro.' using errcode = 'P0001';
  end if;
  v_nome := public.validar_nome_equipe(p_nome);
  if coalesce(p_visibilidade, '') not in ('publica', 'privada') then p_visibilidade := 'privada'; end if;
  if (select count(*) from public.equipes where criado_por = auth.uid() and status = 'pendente') >= 1 then
    raise exception 'pendente: você já tem uma equipe esperando aprovação.' using errcode = 'P0001';
  end if;
  v_slug := public.slug_livre(v_nome);
  v_status := case when public.eh_admin() then 'aprovada' else 'pendente' end;
  insert into public.equipes (slug, nome, tipo, status, visibilidade, criado_por, imagem_card, revisado_em)
  values (v_slug, v_nome, 'propria', v_status, p_visibilidade, auth.uid(), nullif(p_imagem_card, ''),
          case when v_status = 'aprovada' then now() end)
  returning id into v_id;
  insert into public.membros (equipe_id, usuario_id, cargo, riot_id)
  values (v_id, auth.uid(), 'lider', (select riot_id from public.perfis where id = auth.uid() and riot_verificado_em is not null));
  return jsonb_build_object('id', v_id, 'slug', v_slug, 'status', v_status);
end $$;

create or replace function public.editar_equipe(p_equipe uuid, p_nome text, p_visibilidade text, p_imagem_card text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.eh_admin() or public.cargo_em(p_equipe) = 'lider') then
    raise exception 'Somente a liderança da equipe.' using errcode = '42501';
  end if;
  if coalesce(p_visibilidade, '') not in ('publica', 'privada') then
    raise exception 'Visibilidade inválida.' using errcode = 'P0001';
  end if;
  update public.equipes set nome = public.validar_nome_equipe(p_nome), visibilidade = p_visibilidade,
         imagem_card = nullif(p_imagem_card, '')
   where id = p_equipe;
end $$;

-- Minhas equipes (inclusive as que esperam aprovação)
create or replace function public.minhas_equipes() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'slug', e.slug, 'nome', e.nome, 'tipo', e.tipo, 'status', e.status, 'visibilidade', e.visibilidade,
           'imagem_card', e.imagem_card, 'imagem_url', e.imagem_url, 'motivo_recusa', e.motivo_recusa, 'cargo', m.cargo,
           'membros', (select count(*) from public.membros x where x.equipe_id = e.id)) order by m.entrou_em), '[]'::jsonb)
  from public.membros m join public.equipes e on e.id = m.equipe_id
  where m.usuario_id = auth.uid()
$$;

-- Página da equipe: quem é membro (ou a administradora) vê tudo; equipe pública e aprovada é vista por qualquer logado,
-- sem os pedidos de verificação e sem quem está no modo protegido (16–17).
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
               'eu', m.usuario_id = auth.uid())
             order by array_position(array['lider', 'colider', 'treinador', 'jogador', 'convidado']::text[], m.cargo::text), m.entrou_em)
      from public.membros m join public.perfis p on p.id = m.usuario_id
      where m.equipe_id = e.id and (v_membro or not public.eh_protegido(m.usuario_id))), '[]'::jsonb));
end $$;

create or replace function public.definir_cargo(p_equipe uuid, p_usuario uuid, p_cargo public.cargo)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (public.eh_admin() or public.cargo_em(p_equipe) = 'lider') then
    raise exception 'Somente a líder ou o líder da equipe define cargos.' using errcode = '42501';
  end if;
  if p_cargo = 'lider' then raise exception 'Para trocar a liderança, use "Passar a liderança".' using errcode = 'P0001'; end if;
  if (select cargo from public.membros where equipe_id = p_equipe and usuario_id = p_usuario) = 'lider' then
    raise exception 'Para mudar o cargo da liderança, passe a liderança antes.' using errcode = 'P0001';
  end if;
  update public.membros set cargo = p_cargo where equipe_id = p_equipe and usuario_id = p_usuario;
  if not found then raise exception 'Essa pessoa não está na equipe.' using errcode = 'P0001'; end if;
end $$;

create or replace function public.passar_lideranca(p_equipe uuid, p_usuario uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_antigo uuid; v_cargo_novo public.cargo;
begin
  if not (public.eh_admin() or public.cargo_em(p_equipe) = 'lider') then
    raise exception 'Somente a líder ou o líder passa a liderança.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.membros where equipe_id = p_equipe and usuario_id = p_usuario) then
    raise exception 'Essa pessoa não está na equipe.' using errcode = 'P0001';
  end if;
  select usuario_id into v_antigo from public.membros where equipe_id = p_equipe and cargo = 'lider';
  if v_antigo = p_usuario then return; end if;
  if v_antigo is not null then update public.membros set cargo = 'jogador' where equipe_id = p_equipe and usuario_id = v_antigo; end if;
  update public.membros set cargo = 'lider' where equipe_id = p_equipe and usuario_id = p_usuario;
  -- quem era líder vira co-líder (se houver vaga de co-líder)
  if v_antigo is not null and (select count(*) from public.membros where equipe_id = p_equipe and cargo = 'colider') < 2 then
    update public.membros set cargo = 'colider' where equipe_id = p_equipe and usuario_id = v_antigo;
  end if;
end $$;

create or replace function public.expulsar_membro(p_equipe uuid, p_usuario uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_meu public.cargo := public.cargo_em(p_equipe); v_dele public.cargo;
begin
  select cargo into v_dele from public.membros where equipe_id = p_equipe and usuario_id = p_usuario;
  if v_dele is null then raise exception 'Essa pessoa não está na equipe.' using errcode = 'P0001'; end if;
  if p_usuario = auth.uid() then raise exception 'Para sair, use "Sair da equipe".' using errcode = 'P0001'; end if;
  if v_dele = 'lider' then raise exception 'A liderança não pode ser expulsa. Passe a liderança antes.' using errcode = 'P0001'; end if;
  if not (public.eh_admin() or v_meu = 'lider' or (v_meu = 'colider' and v_dele in ('jogador', 'treinador', 'convidado'))) then
    raise exception 'Você não pode remover essa pessoa.' using errcode = '42501';
  end if;
  delete from public.membros where equipe_id = p_equipe and usuario_id = p_usuario;
end $$;

create or replace function public.sair_da_equipe(p_equipe uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_meu public.cargo := public.cargo_em(p_equipe); n int;
begin
  if v_meu is null then raise exception 'Você não está nessa equipe.' using errcode = 'P0001'; end if;
  select count(*) into n from public.membros where equipe_id = p_equipe;
  if v_meu = 'lider' and n > 1 then
    raise exception 'Passe a liderança para outra pessoa antes de sair.' using errcode = 'P0001';
  end if;
  if n = 1 then
    if exists (select 1 from public.dados_equipe where equipe_id = p_equipe) then
      raise exception 'Esta equipe tem partidas guardadas. Fale com a administradora para encerrá-la.' using errcode = 'P0001';
    end if;
    delete from public.equipes where id = p_equipe;   -- última pessoa: a equipe é encerrada
    return 'encerrada';
  end if;
  delete from public.membros where equipe_id = p_equipe and usuario_id = auth.uid();
  return 'saiu';
end $$;

-- ---------- Convites ----------
create or replace function public.criar_convite(p_equipe uuid, p_horas int default null, p_usos int default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_codigo text;
begin
  if not public.e_lideranca(p_equipe) then raise exception 'Somente a liderança cria convites.' using errcode = '42501'; end if;
  if (select status from public.equipes where id = p_equipe) <> 'aprovada' then
    raise exception 'A equipe precisa ser aprovada antes de convidar pessoas.' using errcode = 'P0001';
  end if;
  if p_horas is not null and p_horas not between 1 and 24 * 90 then raise exception 'Validade inválida.' using errcode = 'P0001'; end if;
  if p_usos is not null and p_usos not between 1 and 100 then raise exception 'Número de usos inválido.' using errcode = 'P0001'; end if;
  if (select count(*) from public.convites where equipe_id = p_equipe and revogado_em is null
        and (expira_em is null or expira_em > now()) and (usos_max is null or usos < usos_max)) >= 10 then
    raise exception 'A equipe já tem 10 convites ativos. Revogue algum antes.' using errcode = 'P0001';
  end if;
  v_codigo := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  insert into public.convites (codigo, equipe_id, criado_por, expira_em, usos_max)
  values (v_codigo, p_equipe, auth.uid(), case when p_horas is not null then now() + make_interval(hours => p_horas) end, p_usos);
  return v_codigo;
end $$;

create or replace function public.listar_convites(p_equipe uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.e_lideranca(p_equipe) then raise exception 'Somente a liderança vê os convites.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'codigo', c.codigo, 'criado_em', c.criado_em, 'expira_em', c.expira_em, 'usos_max', c.usos_max, 'usos', c.usos,
      'criado_por', (select apelido from public.perfis where id = c.criado_por),
      'ativo', c.revogado_em is null and (c.expira_em is null or c.expira_em > now()) and (c.usos_max is null or c.usos < c.usos_max))
      order by c.criado_em desc)
    from public.convites c where c.equipe_id = p_equipe and c.revogado_em is null), '[]'::jsonb);
end $$;

create or replace function public.revogar_convite(p_codigo text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_equipe uuid;
begin
  select equipe_id into v_equipe from public.convites where codigo = p_codigo;
  if v_equipe is null or not public.e_lideranca(v_equipe) then raise exception 'Convite não encontrado.' using errcode = 'P0001'; end if;
  update public.convites set revogado_em = now() where codigo = p_codigo;
end $$;

-- O que o convite mostra antes de aceitar
create or replace function public.ver_convite(p_codigo text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.convites; e public.equipes; v_motivo text;
begin
  if auth.uid() is null then raise exception 'Faça login primeiro.' using errcode = '42501'; end if;
  select * into c from public.convites where codigo = lower(btrim(p_codigo));
  if c.codigo is null then return jsonb_build_object('valido', false, 'motivo', 'Este convite não existe. Confira o link.'); end if;
  select * into e from public.equipes where id = c.equipe_id;
  v_motivo := case
    when c.revogado_em is not null then 'Este convite foi cancelado pela equipe.'
    when c.expira_em is not null and c.expira_em <= now() then 'Este convite venceu. Peça um novo para a equipe.'
    when c.usos_max is not null and c.usos >= c.usos_max then 'Este convite já foi usado o máximo de vezes.'
    when e.status <> 'aprovada' then 'Esta equipe ainda não está liberada.'
  end;
  return jsonb_build_object('valido', v_motivo is null, 'motivo', v_motivo, 'ja_membro', public.eh_membro(e.id),
    'equipe', jsonb_build_object('nome', e.nome, 'slug', e.slug, 'tipo', e.tipo, 'imagem_card', e.imagem_card, 'imagem_url', e.imagem_url,
                                 'membros', (select count(*) from public.membros where equipe_id = e.id)),
    'expira_em', c.expira_em);
end $$;

create or replace function public.entrar_por_convite(p_codigo text) returns text
language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_equipe uuid;
begin
  if not exists (select 1 from public.perfis where id = auth.uid()) then
    raise exception 'Complete o cadastro primeiro.' using errcode = 'P0001';
  end if;
  v := public.ver_convite(p_codigo);
  if not (v ->> 'valido')::boolean then raise exception 'convite: %', v ->> 'motivo' using errcode = 'P0001'; end if;
  select equipe_id into v_equipe from public.convites where codigo = lower(btrim(p_codigo)) for update;
  if (v ->> 'ja_membro')::boolean then return v -> 'equipe' ->> 'slug'; end if;
  insert into public.membros (equipe_id, usuario_id, cargo, riot_id)
  values (v_equipe, auth.uid(), 'convidado', (select riot_id from public.perfis where id = auth.uid() and riot_verificado_em is not null));
  update public.convites set usos = usos + 1 where codigo = lower(btrim(p_codigo));
  return v -> 'equipe' ->> 'slug';
end $$;

-- ---------- Administradora: aprovações e avisos ----------
create or replace function public.admin_equipes_pendentes() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.eh_admin() then raise exception 'Somente a administradora.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'slug', e.slug, 'nome', e.nome, 'tipo', e.tipo, 'visibilidade', e.visibilidade, 'imagem_card', e.imagem_card,
      'imagem_url', e.imagem_url, 'criado_em', e.criado_em,
      'criadora', (select jsonb_build_object('apelido', p.apelido, 'email', u.email, 'riot_id', p.riot_id)
                   from auth.users u left join public.perfis p on p.id = u.id where u.id = e.criado_por))
      order by e.criado_em)
    from public.equipes e where e.status = 'pendente'), '[]'::jsonb);
end $$;

create or replace function public.admin_revisar_equipe(p_equipe uuid, p_aprovar boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.eh_admin() then raise exception 'Somente a administradora.' using errcode = '42501'; end if;
  update public.equipes set status = case when p_aprovar then 'aprovada' else 'recusada' end,
         motivo_recusa = case when p_aprovar then null else nullif(left(btrim(coalesce(p_motivo, '')), 200), '') end,
         revisado_em = now()
   where id = p_equipe and status = 'pendente';
  if not found then raise exception 'Essa equipe não está esperando aprovação.' using errcode = 'P0001'; end if;
end $$;

-- Números para os avisos (selo no botão do perfil): equipes esperando aprovação (admin)
-- e pedidos de verificação do Riot ID nas equipes que a pessoa lidera.
create or replace function public.minhas_pendencias() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'equipes_pendentes', case when public.eh_admin() then (select count(*) from public.equipes where status = 'pendente') else 0 end,
    'pedidos_riot', (select count(distinct p.id) from public.perfis p
                     where p.riot_id_pedido is not null
                       and (public.eh_admin() or exists (
                             select 1 from public.membros alvo join public.membros eu on eu.equipe_id = alvo.equipe_id
                             join public.equipes e on e.id = alvo.equipe_id
                             where alvo.usuario_id = p.id and eu.usuario_id = auth.uid()
                               and eu.cargo in ('lider', 'colider') and e.status = 'aprovada'))))
$$;

-- ---------- Permissões das funções ----------
revoke execute on function public.e_lideranca(uuid), public.slug_livre(text), public.validar_nome_equipe(text),
  public.criar_equipe(text, text, text), public.editar_equipe(uuid, text, text, text), public.minhas_equipes(),
  public.equipe_detalhes(text), public.definir_cargo(uuid, uuid, public.cargo), public.passar_lideranca(uuid, uuid),
  public.expulsar_membro(uuid, uuid), public.sair_da_equipe(uuid), public.criar_convite(uuid, int, int),
  public.listar_convites(uuid), public.revogar_convite(text), public.ver_convite(text), public.entrar_por_convite(text),
  public.admin_equipes_pendentes(), public.admin_revisar_equipe(uuid, boolean, text), public.minhas_pendencias()
  from public, anon;
grant execute on function public.e_lideranca(uuid),
  public.criar_equipe(text, text, text), public.editar_equipe(uuid, text, text, text), public.minhas_equipes(),
  public.equipe_detalhes(text), public.definir_cargo(uuid, uuid, public.cargo), public.passar_lideranca(uuid, uuid),
  public.expulsar_membro(uuid, uuid), public.sair_da_equipe(uuid), public.criar_convite(uuid, int, int),
  public.listar_convites(uuid), public.revogar_convite(text), public.ver_convite(text), public.entrar_por_convite(text),
  public.admin_equipes_pendentes(), public.admin_revisar_equipe(uuid, boolean, text), public.minhas_pendencias()
  to authenticated;
revoke execute on function public.slug_livre(text), public.validar_nome_equipe(text) from authenticated;

-- Conferência: deve mostrar 1 linha com a Juventus aprovada
select slug, status, (criado_por is not null) as tem_criadora from public.equipes where slug = 'juventus-academy';
