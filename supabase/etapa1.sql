-- =============================================================================
-- ValReport 2.0 · Etapa 1 — contas, idade, equipe e acesso às partidas
-- Rode UMA vez no Supabase: SQL Editor → New query → cole tudo → Run.
-- Pode rodar de novo sem estragar nada (ele confere o que já existe).
-- =============================================================================

-- ---------- Tipos ----------
do $$ begin
  create type public.cargo as enum ('lider', 'colider', 'treinador', 'jogador', 'convidado');
exception when duplicate_object then null; end $$;

-- ---------- Tabelas ----------
create table if not exists public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  apelido text not null,
  nascimento_ano smallint not null,
  nascimento_mes smallint not null check (nascimento_mes between 1 and 12),
  responsavel_email text,                      -- obrigatório só para 16 e 17 anos
  versao_termos text not null,                 -- versão dos Termos/Privacidade aceita
  aceitou_termos_em timestamptz not null default now(),
  exclusao_solicitada_em timestamptz,          -- quando a exclusão automática não for possível
  criado_em timestamptz not null default now()
);

create table if not exists public.administradores (
  usuario_id uuid primary key references auth.users (id) on delete cascade
);

create table if not exists public.equipes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  nome text not null check (char_length(nome) between 2 and 40),
  tipo text not null default 'propria' check (tipo in ('propria', 'premier')),
  status text not null default 'aprovada' check (status in ('pendente', 'aprovada', 'recusada')),
  visibilidade text not null default 'privada' check (visibilidade in ('publica', 'privada')),
  criado_em timestamptz not null default now()
);

create table if not exists public.membros (
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  usuario_id uuid not null references auth.users (id) on delete cascade,
  cargo public.cargo not null default 'jogador',
  riot_id text,                                -- confirmado pela administradora/líder
  entrou_em timestamptz not null default now(),
  primary key (equipe_id, usuario_id)
);

-- Os arquivos que o site lia de docs/data/ agora moram aqui, um por linha, por equipe.
-- Só a coleta do seu PC (com a chave secreta) escreve; o site só lê, e só o que a regra permite.
create table if not exists public.dados_equipe (
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  caminho text not null check (caminho ~ '^[a-z0-9_.-]+(/[a-z0-9_.-]+)*\.json$'),
  conteudo jsonb not null,
  atualizado_em timestamptz not null default now(),
  primary key (equipe_id, caminho)
);

-- ---------- Funções de apoio (rodam com permissão do dono, mas só olham o usuário logado) ----------
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.administradores a where a.usuario_id = auth.uid())
$$;

create or replace function public.cargo_em(p_equipe uuid) returns public.cargo
language sql stable security definer set search_path = '' as $$
  select m.cargo from public.membros m where m.equipe_id = p_equipe and m.usuario_id = auth.uid()
$$;

create or replace function public.eh_membro(p_equipe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.equipe_id = p_equipe and m.usuario_id = auth.uid())
$$;

-- Idade em anos considerando o ÚLTIMO dia do mês de nascimento (nunca deixa passar quem ainda não fez 16).
create or replace function public.idade(p_ano int, p_mes int) returns int
language sql stable set search_path = '' as $$
  select extract(year from age(current_date, (make_date(p_ano, p_mes, 1) + interval '1 month - 1 day')::date))::int
$$;

create or replace function public.eh_protegido(p_usuario uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select public.idade(p.nascimento_ano, p.nascimento_mes) < 18 from public.perfis p where p.id = p_usuario), false)
$$;

