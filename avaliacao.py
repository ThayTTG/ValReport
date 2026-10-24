#!/usr/bin/env python3
"""
Motor de avaliação — NokyLabs

Tudo o que é "cálculo" da ferramenta mora aqui. Os outros scripts só coletam e escrevem os reports.

1. IMPACTO (probabilidade de vitória)
   Para cada momento do round calculamos a chance do ataque vencer, a partir de:
     - quantos atacantes e defensores estão vivos,
     - se a spike já foi plantada,
     - a diferença de equipamento entre os times.
   A tabela começa com valores de referência e vai se ajustando sozinha com as partidas
   que a ferramenta guarda (quanto mais dados, mais ela se parece com o seu cenário real).
   Cada abate vale o quanto mudou essa chance. Abrir um 5v5 vale muito; matar o último
   quando o round já estava ganho vale quase nada; o clutch fica valorizado naturalmente.
     - quem matou ganha a variação (75% se houve assistência; os outros 25% vão para quem ajudou)
     - quem morreu perde a variação (metade, se foi trocado pelo time)
     - plant e defuse também geram impacto para quem fez

2. AVALIAÇÃO JUSTA POR FUNÇÃO
   Cada jogador é comparado com jogadores DA MESMA FUNÇÃO nos SEUS PRÓPRIOS lobbies
   (isso já ajusta pelo elo), usando taxas por round, numa janela de dias, com uma amostra
   mínima antes de qualquer veredito e uma margem de confiança calculada por reamostragem.

Só usa a biblioteca padrão do Python.
"""

import math
import random
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

FUSO_BR = timezone(timedelta(hours=-3))

FUNCOES_PADRAO = {
    "Duelista":    ["Jett", "Reyna", "Raze", "Phoenix", "Yoru", "Neon", "Iso", "Waylay"],
    "Iniciador":   ["Sova", "Breach", "Skye", "KAY/O", "Fade", "Gekko", "Tejo"],
    "Controlador": ["Brimstone", "Viper", "Omen", "Astra", "Harbor", "Clove"],
    "Sentinela":   ["Sage", "Cypher", "Killjoy", "Chamber", "Deadlock", "Vyse", "Veto"],
}
FUNCOES = ["Duelista", "Iniciador", "Controlador", "Sentinela", "Outra"]

# Métricas (todas por round). "menor_melhor" inverte o sinal na comparação.
METRICAS = {
    "impacto":       ("Impacto por round (pontos de % de vitória)", False),
    "kpr":           ("Abates por round", False),
    "dpr":           ("Mortes por round", True),
    "apr":           ("Assistências por round", False),
    "fkpr":          ("First kills por round", False),
    "fdpr":          ("First deaths por round", True),
    "kast":          ("KAST", False),
    "adr":           ("Dano por round (ADR)", False),
    "sobrevivencia": ("Sobrevivência", False),
    "trades_pr":     ("Trades feitos por round", False),
    "util_pr":       ("Habilidades usadas por round", False),
    "ult_pr":        ("Ultimates por round", False),
    "kills_hab_pr":  ("Abates com habilidade por round", False),
}

# Pesos de cada métrica no índice, por função (o impacto é o que mais pesa em todas).
PESOS = {
    "Duelista":    {"impacto": 3, "fkpr": 1.5, "fdpr": 1, "kpr": 1, "adr": 1, "kast": 0.5},
    "Iniciador":   {"impacto": 3, "apr": 1.5, "kast": 1, "util_pr": 1, "trades_pr": 0.5, "adr": 0.5},
    "Controlador": {"impacto": 3, "kast": 1.5, "sobrevivencia": 1, "apr": 1, "util_pr": 1},
    "Sentinela":   {"impacto": 3, "kast": 1, "sobrevivencia": 1.5, "fdpr": 1, "trades_pr": 0.5, "adr": 0.5},
    "Outra":       {"impacto": 3, "kast": 1, "kpr": 1, "adr": 1},
}

# Valores de referência (média, desvio por partida) usados enquanto ainda há poucos dados
# dos seus lobbies. Com o tempo, os números reais dos lobbies passam a mandar.
_DESVIOS = {"impacto": 6.0, "kpr": 0.30, "dpr": 0.14, "apr": 0.13, "fkpr": 0.07, "fdpr": 0.07,
            "kast": 0.11, "adr": 50.0, "sobrevivencia": 0.13, "trades_pr": 0.07, "util_pr": 0.9,
            "ult_pr": 0.05, "kills_hab_pr": 0.04}
