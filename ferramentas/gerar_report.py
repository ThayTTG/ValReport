#!/usr/bin/env python3
"""
Gerador dos reports em Markdown (.md) — NokyLabs

Para cada dia, cria a pasta dados/reports/AAAA-MM-DD/ com:
  - 00_resumo_do_dia.md        -> números do dia, avaliação de 14 dias resumida, rounds de destaque
                                  e rounds a observar (os rounds normais ficam de fora)
  - 00_avaliacao_14_dias.md    -> avaliação justa por função: índice 0-100 com margem, comparação com
                                  a média da função nos seus lobbies, jogadas solo, trades e clutches
  - 00_resumo_dos_grupos.md    -> duos, trios e five stack: isolado x juntos, quem troca quem,
                                  distância entre vocês e histórico de cada formação
  - 01_Corrode_Omen_23h36.md   -> relatório tático completo de cada partida

Os cálculos ficam no avaliacao.py (veja a explicação lá). Pode ser rodado sozinho:
    py gerar_report.py 2026-10-23
"""

import csv
import json
import math
import re
import shutil
import sys
import unicodedata
import urllib.parse
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import armazem
import avaliacao as av

PASTA = Path(__file__).resolve().parent.parent  # pasta principal do projeto (o código fica em ferramentas/)
DADOS = PASTA / "dados"
PASTA_RESUMOS = DADOS / "resumos"
PASTA_REPORTS = DADOS / "reports"
ARQ_HIST_GRUPOS = DADOS / "historico_grupos.csv"
FUSO_BR = av.FUSO_BR
g = av.g

DIST_MESMA_REGIAO = 1200
NOMES_TIPO = {"pistol": "Pistol", "eco": "Eco", "force": "Force", "armado": "Armado", "anti-eco": "Anti-eco"}
FORMACAO = {2: "Duo", 3: "Trio", 4: "Quad", 5: "Five stack"}
PASTA_EQUIPE = "Toda Equipe"


# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------

def ler_json(caminho, padrao=None):
    try:
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return padrao


def fmt_imp(pp):
    v = round(pp)
    return f"+{v}%" if v > 0 else f"{v}%"


def fmt_rounds(x):
    return f"{x:+.1f} " + ("round" if abs(round(x, 1)) == 1.0 else "rounds")


def metros(unidades):
    return round(unidades / 100)


def nome_arquivo(texto):
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9_-]+", "", texto.replace(" ", "-")) or "x"


def nome_pasta(membros, cfg):
    """Pasta de cada formação: 'Solo - Noky', 'Duo - Magoo e Messik', 'Toda Equipe'...
    (sem ':' no nome, porque o Windows não permite)."""
    nomes = [apelido(r, cfg) for r in membros]
    if len(membros) == 1:
        return f"Solo - {nomes[0]}"
    if len(membros) >= len(cfg.get("jogadores") or []):
        return PASTA_EQUIPE
    junto = ", ".join(nomes[:-1]) + " e " + nomes[-1]
    return f"{FORMACAO.get(len(membros), 'Grupo')} - {junto}"


def url_rel(caminho):
    return str(caminho).replace(" ", "%20")


def apelido(riot_id, cfg):
    return (cfg.get("apelidos") or {}).get(riot_id) or riot_id.split("#")[0]


def config_padrao(cfg):
    c = dict(cfg or {})
    c.setdefault("janela_dias", 14)
    c.setdefault("janela_referencia_dias", 60)
    c.setdefault("amostra_minima_rounds", 100)
    c.setdefault("destaque_impacto_pct", 35)
    c.setdefault("observar_impacto_pct", -20)
    c.setdefault("max_rounds_no_resumo", 5)
    c.setdefault("min_partidas_grupo", 3)
    if not c.get("_elenco_site"):
        try:
            import elenco_site  # membros da equipe no site (etapa 3b); sem a chave secreta, fica como no config.json
            c = elenco_site.aplicar(c)
        except Exception as e:  # noqa: BLE001 — o report nunca para por causa do site
            print(f"Elenco do site não aplicado ({e}).")
    return c


FMT_METRICA = {
    "impacto": lambda v: f"{v:+.1f}",
    "kast": lambda v: f"{100 * v:.0f}%",
    "sobrevivencia": lambda v: f"{100 * v:.0f}%",
    "adr": lambda v: f"{v:.0f}",
    "util_pr": lambda v: f"{v:.1f}",
}


def fmt_metrica(met, v):
    return FMT_METRICA.get(met, lambda x: f"{x:.2f}")(v)


# ----------------------------------------------------------------------------
# Links de vídeo (buscas no YouTube já filtradas: nunca quebram e acompanham o patch)
# ----------------------------------------------------------------------------

VIDEOS = {}  # preenchido a partir do config.json ("videos") no início de cada geração


def link_video(busca, rotulo="▶️ Vídeos sobre isso", chave=None, agente="", mapa=""):
    """Ordem: 1) link fixo do config (o mais específico: tema+agente+mapa > tema+agente > tema+mapa > tema);
    2) busca dentro do canal do coach; 3) busca na wiki; 4) busca geral no YouTube."""
    melhor, nota = None, -1
    for regra in VIDEOS.get("links_fixos") or []:
        if regra.get("tema") != chave or not regra.get("url"):
            continue
        if regra.get("agente") and regra["agente"].lower() != (agente or "").lower():
            continue
        if regra.get("mapa") and regra["mapa"].lower() != (mapa or "").lower():
            continue
        pontos = (2 if regra.get("agente") else 0) + (1 if regra.get("mapa") else 0)
        if pontos > nota:
            melhor, nota = regra, pontos
    if melhor:
        texto = f"▶️ {melhor['titulo']}" if melhor.get("titulo") else rotulo
        return f"[{texto}]({melhor['url']})"

    q = urllib.parse.quote_plus(busca)
    fonte = VIDEOS.get("nome_da_fonte")
    if VIDEOS.get("canal_youtube"):
        canal = VIDEOS["canal_youtube"].strip().rstrip("/")
        if not canal.startswith("http"):
            canal = "https://www.youtube.com/" + (canal if canal.startswith("@") else "@" + canal)
        url = f"{canal}/search?query={q}"
    elif VIDEOS.get("wiki_busca"):
        url = VIDEOS["wiki_busca"].replace("{busca}", q)
    else:
        url, fonte = "https://www.youtube.com/results?search_query=" + q, None
    return f"[{rotulo}{f' ({fonte})' if fonte else ''}]({url})"


TEMAS = {
    "anti_eco":    ("Anti-eco",                   "valorant como jogar anti eco dicas"),
    "first_death": ("Primeiro duelo / peek",      "valorant como ganhar o primeiro duelo jiggle peek"),
    "isolada":     ("Trade e posicionamento",     "valorant como jogar para ser trocado trade posicionamento"),
    "mira":        ("Abertura de mira",           "valorant crosshair placement mira na altura da cabeça"),
    "clutch":      ("Clutch",                     "valorant como jogar clutch 1v2 1v3"),
    "save":        ("Quando salvar",              "valorant quando salvar arma save round"),
    "solo":        ("Lurk e jogadas solo",        "valorant como fazer lurk timing quando lurkar"),
    "pixel":       ("Pixels e posições — {agente} no {mapa}", "{agente} {mapa} valorant posições pixel"),
    "lineup":      ("Pixel de skill / lineups — {agente} no {mapa}", "{agente} {mapa} lineups setups valorant"),
    "funcao":      ("Como jogar de {funcao}",     "valorant como jogar de {funcao} dicas"),
    "utilitario":  ("Uso do kit — {agente}",      "{agente} valorant como usar as habilidades dicas"),
}


def tema(chave, agente="", mapa="", funcao="", rotulo="▶️ Vídeos sobre isso"):
    titulo, busca = TEMAS[chave]
    f = dict(agente=agente, mapa=mapa, funcao=funcao.lower())
    return titulo.format(**f), link_video(busca.format(**f), rotulo, chave, agente, mapa)


# ----------------------------------------------------------------------------
# Contexto: modelo, partidas da janela e referências por função
# ----------------------------------------------------------------------------

def carregar_contexto(dia, cfg):
    fim = datetime.fromisoformat(dia).replace(tzinfo=FUSO_BR) + timedelta(days=1)
    ini_janela = fim - timedelta(days=cfg["janela_dias"])
    ini_ref = fim - timedelta(days=max(cfg["janela_dias"], cfg["janela_referencia_dias"]))

    modelo = armazem.carregar_modelo(cfg)
    analises = {}
    for mid in armazem.partidas_no_periodo(ini_ref, fim):
        p = armazem.ler_partida(mid)
        if p and av.partida_valida(p):
            analises[mid] = av.analisar_partida_completa(p, modelo, cfg)

    equipe = cfg.get("jogadores", [])
    puuid_de = {}
    for a in analises.values():
        for rid in equipe:
            j = av.localizar(a, rid)
            if j:
                puuid_de.setdefault(rid, j["puuid"])
    try:  # guarda o puuid de cada Riot ID: reconhece depois quem trocou de nick (etapa 3b)
        import elenco_site
        elenco_site.lembrar_puuids(puuid_de)
    except Exception:  # noqa: BLE001
        pass
    refs = av.calcular_referencias(list(analises.values()), set(puuid_de.values()), cfg)
    return {"dia": dia, "fim": fim, "ini_janela": ini_janela, "modelo": modelo, "analises": analises,
            "puuid_de": puuid_de, "refs": refs, "equipe": equipe, "brutas": {}}


def analise_de(ctx, mid, cfg):
    if mid not in ctx["analises"]:
        p = armazem.ler_partida(mid)
        if not p or not av.partida_valida(p):
            return None
        ctx["analises"][mid] = av.analisar_partida_completa(p, ctx["modelo"], cfg)
    return ctx["analises"][mid]


def bruta_de(ctx, mid):
    if mid not in ctx["brutas"]:
        ctx["brutas"][mid] = armazem.ler_partida(mid)
    return ctx["brutas"][mid]


