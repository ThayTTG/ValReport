#!/usr/bin/env python3
"""
Mapa de calor de mortes e abates — NokyLabs

Usa as posições que a API já traz em cada abate (onde a vítima morreu e onde cada jogador estava),
projetadas sobre o minimapa oficial (valorant-api.com, baixado uma vez para dados/cache/mapas/).

Projeção (a mesma da valorant-api, conferida com as partidas de vocês):
    x_imagem = y_jogo * xMultiplier + xScalarToAdd
    y_imagem = x_jogo * yMultiplier + yScalarToAdd

Sem internet / mapa novo sem minimapa: o desenho do mapa é reconstruído a partir das posições de todos os
jogadores nas partidas salvas (a "silhueta" do mapa).

Uso direto:
    py mapa_calor.py 2026-10-23
"""

import json
import math
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

import armazem
import avaliacao as av
import cards as cd
import gerar_report as gr

PASTA = Path(__file__).resolve().parent.parent  # pasta principal do projeto (o código fica em ferramentas/)
PASTA_MAPAS = PASTA / "dados" / "cache" / "mapas"
ARQ_MAPAS = PASTA_MAPAS / "mapas.json"

# Reserva para quando não houver internet (valores da valorant-api, out/2026). O cache baixado tem prioridade.
CONHECIDOS = {
    "Ascent": (7e-05, -7e-05, 0.813895, 0.573242), "Split": (7.8e-05, -7.8e-05, 0.842188, 0.697578),
    "Fracture": (7.8e-05, -7.8e-05, 0.556952, 1.155886), "Bind": (5.9e-05, -5.9e-05, 0.576941, 0.967566),
    "Breeze": (7e-05, -7e-05, 0.465123, 0.833078), "Abyss": (8.1e-05, -8.1e-05, 0.5, 0.5),
    "Lotus": (7.2e-05, -7.2e-05, 0.454789, 0.917752), "Sunset": (7.8e-05, -7.8e-05, 0.5, 0.515625),
    "Pearl": (7.8e-05, -7.8e-05, 0.480469, 0.916016), "Summit": (7.5e-05, -7.5e-05, 0.047401, 0.978891),
    "Icebox": (7.2e-05, -7.2e-05, 0.460214, 0.304687), "Haven": (7.5e-05, -7.5e-05, 1.09345, 0.642728),
    "Corrode": (7e-05, -7e-05, 0.526158, 0.5),
}

GRADE = 160          # resolução do calor
SIGMA_UNID = 330     # espalhamento de cada morte (~3,3 m)


# ----------------------------------------------------------------------------
# Minimapas e callouts
# ----------------------------------------------------------------------------