_MEDIAS = {
    "Outra":       {"impacto": 1.5, "kpr": 0.70, "dpr": 0.70, "apr": 0.27, "fkpr": 0.10, "fdpr": 0.10,
                    "kast": 0.71, "adr": 135, "sobrevivencia": 0.30, "trades_pr": 0.10, "util_pr": 2.3, "ult_pr": 0.08, "kills_hab_pr": 0.02},
    "Duelista":    {"impacto": 1.5, "kpr": 0.80, "dpr": 0.74, "apr": 0.20, "fkpr": 0.15, "fdpr": 0.14,
                    "kast": 0.69, "adr": 150, "sobrevivencia": 0.26, "trades_pr": 0.12, "util_pr": 1.8, "ult_pr": 0.08, "kills_hab_pr": 0.03},
    "Iniciador":   {"impacto": 1.5, "kpr": 0.66, "dpr": 0.68, "apr": 0.36, "fkpr": 0.09, "fdpr": 0.09,
                    "kast": 0.73, "adr": 128, "sobrevivencia": 0.32, "trades_pr": 0.10, "util_pr": 2.6, "ult_pr": 0.08, "kills_hab_pr": 0.02},
    "Controlador": {"impacto": 1.5, "kpr": 0.66, "dpr": 0.68, "apr": 0.30, "fkpr": 0.07, "fdpr": 0.08,
                    "kast": 0.73, "adr": 128, "sobrevivencia": 0.32, "trades_pr": 0.10, "util_pr": 2.5, "ult_pr": 0.07, "kills_hab_pr": 0.01},
    "Sentinela":   {"impacto": 1.5, "kpr": 0.67, "dpr": 0.68, "apr": 0.22, "fkpr": 0.08, "fdpr": 0.09,
                    "kast": 0.71, "adr": 128, "sobrevivencia": 0.32, "trades_pr": 0.09, "util_pr": 2.2, "ult_pr": 0.07, "kills_hab_pr": 0.02},
}


# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------

def g(d, *chaves, padrao=None):
    for c in chaves:
        if isinstance(d, dict):
            d = d.get(c)
        else:
            return padrao
        if d is None:
            return padrao
    return d


def opcoes(cfg):
    cfg = cfg or {}
    lim = cfg.get("limites_economia") or {}
    return {
        "eco": lim.get("eco_abaixo_de", 2000),
        "armado": lim.get("armado_a_partir_de", 3900),
        "janela_trade": cfg.get("janela_trade_ms", 5000),
        "dist_trade": cfg.get("distancia_trade", 1500),
        "dist_isolado": cfg.get("distancia_isolado", 3000),
        "peso_trocada": cfg.get("peso_morte_trocada", 0.5),
        "peso_assist": cfg.get("peso_assistencia", 0.25),
    }


def funcao_do_agente(agente, cfg=None):
    extras = (cfg or {}).get("funcoes_extras") or {}
    if agente in extras:
        return extras[agente]
    for funcao, agentes in FUNCOES_PADRAO.items():
        if agente in agentes:
            return funcao
    return "Outra"


def hora_br(iso):
    try:
        return datetime.fromisoformat((iso or "").replace("Z", "+00:00")).astimezone(FUSO_BR)
    except ValueError:
        return None


def partida_valida(partida):
    """Só partidas 5v5 no modo padrão entram nas análises. Personalizadas em Skirmish, Swift Play,
    Deathmatch etc. ficam de fora (elas distorceriam a avaliação e o modelo de chance de vitória)."""
    modo = (g(partida, "metadata", "queue", "mode_type") or "").lower()
    if modo and modo != "standard":
        return False
    tamanhos = Counter(p.get("team_id") for p in partida.get("players", []) or [])
    return len(tamanhos) == 2 and all(n >= 4 for n in tamanhos.values())


def motivo_invalida(partida):
    modo = g(partida, "metadata", "queue", "mode_type") or "?"
    tamanhos = Counter(p.get("team_id") for p in partida.get("players", []) or [])
    if modo.lower() != "standard":
        return f"modo {modo}"
    return "times incompletos (" + "v".join(str(n) for n in tamanhos.values()) + ")"


def rounds_validos(partida):
    """Rounds 'de verdade' (a API cria rounds vazios do tipo Surrendered quando um time se rende)."""
    return [r for r in partida.get("rounds", []) or [] if (r.get("result") or "") != "Surrendered"]


def times_da_partida(partida):
    return {p["puuid"]: p.get("team_id") for p in partida.get("players", []) if p.get("puuid")}


def _outro(times_ids, t):
    return next((x for x in times_ids if x != t), None)


