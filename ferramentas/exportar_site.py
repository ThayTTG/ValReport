#!/usr/bin/env python3
"""
Exportador de dados para o site — ValReport (NokyLabs)

Lê as partidas salvas em dados/partidas/ (as mesmas do report diário) e escreve arquivos JSON estáticos em
docs/data/, que o site (docs/index.html) lê direto no navegador. Nada aqui chama a API: o site é só leitura.

Privacidade (veja docs/ e CREDITOS.md):
  - Só aparecem pelo nome os jogadores listados em "site" -> "jogadores_autorizados" no config.json
    (por padrão, só o primeiro jogador da lista, a dona do projeto).
  - Todo mundo fora disso vira "Aliado 1", "Adversário 3"... (sem Riot ID, sem nome, sem card).
  - A chave da API e os webhooks nunca entram nos arquivos exportados.

Uso:
    py exportar_site.py              (exporta tudo)
    py exportar_site.py --verificar  (exporta e mostra um resumo do que foi gerado)
    py exportar_site.py --publicar   (exporta e envia para o GitHub: git add/commit/push da pasta docs)
"""

import json
import math
import re
import shutil
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import avaliacao as av
import catalogo
import gerar_report as gr

PASTA = Path(__file__).resolve().parent.parent  # pasta principal do projeto (o código fica em ferramentas/)
PASTA_SITE = PASTA / "docs"
PASTA_DATA = PASTA / "dados" / "site"      # os dados do site ficam no PC e vão para o Supabase (nunca mais para o GitHub)
PASTA_DATA_ANTIGA = PASTA_SITE / "data"    # onde ficavam até a versão 1.x (público no GitHub)
SUPABASE_URL_PADRAO = "https://qmstulzsoizdrhqwcrbu.supabase.co"
EQUIPE_PADRAO = "juventus-academy"
ARQ_MAPAS = PASTA / "dados" / "cache" / "mapas" / "mapas.json"
ARQ_NOTAS = PASTA / "notas" / "notas.json"
PASTA_ELO = PASTA / "dados" / "elo"
URL_PADRAO = "https://valreport.vercel.app/"
CODIGO_TIPO = {"pistol": 0, "eco": 1, "force": 2, "armado": 3, "anti-eco": 4}
VERSAO_DADOS = 1
TIERS_UUID = "03621f52-342b-cf4e-4f86-9350a49c6d04"  # tabela de elos atual da valorant-api

# Reserva sem internet (mesmos valores do mapa_calor.py)
MAPAS_CONHECIDOS = {
    "Ascent": (7e-05, -7e-05, 0.813895, 0.573242), "Split": (7.8e-05, -7.8e-05, 0.842188, 0.697578),
    "Fracture": (7.8e-05, -7.8e-05, 0.556952, 1.155886), "Bind": (5.9e-05, -5.9e-05, 0.576941, 0.967566),
    "Breeze": (7e-05, -7e-05, 0.465123, 0.833078), "Abyss": (8.1e-05, -8.1e-05, 0.5, 0.5),
    "Lotus": (7.2e-05, -7.2e-05, 0.454789, 0.917752), "Sunset": (7.8e-05, -7.8e-05, 0.5, 0.515625),
    "Pearl": (7.8e-05, -7.8e-05, 0.480469, 0.916016), "Summit": (7.5e-05, -7.5e-05, 0.047401, 0.978891),
    "Icebox": (7.2e-05, -7.2e-05, 0.460214, 0.304687), "Haven": (7.5e-05, -7.5e-05, 1.09345, 0.642728),
    "Corrode": (7e-05, -7e-05, 0.526158, 0.5),
}
TIPOS = ("pistol", "eco", "force", "armado", "anti-eco")
g = av.g
HABILIDADES_USADAS = {}   # nome da habilidade -> ícone (vai para o meta.json, para o site mostrar no killfeed)
SLOTS_TECLAS = ("Grenade", "Ability1", "Ability2", "Ultimate")   # C, Q, E, X
USO_POR_AGENTE = defaultdict(lambda: [0, 0, 0, 0, 0])            # agente -> [C, Q, E, X, rounds] de todo o lobby


def casts_de(p):
    """[C, Q, E, X] que o jogador usou na partida (a API só manda o total da partida)."""
    c = p.get("ability_casts") or {}
    return [int(c.get(k) or 0) for k in ("grenade", "ability1", "ability2", "ultimate")]


def habilidades_dos_agentes():
    """Para o meta.json: nome e ícone das 4 habilidades de cada agente jogado e a média de uso por round no lobby
    (todas as pessoas, das duas equipes, em todas as partidas exportadas)."""
    out = {}
    for ag, (c, q, e, x, n) in sorted(USO_POR_AGENTE.items()):
        hab = []
        for slot in SLOTS_TECLAS:
            info = catalogo._g(catalogo.carregar(), ag, "slots", slot) or {}
            ic = info.get("icone")
            hab.append([info.get("pt") or catalogo.RESERVA.get((ag, slot)) or slot,
                        ic if isinstance(ic, str) and ic.startswith("https://media.valorant-api.com/") else None])
        out[ag] = {"h": hab, "m": [round(v / n, 3) if n else 0 for v in (c, q, e, x)], "n": n}
    return out


def nome_arma(k, agente=None):
    """(nome, tipo) do abate: arma pelo nome; habilidades com o nome do jogo (inclusive as que a API manda sem nome,
    como a Caçador de Cabeças e a Tour de Force do Chamber); faca, spike e queda com um rótulo."""
    nome, tipo, slot = catalogo.abate(k, agente)
    if tipo == "A":
        dono = next((ag for wid, (ag, _) in catalogo.ESPECIAIS.items() if wid == g(k, "weapon", "id")), agente)
        ic = catalogo.icone(dono, slot) if slot else None
        if ic:
            HABILIDADES_USADAS.setdefault(nome, ic)
    return nome, tipo


def r3(x):
    return round(x, 3) if isinstance(x, float) else x


def gravar(caminho, dados, compacto=True):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    texto = json.dumps(dados, ensure_ascii=False, separators=(",", ":") if compacto else None,
                       indent=None if compacto else 1)
    caminho.write_text(texto, encoding="utf-8")
    return len(texto.encode("utf-8"))


def slug_de(rid, cfg):
    return gr.nome_arquivo(gr.apelido(rid, cfg)).lower()


# ----------------------------------------------------------------------------
# Quem aparece no site
# ----------------------------------------------------------------------------