def _baixar(url, destino=None, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": "NokyLabs-Report/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        dados = r.read()
    if destino:
        Path(destino).write_bytes(dados)
    return dados


def baixar_mapas(forcar=False):
    """Atualiza dados/cache/mapas/ (metadados + minimapas). Silencioso se não houver internet."""
    try:
        PASTA_MAPAS.mkdir(parents=True, exist_ok=True)
        velho = ARQ_MAPAS.exists() and time.time() - ARQ_MAPAS.stat().st_mtime > 14 * 86400
        if forcar or not ARQ_MAPAS.exists() or velho:
            dados = json.loads(_baixar("https://valorant-api.com/v1/maps"))["data"]
            mapas = []
            for m in dados:
                if not m.get("xMultiplier"):
                    continue
                mapas.append({
                    "uuid": m["uuid"], "nome": m["displayName"],
                    "xm": m["xMultiplier"], "ym": m["yMultiplier"], "xs": m["xScalarToAdd"], "ys": m["yScalarToAdd"],
                    "icone": m.get("displayIcon"),
                    "callouts": [{"regiao": c.get("regionName"), "super": c.get("superRegionName"),
                                  "x": c["location"]["x"], "y": c["location"]["y"]}
                                 for c in m.get("callouts") or [] if c.get("location")],
                })
            ARQ_MAPAS.write_text(json.dumps(mapas, ensure_ascii=False, indent=1), encoding="utf-8")
        for m in json.loads(ARQ_MAPAS.read_text(encoding="utf-8")):
            arq = PASTA_MAPAS / f"{m['uuid']}.png"
            if m.get("icone") and (forcar or not arq.exists()):
                _baixar(m["icone"], arq)
    except Exception as e:
        print(f"Minimapas não atualizados ({e}). O mapa de calor usa o desenho reconstruído.")


def info_mapa(nome, uuid=None):
    """{xm, ym, xs, ys, callouts, imagem} do mapa; None se não houver como projetar."""
    mapas = gr.ler_json(ARQ_MAPAS, []) or []
    m = next((x for x in mapas if uuid and x["uuid"] == uuid), None) or \
        next((x for x in mapas if x["nome"].lower() == (nome or "").lower()), None)
    if m:
        img = PASTA_MAPAS / f"{m['uuid']}.png"
        return {**m, "imagem": img if img.exists() else None, "callouts": callouts_validos(m, img)}
    if nome in CONHECIDOS:
        xm, ym, xs, ys = CONHECIDOS[nome]
        return {"nome": nome, "xm": xm, "ym": ym, "xs": xs, "ys": ys, "callouts": [], "imagem": None}
    return None


def callouts_validos(m, img):
    """Descarta callouts que caem fora do desenho do minimapa (a valorant-api tem alguns com coordenada errada,
    como o spawn de ataque do Summit em out/2026)."""
    cs = m.get("callouts") or []
    try:
        alfa = Image.open(img).convert("RGBA").getchannel("A")
    except Exception:
        return cs
    w, h = alfa.size
    raio = max(2, int(0.03 * w))
    ok = []
    for c in cs:
        u, v = c["y"] * m["xm"] + m["xs"], c["x"] * m["ym"] + m["ys"]
        if not (0 <= u <= 1 and 0 <= v <= 1):
            continue
        px, py = int(u * w), int(v * h)
        if max(alfa.getpixel((min(w - 1, max(0, px + dx)), min(h - 1, max(0, py + dy))))
               for dx in range(-raio, raio + 1, 3) for dy in range(-raio, raio + 1, 3)) > 0:
            ok.append(c)
    return ok


def projetar(info, x, y):
    return y * info["xm"] + info["xs"], x * info["ym"] + info["ys"]


def nome_callout(info, x, y, limite=2600):
    """Callout mais próximo ('A Main', 'Mid Window', 'Spawn de ataque')."""
    melhor, dist = None, limite
    for c in info.get("callouts") or []:
        dd = math.dist((x, y), (c["x"], c["y"]))
        if dd < dist:
            melhor, dist = c, dd
    if not melhor:
        return None
    if melhor["regiao"] == "Spawn":
        return "Spawn de ataque" if "Attacker" in (melhor["super"] or "") else "Spawn de defesa"
    return f"{melhor['super']} {melhor['regiao']}"


# ----------------------------------------------------------------------------
# Eventos
# ----------------------------------------------------------------------------

def eventos(a, bruta, puuids):
    """Mortes e abates dos puuids nesta partida: [{tipo, x, y, lado, n, quem}] (só rounds válidos)."""
    if not bruta:
        return []
    validos = {r.get("id") for r in av.rounds_validos(bruta)}
    lados = {}
    for pu in puuids:
        j = a["jogadores"].get(pu)
        for r in (j or {}).get("rounds", []):
            lados[(pu, r["n"])] = r["lado"]
    out = []
    for k in bruta.get("kills") or []:
        rid = k.get("round")
        if rid not in validos:
            continue
        vit, mat = av.g(k, "victim", "puuid"), av.g(k, "killer", "puuid")
        if vit in puuids and mat != vit and k.get("location"):  # morte na própria spike não conta (igual ao placar)
            out.append({"tipo": "morte", "x": k["location"]["x"], "y": k["location"]["y"],
                        "lado": lados.get((vit, rid + 1)), "n": rid + 1, "quem": vit})
        if mat in puuids and mat != vit:
            loc = next((pl.get("location") for pl in k.get("player_locations") or []
                        if av.g(pl, "player", "puuid") == mat), None)
            if loc:
                out.append({"tipo": "kill", "x": loc["x"], "y": loc["y"], "lado": lados.get((mat, rid + 1)),
                            "n": rid + 1, "quem": mat})
    return out


_POSICOES = {}


def posicoes_do_mapa(nome, limite=40):
    """Posições de todos os jogadores nas partidas salvas deste mapa (para a silhueta)."""
    if nome in _POSICOES:
        return _POSICOES[nome]
    pts = _POSICOES[nome] = []
    for mid in list(armazem.indice())[-400:]:
        p = armazem.ler_partida(mid)
        if not p or av.g(p, "metadata", "map", "name") != nome:
            continue
        for k in p.get("kills") or []:
            for pl in k.get("player_locations") or []:
                if pl.get("location"):
                    pts.append((pl["location"]["x"], pl["location"]["y"]))
        limite -= 1
        if limite <= 0:
            break
    return pts


# ----------------------------------------------------------------------------
# Desenho
# ----------------------------------------------------------------------------

def _grade_suave(pontos_uv, sigma_celulas, n=GRADE):
    """Soma de gaussianas numa grade n x n (Python puro, sem numpy)."""
    g = [[0.0] * n for _ in range(n)]
    for u, v in pontos_uv:
        i, j = int(v * n), int(u * n)
        if 0 <= i < n and 0 <= j < n:
            g[i][j] += 1.0
    r = max(1, int(3 * sigma_celulas))
    ker = [math.exp(-(t * t) / (2 * sigma_celulas ** 2)) for t in range(-r, r + 1)]
    tmp = [[0.0] * n for _ in range(n)]
    for i in range(n):
        lin = g[i]
        if not any(lin):
            continue
        out = tmp[i]
        for j, val in enumerate(lin):
            if val:
                for t, kv in enumerate(ker):
                    jj = j + t - r
                    if 0 <= jj < n:
                        out[jj] += val * kv
    res = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j, val in enumerate(tmp[i]):
            if val:
                for t, kv in enumerate(ker):
                    ii = i + t - r
                    if 0 <= ii < n:
                        res[ii][j] += val * kv
    return res


PARADAS = [(0.00, (160, 104, 255, 0)), (0.18, (160, 104, 255, 110)), (0.45, (190, 110, 230, 170)),
           (0.70, (246, 184, 76, 210)), (1.00, (246, 112, 112, 240))]


def _cor_calor(t):
    for (t0, c0), (t1, c1) in zip(PARADAS, PARADAS[1:]):
        if t <= t1:
            f = (t - t0) / (t1 - t0)
            return tuple(int(c0[k] + (c1[k] - c0[k]) * f) for k in range(4))
    return PARADAS[-1][1]


def _camada_calor(pontos_uv, info, tam):
    sigma = SIGMA_UNID * abs(info["xm"]) * GRADE
    g = _grade_suave(pontos_uv, sigma)
    maior = max((v for lin in g for v in lin), default=0)
    img = Image.new("RGBA", (GRADE, GRADE), (0, 0, 0, 0))
    if maior <= 0:
        return img.resize((tam, tam))
    px = img.load()
    for i in range(GRADE):
        for j in range(GRADE):
            v = g[i][j] / maior
            if v > 0.03:
                px[j, i] = _cor_calor(v ** 0.75)
    return img.resize((tam, tam), Image.BICUBIC)


def _fundo_mapa(info, nome, tam):
    """Minimapa oficial tingido no tema; sem ele, a silhueta reconstruída das posições."""
    if info and info.get("imagem"):
        try:
            ic = Image.open(info["imagem"]).convert("RGBA").resize((tam, tam), Image.LANCZOS)
            lum = ic.convert("L")
            alfa = ic.getchannel("A")
            claro, escuro = (122, 108, 170), (52, 45, 76)
            cor = Image.merge("RGB", [lum.point(lambda v, a=escuro[k], b=claro[k]: int(a + (b - a) * v / 255))
                                      for k in range(3)])
            cor.putalpha(alfa)
            return cor, "minimapa"
        except OSError:
            pass
    pts = [projetar(info, x, y) for x, y in posicoes_do_mapa(nome)] if info else []
    pts = [(u, v) for u, v in pts if 0 <= u <= 1 and 0 <= v <= 1]
    camada = Image.new("RGBA", (tam, tam), (0, 0, 0, 0))
    if pts:
        n = 220
        m = Image.new("L", (n, n), 0)
        dm = ImageDraw.Draw(m)
        for u, v in pts:
            dm.ellipse((u * n - 1.6, v * n - 1.6, u * n + 1.6, v * n + 1.6), fill=255)
        m = m.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.2))
        m = m.point(lambda v: 255 if v > 60 else 0).resize((tam, tam), Image.BICUBIC)
        m = m.filter(ImageFilter.GaussianBlur(2))
        base = Image.new("RGBA", (tam, tam), (70, 61, 102, 255))
        camada.paste(base, (0, 0), m)
    return camada, "silhueta"