def lados_dos_rounds(rounds, times_ids):
    """Qual time atacou em cada round. Usa o lado informado pela API; se faltar, deduz pelas metades."""
    atk = {}
    for pos, r in enumerate(rounds):
        rid = r.get("id", pos)
        wt = r.get("winning_team")
        papel = (r.get("winning_team_role") or "").lower()
        if papel == "attacker":
            atk[rid] = wt
        elif papel == "defender":
            atk[rid] = _outro(times_ids, wt)
        elif g(r, "plant", "player", "team"):
            atk[rid] = g(r, "plant", "player", "team")

    def classe(i):  # 1º tempo, 2º tempo e prorrogação alternando
        return 0 if i < 12 else (1 if i < 24 else (i - 24) % 2)

    ref = {}
    for rid, t in atk.items():
        ref.setdefault(classe(rid), t)
    for pos, r in enumerate(rounds):
        rid = r.get("id", pos)
        if rid not in atk:
            c = classe(rid)
            if c in ref:
                atk[rid] = ref[c]
            elif (1 - c) in ref:
                atk[rid] = _outro(times_ids, ref[1 - c])
    return atk


def tipo_de_round(idx, carga_meu, carga_inimigo, op):
    if idx in (0, 12):
        return "pistol"

    def nivel(v):
        if v < op["eco"]:
            return "eco"
        if v < op["armado"]:
            return "force"
        return "armado"

    a, b = nivel(carga_meu), nivel(carga_inimigo)
    return "anti-eco" if (a == "armado" and b == "eco") else a


def _eventos_do_round(r, kills_round):
    evs = [("kill", k.get("time_in_round_in_ms", 0), k) for k in kills_round]
    if r.get("plant"):
        evs.append(("plant", g(r, "plant", "round_time_in_ms", padrao=0), r["plant"]))
    if r.get("defuse"):
        evs.append(("defuse", g(r, "defuse", "round_time_in_ms", padrao=0), r["defuse"]))
    evs.sort(key=lambda e: (e[1], 0 if e[0] == "kill" else 1))
    return evs


def _cargas(r):
    cargas = defaultdict(list)
    for s in r.get("stats", []) or []:
        cargas[g(s, "player", "team")].append(g(s, "economy", "loadout_value", padrao=0) or 0)
    return {t: sum(v) / len(v) for t, v in cargas.items() if v}


# ----------------------------------------------------------------------------
# 1. Modelo de probabilidade de vitória
# ----------------------------------------------------------------------------

class ModeloVitoria:
    """Chance do ATAQUE vencer o round, dado (atacantes vivos, defensores vivos, spike plantada, economia)."""

    def __init__(self, cfg=None):
        cfg = cfg or {}
        self.k = cfg.get("modelo_peso_referencia", 30)        # quanto a tabela de referência pesa
        self.b_econ = cfg.get("modelo_peso_economia", 0.35)   # efeito de cada 1000 de equipamento a mais
        self.contagem = defaultdict(lambda: [0, 0])           # (a, d, plantada) -> [vitórias do ataque, total]
        self.rounds_usados = 0

    @staticmethod
    def referencia(a, d, plantada):
        if d <= 0:
            return 1.0
        if a <= 0:
            return 0.07 if plantada else 0.0
        z = -0.08 + 0.45 * (a - d) + 1.0 * math.log(a / d) + (0.9 if plantada else 0.0)
        return 1 / (1 + math.exp(-z))

    def base(self, a, d, plantada):
        ref = self.referencia(a, d, plantada)
        if ref in (0.0, 1.0):
            return ref
        v, n = self.contagem.get((a, d, plantada), (0, 0))
        return (v + self.k * ref) / (n + self.k)

    def prob(self, a, d, plantada, econ_k=0.0):
        b = self.base(a, d, plantada)
        if b <= 0.0 or b >= 1.0:
            return b
        z = math.log(b / (1 - b)) + self.b_econ * econ_k
        return 1 / (1 + math.exp(-z))

    def ajustar(self, partidas):
        """Aprende com as partidas guardadas: em cada estado do round, quem acabou vencendo."""
        for partida in partidas:
            if not partida_valida(partida):
                continue
            times = times_da_partida(partida)
            ids = sorted(set(t for t in times.values() if t))
            rounds = rounds_validos(partida)
            atacantes = lados_dos_rounds(rounds, ids)
            kills_r = defaultdict(list)
            for k in partida.get("kills", []) or []:
                kills_r[k.get("round")].append(k)
            for pos, r in enumerate(rounds):
                rid = r.get("id", pos)
                atk = atacantes.get(rid)
                defe = _outro(ids, atk)
                if not atk or not defe:
                    continue
                vivos = {t: {p for p, tt in times.items() if tt == t} for t in ids}
                plantada = False
                estados = {(len(vivos[atk]), len(vivos[defe]), False)}
                for tipo, _, ev in _eventos_do_round(r, kills_r.get(rid, [])):
                    if tipo == "kill":
                        v = g(ev, "victim", "puuid")
                        vt = times.get(v)
                        if vt not in vivos:
                            continue
                        vivos[vt].add(v)
                        estados.add((len(vivos[atk]), len(vivos[defe]), plantada))
                        vivos[vt].discard(v)
                    elif tipo == "plant":
                        plantada = True
                    estados.add((len(vivos[atk]), len(vivos[defe]), plantada))
                venceu = 1 if r.get("winning_team") == atk else 0
                for e in estados:
                    c = self.contagem[e]
                    c[0] += venceu
                    c[1] += 1
                self.rounds_usados += 1
        return self