def na_janela(ctx):
    return [a for a in ctx["analises"].values() if a["inicio"] and a["inicio"] >= ctx["ini_janela"]]


def time_da_equipe(ctx, a, time_id):
    """Membros da equipe que estavam neste time nesta partida (na ordem do config)."""
    return tuple(rid for rid in ctx["equipe"]
                 if ctx["puuid_de"].get(rid) in a["jogadores"] and a["jogadores"][ctx["puuid_de"][rid]]["time"] == time_id)


# ----------------------------------------------------------------------------
# Leitura de cada round
# ----------------------------------------------------------------------------

def descrever_round(r, agente, mapa):
    partes = []
    if r["kills"]:
        partes.append(f"{r['kills']} abate{'s' if r['kills'] > 1 else ''} ({', '.join(r['armas_kills'])})")
    if r["trades_feitos"]:
        partes.append(f"trocou {r['trades_feitos']} aliado{'s' if r['trades_feitos'] > 1 else ''}")
    if r["assist"]:
        partes.append(f"{r['assist']} assistência{'s' if r['assist'] > 1 else ''}")
    if r["first_kill"]:
        partes.append("abriu o round com o first kill")
    if r["first_death"]:
        partes.append("foi a primeira morte do round")
    if r["plant"]:
        partes.append("plantou a spike")
    if r["defuse"]:
        partes.append("desarmou a spike")
    if r["morreu"] and r["clutch_tentado"] and not r["clutch_vs"]:
        partes.append(f"morreu aos {r['tempo_morte_s']}s no clutch 1v{r['clutch_tentado']}")
    elif r["morreu"]:
        dist = r["dist_aliado_morte"]
        perto = f" (aliado mais próximo a ~{metros(dist)} m)" if dist is not None else ""
        partes.append(f"morreu aos {r['tempo_morte_s']}s" + (", mas foi trocada" if r["trocado"] else " sem trade") + perto)
    else:
        partes.append("sobreviveu")
    if r["clutch_vs"]:
        partes.append(f"venceu um clutch 1v{r['clutch_vs']}")
    elif r["clutch_tentado"] and not r["morreu"]:
        partes.append(f"perdeu um clutch 1v{r['clutch_tentado']}")
    resumo = "; ".join(partes)
    resumo = resumo[:1].upper() + resumo[1:] + "."

    imp = 100 * r["wpa"]
    chave = None
    if r["tipo"] == "anti-eco" and r["morreu"] and not r["trocado"]:
        dica, chave = ("**Anti-eco.** Com vantagem de arma, jogue à distância e em dupla; "
                       "a morte isolada devolve armas ao inimigo."), "anti_eco"
    elif r["first_death"] and not r["trocado"]:
        dica, chave = ("**Primeiro duelo perdido sem trade.** Chegue no ângulo com a mira já na altura "
                       "da cabeça e peça utilitário antes do peek."), "first_death"
    elif r["morte_isolada"] and not r["trocado"] and not r["kills"]:
        dica, chave = ("**Morte isolada.** Você estava a mais de 30 m do aliado mais próximo: "
                       "ninguém tinha como trocar."), "isolada"
    elif r["morte_fora_trade"] and not r["trocado"] and not r["kills"]:
        dica, chave = ("**Fora do alcance de trade.** Jogue a no máximo ~15 m de um aliado "
                       "para que a sua morte possa ser trocada."), "isolada"
    elif not r["morreu"] and not r["venceu"] and not r["kills"] and imp <= 1:
        dica, chave = ("**Sobreviveu sem impacto.** Ótimo se foi save consciente; "
                       "se não, faltou agir para ganhar o round."), "save"
    elif r["clutch_vs"] >= 2:
        dica = "**Clutch de alto nível.** Ótima frieza; reveja se o time não poderia ter evitado o 1vX."
    elif r["clutch_tentado"] and not r["clutch_vs"] and (r["clutch_esperado"] or 0) >= 0.4:
        dica, chave = (f"**Clutch favorável perdido.** A situação dava ~{round(100 * r['clutch_esperado'])}% "
                       "de chance de vitória."), "clutch"
    elif r["kills"] >= 3:
        dica = "**Round de alto impacto.** Excelente conversão de duelos."
    elif r["kills_solo"] and imp > 0:
        dica = "**Jogada solo que deu certo.** Abate longe do time (lurk/flanco) que ajudou no round."
    elif r["tipo"] == "eco" and r["kills"]:
        dica = "**Eco bem aproveitado.** Abates em eco quebram a economia adversária."
    elif r["first_kill"]:
        dica = "**Boa abertura.** Criou vantagem numérica cedo para o time."
    elif r["defuse"] or r["plant"]:
        dica = "**Spike no tempo certo.** Plant/defuse também muda a chance de vitória."
    elif r["trades_feitos"]:
        dica = "**Boa troca.** Estava perto do aliado e puniu o adversário na hora."
    elif r["kills"] >= 2:
        dica = "**Bom impacto.** Converteu mais de um duelo."
    elif r["morreu"] and r["trocado"]:
        dica = "**Morte trocada.** Cumpriu o papel; tente causar mais dano antes de cair."
    elif r["clutch_tentado"] and not r["clutch_vs"]:
        esp = f" (~{round(100 * r['clutch_esperado'])}% de chance)" if r["clutch_esperado"] is not None else ""
        dica = f"**Clutch difícil{esp}.** Situação desfavorável; reveja como o time chegou nela."
    elif imp <= -15:
        dica = "**Round abaixo do esperado.** O impacto negativo veio da sua morte nesse momento do round."
    elif imp >= 15:
        dica = "**Contribuição positiva.** As suas ações aumentaram a chance de vitória do time."
    else:
        dica = "Round neutro."
    if chave:
        dica += " " + tema(chave, agente, mapa)[1]
    return resumo, dica, chave, imp


def regioes_repetidas(recs, lado):
    mortes = [(r["n"], r["local_morte"]) for r in recs
              if r["lado"] == lado and r["local_morte"] and "x" in r["local_morte"]]
    grupos, usados = [], set()
    for i, (n1, p1) in enumerate(mortes):
        if n1 in usados:
            continue
        grupo = [n1] + [n2 for n2, p2 in mortes[i + 1:]
                        if n2 not in usados and math.dist((p1["x"], p1["y"]), (p2["x"], p2["y"])) <= DIST_MESMA_REGIAO]
        if len(grupo) >= 3:
            usados.update(grupo)
            grupos.append(grupo)
    return grupos


def habitos(recs, rb, agente, mapa, ref=None):
    """Lista de (título, texto, [temas]) com os padrões negativos da partida."""
    itens = []
    for lado, nome in (("defesa", "Defesa"), ("ataque", "Ataque")):
        grupos = regioes_repetidas(recs, lado)
        if grupos:
            pontos = " e ".join(f"{len(gr)}x no mesmo ponto ({', '.join(f'R{n}' for n in gr)})" for gr in grupos)
            itens.append((f"Mortes repetidas na mesma região ({nome})",
                          f"Você morreu {pontos}. O adversário provavelmente já decorou essas posições: "
                          "**varie o pixel e o timing.**",
                          ["pixel", "lineup"]))

    dt = av.distancia_de_trade(recs)
    if dt and dt["mortes"] >= 4 and dt["em_alcance_pct"] <= 45:
        itens.append(("Mortes fora do alcance de trade",
                      f"Em {100 - dt['em_alcance_pct']}% das suas mortes o aliado mais próximo estava a mais de 15 m "
                      f"(mediana: ~{dt['mediana_m']} m). A essa distância o time não consegue trocar.",
                      ["isolada"]))

    fd = sum(r["first_death"] for r in recs)
    fk = sum(r["first_kill"] for r in recs)
    if fd >= 3 and fd > fk:
        itens.append(("Saldo negativo nos primeiros duelos",
                      f"Foi a primeira morte em {fd} rounds e abriu em {fk}. Peça informação/utilitário antes "
                      "do primeiro peek e chegue com a mira pré-posicionada.",
                      ["first_death", "mira"]))

    if 0 < rb.get("hs_pct", 100) < 18:
        itens.append(("Abertura de mira baixa",
                      f"HS% de {rb.get('hs_pct')}% nesta partida. Treine manter a mira na altura da cabeça "
                      "ao andar e checar ângulos.", ["mira"]))

    eco = [r for r in recs if r["tipo"] == "anti-eco"]
    eco_ruim = [r for r in eco if r["morreu"] and not r["trocado"]]
    if eco and len(eco_ruim) >= 2:
        itens.append(("Anti-ecos perigosos",
                      f"Morreu sem trade em {len(eco_ruim)} de {len(eco)} anti-ecos. "
                      "Com rifle contra pistola, a distância é sua aliada; evite closes.", ["anti_eco"]))

    kit = av.uso_do_kit(recs, ref) if ref else None
    if kit and len(recs) >= 10 and kit["util_rel"] < 0.7:
        itens.append(("Kit pouco usado",
                      f"{kit['util_pr']:.1f} habilidades por round, contra {kit['util_ref']:.1f} da média de "
                      f"{recs[0]['funcao'].lower()} nos seus lobbies. Habilidade guardada não ajuda o time.",
                      ["utilitario"]))
    elif (kit and len(recs) >= 10 and recs[0]["funcao"] in ("Iniciador", "Controlador")
          and kit["assist_por_10_ref"] and kit["assist_por_10"] < 0.6 * kit["assist_por_10_ref"]):
        itens.append(("Habilidades gerando poucas assistências",
                      f"{kit['assist_por_10']:.1f} assistências a cada 10 habilidades (média da função: "
                      f"{kit['assist_por_10_ref']:.1f}). Combine o uso com quem vai entrar ou dar o peek.",
                      ["utilitario"]))

    solo = av.jogadas_solo(recs)
    if solo["mortes"] >= 3 and solo["impacto"] < -30:
        itens.append(("Jogadas solo custando rounds",
                      f"{solo['mortes']} mortes a mais de 30 m do time, com saldo de impacto de "
                      f"{fmt_rounds(solo['impacto'] / 100)} nas jogadas solo. Lurk precisa de timing e informação.",
                      ["solo"]))
    return itens