def desenhar_mapa(info, nome, evs, tam):
    """Imagem RGBA tam x tam: mapa + calor das mortes + pontos (mortes e abates) + letras dos bombs."""
    img = Image.new("RGBA", (tam, tam), (0, 0, 0, 0))
    fundo, tipo = _fundo_mapa(info, nome, tam)
    img.alpha_composite(fundo)
    if not info:
        return img, tipo
    uv = lambda e: projetar(info, e["x"], e["y"])
    dentro = lambda p: 0 <= p[0] <= 1 and 0 <= p[1] <= 1
    mortes = [p for p in (uv(e) for e in evs if e["tipo"] == "morte") if dentro(p)]
    kills = [p for p in (uv(e) for e in evs if e["tipo"] == "kill") if dentro(p)]
    img.alpha_composite(_camada_calor(mortes, info, tam))
    d = ImageDraw.Draw(img)
    for u, v in kills:
        x, y = u * tam, v * tam
        d.ellipse((x - 6, y - 6, x + 6, y + 6), fill=cd.VERDE + (255,), outline=cd.FUNDO + (255,), width=2)
    for u, v in mortes:
        x, y = u * tam, v * tam
        d.ellipse((x - 4, y - 4, x + 4, y + 4), fill=cd.TEXTO + (255,), outline=cd.FUNDO + (255,), width=1)
    # Letras dos bombs e spawns (pelos callouts)
    marcas = {}
    for c in info.get("callouts") or []:
        if c["regiao"] == "Site":
            marcas[c["super"]] = (c["x"], c["y"])
        elif c["regiao"] == "Spawn":
            marcas["ATQ" if "Attacker" in (c["super"] or "") else "DEF"] = (c["x"], c["y"])
    f = cd.fonte("negrito", 22)
    for rot, (gx, gy) in marcas.items():
        u, v = projetar(info, gx, gy)
        if not dentro((u, v)):
            continue
        x, y = u * tam, v * tam
        w = cd.largura(d, rot, f) + 22
        d.rounded_rectangle((x - w / 2, y - 17, x + w / 2, y + 17), radius=17,
                            fill=(cd.ROXO if len(rot) == 1 else cd.CINZA_CLARO) + (235,))
        d.text((x, y), rot, font=f, fill=cd.BRANCO + (255,), anchor="mm")
    return img, tipo


