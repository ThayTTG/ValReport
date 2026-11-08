"""Atributos (notas de estilo de 0 a 100, no jeito da HLTV).

Cada jogador da equipe ganha 7 notas que dizem o que ele costuma fazer, não o quanto ele é bom:
Poder de fogo, Entrada, Troca, Abertura, Fechamento, Sniper e Utilitário.

Como a nota sai:
  1. Para cada estatística, a posição da pessoa (percentil, 0 a 100) entre todos os jogadores dos lobbies
     coletados que jogaram a mesma função (as duas equipes de cada partida; quem jogou várias partidas conta uma vez).
  2. A nota do atributo é a média dessas posições. 50 = o normal para quem joga a mesma função com a gente.
  3. Também sai separado por lado (ataque e defesa). Com menos de 100 rounds na função, vem "amostra pequena".

Uso: py ferramentas\\atributos.py   (mostra as notas da equipe aqui mesmo; o site recebe pelo exportar_site.py)
"""
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import catalogo  # noqa: E402

MIN_ROUNDS_BASE = 8        # para entrar na base de comparação (uma partida curta já conta)
MIN_BASE = 5               # jogadores na base para a nota sair
AMOSTRA_FIRME = 100        # rounds na função para a nota deixar de ser "amostra pequena"
LADOS = ("ambos", "ataque", "defesa")
OPERATOR = {"Operator", "Tour de Force"}

# id, nome, nome HLTV, o que mede, estatísticas: (id, nome, formato, maior_e_mais)
#   formato: "pct" (fração mostrada em %), "n2" (2 casas), "n1" (1 casa), "s" (segundos)
ATRIBUTOS = [
    ("fogo", "Poder de fogo", "Firepower", "Quanto dano e quantos abates a pessoa produz.", [
        ("kpr", "Abates por round", "n2", True),
        ("adr", "Dano por round (ADR)", "n1", True),
        ("r_kill", "Rounds com abate", "pct", True),
        ("r_multi", "Rounds com 2+ abates", "pct", True),
        ("k_vitoria", "Abates por round vencido", "n2", True),
    ]),
    ("entrada", "Entrada", "Entrying", "Quanto a pessoa vai na frente e morre abrindo espaço para o time trocar.", [
        ("trocada_pr", "Mortes trocadas por round", "n2", True),
        ("p_trocada", "Mortes que foram trocadas", "pct", True),
        ("p_fd_trocada", "Primeiras mortes trocadas", "pct", True),
    ]),
    ("troca", "Troca", "Trading", "Quanto a pessoa joga perto do time e pune quem matou um aliado.", [
        ("troca_pr", "Abates de troca por round", "n2", True),
        ("p_troca", "Abates que foram troca", "pct", True),
        ("apr", "Assistências por round", "n2", True),
    ]),
    ("abertura", "Abertura", "Opening", "Quanto a pessoa busca e ganha o primeiro duelo do round.", [
        ("r_duelo", "Rounds com o primeiro duelo", "pct", True),
        ("p_duelo", "Primeiros duelos vencidos", "pct", True),
        ("fkpr", "Primeiros abates por round", "n2", True),
        ("t_duelo", "Tempo até o primeiro duelo", "s", False),
    ]),
    ("fechamento", "Fechamento", "Closing", "Quanto a pessoa fica viva no fim e decide rounds.", [
        ("clutch", "Clutches acima do esperado (a cada 100 rounds)", "n1", True),
        ("vivo", "Rounds vivo no fim", "pct", True),
        ("pos_plant", "Abates depois do plant por round", "n2", True),
    ]),
    ("sniper", "Sniper", "Sniping", "Quanto a pessoa joga de sniper (Operator, Outlaw, Marshal e a Tour de Force).", [
        ("r_sniper", "Rounds com sniper", "pct", True),
        ("k_sniper", "Abates com sniper", "pct", True),
        ("k_op", "Abates com Operator", "pct", True),
    ]),
    ("utilitario", "Utilitário", "Utility", "Quanto a pessoa usa e aproveita as habilidades.", [
        ("util_pr", "Habilidades por round", "n2", True),
        ("ult_partida", "Ultimates por partida", "n1", True),
        ("hab_pr", "Abates com habilidade por round", "n2", True),
        ("apu", "Assistências a cada 10 habilidades", "n1", True),
    ]),
]


def _div(a, b):
    return a / b if b else None