def regras_de_acao(itens):
    """[(título, texto)] das regras de ação para os hábitos [(título, texto, temas)]."""
    regras = []
    titulos = " ".join(t for t, _, _ in itens)
    if "mesma região" in titulos:
        regras.append(("REGRA DOS 2 ROUNDS", "Nunca jogue no mesmo pixel por mais de 2 rounds seguidos."))
    if "alcance de trade" in titulos or "primeiros duelos" in titulos:
        regras.append(("JOGUE PARA SER TROCADA", "Fique a no máximo ~15 m de um aliado antes do peek."))
    if "mira" in titulos:
        regras.append(("MIRA NA ALTURA DA CABEÇA", "Ande e cheque ângulos com a mira já posicionada."))
    if "Anti-eco" in titulos:
        regras.append(("ANTI-ECO COM DISTÂNCIA", "Rifle contra pistola: segure ângulos longos, nada de rush."))
    if "solo" in titulos:
        regras.append(("LURK COM PROPÓSITO", "Só lurke com info do time e timing combinado."))
    if not regras:
        regras.append(("MANTER O PADRÃO", "Continue jogando assim e foque em consistência."))
    return regras


def plano_de_acao(itens, agente, mapa):
    regras = regras_de_acao(itens)
    largura = 72
    caixa = ["┌" + "─" * largura + "┐",
             "│" + f"GUIA DE EVOLUÇÃO ({agente} - {mapa})".upper().center(largura) + "│",
             "├" + "─" * largura + "┤"]
    for i, (titulo, texto) in enumerate(regras, 1):
        caixa.append("│ " + f"{i}. {titulo}".ljust(largura - 1) + "│")
        caixa.append("│ " + f"   • {texto}"[: largura - 1].ljust(largura - 1) + "│")
        if i < len(regras):
            caixa.append("│" + " " * largura + "│")
    caixa.append("└" + "─" * largura + "┘")
    return "```\n" + "\n".join(caixa) + "\n```"


def tabela_comparacao(m, ref, funcao):
    """Você x média da sua função nos seus lobbies, só nas métricas que pesam para a função."""
    linhas = ["| Métrica | Você | Média da função no seu lobby | Leitura |",
              "| :--- | :---: | :---: | :--- |"]
    for met in av.PESOS.get(funcao, av.PESOS["Outra"]):
        mu, sd = ref[met]
        z = (m[met] - mu) / sd
        if av.METRICAS[met][1]:
            z = -z
        leitura = "🟢 acima" if z >= 0.5 else ("🔴 abaixo" if z <= -0.5 else "⚪ na média")
        linhas.append(f"| {av.METRICAS[met][0]} | {fmt_metrica(met, m[met])} | {fmt_metrica(met, mu)} | {leitura} |")
    return "\n".join(linhas)


# ----------------------------------------------------------------------------
# Markdown: report de UMA partida
# ----------------------------------------------------------------------------

def md_partida(a, j, riot_id, ctx, cfg):
    recs = j["rounds"]
    rb = av.resumo_basico(a, j)
    agente, mapa, funcao = j["agente"], a["mapa"], j["funcao"]
    descr = {r["n"]: descrever_round(r, agente, mapa) for r in recs}
    rs_def = [r for r in recs if r["lado"] == "defesa"]
    rs_atk = [r for r in recs if r["lado"] == "ataque"]
    imp_def, imp_atk = sum(r["wpa"] for r in rs_def), sum(r["wpa"] for r in rs_atk)
    hora = f"{a['inicio']:%d/%m/%Y às %Hh%M}" if a["inicio"] else "?"
    ref = ctx["refs"][funcao]
    av_partida = av.avaliar(recs, ref, funcao, cfg) if recs else None

    out = [f"# 📊 Relatório de Análise Tática: {agente} ({mapa} - {j['elo']})", "",
           f"*{riot_id} · {hora} · [⬅️ Voltar ao resumo do dia](../Toda%20Equipe/00_resumo_do_dia.md)*", "",
           "## 📋 Ficha da Partida",
           f"* **Resultado:** {rb['resultado'].capitalize()} {rb['placar']}",
           f"* **Agente:** {agente} ({funcao})",
           f"* **Mapa:** {mapa} · **Fila:** {a['fila']} · **Elo:** {j['elo']}",
           f"* **K/D/A:** {rb['kills']}/{rb['mortes']}/{rb['assistencias']} · **Trades feitos:** {rb['trades_feitos']} "
           f"· **ACS:** {rb['acs']} · **ADR:** {rb['adr']} · **HS%:** {rb['hs_pct']}% · **KAST:** {rb['kast_pct']}%"]
    if av_partida:
        out.append(f"* **Índice da partida ({funcao}):** `{av_partida['indice']}/100` "
                   f"(margem {av_partida['margem'][0]}–{av_partida['margem'][1]}) · 50 = média da função nos seus lobbies")
    out.append(f"* **Impacto:** Defesa (`{fmt_rounds(imp_def)}`) | Ataque (`{fmt_rounds(imp_atk)}`) "
               f"$\\rightarrow$ **Total:** `{fmt_rounds(imp_def + imp_atk)}`")
    kit = av.uso_do_kit(recs, ref) if recs else None
    if kit:
        out.append(f"* 🧰 **Kit:** {kit['util_pr']:.1f} habilidades/round (média de {funcao.lower()} no lobby: "
                   f"{kit['util_ref']:.1f}) · {j['ult_total']} ultimate(s) · {kit['assist_por_10']:.1f} assistências "
                   f"a cada 10 habilidades · {kit['kills_hab']} abate(s) com habilidade")
    if j["rounds_afk"]:
        out.append(f"* ⚠️ **{j['rounds_afk']} round(s) AFK/desconectado** ficaram fora da avaliação.")
    out += ["", "> **Como ler o impacto:** cada round mostra quanto as suas ações mudaram a chance do seu time "
            "vencer aquele round (ex.: +16% = você aumentou a chance em 16 pontos). Somando a partida, o total "
            "equivale a quantos rounds as suas ações \"geraram\" para o time.", ""]

    for titulo, emoji, rs, imp in (("Lado Defensivo", "🛡️", rs_def, imp_def), ("Lado Atacante", "⚔️", rs_atk, imp_atk)):
        if not rs:
            continue
        vit = sum(r["venceu"] for r in rs)
        dt = av.distancia_de_trade(rs)
        diag = (f"{vit}/{len(rs)} rounds vencidos · {sum(r['kills'] for r in rs)} abates / "
                f"{sum(r['morreu'] for r in rs)} mortes · first duels {sum(r['first_kill'] for r in rs)}–"
                f"{sum(r['first_death'] for r in rs)} · {sum(r['trades_feitos'] for r in rs)} trade(s) feito(s)")
        if dt:
            diag += f" · aliado mais próximo nas mortes: ~{dt['mediana_m']} m"
        out += ["---", "", f"## {emoji} {titulo} (Impacto: {fmt_rounds(imp)})", "",
                f"> **Diagnóstico:** {diag}", "",
                "| Round | Tipo | Resumo da Ação | Impacto & Dica de Correção | Impacto |",
                "| :--- | :--- | :--- | :--- | :---: |"]
        for r in rs:
            resumo, dica, _, ip = descr[r["n"]]
            res = "✅" if r["venceu"] else "❌"
            out.append(f"| **R{r['n']}** {res} | {NOMES_TIPO[r['tipo']]} | {resumo} | {dica} | **{fmt_imp(ip)}** |")
        out.append("")

    pt = rb["por_tipo_de_round"]
    if pt:
        out += ["---", "", "## 💰 Desempenho por Tipo de Round", "",
                "| Tipo | Rounds | Vitórias | K/D | ADR | Impacto/round | Armas mais usadas |",
                "| :--- | :---: | :---: | :---: | :---: | :---: | :--- |"]
        for tipo in ("pistol", "eco", "force", "armado", "anti-eco"):
            if tipo in pt:
                d = pt[tipo]
                armas = ", ".join(f"{x} ({n})" for x, n in d["armas_mais_usadas"].items())
                out.append(f"| {NOMES_TIPO[tipo]} | {d['rounds']} | {d['vitorias']} ({d['winrate_pct']}%) | {d['kd']} "
                           f"| {d['adr']} | {fmt_imp(d['impacto'])} | {armas} |")
        out.append("")

    if av_partida:
        out += ["---", "", f"## ⚖️ Você × Média de {funcao} no seu Lobby (nesta partida)", "",
                tabela_comparacao(av_partida["metricas"], ref, funcao), "",
                "<sub>Uma partida sozinha varia muito: a avaliação de verdade fica no arquivo de 14 dias.</sub>", ""]

    itens = habitos(recs, rb, agente, mapa, ref)
    out += ["---", "", "## 🔍 Análise Geral & Vícios de Jogo (Bad Habits)", ""]
    if itens:
        for i, (titulo, texto, chaves) in enumerate(itens, 1):
            links = " · ".join(tema(ch, agente, mapa, funcao, rotulo=f"▶️ {tema(ch, agente, mapa, funcao)[0]}")[1]
                               for ch in chaves)
            out += [f"### {i}. {titulo}", texto, "", f"📺 {links}", ""]
    else:
        out += ["Nenhum vício forte detectado nos números desta partida. Bom trabalho! 💜", ""]

    chaves = ["lineup"] + [ch for _, _, cs in itens for ch in cs] + [d[2] for d in descr.values() if d[2]]
    vistos, estudo = set(), []
    for ch in chaves:
        if ch not in vistos:
            vistos.add(ch)
            titulo, link = tema(ch, agente, mapa, funcao, rotulo="▶️ Assistir")
            estudo.append(f"* **{titulo}** — {link}")
    out += ["---", "", "## 📚 Para Estudar", "", "\n".join(estudo), "",
            "---", "", "## 🎯 Plano de Ação", "", plano_de_acao(itens, agente, mapa), "",
            "<sub>Análise baseada nos números da partida (abates, posições, economia e chance de vitória). "
            "Não substitui a análise de VOD.</sub>"]
    return "\n".join(out)


