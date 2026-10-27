"""ValReport · elenco da equipe a partir do site (etapa 3b)

O report, a coleta, o site e o Discord passam a usar os membros da equipe cadastrados no site:
líder, co-líderes e jogadores com o Riot ID verificado. Quem está no config.json e ainda não entrou no
site continua no report (assim ninguém some na troca). Para desligar: "site": {"elenco_do_site": false}.

  - Cada pessoa do site é achada pelo puuid (o identificador fixo da conta): as partidas antigas continuam
    sendo dela mesmo depois de uma troca de nick, e a coleta busca as partidas pelo puuid.
  - Se o site não responder, usa a última lista salva em dados/elenco_site.json.
  - Também confere, uma vez por dia, o elenco das equipes Premier na API (sincronizar_premier).

Precisa da variável SUPABASE_SECRET_KEY (a mesma do envio dos dados). Sem ela, fica tudo como no config.json.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

PASTA = Path(__file__).resolve().parent.parent
ARQ_CACHE = PASTA / "dados" / "elenco_site.json"
ARQ_PUUIDS = PASTA / "dados" / "puuids_conhecidos.json"   # Riot ID do config.json -> puuid (aprendido nas partidas)
SUPABASE_URL_PADRAO = "https://qmstulzsoizdrhqwcrbu.supabase.co"
EQUIPE_PADRAO = "juventus-academy"
CARGOS_QUE_JOGAM = ("lider", "colider", "jogador")
HENRIK_URL = os.environ.get("HENRIKDEV_URL", "https://api.henrikdev.xyz").rstrip("/")

_memoria = {}   # uma busca por execução


def _supabase(cfg):
    site = cfg.get("site") or {}
    url = (os.environ.get("SUPABASE_URL") or site.get("supabase_url") or SUPABASE_URL_PADRAO).rstrip("/")
    return url, os.environ.get("SUPABASE_SECRET_KEY", "").strip(), site.get("equipe") or EQUIPE_PADRAO


def _pedido(metodo, url, chave, corpo=None, timeout=15):
    cab = {"apikey": chave, "Content-Type": "application/json", "Accept": "application/json",
           "User-Agent": "NokyLabs-ValReport/2.0"}
    if chave.startswith("eyJ"):
        cab["Authorization"] = f"Bearer {chave}"
    dados = json.dumps(corpo, ensure_ascii=False).encode("utf-8") if corpo is not None else None
    with urllib.request.urlopen(urllib.request.Request(url, data=dados, method=metodo, headers=cab), timeout=timeout) as r:
        texto = r.read().decode("utf-8")
        return json.loads(texto) if texto.strip() else None


def _ler_cache():
    try:
        return json.loads(ARQ_CACHE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def buscar(cfg):
    """Membros da equipe no site: {"equipe": {...}, "membros": [...], "lido_em": ..., "do_cache": bool} ou None."""
    url, chave, equipe = _supabase(cfg)
    if equipe in _memoria:
        return _memoria[equipe]
    res = None
    if chave:
        try:
            r = _pedido("POST", f"{url}/rest/v1/rpc/pc_elenco_equipe", chave, {"p_slug": equipe})
            if isinstance(r, dict) and isinstance(r.get("membros"), list):
                res = {**r, "lido_em": datetime.now(timezone.utc).isoformat(timespec="seconds"), "do_cache": False}
                try:
                    ARQ_CACHE.parent.mkdir(parents=True, exist_ok=True)
                    ARQ_CACHE.write_text(json.dumps({k: v for k, v in res.items() if k != "do_cache"}, ensure_ascii=False, indent=1),
                                         encoding="utf-8")
                except OSError:
                    pass
        except (urllib.error.URLError, OSError, ValueError) as e:
            print(f"Elenco do site: não consegui ler agora ({e}); usando a última lista salva.")
    if res is None:
        c = _ler_cache()
        if c and c.get("equipe", {}).get("slug", equipe) == equipe:
            res = {**c, "do_cache": True}
    _memoria[equipe] = res
    return res


def lembrar_puuids(mapa):
    """O report guarda aqui o puuid de cada Riot ID do config.json (achado nas partidas). Serve para reconhecer
    quem trocou de nick: o Riot ID antigo no config.json e o novo no site são a mesma pessoa."""
    conhecidos = _conhecidos()
    novos = {k.lower(): v for k, v in (mapa or {}).items() if v and conhecidos.get(k.lower()) != v}
    if novos:
        try:
            ARQ_PUUIDS.parent.mkdir(parents=True, exist_ok=True)
            ARQ_PUUIDS.write_text(json.dumps({**conhecidos, **novos}, ensure_ascii=False, indent=1), encoding="utf-8")
        except OSError:
            pass


def _conhecidos():
    try:
        return json.loads(ARQ_PUUIDS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def misturar(cfg, elenco):
    """Devolve (cfg novo, resumo). Não mexe no cfg recebido."""
    c = dict(cfg)
    site = dict(c.get("site") or {})
    c["site"] = site
    apelidos = dict(c.get("apelidos") or {})
    do_site, puuids = [], {}
    no_site_riot = set()
    conhecidos = _conhecidos()
    antigo_de = {}   # puuid -> Riot ID antigo do config.json (troca de nick)
    for r in c.get("jogadores") or []:
        if conhecidos.get(r.lower()):
            antigo_de.setdefault(conhecidos[r.lower()], r)
    for m in elenco.get("membros") or []:
        if m.get("riot_id"):
            no_site_riot.add(m["riot_id"].lower())
        if m.get("cargo") in CARGOS_QUE_JOGAM and m.get("riot_id") and m.get("puuid"):
            do_site.append(m["riot_id"])
            puuids[m["riot_id"].lower()] = m["puuid"]
            # o apelido escolhido no config.json continua valendo (pastas e links do site não mudam);
            # quem não tem apelido lá usa o do site
            velho = antigo_de.get(m["puuid"], m["riot_id"]).lower()
            antigo = next((v for k, v in apelidos.items() if k.lower() in (m["riot_id"].lower(), velho)), None)
            if antigo or m.get("apelido"):
                apelidos[m["riot_id"]] = antigo or m["apelido"]
    # quem está no config.json e ainda não está no site (ou não verificou o Riot ID) continua
    pus_site = set(puuids.values())
    trocou = [r for r in (c.get("jogadores") or []) if r.lower() not in puuids and conhecidos.get(r.lower()) in pus_site]
    do_config = [r for r in (c.get("jogadores") or []) if r.lower() not in no_site_riot and r.lower() not in puuids and r not in trocou]
    fora = [r for r in (c.get("jogadores") or []) if r.lower() in no_site_riot and r.lower() not in puuids]
    # mantém a ordem do config.json (pílulas do site e pastas do report); quem é novo no site vai para o fim
    rid_de_pu = {pu: r for r, pu in zip(do_site, (puuids[x.lower()] for x in do_site))}
    ordem = []
    for r in c.get("jogadores") or []:
        if r.lower() in puuids:
            ordem.append(next(x for x in do_site if x.lower() == r.lower()))
        elif r in trocou:
            ordem.append(rid_de_pu[conhecidos[r.lower()]])
        elif r in do_config:
            ordem.append(r)
    c["jogadores"] = list(dict.fromkeys(ordem + do_site))
    c["apelidos"] = apelidos
    autorizados = list(site.get("jogadores_autorizados") or [])
    site["jogadores_autorizados"] = autorizados + [r for r in do_site if r.lower() not in {a.lower() for a in autorizados}]
    c["_elenco_site"] = True
    return c, {"do_site": do_site, "do_config": do_config, "fora": fora, "trocou": trocou, "puuids": puuids}


def aplicar(cfg, avisar=True):
    """Chamado por gerar_report.config_padrao e pela coleta: junta os membros do site com o config.json."""
    if not cfg or cfg.get("_elenco_site") or (cfg.get("site") or {}).get("elenco_do_site") is False:
        return cfg
    elenco = buscar(cfg)
    if not elenco:
        return cfg
    novo, r = misturar(cfg, elenco)
    try:
        import avaliacao as av
        av.PUUIDS.update(r["puuids"])
    except ImportError:
        pass
    if avisar and not _memoria.get("_avisou"):
        _memoria["_avisou"] = True
        partes = [f"{len(r['do_site'])} do site"]
        if r["do_config"]:
            partes.append(f"{len(r['do_config'])} só do config.json ({', '.join(r['do_config'])})")
        if r["trocou"]:
            partes.append(f"nick antigo no config.json (a pessoa está no site com outro Riot ID): {', '.join(r['trocou'])}")
        if r["fora"]:
            partes.append(f"fora do report por não jogarem na equipe do site: {', '.join(r['fora'])}")
        print(f"Elenco: {'; '.join(partes)}{' (lista salva)' if elenco.get('do_cache') else ''}.")
    return novo


# ---------- Premier: elenco do jogo, uma vez por dia ----------
def _premier_normalizado(d):
    p, st = d.get("placement") or {}, d.get("stats") or {}
    return {
        "id": d.get("id"), "nome": str(d.get("name") or "")[:32], "tag": str(d.get("tag") or "")[:8],
        "info": {"conferencia": p.get("conference"), "divisao": p.get("division"), "pontos": p.get("points"), "posicao": p.get("place"),
                 "vitorias": st.get("wins"), "derrotas": st.get("losses"), "partidas": st.get("matches"), "inscrita": d.get("enrolled")},
        "elenco": [{"puuid": m["puuid"], "nome": m.get("name"), "tag": m.get("tag")}
                   for m in (d.get("member") or []) if isinstance(m, dict) and m.get("puuid")],
    }


def sincronizar_premier(chave_henrik, cfg, horas=20):
    """Confere na API o elenco das equipes Premier do site que não foram conferidas nas últimas `horas`."""
    url, chave, _ = _supabase(cfg)
    if not chave or not chave_henrik:
        return 0
    try:
        equipes = _pedido("POST", f"{url}/rest/v1/rpc/pc_equipes_premier", chave, {}) or []
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"Premier: não consegui ler as equipes do site ({e}).")
        return 0
    limite = datetime.now(timezone.utc) - timedelta(hours=horas)
    feitas = 0
    for e in equipes:
        quando = e.get("sincronizado_em")
        if quando and datetime.fromisoformat(quando.replace("Z", "+00:00")) > limite:
            continue
        try:
            req = urllib.request.Request(f"{HENRIK_URL}/valorant/v1/premier/{urllib.parse.quote(e['premier_id'])}",
                                         headers={"Authorization": chave_henrik, "Accept": "application/json",
                                                  "User-Agent": "NokyLabs-ValReport/2.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                dados = _premier_normalizado(json.loads(r.read().decode("utf-8")).get("data") or {})
            if not dados["id"] or not dados["elenco"]:
                continue
            res = _pedido("POST", f"{url}/rest/v1/rpc/premier_aplicar", chave, {"p_equipe": e["id"], "p_dados": dados})
            feitas += 1
            if res and res.get("viraram_convidados"):
                print(f"Premier {e['slug']}: {res['viraram_convidados']} pessoa(s) saiu(ram) do elenco e passou(aram) a convidado.")
        except (urllib.error.URLError, OSError, ValueError, KeyError) as ex:
            print(f"Premier {e.get('slug')}: elenco não conferido agora ({ex}).")
    return feitas