# ----------------------------------------------------------------------------
# Card
# ----------------------------------------------------------------------------

def card_calor(titulo_mapa, subtitulo, evs, info, cfg, dia, ctx, agente=None, nomes_por_puuid=None):
    img = Image.new("RGB", (cd.W, cd.H), cd.FUNDO)
    d = cd.Pincel(img)
    cd.faixa_marca(d, "Mapa de calor", f"{datetime.fromisoformat(dia):%d/%m/%Y}")
    if agente:
        cd.selo_agente(img, d, cd.M, 112, 132, agente)
    else:
        cd.logo(d, cd.M + 6, 118, 120)
    d.text((cd.M + 160, 118), titulo_mapa, font=cd.fonte("display", 64), fill=cd.TEXTO, anchor="la")
    d.text((cd.M + 162, 196), subtitulo, font=cd.fonte("medio", 23), fill=cd.SUAVE, anchor="la")
    n_m = sum(1 for e in evs if e["tipo"] == "morte")
    n_k = sum(1 for e in evs if e["tipo"] == "kill")
    xc = cd.chip(d, cd.M + 160, 232, f"{n_m} morte{'s' if n_m != 1 else ''}", cd.VERMELHO_CLARO, cd.VERMELHO,
                 cd.fonte("semi", 19), alt=38, pad=14) + 8
    cd.chip(d, xc, 232, f"{n_k} abate{'s' if n_k != 1 else ''}", cd.VERDE_CLARO, cd.VERDE, cd.fonte("semi", 19),
            alt=38, pad=14)

    # Mapa
    tam = 860
    x0, y0 = (cd.W - tam) // 2, 300
    cd.painel(d, cd.M, y0 - 12, cd.W - cd.M, y0 + tam + 12, raio=22)
    mapa, tipo = desenhar_mapa(info, titulo_mapa, evs, tam)
    img.paste(mapa, (x0, y0), mapa)
    d = cd.Pincel(img)
    if not info:
        d.text((cd.W / 2, y0 + tam / 2), "Mapa sem dados de projeção ainda", font=cd.fonte("semi", 26),
               fill=cd.SUAVE, anchor="mm")

    # Onde mais morre
    yb = y0 + tam + 28
    cd.painel(d, cd.M, yb, cd.W - cd.M, cd.H - 74, raio=18)
    cd.rotulo(d, cd.M + 28, yb + 20, "Onde mais morre")
    # legenda
    lx = cd.W - cd.M - 28
    for rot, cor in (("abate", cd.VERDE), ("morte", cd.TEXTO)):
        w = cd.largura(d, rot, cd.fonte("regular", 17))
        d.text((lx, yb + 19), rot, font=cd.fonte("regular", 17), fill=cd.SUAVE, anchor="ra")
        d.ellipse((lx - w - 22, yb + 22, lx - w - 10, yb + 34), fill=cor)
        lx -= w + 44
    contagem, lados, quem = Counter(), defaultdict(Counter), defaultdict(Counter)
    if info and info.get("callouts"):
        for e in evs:
            if e["tipo"] != "morte":
                continue
            nome = nome_callout(info, e["x"], e["y"])
            if nome:
                contagem[nome] += 1
                lados[nome][e["lado"]] += 1
                quem[nome][e["quem"]] += 1
    if contagem:
        xc, yc = cd.M + 28, yb + 58
        for nome, n in contagem.most_common(4):
            lado = lados[nome].most_common(1)[0][0]
            extra = f" · {'ataque' if lado == 'ataque' else 'defesa'}" if lado and lados[nome][lado] / n >= 0.7 else ""
            if nomes_por_puuid and len(quem[nome]) > 1:
                pu, k = quem[nome].most_common(1)[0]
                extra += f" (mais: {nomes_por_puuid.get(pu, '?')} {k})"
            t = f"{nome} · {n}x{extra}"
            w = cd.largura(d, t, cd.fonte("semi", 20)) + 30
            if xc + w > cd.W - cd.M - 24:
                xc, yc = cd.M + 28, yc + 46
                if yc > cd.H - 74 - 50:
                    break
            xc = cd.chip(d, xc, yc, t, cd.ROXO_CLARO, cd.ROXO_TEXTO, cd.fonte("semi", 20), alt=40, pad=15) + 10
    else:
        msg = "Sem mortes neste mapa na janela." if not n_m else "Os nomes das regiões aparecem quando os dados do mapa forem baixados."
        d.text((cd.M + 28, yb + 66), msg, font=cd.fonte("regular", 20), fill=cd.SUAVE, anchor="la")
    nota = "" if tipo == "minimapa" else " Desenho do mapa reconstruído pelas posições (o minimapa oficial entra quando for baixado)."
    cd.rodape(d, f"Calor = onde as mortes se repetem; pontos brancos = mortes, verdes = de onde saiu o abate.{nota}")
    return img