# ----------------------------------------------------------------------------
# Análise completa de uma partida (os 10 jogadores, round a round)
# ----------------------------------------------------------------------------

def analisar_partida_completa(partida, modelo=None, cfg=None):
    op = opcoes(cfg)
    md = partida.get("metadata", {}) or {}
    times = times_da_partida(partida)
    ids = sorted(set(t for t in times.values() if t))
    rounds = rounds_validos(partida)
    atacantes = lados_dos_rounds(rounds, ids)
    info_times = {t.get("team_id"): t for t in partida.get("teams", []) or []}

    kills_r = defaultdict(list)
    for k in partida.get("kills", []) or []:
        kills_r[k.get("round")].append(k)
    for lst in kills_r.values():
        lst.sort(key=lambda k: k.get("time_in_round_in_ms", 0))

    jogadores = {}
    for p in partida.get("players", []) or []:
        pu = p.get("puuid")
        meu, rival = info_times.get(p.get("team_id"), {}), info_times.get(_outro(ids, p.get("team_id")), {})
        vm, vr = g(meu, "rounds", "won", padrao=0), g(rival, "rounds", "won", padrao=0)
        casts = p.get("ability_casts") or {}
        agente = g(p, "agent", "name") or "?"
        jogadores[pu] = {
            "puuid": pu,
            "nome": p.get("name", ""),
            "tag": p.get("tag", ""),
            "riot_id": f"{p.get('name', '')}#{p.get('tag', '')}",
            "time": p.get("team_id"),
            "agente": agente,
            "funcao": funcao_do_agente(agente, cfg),
            "elo": g(p, "tier", "name") or "Sem rank",
            "party_id": p.get("party_id"),
            "stats": p.get("stats") or {},
            "util_total": sum((casts.get(c) or 0) for c in ("grenade", "ability1", "ability2")),
            "ult_total": casts.get("ultimate") or 0,
            "resultado": "vitória" if meu.get("won") else ("empate" if vm == vr else "derrota"),
            "placar": f"{vm}-{vr}",
            "rounds": [],
            "rounds_afk": 0,
        }

    for pos, r in enumerate(rounds):
        rid = r.get("id", pos)
        atk = atacantes.get(rid)
        defe = _outro(ids, atk) if atk else None
        cargas = _cargas(r)
        econ_k = ((cargas.get(atk, 0) - cargas.get(defe, 0)) / 1000) if atk and defe else 0.0
        ks = kills_r.get(rid, [])
        stats_por = {g(s, "player", "puuid"): s for s in r.get("stats", []) or []}

        # Trades: para cada abate, ele foi "vingado" pelo time da vítima dentro da janela?
        trocado_idx, trade_feito_idx = set(), set()
        for i, k in enumerate(ks):
            assassino, vt = g(k, "killer", "puuid"), times.get(g(k, "victim", "puuid"))
            t = k.get("time_in_round_in_ms", 0)
            for j in range(i + 1, len(ks)):
                k2 = ks[j]
                if k2.get("time_in_round_in_ms", 0) - t > op["janela_trade"]:
                    break
                if g(k2, "victim", "puuid") == assassino and times.get(g(k2, "killer", "puuid")) == vt:
                    trocado_idx.add(i)
                    trade_feito_idx.add(j)
                    break

        vivos = {t: {p for p, tt in times.items() if tt == t} for t in ids}
        plantada = False
        credito, credito_solo = defaultdict(float), defaultdict(float)
        por = defaultdict(lambda: {"kills": 0, "armas": Counter(), "assist": 0, "trades": 0, "morte": None,
                                   "kills_solo": 0, "kills_hab": 0, "plant": False, "defuse": False})
        ultimo_vivo = {}
        idx_kill = {id(k): i for i, k in enumerate(ks)}

        def prob_atk(a, d, pl):
            return modelo.prob(a, d, pl, econ_k) if modelo else 0.5

        for tipo, t, ev in _eventos_do_round(r, ks):
            if tipo == "kill":
                i = idx_kill[id(ev)]
                kpu, v = g(ev, "killer", "puuid"), g(ev, "victim", "puuid")
                kt, vt = times.get(kpu), times.get(v)
                if vt not in vivos:
                    continue
                vivos[vt].add(v)  # se foi revivido, volta a contar antes de morrer de novo
                a0, d0 = len(vivos[atk]) if atk else 0, len(vivos[defe]) if defe else 0
                vivos[vt].discard(v)
                a1, d1 = len(vivos[atk]) if atk else 0, len(vivos[defe]) if defe else 0

                # Posições no instante do abate
                locs = {g(pl, "player", "puuid"): g(pl, "location") for pl in ev.get("player_locations") or []}
                loc_v = ev.get("location")

                def mais_proximo(origem, time_alvo, excluir):
                    if not origem or "x" not in origem:
                        return None
                    ds = [math.dist((origem["x"], origem["y"]), (l["x"], l["y"]))
                          for pu, l in locs.items()
                          if l and pu != excluir and times.get(pu) == time_alvo and pu in vivos.get(time_alvo, ())]
                    return min(ds) if ds else None

                dist_v = mais_proximo(loc_v, vt, v)
                dist_k = mais_proximo(locs.get(kpu), kt, kpu)
                trocado = i in trocado_idx

                delta = 0.0
                if modelo and atk:
                    d_atk = prob_atk(a1, d1, plantada) - prob_atk(a0, d0, plantada)
                    if kt == vt:  # abate no próprio time
                        credito[kpu] += d_atk if kt == atk else -d_atk
                    elif kt in ids:
                        delta = d_atk if kt == atk else -d_atk
                        ajudantes = [g(a, "puuid") for a in ev.get("assistants") or []
                                     if times.get(g(a, "puuid")) == kt and g(a, "puuid") != kpu]
                        parte = op["peso_assist"] if ajudantes else 0.0
                        credito[kpu] += delta * (1 - parte)
                        for a in ajudantes:
                            credito[a] += delta * parte / len(ajudantes)
                        perda = delta * (op["peso_trocada"] if trocado else 1.0)
                        credito[v] -= perda
                        if dist_k is not None and dist_k > op["dist_isolado"]:
                            credito_solo[kpu] += delta * (1 - parte)
                        if dist_v is not None and dist_v > op["dist_isolado"]:
                            credito_solo[v] -= perda

                if kt != vt and kpu in jogadores:
                    por[kpu]["kills"] += 1
                    por[kpu]["armas"][g(ev, "weapon", "name") or "Habilidade"] += 1
                    if (g(ev, "weapon", "type") or "") == "Ability":
                        por[kpu]["kills_hab"] += 1
                    if i in trade_feito_idx:
                        por[kpu]["trades"] += 1
                    if dist_k is not None and dist_k > op["dist_isolado"]:
                        por[kpu]["kills_solo"] += 1
                for a in ev.get("assistants") or []:
                    if g(a, "puuid") in jogadores:
                        por[g(a, "puuid")]["assist"] += 1
                if v in jogadores and por[v]["morte"] is None:
                    por[v]["morte"] = {
                        "tempo_s": round(t / 1000),
                        "local": loc_v,
                        "trocado": trocado,
                        "dist_aliado": dist_v,
                        "arma_inimiga": g(ev, "weapon", "name"),
                    }

                for time_ in ids:
                    if len(vivos[time_]) == 1 and time_ not in ultimo_vivo:
                        rival = _outro(ids, time_)
                        if rival and vivos.get(rival):
                            p_atk = prob_atk(len(vivos[atk]), len(vivos[defe]), plantada) if (modelo and atk) else None
                            p_time = None if p_atk is None else (p_atk if time_ == atk else 1 - p_atk)
                            ultimo_vivo[time_] = (next(iter(vivos[time_])), len(vivos[rival]), p_time)

            elif tipo == "plant":
                quem = g(ev, "player", "puuid")
                if modelo and atk:
                    a, d = len(vivos[atk]), len(vivos[defe])
                    credito[quem] += prob_atk(a, d, True) - prob_atk(a, d, False)
                plantada = True
                if quem in jogadores:
                    por[quem]["plant"] = True

            elif tipo == "defuse":
                quem = g(ev, "player", "puuid")
                if modelo and atk:
                    credito[quem] += prob_atk(len(vivos[atk]), len(vivos[defe]), plantada)
                if quem in jogadores:
                    por[quem]["defuse"] = True

        vencedor = r.get("winning_team")
        primeiro = ks[0] if ks else None
        for pu, j in jogadores.items():
            s = stats_por.get(pu)
            if s is None:
                continue
            if s.get("was_afk"):
                j["rounds_afk"] += 1
                continue
            meu_time = j["time"]
            x = por[pu]
            morte = x["morte"]
            clutch = clutch_tentado = 0
            clutch_esperado = None
            if meu_time in ultimo_vivo and ultimo_vivo[meu_time][0] == pu:
                clutch_tentado, clutch_esperado = ultimo_vivo[meu_time][1], ultimo_vivo[meu_time][2]
                if vencedor == meu_time:
                    clutch = clutch_tentado
            dano = sum((d.get("damage") or 0) for d in s.get("damage_events") or [])
            kast = bool(x["kills"] or x["assist"] or morte is None or (morte and morte["trocado"]))
            dist = morte["dist_aliado"] if morte else None
            j["rounds"].append({
                "match_id": md.get("match_id"),
                "n": rid + 1,
                "lado": "ataque" if meu_time == atk else "defesa",
                "tipo": tipo_de_round(rid, cargas.get(meu_time, 0), cargas.get(_outro(ids, meu_time), 0), op),
                "venceu": vencedor == meu_time,
                "kills": x["kills"],
                "armas_kills": x["armas"],
                "assist": x["assist"],
                "trades_feitos": x["trades"],
                "morreu": morte is not None,
                "trocado": bool(morte and morte["trocado"]),
                "tempo_morte_s": morte["tempo_s"] if morte else None,
                "local_morte": morte["local"] if morte else None,
                "dist_aliado_morte": dist,
                "morte_fora_trade": dist is not None and dist > op["dist_trade"],
                "morte_isolada": dist is not None and dist > op["dist_isolado"],
                "kills_solo": x["kills_solo"],
                "kills_hab": x["kills_hab"],
                "first_kill": bool(primeiro) and g(primeiro, "killer", "puuid") == pu,
                "first_death": bool(primeiro) and g(primeiro, "victim", "puuid") == pu,
                "clutch_vs": clutch,
                "clutch_tentado": clutch_tentado,
                "clutch_esperado": clutch_esperado,
                "plant": x["plant"],
                "defuse": x["defuse"],
                "dano": dano,
                "kast": kast,
                "wpa": credito.get(pu, 0.0),
                "wpa_solo": credito_solo.get(pu, 0.0),
                "carga": g(s, "economy", "loadout_value", padrao=0) or 0,
                "arma": g(s, "economy", "weapon", "name") or "Sem arma",
                "util": 0.0,  # preenchido abaixo (a API só informa o total da partida)
                "ult": 0.0,
            })

    for j in jogadores.values():
        # A API às vezes duplica eventos de dano de quem reconectou: ajusta para bater com o total oficial
        dealt = g(j["stats"], "damage", "dealt", padrao=0) or 0
        soma_ev = sum(r["dano"] for r in j["rounds"])
        if dealt and soma_ev and abs(soma_ev - dealt) / dealt > 0.05:
            fator = dealt / soma_ev
            for r in j["rounds"]:
                r["dano"] = round(r["dano"] * fator)
        n = len(j["rounds"])
        util_pr = j["util_total"] / n if n else 0.0
        ult_pr = j["ult_total"] / n if n else 0.0
        for rec in j["rounds"]:
            rec["util"] = util_pr
            rec["ult"] = ult_pr
            rec["funcao"] = j["funcao"]
            rec["agente"] = j["agente"]

    return {
        "match_id": md.get("match_id"),
        "mapa": g(md, "map", "name") or "?",
        "fila": g(md, "queue", "name") or g(md, "queue", "id") or "?",
        "fila_id": (g(md, "queue", "id") or "").lower(),
        "inicio": hora_br(md.get("started_at")),
        "inicio_iso": md.get("started_at"),
        "n_rounds": len(rounds),
        "jogadores": jogadores,
    }


