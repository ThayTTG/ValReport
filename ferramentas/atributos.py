"""Atributos (notas de estilo de 0 a 100, no jeito da HLTV).

Cada jogador da equipe ganha 7 notas que dizem o que ele costuma fazer, não o quanto ele é bom:
Poder de fogo, Entrada, Troca, Abertura, Fechamento, Sniper e Utilitário.

Como a nota sai:
  1. Para cada estatística, a posição da pessoa (percentil, 0 a 100) entre todos os jogadores dos lobbies
     coletados que jogaram a mesma função (as duas equipes de cada partida; quem jogou várias partidas conta uma vez).
  2. A nota do atributo é a média dessas posições. 50 = o normal para quem joga a mesma função com a gente.
  3. Também sai separado por lado (ataque e defesa). Com menos de 100 rounds na função, vem "amostra pequena".
  4. Estatísticas raras (sniper, abates com habilidade) têm um mínimo: abaixo dele, a posição cai na proporção.
     Sem isso, quem comprou uma Marshal num eco passava na frente de todos os que têm zero.
  5. Um texto por regras (sempre) e, no report das 21h na nuvem, um resumo por IA (GitHub Models) por cima dele.

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
# Mínimo para uma estatística rara contar de verdade. Abaixo dele, posição × (valor / mínimo).
PISOS = {
    "r_sniper": 0.05,   # 5% dos rounds com sniper
    "k_sniper": 0.05,   # 5% dos abates com sniper
    "k_op": 0.05,       # 5% dos abates com Operator
    "hab_pr": 0.03,     # 1 abate com habilidade a cada ~33 rounds
}
DIF_LADO = 15            # diferença entre ataque e defesa que vale citar no texto
MIN_ROUNDS_LADO = 20     # rounds em cada lado para comparar os dois

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


# ----------------------------------------------------------------------------
# Texto por regras (sempre presente, sem custo)
# ----------------------------------------------------------------------------

def _fmt(v, fmt):
    if v is None:
        return "—"
    if fmt == "pct":
        return f"{round(v * 100)}%"
    if fmt == "s":
        return f"{v:.1f}".replace(".", ",") + " s"
    return (f"{v:.2f}" if fmt == "n2" else f"{v:.1f}").replace(".", ",")


_FMT = {sid: fmt for *_, lista in ATRIBUTOS for sid, _, fmt, _ in lista}
_NOME = {aid: nome for aid, nome, *_ in ATRIBUTOS}

# Uma frase para nota alta e outra para nota baixa. {x} = valor da pessoa, {x_m} = média da função.
# Sniper baixo não vira frase: quase todo mundo fora da função de sniper tem nota baixa ali.
_FRASES = {
    "fogo": ("Produz bastante dano: {adr} de dano por round, contra {adr_m} de quem joga a mesma função, e abate em {r_kill} dos rounds.",
             "Produz menos dano que o normal da função ({adr} por round, média {adr_m}): o peso no jogo vem de outro lugar."),
    "entrada": ("Costuma ir na frente e morrer abrindo espaço: {p_trocada} das mortes são trocadas pelo time (média {p_trocada_m}).",
                "Raramente morre abrindo espaço para o time: só {p_trocada} das mortes são trocadas (média {p_trocada_m})."),
    "troca": ("Joga perto do time e pune rápido: {p_troca} dos abates são troca (média {p_troca_m}).",
              "Poucos abates vêm de troca ({p_troca}, média {p_troca_m}): costuma jogar mais longe do time."),
    "abertura": ("Busca o primeiro duelo do round: está nele em {r_duelo} dos rounds (média {r_duelo_m}) e vence {p_duelo} deles.",
                 "Evita o primeiro duelo do round: está nele em só {r_duelo} dos rounds (média {r_duelo_m})."),
    "fechamento": ("Costuma decidir o fim do round: termina {vivo} dos rounds com vida (média {vivo_m}) e faz {pos_plant} abates depois do plant por round.",
                   "Raramente está de pé no fim do round: termina {vivo} dos rounds com vida (média {vivo_m})."),
    "sniper": ("Usa bastante sniper: tem uma na mão em {r_sniper} dos rounds e faz {k_sniper} dos abates com ela.", None),
    "utilitario": ("Usa muito as habilidades: {util_pr} por round (média {util_pr_m}).",
                   "Usa menos as habilidades que o normal da função: {util_pr} por round (média {util_pr_m})."),
}


# A estatística que cada frase usa: se ela é igual à média (ex.: 0% × 0%), a frase não diz nada e fica de fora
_CHAVE = {"fogo": "adr", "entrada": "p_trocada", "troca": "p_troca", "abertura": "r_duelo", "fechamento": "vivo",
          "sniper": "r_sniper", "utilitario": "util_pr"}


def _valores(notas):
    out = {}
    for d in notas.values():
        for sid, v, media, *_ in d["stats"]:
            out[sid], out[f"{sid}_m"] = _fmt(v, _FMT[sid]), _fmt(media, _FMT[sid])
    return out


def texto_regras(j):
    """Um parágrafo sobre o jeito de jogar, montado só com as notas e as estatísticas (os dois lados juntos)."""
    amb = j["lados"].get("ambos")
    if not amb:
        return ""
    fn, notas = j["funcao"], amb["notas"]
    vals = _valores(notas)
    com_nota = [(d["nota"], aid) for aid, d in notas.items() if d["nota"] is not None]
    altas = sorted([x for x in com_nota if x[0] >= 65], reverse=True)[:3]
    baixas = sorted(x for x in com_nota if x[0] <= 35 and _FRASES[x[1]][1])[:2]
    partes = []
    if altas:
        nomes = [_NOME[a].lower() for _, a in altas]
        lista = nomes[0] if len(nomes) == 1 else f"{', '.join(nomes[:-1])} e {nomes[-1]}"
        partes.append(f"Como {fn}, tem um jeito puxado para {lista}.")
    else:
        partes.append(f"Como {fn}, tem um jeito equilibrado: nenhuma nota fica muito acima do normal da função.")
    diz_algo = lambda a: vals.get(_CHAVE[a]) != vals.get(f"{_CHAVE[a]}_m")  # noqa: E731
    partes += [_FRASES[a][0].format(**vals) for _, a in altas if diz_algo(a)]
    partes += [_FRASES[a][1].format(**vals) for _, a in baixas if diz_algo(a)]

    # Ataque × defesa: só quando a diferença é grande e os dois lados têm rounds para comparar
    at, de = j["lados"].get("ataque"), j["lados"].get("defesa")
    if at and de and at["rounds"] >= MIN_ROUNDS_LADO and de["rounds"] >= MIN_ROUNDS_LADO:
        difs = []
        for aid in notas:
            na, nd = at["notas"][aid]["nota"], de["notas"][aid]["nota"]
            # Só conta se um lado chega a 50 e a nota geral não é baixa: Sniper 0 × 23, ou um round de Marshal
            # caindo todo num lado, não é um jeito diferente de jogar
            geral = notas[aid]["nota"]
            if (na is not None and nd is not None and abs(na - nd) >= DIF_LADO and max(na, nd) >= 50
                    and geral is not None and geral > 35):
                difs.append((abs(na - nd), aid, na, nd))
        for _, aid, na, nd in sorted(difs, reverse=True)[:2]:
            lado, outro = ("no ataque", "na defesa") if na > nd else ("na defesa", "no ataque")
            partes.append(f"A nota de {_NOME[aid]} sobe {lado}: {max(na, nd)}, contra {min(na, nd)} {outro}.")
    if j["amostra_pequena"]:
        partes.append(f"Ainda são só {j['rounds']} rounds na função, então esse retrato pode mudar bastante.")
    return " ".join(partes)


# ----------------------------------------------------------------------------
# Resumo por IA (GitHub Models, só no report das 21h na nuvem)
# ----------------------------------------------------------------------------
# - Vai só número e nota: nada de nome, apelido, Riot ID ou puuid ("o jogador").
# - Roda só para quem teve partida nova desde o último resumo; o texto fica em dados/cache/resumos_ia.json
#   (a pasta dados vai para o espaço privado da nuvem) e entra no atributos.json com a data.
# - Se falhar, nada quebra: o site mostra o texto por regras (e o resumo anterior, com a data dele, se houver).
# - O log da nuvem é público: aqui só se imprimem contagens.

URL_MODELOS = "https://models.github.ai/inference/chat/completions"
MODELOS = ("openai/gpt-4.1-mini", "openai/gpt-4o-mini")
MAX_CARACTERES = 700

INSTRUCAO = (
    "Você escreve um resumo curto sobre o jeito de jogar de uma pessoa no Valorant, em português do Brasil, "
    "para a própria equipe ler. Use só os dados enviados. Regras:\n"
    "- 3 ou 4 frases, no máximo 90 palavras, num parágrafo só, sem títulos nem listas.\n"
    "- As notas vão de 0 a 100 e dizem o que a pessoa costuma fazer, não o quanto ela é boa. "
    "50 é o normal de quem joga a mesma função nesses lobbies; 65 ou mais é alto; 35 ou menos é baixo.\n"
    "- Não afirme nada que não esteja nos números: nada de agentes, mapas, posições, jogadas, mira ou comunicação.\n"
    "- Não dê conselhos nem diga se é bom ou ruim. Não cite nomes. Evite marcar gênero (prefira 'joga', 'costuma').\n"
    "- Cite ataque e defesa só se a diferença numa nota for de 15 pontos ou mais.\n"
    "- Se a amostra for pequena, diga que o retrato ainda pode mudar."
)


def dados_para_ia(j, atributos_def):
    """O que vai para a IA: só função, contagens, notas e estatísticas (com a média da função)."""
    def bloco(lado):
        L = j["lados"].get(lado)
        if not L:
            return None
        out = {"rounds": L["rounds"], "notas": {}}
        for a in atributos_def:
            d = L["notas"][a["id"]]
            if lado != "ambos":        # nos lados, só a nota
                out["notas"][a["nome"]] = d["nota"]
                continue
            nomes = {s["id"]: s["nome"] for s in a["stats"]}
            out["notas"][a["nome"]] = {
                "nota": d["nota"],
                "estatisticas": {nomes[sid]: {"valor": _fmt(v, _FMT[sid]), "media_da_funcao": _fmt(m, _FMT[sid])}
                                 for sid, v, m, *_ in d["stats"]},
            }
        return out
    return {
        "quem": "o jogador",
        "funcao": j["funcao"], "partidas": j["partidas"], "rounds": j["rounds"],
        "amostra_pequena": j["amostra_pequena"],
        "os_dois_lados": bloco("ambos"), "ataque": bloco("ataque"), "defesa": bloco("defesa"),
    }


def _chamar_modelo(dados, token, timeout=60):
    import json
    import urllib.request
    ultimo = None
    for modelo in MODELOS:
        corpo = {"model": modelo, "temperature": 0.3, "max_tokens": 300,
                 "messages": [{"role": "system", "content": INSTRUCAO},
                              {"role": "user", "content": json.dumps(dados, ensure_ascii=False)}]}
        req = urllib.request.Request(URL_MODELOS, data=json.dumps(corpo).encode("utf-8"), method="POST", headers={
            "Authorization": f"Bearer {token}", "Content-Type": "application/json", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                resp = json.loads(r.read().decode("utf-8"))
            texto = _limpar(resp["choices"][0]["message"]["content"])
            if texto:
                return texto, modelo
        except Exception as e:  # noqa: BLE001 — qualquer falha cai no texto por regras
            ultimo = e
    raise RuntimeError(type(ultimo).__name__ if ultimo else "resposta vazia")


def _limpar(texto):
    import re
    t = re.sub(r"\s+", " ", (texto or "").replace("*", "").replace("#", "")).strip().strip('"').strip()
    if not t or "http" in t.lower() or len(t) > MAX_CARACTERES:
        return None
    return t


def chave_resumo(j):
    """Muda quando entra partida nova (aí o resumo é refeito)."""
    return f"{j['partidas']}-{j['rounds']}"


def aplicar_resumos(d, caminho_cache, gerar=False, token=None, chamar=None, hoje=None):
    """Põe em cada jogador o resumo por IA guardado e, com gerar=True, refaz o de quem teve partida nova.
    Devolve (gerados, falhas)."""
    import json
    from datetime import date
    caminho_cache = Path(caminho_cache)
    try:
        cache = json.loads(caminho_cache.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    chamar = chamar or _chamar_modelo
    hoje = hoje or date.today().isoformat()
    gerados = falhas = 0
    if gerar and token:
        for slug, j in d["jogadores"].items():
            antigo = cache.get(slug) or {}
            if antigo.get("chave") == chave_resumo(j):
                continue
            try:
                texto, modelo = chamar(dados_para_ia(j, d["atributos"]), token)
                cache[slug] = {"chave": chave_resumo(j), "texto": texto, "data": hoje, "modelo": modelo}
                gerados += 1
            except Exception:  # noqa: BLE001
                falhas += 1
        if gerados:
            caminho_cache.parent.mkdir(parents=True, exist_ok=True)
            caminho_cache.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Resumo por IA: {gerados} gerado(s), {falhas} falha(s), {len(d['jogadores']) - gerados - falhas} sem partida nova.")
    for slug, j in d["jogadores"].items():
        c = cache.get(slug)
        j["resumo_ia"] = ({"texto": c["texto"], "data": c["data"], "atual": c.get("chave") == chave_resumo(j)}
                          if c and c.get("texto") else None)
    return gerados, falhas


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
                    piso = PISOS.get(sid)
                    abaixo_piso = pct is not None and piso is not None and st[sid] is not None and st[sid] < piso
                    if abaixo_piso:
                        pct = pct * st[sid] / piso
                    media = sum(vals) / len(vals) if vals else None
                    linhas.append([sid, _r(st[sid]), _r(media), None if pct is None else round(pct), piso if abaixo_piso else None])
                    if pct is not None:
                        pcts.append(pct)
                notas[aid] = {"nota": round(sum(pcts) / len(pcts)) if pcts else None, "stats": linhas}
            lados_out[l] = {"rounds": st["rounds"], "base": len(grupo), "notas": notas}
        amb = lados_out.get("ambos", {}).get("notas", {})
        nomes = {aid: nome for aid, nome, *_ in ATRIBUTOS}
        j = {
            "funcao": fn, "rounds": rounds, "partidas": partidas, "amostra_pequena": rounds < AMOSTRA_FIRME,
            "outras_funcoes": {f: n for f, n in funcoes.items() if f != fn},
            "frase": _frase(fn, {nomes[a]: v["nota"] for a, v in amb.items()}),
            "lados": lados_out,
        }
        j["texto"] = texto_regras(j)
        jogadores[slug] = j

    contagem = Counter(fn for (fn, l), g in base.items() if l == "ambos" for _ in g)
    return {
        "versao": 2,
        "regras": {"amostra_firme": AMOSTRA_FIRME, "min_rounds_base": MIN_ROUNDS_BASE, "min_base": MIN_BASE,
                   "partidas": len(analises), "pisos": PISOS, "dif_lado": DIF_LADO},
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