# ----------------------------------------------------------------------------
# Markdown: avaliação justa (janela de dias)
# ----------------------------------------------------------------------------

def avaliacoes_por_jogador(ctx, cfg):
    """{riot_id: [avaliação por função, da mais jogada para a menos]} na janela."""
    out = {}
    janela = na_janela(ctx)
    for rid in ctx["equipe"]:
        pu = ctx["puuid_de"].get(rid)
        recs = [r for a in janela if pu in a["jogadores"] for r in a["jogadores"][pu]["rounds"]] if pu else []
        por_f = defaultdict(list)
        for r in recs:
            por_f[r["funcao"]].append(r)
        lst = [av.avaliar(rs, ctx["refs"][f], f, cfg) for f, rs in por_f.items()]
        lst = [x for x in lst if x]
        for x in lst:
            x["recs"] = por_f[x["funcao"]]
        out[rid] = sorted(lst, key=lambda x: -x["rounds"])
    return out


def md_avaliacao(ctx, avals, cfg):
    dias = cfg["janela_dias"]
    ate = ctx["fim"] - timedelta(days=1)
    out = [f"# ⚖️ Avaliação Justa — últimos {dias} dias (até {ate:%d/%m/%Y})", "",
           "*[⬅️ Voltar ao resumo do dia](00_resumo_do_dia.md)*", "",
           "## 📖 Como ler", "",
           "* **Índice 0–100, por função:** **50 = média da sua função nos seus próprios lobbies.** Cada jogador é "
           "comparado só com quem jogou a mesma função nas mesmas partidas (isso já ajusta pelo elo).",
           "* **O que pesa:** o **impacto** (quanto as suas ações mudaram a chance de vencer cada round) é o que mais "
           "conta. Depois vêm as métricas típicas de cada função: first kills para duelista, assistências e "
           "utilitário para iniciador, KAST e sobrevivência para controlador e sentinela.",
           "* **Margem:** o intervalo mostra onde o índice provavelmente está de verdade. Margem larga = poucos dados.",
           f"* **Veredito:** só aparece com pelo menos **{cfg['amostra_minima_rounds']} rounds** na função. "
           "Abaixo disso, os números são mostrados, mas sem conclusão.",
           ""]

    out += ["## 🧾 Visão Geral", "",
            "| Jogador | Função | Partidas | Rounds | Índice | Margem | Impacto/round | Veredito |",
            "| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |"]
    for rid in ctx["equipe"]:
        for x in avals.get(rid, []):
            out.append(f"| **{apelido(rid, cfg)}** | {x['funcao']} | {x['partidas']} | {x['rounds']} | **{x['indice']}** "
                       f"| {x['margem'][0]}–{x['margem'][1]} | {fmt_imp(x['metricas']['impacto'])} "
                       f"| {x['veredito'][0]} {x['veredito'][1]} |")
    out.append("")

    for rid in ctx["equipe"]:
        lst = avals.get(rid, [])
        out += ["---", "", f"## 👤 {apelido(rid, cfg)} ({rid})", ""]
        if not lst:
            out += [f"> 💤 Nenhuma partida competitiva nos últimos {dias} dias.", ""]
            continue
        for x in lst:
            f = x["funcao"]
            recs = x["recs"]
            agentes = Counter(r["agente"] for r in recs)
            out += [f"### {f} — índice **{x['indice']}** ({x['margem'][0]}–{x['margem'][1]}) · "
                    f"{x['veredito'][0]} {x['veredito'][1]}", "",
                    f"*{x['partidas']} partida(s), {x['rounds']} rounds · agentes: "
                    f"{', '.join(f'{ag} ({n} rounds)' for ag, n in agentes.most_common())}*", "",
                    tabela_comparacao(x["metricas"], ctx["refs"][f], f), ""]

            # Pontos fortes / a melhorar (pelas contribuições ao índice)
            ordem = sorted(x["contrib"].items(), key=lambda kv: kv[1])
            fortes = [av.METRICAS[k][0] for k, z in reversed(ordem) if z >= 0.5][:2]
            fracos = [av.METRICAS[k][0] for k, z in ordem if z <= -0.5][:2]
            if fortes:
                out.append(f"* 💪 **Pontos fortes:** {', '.join(fortes)}")
            if fracos:
                out.append(f"* 🎯 **A melhorar:** {', '.join(fracos)} — "
                           f"{tema('funcao', funcao=f, rotulo=f'▶️ Como jogar de {f.lower()}')[1]}")

            solo = av.jogadas_solo(recs)
            if solo["kills"] or solo["mortes"]:
                saldo = solo["impacto"] / 100
                leitura = "estão dando resultado" if saldo > 0.3 else ("estão custando rounds" if saldo < -0.3 else "estão neutras")
                out.append(f"* 🥷 **Jogadas solo** (a mais de 30 m do time): {solo['kills']} abates, {solo['mortes']} mortes, "
                           f"saldo de impacto {fmt_rounds(saldo)} → {leitura}.")
            kit = av.uso_do_kit(recs, ctx["refs"][f])
            if kit:
                rel = kit["util_rel"]
                leitura = ("usando bem o kit" if rel >= 0.9 else "usando um pouco menos que o normal" if rel >= 0.7
                           else "guardando habilidades demais")
                out.append(f"* 🧰 **Uso do kit:** {kit['util_pr']:.1f} habilidades/round (média da função: "
                           f"{kit['util_ref']:.1f}) → {leitura}. {kit['ult_partida']:.1f} ults por partida "
                           f"(média: {kit['ult_ref_partida']:.1f}) · {kit['assist_por_10']:.1f} assistências a cada 10 "
                           f"habilidades (média: {kit['assist_por_10_ref']:.1f}) · {kit['kills_hab']} abate(s) com habilidade.")
            dt = av.distancia_de_trade(recs)
            if dt:
                out.append(f"* 📏 **Trade:** em {dt['em_alcance_pct']}% das mortes havia um aliado a até 15 m "
                           f"(mediana ~{dt['mediana_m']} m); {dt['trocadas_pct']}% das mortes foram trocadas.")
            cl = av.clutches(recs)
            if cl:
                sit = ", ".join(f"{k} ({v})" for k, v in sorted(cl["por_situacao"].items()))
                comp = ("acima do esperado" if cl["vencidos"] > cl["esperado"] + 0.5
                        else "abaixo do esperado" if cl["vencidos"] < cl["esperado"] - 0.5 else "dentro do esperado")
                out.append(f"* 🧊 **Clutches:** venceu {cl['vencidos']} de {cl['tentados']} ({sit}). "
                           f"O normal nessas situações seria ~{cl['esperado']} → {comp}.")
            out.append("")

            # Evolução partida a partida
            por_m = defaultdict(list)
            for r in recs:
                por_m[r["match_id"]].append(r)
            linhas = []
            for mid, rs in por_m.items():
                a = ctx["analises"][mid]
                ip = av.avaliar(rs, ctx["refs"][f], f, cfg)
                linhas.append((a["inicio"], f"| {a['inicio']:%d/%m %Hh%M} | {a['mapa']} | {rs[0]['agente']} "
                                            f"| {len(rs)} | {fmt_imp(ip['metricas']['impacto'])} | {ip['indice']} |"))
            out += ["<details><summary>Partida a partida</summary>", "",
                    "| Quando | Mapa | Agente | Rounds | Impacto/round | Índice da partida |",
                    "| :--- | :--- | :--- | :---: | :---: | :---: |"]
            out += [l for _, l in sorted(linhas)]
            out += ["", "</details>", ""]

    refs = ctx["refs"]
    out += ["---", "", "<sub>Referências calculadas com "
            + ", ".join(f"{f}: {refs[f]['_amostras']}" for f in av.FUNCOES if f != "Outra")
            + " atuações de outros jogadores dos seus lobbies (enquanto há poucas, valores de referência típicos "
            f"completam a conta). Modelo de chance de vitória treinado com {ctx['modelo'].rounds_usados} rounds.</sub>"]
    return "\n".join(out)


# ----------------------------------------------------------------------------
# Duos, trios e five stack
# ----------------------------------------------------------------------------

CAMPOS_GRUPO = ["data", "match_id", "formacao", "membros", "agentes", "mapa", "resultado", "placar",
                "kills", "mortes", "trades_internos", "first_kills", "first_deaths"]


def interacoes_do_grupo(ctx, a, membros, cfg):
    """Quem trocou quem e distância até o parceiro mais próximo quando alguém do grupo morreu."""
    bruta = bruta_de(ctx, a["match_id"])
    pus = {ctx["puuid_de"][r]: r for r in membros}
    trades, distancias = Counter(), []
    if not bruta:
        return trades, distancias
    janela = cfg.get("janela_trade_ms", 5000)
    validos = {r.get("id") for r in av.rounds_validos(bruta)}
    kills_r = defaultdict(list)
    for k in bruta.get("kills", []) or []:
        if k.get("round") in validos:
            kills_r[k.get("round")].append(k)
    for ks in kills_r.values():
        ks.sort(key=lambda k: k.get("time_in_round_in_ms", 0))
        for i, k in enumerate(ks):
            v = g(k, "victim", "puuid")
            if v not in pus:
                continue
            locs = {g(pl, "player", "puuid"): g(pl, "location") for pl in k.get("player_locations") or []}
            loc = k.get("location")
            ds = [math.dist((loc["x"], loc["y"]), (l["x"], l["y"])) for p, l in locs.items()
                  if p in pus and p != v and l and loc]
            if ds:
                distancias.append(min(ds))
            assassino, t = g(k, "killer", "puuid"), k.get("time_in_round_in_ms", 0)
            for k2 in ks[i + 1:]:
                if k2.get("time_in_round_in_ms", 0) - t > janela:
                    break
                quem = g(k2, "killer", "puuid")
                if g(k2, "victim", "puuid") == assassino and quem in pus and quem != v:
                    trades[(pus[quem], pus[v])] += 1
                    break
    return trades, distancias