def jogadores_do_site(cfg):
    site = cfg.get("site") or {}
    todos = cfg.get("jogadores") or []
    autorizados = site.get("jogadores_autorizados")
    if autorizados is None:
        autorizados = todos[:1]
    autorizados = [r for r in todos if r in set(autorizados)]
    return todos, autorizados


# ----------------------------------------------------------------------------
# Resumo de um membro em uma partida (para os filtros do site)
# ----------------------------------------------------------------------------

def resumo_membro(a, bruta, j, membros_time, cfg, refs, mvp_partida, mvp_times, slug_de_puuid, pos_no_time):
    recs = j["rounds"]
    st = j["stats"] or {}
    pu = j["puuid"]
    lados = {"a": [0] * 8, "d": [0] * 8}       # rounds, vencidos, kills, mortes, impacto, dano, fk, fd
    tipos = {t: [0] * 6 for t in TIPOS}        # rounds, vencidos, kills, mortes, impacto, dano
    clt, clv = [0] * 5, [0] * 5
    mk = [0, 0, 0, 0]
    armas_k = Counter()
    for r in recs:
        lado = lados["a" if r["lado"] == "ataque" else "d"]
        for i, v in enumerate((1, r["venceu"], r["kills"], r["morreu"], r["wpa"], r["dano"], r["first_kill"],
                               r["first_death"])):
            lado[i] += v
        tp = tipos[r["tipo"]]
        for i, v in enumerate((1, r["venceu"], r["kills"], r["morreu"], r["wpa"], r["dano"])):
            tp[i] += v
        if r["clutch_tentado"]:
            n = min(r["clutch_tentado"], 5) - 1
            clt[n] += 1
            if r["clutch_vs"]:
                clv[n] += 1
        if r["kills"] >= 2:
            mk[min(r["kills"], 5) - 2] += 1

    # Armas: abates (exatos) + acertos e dano pela arma comprada no round (aproximado, como no Tracker)
    armas = defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0.0, 0, 0.0])  # k, hs, bs, ls, dano, rounds, dist_soma, n_dist, maior
    validos = {r.get("id") for r in av.rounds_validos(bruta)}
    afk = set()
    for r in bruta.get("rounds") or []:
        if r.get("id") not in validos:
            continue
        for s in r.get("stats") or []:
            if g(s, "player", "puuid") != pu:
                continue
            if s.get("was_afk"):
                afk.add(r.get("id"))
                continue
            arma = g(s, "economy", "weapon", "name")
            if not arma:
                continue
            x = armas[arma]
            x[1] += g(s, "stats", "headshots", padrao=0) or 0
            x[2] += g(s, "stats", "bodyshots", padrao=0) or 0
            x[3] += g(s, "stats", "legshots", padrao=0) or 0
            x[4] += sum((d.get("damage") or 0) for d in s.get("damage_events") or [])
            x[5] += 1
    meu_time = j["time"]
    times = av.times_da_partida(bruta)
    rounds_ok = {r["n"] - 1 for r in recs}  # sem rounds AFK
    for k in bruta.get("kills") or []:
        if k.get("round") not in validos or g(k, "killer", "puuid") != pu or g(k, "victim", "puuid") == pu:
            continue
        if times.get(g(k, "victim", "puuid")) == meu_time or k.get("round") not in rounds_ok:
            continue
        nome = nome_arma(k, j["agente"])[0]
        armas_k[nome] += 1
        loc_k = next((pl.get("location") for pl in k.get("player_locations") or []
                      if g(pl, "player", "puuid") == pu), None)
        loc_v = k.get("location")
        if loc_k and loc_v:
            dist = math.dist((loc_k["x"], loc_k["y"]), (loc_v["x"], loc_v["y"])) / 100
            x = armas[nome]
            x[6] += dist
            x[7] += 1
            x[8] = max(x[8], dist)
    for nome, n in armas_k.items():
        armas[nome][0] = n
    armas_out = {nome: [x[0], x[1], x[2], x[3], x[4], x[5], round(x[6], 1), x[7], round(x[8], 1)]
                 for nome, x in armas.items() if x[0] or x[5]}

    ind = None
    funcao = j["funcao"]
    if recs and funcao in refs:
        av_p = av.avaliar(recs, refs[funcao], funcao, dict(cfg, reamostragens=60))
        ind = av_p["indice"] if av_p else None

    pl = next((p for p in bruta.get("players") or [] if p.get("puuid") == pu), {}) or {}
    mvp = 1 if mvp_partida == pu else (2 if pu in mvp_times else 0)
    dists = sorted(round(r["dist_aliado_morte"] / 100) for r in recs
                   if r["morreu"] and r["dist_aliado_morte"] is not None)
    return {
        "time": j["time"], "ag": j["agente"], "fn": funcao,
        "res": {"vitória": "V", "derrota": "D"}.get(j["resultado"], "E"), "placar": j["placar"],
        "k": st.get("kills", 0), "d": st.get("deaths", 0), "a": st.get("assists", 0), "sc": st.get("score", 0),
        "dd": g(st, "damage", "dealt", padrao=0) or 0, "dr": g(st, "damage", "received", padrao=0) or 0,
        "hs": st.get("headshots", 0), "bs": st.get("bodyshots", 0), "ls": st.get("legshots", 0),
        "r": len(recs), "rt": a["n_rounds"], "rv": sum(r["venceu"] for r in recs),
        "fk": sum(r["first_kill"] for r in recs), "fd": sum(r["first_death"] for r in recs),
        "kast": sum(r["kast"] for r in recs), "tr": sum(r["trades_feitos"] for r in recs),
        "trc": sum(r["trocado"] for r in recs), "imp": r3(sum(r["wpa"] for r in recs)),
        "imps": r3(sum(r["wpa_solo"] for r in recs)), "ks": sum(r["kills_solo"] for r in recs),
        "mi": sum(r["morte_isolada"] for r in recs), "mft": sum(r["morte_fora_trade"] for r in recs),
        "cl": clt, "clv": clv, "cle": r3(sum((r["clutch_esperado"] or 0) for r in recs if r["clutch_tentado"])),
        "pl": sum(r["plant"] for r in recs), "df": sum(r["defuse"] for r in recs), "mk": mk,
        "ut": j["util_total"], "ul": j["ult_total"], "kh": sum(r["kills_hab"] for r in recs),
        "hb": casts_de(pl),
        "lados": {k: [r3(v) for v in vs] for k, vs in lados.items()},
        "tipos": {k: [r3(v) for v in vs] for k, vs in tipos.items() if vs[0]},
        "armas": armas_out, "dm": dists,
        "tier": g(pl, "tier", "id", padrao=0) or 0, "tn": g(pl, "tier", "name") or "Unrated",
        "card": g(pl, "customization", "card"), "lvl": pl.get("account_level"),
        "mvp": mvp, "pos": pos_no_time, "ind": ind,
        "com": sorted(slug_de_puuid[p] for p in membros_time if p != pu and p in slug_de_puuid),
        "eq": len(membros_time), "afk": j["rounds_afk"],
    }


