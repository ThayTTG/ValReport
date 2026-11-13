-- ValReport v24: a coleta também roda quando alguém da equipe abre o site (com cooldown).
-- Motivo: o GitHub pula a maior parte dos agendamentos de 20 em 20 minutos (de 08/11 a 13/11 foram só 24 execuções,
-- quando deviam ser ~350). O agendamento continua ligado como reserva; as visitas passam a puxar a coleta.
--
-- Quem chama: o site, pela função do Vercel (/api/disparar com {"modo": "visita"}), com o login de quem está vendo.
-- Quem decide: só este banco. A coleta é chamada quando TUDO isto vale:
--   1. quem pede é integrante da equipe (convidados também: eles já veem as partidas);
--   2. a última coleta terminou há mais de 15 minutos (sync_estado.pc_visto_em, que cada execução atualiza);
--   3. ninguém chamou a nuvem nos últimos 10 minutos (a execução leva de 2 a 4 minutos; isso evita fila);
--   4. as visitas chamaram a nuvem menos de 4 vezes na última hora.
-- Assim, com gente vendo o site, a coleta roda no máximo a cada 15 minutos, e nunca 2 visitas chamam juntas.
--
-- Aplicar: SQL Editor do Supabase > colar este arquivo inteiro > Run. Pode rodar mais de uma vez.

alter table public.nuvem_disparos add column if not exists origem text not null default 'admin';

create or replace function public.nuvem_disparo_visita(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_eq uuid; v_coleta timestamptz; v_ultimo timestamptz; v_hora int;
begin
  v_eq := public.sync_equipe(p_slug);
  if v_eq is null then raise exception 'sync_equipe: equipe não encontrada.' using errcode = 'P0001'; end if;
  if not public.eh_membro(v_eq) then raise exception 'Só quem é da equipe chama a coleta.' using errcode = '42501'; end if;

  -- trava as chamadas desta equipe até o fim da transação: duas visitas ao mesmo tempo não passam juntas
  perform pg_advisory_xact_lock(hashtext('nuvem_disparo_visita'), hashtext(v_eq::text));

  select pc_visto_em into v_coleta from public.sync_estado where equipe_id = v_eq;
  if v_coleta > now() - interval '15 minutes' then
    return jsonb_build_object('pode', false, 'codigo', 'em_dia', 'coleta', v_coleta);
  end if;
  select max(em) into v_ultimo from public.nuvem_disparos where equipe_id = v_eq;
  if v_ultimo > now() - interval '10 minutes' then
    return jsonb_build_object('pode', false, 'codigo', 'recente', 'ultimo', v_ultimo);
  end if;
  select count(*) into v_hora from public.nuvem_disparos where equipe_id = v_eq and origem = 'visita' and em > now() - interval '1 hour';
  if v_hora >= 4 then
    return jsonb_build_object('pode', false, 'codigo', 'limite', 'ultimo', v_ultimo);
  end if;

  insert into public.nuvem_disparos (equipe_id, por, origem) values (v_eq, auth.uid(), 'visita');
  delete from public.nuvem_disparos where equipe_id = v_eq and em < now() - interval '7 days';
  return jsonb_build_object('pode', true, 'coleta', v_coleta, 'ultimo', v_ultimo);
end $$;

revoke execute on function public.nuvem_disparo_visita(text) from public, anon, authenticated;
grant execute on function public.nuvem_disparo_visita(text) to authenticated;

-- Conferência: deve mostrar true
select exists (select 1 from pg_proc where proname = 'nuvem_disparo_visita') as visita_pronta;
