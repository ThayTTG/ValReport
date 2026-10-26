#!/usr/bin/env python3
"""
Cards em imagem (PNG) para o Discord — NokyLabs

Tema escuro com detalhes em roxo, formato vertical (1080x1440). Fonte Inter (pasta fontes/, licença SIL OFL).
Cards: Resumo Solo, Agente, Dicas e Mapa de calor (um por jogador) + Equipe, Economia, Mapas,
Mapa de calor da equipe e um card por formação (duo, trio, quad, five stack).

Uso direto (gera os cards de um dia já processado):
    py cards.py 2026-10-23
"""

import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import avaliacao as av
import gerar_report as gr

PASTA = Path(__file__).resolve().parent.parent  # pasta principal do projeto (o código fica em ferramentas/)
PASTA_FONTES = PASTA / "fontes"
PASTA_ICONES = PASTA / "dados" / "cache" / "agentes"

W, H = 1080, 1440   # vertical (3:4): ótimo no celular e confortável no PC
M = 48              # margem

# Paleta: tema escuro com detalhes em roxo (identidade NokyLabs)
FUNDO = (17, 14, 26)
PAINEL = (28, 23, 41)
BORDA = (50, 42, 72)
TEXTO = (240, 236, 248)
SUAVE = (150, 141, 172)
ROXO = (160, 104, 255)
ROXO_ESC = (124, 72, 230)
ROXO_CLARO = (58, 42, 96)
ROXO_TEXTO = (204, 178, 255)
VERDE = (84, 214, 136)
VERDE_CLARO = (26, 54, 40)
VERMELHO = (246, 112, 112)
VERMELHO_CLARO = (66, 30, 38)
AMBAR = (246, 184, 76)
CINZA_CLARO = (44, 38, 62)
OURO = (242, 179, 61)          # MVP, coroa e destaques (o mesmo dourado do site)
OURO_CLARO = (66, 50, 24)
# nomes antigos usados no código
LARANJA, LARANJA_ESC, LARANJA_CLARO = ROXO, ROXO_TEXTO, ROXO_CLARO


# ----------------------------------------------------------------------------
# Fontes e desenho
# ----------------------------------------------------------------------------

_DECIMAL = re.compile(r"(?<=\d)\.(?=\d)")


def br(texto):
    """1.29 -> 1,29 e +10.4% -> +10,4% (números no padrão brasileiro, como no site)."""
    return _DECIMAL.sub(",", texto) if isinstance(texto, str) else texto


class Pincel(ImageDraw.ImageDraw):
    """ImageDraw que escreve os números com vírgula decimal."""

    def text(self, xy, text, *args, **kwargs):
        return super().text(xy, br(text), *args, **kwargs)

    def textlength(self, text, *args, **kwargs):
        return super().textlength(br(text), *args, **kwargs)


# Endereço do site e dono da coroa (preenchidos em gerar_cards)
URL_SITE = ""
COROA = {"rid": None, "seguidas": 0, "anterior": None}

_FONTES = {}
_ARQ_FONTE = {
    "regular": ["Inter-Regular.otf", "segoeui.ttf", "DejaVuSans.ttf"],
    "medio": ["Inter-Medium.otf", "segoeui.ttf", "DejaVuSans.ttf"],
    "semi": ["Inter-SemiBold.otf", "seguisb.ttf", "DejaVuSans-Bold.ttf"],
    "negrito": ["Inter-Bold.otf", "segoeuib.ttf", "DejaVuSans-Bold.ttf"],
    "display": ["InterDisplay-Bold.otf", "Inter-ExtraBold.otf", "segoeuib.ttf", "DejaVuSans-Bold.ttf"],
}
_LOCAIS = [PASTA_FONTES, Path("C:/Windows/Fonts"), Path("/usr/share/fonts/opentype/inter"),
           Path("/usr/share/fonts/truetype/dejavu")]


def fonte(peso, tam):
    chave = (peso, tam)
    if chave not in _FONTES:
        for nome in _ARQ_FONTE[peso]:
            for local in _LOCAIS:
                if (local / nome).exists():
                    _FONTES[chave] = ImageFont.truetype(str(local / nome), tam)
                    break
            if chave in _FONTES:
                break
        else:
            _FONTES[chave] = ImageFont.load_default(tam)
    return _FONTES[chave]


def largura(d, texto, f):
    return d.textlength(texto, font=f)


def quebrar(d, texto, f, max_w, max_linhas=3):
    palavras, linhas, atual = texto.split(), [], ""
    for p in palavras:
        teste = (atual + " " + p).strip()
        if largura(d, teste, f) <= max_w:
            atual = teste
        else:
            linhas.append(atual)
            atual = p
    if atual:
        linhas.append(atual)
    if len(linhas) > max_linhas:
        linhas = linhas[:max_linhas]
        while largura(d, linhas[-1] + "…", f) > max_w and " " in linhas[-1]:
            linhas[-1] = linhas[-1].rsplit(" ", 1)[0]
        linhas[-1] += "…"
    return linhas


def painel(d, x0, y0, x1, y1, cor=PAINEL, raio=22, borda=BORDA):
    d.rounded_rectangle((x0, y0, x1, y1), radius=raio, fill=cor, outline=borda, width=2)