# ----------------------------------------------------------------------------
# Detalhe de uma partida (placar, rounds, abates com posição, leitura dos membros)
# ----------------------------------------------------------------------------

def detalhe_partida(a, bruta, nosso, slug_de_puuid, cfg, membros_info):
    op = av.opcoes(cfg)
    times = av.times_da_partida(bruta)
    ids = sorted(set(t for t in times.values() if t))
    rounds = av.rounds_validos(bruta)
    atacantes = av.lados_dos_rounds(rounds, ids)
    mvp_partida = g(bruta, "metadata", "mvp", "puuid")
    mvp_times = {g(t, "mvp", "puuid") for t in bruta.get("teams") or []}

    # Ordem: nosso time primeiro, cada time pelo score
    pls = sorted(bruta.get("players") or [], key=lambda p: (p.get("team_id") != nosso,
                                                             -(g(p, "stats", "score", padrao=0) or 0)))
    idx = {p["puuid"]: i for i, p in enumerate(pls)}
    cont = Counter()
    jogadores = []
    for p in pls:
        pu = p["puuid"]
        j = a["jogadores"].get(pu) or {}
        recs = j.get("rounds") or []
        st = p.get("stats") or {}
        slug = slug_de_puuid.get(pu)
        if slug:
            nome = membros_info[slug]["apelido"]
        else:
            rotulo = "Aliado" if p.get("team_id") == nosso else "Adversário"
            cont[rotulo] += 1
            nome = f"{rotulo} {cont[rotulo]}"
        tiros = (st.get("headshots", 0) or 0) + (st.get("bodyshots", 0) or 0) + (st.get("legshots", 0) or 0)
        n = a["n_rounds"] or 1
        jogadores.append({
            "nome": nome, "slug": slug, "time": p.get("team_id"), "ag": g(p, "agent", "name") or "?",
            "tier": g(p, "tier", "id", padrao=0) or 0, "tn": g(p, "tier", "name") or "Unrated",
            "k": st.get("kills", 0), "d": st.get("deaths", 0), "a": st.get("assists", 0),
            "acs": round((st.get("score", 0) or 0) / n), "adr": round((g(st, "damage", "dealt", padrao=0) or 0) / n),
            "hs": round(100 * (st.get("headshots", 0) or 0) / tiros) if tiros else 0,
            "fk": sum(r["first_kill"] for r in recs), "fd": sum(r["first_death"] for r in recs),
            "kast": round(100 * sum(r["kast"] for r in recs) / len(recs)) if recs else 0,
            "imp": round(100 * sum(r["wpa"] for r in recs) / len(recs), 1) if recs else 0,
            "mvp": 1 if mvp_partida == pu else (2 if pu in mvp_times else 0),
            "carga": round(g(p, "economy", "loadout_value", "average", padrao=0) or 0),
            "hb": casts_de(p),
        })
        uso = USO_POR_AGENTE[g(p, "agent", "name") or "?"]
        for i, v in enumerate(casts_de(p)):
            uso[i] += v
        uso[4] += a["n_rounds"] or 0

    recs_por_slug = {}
    for pu, slug in slug_de_puuid.items():
        j = a["jogadores"].get(pu)
        if j:
            recs_por_slug[slug] = ({r["n"]: r for r in j["rounds"]}, j["agente"])

    agente_de = {p.get("puuid"): g(p, "agent", "name") for p in bruta.get("players") or []}
    kills_r = defaultdict(list)
    for k in bruta.get("kills") or []:
        kills_r[k.get("round")].append(k)
    lista_rounds = []
    for pos, r in enumerate(rounds):
        rid = r.get("id", pos)
        atk = atacantes.get(rid)
        cargas = av._cargas(r)
        econ = {t: [round(cargas.get(t, 0)), av.tipo_de_round(rid, cargas.get(t, 0), cargas.get(av._outro(ids, t), 0), op)]
                for t in ids}
        ks = []
        for k in sorted(kills_r.get(rid, []), key=lambda k: k.get("time_in_round_in_ms", 0)):
            kp, vp = g(k, "killer", "puuid"), g(k, "victim", "puuid")
            lk = next((pl.get("location") for pl in k.get("player_locations") or []
                       if g(pl, "player", "puuid") == kp), None) or {}
            lv = k.get("location") or {}
            ks.append([k.get("time_in_round_in_ms", 0), idx.get(kp, -1), idx.get(vp, -1),
                       *nome_arma(k, agente_de.get(kp)),
                       lv.get("x"), lv.get("y"), lk.get("x"), lk.get("y"),
                       [idx[g(x, "puuid")] for x in k.get("assistants") or [] if g(x, "puuid") in idx]])

        def spike(ev):
            if not ev:
                return None
            return {"t": ev.get("round_time_in_ms"), "site": ev.get("site"), "x": g(ev, "location", "x"),
                    "y": g(ev, "location", "y"), "por": idx.get(g(ev, "player", "puuid"), -1)}

        membros = {}
        for slug, (por_n, agente) in recs_por_slug.items():
            rec = por_n.get(rid + 1)
            if not rec:
                continue
            resumo, dica, _, ip = gr.descrever_round(rec, agente, a["mapa"])
            membros[slug] = [round(ip, 1), resumo, gr.texto_puro(dica)]
        lista_rounds.append({
            "n": rid + 1, "venc": r.get("winning_team"), "fim": r.get("result"),
            "cer": (r.get("ceremony") or "").replace("Ceremony", "") or None, "atk": atk,
            "plant": spike(r.get("plant")), "defuse": spike(r.get("defuse")), "econ": econ, "kills": ks,
            "membros": membros,
        })

    md = bruta.get("metadata") or {}
    return {
        "id": a["match_id"], "t": a["inicio"].isoformat() if a["inicio"] else None, "mapa": a["mapa"],
        "fila": a["fila_id"], "dur": round((md.get("game_length_in_ms") or 0) / 1000),
        "temp": g(md, "season", "short"), "nosso": nosso,
        "placar": {t.get("team_id"): g(t, "rounds", "won", padrao=0) for t in bruta.get("teams") or []},
        "jogadores": jogadores, "rounds": lista_rounds,
    }