def salvar_hist_grupos(dia, jogos, cfg):
    existentes = set()
    if ARQ_HIST_GRUPOS.exists():
        with open(ARQ_HIST_GRUPOS, encoding="utf-8-sig") as f:
            for row in csv.DictReader(f, delimiter=";"):
                existentes.add((row["match_id"], row["membros"]))
    novo = not ARQ_HIST_GRUPOS.exists()
    with open(ARQ_HIST_GRUPOS, "a", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS_GRUPO, delimiter=";")
        if novo:
            w.writeheader()
        for j in jogos:
            membros = " & ".join(j["membros"])
            if (j["mid"], membros) in existentes:
                continue
            w.writerow({
                "data": (j["inicio"] or datetime.fromisoformat(dia)).strftime("%Y-%m-%d"),
                "match_id": j["mid"],
                "formacao": FORMACAO.get(len(j["membros"]), f"{len(j['membros'])} jogadores"),
                "membros": membros,
                "agentes": " & ".join(j["jogs"][r]["agente"] for r in j["membros"]),
                "mapa": j["mapa"],
                "resultado": j["resultado"],
                "placar": j["placar"],
                "kills": sum(j["jogs"][r]["stats"].get("kills", 0) for r in j["membros"]),
                "mortes": sum(j["jogs"][r]["stats"].get("deaths", 0) for r in j["membros"]),
                "trades_internos": sum(j["trades"].values()),
                "first_kills": sum(sum(x["first_kill"] for x in j["jogs"][r]["rounds"]) for r in j["membros"]),
                "first_deaths": sum(sum(x["first_death"] for x in j["jogs"][r]["rounds"]) for r in j["membros"]),
            })


def historico_formacao(membros):
    if not ARQ_HIST_GRUPOS.exists():
        return []
    chave = " & ".join(membros)
    with open(ARQ_HIST_GRUPOS, encoding="utf-8-sig") as f:
        return [row for row in csv.DictReader(f, delimiter=";") if row["membros"] == chave]


def jogos_em_grupo(ctx, mids, cfg):
    """Partidas (entre mids) em que 2+ membros da equipe estavam no mesmo time."""
    jogos = []
    for mid in mids:
        a = analise_de(ctx, mid, cfg)
        if not a:
            continue
        for time_id in {j["time"] for j in a["jogadores"].values()}:
            membros = time_da_equipe(ctx, a, time_id)
            if len(membros) < 2:
                continue
            jogs = {r: a["jogadores"][ctx["puuid_de"][r]] for r in membros}
            trades, dists = interacoes_do_grupo(ctx, a, membros, cfg)
            j0 = jogs[membros[0]]
            jogos.append({"mid": mid, "membros": membros, "jogs": jogs, "mapa": a["mapa"], "inicio": a["inicio"],
                          "resultado": j0["resultado"], "placar": j0["placar"], "trades": trades, "dists": dists})
    jogos.sort(key=lambda j: j["inicio"] or ctx["fim"])
    return jogos


def resumo_recs(recs):
    if not recs:
        return None
    m = av.metricas(recs)
    m["partidas"] = len({r["match_id"] for r in recs})
    return m


def isolado_juntos(ctx, r, juntos):
    """(métricas isolado, métricas juntos) de um jogador, comparando só nas funções que jogou com o grupo."""
    pu = ctx["puuid_de"][r]
    rec_j = [x for j in juntos for x in j["jogs"][r]["rounds"]]
    funcoes = {x["funcao"] for x in rec_j}
    rec_i = [x for a in na_janela(ctx) if pu in a["jogadores"]
             and len(time_da_equipe(ctx, a, a["jogadores"][pu]["time"])) == 1
             for x in a["jogadores"][pu]["rounds"] if x["funcao"] in funcoes]
    return resumo_recs(rec_i), resumo_recs(rec_j)


def dados_formacao(ctx, membros, hoje, janela, cfg):
    """Tudo o que o .md e o card de uma formação mostram."""
    juntos = [j for j in janela if set(membros) <= set(j["membros"])]
    trades, dists = Counter(), []
    for j in juntos:
        trades.update({k: v for k, v in j["trades"].items() if k[0] in membros and k[1] in membros})
        dists += j["dists"]
    return {"membros": membros, "juntos": juntos, "trades": trades, "dists": dists,
            "comp": {r: isolado_juntos(ctx, r, juntos) for r in membros},
            "hoje": [x for x in hoje if x["membros"] == membros], "hist": historico_formacao(membros)}


def efeito_juntos(mi, mj, minimo):
    """('mais'|'menos'|'parecido'|None, diferença em pontos por round)."""
    if mi and mj and mi["partidas"] >= minimo and mj["partidas"] >= minimo:
        dif = mj["impacto"] - mi["impacto"]
        return ("mais" if dif >= 3 else "menos" if dif <= -3 else "parecido"), dif
    return None, None


def resumo_semana(ctx, cfg, rids, fim, dias=7):
    """Semana [fim-7d, fim) comparada com a anterior: números por jogador, rounds de destaque e MVP.
    Usado pela aba Semana do site e pelo card de domingo no Discord."""
    ini = fim - timedelta(days=dias)
    ini_ant = ini - timedelta(days=dias)

    def jogos(a0, a1):
        out = {}
        for rid in rids:
            pu = ctx["puuid_de"].get(rid)
            out[rid] = sorted([(a, a["jogadores"][pu]) for a in ctx["analises"].values()
                               if pu and pu in a["jogadores"] and a["inicio"] and a0 <= a["inicio"] < a1],
                              key=lambda x: x[0]["inicio"])
        return out

    def numeros(lst):
        recs = [r for _, j in lst for r in j["rounds"]]
        if not recs:
            return None
        k = sum(j["stats"].get("kills", 0) for _, j in lst)
        m = sum(j["stats"].get("deaths", 0) for _, j in lst)
        v = sum(j["resultado"] == "vitória" for _, j in lst)
        d = sum(j["resultado"] == "derrota" for _, j in lst)
        return {"partidas": len(lst), "v": v, "d": d, "rounds": len(recs),
                "impacto": round(100 * sum(r["wpa"] for r in recs) / len(recs), 2),
                "kd": round(k / m, 2) if m else float(k), "adr": round(sum(r["dano"] for r in recs) / len(recs), 1),
                "kast": round(100 * sum(r["kast"] for r in recs) / len(recs))}

    sem, ant = jogos(ini, fim), jogos(ini_ant, ini)
    jogadores = [{"rid": rid, "semana": numeros(sem[rid]), "anterior": numeros(ant[rid])} for rid in rids]
    partidas = {}
    for lst in sem.values():
        for a, j in lst:
            partidas.setdefault(a["match_id"], (a, j))
    mapas = defaultdict(lambda: [0, 0])
    for a, j in partidas.values():
        if j["resultado"] in ("vitória", "derrota"):
            mapas[a["mapa"]][0 if j["resultado"] == "vitória" else 1] += 1
    rounds = []
    for rid in rids:
        for a, j in sem[rid]:
            for r in j["rounds"]:
                rounds.append((r["wpa"], rid, a, j, r))
    rounds.sort(key=lambda x: -x[0])

    def item(x):
        wpa, rid, a, j, r = x
        resumo, dica, _, ip = descrever_round(r, j["agente"], a["mapa"])
        return {"rid": rid, "match_id": a["match_id"], "n": r["n"], "imp": round(ip, 1), "mapa": a["mapa"],
                "agente": j["agente"], "inicio": a["inicio"].isoformat() if a["inicio"] else None,
                "resumo": resumo, "dica": texto_puro(dica), "tipo": r["tipo"]}

    cands = [x for x in jogadores if x["semana"] and x["semana"]["rounds"] >= 20]
    mvp = max(cands, key=lambda x: x["semana"]["impacto"], default=None)
    return {
        "ini": ini.isoformat(), "fim": fim.isoformat(),
        "partidas": len(partidas), "v": sum(j["resultado"] == "vitória" for _, j in partidas.values()),
        "d": sum(j["resultado"] == "derrota" for _, j in partidas.values()),
        "mapas": dict(mapas), "jogadores": jogadores, "mvp": mvp["rid"] if mvp else None,
        "destaques": [item(x) for x in rounds[:8] if x[0] * 100 >= 15],
        "rever": [item(x) for x in rounds[::-1][:5] if x[0] * 100 <= -15],
    }


SITE_PADRAO = "https://valreport.vercel.app/"


def url_site(cfg):
    """Endereço do site: "site" -> "url_publica" ou o padrão (Vercel).
    O endereço antigo do GitHub Pages é ignorado: o site agora mora na Vercel."""
    site = cfg.get("site") or {}
    url = (site.get("url_publica") or "").strip()
    if url and "github.io" not in url:
        return url.rstrip("/") + "/"
    return SITE_PADRAO


def fim_da_semana_fechada(agora):
    """A semana fecha no domingo às 21h (junto com o report e o card do Discord)."""
    domingo = agora - timedelta(days=(agora.weekday() + 1) % 7)
    fim = domingo.replace(hour=21, minute=0, second=0, microsecond=0)
    return fim if fim <= agora else fim - timedelta(days=7)


def semana_fechada(ctx, cfg, rids, agora, max_semanas=8):
    """Última semana fechada + a coroa: quem foi MVP, há quantas semanas seguidas e de quem tomou a coroa.
    Usado pelo site (semana_fechada.json) e pelo card da Semana no Discord, para os dois mostrarem o mesmo MVP."""
    fim = fim_da_semana_fechada(agora)
    sem = resumo_semana(ctx, cfg, rids, fim)
    seguidas, anterior = (1 if sem["mvp"] else 0), None
    for k in range(1, max_semanas):
        mvp = resumo_semana(ctx, cfg, rids, fim - timedelta(days=7 * k))["mvp"]
        if k == 1:
            anterior = mvp
        if not sem["mvp"] or mvp != sem["mvp"]:
            break
        seguidas += 1
    sem["id"] = fim.date().isoformat()
    sem["seguidas"] = seguidas
    sem["mvp_anterior"] = anterior
    return sem