def chip(d, x, y, texto, fundo, cor, f=None, alt=44, pad=20, direita=False):
    f = f or fonte("semi", 22)
    w = largura(d, texto, f) + 2 * pad
    if direita:
        x -= w
    d.rounded_rectangle((x, y, x + w, y + alt), radius=alt // 2, fill=fundo)
    d.text((x + pad, y + alt / 2), texto, font=f, fill=cor, anchor="lm")
    return x + w


BRANCO = (255, 255, 255)


def logo(d, x, y, tam=64):
    d.rounded_rectangle((x, y, x + tam, y + tam), radius=tam // 4, fill=ROXO)
    d.text((x + tam / 2, y + tam / 2 - 2), "n", font=fonte("display", int(tam * 0.72)), fill=BRANCO, anchor="mm")


def selo_agente(img, d, x, y, tam, agente):
    """Ícone do agente (se já estiver no cache) ou um selo com as iniciais."""
    arq = PASTA_ICONES / f"{gr.nome_arquivo(agente)}.png"
    d.ellipse((x, y, x + tam, y + tam), fill=ROXO_CLARO, outline=ROXO, width=3)
    if arq.exists():
        try:
            ic = Image.open(arq).convert("RGBA").resize((tam - 10, tam - 10))
            mask = Image.new("L", ic.size, 0)
            ImageDraw.Draw(mask).ellipse((0, 0) + ic.size, fill=255)
            alpha = Image.composite(ic.getchannel("A"), Image.new("L", ic.size, 0), mask)
            img.paste(ic, (x + 5, y + 5), alpha)
            return
        except OSError:
            pass
    ini = agente[:2].upper() if agente and agente != "?" else "?"
    d.text((x + tam / 2, y + tam / 2), ini, font=fonte("display", int(tam * 0.36)), fill=ROXO_TEXTO, anchor="mm")


def barra_indice(d, x, y, w, valor, lo, hi, alt=18, mostrar_media=True):
    """Barra 0–100 com a faixa da margem e o marcador do índice. A linha marca 50 (média da função)."""
    d.rounded_rectangle((x, y, x + w, y + alt), radius=alt // 2, fill=CINZA_CLARO)
    xa, xb = x + w * lo / 100, x + w * hi / 100
    d.rounded_rectangle((xa, y, max(xb, xa + alt), y + alt), radius=alt // 2, fill=ROXO_CLARO)
    if mostrar_media:
        xm = x + w / 2
        d.line((xm, y - 8, xm, y + alt + 8), fill=SUAVE, width=2)
    xv = x + w * valor / 100
    r = alt * 0.85
    d.ellipse((xv - r, y + alt / 2 - r, xv + r, y + alt / 2 + r), fill=ROXO, outline=TEXTO, width=3)


def cor_sinal(v):
    return VERDE if v > 0.05 else (VERMELHO if v < -0.05 else TEXTO)


def cor_nivel(bom, ruim, valor):
    return VERDE if valor >= bom else (VERMELHO if valor < ruim else AMBAR)


def faixa_marca(d, tipo_card, data_txt):
    """Linha do topo: logo + ValReport by NokyLabs à esquerda; tipo do card, data e endereço do site à direita."""
    logo(d, M, 36, 46)
    d.text((M + 62, 50), "ValReport", font=fonte("negrito", 26), fill=TEXTO, anchor="lm")
    d.text((M + 63, 74), "by NokyLabs", font=fonte("medio", 16), fill=SUAVE, anchor="lm")
    d.text((W - M, 50), f"{tipo_card} · {data_txt}", font=fonte("medio", 22), fill=SUAVE, anchor="rm")
    if URL_SITE:
        d.text((W - M, 77), URL_SITE, font=fonte("semi", 16), fill=ROXO_TEXTO, anchor="rm")


def coroa(d, cx, base, larg):
    """Coroa dourada (o MVP da semana fechada fica com ela até a próxima semana fechar)."""
    a = larg * 0.78
    pts = [(cx - larg / 2, base), (cx - larg / 2, base - a * 0.55), (cx - larg * 0.26, base - a * 0.25), (cx, base - a),
           (cx + larg * 0.26, base - a * 0.25), (cx + larg / 2, base - a * 0.55), (cx + larg / 2, base)]
    d.polygon(pts, fill=OURO, outline=(120, 80, 10))
    r = larg * 0.07
    for x, y in ((cx - larg / 2, base - a * 0.55), (cx, base - a), (cx + larg / 2, base - a * 0.55)):
        d.ellipse((x - r, y - r, x + r, y + r), fill=OURO)
    d.rectangle((cx - larg / 2, base - larg * 0.1, cx + larg / 2, base), fill=(214, 150, 40))


def tem_coroa(rid):
    return bool(COROA["rid"]) and COROA["rid"] == rid


def rotulo(d, x, y, texto, cor=None):
    d.text((x, y), texto.upper(), font=fonte("negrito", 17), fill=cor or SUAVE, anchor="la")


def rodape(d, texto):
    for i, linha in enumerate(quebrar(d, texto, fonte("regular", 18), W - 2 * M, 2)):
        d.text((M, H - 46 + i * 24), linha, font=fonte("regular", 18), fill=SUAVE, anchor="ls")


def veredito_chip(d, x, y, veredito, f=None, direita=False, alt=40):
    _, texto = veredito
    if "insuficientes" in texto:
        fundo, cor = CINZA_CLARO, SUAVE
        texto = "Amostra pequena · " + texto.split("(")[1].split(" ")[0]
    elif "acima" in texto:
        fundo, cor, texto = VERDE_CLARO, VERDE, "Acima da média da função"
    elif "abaixo" in texto:
        fundo, cor, texto = VERMELHO_CLARO, VERMELHO, "Abaixo da média da função"
    else:
        fundo, cor, texto = ROXO_CLARO, ROXO_TEXTO, "Na média da função"
    return chip(d, x, y, texto, fundo, cor, f or fonte("semi", 19), alt=alt, pad=18, direita=direita)


def agente_principal(lista, aval):
    cont = {}
    for _, j in lista:
        cont[j["agente"]] = cont.get(j["agente"], 0) + len(j["rounds"])
    if cont:
        return max(cont, key=cont.get), sorted(cont, key=cont.get, reverse=True)
    ag = aval["recs"][0]["agente"] if aval else "?"
    return ag, [ag] if aval else []


# ----------------------------------------------------------------------------
# Dados
# ----------------------------------------------------------------------------

def dados_do_dia(dia, cfg):
    cfg = gr.config_padrao(cfg)
    resumo = gr.ler_json(gr.PASTA_RESUMOS / f"{dia}.json") or {"jogadores": {}}
    ctx = gr.carregar_contexto(dia, cfg)
    hoje = {}
    for rid, bloco in resumo.get("jogadores", {}).items():
        lista = []
        for rp in bloco.get("partidas", []):
            a = gr.analise_de(ctx, rp["match_id"], cfg)
            j = av.localizar(a, rid) if a else None
            if j and j["rounds"]:
                lista.append((a, j))
        hoje[rid] = lista
    avals = gr.avaliacoes_por_jogador(ctx, cfg)
    mids = list(dict.fromkeys(a["match_id"] for l in hoje.values() for a, _ in l))
    jogos = gr.jogos_em_grupo(ctx, mids, cfg)
    return cfg, ctx, hoje, avals, jogos


# ----------------------------------------------------------------------------
# Card: Resumo Solo (vertical)
# ----------------------------------------------------------------------------

def card_solo(rid, cfg, ctx, hoje, avals, dia):
    img = Image.new("RGB", (W, H), FUNDO)
    d = Pincel(img)
    lista = hoje.get(rid, [])
    recs = [r for _, j in lista for r in j["rounds"]]
    aval = (avals.get(rid) or [None])[0]
    agente, agentes = agente_principal(lista, aval)
    funcao = av.funcao_do_agente(agente, cfg)
    faixa_marca(d, "Resumo Solo", f"{datetime.fromisoformat(dia):%d/%m/%Y}")

    # Jogador
    selo_agente(img, d, M, 112, 132, agente)
    nome = gr.apelido(rid, cfg)
    d.text((M + 160, 118), nome, font=fonte("display", 64), fill=TEXTO, anchor="la")
    d.text((M + 162, 196), rid, font=fonte("medio", 23), fill=SUAVE, anchor="la")
    xc = chip(d, M + 160, 232, funcao.upper(), ROXO, BRANCO, fonte("negrito", 19), alt=38, pad=16) + 10
    for ag in agentes[:3]:
        xc = chip(d, xc, 232, ag, CINZA_CLARO, TEXTO, fonte("semi", 19), alt=38, pad=14) + 8

    # Índice (janela)
    y0, y1 = 300, 590
    painel(d, M, y0, W - M, y1)
    rotulo(d, M + 32, y0 + 30, f"Índice de {(aval['funcao'] if aval else funcao)}")
    d.text((W - M - 32, y0 + 30), f"últimos {cfg['janela_dias']} dias", font=fonte("medio", 19), fill=SUAVE, anchor="ra")
    if aval:
        d.text((M + 26, y0 + 210), str(aval["indice"]), font=fonte("display", 170), fill=ROXO, anchor="ls")
        wnum = largura(d, str(aval["indice"]), fonte("display", 170))
        d.text((M + 36 + wnum, y0 + 210), "/100", font=fonte("semi", 38), fill=SUAVE, anchor="ls")
        xr = M + 60 + wnum + largura(d, "/100", fonte("semi", 38))
        d.text((xr, y0 + 112), f"margem {aval['margem'][0]}–{aval['margem'][1]}", font=fonte("semi", 24), fill=TEXTO, anchor="la")
        d.text((xr, y0 + 146), f"{aval['rounds']} rounds · {aval['partidas']} partidas", font=fonte("regular", 20),
               fill=SUAVE, anchor="la")
        veredito_chip(d, xr - 2, y0 + 180, aval["veredito"])
        barra_indice(d, M + 32, y0 + 232, W - 2 * M - 64, aval["indice"], *aval["margem"])
        d.text((W / 2, y0 + 258), "linha = média da função no seu lobby (50)", font=fonte("regular", 18),
               fill=SUAVE, anchor="ma")
    else:
        d.text((M + 32, y0 + 150), "Sem partidas na janela", font=fonte("semi", 30), fill=SUAVE, anchor="la")

    # Números do dia (3 x 2)
    rbs = [av.resumo_basico(a, j) for a, j in lista]
    vit = sum(1 for rb in rbs if rb["resultado"] == "vitória")
    k, m, ast = (sum(rb[c] for rb in rbs) for c in ("kills", "mortes", "assistencias"))
    imp = sum(r["wpa"] for r in recs)
    n_r = len(recs) or 1
    tiles = [
        ("Partidas hoje", f"{len(lista)}", f"{vit}V · {len(lista) - vit}D", TEXTO),
        ("Impacto do dia", f"{imp:+.1f}", f"rounds · {100 * imp / n_r:+.0f}%/round", cor_sinal(imp)),
        ("K / D / A", f"{k}/{m}/{ast}", f"K/D {k / m:.2f}" if m else "sem mortes", TEXTO),
        ("KAST", f"{round(100 * sum(r['kast'] for r in recs) / n_r)}%", "participação", TEXTO),
        ("ADR", f"{round(sum(r['dano'] for r in recs) / n_r)}", "dano por round", TEXTO),
        ("First duels", f"{sum(r['first_kill'] for r in recs)}–{sum(r['first_death'] for r in recs)}",
         "abriu – foi aberta", TEXTO),
    ]
    gap = 18
    tw, th = (W - 2 * M - 2 * gap) // 3, 132
    for i, (rot, val, sub, cor) in enumerate(tiles):
        x = M + (i % 3) * (tw + gap)
        y = 614 + (i // 3) * (th + gap)
        painel(d, x, y, x + tw, y + th, raio=18)
        rotulo(d, x + 22, y + 20, rot)
        val_f = fonte("display", 44 if largura(d, val, fonte("display", 44)) < tw - 40 else 34)
        d.text((x + 22, y + 82), val, font=val_f, fill=cor, anchor="ls")
        d.text((x + 22, y + 94), sub, font=fonte("regular", 18), fill=SUAVE, anchor="la")

    # Kit e trade
    y = 614 + 2 * (th + gap)
    painel(d, M, y, W - M, y + 118, raio=18)
    kit = av.uso_do_kit(recs, ctx["refs"][funcao]) if recs else None
    dt = av.distancia_de_trade(recs)
    meio = W // 2
    if kit:
        rotulo(d, M + 24, y + 20, "Kit")
        d.text((M + 24, y + 50), f"{kit['util_pr']:.1f} habilidades/round", font=fonte("semi", 25),
               fill=cor_nivel(0.9, 0.7, kit["util_rel"]), anchor="la")
        d.text((M + 24, y + 84), f"média de {funcao.lower()}: {kit['util_ref']:.1f}", font=fonte("regular", 18),
               fill=SUAVE, anchor="la")
    d.line((meio, y + 20, meio, y + 98), fill=BORDA, width=2)
    if dt:
        rotulo(d, meio + 24, y + 20, "Trade")
        d.text((meio + 24, y + 50), f"{dt['em_alcance_pct']}% com aliado perto", font=fonte("semi", 25),
               fill=cor_nivel(60, 45, dt["em_alcance_pct"]), anchor="la")
        d.text((meio + 24, y + 84), f"até 15 m · mediana {dt['mediana_m']} m", font=fonte("regular", 18),
               fill=SUAVE, anchor="la")

    # Melhor round / para observar (empilhados)
    todos = [(a, j, r) for a, j in lista for r in j["rounds"]]
    caixas = [("Melhor round", max(todos, key=lambda x: x[2]["wpa"], default=None), VERDE, lambda v: v >= 10),
              ("Para observar", min(todos, key=lambda x: x[2]["wpa"], default=None), VERMELHO, lambda v: v <= -10)]
    yb = y + 118 + 24
    alt_b = (H - 70 - yb - 18) // 2
    for i, (rot, item, cor, ok) in enumerate(caixas):
        y0b = yb + i * (alt_b + 18)
        painel(d, M, y0b, W - M, y0b + alt_b, raio=18)
        d.rounded_rectangle((M, y0b, M + 10, y0b + alt_b), radius=5, fill=cor)
        rotulo(d, M + 32, y0b + 22, rot)
        if not item or not ok(100 * item[2]["wpa"]):
            d.text((M + 32, y0b + 70), "Nada fora da curva hoje.", font=fonte("semi", 26), fill=SUAVE, anchor="la")
            continue
        a, j, r = item
        resumo_r, dica, _, ip = gr.descrever_round(r, j["agente"], a["mapa"])
        d.text((W - M - 28, y0b + 14), gr.fmt_imp(ip), font=fonte("display", 54), fill=cor, anchor="ra")
        d.text((M + 32, y0b + 52), f"{a['mapa']} · R{r['n']} · {gr.NOMES_TIPO[r['tipo']]} · {j['agente']}",
               font=fonte("semi", 25), fill=TEXTO, anchor="la")
        texto = resumo_r + " " + gr.categoria(dica) + "."
        for li, linha in enumerate(quebrar(d, texto, fonte("regular", 21), W - 2 * M - 64, 3)):
            d.text((M + 32, y0b + 98 + li * 29), linha, font=fonte("regular", 21), fill=TEXTO, anchor="la")

    rodape(d, "Impacto = quanto as suas ações mudaram a chance do time vencer o round.")
    return img


# ----------------------------------------------------------------------------
# Card: Equipe (vertical)
# ----------------------------------------------------------------------------

def card_equipe(cfg, ctx, hoje, avals, jogos, dia):
    img = Image.new("RGB", (W, H), FUNDO)
    d = Pincel(img)
    faixa_marca(d, "Report Diário", f"{datetime.fromisoformat(dia):%d/%m/%Y}")
    d.text((M - 3, 112), "Equipe", font=fonte("display", 68), fill=TEXTO, anchor="la")
    n_hoje = len({a["match_id"] for l in hoje.values() for a, _ in l})
    d.text((M, 196), f"{n_hoje} partidas hoje · índice por função dos últimos {cfg['janela_dias']} dias",
           font=fonte("medio", 22), fill=SUAVE, anchor="la")

    y, alt, gap = 248, 150, 14
    for rid in ctx["equipe"]:
        aval = (avals.get(rid) or [None])[0]
        agente, _ = agente_principal(hoje.get(rid, []), aval)
        painel(d, M, y, W - M, y + alt, raio=20)
        selo_agente(img, d, M + 22, y + 22, 76, agente)
        d.text((M + 118, y + 24), gr.apelido(rid, cfg), font=fonte("negrito", 32), fill=TEXTO, anchor="la")
        if tem_coroa(rid):
            coroa(d, M + 60, y + 30, 40)
            xn = M + 118 + largura(d, gr.apelido(rid, cfg), fonte("negrito", 32)) + 12
            chip(d, xn, y + 26, "MVP da semana", OURO_CLARO, OURO, fonte("semi", 16), alt=30, pad=12)
        partidas = len(hoje.get(rid, []))
        if aval:
            sub = f"{aval['funcao']} · {agente}" + (f" · {partidas} hoje" if partidas else "")
        else:
            sub = "sem partidas competitivas na janela"
        d.text((M + 119, y + 66), sub, font=fonte("regular", 20), fill=SUAVE, anchor="la")
        if aval:
            d.text((W - M - 28, y + 74), str(aval["indice"]), font=fonte("display", 64), fill=ROXO, anchor="rs")
            barra_indice(d, M + 120, y + 110, 330, aval["indice"], *aval["margem"], alt=12)
            ip = aval["metricas"]["impacto"]
            d.text((M + 478, y + 116), f"{ip:+.1f}%", font=fonte("negrito", 24), fill=cor_sinal(ip / 100), anchor="lm")
            d.text((M + 478 + largura(d, f"{ip:+.1f}%", fonte("negrito", 24)) + 6, y + 117), "/round",
                   font=fonte("regular", 18), fill=SUAVE, anchor="lm")
            veredito_chip(d, W - M - 24, y + 96, aval["veredito"], fonte("semi", 18), direita=True, alt=36)
        y += alt + gap

    # Formações do dia
    yb = y + 10
    painel(d, M, yb, W - M, H - 76, raio=20)
    rotulo(d, M + 28, yb + 24, "Formações de hoje")
    formacoes = []
    for j in jogos:
        if j["membros"] not in [f for f, _ in formacoes]:
            formacoes.append((j["membros"], [x for x in jogos if x["membros"] == j["membros"]]))
    if not formacoes:
        d.text((M + 28, yb + 66), "Ninguém da equipe jogou junto hoje.", font=fonte("semi", 24), fill=SUAVE, anchor="la")
    yf = yb + 62
    for membros, js in formacoes[:3]:
        vit = sum(1 for j in js if j["resultado"] == "vitória")
        trades = sum(sum(j["trades"].values()) for j in js)
        dists = [dd for j in js for dd in j["dists"]]
        alc = round(100 * sum(dd <= cfg.get("distancia_trade", 1500) for dd in dists) / len(dists)) if dists else None
        x2 = chip(d, M + 28, yf, gr.FORMACAO.get(len(membros), "?").upper(), ROXO, BRANCO, fonte("negrito", 17),
                  alt=34, pad=14) + 12
        d.text((x2, yf + 17), " · ".join(gr.apelido(r, cfg) for r in membros), font=fonte("semi", 23),
               fill=TEXTO, anchor="lm")
        detalhe = f"{len(js)} partida{'s' if len(js) > 1 else ''} · {vit}V {len(js) - vit}D · {trades} trade{'s' if trades != 1 else ''} entre vocês"
        if alc is not None:
            detalhe += f" · parceiro a ≤15 m em {alc}% das mortes"
        for li, linha in enumerate(quebrar(d, detalhe, fonte("regular", 19), W - 2 * M - 56, 2)):
            d.text((M + 28, yf + 46 + li * 24), linha, font=fonte("regular", 19), fill=SUAVE, anchor="la")
        yf += 96
    rodape(d, "Índice por função: 50 = média da função nos lobbies de vocês. Faixa roxa da barra = margem de confiança.")
    return img


# ----------------------------------------------------------------------------
# Auxiliares dos cards novos
# ----------------------------------------------------------------------------

def jogos_na_janela(ctx, rid):
    """[(análise, jogador)] da janela de avaliação para um jogador da equipe."""
    pu = ctx["puuid_de"].get(rid)
    return [(a, a["jogadores"][pu]) for a in gr.na_janela(ctx) if pu in a["jogadores"]] if pu else []


def cor_pp(v, lim=1.0):
    return VERDE if v >= lim else (VERMELHO if v <= -lim else TEXTO)


def tile(d, x, y, w, h, rot, val, sub, cor=TEXTO):
    painel(d, x, y, x + w, y + h, raio=18)
    rotulo(d, x + 22, y + 18, rot)
    f = fonte("display", 44 if largura(d, val, fonte("display", 44)) < w - 40 else 34)
    d.text((x + 22, y + 82), val, font=f, fill=cor, anchor="ls")
    d.text((x + 22, y + 90), sub, font=fonte("regular", 18), fill=SUAVE, anchor="la")


def cabecalho_jogador(img, d, rid, cfg, titulo, agente, funcao, extras=()):
    selo_agente(img, d, M, 112, 132, agente)
    d.text((M + 160, 118), titulo, font=fonte("display", 64), fill=TEXTO, anchor="la")
    d.text((M + 162, 196), f"{gr.apelido(rid, cfg)} · {rid}", font=fonte("medio", 23), fill=SUAVE, anchor="la")
    xc = chip(d, M + 160, 232, funcao.upper(), ROXO, BRANCO, fonte("negrito", 19), alt=38, pad=16) + 10
    for t in extras[:3]:
        xc = chip(d, xc, 232, t, CINZA_CLARO, TEXTO, fonte("semi", 19), alt=38, pad=14) + 8


def pct(a, b):
    return round(100 * a / b) if b else 0


TEAL = (59, 179, 195)  # defesa (o mesmo tom do site)

# Estilo de jogo pelas armas (os mesmos textos da aba Armas do site)
FAMILIA = {
    "Operator": "longa", "Marshal": "longa", "Outlaw": "longa", "Warden": "longa",
    "Vandal": "rifle", "Phantom": "rifle", "Bulldog": "rifle",
    "Guardian": "precisao", "Sheriff": "precisao", "Ghost": "precisao",
    "Spectre": "curta", "Stinger": "curta", "Bucky": "curta", "Judge": "curta", "Shorty": "curta",
    "Ares": "pesada", "Odin": "pesada",
    "Classic": "pistola", "Frenzy": "pistola", "Bandit": "pistola",
}
TEXTO_FAMILIA = {
    "longa": "O seu jogo é preciso e meticuloso: você busca vantagem com picks a longa distância e abates que mudam o round logo no começo.",
    "rifle": "O seu jogo gira em torno do rifle: duelos de média distância, posicionamento firme e consistência round após round.",
    "precisao": "Você gosta de tiro calculado: poucas balas, paciência e mira na altura da cabeça para vencer o duelo no primeiro acerto.",
    "curta": "O seu jogo é agressivo e de perto: entradas rápidas, cantos fechados e pressão em cima de quem está segurando o site.",
    "pesada": "Você segura espaço com volume de fogo: spam nas entradas, wallbang e controle de área para atrasar o inimigo.",
    "pistola": "Você aproveita muito bem os rounds de economia: boa parte dos seus abates sai da arma secundária, o que rende rounds baratos.",
}
DETALHE_ARMA = {
    "Vandal": "A Vandal na frente mostra preferência pelo tiro certeiro: um acerto na cabeça resolve em qualquer distância.",
    "Phantom": "A Phantom na frente mostra preferência por spray controlado e ângulos de média distância.",
    "Operator": "Com a Operator, cada pick seu dá vantagem numérica para o time.",
    "Sheriff": "Com a Sheriff, você transforma round de economia em ameaça real.",
    "Ghost": "A Ghost mostra calma nos rounds de pistola e eco: tiro a tiro, sem desperdiçar bala.",
}
COMPLEMENTO = {
    "longa": "E ainda puxa a {} para segurar ângulos longos.",
    "rifle": "Quando o dinheiro permite, a {} é a base.",
    "precisao": "Nos rounds mais apertados, a {} entra com tiro calculado, sem desperdiçar bala.",
    "curta": "A {} aparece nos momentos de entrar rápido ou segurar de perto.",
    "pesada": "A {} entra para segurar spam e controle de área.",
    "pistola": "Nos ecos, a {} ainda garante abates.",
}


def estilo_de_jogo(nomes, total, com_lista=True):
    lista = f"{', '.join(nomes[:-1])} e {nomes[-1]}" if len(nomes) > 1 else nomes[0]
    fam = FAMILIA.get(nomes[0], "rifle")
    frases = ([f"{lista}."] if com_lista else []) + [TEXTO_FAMILIA[fam]]
    if nomes[0] in DETALHE_ARMA:
        frases.append(DETALHE_ARMA[nomes[0]])
    outra = next((n for n in nomes[1:] if FAMILIA.get(n, "rifle") != fam), None)
    if outra:
        frases.append(COMPLEMENTO[FAMILIA.get(outra, "rifle")].format(outra))
    if total < 15:
        frases.append(f"(Ainda são só {total} abates; o retrato fica mais fiel com mais partidas.)")
    return " ".join(frases)


# ----------------------------------------------------------------------------
# Card: Agente (vertical)
# ----------------------------------------------------------------------------

def card_agente(rid, cfg, ctx, hoje, avals, dia):
    from collections import Counter, defaultdict
    img = Image.new("RGB", (W, H), FUNDO)
    d = Pincel(img)
    aval = (avals.get(rid) or [None])[0]
    agente, _ = agente_principal(hoje.get(rid, []), aval)
    funcao = av.funcao_do_agente(agente, cfg)
    faixa_marca(d, "Agente", f"{datetime.fromisoformat(dia):%d/%m/%Y}")

    jan = jogos_na_janela(ctx, rid)
    por_ag = defaultdict(list)
    partidas_ag = Counter()
    for a, j in jan:
        por_ag[j["agente"]].extend(j["rounds"])
        partidas_ag[j["agente"]] += 1
    recs = por_ag.get(agente, [])
    outros = [x for x in sorted(por_ag, key=lambda k: -len(por_ag[k])) if x != agente]
    cabecalho_jogador(img, d, rid, cfg, agente, agente, funcao, outros)

    m = av.metricas(recs)
    ref = ctx["refs"].get(funcao)

    # Impacto do agente na janela
    y0, y1 = 300, 500
    painel(d, M, y0, W - M, y1)
    rotulo(d, M + 32, y0 + 28, f"Impacto com {agente}")
    d.text((W - M - 32, y0 + 28), f"últimos {cfg['janela_dias']} dias", font=fonte("medio", 19), fill=SUAVE, anchor="ra")
    if m:
        d.text((M + 30, y0 + 152), f"{m['impacto']:+.1f}%", font=fonte("display", 104), fill=cor_pp(m["impacto"], 0.5),
               anchor="ls")
        xr = M + 60 + largura(d, f"{m['impacto']:+.1f}%", fonte("display", 104))
        d.text((xr, y0 + 74), "por round", font=fonte("semi", 24), fill=TEXTO, anchor="la")
        d.text((xr, y0 + 108), f"{len(recs)} rounds · {partidas_ag[agente]} partida{'s' if partidas_ag[agente] != 1 else ''}",
               font=fonte("regular", 20), fill=SUAVE, anchor="la")
        if ref and "impacto" in ref:
            d.text((M + 32, y0 + 166), f"média de {funcao.lower()} nos seus lobbies: {ref['impacto'][0]:+.1f}% por round",
                   font=fonte("regular", 20), fill=SUAVE, anchor="la")
    else:
        d.text((M + 32, y0 + 90), "Sem rounds com este agente na janela", font=fonte("semi", 28), fill=SUAVE, anchor="la")

    # Tiles
    if m:
        win = pct(sum(r["venceu"] for r in recs), len(recs))
        kills, mortes = sum(r["kills"] for r in recs), sum(r["morreu"] for r in recs)
        tiles = [
            ("K/D", f"{kills / mortes:.2f}" if mortes else f"{kills}", f"{kills} abates · {mortes} mortes", TEXTO),
            ("ADR", f"{m['adr']:.0f}", "dano por round", TEXTO),
            ("KAST", f"{round(100 * m['kast'])}%", "participação", TEXTO),
            ("Rounds vencidos", f"{win}%", "taxa de vitória", cor_nivel(55, 45, win)),
            ("First duels", f"{sum(r['first_kill'] for r in recs)}–{sum(r['first_death'] for r in recs)}",
             "abriu – foi aberta", TEXTO),
            ("Trades", f"{sum(r['trades_feitos'] for r in recs)}", "feitos pelo time", TEXTO),
        ]
        gap, th = 18, 124
        tw = (W - 2 * M - 2 * gap) // 3
        for i, (rot, val, sub, cor) in enumerate(tiles):
            tile(d, M + (i % 3) * (tw + gap), 520 + (i // 3) * (th + gap), tw, th, rot, val, sub, cor)

    # Kit
    yk = 520 + 2 * (124 + 18) + 2
    painel(d, M, yk, W - M, yk + 132, raio=18)
    kit = av.uso_do_kit(recs, ref) if recs and ref else None
    cols = (W - 2 * M) // 3
    if kit:
        blocos = [
            ("Habilidades / round", f"{kit['util_pr']:.1f}", f"média da função: {kit['util_ref']:.1f}",
             cor_nivel(0.9, 0.7, kit["util_rel"])),
            ("Ultimates / partida", f"{kit['ult_partida']:.1f}", f"média da função: {kit['ult_ref_partida']:.1f}", TEXTO),
            ("Assist. a cada 10 hab.", f"{kit['assist_por_10']:.1f}", f"média da função: {kit['assist_por_10_ref']:.1f}",
             TEXTO),
        ]
        for i, (rot, val, sub, cor) in enumerate(blocos):
            x = M + i * cols + 24
            rotulo(d, x, yk + 20, rot)
            d.text((x, yk + 88), val, font=fonte("display", 44), fill=cor, anchor="ls")
            d.text((x, yk + 98), sub, font=fonte("regular", 18), fill=SUAVE, anchor="la")
            if i:
                d.line((M + i * cols, yk + 20, M + i * cols, yk + 112), fill=BORDA, width=2)
    else:
        d.text((M + 28, yk + 50), "Kit: amostra pequena", font=fonte("semi", 26), fill=SUAVE, anchor="la")

    # Ataque × Defesa: barras espelhadas (ataque à esquerda, defesa à direita), como no site
    ys = yk + 132 + 20
    painel(d, M, ys, W - M, ys + 196, raio=18)
    lados = {lado: [r for r in recs if r["lado"] == lado] for lado in ("ataque", "defesa")}
    cx = W // 2

    def resumo_lado(rs):
        if not rs:
            return None
        k, mo = sum(r["kills"] for r in rs), sum(r["morreu"] for r in rs)
        return {"vit": 100 * sum(r["venceu"] for r in rs) / len(rs), "imp": 100 * sum(r["wpa"] for r in rs) / len(rs),
                "kd": k / mo if mo else float(k), "n": len(rs)}
    A, D = resumo_lado(lados["ataque"]), resumo_lado(lados["defesa"])
    rotulo(d, M + 24, ys + 20, "Ataque", ROXO_TEXTO)
    rotulo(d, W - M - 24 - largura(d, "DEFESA", fonte("negrito", 17)), ys + 20, "Defesa", TEAL)
    if A:
        d.text((M + 24, ys + 44), f"{A['n']} rounds", font=fonte("regular", 17), fill=SUAVE, anchor="la")
    if D:
        d.text((W - M - 24, ys + 44), f"{D['n']} rounds", font=fonte("regular", 17), fill=SUAVE, anchor="ra")
    linhas = [("Rounds vencidos", "vit", lambda v: f"{v:.0f}%"), ("Impacto/round", "imp", lambda v: f"{v:+.1f}%"),
              ("K/D", "kd", lambda v: f"{v:.2f}")]
    xa0, xa1, xd0, xd1 = M + 120, cx - 6, cx + 6, W - M - 120
    for i, (rot, k, fmt) in enumerate(linhas):
        yy = ys + 78 + i * 38
        d.text((cx, yy - 1), rot, font=fonte("semi", 14), fill=SUAVE, anchor="ms")
        va, vd = (A or {}).get(k), (D or {}).get(k)
        maior = max(abs(va or 0), abs(vd or 0)) or 1
        for v, (x0, x1), cor, lado in ((va, (xa0, xa1), ROXO, "a"), (vd, (xd0, xd1), TEAL, "d")):
            d.rounded_rectangle((x0, yy + 4, x1, yy + 16), radius=6, fill=CINZA_CLARO)
            if v:
                w = (x1 - x0) * abs(v) / maior
                caixa = (x1 - w, yy + 4, x1, yy + 16) if lado == "a" else (x0, yy + 4, x0 + w, yy + 16)
                d.rounded_rectangle(caixa, radius=6, fill=VERMELHO if v < 0 else cor)
        d.text((M + 24, yy + 10), fmt(va) if va is not None else "—", font=fonte("negrito", 20), fill=TEXTO, anchor="lm")
        d.text((W - M - 24, yy + 10), fmt(vd) if vd is not None else "—", font=fonte("negrito", 20), fill=TEXTO, anchor="rm")

    # Top 3 armas + estilo de jogo (o mesmo texto do site)
    yw = ys + 196 + 16
    painel(d, M, yw, W - M, H - 80, raio=18)
    armas = Counter(w for r in recs for w in r["armas_kills"] if w in FAMILIA)
    top = armas.most_common(3)
    rotulo(d, M + 24, yw + 18, "Top 3 armas · estilo de jogo" + (" · poucos abates ainda" if sum(armas.values()) < 15 else ""))
    if top:
        total = sum(armas.values())
        cw = (W - 2 * M - 48) / 3
        for i, (arma, n) in enumerate(top):
            x = M + 24 + i * cw
            ouro = i == 0
            d.rounded_rectangle((x, yw + 44, x + cw - 12, yw + 98), radius=14, fill=OURO_CLARO if ouro else CINZA_CLARO,
                                outline=OURO if ouro else None, width=2)
            d.text((x + 14, yw + 54), f"{i + 1}º", font=fonte("negrito", 16), fill=OURO if ouro else SUAVE, anchor="la")
            d.text((x + 48, yw + 50), arma, font=fonte("negrito", 22), fill=TEXTO, anchor="la")
            d.text((x + 48, yw + 76), f"{n} abate{'s' if n != 1 else ''} · {pct(n, total)}%", font=fonte("regular", 16), fill=SUAVE, anchor="la")
        texto = estilo_de_jogo([a for a, _ in top], 99, com_lista=False)  # o aviso de amostra fica no título
        for li, linha in enumerate(quebrar(d, texto, fonte("regular", 18), W - 2 * M - 48, 3)):
            d.text((M + 24, yw + 110 + li * 24), linha, font=fonte("regular", 18), fill=TEXTO, anchor="la")
    else:
        d.text((M + 24, yw + 60), "Sem abates com armas na janela", font=fonte("regular", 20), fill=SUAVE, anchor="la")

    rodape(d, "Mesmo agente, mesma função: a comparação é sempre com a média da função nos lobbies de vocês.")
    return img


# ----------------------------------------------------------------------------
# Card: Economia (vertical, equipe)
# ----------------------------------------------------------------------------

ORDEM_TIPOS = ("pistol", "eco", "force", "armado", "anti-eco")


def card_economia(cfg, ctx, hoje, avals, jogos, dia):
    from collections import Counter
    img = Image.new("RGB", (W, H), FUNDO)
    d = Pincel(img)
    faixa_marca(d, "Economia", f"{datetime.fromisoformat(dia):%d/%m/%Y}")
    d.text((M - 3, 112), "Economia", font=fonte("display", 68), fill=TEXTO, anchor="la")
    tot = [(rid, a, j, r) for rid, l in hoje.items() for a, j in l for r in j["rounds"]]
    n_part = len({a["match_id"] for _, a, _, _ in tot})
    d.text((M, 196), f"como a equipe rendeu em cada tipo de round hoje · {n_part} partidas",
           font=fonte("medio", 22), fill=SUAVE, anchor="la")

    y, alt, gap = 248, 120, 12
    melhor = None
    for tipo in ORDEM_TIPOS:
        rs = [(rid, a, j, r) for rid, a, j, r in tot if r["tipo"] == tipo]
        painel(d, M, y, W - M, y + alt, raio=18)
        chip(d, M + 24, y + 20, gr.NOMES_TIPO[tipo].upper(), ROXO, BRANCO, fonte("negrito", 17), alt=34, pad=14)
        if not rs:
            d.text((M + 24, y + 70), "nenhum round deste tipo hoje", font=fonte("regular", 20), fill=SUAVE, anchor="la")
            y += alt + gap
            continue
        unicos = {}
        for rid, a, j, r in rs:
            unicos[(a["match_id"], r["n"])] = r["venceu"]
        n_u = len(unicos)
        win = pct(sum(unicos.values()), n_u)
        k, mo = sum(r["kills"] for *_, r in rs), sum(r["morreu"] for *_, r in rs)
        adr = sum(r["dano"] for *_, r in rs) / len(rs)
        ip = 100 * sum(r["wpa"] for *_, r in rs) / len(rs)
        armas = Counter(r["arma"] for *_, r in rs).most_common(2)
        d.text((M + 24 + 150, y + 22), f"{n_u} rounds · {win}% vencidos", font=fonte("semi", 22), fill=TEXTO, anchor="la")
        # barra de vitórias
        bx, bw = M + 24, 560
        d.rounded_rectangle((bx, y + 70, bx + bw, y + 84), radius=7, fill=CINZA_CLARO)
        d.rounded_rectangle((bx, y + 70, bx + max(14, bw * win / 100), y + 84), radius=7, fill=ROXO)
        d.text((bx, y + 94), f"K/D {k / mo:.2f}" if mo else f"{k} abates, 0 mortes", font=fonte("regular", 19), fill=SUAVE,
               anchor="la")
        d.text((bx + 150, y + 94), f"ADR {adr:.0f}", font=fonte("regular", 19), fill=SUAVE, anchor="la")
        d.text((bx + 270, y + 94), " · ".join(f"{a_} ({n})" for a_, n in armas), font=fonte("regular", 19), fill=SUAVE,
               anchor="la")
        d.text((W - M - 28, y + 16), f"{ip:+.1f}%", font=fonte("display", 54), fill=cor_pp(ip, 0.5), anchor="ra")
        d.text((W - M - 28, y + 86), "impacto por round", font=fonte("regular", 18), fill=SUAVE, anchor="ra")
        if len(rs) >= 8 and (melhor is None or ip > melhor[1]):
            melhor = (tipo, ip)
        y += alt + gap

    # Matriz por jogador
    n_jog = sum(1 for rid in ctx["equipe"] if hoje.get(rid))
    fim_m = y + 6 + 62 + 34 + 52 * n_jog + 8
    painel(d, M, y + 6, W - M, fim_m, raio=20)
    rotulo(d, M + 28, y + 28, "Impacto por round de cada jogador")
    yy = y + 62
    colw = (W - 2 * M - 56 - 190) // 5
    for i, tipo in enumerate(ORDEM_TIPOS):
        d.text((M + 28 + 190 + i * colw + colw / 2, yy), gr.NOMES_TIPO[tipo], font=fonte("negrito", 17), fill=SUAVE, anchor="ma")
    yy += 34
    for rid in ctx["equipe"]:
        rows = [(a, j, r) for a, j in hoje.get(rid, []) for r in j["rounds"]]
        if not rows:
            continue
        d.text((M + 28, yy + 6), gr.apelido(rid, cfg), font=fonte("semi", 23), fill=TEXTO, anchor="la")
        for i, tipo in enumerate(ORDEM_TIPOS):
            rs = [r for _, _, r in rows if r["tipo"] == tipo]
            cx = M + 28 + 190 + i * colw
            if len(rs) >= 3:
                ip = 100 * sum(r["wpa"] for r in rs) / len(rs)
                fundo = VERDE_CLARO if ip >= 1 else (VERMELHO_CLARO if ip <= -1 else CINZA_CLARO)
                d.rounded_rectangle((cx + 6, yy - 2, cx + colw - 6, yy + 40), radius=12, fill=fundo)
                d.text((cx + colw / 2, yy + 19), f"{ip:+.1f}%", font=fonte("semi", 21), fill=cor_pp(ip), anchor="mm")
            else:
                d.text((cx + colw / 2, yy + 19), "—", font=fonte("regular", 21), fill=SUAVE, anchor="mm")
        yy += 52
    pior = None
    for tipo in ORDEM_TIPOS:
        rs = [r for *_, r in tot if r["tipo"] == tipo]
        if len(rs) >= 8:
            ip = 100 * sum(r["wpa"] for r in rs) / len(rs)
            if pior is None or ip < pior[1]:
                pior = (tipo, ip)
    if melhor and fim_m + 110 < H - 74:
        yl = fim_m + 18
        painel(d, M, yl, W - M, yl + 92, raio=18)
        d.rounded_rectangle((M, yl, M + 10, yl + 92), radius=5, fill=ROXO)
        d.text((M + 32, yl + 20), f"Melhor tipo de round: {gr.NOMES_TIPO[melhor[0]]} ({melhor[1]:+.1f}% por round)",
               font=fonte("semi", 22), fill=TEXTO, anchor="la")
        if pior and pior[0] != melhor[0]:
            d.text((M + 32, yl + 54), f"Para melhorar: {gr.NOMES_TIPO[pior[0]]} ({pior[1]:+.1f}% por round)",
                   font=fonte("semi", 22), fill=TEXTO, anchor="la")
    rodape(d, "Tipo de round pela carga das duas equipes. “—” = menos de 3 rounds do jogador nesse tipo.")
    return img


# ----------------------------------------------------------------------------
# Card: Mapas (vertical, equipe)
# ----------------------------------------------------------------------------

def card_mapas(cfg, ctx, hoje, avals, jogos, dia):
    from collections import defaultdict
    img = Image.new("RGB", (W, H), FUNDO)
    d = Pincel(img)
    faixa_marca(d, "Mapas", f"{datetime.fromisoformat(dia):%d/%m/%Y}")
    d.text((M - 3, 112), "Mapas", font=fonte("display", 68), fill=TEXTO, anchor="la")
    d.text((M, 196), f"desempenho da equipe nos últimos {cfg['janela_dias']} dias", font=fonte("medio", 22),
           fill=SUAVE, anchor="la")
    mapas_hoje = {a["mapa"] for l in hoje.values() for a, _ in l}

    dados = defaultdict(lambda: {"v": 0, "d": 0, "atk": [0, 0], "def": [0, 0], "unicos": set(), "por": defaultdict(list)})
    for a in gr.na_janela(ctx):
        vistos_time = set()
        for rid in ctx["equipe"]:
            pu = ctx["puuid_de"].get(rid)
            if pu not in a["jogadores"]:
                continue
            j = a["jogadores"][pu]
            e = dados[a["mapa"]]
            e["por"][rid].extend(j["rounds"])
            if j["time"] in vistos_time:
                continue
            vistos_time.add(j["time"])
            e["unicos"].add(a["match_id"])
            e["v" if j["resultado"] == "vitória" else "d"] += 1
            for r in j["rounds"]:
                e["atk" if r["lado"] == "ataque" else "def"][0] += r["venceu"]
                e["atk" if r["lado"] == "ataque" else "def"][1] += 1
    mapas = sorted(dados, key=lambda k: (-(dados[k]["v"] + dados[k]["d"]), k))[:6]

    y, alt, gap = 248, 172, 14
    if not mapas:
        d.text((M, y), "Sem partidas na janela.", font=fonte("semi", 28), fill=SUAVE, anchor="la")
    for mp in mapas:
        e = dados[mp]
        painel(d, M, y, W - M, y + alt, raio=20, borda=ROXO if mp in mapas_hoje else BORDA)
        d.text((M + 28, y + 20), mp, font=fonte("display", 38), fill=TEXTO, anchor="la")
        n = e["v"] + e["d"]
        x2 = M + 28 + largura(d, mp, fonte("display", 38)) + 16
        if mp in mapas_hoje:
            chip(d, x2, y + 24, "HOJE", ROXO, BRANCO, fonte("negrito", 16), alt=30, pad=12)
        d.text((W - M - 28, y + 22), f"{e['v']}V · {e['d']}D", font=fonte("negrito", 30),
               fill=cor_nivel(0.55 * n, 0.45 * n, e["v"]) if n >= 3 else TEXTO, anchor="ra")
        d.text((W - M - 28, y + 62), f"{n} partida{'s' if n != 1 else ''}", font=fonte("regular", 19), fill=SUAVE, anchor="ra")
        # barras ataque / defesa
        for i, (k, nome) in enumerate((("atk", "Ataque"), ("def", "Defesa"))):
            w_, t_ = e[k]
            p = pct(w_, t_)
            bx, by = M + 28, y + 76 + i * 30
            d.text((bx, by), nome, font=fonte("medio", 19), fill=SUAVE, anchor="la")
            bw = 520
            d.rounded_rectangle((bx + 90, by + 4, bx + 90 + bw, by + 18), radius=7, fill=CINZA_CLARO)
            if t_:
                d.rounded_rectangle((bx + 90, by + 4, bx + 90 + max(14, bw * p / 100), by + 18), radius=7,
                                    fill=cor_nivel(55, 45, p))
            d.text((bx + 90 + bw + 16, by), f"{p}% · {t_} rounds" if t_ else "—", font=fonte("semi", 19), fill=TEXTO,
                   anchor="la")
        # melhor jogador no mapa
        cand = [(rid, 100 * sum(r["wpa"] for r in rs) / len(rs)) for rid, rs in e["por"].items() if len(rs) >= 25]
        if cand:
            rid, ip = max(cand, key=lambda x: x[1])
            d.text((M + 28, y + alt - 34), f"Destaque: {gr.apelido(rid, cfg)} ({ip:+.1f}% por round)",
                   font=fonte("regular", 19), fill=ROXO_TEXTO, anchor="la")
        y += alt + gap
    rodape(d, "Borda roxa = mapa jogado hoje. Vitória no ataque/defesa conta os rounds do time; destaque exige 25+ rounds.")
    return img


# ----------------------------------------------------------------------------
# Card: Dicas (vertical, por jogador)
# ----------------------------------------------------------------------------

def dicas_do_jogador(ctx, lista):
    vistos = {}
    for a, j in lista:
        ref = ctx["refs"].get(j["funcao"])
        for tit, txt, temas in gr.habitos(j["rounds"], av.resumo_basico(a, j), j["agente"], a["mapa"], ref):
            e = vistos.setdefault(tit, {"titulo": tit, "texto": txt, "temas": temas, "n": 0, "agente": j["agente"],
                                        "mapa": a["mapa"], "funcao": j["funcao"]})
            e["n"] += 1
    return sorted(vistos.values(), key=lambda e: -e["n"])


def card_dicas(rid, cfg, ctx, hoje, avals, dia):
    img = Image.new("RGB", (W, H), FUNDO)
    d = Pincel(img)
    lista = hoje.get(rid, [])
    aval = (avals.get(rid) or [None])[0]
    agente, agentes = agente_principal(lista, aval)
    funcao = av.funcao_do_agente(agente, cfg)
    faixa_marca(d, "Dicas", f"{datetime.fromisoformat(dia):%d/%m/%Y}")
    cabecalho_jogador(img, d, rid, cfg, "Dicas", agente, funcao, agentes)

    itens = dicas_do_jogador(ctx, lista)
    regras = gr.regras_de_acao([(e["titulo"], e["texto"], e["temas"]) for e in itens])[:3]

    y0 = 300
    alt_r = 66 + 66 * len(regras)
    painel(d, M, y0, W - M, y0 + alt_r)
    d.rounded_rectangle((M, y0, M + 10, y0 + alt_r), radius=5, fill=ROXO)
    rotulo(d, M + 32, y0 + 24, "Foco da próxima sessão")
    for i, (tit, txt) in enumerate(regras):
        yy = y0 + 62 + i * 66
        d.ellipse((M + 32, yy + 2, M + 66, yy + 36), fill=ROXO)
        d.text((M + 49, yy + 19), str(i + 1), font=fonte("negrito", 20), fill=BRANCO, anchor="mm")
        d.text((M + 84, yy), tit, font=fonte("negrito", 22), fill=TEXTO, anchor="la")
        d.text((M + 84, yy + 30), txt, font=fonte("regular", 19), fill=SUAVE, anchor="la")

    yp = y0 + alt_r + 24
    rotulo(d, M, yp, "O que apareceu hoje")
    yp += 32
    if not itens:
        painel(d, M, yp, W - M, yp + 150, raio=18)
        d.rounded_rectangle((M, yp, M + 10, yp + 150), radius=5, fill=VERDE)
        d.text((M + 32, yp + 36), "Nenhum padrão negativo hoje", font=fonte("semi", 28), fill=VERDE, anchor="la")
        d.text((M + 32, yp + 84), "Mantenha o que está funcionando e foque em consistência.",
               font=fonte("regular", 21), fill=TEXTO, anchor="la")
    alt_p = 220
    for i, e in enumerate(itens[:3]):
        ya = yp + i * (alt_p + 18)
        painel(d, M, ya, W - M, ya + alt_p, raio=18)
        d.rounded_rectangle((M, ya, M + 10, ya + alt_p), radius=5, fill=AMBAR)
        d.text((M + 32, ya + 22), e["titulo"], font=fonte("negrito", 25), fill=TEXTO, anchor="la")
        if e["n"] > 1:
            chip(d, W - M - 24, ya + 18, f"em {e['n']} partidas", CINZA_CLARO, SUAVE, fonte("semi", 17), alt=32, pad=12,
                 direita=True)
        texto = gr.texto_puro(e["texto"])
        for li, linha in enumerate(quebrar(d, texto, fonte("regular", 21), W - 2 * M - 64, 3)):
            d.text((M + 32, ya + 66 + li * 29), linha, font=fonte("regular", 21), fill=TEXTO, anchor="la")
        xc = M + 32
        for chave in e["temas"][:2]:
            titulo, _ = gr.tema(chave, e["agente"], e["mapa"], e["funcao"])
            xc = chip(d, xc, ya + alt_p - 56, "▶ " + titulo.split(" — ")[0], ROXO_CLARO, ROXO_TEXTO, fonte("semi", 19),
                      alt=38, pad=14) + 8
    fim_h = yp + (min(3, len(itens)) * (alt_p + 18) if itens else 168)
    todos = [(a, j, r) for a, j in lista for r in j["rounds"]]
    bom = max(todos, key=lambda x: x[2]["wpa"], default=None)
    if bom and 100 * bom[2]["wpa"] >= 10 and fim_h + 190 < H - 74:
        a, j, r = bom
        resumo_r, dica, _, ip = gr.descrever_round(r, j["agente"], a["mapa"])
        painel(d, M, fim_h, W - M, fim_h + 170, raio=18)
        d.rounded_rectangle((M, fim_h, M + 10, fim_h + 170), radius=5, fill=VERDE)
        rotulo(d, M + 32, fim_h + 22, "Continue assim")
        d.text((W - M - 28, fim_h + 14), gr.fmt_imp(ip), font=fonte("display", 54), fill=VERDE, anchor="ra")
        d.text((M + 32, fim_h + 50), f"{a['mapa']} · R{r['n']} · {gr.NOMES_TIPO[r['tipo']]}", font=fonte("semi", 24),
               fill=TEXTO, anchor="la")
        for li, linha in enumerate(quebrar(d, resumo_r, fonte("regular", 21), W - 2 * M - 64, 2)):
            d.text((M + 32, fim_h + 92 + li * 29), linha, font=fonte("regular", 21), fill=TEXTO, anchor="la")
    rodape(d, "Os links dos vídeos vão no texto da mensagem (imagem não é clicável).")
    return img


def texto_dicas(rid, cfg, ctx, lista):
    """Markdown com os links dos vídeos (para colar junto da imagem no Discord)."""
    itens = dicas_do_jogador(ctx, lista)
    linhas = [f"## Dicas — {gr.apelido(rid, cfg)}", ""]
    if not itens:
        return "\n".join(linhas + ["Nenhum padrão negativo hoje. Mantenha o que está funcionando."]) + "\n"
    for e in itens[:3]:
        linhas.append(f"**{e['titulo']}**" + (f" (em {e['n']} partidas)" if e["n"] > 1 else ""))
        for chave in e["temas"]:
            titulo, link = gr.tema(chave, e["agente"], e["mapa"], e["funcao"])
            linhas.append(f"- {titulo}: {link}")
        linhas.append("")
    return "\n".join(linhas)


# ----------------------------------------------------------------------------
# Card: Formação (duo, trio, quad, five stack)
# ----------------------------------------------------------------------------

def card_formacao(df, cfg, ctx, dia):
    img = Image.new("RGB", (W, H), FUNDO)
    d = Pincel(img)
    membros = df["membros"]
    faixa_marca(d, "Formação", f"{datetime.fromisoformat(dia):%d/%m/%Y}")
    d.text((M - 3, 112), gr.FORMACAO.get(len(membros), "Grupo"), font=fonte("display", 68), fill=TEXTO, anchor="la")
    nomes = " & ".join(gr.apelido(r, cfg) for r in membros)
    d.text((M, 196), nomes, font=fonte("medio", 24), fill=SUAVE, anchor="la")

    # Selos dos membros com o agente mais jogado juntos hoje
    tam, passo = 96, (W - 2 * M) // max(len(membros), 1)
    for i, r in enumerate(membros):
        ags = [j["jogs"][r]["agente"] for j in df["hoje"]]
        ag = max(set(ags), key=ags.count) if ags else "?"
        cx = M + passo * i + passo // 2
        selo_agente(img, d, cx - tam // 2, 244, tam, ag)
        d.text((cx, 352), gr.apelido(r, cfg), font=fonte("negrito", 24), fill=TEXTO, anchor="ma")
        d.text((cx, 382), ag, font=fonte("regular", 18), fill=SUAVE, anchor="ma")

    # Tiles do dia + histórico
    js = df["hoje"]
    vit = sum(1 for j in js if j["resultado"] == "vitória")
    tr_hoje = sum(sum(j["trades"].values()) for j in js)
    ds_hoje = [x for j in js for x in j["dists"]]
    alc = pct(sum(x <= cfg.get("distancia_trade", 1500) for x in ds_hoje), len(ds_hoje)) if ds_hoje else None
    hist = df["hist"]
    hv = sum(1 for h in hist if h["resultado"] == "vitória")
    tiles = [
        ("Juntos hoje", f"{vit}V · {len(js) - vit}D", f"{len(js)} partida{'s' if len(js) != 1 else ''}",
         cor_nivel(0.55 * len(js), 0.45 * len(js), vit) if js else TEXTO),
        ("Trades hoje", f"{tr_hoje}", "um vingando o outro", TEXTO),
        ("Parceiro perto", f"{alc}%" if alc is not None else "—", "a até 15 m na morte",
         cor_nivel(60, 45, alc) if alc is not None else SUAVE),
        ("Vitórias (sempre)", f"{pct(hv, len(hist))}%" if hist else "—",
         f"em {len(hist)} partida{'s' if len(hist) != 1 else ''}",
         TEXTO),
    ]
    gap = 14
    tw = (W - 2 * M - 3 * gap) // 4
    for i, (rot, val, sub, cor) in enumerate(tiles):
        tile(d, M + i * (tw + gap), 420, tw, 124, rot, val, sub, cor)

    # Isolado x juntos
    minimo = cfg["min_partidas_grupo"]
    y0 = 564
    passo_l = {1: 66, 2: 66, 3: 66, 4: 58}.get(len(membros), 54)
    alt = 76 + passo_l * len(membros)
    painel(d, M, y0, W - M, y0 + alt)
    rotulo(d, M + 28, y0 + 24, f"Sozinho × juntos · impacto por round · {cfg['janela_dias']} dias")
    xi, xj = M + 330, M + 560
    d.text((xi, y0 + 50), "SOZINHO", font=fonte("negrito", 15), fill=SUAVE, anchor="ma")
    d.text((xj, y0 + 50), "JUNTOS*", font=fonte("negrito", 15), fill=SUAVE, anchor="ma")
    for i, r in enumerate(membros):
        yy = y0 + 80 + i * passo_l
        mi, mj = df["comp"][r]
        d.text((M + 28, yy + 6), gr.apelido(r, cfg), font=fonte("semi", 25), fill=TEXTO, anchor="la")
        for x, m_ in ((xi, mi), (xj, mj)):
            if m_:
                d.text((x, yy), f"{m_['impacto']:+.1f}%", font=fonte("negrito", 26), fill=cor_pp(m_["impacto"], 0.5),
                       anchor="ma")
                d.text((x, yy + 32), f"{m_['partidas']} partida{'s' if m_['partidas'] != 1 else ''}",
                       font=fonte("regular", 16), fill=SUAVE, anchor="ma")
            else:
                d.text((x, yy + 4), "—", font=fonte("semi", 26), fill=SUAVE, anchor="ma")
        d.text(((xi + xj) / 2, yy + 4), "→", font=fonte("semi", 26), fill=SUAVE, anchor="ma")
        tipo_ef, dif = gr.efeito_juntos(mi, mj, minimo)
        if tipo_ef == "mais":
            chip(d, W - M - 24, yy + 2, f"rende mais junto {dif:+.1f}", VERDE_CLARO, VERDE, fonte("semi", 18), alt=36,
                 pad=14, direita=True)
        elif tipo_ef == "menos":
            chip(d, W - M - 24, yy + 2, f"rende menos junto {dif:+.1f}", VERMELHO_CLARO, VERMELHO, fonte("semi", 18),
                 alt=36, pad=14, direita=True)
        elif tipo_ef == "parecido":
            chip(d, W - M - 24, yy + 2, f"parecido {dif:+.1f}", ROXO_CLARO, ROXO_TEXTO, fonte("semi", 18), alt=36,
                 pad=14, direita=True)
        else:
            chip(d, W - M - 24, yy + 2, f"amostra pequena (mín. {minimo} cada)", CINZA_CLARO, SUAVE,
                 fonte("semi", 17), alt=36, pad=14, direita=True)

    # Quem troca quem (janela): matriz completa, linha = quem vingou, coluna = quem foi vingado
    yq = y0 + alt + 20
    trades = df["trades"]
    n = len(membros)
    lin = 46 if n <= 3 else (40 if n == 4 else 36)
    menos = [r for r in membros if not any(q == r for (q, _) in trades)]
    alt_q = 60 + 34 + lin * n + (40 if (trades and menos) else 14)
    painel(d, M, yq, W - M, yq + alt_q, raio=18)
    rotulo(d, M + 28, yq + 22, f"Quem vinga quem · {cfg['janela_dias']} dias")
    tot = sum(trades.values())
    d.text((W - M - 28, yq + 20), f"{tot} trade{'s' if tot != 1 else ''} entre vocês", font=fonte("semi", 19),
           fill=TEXTO, anchor="ra")
    xn = M + 28
    x0 = M + 230
    cw = min(150, (W - M - 28 - x0) // n)
    yh = yq + 58
    d.text((xn, yh), "vingou ↓  /  foi vingado →", font=fonte("regular", 15), fill=SUAVE, anchor="la")
    for c, r in enumerate(membros):
        d.text((x0 + c * cw + cw / 2, yh), gr.apelido(r, cfg), font=fonte("negrito", 16), fill=SUAVE, anchor="ma")
    maior = max(trades.values(), default=1)
    for i, quem in enumerate(membros):
        yy = yh + 30 + i * lin
        d.text((xn, yy + lin / 2 - 2), gr.apelido(quem, cfg), font=fonte("semi", 22), fill=TEXTO, anchor="lm")
        for c, alvo in enumerate(membros):
            cx = x0 + c * cw
            caixa = (cx + 5, yy + 3, cx + cw - 5, yy + lin - 3)
            if quem == alvo:
                d.rounded_rectangle(caixa, radius=10, fill=FUNDO)
                continue
            v = trades.get((quem, alvo), 0)
            if v:
                t = 0.35 + 0.65 * v / maior
                cor = tuple(int(ROXO_CLARO[k] + (ROXO[k] - ROXO_CLARO[k]) * t) for k in range(3))
                d.rounded_rectangle(caixa, radius=10, fill=cor)
                d.text((cx + cw / 2, yy + lin / 2 - 1), f"{v}x", font=fonte("negrito", 20), fill=BRANCO, anchor="mm")
            else:
                d.rounded_rectangle(caixa, radius=10, fill=CINZA_CLARO)
                d.text((cx + cw / 2, yy + lin / 2 - 1), "0", font=fonte("regular", 18), fill=SUAVE, anchor="mm")
    if trades and menos:
        d.text((M + 28, yh + 30 + n * lin + 8), f"{' e '.join(gr.apelido(r, cfg) for r in menos)} ainda não "
                                               f"{'vingou' if len(menos) == 1 else 'vingaram'} ninguém do grupo: "
                                               "joguem mais perto", font=fonte("regular", 18), fill=AMBAR, anchor="la")

    # Partidas juntos hoje
    yp = yq + alt_q + 20
    painel(d, M, yp, W - M, H - 74, raio=18)
    rotulo(d, M + 28, yp + 22, "Partidas juntos hoje")
    cabem = (H - 74 - yp - 58) // 50
    if len(js) <= cabem:
        def linha_partida(j, yy, apagada=False):
            ganhou = j["resultado"] == "vitória"
            cor = VERDE if ganhou else VERMELHO
            d.rounded_rectangle((M + 28, yy + 4, M + 36, yy + 36), radius=4, fill=cor)
            quando = (f"{j['inicio']:%d/%m}" if apagada else f"{j['inicio']:%Hh%M}") if j["inicio"] else ""
            d.text((M + 52, yy + 4), j["mapa"], font=fonte("semi", 23), fill=SUAVE if apagada else TEXTO, anchor="la")
            agentes = " · ".join(j["jogs"][r]["agente"] for r in membros)
            d.text((M + 200, yy + 7), agentes, font=fonte("regular", 19), fill=SUAVE, anchor="la")
            d.text((W - M - 28, yy + 4), f"{j.get('placar', '')}  {quando}", font=fonte("semi", 21), fill=cor, anchor="ra")
        for i, j in enumerate(js):
            linha_partida(j, yp + 58 + i * 50)
        # Sobrou espaço: as partidas anteriores juntos na janela (preenche o card em vez de deixar vazio)
        ids_hoje = {j["mid"] for j in js}
        antes = sorted([j for j in df.get("juntos", []) if j["mid"] not in ids_hoje],
                       key=lambda j: j["inicio"] or datetime.min, reverse=True)
        sobra = cabem - len(js) - 1
        if antes and sobra > 0:
            ya = yp + 58 + len(js) * 50 + 6
            d.line((M + 28, ya, W - M - 28, ya), fill=BORDA, width=2)
            va = sum(1 for j in antes if j["resultado"] == "vitória")
            rotulo(d, M + 28, ya + 14, f"Antes, juntos nos últimos {cfg['janela_dias']} dias · {va}V {len(antes) - va}D")
            for i, j in enumerate(antes[:sobra]):
                linha_partida(j, ya + 46 + i * 50, apagada=True)
            if len(antes) > sobra:
                d.text((W - M - 28, ya + 14), f"+{len(antes) - sobra} mais", font=fonte("semi", 17), fill=SUAVE, anchor="ra")
    else:  # pouco espaço: um selo por partida (mapa + placar)
        xc, yc = M + 28, yp + 54
        for i, j in enumerate(js):
            ganhou = j["resultado"] == "vitória"
            t = f"{j['mapa']} {j['placar']}"
            w = largura(d, t, fonte("semi", 18)) + 28
            if xc + w > W - M - 24:
                xc, yc = M + 28, yc + 42
            if yc + 36 > H - 80:
                d.text((xc, yc + 8), f"+{len(js) - i}", font=fonte("semi", 18), fill=SUAVE, anchor="la")
                break
            xc = chip(d, xc, yc, t, VERDE_CLARO if ganhou else VERMELHO_CLARO, VERDE if ganhou else VERMELHO,
                      fonte("semi", 18), alt=34, pad=14) + 8

    rodape(d, "Sozinho = sem ninguém da equipe no time. *Juntos = qualquer partida com todos estes no time (inclui "
              "formações maiores). Compara só as funções que cada um jogou com o grupo.")
    return img


# ----------------------------------------------------------------------------
# Card: Semana (domingo)
# ----------------------------------------------------------------------------

def endereco_site(cfg):
    """valreport.vercel.app, sem o https:// (para caber no cabeçalho)."""
    return gr.url_site(cfg).replace("https://", "").replace("http://", "").rstrip("/")


def momento_do_dia(dia):
    """Fim do dia do report (ou agora, se o dia ainda não acabou): define qual semana já fechou."""
    fim_dia = datetime.fromisoformat(dia).replace(hour=23, minute=59, tzinfo=av.FUSO_BR)
    return min(datetime.now(av.FUSO_BR), fim_dia)


def texto_coroa(seguidas, anterior, rid, cfg):
    if seguidas > 1:
        return f"{seguidas} semanas seguidas com a coroa!"
    if anterior and anterior != rid:
        return f"Tomou a coroa de {gr.apelido(anterior, cfg)}!"
    return "A coroa é sua até a próxima semana fechar."


def card_semana(cfg, ctx, dia):
    # A mesma semana fechada do site: segunda a domingo, fecha no domingo às 21h
    s = gr.semana_fechada(ctx, cfg, ctx["equipe"], momento_do_dia(dia))
    img = Image.new("RGB", (W, H), FUNDO)
    d = Pincel(img)
    ini, fim = datetime.fromisoformat(s["ini"]), datetime.fromisoformat(s["fim"])
    faixa_marca(d, "Semana", f"{ini + timedelta(hours=3):%d/%m} a {fim:%d/%m}")
    d.text((M - 3, 112), "Semana", font=fonte("display", 68), fill=TEXTO, anchor="la")
    d.text((M, 196), f"{s['partidas']} partida{'s' if s['partidas'] != 1 else ''} · {s['v']}V {s['d']}D · fechou domingo às 21h",
           font=fonte("medio", 22), fill=SUAVE, anchor="la")

    # MVP da semana (dourado, com a coroa)
    y0 = 248
    painel(d, M, y0, W - M, y0 + 214, cor=(36, 29, 34), borda=OURO)
    d.rounded_rectangle((M, y0, M + 10, y0 + 214), radius=5, fill=OURO)
    rotulo(d, M + 32, y0 + 24, "MVP da semana · dono da coroa", OURO)
    mvp = next((x for x in s["jogadores"] if x["rid"] == s["mvp"]), None)
    if mvp:
        lista = [(a, j) for a in ctx["analises"].values() for j in [a["jogadores"].get(ctx["puuid_de"].get(mvp["rid"]))] if j]
        agente, _ = agente_principal(lista[-6:], None) if lista else ("?", [])
        d.ellipse((M + 26, y0 + 94, M + 134, y0 + 202), fill=OURO)
        selo_agente(img, d, M + 32, y0 + 100, 96, agente)
        coroa(d, M + 80, y0 + 100, 54)
        d.text((M + 152, y0 + 78), gr.apelido(mvp["rid"], cfg), font=fonte("display", 46), fill=TEXTO, anchor="la")
        sm = mvp["semana"]
        d.text((M + 154, y0 + 134), f"{sm['partidas']} partidas · K/D {sm['kd']:.2f} · ADR {sm['adr']:.0f}",
               font=fonte("regular", 21), fill=SUAVE, anchor="la")
        d.text((M + 154, y0 + 166), texto_coroa(s["seguidas"], s["mvp_anterior"], mvp["rid"], cfg), font=fonte("semi", 21),
               fill=OURO, anchor="la")
        d.text((W - M - 28, y0 + 74), f"{sm['impacto']:+.1f}%", font=fonte("display", 60), fill=cor_pp(sm["impacto"], 0.5), anchor="ra")
        d.text((W - M - 28, y0 + 146), "impacto por round", font=fonte("regular", 18), fill=SUAVE, anchor="ra")
    else:
        d.text((M + 32, y0 + 80), "Ninguém chegou a 20 rounds na semana: sem coroa desta vez.", font=fonte("semi", 25),
               fill=SUAVE, anchor="la")

    # Jogadores (com a comparação com a semana anterior)
    y1 = y0 + 214 + 20
    ativos = [x for x in s["jogadores"] if x["semana"]]
    alt = 70 + 62 * max(1, len(ativos))
    painel(d, M, y1, W - M, y1 + alt)
    rotulo(d, M + 28, y1 + 24, "Cada um na semana")
    d.text((W - M - 28, y1 + 24), "vs semana anterior", font=fonte("medio", 17), fill=SUAVE, anchor="ra")
    for i, x in enumerate(ativos):
        yy = y1 + 66 + i * 62
        sm, an = x["semana"], x["anterior"]
        d.text((M + 28, yy + 4), gr.apelido(x["rid"], cfg), font=fonte("semi", 25), fill=TEXTO, anchor="la")
        d.text((M + 230, yy + 8), f"{sm['partidas']}p · {sm['v']}V {sm['d']}D · K/D {sm['kd']:.2f}", font=fonte("regular", 20),
               fill=SUAVE, anchor="la")
        d.text((M + 700, yy + 2), f"{sm['impacto']:+.1f}%", font=fonte("negrito", 27), fill=cor_pp(sm["impacto"], 0.5), anchor="ra")
        if an:
            dif = sm["impacto"] - an["impacto"]
            seta = "▲" if dif > 0.5 else "▼" if dif < -0.5 else "="
            chip(d, W - M - 24, yy, f"{seta} {dif:+.1f}", VERDE_CLARO if dif > 0.5 else VERMELHO_CLARO if dif < -0.5 else CINZA_CLARO,
                 VERDE if dif > 0.5 else VERMELHO if dif < -0.5 else SUAVE, fonte("semi", 18), alt=36, pad=14, direita=True)
        else:
            chip(d, W - M - 24, yy, "sem semana anterior", CINZA_CLARO, SUAVE, fonte("semi", 16), alt=36, pad=12, direita=True)
    if not ativos:
        d.text((M + 28, y1 + 74), "Ninguém jogou nesta semana.", font=fonte("semi", 24), fill=SUAVE, anchor="la")

    # Destaques
    y2 = y1 + alt + 20
    painel(d, M, y2, W - M, H - 74, raio=18)
    rotulo(d, M + 28, y2 + 22, "Rounds da semana")
    yy = y2 + 60
    for x in s["destaques"][:3]:
        if yy + 100 > H - 80:
            break
        d.text((M + 28, yy), f"{x['imp']:+.0f}%", font=fonte("display", 34), fill=VERDE, anchor="la")
        d.text((M + 150, yy + 2), f"{gr.apelido(x['rid'], cfg)} · {x['mapa']} R{x['n']} · {x['agente']}", font=fonte("semi", 22),
               fill=TEXTO, anchor="la")
        for li, linha in enumerate(quebrar(d, x["resumo"], fonte("regular", 19), W - 2 * M - 180, 2)):
            d.text((M + 150, yy + 34 + li * 25), linha, font=fonte("regular", 19), fill=SUAVE, anchor="la")
        yy += 100
    if not s["destaques"]:
        d.text((M + 28, y2 + 70), "Nenhum round acima de +15% nesta semana.", font=fonte("regular", 21), fill=SUAVE, anchor="la")
    piores = [x for x in s["rever"] if yy + 150 < H - 80][:max(0, (H - 80 - yy - 50) // 100)]
    if piores:
        d.line((M + 28, yy + 4, W - M - 28, yy + 4), fill=BORDA, width=2)
        rotulo(d, M + 28, yy + 22, "Para rever no VOD", VERMELHO)
        yy += 60
        for x in piores:
            d.text((M + 28, yy), f"{x['imp']:+.0f}%", font=fonte("display", 34), fill=VERMELHO, anchor="la")
            d.text((M + 150, yy + 2), f"{gr.apelido(x['rid'], cfg)} · {x['mapa']} R{x['n']} · {x['agente']}", font=fonte("semi", 22),
                   fill=TEXTO, anchor="la")
            for li, linha in enumerate(quebrar(d, x["resumo"], fonte("regular", 19), W - 2 * M - 180, 2)):
                d.text((M + 150, yy + 34 + li * 25), linha, font=fonte("regular", 19), fill=SUAVE, anchor="la")
            yy += 100
    rodape(d, "Impacto = quanto as ações mudaram a chance do time vencer o round. Semana de segunda a domingo; comparação com a anterior.")
    return img


# ----------------------------------------------------------------------------
# Execução
# ----------------------------------------------------------------------------

def baixar_icones():
    """Baixa os ícones oficiais dos agentes (valorant-api.com) para dados/cache/agentes/. Só roda se faltar algum."""
    try:
        import json, urllib.request
        PASTA_ICONES.mkdir(parents=True, exist_ok=True)
        if len(list(PASTA_ICONES.glob("*.png"))) >= 20:
            return
        with urllib.request.urlopen("https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=pt-BR", timeout=20) as r:
            agentes = json.load(r)["data"]
        for ag in agentes:
            arq = PASTA_ICONES / f"{gr.nome_arquivo(ag['displayName'])}.png"
            if not arq.exists() and ag.get("displayIcon"):
                with urllib.request.urlopen(ag["displayIcon"], timeout=20) as r:
                    arq.write_bytes(r.read())
    except Exception as e:  # sem internet etc.: os cards usam as iniciais
        print(f"Ícones dos agentes não baixados ({e}). Os cards usam as iniciais.")


def gerar_cards(dia, cfg=None, base=None):
    """Salva os cards do dia nas pastas de cada formação:
    Toda Equipe/cards: equipe, economia, mapas · Solo - <Nome>/cards: resumo_solo, agente, dicas (+ dicas.md)."""
    cfg = cfg or gr.ler_json(PASTA / "config.json", {})
    baixar_icones()
    cfg, ctx, hoje, avals, jogos = dados_do_dia(dia, cfg)
    global URL_SITE
    URL_SITE = endereco_site(cfg)
    try:
        sf = gr.semana_fechada(ctx, cfg, ctx["equipe"], momento_do_dia(dia))
        COROA.update(rid=sf["mvp"], seguidas=sf["seguidas"], anterior=sf["mvp_anterior"])
    except Exception:  # noqa: BLE001 — a coroa é só um enfeite; nunca derruba os cards
        COROA.update(rid=None, seguidas=0, anterior=None)
    gr.VIDEOS.clear()
    gr.VIDEOS.update(cfg.get("videos") or {})
    base = Path(base or (gr.PASTA_REPORTS / dia))
    arquivos = []

    def salvar(img, pasta, nome):
        pasta.mkdir(parents=True, exist_ok=True)
        arq = pasta / nome
        img.save(arq, optimize=True)
        arquivos.append(arq)

    cards_equipe = base / gr.PASTA_EQUIPE / "cards"
    salvar(card_equipe(cfg, ctx, hoje, avals, jogos, dia), cards_equipe, "equipe.png")
    if any(hoje.values()):
        salvar(card_economia(cfg, ctx, hoje, avals, jogos, dia), cards_equipe, "economia.png")
    salvar(card_mapas(cfg, ctx, hoje, avals, jogos, dia), cards_equipe, "mapas.png")
    # Domingo: card da semana (ou sempre, com "card_semanal_todo_dia": true no config, para testar)
    if datetime.fromisoformat(dia).weekday() == 6 or cfg.get("card_semanal_todo_dia"):
        salvar(card_semana(cfg, ctx, dia), cards_equipe, "semana.png")
    for rid in ctx["equipe"]:
        if not hoje.get(rid):
            continue
        pasta = base / gr.nome_pasta((rid,), cfg)
        salvar(card_solo(rid, cfg, ctx, hoje, avals, dia), pasta / "cards", "resumo_solo.png")
        salvar(card_agente(rid, cfg, ctx, hoje, avals, dia), pasta / "cards", "agente.png")
        salvar(card_dicas(rid, cfg, ctx, hoje, avals, dia), pasta / "cards", "dicas.png")
        (pasta / "cards" / "dicas.md").write_text(texto_dicas(rid, cfg, ctx, hoje[rid]), encoding="utf-8")

    # Uma imagem por formação do dia (duo, trio, quad; five stack fica em Toda Equipe)
    if jogos:
        janela = gr.jogos_em_grupo(ctx, [a["match_id"] for a in gr.na_janela(ctx)], cfg)
        for membros in dict.fromkeys(j["membros"] for j in jogos):
            df = gr.dados_formacao(ctx, membros, jogos, janela, cfg)
            pasta = base / gr.nome_pasta(membros, cfg)
            nome = "five_stack.png" if pasta.name == gr.PASTA_EQUIPE else "formacao.png"
            salvar(card_formacao(df, cfg, ctx, dia), pasta / "cards", nome)

    try:
        import mapa_calor
        mapa_calor.cards_calor(dia, cfg, ctx, hoje, base, salvar)
    except Exception as e:  # o mapa de calor nunca derruba os outros cards
        print(f"Mapa de calor não gerado ({e})")
    return arquivos


if __name__ == "__main__":
    for a in gerar_cards(sys.argv[1] if len(sys.argv) > 1 else datetime.now(av.FUSO_BR).date().isoformat()):
        print(a)