# ----------------------------------------------------------------------------
# Eventos para o mapa de calor (posições de mortes e abates dos membros)
# ----------------------------------------------------------------------------

def eventos_calor(bruta, a, pu):
    validos = {r.get("id") for r in av.rounds_validos(bruta)}
    j = a["jogadores"].get(pu) or {}
    lado = {r["n"]: (0 if r["lado"] == "ataque" else 1) for r in j.get("rounds") or []}
    tipo = {r["n"]: CODIGO_TIPO.get(r["tipo"], -1) for r in j.get("rounds") or []}
    out = []
    for k in bruta.get("kills") or []:
        rid = k.get("round")
        if rid not in validos:
            continue
        vit, mat = g(k, "victim", "puuid"), g(k, "killer", "puuid")
        if vit == pu and mat != vit and k.get("location"):  # morte na própria spike não conta (igual ao placar)
            out.append([0, lado.get(rid + 1, -1), k["location"]["x"], k["location"]["y"], rid + 1, tipo.get(rid + 1, -1)])
        elif mat == pu and vit != pu:
            loc = next((pl.get("location") for pl in k.get("player_locations") or []
                        if g(pl, "player", "puuid") == pu), None)
            if loc:
                out.append([1, lado.get(rid + 1, -1), loc["x"], loc["y"], rid + 1, tipo.get(rid + 1, -1)])
    return out


# ----------------------------------------------------------------------------
# Avaliação de 14 dias (a mesma do Discord)
# ----------------------------------------------------------------------------

def faixa_de(tier_nome):
    """'Platinum 2' -> 'Platinum' (faixa de elo usada na régua vs elo)."""
    f = (tier_nome or "").split(" ")[0]
    return None if f in ("", "Unrated", "Unranked") else f


def avaliacao_json(ctx14, cfg, autorizados, slug, ctx_tudo=None, faixas=None):
    avals = gr.avaliacoes_por_jogador(ctx14, cfg)
    out = {}
    refs_faixa = {}
    if ctx_tudo and faixas:
        excluir = set(ctx_tudo["puuid_de"].values())
        for fx in set(f for f in faixas.values() if f):
            refs_faixa[fx] = av.calcular_referencias(list(ctx_tudo["analises"].values()), excluir, cfg,
                                                     filtro=lambda j, fx=fx: faixa_de(j.get("elo")) == fx)
    for rid in autorizados:
        lst = []
        for x in avals.get(rid, []):
            f = x["funcao"]
            ref = ctx14["refs"][f]
            recs = x["recs"]
            mets = []
            for met in av.PESOS.get(f, av.PESOS["Outra"]):
                nome, menor_melhor = av.METRICAS[met][0], av.METRICAS[met][1]
                mets.append({"k": met, "nome": nome, "voce": r3(x["metricas"][met]), "media": r3(ref[met][0]),
                             "menor_melhor": bool(menor_melhor), "z": r3(x["contrib"].get(met, 0.0))})
            ordem = sorted(x["contrib"].items(), key=lambda kv: kv[1])
            texto = x["veredito"][1]
            tipo = ("insuf" if "insuficientes" in texto else "acima" if "acima" in texto
                    else "abaixo" if "abaixo" in texto else "media")
            kit = av.uso_do_kit(recs, ref)
            cl = av.clutches(recs)
            por_m = defaultdict(list)
            for r in recs:
                por_m[r["match_id"]].append(r)
            partidas = []
            for mid, rs in por_m.items():
                ip = av.avaliar(rs, ref, f, dict(cfg, reamostragens=60))
                partidas.append([mid, ip["indice"], r3(ip["metricas"]["impacto"]), len(rs)])
            lst.append({
                "funcao": f, "rounds": x["rounds"], "partidas": x["partidas"], "indice": x["indice"],
                "margem": list(x["margem"]), "veredito": texto, "tipo": tipo, "metricas": mets,
                "fortes": [av.METRICAS[k][0] for k, z in reversed(ordem) if z >= 0.5][:2],
                "fracos": [av.METRICAS[k][0] for k, z in ordem if z <= -0.5][:2],
                "agentes": dict(Counter(r["agente"] for r in recs).most_common()),
                "kit": {k: r3(v) for k, v in kit.items()} if kit else None,
                "trade": av.distancia_de_trade(recs),
                "clutch": {"tentados": cl["tentados"], "vencidos": cl["vencidos"], "esperado": cl["esperado"]} if cl else None,
                "solo": {k: r3(v) for k, v in av.jogadas_solo(recs).items()},
                "lista": partidas, "amostras_ref": ref.get("_amostras", 0),
                "vs_elo": vs_elo(recs, f, (faixas or {}).get(rid), refs_faixa, cfg),
            })
        out[slug[rid]] = lst
    return out


def vs_elo(recs, funcao, faixa, refs_faixa, cfg):
    """Mesmo índice, mas comparado com quem joga a mesma função na mesma faixa de elo (todas as partidas salvas)."""
    if not faixa or faixa not in refs_faixa:
        return None
    ref = refs_faixa[faixa][funcao]
    x = av.avaliar(recs, ref, funcao, cfg)
    return {"faixa": faixa, "indice": x["indice"], "margem": list(x["margem"]), "amostras": ref.get("_amostras", 0)} if x else None


# ----------------------------------------------------------------------------
# Notas da IGL, histórico de elo e prévia de compartilhamento
# ----------------------------------------------------------------------------

def semana_com_slugs(sem, slug):
    """Troca Riot IDs por apelidos públicos (slugs) no resumo da semana."""
    for x in sem["jogadores"]:
        x["slug"] = slug[x.pop("rid")]
    for x in sem["destaques"] + sem["rever"]:
        x["slug"] = slug[x.pop("rid")]
    sem["mvp"] = slug.get(sem["mvp"]) if sem["mvp"] else None
    return sem


def semana_fechada(ctx, cfg, autorizados, slug, agora=None):
    """Última semana fechada (segunda a domingo 21h): o MVP dela fica com a coroa até a próxima fechar."""
    sem = gr.semana_fechada(ctx, cfg, autorizados, agora or datetime.now(av.FUSO_BR))
    anterior = sem.pop("mvp_anterior")
    sem = semana_com_slugs(sem, slug)
    sem["mvp_anterior"] = slug.get(anterior) if anterior else None
    sem["destaques"] = sem["destaques"][:1]  # só o round da semana (a lista completa fica na aba Semana)
    sem["rever"] = []
    return sem