def md_grupos(ctx, mids_hoje, cfg):
    dia = ctx["dia"]
    dias = cfg["janela_dias"]
    out = [f"# 🤝 Duos, Trios e Five Stack — {datetime.fromisoformat(dia):%d/%m/%Y}", "",
           "*[⬅️ Voltar ao resumo do dia](00_resumo_do_dia.md)*", ""]
    hoje = jogos_em_grupo(ctx, mids_hoje, cfg)
    if not hoje:
        return "\n".join(out + ["> 💤 Nenhuma partida em grupo hoje: todo mundo jogou separado."]), hoje
    salvar_hist_grupos(dia, hoje, cfg)

    mids_janela = [a["match_id"] for a in na_janela(ctx)]
    janela = jogos_em_grupo(ctx, mids_janela, cfg)
    formacoes_hoje = []
    for j in hoje:
        if j["membros"] not in formacoes_hoje:
            formacoes_hoje.append(j["membros"])
    formacoes_hoje.sort(key=lambda m: -len(m))

    out += ["## 📊 Formações de Hoje", "",
            "| Formação | Jogadores | Partidas hoje | V / D | Trades entre vocês | Parceiro em alcance de trade |",
            "| :--- | :--- | :---: | :---: | :---: | :---: |"]
    for membros in formacoes_hoje:
        js = [j for j in hoje if j["membros"] == membros]
        vit = sum(1 for j in js if j["resultado"] == "vitória")
        dists = [d for j in js for d in j["dists"]]
        alc = f"{round(100 * sum(d <= cfg.get('distancia_trade', 1500) for d in dists) / len(dists))}%" if dists else "—"
        out.append(f"| {FORMACAO.get(len(membros), '?')} | {' & '.join(apelido(r, cfg) for r in membros)} | {len(js)} "
                   f"| {vit} / {len(js) - vit} | {sum(sum(j['trades'].values()) for j in js)} | {alc} |")
    out.append("")

    minimo = cfg["min_partidas_grupo"]
    for membros in formacoes_hoje:
        nomes = " & ".join(apelido(r, cfg) for r in membros)
        df = dados_formacao(ctx, membros, hoje, janela, cfg)
        out += ["---", "", f"## 👥 {FORMACAO.get(len(membros), '?')}: {nomes}", ""]

        # Isolado x juntos (janela), comparando só nas funções que a pessoa jogou com o grupo
        out += [f"### ⚖️ Isolado × Juntos (últimos {dias} dias)", "",
                "| Jogador | Isolado: partidas | Impacto/round isolado | KAST isolado | Juntos: partidas "
                "| Impacto/round juntos | KAST juntos | Efeito |",
                "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :--- |"]
        for r in membros:
            mi, mj = df["comp"][r]
            tipo_ef, dif = efeito_juntos(mi, mj, minimo)
            if tipo_ef:
                efeito = {"mais": "📈 rende mais junto", "menos": "📉 rende menos junto",
                          "parecido": "➖ parecido"}[tipo_ef] + f" ({dif:+.1f} pts/round)"
            else:
                efeito = (f"⏳ amostra pequena (precisa de {minimo}+ partidas em cada lado: "
                          f"{mi['partidas'] if mi else 0} isolado, {mj['partidas'] if mj else 0} juntos)")
            col_i = (f"| {mi['partidas']} | {fmt_imp(mi['impacto'])} | {100 * mi['kast']:.0f}% " if mi else "| 0 | — | — ")
            out.append(f"| **{apelido(r, cfg)}** {col_i}| {mj['partidas']} | {fmt_imp(mj['impacto'])} "
                       f"| {100 * mj['kast']:.0f}% | {efeito} |")
        out += ["", "<sub>“Isolado” = partidas sem nenhum outro membro da equipe no time. A comparação usa só as "
                "funções que cada um jogou com o grupo, para não comparar Omen com Jett.</sub>", ""]

        trades, dists = df["trades"], df["dists"]
        out += [f"### 🔁 Quem Troca Quem (últimos {dias} dias)", ""]
        if trades:
            for (quem, trocado), n in trades.most_common():
                out.append(f"* **{apelido(quem, cfg)}** trocou **{apelido(trocado, cfg)}** {n}x")
            menos = [r for r in membros if not any(q == r for (q, _) in trades)]
            if menos:
                verbo = "não trocou" if len(menos) == 1 else "não trocaram"
                out.append(f"* ⚠️ {' e '.join(apelido(r, cfg) for r in menos)} {verbo} ninguém do grupo: "
                           "vale jogar mais perto dos parceiros.")
        else:
            out.append("Nenhuma troca entre vocês. Jogar a uma distância de trade é o que mais aproveita o fato de "
                       "estarem juntos.")
        if dists:
            ds = sorted(dists)
            alc = round(100 * sum(d <= cfg.get("distancia_trade", 1500) for d in ds) / len(ds))
            out += ["", f"📏 **Distância entre vocês:** quando alguém do grupo morreu, o parceiro mais próximo estava a "
                        f"~{metros(ds[len(ds) // 2])} m (mediana). Em **{alc}%** das mortes havia um parceiro a até 15 m."]
        out += ["", f"📺 {tema('isolada', rotulo='▶️ Vídeos sobre trade em dupla')[1]}", ""]

        out += ["### 🗂️ Partidas Juntos Hoje", ""]
        for j in df["hoje"]:
            hora = f"{j['inicio']:%Hh%M}" if j["inicio"] else "?"
            res = "✅" if j["resultado"] == "vitória" else "❌"
            agentes = " & ".join(j["jogs"][r]["agente"] for r in membros)
            out += [f"**{nomes} — {agentes} on {j['mapa']}** · {res} {j['resultado'].capitalize()} {j['placar']} · {hora}", "",
                    "| Jogador | Agente | K/D/A | Impacto total | Impacto/round |",
                    "| :--- | :--- | :---: | :---: | :---: |"]
            for r in membros:
                jj = j["jogs"][r]
                st = jj["stats"]
                tot = sum(x["wpa"] for x in jj["rounds"])
                pr = 100 * tot / len(jj["rounds"]) if jj["rounds"] else 0
                out.append(f"| {apelido(r, cfg)} | {jj['agente']} | {st.get('kills', 0)}/{st.get('deaths', 0)}/"
                           f"{st.get('assists', 0)} | `{fmt_rounds(tot)}` | {fmt_imp(pr)} |")
            out.append("")

        hist = df["hist"]
        if hist:
            vit = sum(1 for h in hist if h["resultado"] == "vitória")
            out += ["### 📜 Histórico da Formação (todas as datas)", "",
                    f"**{len(hist)} partida(s)** · **{vit} vitória(s)** · **Winrate:** {round(100 * vit / len(hist))}%", "",
                    "| Mapa | Partidas | Vitórias | Winrate | Composição mais usada |",
                    "| :--- | :---: | :---: | :---: | :--- |"]
            por_mapa = defaultdict(list)
            for h in hist:
                por_mapa[h["mapa"]].append(h)
            for mapa, hs in sorted(por_mapa.items(), key=lambda x: -len(x[1])):
                v = sum(1 for h in hs if h["resultado"] == "vitória")
                comp = Counter(h["agentes"] for h in hs).most_common(1)[0][0]
                out.append(f"| {mapa} | {len(hs)} | {v} | {round(100 * v / len(hs))}% | {comp} |")
            out.append("")
    return "\n".join(out), hoje


# ----------------------------------------------------------------------------
# Markdown: resumo do dia
# ----------------------------------------------------------------------------