def localizar(analise, riot_id):
    nome, _, tag = riot_id.partition("#")
    for j in analise["jogadores"].values():
        if (j["nome"].lower(), j["tag"].lower()) == (nome.lower(), tag.lower()):
            return j
    return None


# ----------------------------------------------------------------------------
# Resumo simples de uma partida (usado no histórico CSV e no resumo do coletor)
# ----------------------------------------------------------------------------

def resumo_basico(analise, j):
    st = j["stats"]
    recs = j["rounds"]
    n_val = analise["n_rounds"] or 1
    hs, bs, ls = st.get("headshots", 0), st.get("bodyshots", 0), st.get("legshots", 0)
    armas = Counter()
    for r in recs:
        armas.update(r["armas_kills"])
    por_tipo = {}
    for tipo in ("pistol", "eco", "force", "armado", "anti-eco"):
        rs = [r for r in recs if r["tipo"] == tipo]
        if not rs:
            continue
        k, m = sum(r["kills"] for r in rs), sum(r["morreu"] for r in rs)
        por_tipo[tipo] = {
            "rounds": len(rs),
            "vitorias": sum(r["venceu"] for r in rs),
            "winrate_pct": round(100 * sum(r["venceu"] for r in rs) / len(rs), 1),
            "kills": k,
            "mortes": m,
            "kd": round(k / m, 2) if m else float(k),
            "adr": round(sum(r["dano"] for r in rs) / len(rs), 1),
            "impacto": round(100 * sum(r["wpa"] for r in rs) / len(rs), 1),
            "armas_mais_usadas": dict(Counter(r["arma"] for r in rs).most_common(3)),
        }
    return {
        "match_id": analise["match_id"],
        "inicio": analise["inicio_iso"],
        "mapa": analise["mapa"],
        "fila": analise["fila"],
        "agente": j["agente"],
        "funcao": j["funcao"],
        "resultado": j["resultado"],
        "placar": j["placar"],
        "rounds": analise["n_rounds"],
        "rounds_afk": j["rounds_afk"],
        "kills": st.get("kills", 0),
        "mortes": st.get("deaths", 0),
        "assistencias": st.get("assists", 0),
        "kd": round(st.get("kills", 0) / st.get("deaths", 1), 2) if st.get("deaths") else float(st.get("kills", 0)),
        "acs": round(st.get("score", 0) / n_val, 1),
        "adr": round(g(st, "damage", "dealt", padrao=0) / n_val, 1),
        "hs_pct": round(100 * hs / (hs + bs + ls), 1) if (hs + bs + ls) else 0.0,
        "kast_pct": round(100 * sum(r["kast"] for r in recs) / len(recs), 1) if recs else 0.0,
        "first_kills": sum(r["first_kill"] for r in recs),
        "first_deaths": sum(r["first_death"] for r in recs),
        "trades_feitos": sum(r["trades_feitos"] for r in recs),
        "impacto_total": round(sum(r["wpa"] for r in recs), 2),
        "loadout_medio": round(sum(r["carga"] for r in recs) / len(recs)) if recs else 0,
        "armas_kills": dict(armas.most_common()),
        "habilidades_usadas": {"utilitario": j["util_total"], "ultimate": j["ult_total"]},
        "por_tipo_de_round": por_tipo,
    }