def estatisticas(recs):
    """Os números de cada atributo a partir dos rounds (os registros da avaliacao.analisar_partida_completa)."""
    n = len(recs)
    if not n:
        return None
    soma = lambda f: sum(f(r) for r in recs)  # noqa: E731
    kills = soma(lambda r: r["kills"])
    mortes = soma(lambda r: r["morreu"])
    fd = soma(lambda r: r["first_death"])
    fk = soma(lambda r: r["first_kill"])
    vencidos = soma(lambda r: r["venceu"])
    duelos = [r["tempo_duelo_s"] for r in recs if r.get("tempo_duelo_s") is not None]
    armas = Counter()
    for r in recs:
        armas.update(r["armas_kills"])
    k_sniper = sum(v for k, v in armas.items() if k in catalogo.SNIPERS)
    k_op = sum(v for k, v in armas.items() if k in OPERATOR)
    partidas = len({r["match_id"] for r in recs})
    util = soma(lambda r: r["util"])
    tentados = [r for r in recs if r["clutch_tentado"] and r.get("clutch_esperado") is not None]
    return {
        "rounds": n,
        "kpr": kills / n,
        "adr": soma(lambda r: r["dano"]) / n,
        "r_kill": soma(lambda r: r["kills"] > 0) / n,
        "r_multi": soma(lambda r: r["kills"] >= 2) / n,
        "k_vitoria": _div(soma(lambda r: r["kills"] if r["venceu"] else 0), vencidos),
        "trocada_pr": soma(lambda r: r["trocado"]) / n,
        "p_trocada": _div(soma(lambda r: r["trocado"]), mortes),
        "p_fd_trocada": _div(soma(lambda r: r["first_death"] and r["trocado"]), fd),
        "troca_pr": soma(lambda r: r["trades_feitos"]) / n,
        "p_troca": _div(soma(lambda r: r["trades_feitos"]), kills),
        "apr": soma(lambda r: r["assist"]) / n,
        "r_duelo": (fk + fd) / n,
        "p_duelo": _div(fk, fk + fd),
        "fkpr": fk / n,
        "t_duelo": sum(duelos) / len(duelos) if duelos else None,
        "clutch": 100 * sum((1 if r["clutch_vs"] else 0) - r["clutch_esperado"] for r in tentados) / n,
        "vivo": (n - mortes) / n,
        "pos_plant": soma(lambda r: r.get("kills_pos_plant", 0)) / n,
        "r_sniper": soma(lambda r: r["arma"] in catalogo.SNIPERS) / n,
        "k_sniper": _div(k_sniper, kills),
        "k_op": _div(k_op, kills),
        "util_pr": util / n,
        "ult_partida": soma(lambda r: r["ult"]) / partidas if partidas else None,
        "hab_pr": soma(lambda r: r["kills_hab"]) / n,
        "apu": _div(10 * soma(lambda r: r["assist"]), util),
    }


def _rounds_por(analises):
    """{(puuid, função): {lado: [rounds]}} de todos os jogadores de todas as partidas"""
    por = defaultdict(lambda: {l: [] for l in LADOS})
    for a in analises:
        for pu, j in a["jogadores"].items():
            if not pu:
                continue
            for r in j["rounds"]:
                d = por[(pu, j["funcao"])]
                d["ambos"].append(r)
                if r["lado"] in d:
                    d[r["lado"]].append(r)
    return por


def _percentil(valor, base, maior_e_mais):
    if valor is None:
        return None
    vals = [v for v in base if v is not None]
    if len(vals) < MIN_BASE:
        return None
    abaixo = sum(v < valor for v in vals) if maior_e_mais else sum(v > valor for v in vals)
    # empatar no zero (ex.: nunca jogou de sniper) não é estar "na média": conta como abaixo
    iguais = 0 if (maior_e_mais and valor == 0) else sum(v == valor for v in vals)
    return 100 * (abaixo + 0.5 * iguais) / len(vals)


def _frase(funcao, notas):
    altas = sorted(((v, nome) for nome, v in notas.items() if v is not None and v >= 65), reverse=True)[:2]
    baixas = sorted((v, nome) for nome, v in notas.items() if v is not None and v <= 35)[:1]
    if not altas and not baixas:
        return f"{funcao} equilibrado: nenhuma nota muito acima ou abaixo da média."
    partes = []
    if altas:
        nomes = [n for _, n in altas]
        partes.append(f"{' e '.join(nomes)} {'altas' if len(nomes) > 1 else 'alta'}")
    if baixas:
        partes.append(f"{baixas[0][1]} baixa")
    return f"{funcao}: {', '.join(partes)}."