# ----------------------------------------------------------------------------
# Seleção do que desenhar
# ----------------------------------------------------------------------------

def _mapa_do_dia(lista):
    """Mapa com mais rounds hoje em [(análise, jogador)]."""
    rounds = Counter()
    for a, j in lista:
        rounds[a["mapa"]] += len(j["rounds"])
    return rounds.most_common(1)[0][0] if rounds else None


def cards_calor(dia, cfg, ctx, hoje, base, salvar):
    baixar_mapas()
    janela = gr.na_janela(ctx)

    def evs_de(puuids, mapa):
        out, partidas, uuid = [], 0, None
        for a in janela:
            if a["mapa"] != mapa or not any(pu in a["jogadores"] for pu in puuids):
                continue
            bruta = gr.bruta_de(ctx, a["match_id"])
            uuid = uuid or av.g(bruta or {}, "metadata", "map", "id")
            out += eventos(a, bruta, {pu for pu in puuids if pu in a["jogadores"]})
            partidas += 1
        return out, partidas, uuid

    for rid in ctx["equipe"]:
        lista = hoje.get(rid) or []
        mapa = _mapa_do_dia(lista)
        pu = ctx["puuid_de"].get(rid)
        if not mapa or not pu:
            continue
        evs, n, uuid = evs_de({pu}, mapa)
        ags = Counter(j["agente"] for a, j in lista if a["mapa"] == mapa)
        agente = ags.most_common(1)[0][0] if ags else None
        sub = f"{gr.apelido(rid, cfg)} · {n} partida{'s' if n != 1 else ''} em {cfg['janela_dias']} dias"
        img = card_calor(mapa, sub, evs, info_mapa(mapa, uuid), cfg, dia, ctx, agente=agente)
        salvar(img, base / gr.nome_pasta((rid,), cfg) / "cards", "calor.png")

    # Equipe: o mapa que mais apareceu hoje (partidas distintas)
    por_mapa = Counter()
    for mid in {a["match_id"]: a for l in hoje.values() for a, _ in l}.values():
        por_mapa[mid["mapa"]] += 1
    if por_mapa:
        mapa = por_mapa.most_common(1)[0][0]
        pus = {ctx["puuid_de"][r] for r in ctx["equipe"] if r in ctx["puuid_de"]}
        evs, n, uuid = evs_de(pus, mapa)
        nomes = {ctx["puuid_de"][r]: gr.apelido(r, cfg) for r in ctx["equipe"] if r in ctx["puuid_de"]}
        sub = f"Equipe · {n} partida{'s' if n != 1 else ''} em {cfg['janela_dias']} dias"
        img = card_calor(mapa, sub, evs, info_mapa(mapa, uuid), cfg, dia, ctx, nomes_por_puuid=nomes)
        salvar(img, base / gr.PASTA_EQUIPE / "cards", "calor_equipe.png")


if __name__ == "__main__":
    import cards
    dia = sys.argv[1] if len(sys.argv) > 1 else datetime.now(av.FUSO_BR).date().isoformat()
    for a in cards.gerar_cards(dia):
        print(a)