# ----------------------------------------------------------------------------
# 2. Avaliação justa por função
# ----------------------------------------------------------------------------

def metricas(recs):
    n = len(recs)
    if not n:
        return None
    soma = lambda c: sum(r[c] for r in recs)
    return {
        "rounds": n,
        "impacto": 100 * soma("wpa") / n,
        "kpr": soma("kills") / n,
        "dpr": sum(r["morreu"] for r in recs) / n,
        "apr": soma("assist") / n,
        "fkpr": sum(r["first_kill"] for r in recs) / n,
        "fdpr": sum(r["first_death"] for r in recs) / n,
        "kast": sum(r["kast"] for r in recs) / n,
        "adr": soma("dano") / n,
        "sobrevivencia": sum(not r["morreu"] for r in recs) / n,
        "trades_pr": soma("trades_feitos") / n,
        "util_pr": soma("util") / n,
        "ult_pr": soma("ult") / n,
        "kills_hab_pr": soma("kills_hab") / n,
    }


def calcular_referencias(analises, puuids_equipe, cfg=None):
    """Média e desvio de cada métrica, por função, entre os OUTROS jogadores dos seus lobbies."""
    cfg = cfg or {}
    k_ref = cfg.get("referencia_peso_padrao", 8)
    amostras = defaultdict(list)
    for a in analises:
        for pu, j in a["jogadores"].items():
            if pu in puuids_equipe or len(j["rounds"]) < 8:
                continue
            m = metricas(j["rounds"])
            amostras[j["funcao"]].append(m)
            amostras["Outra"].append(m)

    refs = {}
    for funcao in FUNCOES:
        lst = amostras.get(funcao, [])
        n = len(lst)
        peso_total = sum(m["rounds"] for m in lst)
        refs[funcao] = {"_amostras": n}
        for met in METRICAS:
            mu0, sd0 = _MEDIAS[funcao][met], _DESVIOS[met]
            if n:
                media = sum(m[met] * m["rounds"] for m in lst) / peso_total
                var = sum(m["rounds"] * (m[met] - media) ** 2 for m in lst) / peso_total
            else:
                media, var = mu0, sd0 ** 2
            mu = (n * media + k_ref * mu0) / (n + k_ref)
            sd = math.sqrt((n * var + k_ref * sd0 ** 2) / (n + k_ref))
            refs[funcao][met] = (mu, max(sd, 1e-6))
    return refs