def md_resumo_dia(ctx, resumo, partidas_hoje, avals, n_grupo, cfg):
    dia = ctx["dia"]
    dest, obs, maxr = cfg["destaque_impacto_pct"], cfg["observar_impacto_pct"], cfg["max_rounds_no_resumo"]
    out = [f"# 📅 Resumo do Dia — {datetime.fromisoformat(dia):%d/%m/%Y}", ""]
    if n_grupo:
        out += [f"> 🤝 **{n_grupo} partida(s) em grupo hoje.** [Ver duos, trios e five stack](00_resumo_dos_grupos.md)", ""]
    dias = resumo.get("dias_sem_leitura_antes_deste", 0)
    if dias:
        out += [f"> ⚠️ **{dias} dia(s) sem leitura anteriores.** Partidas jogadas nesses dias (se houver) "
                "entram neste report.", ""]
    if resumo.get("carga_inicial"):
        out += ["> ℹ️ Primeira execução: inclui as últimas partidas disponíveis, não só as de hoje.", ""]

    out += [f"## ⚖️ Avaliação Justa — últimos {cfg['janela_dias']} dias", "",
            "| Jogador | Função | Rounds | Índice (0–100) | Margem | Veredito |",
            "| :--- | :--- | :---: | :---: | :---: | :--- |"]
    for rid in ctx["equipe"]:
        for x in avals.get(rid, [])[:2]:
            out.append(f"| **{apelido(rid, cfg)}** | {x['funcao']} | {x['rounds']} | **{x['indice']}** "
                       f"| {x['margem'][0]}–{x['margem'][1]} | {x['veredito'][0]} {x['veredito'][1]} |")
    out += ["", "50 = média da função nos seus lobbies. [Ver a avaliação completa](00_avaliacao_14_dias.md) · "
            "[🎬 Rounds para conferir no VOD](00_validacao_vod.md)", ""]

    for riot_id, bloco in resumo.get("jogadores", {}).items():
        out += ["---", "", f"## 👤 {apelido(riot_id, cfg)} ({riot_id})", ""]
        if bloco.get("status") == "erro":
            out += [f"> ❌ Não foi possível ler as partidas: {bloco.get('erro')}", ""]
            continue
        ign = bloco.get("filas_ignoradas") or {}
        nota_ign = ("Fora do report: " + ", ".join(f"{n} ({q})" for n, q in ign.items()) + ".") if ign else ""
        lista = partidas_hoje.get(riot_id, [])
        if not lista:
            out += [f"> 💤 Nenhuma partida competitiva nova desde a última leitura. {nota_ign}", ""]
            continue

        recs = [r for a, j, _ in lista for r in j["rounds"]]
        rbs = [av.resumo_basico(a, j) for a, j, _ in lista]
        n = len(lista)
        vit = sum(1 for rb in rbs if rb["resultado"] == "vitória")
        k, m = sum(rb["kills"] for rb in rbs), sum(rb["mortes"] for rb in rbs)
        trocada = sum(1 for r in recs if r["morreu"] and r["trocado"])
        sem_trade = sum(1 for r in recs if r["morreu"] and not r["trocado"])
        dt = av.distancia_de_trade(recs)
        imp_total = sum(r["wpa"] for r in recs)
        out += ["### 📈 Números do Dia", "",
                "| Partidas | V / D | Abates | Mortes | Assistências | Trades feitos | Mortes trocadas | Mortes sem trade |",
                "| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
                f"| {n} | {vit} / {n - vit} | {k} | {m} | {sum(rb['assistencias'] for rb in rbs)} "
                f"| {sum(r['trades_feitos'] for r in recs)} | {trocada} | {sem_trade} |", "",
                f"**Impacto do dia:** `{fmt_rounds(imp_total)}` ({fmt_imp(100 * imp_total / len(recs)) if recs else '0%'} por round) "
                f"· **K/D:** {round(k / m, 2) if m else k} · **First duels:** {sum(r['first_kill'] for r in recs)}–"
                f"{sum(r['first_death'] for r in recs)} · **KAST:** {round(100 * sum(r['kast'] for r in recs) / len(recs)) if recs else 0}%"
                + (f" · **Mortes com aliado a até 15 m:** {dt['em_alcance_pct']}%" if dt else ""), ""]
        if nota_ign:
            out += [f"<sub>{nota_ign}</sub>", ""]

        out += ["### 🗂️ Partidas", "",
                "| Hora | Mapa | Agente | Resultado | K/D/A | Impacto | Report |",
                "| :--- | :--- | :--- | :--- | :---: | :---: | :--- |"]
        for (a, j, arq), rb in zip(lista, rbs):
            hora = f"{a['inicio']:%Hh%M}" if a["inicio"] else "?"
            out.append(f"| {hora} | {a['mapa']} | {j['agente']} | {rb['resultado'].capitalize()} {rb['placar']} "
                       f"| {rb['kills']}/{rb['mortes']}/{rb['assistencias']} | `{fmt_rounds(sum(r['wpa'] for r in j['rounds']))}` "
                       f"| [Abrir]({arq}) |")
        out.append("")

        def linhas_rounds(itens):
            ls = ["| Partida | Round | O que aconteceu | Leitura | Impacto |", "| :--- | :--- | :--- | :--- | :---: |"]
            for a, j, arq, r in itens:
                resumo_r, dica, _, ip = descrever_round(r, j["agente"], a["mapa"])
                ls.append(f"| [{a['mapa']} ({j['agente']})]({arq}) | **R{r['n']}** {NOMES_TIPO[r['tipo']]} "
                          f"| {resumo_r} | {dica} | **{fmt_imp(ip)}** |")
            return ls

        todos = [(a, j, arq, r) for a, j, arq in lista for r in j["rounds"]]
        destaques = sorted([x for x in todos if 100 * x[3]["wpa"] >= dest], key=lambda x: -x[3]["wpa"])
        observar = sorted([x for x in todos if 100 * x[3]["wpa"] <= obs], key=lambda x: x[3]["wpa"])
        for titulo, itens, vazio in ((f"⭐ Rounds de Destaque (impacto de {fmt_imp(dest)} ou mais)", destaques,
                                      "Nenhum round fora da curva para cima hoje."),
                                     (f"👀 Rounds a Observar (impacto de {fmt_imp(obs)} ou menos)", observar,
                                      "Nenhum round preocupante hoje. 💜")):
            out += [f"### {titulo}", ""]
            if itens:
                out += linhas_rounds(itens[:maxr])
                if len(itens) > maxr:
                    out.append(f"\n<sub>+{len(itens) - maxr} outro(s) nos reports de cada partida.</sub>")
            else:
                out.append(vazio)
            out.append("")

        contagem = Counter()
        for a, j, _ in lista:
            for _, _, chaves in habitos(j["rounds"], av.resumo_basico(a, j), j["agente"], a["mapa"],
                                        ctx["refs"][j["funcao"]]):
                contagem.update((ch, j["agente"], a["mapa"]) for ch in chaves)
            for r in j["rounds"]:
                ch = descrever_round(r, j["agente"], a["mapa"])[2]
                if ch:
                    contagem[(ch, j["agente"], a["mapa"])] += 1
        if contagem:
            out += ["### 📚 Foco de Estudo do Dia", ""]
            vistos = set()
            for (ch, ag, mp), qtd in contagem.most_common():
                titulo, link = tema(ch, ag, mp, rotulo="▶️ Assistir")
                if titulo in vistos:
                    continue
                vistos.add(titulo)
                out.append(f"* **{titulo}** ({qtd}x) — {link}")
                if len(vistos) == 5:
                    break
            out.append("")

    out += ["---", "", f"<sub>Rounds com impacto entre {fmt_imp(obs)} e {fmt_imp(dest)} são considerados normais e "
            "ficam só nos reports de cada partida.</sub>"]
    return "\n".join(out)


# ----------------------------------------------------------------------------
# Validação com VOD: você confere alguns rounds por semana e diz se concorda com a leitura
# ----------------------------------------------------------------------------

PASTA_VALIDACAO = DADOS / "validacao"
CAMPOS_VALIDACAO = ["semana", "jogador", "data", "hora_partida", "mapa", "agente", "round", "lado", "tipo",
                    "grupo", "impacto", "o_que_aconteceu", "leitura_da_ferramenta", "sua_avaliacao",
                    "comentario", "match_id", "report"]
RESPOSTAS = {"sim": "sim", "s": "sim", "concordo": "sim", "c": "sim", "nao": "não", "não": "não", "n": "não",
             "discordo": "não", "d": "não", "parcial": "parcial", "p": "parcial", "mais ou menos": "parcial"}


def texto_puro(md):
    md = re.sub(r"\[([^\]]*)\]\([^)]*\)", "", md)
    return re.sub(r"\s+", " ", md.replace("**", "")).strip()


def categoria(dica):
    """Tipo de leitura ('Morte isolada', 'Clutch difícil'...), sem os números que mudam de round para round."""
    texto = texto_puro(dica)
    texto = re.sub(r"\s*\([^)]*\)", "", texto.split(".")[0])
    return texto.strip() or "Round neutro"


def semana_de(dt):
    ano, sem, _ = dt.isocalendar()
    return f"{ano}-S{sem:02d}"


def ler_csv(caminho):
    if not caminho.exists():
        return []
    with open(caminho, encoding="utf-8-sig") as f:
        return list(csv.DictReader(f, delimiter=";"))


def gerar_validacao(ctx, arquivos_partida, cfg):
    """Escolhe, para cada jogador, os rounds mais bem e mais mal avaliados dos últimos 7 dias.
    O CSV da semana é atualizado a cada execução, sem perder o que você já respondeu."""
    n_por = cfg.get("validacao_por_jogador", 3)
    fim = ctx["fim"]
    semana = semana_de(fim - timedelta(days=1))
    arq = PASTA_VALIDACAO / f"validacao_{semana}.csv"
    anteriores = {(r["match_id"], r["jogador"], r["round"]): r for r in ler_csv(arq)}

    linhas = {}
    for rid in ctx["equipe"]:
        pu = ctx["puuid_de"].get(rid)
        if not pu:
            continue
        cands = []
        for a in ctx["analises"].values():
            if not a["inicio"] or a["inicio"] < fim - timedelta(days=7) or pu not in a["jogadores"]:
                continue
            j = a["jogadores"][pu]
            cands += [(a, j, r) for r in j["rounds"]]
        melhores = [x for x in sorted(cands, key=lambda x: -x[2]["wpa"]) if 100 * x[2]["wpa"] >= 15][:n_por]
        piores = [x for x in sorted(cands, key=lambda x: x[2]["wpa"]) if 100 * x[2]["wpa"] <= -10][:n_por]
        for grupo, itens in (("destaque", melhores), ("a observar", piores)):
            for a, j, r in itens:
                resumo_r, dica, _, ip = descrever_round(r, j["agente"], a["mapa"])
                chave = (a["match_id"], apelido(rid, cfg), str(r["n"]))
                velho = anteriores.get(chave, {})
                linhas[chave] = {
                    "semana": semana, "jogador": apelido(rid, cfg), "data": f"{a['inicio']:%d/%m}",
                    "hora_partida": f"{a['inicio']:%Hh%M}", "mapa": a["mapa"], "agente": j["agente"],
                    "round": r["n"], "lado": r["lado"], "tipo": NOMES_TIPO[r["tipo"]], "grupo": grupo,
                    "impacto": fmt_imp(ip), "o_que_aconteceu": resumo_r, "leitura_da_ferramenta": texto_puro(dica),
                    "sua_avaliacao": velho.get("sua_avaliacao", ""), "comentario": velho.get("comentario", ""),
                    "match_id": a["match_id"], "report": arquivos_partida.get((a["match_id"], rid), ""),
                }
    # Rounds que você já respondeu continuam na planilha, mesmo que saiam da seleção
    for chave, velho in anteriores.items():
        if chave not in linhas and (velho.get("sua_avaliacao") or "").strip():
            linhas[chave] = velho

    PASTA_VALIDACAO.mkdir(parents=True, exist_ok=True)
    with open(arq, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS_VALIDACAO, delimiter=";", extrasaction="ignore")
        w.writeheader()
        for linha in sorted(linhas.values(), key=lambda l: (l["jogador"], l["grupo"], l["data"], int(l["round"]))):
            w.writerow(linha)
    return arq, list(linhas.values())


