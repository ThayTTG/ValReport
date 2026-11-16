-- ValReport v26: o botão "Atualizar" do site (o das setinhas, no topo) pede a coleta na hora.
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

-- Conferência: deve mostrar true
select exists (select 1 from pg_proc where proname = 'nuvem_disparo_manual') as atualizar_pronto;