def indice(m, ref, funcao):
    """Índice 0-100: 50 = média da função nos seus lobbies. Também devolve a contribuição de cada métrica."""
    pesos = PESOS.get(funcao, PESOS["Outra"])
    total = sum(pesos.values())
    z_total, contrib = 0.0, {}
    for met, w in pesos.items():
        mu, sd = ref[met]
        z = (m[met] - mu) / sd
        if METRICAS[met][1]:
            z = -z
        contrib[met] = z
        z_total += w * z
    z_total /= total
    return max(0.0, min(100.0, 50 + 20 * z_total)), contrib


def avaliar(recs, ref, funcao, cfg=None):
    cfg = cfg or {}
    minimo = cfg.get("amostra_minima_rounds", 100)
    m = metricas(recs)
    if not m:
        return None
    valor, contrib = indice(m, ref, funcao)

    # Margem de confiança: reamostra os rounds várias vezes e vê quanto o índice varia
    rng = random.Random(1178)
    n = len(recs)
    sims = sorted(indice(metricas([recs[rng.randrange(n)] for _ in range(n)]), ref, funcao)[0]
                  for _ in range(cfg.get("reamostragens", 300)))
    lo, hi = sims[int(0.05 * len(sims))], sims[int(0.95 * len(sims)) - 1]

    if n < minimo:
        veredito = ("⏳", f"dados insuficientes ({n}/{minimo} rounds)")
    elif lo > 50:
        veredito = ("📈", "acima da média da função")
    elif hi < 50:
        veredito = ("📉", "abaixo da média da função")
    else:
        veredito = ("➖", "na média da função (dentro da margem)")
    return {
        "funcao": funcao,
        "rounds": n,
        "partidas": len({r["match_id"] for r in recs}),
        "indice": round(valor),
        "margem": (round(lo), round(hi)),
        "veredito": veredito,
        "metricas": m,
        "contrib": contrib,
        "referencia": ref,
    }