def estatisticas_validacao():
    """Concordância com a ferramenta em todas as semanas respondidas."""
    respondidas = []
    for arq in sorted(PASTA_VALIDACAO.glob("validacao_*.csv")) if PASTA_VALIDACAO.exists() else []:
        for r in ler_csv(arq):
            resp = RESPOSTAS.get((r.get("sua_avaliacao") or "").strip().lower())
            if resp:
                respondidas.append((r, resp))
    if not respondidas:
        return None
    nota = {"sim": 1.0, "parcial": 0.5, "não": 0.0}
    por_cat = defaultdict(list)
    for r, resp in respondidas:
        por_cat[categoria(r.get("leitura_da_ferramenta") or "")].append(nota[resp])
        por_cat[f"[{r.get('grupo')}]"].append(nota[resp])
    return {
        "total": len(respondidas),
        "concordancia": round(100 * sum(nota[x] for _, x in respondidas) / len(respondidas)),
        "por_categoria": {k: (len(v), round(100 * sum(v) / len(v))) for k, v in por_cat.items()},
    }


def md_validacao(ctx, arq, linhas, cfg):
    out = [f"# 🎬 Validação com VOD — semana {semana_de(ctx['fim'] - timedelta(days=1))}", "",
           "*[⬅️ Voltar ao resumo do dia](00_resumo_do_dia.md)*", "",
           "## Como fazer (uns 10 minutos por semana)", "",
           f"1. Abra a planilha **`dados\\validacao\\{arq.name}`** no Excel.",
           "2. Para cada round, assista no replay do jogo (o número do round e o horário da partida estão na planilha).",
           "3. Na coluna **`sua_avaliacao`**, escreva **sim** (concordo), **não** (discordo) ou **parcial**. "
           "Se quiser, explique em `comentario`.",
           "4. Salve. Na próxima execução, a concordância aparece na avaliação de 14 dias e mostra quais leituras "
           "da ferramenta precisam de ajuste.", "",
           "> 💡 Dica: o replay só fica disponível no patch atual, então vale fazer isso na mesma semana.", ""]
    por_jog = defaultdict(list)
    for l in linhas:
        por_jog[l["jogador"]].append(l)
    for jog, ls in por_jog.items():
        out += [f"## 👤 {jog}", "", "| | Partida | Round | O que aconteceu | Leitura da ferramenta | Impacto | Sua avaliação |",
                "| :--- | :--- | :--- | :--- | :--- | :---: | :---: |"]
        for l in ls:
            icone = "⭐" if l["grupo"] == "destaque" else "👀"
            partida = f"[{l['mapa']} ({l['agente']}) {l['data']} {l['hora_partida']}]({l['report']})" if l.get("report") \
                else f"{l['mapa']} ({l['agente']}) {l['data']} {l['hora_partida']}"
            out.append(f"| {icone} | {partida} | R{l['round']} {l['tipo']} | {l['o_que_aconteceu']} "
                       f"| {l['leitura_da_ferramenta']} | {l['impacto']} | {l['sua_avaliacao'] or '—'} |")
        out.append("")
    return "\n".join(out)


def md_secao_validacao(est):
    if not est:
        return ["## 🎬 Validação com VOD", "",
                "Ainda não há rounds conferidos. Veja o arquivo `00_validacao_vod.md` do dia para começar.", ""]
    out = ["## 🎬 Validação com VOD (todas as semanas)", "",
           f"Você conferiu **{est['total']} rounds** e concordou com **{est['concordancia']}%** das leituras da ferramenta.", "",
           "| Leitura | Conferidos | Concordância | |", "| :--- | :---: | :---: | :--- |"]
    for cat, (n, pct) in sorted(est["por_categoria"].items(), key=lambda kv: kv[1][1]):
        alerta = "⚠️ regra a revisar" if n >= 3 and pct < 50 else ("✅" if n >= 3 and pct >= 75 else "")
        out.append(f"| {cat} | {n} | {pct}% | {alerta} |")
    out += ["", "<sub>Leituras com 3+ conferências e menos de 50% de concordância indicam um peso ou uma regra a calibrar.</sub>", ""]
    return out


# ----------------------------------------------------------------------------
# Execução
# ----------------------------------------------------------------------------

def separar_formacoes(texto_grupos, jogos, pasta_dia, cfg):
    """Cada duo/trio/quad ganha a própria pasta com a sua seção do resumo de grupos."""
    secoes = re.split(r"\n---\n\n(?=## 👥 )", texto_grupos)[1:]
    for membros in dict.fromkeys(j["membros"] for j in jogos):
        titulo = f"## 👥 {FORMACAO.get(len(membros), '?')}: {' & '.join(apelido(r, cfg) for r in membros)}"
        corpo = next((x for x in secoes if x.startswith(titulo)), None)
        if not corpo:
            continue
        pasta = pasta_dia / nome_pasta(membros, cfg)
        pasta.mkdir(exist_ok=True)
        arq = "00_formacao.md" if pasta.name == PASTA_EQUIPE else "formacao.md"
        (pasta / arq).write_text(
            "*[⬅️ Voltar ao resumo do dia](" + ("" if pasta.name == PASTA_EQUIPE else "../Toda%20Equipe/")
            + "00_resumo_do_dia.md)*\n\n" + corpo.rstrip() + "\n", encoding="utf-8")


def gerar(dia=None, cfg=None):
    dia = dia or datetime.now(FUSO_BR).date().isoformat()
    cfg = config_padrao(cfg or ler_json(PASTA / "config.json", {}))
    VIDEOS.clear()
    VIDEOS.update(cfg.get("videos") or {})
    resumo = ler_json(PASTA_RESUMOS / f"{dia}.json")
    if not resumo:
        print(f"Nenhum resumo encontrado para {dia}.")
        return None

    ctx = carregar_contexto(dia, cfg)
    pasta_dia = PASTA_REPORTS / dia
    pasta_dia.mkdir(parents=True, exist_ok=True)
    for antigo in pasta_dia.iterdir():  # refazer o dia do zero (pastas e arquivos)
        shutil.rmtree(antigo) if antigo.is_dir() else antigo.unlink()
    pasta_equipe = pasta_dia / PASTA_EQUIPE
    pasta_equipe.mkdir(exist_ok=True)

    multi = len(resumo.get("jogadores", {})) > 1
    partidas_hoje, mids_hoje, contador, arquivos = {}, [], 0, {}
    for riot_id, bloco in resumo.get("jogadores", {}).items():
        nome = riot_id.partition("#")[0]
        pasta_solo = pasta_dia / nome_pasta((riot_id,), cfg)
        lista = []
        for rp in bloco.get("partidas", []):
            a = analise_de(ctx, rp["match_id"], cfg)
            j = av.localizar(a, riot_id) if a else None
            if not j or not j["rounds"]:
                continue
            contador += 1
            pasta_solo.mkdir(exist_ok=True)
            hora = f"{a['inicio']:%Hh%M}" if a["inicio"] else "hora"
            prefixo = f"{nome_arquivo(nome)}_" if multi else ""
            arq = f"{contador:02d}_{prefixo}{nome_arquivo(a['mapa'])}_{nome_arquivo(j['agente'])}_{hora}.md"
            (pasta_solo / arq).write_text(md_partida(a, j, riot_id, ctx, cfg), encoding="utf-8")
            rel = f"../{url_rel(pasta_solo.name)}/{arq}"  # visto a partir de 'Toda Equipe'
            lista.append((a, j, rel))
            arquivos[(rp["match_id"], riot_id)] = rel
            if rp["match_id"] not in mids_hoje:
                mids_hoje.append(rp["match_id"])
        partidas_hoje[riot_id] = lista

    arq_val, linhas_val = gerar_validacao(ctx, arquivos, cfg)
    (pasta_equipe / "00_validacao_vod.md").write_text(md_validacao(ctx, arq_val, linhas_val, cfg), encoding="utf-8")
    avals = avaliacoes_por_jogador(ctx, cfg)
    texto_av = md_avaliacao(ctx, avals, cfg)
    texto_av = texto_av.replace("\n---\n\n<sub>Referências", "\n" + "\n".join(["---", ""] + md_secao_validacao(
        estatisticas_validacao())) + "\n---\n\n<sub>Referências", 1)
    (pasta_equipe / "00_avaliacao_14_dias.md").write_text(texto_av, encoding="utf-8")
    texto_grupos, jogos = md_grupos(ctx, mids_hoje, cfg)
    (pasta_equipe / "00_resumo_dos_grupos.md").write_text(texto_grupos, encoding="utf-8")
    separar_formacoes(texto_grupos, jogos, pasta_dia, cfg)
    (pasta_equipe / "00_resumo_do_dia.md").write_text(
        md_resumo_dia(ctx, resumo, partidas_hoje, avals, len(jogos), cfg), encoding="utf-8")
    try:
        import cards
        cards.gerar_cards(dia, cfg, pasta_dia)
    except ImportError as e:
        print(f"Cards não gerados ({e}). Instale o Pillow: py -m pip install pillow")
    try:
        import discord_envio
        discord_envio.enviar(dia, cfg, pasta_dia)
    except Exception as e:  # o Discord nunca pode derrubar o report
        print(f"Discord não enviado ({e})")
    try:
        import exportar_site
        exportar_site.exportar_e_publicar(cfg)
    except Exception as e:  # o site nunca pode derrubar o report
        print(f"Site não exportado ({e})")
    print(f"Reports salvos em {pasta_dia} ({contador} partida(s) + resumo do dia + avaliação + grupos + cards)")
    return pasta_dia


if __name__ == "__main__":
    gerar(sys.argv[1] if len(sys.argv) > 1 else None)