def calcular(analises, membros, cfg=None):
    """membros = {puuid: slug} da equipe. Devolve o atributos.json do site."""
    analises = list(analises)
    por = _rounds_por(analises)
    stats = {k: {l: estatisticas(rs) for l, rs in lados.items()} for k, lados in por.items()}

    # Base de comparação: cada função, cada lado, só quem tem rounds suficientes
    base = defaultdict(list)
    for (pu, fn), lados in stats.items():
        for l, st in lados.items():
            if st and st["rounds"] >= MIN_ROUNDS_BASE:
                base[(fn, l)].append(st)

    jogadores = {}
    for pu, slug in membros.items():
        funcoes = Counter({fn: len(lados["ambos"]) for (p, fn), lados in por.items() if p == pu})
        if not funcoes:
            continue
        fn, rounds = funcoes.most_common(1)[0]
        partidas = len({r["match_id"] for r in por[(pu, fn)]["ambos"]})
        lados_out = {}
        for l in LADOS:
            st = stats[(pu, fn)][l]
            if not st:
                continue
            grupo = base[(fn, l)]
            notas = {}
            for aid, _, _, _, lista in ATRIBUTOS:
                linhas, pcts = [], []
                for sid, _, _, maior in lista:
                    vals = [g[sid] for g in grupo if g[sid] is not None]
                    pct = _percentil(st[sid], vals, maior)
                    media = sum(vals) / len(vals) if vals else None
                    linhas.append([sid, _r(st[sid]), _r(media), None if pct is None else round(pct)])
                    if pct is not None:
                        pcts.append(pct)
                notas[aid] = {"nota": round(sum(pcts) / len(pcts)) if pcts else None, "stats": linhas}
            lados_out[l] = {"rounds": st["rounds"], "base": len(grupo), "notas": notas}
        amb = lados_out.get("ambos", {}).get("notas", {})
        nomes = {aid: nome for aid, nome, *_ in ATRIBUTOS}
        jogadores[slug] = {
            "funcao": fn, "rounds": rounds, "partidas": partidas, "amostra_pequena": rounds < AMOSTRA_FIRME,
            "outras_funcoes": {f: n for f, n in funcoes.items() if f != fn},
            "frase": _frase(fn, {nomes[a]: v["nota"] for a, v in amb.items()}),
            "lados": lados_out,
        }

    contagem = Counter(fn for (fn, l), g in base.items() if l == "ambos" for _ in g)
    return {
        "versao": 1,
        "regras": {"amostra_firme": AMOSTRA_FIRME, "min_rounds_base": MIN_ROUNDS_BASE, "min_base": MIN_BASE,
                   "partidas": len(analises)},
        "base": dict(contagem),
        "atributos": [{"id": aid, "nome": nome, "hltv": hltv, "desc": desc,
                       "stats": [{"id": sid, "nome": snome, "fmt": fmt, "maior": maior} for sid, snome, fmt, maior in lista]}
                      for aid, nome, hltv, desc, lista in ATRIBUTOS],
        "jogadores": jogadores,
    }


def _r(x):
    return None if x is None else round(x, 4)


def main():
    import gerar_report as gr
    from datetime import datetime
    import avaliacao as av
    cfg = gr.config_padrao(gr.ler_json(Path(__file__).resolve().parent.parent / "config.json", {}))
    cfg_tudo = dict(cfg, janela_dias=3650, janela_referencia_dias=3650)
    ctx = gr.carregar_contexto(datetime.now(av.FUSO_BR).date().isoformat(), cfg_tudo)
    membros = {ctx["puuid_de"][r]: gr.apelido(r, cfg) for r in cfg.get("jogadores", []) if r in ctx["puuid_de"]}
    d = calcular(ctx["analises"].values(), membros, cfg)
    print(f"Atributos: {d['regras']['partidas']} partidas · base por função: {d['base']}\n")
    nomes = [a["nome"] for a in d["atributos"]]
    for quem, j in d["jogadores"].items():
        notas = j["lados"]["ambos"]["notas"]
        linha = " · ".join(f"{n} {notas[a['id']]['nota'] if notas[a['id']]['nota'] is not None else '—'}"
                           for n, a in zip(nomes, d["atributos"]))
        print(f"{quem} ({j['funcao']}, {j['rounds']} rounds{', amostra pequena' if j['amostra_pequena'] else ''})\n  {linha}\n  {j['frase']}\n")


if __name__ == "__main__":
    main()