def notas_json(cfg, partidas_ids):
    site = cfg.get("site") or {}
    vazio = {"partidas": {}, "mapas": {}}
    if site.get("publicar_notas", True) is False:
        return vazio
    bruto = gr.ler_json(ARQ_NOTAS, None) or vazio
    out = {"partidas": {}, "mapas": {}}
    for mid, n in (bruto.get("partidas") or {}).items():
        if mid in partidas_ids and isinstance(n, dict):
            rounds = {str(k): str(v)[:2000] for k, v in (n.get("rounds") or {}).items() if str(v).strip()}
            texto = str(n.get("texto") or "")[:6000]
            if texto.strip() or rounds:
                out["partidas"][mid] = {"texto": texto, "rounds": rounds, "atualizado": n.get("atualizado")}
    for mapa, n in (bruto.get("mapas") or {}).items():
        if isinstance(n, dict) and str(n.get("texto") or "").strip():
            out["mapas"][mapa] = {"texto": str(n["texto"])[:6000], "atualizado": n.get("atualizado")}
    return out


def elo_json(autorizados, slug):
    try:
        from coletor_valorant import gerar_nome
    except Exception:  # noqa: BLE001
        return {}
    out = {}
    for rid in autorizados:
        lst = gr.ler_json(PASTA_ELO / f"{gerar_nome(rid)}.json", []) or []
        if lst:
            out[slug[rid]] = [{k: x.get(k) for k in ("match_id", "t", "tier", "tn", "rr", "delta", "elo", "mapa")}
                              for x in sorted(lst, key=lambda x: x.get("t") or "")]
    return out


def atualizar_previa(site):
    """Coloca o endereço público nas tags de prévia (Discord, WhatsApp...) do docs/index.html."""
    url = gr.url_site({"site": site})
    arq = PASTA_SITE / "index.html"
    try:
        with open(arq, encoding="utf-8", newline="") as f:  # newline="": mantém as quebras de linha como estão
            html = f.read()
    except OSError:
        return
    novo = re.sub(r'(<meta property="og:url" content=")[^"]*(")', rf"\g<1>{url}\g<2>", html)
    novo = re.sub(r'(<meta (?:property|name)="(?:og:image|twitter:image)" content=")[^"]*(")',
                  rf"\g<1>{url}assets/img/og.png\g<2>", novo)
    if novo != html:
        with open(arq, "w", encoding="utf-8", newline="") as f:
            f.write(novo)


# ----------------------------------------------------------------------------
# Formações e sinergia
# ----------------------------------------------------------------------------