-- ---------- Validação do perfil (idade mínima 16, responsável para 16–17, nascimento fixo) ----------
create or replace function public.validar_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_idade int;
begin
  new.apelido := btrim(new.apelido);
  if char_length(new.apelido) not between 2 and 24 then
    raise exception 'O apelido precisa ter de 2 a 24 caracteres.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and (new.nascimento_ano, new.nascimento_mes) is distinct from (old.nascimento_ano, old.nascimento_mes)
     and not public.eh_admin() then
    raise exception 'A data de nascimento não pode ser alterada. Fale com a administradora.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.id is distinct from old.id then
    raise exception 'Operação não permitida.' using errcode = 'P0001';
  end if;
  if new.nascimento_ano < 1900 or new.nascimento_ano > extract(year from current_date) then
    raise exception 'Ano de nascimento inválido.' using errcode = 'P0001';
  end if;
  v_idade := public.idade(new.nascimento_ano, new.nascimento_mes);
  if v_idade < 16 then
    raise exception 'idade_minima: é preciso ter 16 anos ou mais para usar o ValReport.' using errcode = 'P0001';
  end if;
  if v_idade < 18 then
    if new.responsavel_email is null or new.responsavel_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'responsavel: para 16 e 17 anos, informe o e-mail de um responsável.' using errcode = 'P0001';
    end if;
  else
    new.responsavel_email := null;   -- maiores de 18 não guardam e-mail de responsável
  end if;
  if tg_op = 'INSERT' then
    new.aceitou_termos_em := now();
    new.exclusao_solicitada_em := null;
  end if;
  return new;
end $$;

drop trigger if exists validar_perfil on public.perfis;
create trigger validar_perfil before insert or update on public.perfis
  for each row execute function public.validar_perfil();

-- ---------- Regras de acesso (RLS) ----------
alter table public.perfis enable row level security;
alter table public.administradores enable row level security;
alter table public.equipes enable row level security;
alter table public.membros enable row level security;
alter table public.dados_equipe enable row level security;

drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated
  using (id = auth.uid() or public.eh_admin()
         or exists (select 1 from public.membros a join public.membros b on a.equipe_id = b.equipe_id
                    where a.usuario_id = auth.uid() and b.usuario_id = perfis.id));
drop policy if exists perfis_criar on public.perfis;
create policy perfis_criar on public.perfis for insert to authenticated with check (id = auth.uid());
drop policy if exists perfis_editar on public.perfis;
create policy perfis_editar on public.perfis for update to authenticated
  using (id = auth.uid() or public.eh_admin()) with check (id = auth.uid() or public.eh_admin());

drop policy if exists admin_ler on public.administradores;
create policy admin_ler on public.administradores for select to authenticated using (usuario_id = auth.uid());

drop policy if exists equipes_ler on public.equipes;
create policy equipes_ler on public.equipes for select to authenticated
  using (public.eh_membro(id) or public.eh_admin());

drop policy if exists membros_ler on public.membros;
create policy membros_ler on public.membros for select to authenticated
  using (public.eh_membro(equipe_id) or public.eh_admin());

-- Partidas e análises: só membros da equipe. As notas da IGL (estratégias) não aparecem para convidados.
drop policy if exists dados_ler on public.dados_equipe;
create policy dados_ler on public.dados_equipe for select to authenticated
  using (public.eh_admin()
         or (public.eh_membro(equipe_id)
             and (caminho <> 'notas.json' or public.cargo_em(equipe_id) <> 'convidado')));

-- Ninguém de fora do login lê nada; quem está logado só faz o que as regras acima permitem.
revoke all on public.perfis, public.administradores, public.equipes, public.membros, public.dados_equipe from anon, public;
revoke all on public.perfis, public.administradores, public.equipes, public.membros, public.dados_equipe from authenticated;
-- Colegas de equipe veem só o apelido; nascimento e e-mail do responsável não saem pela API
-- (a própria pessoa vê os dela pela função minha_conta, sem o e-mail do responsável).
grant select (id, apelido, criado_em) on public.perfis to authenticated;
grant insert (id, apelido, nascimento_ano, nascimento_mes, responsavel_email, versao_termos) on public.perfis to authenticated;
grant update (apelido) on public.perfis to authenticated;
grant select on public.administradores, public.equipes, public.membros, public.dados_equipe to authenticated;

-- ---------- Funções que o site chama ----------
-- Tudo o que o site precisa saber de quem está logado, numa chamada só.
create or replace function public.minha_conta() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'perfil', (select to_jsonb(p) - 'responsavel_email' from public.perfis p where p.id = auth.uid()),
    'protegido', public.eh_protegido(auth.uid()),
    'admin', public.eh_admin(),
    'equipes', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'slug', e.slug, 'nome', e.nome, 'tipo', e.tipo,
                                                              'cargo', m.cargo, 'riot_id', m.riot_id) order by m.entrou_em)
                         from public.membros m join public.equipes e on e.id = m.equipe_id
                         where m.usuario_id = auth.uid() and e.status = 'aprovada'), '[]'::jsonb))