def jogadas_solo(recs):
    """Separa agressão útil de agressão isolada: jogadas a mais de 'distancia_isolado' do aliado mais próximo."""
    ks = sum(r["kills_solo"] for r in recs)
    ms = sum(r["morte_isolada"] for r in recs)
    return {"kills": ks, "mortes": ms, "impacto": 100 * sum(r["wpa_solo"] for r in recs)}


def uso_do_kit(recs, ref):
    """Uso de habilidades comparado com a média da função no lobby.
    A API só informa o total de habilidades da partida (não quando nem onde), então medimos quantidade,
    assistências geradas por habilidade e abates feitos com habilidade."""
    m = metricas(recs)
    if not m:
        return None
    util, util_ref = m["util_pr"], ref["util_pr"][0]
    apu = 10 * m["apr"] / util if util else 0.0
    apu_ref = 10 * ref["apr"][0] / util_ref if util_ref else 0.0
    return {
        "util_pr": util, "util_ref": util_ref, "util_rel": util / util_ref if util_ref else 1.0,
        "ult_partida": m["ult_pr"] * 24, "ult_ref_partida": ref["ult_pr"][0] * 24,
        "assist_por_10": apu, "assist_por_10_ref": apu_ref,
        "kills_hab": sum(r["kills_hab"] for r in recs),
    }


def clutches(recs):
    """Clutches vencidos x tentados, comparado com o que seria normal vencer naquelas situações."""
    tent = [r for r in recs if r["clutch_tentado"]]
    if not tent:
        return None
    esperado = sum(r["clutch_esperado"] or 0 for r in tent)
    return {"tentados": len(tent), "vencidos": sum(1 for r in tent if r["clutch_vs"]),
            "esperado": round(esperado, 1),
            "por_situacao": Counter(f"1v{r['clutch_tentado']}" for r in tent)}


def distancia_de_trade(recs):
    mortes = [r for r in recs if r["morreu"] and r["dist_aliado_morte"] is not None]
    if not mortes:
        return None
    ds = sorted(r["dist_aliado_morte"] for r in mortes)
    return {
        "mortes": len(mortes),
        "mediana_m": round(ds[len(ds) // 2] / 100),
        "em_alcance_pct": round(100 * sum(not r["morte_fora_trade"] for r in mortes) / len(mortes)),
        "trocadas_pct": round(100 * sum(r["trocado"] for r in mortes) / len(mortes)),
        "isoladas": sum(r["morte_isolada"] for r in mortes),
    }