def formacoes_json(ctx, cfg, autorizados, slug):
    mids = [a["match_id"] for a in gr.na_janela(ctx)]
    jogos = gr.jogos_em_grupo(ctx, mids, cfg)
    aut = set(autorizados)
    por_form = defaultdict(list)
    pares = defaultdict(lambda: {"partidas": 0, "v": 0, "ab": 0, "ba": 0})
    for jg in jogos:
        visiveis = tuple(r for r in jg["membros"] if r in aut)
        for i, x in enumerate(visiveis):
            for y in visiveis[i + 1:]:
                p = pares[(x, y)]
                p["partidas"] += 1
                p["v"] += jg["resultado"] == "vitória"
                p["ab"] += jg["trades"].get((x, y), 0)
                p["ba"] += jg["trades"].get((y, x), 0)
        if all(r in aut for r in jg["membros"]):
            por_form[jg["membros"]].append(jg)

    formacoes = []
    for membros, js in por_form.items():
        df = gr.dados_formacao(ctx, membros, js, jogos, cfg)
        mapas = defaultdict(lambda: [0, 0])
        comps = defaultdict(lambda: [0, 0])
        for jg in js:
            v = jg["resultado"] == "vitória"
            mapas[jg["mapa"]][0 if v else 1] += 1
            comp = tuple(jg["jogs"][r]["agente"] for r in membros)
            comps[comp][0] += 1
            comps[comp][1] += v
        ds = sorted(df["dists"])
        comp_iso = {}
        for r in membros:
            mi, mj = df["comp"][r]
            comp_iso[slug[r]] = {
                "sozinho": {"partidas": mi["partidas"], "impacto": r3(mi["impacto"]), "kast": r3(mi["kast"])} if mi else None,
                "juntos": {"partidas": mj["partidas"], "impacto": r3(mj["impacto"]), "kast": r3(mj["kast"])} if mj else None,
            }
        formacoes.append({
            "chave": "+".join(slug[r] for r in membros), "membros": [slug[r] for r in membros],
            "partidas": [jg["mid"] for jg in js],
            "v": sum(jg["resultado"] == "vitória" for jg in js), "d": sum(jg["resultado"] == "derrota" for jg in js),
            "mapas": dict(mapas), "comps": sorted(([list(c), n, v] for c, (n, v) in comps.items()), key=lambda x: -x[1]),
            "trades": [[slug[q], slug[t], n] for (q, t), n in df["trades"].most_common()],
            "dist": {"mediana_m": round(ds[len(ds) // 2] / 100) if ds else None, "n": len(ds),
                     "alcance_pct": round(100 * sum(d <= cfg.get("distancia_trade", 1500) for d in ds) / len(ds)) if ds else None},
            "comparacao": comp_iso, "minimo": cfg["min_partidas_grupo"],
        })
    formacoes.sort(key=lambda f: (-len(f["partidas"]), -len(f["membros"])))
    return {
        "formacoes": formacoes,
        "pares": [{"a": slug[x], "b": slug[y], **p} for (x, y), p in sorted(pares.items(), key=lambda kv: -kv[1]["partidas"])],
    }


# ----------------------------------------------------------------------------
# Metadados: equipe, mapas, agentes, armas
# ----------------------------------------------------------------------------

def callouts_validos(m):
    """Descarta callouts que caem fora do desenho do minimapa (a valorant-api tem alguns com coordenada errada,
    como o spawn de ataque do Summit em out/2026). Sem Pillow ou sem minimapa baixado, mantém todos."""
    cs = m.get("callouts") or []
    try:
        from PIL import Image
        alfa = Image.open(ARQ_MAPAS.parent / f"{m['uuid']}.png").convert("RGBA").getchannel("A")
    except Exception:
        return cs
    w, h = alfa.size
    raio = max(2, int(0.03 * w))
    ok = []
    for c in cs:
        u, v = c["y"] * m["xm"] + m["xs"], c["x"] * m["ym"] + m["ys"]
        px, py = int(u * w), int(v * h)
        if not (0 <= u <= 1 and 0 <= v <= 1):
            continue
        perto = max(alfa.getpixel((min(w - 1, max(0, px + dx)), min(h - 1, max(0, py + dy))))
                    for dx in range(-raio, raio + 1, 3) for dy in range(-raio, raio + 1, 3))
        if perto > 0:
            ok.append(c)
    return ok


def mapas_meta(nomes, uuids):
    cache = gr.ler_json(ARQ_MAPAS, []) or []
    out = {}
    for nome in nomes:
        m = next((x for x in cache if x["uuid"] == uuids.get(nome)), None) or \
            next((x for x in cache if x["nome"].lower() == nome.lower()), None)
        if m:
            out[nome] = {"uuid": m["uuid"], "t": [m["xm"], m["ym"], m["xs"], m["ys"]],
                         "callouts": [[c["super"], c["regiao"], round(c["x"]), round(c["y"])] for c in callouts_validos(m)]}
        else:
            t = MAPAS_CONHECIDOS.get(nome)
            out[nome] = {"uuid": uuids.get(nome), "t": list(t) if t else None, "callouts": []}
    return out


# ----------------------------------------------------------------------------
# Execução
# ----------------------------------------------------------------------------

def exportar(cfg=None, verificar=False):
    HABILIDADES_USADAS.clear()
    USO_POR_AGENTE.clear()
    cfg = gr.config_padrao(cfg or gr.ler_json(PASTA / "config.json", {}))
    site = cfg.get("site") or {}
    todos, autorizados = jogadores_do_site(cfg)
    if not autorizados:
        print("Site: nenhum jogador autorizado. Nada exportado.")
        return None
    slug = {rid: slug_de(rid, cfg) for rid in todos}
    hoje = datetime.now(av.FUSO_BR).date().isoformat()

    cfg_tudo = dict(cfg, janela_dias=3650, janela_referencia_dias=3650)
    ctx = gr.carregar_contexto(hoje, cfg_tudo)
    ctx14 = gr.carregar_contexto(hoje, cfg)
    refs = ctx["refs"]
    puuid_aut = {ctx["puuid_de"][r]: slug[r] for r in autorizados if r in ctx["puuid_de"]}
    puuid_todos = {ctx["puuid_de"][r] for r in todos if r in ctx["puuid_de"]}

    membros_info = {slug[r]: {"slug": slug[r], "apelido": gr.apelido(r, cfg),
                              "riot": r if site.get("mostrar_riot_id", False) else None,
                              "partidas": 0, "ultima": None, "card": None, "tier": 0, "tn": "Unrated",
                              "lvl": None, "funcoes": Counter(), "agentes": Counter()} for r in autorizados}

    if PASTA_DATA_ANTIGA.exists():  # migração: os dados saem da pasta pública do site
        shutil.rmtree(PASTA_DATA_ANTIGA, ignore_errors=True)
    if PASTA_DATA.exists():
        shutil.rmtree(PASTA_DATA)
    (PASTA_DATA / "partidas").mkdir(parents=True)
    indice, uuids_mapas, agentes, armas, filas, temporadas = [], {}, {}, {}, Counter(), Counter()
    calor = defaultdict(lambda: {"partidas": [], "e": []})
    tamanho = 0

    for a in sorted(ctx["analises"].values(), key=lambda x: x["inicio"] or ctx["fim"]):
        presentes = [pu for pu in puuid_aut if pu in a["jogadores"]]
        if not presentes:
            continue
        bruta = gr.bruta_de(ctx, a["match_id"])
        if not bruta:
            continue
        md = bruta.get("metadata") or {}
        uuids_mapas[a["mapa"]] = g(md, "map", "id")
        for p in bruta.get("players") or []:
            agentes.setdefault(g(p, "agent", "name") or "?", g(p, "agent", "id"))
        for k in bruta.get("kills") or []:
            if (g(k, "weapon", "type") or "") == "Weapon":
                armas.setdefault(g(k, "weapon", "name"), g(k, "weapon", "id"))
        for r in bruta.get("rounds") or []:
            for s in r.get("stats") or []:
                if g(s, "economy", "weapon", "name"):
                    armas.setdefault(g(s, "economy", "weapon", "name"), g(s, "economy", "weapon", "id"))

        # "Nosso" time = o que tem mais membros autorizados
        times_aut = Counter(a["jogadores"][pu]["time"] for pu in presentes)
        nosso = times_aut.most_common(1)[0][0]
        mvp_partida = g(md, "mvp", "puuid")
        mvp_times = {g(t, "mvp", "puuid") for t in bruta.get("teams") or []}
        por_time = defaultdict(list)
        for p in bruta.get("players") or []:
            por_time[p.get("team_id")].append(p)
        posicao = {}
        for t, ps in por_time.items():
            for i, p in enumerate(sorted(ps, key=lambda p: -(g(p, "stats", "score", padrao=0) or 0))):
                posicao[p["puuid"]] = i + 1

        resumo = {}
        for pu in presentes:
            j = a["jogadores"][pu]
            membros_time = [p for p in puuid_todos if p in a["jogadores"] and a["jogadores"][p]["time"] == j["time"]]
            m = resumo_membro(a, bruta, j, membros_time, cfg, refs, mvp_partida, mvp_times, puuid_aut, posicao.get(pu))
            sl = puuid_aut[pu]
            resumo[sl] = m
            info = membros_info[sl]
            info["partidas"] += 1
            info["ultima"] = a["inicio"].isoformat() if a["inicio"] else info["ultima"]
            info["card"] = m["card"] or info["card"]
            info["lvl"] = m["lvl"] or info["lvl"]
            if a["fila_id"] == "competitive" and m["tier"]:
                info["tier"], info["tn"] = m["tier"], m["tn"]
            info["funcoes"][m["fn"]] += m["r"]
            info["agentes"][m["ag"]] += m["r"]
            ev = eventos_calor(bruta, a, pu)
            if ev:
                c = calor[sl]
                c["partidas"].append(a["match_id"])
                ci = len(c["partidas"]) - 1
                c["e"] += [[ci] + e for e in ev]

        placar = {t.get("team_id"): g(t, "rounds", "won", padrao=0) for t in bruta.get("teams") or []}
        filas[a["fila_id"]] += 1
        temporadas[g(md, "season", "short")] += 1
        indice.append({"id": a["match_id"], "t": a["inicio"].isoformat() if a["inicio"] else None,
                       "mapa": a["mapa"], "fila": a["fila_id"], "dur": round((md.get("game_length_in_ms") or 0) / 1000),
                       "temp": g(md, "season", "short"), "rounds": a["n_rounds"], "placar": placar, "nosso": nosso,
                       "m": resumo})
        det = detalhe_partida(a, bruta, nosso, puuid_aut, cfg, membros_info)
        tamanho += gravar(PASTA_DATA / "partidas" / f"{a['match_id']}.json", det)

    tamanho += gravar(PASTA_DATA / "partidas.json", indice)
    for sl, c in calor.items():
        tamanho += gravar(PASTA_DATA / "calor" / f"{sl}.json", c)
    faixas = {rid: faixa_de(membros_info[slug[rid]]["tn"]) for rid in autorizados}
    tamanho += gravar(PASTA_DATA / "avaliacao.json", avaliacao_json(ctx14, cfg, autorizados, slug, ctx, faixas))
    sem = semana_com_slugs(gr.resumo_semana(ctx, cfg, autorizados, datetime.now(av.FUSO_BR)), slug)
    tamanho += gravar(PASTA_DATA / "semana.json", sem)
    tamanho += gravar(PASTA_DATA / "semana_fechada.json", semana_fechada(ctx, cfg, autorizados, slug))
    tamanho += gravar(PASTA_DATA / "notas.json", notas_json(cfg, {p["id"] for p in indice}))
    tamanho += gravar(PASTA_DATA / "elo.json", elo_json(autorizados, slug))
    atualizar_previa(site)
    tamanho += gravar(PASTA_DATA / "formacoes.json", formacoes_json(ctx, cfg, autorizados, slug))

    # Quem ainda não tem partida guardada usa o card que o Sync buscou (dados/cache/contas.json)
    contas = gr.ler_json(PASTA / "dados" / "cache" / "contas.json", {}) or {}
    for rid in autorizados:
        info, conta = membros_info.get(slug[rid]), contas.get(rid.lower()) or {}
        if info is not None and conta:
            info["card"] = info["card"] or conta.get("card")
            info["lvl"] = info["lvl"] or conta.get("nivel")
    equipe = []
    for rid in autorizados:
        info = membros_info[slug[rid]]
        funcao = info["funcoes"].most_common(1)[0][0] if info["funcoes"] else None
        agente = info["agentes"].most_common(1)[0][0] if info["agentes"] else None
        item = {k: v for k, v in info.items() if k not in ("funcoes", "agentes")}
        item.update(funcao=funcao, agente=agente)
        equipe.append(item)

    meta = {
        "versao": VERSAO_DADOS, "gerado_em": datetime.now(av.FUSO_BR).isoformat(timespec="seconds"),
        "projeto": {"nome": "ValReport", "marca": "NokyLabs",
                    "repo": site.get("repositorio", "https://github.com/ThayTTG/ValReport"),
                    "titulo": site.get("titulo", "ValReport")},
        "equipe": equipe, "ocultos": len(todos) - len(autorizados),
        "mapas": mapas_meta(sorted(uuids_mapas), uuids_mapas),
        "agentes": {n: {"uuid": u, "fn": av.funcao_do_agente(n, cfg)}
                    for n, u in sorted((n, u) for n, u in agentes.items() if n and u)},
        "armas": {n: u for n, u in sorted((n, u) for n, u in armas.items() if n and u)},
        "habilidades": dict(sorted(HABILIDADES_USADAS.items())),
        "hab_agentes": habilidades_dos_agentes(),
        "filas": dict(filas), "temporadas": {k: v for k, v in temporadas.items() if k}, "tiers_uuid": TIERS_UUID,
        "regras": {"janela_dias": cfg["janela_dias"], "amostra_minima": cfg["amostra_minima_rounds"],
                   "trade_m": round(cfg.get("distancia_trade", 1500) / 100),
                   "isolado_m": round(cfg.get("distancia_isolado", 3000) / 100),
                   "janela_trade_s": round(cfg.get("janela_trade_ms", 5000) / 1000),
                   "eco": av.opcoes(cfg)["eco"], "armado": av.opcoes(cfg)["armado"],
                   "min_partidas_grupo": cfg["min_partidas_grupo"],
                   "peso_assist": cfg.get("peso_assistencia", 0.25), "peso_trocada": cfg.get("peso_morte_trocada", 0.5)},
        "modelo": {"rounds": ctx["modelo"].rounds_usados},
        "refs": {f: ctx14["refs"][f]["_amostras"] for f in av.FUNCOES if f != "Outra"},
        "contagem": {"partidas": len(indice), "rounds": sum(p["rounds"] for p in indice)},
    }
    tamanho += gravar(PASTA_DATA / "meta.json", meta, compacto=False)

    nomes_ocultos = [gr.apelido(r, cfg) for r in todos if r not in autorizados]
    print(f"Site: {len(indice)} partida(s) exportada(s) para {PASTA_DATA} ({tamanho / 1024:.0f} KB).")
    if nomes_ocultos:
        print(f"Site: {', '.join(nomes_ocultos)} não aparece(m) pelo nome — falta autorização em "
              "\"site\" -> \"jogadores_autorizados\" no config.json.")
    if verificar:
        for p in indice[-5:]:
            print("  ", p["t"][:16], p["mapa"], p["fila"], {s: f"{m['res']} {m['k']}/{m['d']}/{m['a']}" for s, m in p["m"].items()})
    return PASTA_DATA


def publicar(mensagem=None, tudo=False):
    """git add docs (ou tudo, com tudo=True) + commit + push. Só funciona se esta pasta for um clone do repositório (veja PUBLICAR.md).
    tudo=True é usado pelo publicar_site.bat: envia também o código e os textos; config.json, dados/ e notas/ ficam de fora pelo .gitignore."""
    def git(*args):
        # CREATE_NO_WINDOW: na coleta rápida (sem janela) o Git não abre um console piscando na tela
        return subprocess.run(["git", *args], cwd=PASTA, capture_output=True, text=True, encoding="utf-8", errors="replace",
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        if git("rev-parse", "--is-inside-work-tree").returncode != 0:
            print("Site: esta pasta ainda não é um repositório Git (veja PUBLICAR.md). Nada publicado.")
            return False
    except FileNotFoundError:
        print("Site: Git não encontrado no PC (instale o Git para Windows). Nada publicado.")
        return False
    if tudo:
        # Trava de segurança: nunca publica arquivos privados, mesmo se o .gitignore tiver sido apagado
        ign = (PASTA / ".gitignore").read_text(encoding="utf-8") if (PASTA / ".gitignore").exists() else ""
        if not all(x in ign for x in ("config.json", "dados/", "notas/")):
            print("Site: o .gitignore não protege config.json, dados/ e notas/. Publicando só a pasta docs por segurança.")
            tudo = False
    # Os dados das partidas não vão mais para o GitHub: tira do repositório o que tinha ficado lá
    if git("ls-files", "--error-unmatch", "docs/data").returncode == 0:
        git("rm", "-r", "--cached", "--quiet", "docs/data")
        print("Site: dados das partidas retirados do GitHub (agora ficam no Supabase).")
    git("add", "." if tudo else "docs")
    if git("diff", "--cached", "--quiet").returncode == 0:
        print("Site: nada mudou desde a última publicação.")
        return True
    msg = mensagem or f"Atualiza dados do site ({datetime.now(av.FUSO_BR):%d/%m/%Y %Hh%M})"
    c = git("commit", "-m", msg)
    if c.returncode != 0:
        print(f"Site: o commit falhou: {(c.stderr or c.stdout).strip()[:300]}")
        return False
    p = git("push")
    if p.returncode != 0:
        print(f"Site: o push falhou (confira o login do GitHub no PC): {(p.stderr or p.stdout).strip()[:300]}")
        return False
    print("Site: código publicado no GitHub. A Vercel atualiza o site em 1–2 minutos.")
    return True


# ----------------------------------------------------------------------------
# Envio para o Supabase (só a equipe, logada, consegue ler)
# ----------------------------------------------------------------------------

def _supabase(cfg):
    import os
    site = cfg.get("site") or {}
    url = (os.environ.get("SUPABASE_URL") or site.get("supabase_url") or SUPABASE_URL_PADRAO).rstrip("/")
    chave = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    return url, chave, site.get("equipe") or EQUIPE_PADRAO


def _pedido(metodo, url, chave, corpo=None, extra=None):
    import urllib.request
    cab = {"apikey": chave, "Content-Type": "application/json", "Accept": "application/json",
           "User-Agent": "NokyLabs-ValReport/2.0"}
    if chave.startswith("eyJ"):  # chave service_role antiga (JWT) também vai no Authorization
        cab["Authorization"] = f"Bearer {chave}"
    cab.update(extra or {})
    dados = json.dumps(corpo, ensure_ascii=False, separators=(",", ":")).encode("utf-8") if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo, headers=cab)
    with urllib.request.urlopen(req, timeout=60) as r:
        texto = r.read().decode("utf-8")
        return json.loads(texto) if texto.strip() else None


def enviar_supabase(cfg=None, apenas=None):
    """Envia os JSON de dados/site para a tabela dados_equipe da equipe (upsert) e apaga o que saiu da janela.
    apenas = lista de caminhos (ex.: ["notas.json"]) para mandar só esses. Precisa da variável SUPABASE_SECRET_KEY."""
    import urllib.error
    import urllib.parse
    cfg = cfg or gr.ler_json(PASTA / "config.json", {})
    url, chave, equipe = _supabase(cfg)
    if not chave:
        print("Site: SUPABASE_SECRET_KEY não configurada no PC; os dados ficaram só no PC (veja o guia da etapa 1).")
        return False
    if not PASTA_DATA.exists():
        print("Site: nada exportado ainda para enviar.")
        return False
    try:
        eq = _pedido("GET", f"{url}/rest/v1/equipes?slug=eq.{urllib.parse.quote(equipe)}&select=id", chave)
        if not eq:
            print(f"Site: a equipe '{equipe}' não existe no Supabase (rode o SQL da etapa 1).")
            return False
        equipe_id = eq[0]["id"]
        carimbo = datetime.now(av.FUSO_BR).isoformat(timespec="seconds")
        arquivos = sorted(PASTA_DATA.rglob("*.json"))
        if apenas:
            arquivos = [a for a in arquivos if a.relative_to(PASTA_DATA).as_posix() in apenas]
        linhas = [{"equipe_id": equipe_id, "caminho": a.relative_to(PASTA_DATA).as_posix(),
                   "conteudo": json.loads(a.read_text(encoding="utf-8")), "atualizado_em": carimbo} for a in arquivos]
        lote, tam = [], 0
        enviados = 0
        for ln in linhas + [None]:
            t = len(json.dumps(ln["conteudo"])) if ln else 0
            if ln is None or (lote and tam + t > 900_000):
                if lote:
                    _pedido("POST", f"{url}/rest/v1/dados_equipe?on_conflict=equipe_id,caminho", chave, lote,
                            {"Prefer": "resolution=merge-duplicates,return=minimal"})
                    enviados += len(lote)
                lote, tam = [], 0
            if ln:
                lote.append(ln)
                tam += t
        if not apenas:  # o que não veio nesta exportação (partida que saiu da janela) é apagado
            _pedido("DELETE", f"{url}/rest/v1/dados_equipe?equipe_id=eq.{equipe_id}"
                              f"&atualizado_em=lt.{urllib.parse.quote(carimbo)}", chave, None, {"Prefer": "return=minimal"})
        print(f"Site: {enviados} arquivo(s) enviado(s) ao Supabase (equipe {equipe}).")
        return True
    except urllib.error.HTTPError as e:
        corpo = e.read().decode("utf-8", "replace")[:300]
        dica = " Confira a SUPABASE_SECRET_KEY." if e.code in (401, 403) else ""
        print(f"Site: o Supabase recusou o envio (erro {e.code}).{dica} {corpo}")
    except urllib.error.URLError as e:
        print(f"Site: sem conexão com o Supabase ({e.reason}). Os dados ficam no PC e vão no próximo envio.")
    return False


def exportar_e_publicar(cfg=None):
    """Chamado pelo report diário e pela coleta rápida: exporta e envia para o Supabase.
    O GitHub agora recebe só o código (pelo publicar_site.bat), nunca os dados das partidas."""
    cfg = cfg or gr.ler_json(PASTA / "config.json", {})
    site = cfg.get("site") or {}
    if site.get("ativo", True) is False:
        return False
    return bool(exportar(cfg)) and enviar_supabase(cfg)


if __name__ == "__main__":
    ok = exportar(verificar="--verificar" in sys.argv)
    if ok and ("--publicar" in sys.argv or "--enviar" in sys.argv):
        enviar_supabase()
    if ok and "--publicar" in sys.argv:
        publicar(tudo="--tudo" in sys.argv)
