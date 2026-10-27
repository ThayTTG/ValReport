-- =============================================================================
-- ValReport 2.0 · Táticas (Equipe → Táticas)
-- Estratégias da equipe: seções com blocos de texto, imagem, link, vídeo, round de partida, mapa tático,
-- slides e PDF. Só a equipe vê (convidados não); líder, co-líderes e treinadores editam.
-- Rode DEPOIS do etapa3b.sql: SQL Editor → New query → cole tudo → Run. Pode rodar de novo sem estragar nada.
-- =============================================================================

do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'equipes' and column_name = 'imagem_enviada_em') then
    raise exception 'Rode primeiro o supabase/etapa3b.sql e depois este arquivo de novo.';
  end if;
end $$;

-- ---------- Tabela ----------
-- Cada estratégia guarda duas versões do mesmo documento: a publicada (o que a equipe vê) e o rascunho
-- (o que a liderança está editando, salvo sozinho). Publicar copia o rascunho para a versão da equipe.
create table if not exists public.taticas (
  id uuid primary key default gen_random_uuid(),
  equipe_id uuid not null references public.equipes (id) on delete cascade,
  -- espelho da versão publicada, para a lista (o documento completo fica em "conteudo")
  titulo text not null,
  mapa text,
  lado text not null default 'ataque' check (lado in ('ataque', 'defesa', 'ambos')),
  agentes text[] not null default '{}',
  capa text,
  resumo jsonb not null default '{}'::jsonb,
  conteudo jsonb,                          -- versão publicada (vazia = ainda não publicada)
  versao int not null default 0,
  publicada_em timestamptz,
  publicada_por uuid references auth.users (id) on delete set null,
  rascunho jsonb,                          -- versão em edição (vazia = nada pendente)
  rascunho_versao int not null default 0,
  rascunho_em timestamptz,
  rascunho_por uuid references auth.users (id) on delete set null,
  origem text,                             -- "plano:<mapa>" quando veio de um plano de mapa das Notas da IGL
  criado_por uuid references auth.users (id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists taticas_equipe on public.taticas (equipe_id);
create unique index if not exists taticas_origem_unica on public.taticas (equipe_id, origem) where origem is not null;
alter table public.taticas enable row level security;
revoke all on public.taticas from anon, public, authenticated;   -- tudo passa pelas funções abaixo

-- ---------- Quem vê e quem edita ----------
create or replace function public.pode_ver_taticas(p_equipe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.equipes where id = p_equipe and status = 'aprovada')
     and (public.eh_admin() or coalesce(public.cargo_em(p_equipe) in ('lider', 'colider', 'treinador', 'jogador'), false))
$$;
create or replace function public.pode_editar_taticas(p_equipe uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.equipes where id = p_equipe and status = 'aprovada')
     and (public.eh_admin() or coalesce(public.cargo_em(p_equipe) in ('lider', 'colider', 'treinador'), false))
$$;

-- ---------- Validação do documento ----------
-- Confere tudo o que o site manda: tipos de bloco, tamanhos, links só https, vídeos só dos sites aceitos,
-- arquivos só desta estratégia. Devolve o resumo (seções e contagens) para a lista.
drop function if exists public.tatica_validar(jsonb, uuid, uuid);
drop function if exists public.tatica_item_mapa(jsonb, uuid, uuid);

create or replace function public.tatica_erro(p_motivo text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  raise exception 'tatica_invalida: %', p_motivo using errcode = 'P0001';
end $$;

create or replace function public.tatica_texto(p_v jsonb, p_max int, p_campo text, p_obrigatorio boolean default false) returns text
language plpgsql immutable set search_path = '' as $$
declare v text;
begin
  if p_v is null or jsonb_typeof(p_v) = 'null' then
    if p_obrigatorio then perform public.tatica_erro(p_campo || ' é obrigatório.'); end if;
    return null;
  end if;
  if jsonb_typeof(p_v) <> 'string' then perform public.tatica_erro(p_campo || ' precisa ser texto.'); end if;
  v := p_v #>> '{}';
  if char_length(v) > p_max then perform public.tatica_erro(p_campo || ' passou de ' || p_max || ' caracteres.'); end if;
  if p_obrigatorio and btrim(v) = '' then perform public.tatica_erro(p_campo || ' está vazio.'); end if;
  return v;
end $$;

create or replace function public.tatica_numero(p_v jsonb, p_min numeric, p_max numeric, p_campo text) returns numeric
language plpgsql immutable set search_path = '' as $$
begin
  if p_v is null or jsonb_typeof(p_v) <> 'number' or (p_v #>> '{}')::numeric not between p_min and p_max then
    perform public.tatica_erro(p_campo || ' fora do intervalo.');
  end if;
  return (p_v #>> '{}')::numeric;
end $$;

-- Arquivo guardado no balde "taticas": <equipe>/<estratégia>/<nome aleatório>.<extensão>
create or replace function public.tatica_arquivo(p_v jsonb, p_equipe uuid, p_id uuid, p_tipos text, p_campo text, p_obrigatorio boolean default true) returns text
language plpgsql immutable set search_path = '' as $$
declare v text;
begin
  v := public.tatica_texto(p_v, 200, p_campo, p_obrigatorio);
  if v is null then return null; end if;
  if v !~ ('^' || p_equipe::text || '/' || p_id::text || '/[a-f0-9]{16,32}\.(' || p_tipos || ')$') then
    perform public.tatica_erro(p_campo || ' aponta para um arquivo que não é desta estratégia.');
  end if;
  return v;
end $$;

create or replace function public.tatica_id_ok(p_v jsonb, p_campo text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_v is null or jsonb_typeof(p_v) <> 'string' or (p_v #>> '{}') !~ '^[a-z0-9]{6,16}$' then
    perform public.tatica_erro(p_campo || ' com identificador inválido.');
  end if;
  return p_v #>> '{}';
end $$;

create or replace function public.tatica_lista(p_v jsonb, p_max int, p_campo text) returns jsonb
language plpgsql immutable set search_path = '' as $$
begin
  if p_v is null or jsonb_typeof(p_v) = 'null' then return '[]'::jsonb; end if;
  if jsonb_typeof(p_v) <> 'array' then perform public.tatica_erro(p_campo || ' precisa ser uma lista.'); end if;
  if jsonb_array_length(p_v) > p_max then perform public.tatica_erro(p_campo || ' passou de ' || p_max || ' itens.'); end if;
  return p_v;
end $$;

-- Mídia de um vídeo (bloco de vídeo ou ponto do mapa): link de um site aceito, clipe enviado ou round de partida
create or replace function public.tatica_midia(m jsonb, p_equipe uuid, p_id uuid, p_campo text) returns void
language plpgsql immutable set search_path = '' as $$
declare v_fonte text; v_ref text;
begin
  if m is null or jsonb_typeof(m) = 'null' then return; end if;
  if jsonb_typeof(m) <> 'object' then perform public.tatica_erro(p_campo || ' inválido.'); end if;
  v_fonte := public.tatica_texto(m -> 'fonte', 20, p_campo || ': fonte', true);
  if v_fonte = 'round' then
    if coalesce(m ->> 'partida', '') !~ '^[0-9a-f-]{36}$' then perform public.tatica_erro(p_campo || ': partida inválida.'); end if;
    perform public.tatica_numero(m -> 'round', 1, 60, p_campo || ': round');
    return;
  end if;
  v_ref := public.tatica_texto(m -> 'ref', 200, p_campo || ': vídeo', true);
  if not (
       (v_fonte = 'youtube' and v_ref ~ '^[A-Za-z0-9_-]{11}$')
    or (v_fonte = 'streamable' and v_ref ~ '^[a-z0-9]{3,16}$')
    or (v_fonte = 'twitch' and v_ref ~ '^[A-Za-z0-9_-]{3,120}$')
    or (v_fonte = 'drive' and v_ref ~ '^[A-Za-z0-9_-]{20,80}$')
    or (v_fonte = 'medal' and v_ref ~ '^(games/[a-z0-9-]{1,40}/)?clips?/[A-Za-z0-9_-]{3,60}(/[A-Za-z0-9_-]{1,80})?$')
    or (v_fonte = 'arquivo' and v_ref ~ ('^' || p_equipe::text || '/' || p_id::text || '/[a-f0-9]{16,32}\.(mp4|webm)$'))) then
    perform public.tatica_erro(p_campo || ': esse vídeo não é de um site aceito (YouTube, Medal, Streamable, Twitch, Google Drive ou clipe enviado).');
  end if;
  if m ? 'inicio' then perform public.tatica_numero(m -> 'inicio', 0, 36000, p_campo || ': início'); end if;
end $$;

-- Um item desenhado no mapa tático
create or replace function public.tatica_item_mapa(it jsonb, p_equipe uuid, p_id uuid, p_estrito boolean default true) returns text
language plpgsql immutable set search_path = '' as $$
declare v_t text; p jsonb; n int;
begin
  if jsonb_typeof(it) <> 'object' then perform public.tatica_erro('item do mapa inválido.'); end if;
  perform public.tatica_id_ok(it -> 'id', 'item do mapa');
  v_t := it ->> 't';
  if v_t in ('agente', 'hab', 'area', 'texto', 'ponto', 'inimigo') then
    perform public.tatica_numero(it -> 'x', -0.01, 1.01, 'posição no mapa');
    perform public.tatica_numero(it -> 'y', -0.01, 1.01, 'posição no mapa');
  end if;
  if v_t in ('agente', 'hab') then
    if coalesce(it ->> 'ag', '') !~ '^[[:alnum:] /.''-]{2,20}$' then perform public.tatica_erro('agente inválido no mapa.'); end if;
  end if;
  if v_t = 'hab' and coalesce(it ->> 'slot', '') !~ '^(Ability1|Ability2|Grenade|Ultimate|Passive)$' then
    perform public.tatica_erro('habilidade inválida no mapa.');
  end if;
  if v_t in ('hab', 'area') and it ? 'r' then perform public.tatica_numero(it -> 'r', 0.005, 0.3, 'tamanho da área'); end if;
  if v_t in ('seta', 'traco', 'area', 'texto') and it ? 'cor' and coalesce(it ->> 'cor', '') !~ '^#[0-9a-f]{6}$' then
    perform public.tatica_erro('cor inválida no mapa.');
  end if;
  if v_t in ('seta', 'traco') then
    if jsonb_typeof(it -> 'pts') <> 'array' or jsonb_array_length(it -> 'pts') not between 2 and 400 then
      perform public.tatica_erro('traço do mapa inválido.');
    end if;
    for p in select * from jsonb_array_elements(it -> 'pts') loop
      if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) <> 2 then perform public.tatica_erro('ponto de traço inválido.'); end if;
      perform public.tatica_numero(p -> 0, -0.01, 1.01, 'traço do mapa');
      perform public.tatica_numero(p -> 1, -0.01, 1.01, 'traço do mapa');
    end loop;
  elsif v_t = 'texto' then
    perform public.tatica_texto(it -> 'texto', 60, 'texto no mapa', true);
  elsif v_t = 'ponto' then
    perform public.tatica_texto(it -> 'titulo', 100, 'título do ponto', p_estrito);
    perform public.tatica_texto(it -> 'entrada', 600, 'link do vídeo do ponto', false);
    if it ? 'ag' and jsonb_typeof(it -> 'ag') <> 'null' and coalesce(it ->> 'ag', '') !~ '^[[:alnum:] /.''-]{2,20}$' then
      perform public.tatica_erro('agente do ponto inválido.');
    end if;
    if it ? 'slot' and jsonb_typeof(it -> 'slot') <> 'null' and coalesce(it ->> 'slot', '') !~ '^(Ability1|Ability2|Grenade|Ultimate|Passive)$' then
      perform public.tatica_erro('habilidade do ponto inválida.');
    end if;
    if it ? 'tipo' and coalesce(it ->> 'tipo', '') !~ '^(pixel|lineup|posicao|timing|outro)$' then
      perform public.tatica_erro('tipo do ponto inválido.');
    end if;
    perform public.tatica_midia(it -> 'midia', p_equipe, p_id, 'vídeo do ponto');
    select count(*) into n from jsonb_array_elements(public.tatica_lista(it -> 'passos', 12, 'passos do ponto')) x
     where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 240;
    if n > 0 then perform public.tatica_erro('passo do ponto inválido.'); end if;
  elsif v_t not in ('agente', 'hab', 'area', 'inimigo') then
    perform public.tatica_erro('item desconhecido no mapa.');
  end if;
  return v_t;
end $$;

-- p_estrito = true ao publicar (tudo completo); false nos rascunhos (blocos ainda sem link, imagem ou vídeo passam,
-- mas o que estiver preenchido precisa ser válido).
create or replace function public.tatica_validar(p_doc jsonb, p_equipe uuid, p_id uuid, p_estrito boolean default true) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare s jsonb; b jsonb; f jsonb; it jsonb; sl jsonb; x jsonb; v_tipo text; v_t text;
  v_secoes jsonb := '[]'::jsonb; n_blocos int := 0; n_videos int := 0; n_pontos int := 0; n_imagens int := 0; n_itens int;
  ids text[] := '{}'; v_id text;
begin
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' then perform public.tatica_erro('documento vazio.'); end if;
  if octet_length(p_doc::text) > 700000 then perform public.tatica_erro('a estratégia ficou grande demais (mais de 700 KB de texto e desenhos).'); end if;
  perform public.tatica_texto(p_doc -> 'titulo', 60, 'Nome da estratégia', true);
  if (p_doc ->> 'titulo') ~ '[<>{}[:cntrl:]]' then perform public.tatica_erro('o nome não pode ter < > { }.'); end if;
  if jsonb_typeof(p_doc -> 'mapa') = 'string' and (p_doc ->> 'mapa') !~ '^[[:alpha:] ''.-]{2,30}$' then perform public.tatica_erro('mapa inválido.'); end if;
  if coalesce(p_doc ->> 'lado', '') not in ('ataque', 'defesa', 'ambos') then perform public.tatica_erro('lado inválido.'); end if;
  for x in select * from jsonb_array_elements(public.tatica_lista(p_doc -> 'agentes', 10, 'Composição')) loop
    if jsonb_typeof(x) <> 'string' or (x #>> '{}') !~ '^[[:alnum:] /.''-]{2,20}$' then perform public.tatica_erro('agente inválido na composição.'); end if;
  end loop;
  perform public.tatica_arquivo(p_doc -> 'capa', p_equipe, p_id, 'webp|jpg|png', 'Capa', false);
  if jsonb_typeof(p_doc -> 'secoes') <> 'array' or jsonb_array_length(p_doc -> 'secoes') not between 1 and 20 then
    perform public.tatica_erro('a estratégia precisa ter de 1 a 20 seções.');
  end if;

  for s in select * from jsonb_array_elements(p_doc -> 'secoes') loop
    v_id := public.tatica_id_ok(s -> 'id', 'Seção');
    if v_id = any (ids) then perform public.tatica_erro('seção repetida.'); end if;
    ids := ids || v_id;
    v_secoes := v_secoes || to_jsonb(public.tatica_texto(s -> 'nome', 40, 'Nome da seção', true));
    for b in select * from jsonb_array_elements(public.tatica_lista(s -> 'blocos', 60, 'Blocos da seção')) loop
      if jsonb_typeof(b) <> 'object' then perform public.tatica_erro('bloco inválido.'); end if;
      v_id := public.tatica_id_ok(b -> 'id', 'Bloco');
      if v_id = any (ids) then perform public.tatica_erro('bloco repetido.'); end if;
      ids := ids || v_id;
      n_blocos := n_blocos + 1;
      v_tipo := b ->> 'tipo';
      if v_tipo = 'texto' then
        perform public.tatica_texto(b -> 'texto', 10000, 'Texto', false);
      elsif v_tipo = 'imagem' then
        perform public.tatica_arquivo(b -> 'arquivo', p_equipe, p_id, 'webp|jpg|png', 'Imagem', p_estrito);
        perform public.tatica_texto(b -> 'legenda', 300, 'Legenda', false);
        n_imagens := n_imagens + 1;
      elsif v_tipo = 'link' then
        if p_estrito and (coalesce(b ->> 'url', '') !~ '^https://[A-Za-z0-9.-]+(:[0-9]{2,5})?(/[^[:space:]<>"]*)?$' or char_length(b ->> 'url') > 600) then
          perform public.tatica_erro('o link precisa começar com https://.');
        end if;
        perform public.tatica_texto(b -> 'url', 600, 'Link', false);
        perform public.tatica_texto(b -> 'titulo', 120, 'Título do link', false);
        perform public.tatica_texto(b -> 'descricao', 300, 'Descrição do link', false);
      elsif v_tipo = 'video' then
        perform public.tatica_midia(b -> 'midia', p_equipe, p_id, 'Vídeo');
        if p_estrito and (b -> 'midia' is null or jsonb_typeof(b -> 'midia') = 'null') then perform public.tatica_erro('o bloco de vídeo está sem vídeo.'); end if;
        perform public.tatica_texto(b -> 'entrada', 600, 'Link do vídeo', false);
        perform public.tatica_texto(b -> 'titulo', 120, 'Título do vídeo', false);
        if jsonb_typeof(b -> 'ag') = 'string' and (b ->> 'ag') !~ '^[[:alnum:] /.''-]{2,20}$' then perform public.tatica_erro('agente do vídeo inválido.'); end if;
        for x in select * from jsonb_array_elements(public.tatica_lista(b -> 'passos', 12, 'Passos do vídeo')) loop
          if jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 240 then perform public.tatica_erro('passo do vídeo inválido.'); end if;
        end loop;
        n_videos := n_videos + 1;
      elsif v_tipo = 'mapa' then
        perform public.tatica_texto(b -> 'titulo', 120, 'Título do mapa tático', false);
        if jsonb_typeof(b -> 'fases') <> 'array' or jsonb_array_length(b -> 'fases') not between 1 and 10 then
          perform public.tatica_erro('o mapa tático precisa ter de 1 a 10 fases.');
        end if;
        for f in select * from jsonb_array_elements(b -> 'fases') loop
          perform public.tatica_id_ok(f -> 'id', 'Fase');
          perform public.tatica_texto(f -> 'nome', 40, 'Nome da fase', true);
          n_itens := 0;
          for it in select * from jsonb_array_elements(public.tatica_lista(f -> 'itens', 300, 'Itens da fase')) loop
            v_t := public.tatica_item_mapa(it, p_equipe, p_id, p_estrito);
            if v_t = 'ponto' then
              n_pontos := n_pontos + 1;
              if it -> 'midia' is not null and jsonb_typeof(it -> 'midia') <> 'null' then n_videos := n_videos + 1; end if;
            end if;
          end loop;
        end loop;
      elsif v_tipo = 'slides' then
        perform public.tatica_texto(b -> 'titulo', 120, 'Título da apresentação', false);
        if jsonb_typeof(b -> 'slides') <> 'array' or jsonb_array_length(b -> 'slides') not between (case when p_estrito then 1 else 0 end) and 40 then
          perform public.tatica_erro('a apresentação precisa ter de 1 a 40 slides.');
        end if;
        for sl in select * from jsonb_array_elements(b -> 'slides') loop
          perform public.tatica_id_ok(sl -> 'id', 'Slide');
          perform public.tatica_texto(sl -> 'titulo', 120, 'Título do slide', false);
          perform public.tatica_texto(sl -> 'texto', 2000, 'Texto do slide', false);
          perform public.tatica_arquivo(sl -> 'imagem', p_equipe, p_id, 'webp|jpg|png', 'Imagem do slide', false);
        end loop;
      elsif v_tipo = 'pdf' then
        perform public.tatica_texto(b -> 'titulo', 120, 'Título do PDF', false);
        perform public.tatica_texto(b -> 'nome', 160, 'Nome do arquivo', false);
        if jsonb_typeof(b -> 'paginas') <> 'array' or jsonb_array_length(b -> 'paginas') not between (case when p_estrito then 1 else 0 end) and 60 then
          perform public.tatica_erro('o PDF precisa ter de 1 a 60 páginas.');
        end if;
        for x in select * from jsonb_array_elements(b -> 'paginas') loop
          perform public.tatica_arquivo(x, p_equipe, p_id, 'webp|jpg|png', 'Página do PDF');
        end loop;
      else
        perform public.tatica_erro('tipo de bloco desconhecido.');
      end if;
    end loop;
  end loop;
  return jsonb_build_object('secoes', v_secoes, 'blocos', n_blocos, 'videos', n_videos, 'pontos', n_pontos, 'imagens', n_imagens);
end $$;

-- ---------- Funções que o site chama ----------
-- Lista da aba Táticas. Rascunhos nunca publicados só aparecem para quem edita.
create or replace function public.taticas_listar(p_equipe uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_editor boolean;
begin
  if not public.pode_ver_taticas(p_equipe) then raise exception 'Só a equipe vê as táticas (convidados não).' using errcode = '42501'; end if;
  v_editor := public.pode_editar_taticas(p_equipe);
  return jsonb_build_object('pode_editar', v_editor,
    'taticas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'titulo', case when t.conteudo is null then t.rascunho ->> 'titulo' else t.titulo end,
        'mapa', case when t.conteudo is null then t.rascunho ->> 'mapa' else t.mapa end,
        'lado', case when t.conteudo is null then t.rascunho ->> 'lado' else t.lado end,
        'agentes', case when t.conteudo is null then coalesce(t.rascunho -> 'agentes', '[]'::jsonb) else to_jsonb(t.agentes) end,
        'capa', case when t.conteudo is null then t.rascunho ->> 'capa' else t.capa end,
        'resumo', t.resumo, 'publicada', t.conteudo is not null, 'tem_rascunho', v_editor and t.rascunho is not null,
        'autor', (select apelido from public.perfis where id = coalesce(t.publicada_por, t.criado_por)),
        'atualizada_em', coalesce(t.publicada_em, t.rascunho_em, t.criado_em))
        order by coalesce(t.publicada_em, t.rascunho_em, t.criado_em) desc)
      from public.taticas t
      where t.equipe_id = p_equipe and (t.conteudo is not null or v_editor)), '[]'::jsonb));
end $$;

-- Página da estratégia (versão publicada; quem edita também fica sabendo se há rascunho)
create or replace function public.tatica_ler(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.taticas; v_editor boolean;
begin
  select * into t from public.taticas where id = p_id;
  if t.id is null or not public.pode_ver_taticas(t.equipe_id) then return null; end if;
  v_editor := public.pode_editar_taticas(t.equipe_id);
  if t.conteudo is null and not v_editor then return null; end if;
  return jsonb_build_object('id', t.id, 'equipe_id', t.equipe_id, 'doc', t.conteudo, 'versao', t.versao,
    'publicada_em', t.publicada_em, 'publicada_por', (select apelido from public.perfis where id = t.publicada_por),
    'criado_por', (select apelido from public.perfis where id = t.criado_por), 'criado_em', t.criado_em,
    'pode_editar', v_editor,
    'tem_rascunho', v_editor and t.rascunho is not null,
    'rascunho_por', case when v_editor then (select apelido from public.perfis where id = t.rascunho_por) end,
    'rascunho_em', case when v_editor then t.rascunho_em end);
end $$;

-- O que o editor abre: o rascunho (se houver) ou a versão publicada, com os números de versão
create or replace function public.tatica_editar(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare t public.taticas;
begin
  select * into t from public.taticas where id = p_id;
  if t.id is null or not public.pode_editar_taticas(t.equipe_id) then
    raise exception 'Só a liderança e os treinadores editam as táticas.' using errcode = '42501';
  end if;
  return jsonb_build_object('id', t.id, 'equipe_id', t.equipe_id, 'doc', coalesce(t.rascunho, t.conteudo),
    'eh_rascunho', t.rascunho is not null, 'publicada', t.conteudo is not null,
    'rascunho_versao', t.rascunho_versao, 'versao', t.versao,
    'rascunho_por', (select apelido from public.perfis where id = t.rascunho_por), 'rascunho_em', t.rascunho_em,
    'eu', auth.uid() = t.rascunho_por);
end $$;

create or replace function public.tatica_criar(p_equipe uuid, p_titulo text, p_mapa text default null, p_lado text default 'ataque')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid(); v_doc jsonb;
begin
  if not public.pode_editar_taticas(p_equipe) then
    raise exception 'Só a liderança e os treinadores criam táticas.' using errcode = '42501';
  end if;
  if (select count(*) from public.taticas where equipe_id = p_equipe) >= 200 then
    raise exception 'tatica_limite: a equipe já tem 200 estratégias. Apague alguma antes.' using errcode = 'P0001';
  end if;
  v_doc := jsonb_build_object('v', 1, 'titulo', btrim(coalesce(p_titulo, '')), 'mapa', nullif(btrim(coalesce(p_mapa, '')), ''),
    'lado', coalesce(nullif(p_lado, ''), 'ataque'), 'agentes', '[]'::jsonb, 'capa', null,
    'secoes', jsonb_build_array(jsonb_build_object('id', substr(md5(random()::text), 1, 8), 'nome', 'Execução', 'blocos', '[]'::jsonb)));
  perform public.tatica_validar(v_doc, p_equipe, v_id, false);
  insert into public.taticas (id, equipe_id, titulo, mapa, lado, rascunho, rascunho_versao, rascunho_em, rascunho_por, criado_por)
  values (v_id, p_equipe, v_doc ->> 'titulo', v_doc ->> 'mapa', v_doc ->> 'lado', v_doc, 1, now(), auth.uid(), auth.uid());
  return v_id;
end $$;

-- Salva o rascunho (o editor chama sozinho, alguns segundos depois de cada mudança).
-- p_versao = a versão do rascunho que o editor abriu: se outra pessoa salvou depois, avisa em vez de apagar o trabalho dela.
create or replace function public.tatica_salvar_rascunho(p_id uuid, p_doc jsonb, p_versao int, p_forcar boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.taticas;
begin
  select * into t from public.taticas where id = p_id for update;
  if t.id is null or not public.pode_editar_taticas(t.equipe_id) then
    raise exception 'Só a liderança e os treinadores editam as táticas.' using errcode = '42501';
  end if;
  if not p_forcar and t.rascunho_versao <> coalesce(p_versao, -1) then
    raise exception 'conflito: % salvou outra versão às %. Recarregue para ver a versão nova.',
      coalesce((select apelido from public.perfis where id = t.rascunho_por), 'Outra pessoa'),
      to_char(t.rascunho_em at time zone 'America/Sao_Paulo', 'HH24"h"MI') using errcode = 'P0001';
  end if;
  perform public.tatica_validar(p_doc, t.equipe_id, t.id, false);
  update public.taticas set rascunho = p_doc, rascunho_versao = t.rascunho_versao + 1, rascunho_em = now(), rascunho_por = auth.uid()
   where id = p_id;
  return jsonb_build_object('rascunho_versao', t.rascunho_versao + 1, 'salvo_em', now());
end $$;

-- Publica para a equipe: a versão publicada passa a ser este documento e o rascunho é encerrado
create or replace function public.tatica_publicar(p_id uuid, p_doc jsonb, p_versao int, p_forcar boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.taticas; v_resumo jsonb;
begin
  select * into t from public.taticas where id = p_id for update;
  if t.id is null or not public.pode_editar_taticas(t.equipe_id) then
    raise exception 'Só a liderança e os treinadores publicam as táticas.' using errcode = '42501';
  end if;
  if not p_forcar and t.rascunho_versao <> coalesce(p_versao, -1) then
    raise exception 'conflito: % salvou outra versão às %. Recarregue para ver a versão nova.',
      coalesce((select apelido from public.perfis where id = t.rascunho_por), 'Outra pessoa'),
      to_char(t.rascunho_em at time zone 'America/Sao_Paulo', 'HH24"h"MI') using errcode = 'P0001';
  end if;
  v_resumo := public.tatica_validar(p_doc, t.equipe_id, t.id);
  update public.taticas set conteudo = p_doc, titulo = p_doc ->> 'titulo', mapa = p_doc ->> 'mapa', lado = p_doc ->> 'lado',
         agentes = coalesce((select array_agg(x) from jsonb_array_elements_text(p_doc -> 'agentes') x), '{}'),
         capa = p_doc ->> 'capa', resumo = v_resumo, versao = t.versao + 1, publicada_em = now(), publicada_por = auth.uid(),
         rascunho = null, rascunho_versao = t.rascunho_versao + 1, rascunho_em = now(), rascunho_por = auth.uid()
   where id = p_id;
  return jsonb_build_object('versao', t.versao + 1, 'rascunho_versao', t.rascunho_versao + 1);
end $$;

-- Joga fora o rascunho e volta para a versão publicada (uma estratégia nunca publicada é apagada)
create or replace function public.tatica_descartar_rascunho(p_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare t public.taticas;
begin
  select * into t from public.taticas where id = p_id for update;
  if t.id is null or not public.pode_editar_taticas(t.equipe_id) then
    raise exception 'Só a liderança e os treinadores editam as táticas.' using errcode = '42501';
  end if;
  if t.conteudo is null then
    delete from public.taticas where id = p_id;
    return 'apagada';
  end if;
  update public.taticas set rascunho = null, rascunho_versao = t.rascunho_versao + 1, rascunho_em = now(), rascunho_por = auth.uid()
   where id = p_id;
  return 'descartado';
end $$;

create or replace function public.tatica_apagar(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_equipe uuid;
begin
  select equipe_id into v_equipe from public.taticas where id = p_id;
  if v_equipe is null or not public.pode_editar_taticas(v_equipe) then
    raise exception 'Só a liderança e os treinadores apagam as táticas.' using errcode = '42501';
  end if;
  delete from public.taticas where id = p_id;
  return v_equipe;   -- o site apaga os arquivos da pasta da estratégia logo depois
end $$;

-- Espaço usado pelos arquivos das táticas da equipe (o plano grátis do Supabase guarda 1 GB no total)
create or replace function public.taticas_espaco(p_equipe uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.pode_ver_taticas(p_equipe) then jsonb_build_object(
    'bytes', coalesce((select sum(coalesce((o.metadata ->> 'size')::bigint, 0)) from storage.objects o
                       where o.bucket_id = 'taticas' and o.name like p_equipe::text || '/%'), 0),
    'limite', 314572800) end
$$;

-- Planos de mapa das Notas da IGL que ainda não viraram estratégia
create or replace function public.taticas_planos_pendentes(p_equipe uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.pode_editar_taticas(p_equipe) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('mapa', m.key, 'texto', m.value ->> 'texto') order by m.key)
    from public.dados_equipe d, jsonb_each(coalesce(d.conteudo -> 'mapas', '{}'::jsonb)) m
    where d.equipe_id = p_equipe and d.caminho = 'notas.json' and btrim(coalesce(m.value ->> 'texto', '')) <> ''
      and not exists (select 1 from public.taticas t where t.equipe_id = p_equipe and t.origem = 'plano:' || m.key)), '[]'::jsonb);
end $$;

-- Transforma cada plano de mapa numa estratégia publicada (um bloco de texto na seção "Plano")
create or replace function public.taticas_importar_planos(p_equipe uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare p jsonb; v_id uuid; v_doc jsonb; v_resumo jsonb; n int := 0; v_mapa text;
begin
  if not public.pode_editar_taticas(p_equipe) then
    raise exception 'Só a liderança e os treinadores criam táticas.' using errcode = '42501';
  end if;
  for p in select * from jsonb_array_elements(public.taticas_planos_pendentes(p_equipe)) loop
    v_id := gen_random_uuid();
    v_mapa := case when (p ->> 'mapa') ~ '^[[:alpha:] ''.-]{2,30}$' then p ->> 'mapa' end;
    v_doc := jsonb_build_object('v', 1, 'titulo', left('Plano da IGL · ' || (p ->> 'mapa'), 60), 'mapa', v_mapa, 'lado', 'ambos',
      'agentes', '[]'::jsonb, 'capa', null,
      'secoes', jsonb_build_array(jsonb_build_object('id', substr(md5(random()::text), 1, 8), 'nome', 'Plano',
        'blocos', jsonb_build_array(jsonb_build_object('id', substr(md5(random()::text), 1, 8), 'tipo', 'texto', 'texto', left(p ->> 'texto', 10000))))));
    v_resumo := public.tatica_validar(v_doc, p_equipe, v_id);
    insert into public.taticas (id, equipe_id, titulo, mapa, lado, resumo, conteudo, versao, publicada_em, publicada_por,
                                origem, criado_por, rascunho_versao)
    values (v_id, p_equipe, v_doc ->> 'titulo', v_mapa, 'ambos', v_resumo, v_doc, 1, now(), auth.uid(),
            'plano:' || (p ->> 'mapa'), auth.uid(), 1)
    on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- Arquivos (balde privado "taticas") ----------
-- <equipe>/<estratégia>/<nome aleatório>.<extensão>. Imagens, páginas de PDF e clipes de até 15 MB.
-- Só a equipe abre (por endereços temporários); só quem edita envia e apaga.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('taticas', 'taticas', false, 15728640, array['image/webp', 'image/jpeg', 'image/png', 'video/mp4', 'video/webm'])
on conflict (id) do update set public = false, file_size_limit = 15728640,
  allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png', 'video/mp4', 'video/webm'];

create or replace function public.pode_arquivo_tatica(p_nome text, p_editar boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_equipe uuid; v_tatica uuid;
begin
  if coalesce(p_nome, '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-f0-9]{16,32}\.(webp|jpg|png|mp4|webm)$' then
    return false;
  end if;
  v_equipe := split_part(p_nome, '/', 1)::uuid;
  v_tatica := split_part(p_nome, '/', 2)::uuid;
  if not p_editar then return public.pode_ver_taticas(v_equipe); end if;
  -- enviar: a estratégia precisa existir e ser desta equipe; apagar: basta editar as táticas da equipe
  return public.pode_editar_taticas(v_equipe);
end $$;

create or replace function public.pode_enviar_arquivo_tatica(p_nome text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.pode_arquivo_tatica(p_nome, true)
     and exists (select 1 from public.taticas t where t.id = split_part(p_nome, '/', 2)::uuid and t.equipe_id = split_part(p_nome, '/', 1)::uuid)
$$;

drop policy if exists taticas_arquivo_ver on storage.objects;
create policy taticas_arquivo_ver on storage.objects for select to authenticated
  using (bucket_id = 'taticas' and public.pode_arquivo_tatica(name, false));
drop policy if exists taticas_arquivo_enviar on storage.objects;
create policy taticas_arquivo_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'taticas' and public.pode_enviar_arquivo_tatica(name));
drop policy if exists taticas_arquivo_trocar on storage.objects;
create policy taticas_arquivo_trocar on storage.objects for update to authenticated
  using (bucket_id = 'taticas' and public.pode_arquivo_tatica(name, true))
  with check (bucket_id = 'taticas' and public.pode_enviar_arquivo_tatica(name));
drop policy if exists taticas_arquivo_apagar on storage.objects;
create policy taticas_arquivo_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'taticas' and public.pode_arquivo_tatica(name, true));

-- ---------- Permissões das funções ----------
revoke execute on function public.tatica_erro(text), public.tatica_texto(jsonb, int, text, boolean), public.tatica_numero(jsonb, numeric, numeric, text),
  public.tatica_arquivo(jsonb, uuid, uuid, text, text, boolean), public.tatica_id_ok(jsonb, text), public.tatica_lista(jsonb, int, text),
  public.tatica_midia(jsonb, uuid, uuid, text), public.tatica_item_mapa(jsonb, uuid, uuid, boolean), public.tatica_validar(jsonb, uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.pode_ver_taticas(uuid), public.pode_editar_taticas(uuid), public.taticas_listar(uuid), public.tatica_ler(uuid),
  public.tatica_editar(uuid), public.tatica_criar(uuid, text, text, text), public.tatica_salvar_rascunho(uuid, jsonb, int, boolean),
  public.tatica_publicar(uuid, jsonb, int, boolean), public.tatica_descartar_rascunho(uuid), public.tatica_apagar(uuid),
  public.taticas_espaco(uuid), public.taticas_planos_pendentes(uuid), public.taticas_importar_planos(uuid),
  public.pode_arquivo_tatica(text, boolean), public.pode_enviar_arquivo_tatica(text)
  from public, anon;
grant execute on function public.pode_ver_taticas(uuid), public.pode_editar_taticas(uuid), public.taticas_listar(uuid), public.tatica_ler(uuid),
  public.tatica_editar(uuid), public.tatica_criar(uuid, text, text, text), public.tatica_salvar_rascunho(uuid, jsonb, int, boolean),
  public.tatica_publicar(uuid, jsonb, int, boolean), public.tatica_descartar_rascunho(uuid), public.tatica_apagar(uuid),
  public.taticas_espaco(uuid), public.taticas_planos_pendentes(uuid), public.taticas_importar_planos(uuid),
  public.pode_arquivo_tatica(text, boolean), public.pode_enviar_arquivo_tatica(text)
  to authenticated;

-- ---------- Ajustes de segurança (do Security Advisor, 27/10) ----------
-- Funções de apoio usadas só por dentro das outras funções deixam de ser chamadas direto pelo site
-- (eh_protegido e pode_ver_perfil diziam, para qualquer conta, se outra pessoa está no modo protegido de 16–17 anos).
revoke execute on function public.eh_protegido(uuid), public.pode_ver_perfil(uuid), public.e_lideranca(uuid) from public, anon, authenticated;

-- Conferência: deve mostrar o balde "taticas" privado (publico = false), 15728640 bytes e 4 regras
select b.id as balde, b.public as publico, b.file_size_limit as limite_bytes,
       (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'taticas_arquivo_%') as regras
from storage.buckets b where b.id = 'taticas';