$$;

-- Painel da administradora: lista quem já criou conta (com o e-mail, que só ela vê).
create or replace function public.admin_listar_usuarios() returns table (
  id uuid, email text, apelido text, idade_faixa text, criado_em timestamptz, exclusao_solicitada_em timestamptz, equipes jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.eh_admin() then raise exception 'Somente a administradora.' using errcode = '42501'; end if;
  return query
    select u.id, u.email::text, p.apelido,
           case when p.id is null then 'sem cadastro'
                when public.idade(p.nascimento_ano, p.nascimento_mes) < 18 then '16-17' else '18+' end,
           u.created_at, p.exclusao_solicitada_em,
           coalesce((select jsonb_agg(jsonb_build_object('slug', e.slug, 'nome', e.nome, 'cargo', m.cargo, 'riot_id', m.riot_id))
                     from public.membros m join public.equipes e on e.id = m.equipe_id where m.usuario_id = u.id), '[]'::jsonb)
    from auth.users u left join public.perfis p on p.id = u.id
    order by u.created_at;
end $$;

create or replace function public.admin_definir_membro(p_usuario uuid, p_equipe text, p_cargo public.cargo, p_riot_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_equipe uuid;
begin
  if not public.eh_admin() then raise exception 'Somente a administradora.' using errcode = '42501'; end if;
  select id into v_equipe from public.equipes where slug = p_equipe;
  if v_equipe is null then raise exception 'Equipe não encontrada.' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.perfis where id = p_usuario) then
    raise exception 'Essa pessoa ainda não terminou o cadastro.' using errcode = 'P0001';
  end if;
  insert into public.membros (equipe_id, usuario_id, cargo, riot_id)
  values (v_equipe, p_usuario, p_cargo, nullif(btrim(p_riot_id), ''))
  on conflict (equipe_id, usuario_id) do update set cargo = excluded.cargo, riot_id = excluded.riot_id;
end $$;

create or replace function public.admin_remover_membro(p_usuario uuid, p_equipe text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.eh_admin() then raise exception 'Somente a administradora.' using errcode = '42501'; end if;
  delete from public.membros m using public.equipes e
   where m.equipe_id = e.id and e.slug = p_equipe and m.usuario_id = p_usuario;
end $$;

-- "Apagar minha conta e meus dados": apaga a conta de login (e, junto, perfil e vínculos).
-- Se o Supabase não permitir apagar direto, marca o pedido para a administradora concluir.
create or replace function public.apagar_minha_conta() returns text
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Faça login primeiro.' using errcode = '42501'; end if;
  begin
    delete from auth.users where id = auth.uid();
    return 'apagada';
  exception when insufficient_privilege then
    update public.perfis set exclusao_solicitada_em = now() where id = auth.uid();
    delete from public.membros where usuario_id = auth.uid();
    return 'solicitada';
  end;
end $$;

revoke all on function public.eh_admin(), public.cargo_em(uuid), public.eh_membro(uuid), public.idade(int, int),
  public.eh_protegido(uuid), public.validar_perfil(), public.minha_conta(), public.admin_listar_usuarios(),
  public.admin_definir_membro(uuid, text, public.cargo, text), public.admin_remover_membro(uuid, text),
  public.apagar_minha_conta() from public, anon;
grant execute on function public.eh_admin(), public.cargo_em(uuid), public.eh_membro(uuid), public.idade(int, int),
  public.eh_protegido(uuid), public.minha_conta(), public.admin_listar_usuarios(),
  public.admin_definir_membro(uuid, text, public.cargo, text), public.admin_remover_membro(uuid, text),
  public.apagar_minha_conta() to authenticated;

-- ---------- Dados iniciais ----------
insert into public.equipes (slug, nome, tipo, status, visibilidade)
values ('juventus-academy', 'Juventus Academy', 'propria', 'aprovada', 'privada')
on conflict (slug) do nothing;

-- A primeira conta criada (a sua, do teste de login) vira a administradora.
insert into public.administradores (usuario_id)
select id from auth.users order by created_at limit 1
on conflict do nothing;

-- Confira aqui: deve aparecer o seu e-mail.
select u.email as administradora from public.administradores a join auth.users u on u.id = a.usuario_id;
