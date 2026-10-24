#!/usr/bin/env python3
"""
Envio dos cards para o Discord (webhooks) — NokyLabs

Cada canal tem o seu webhook, guardado numa variável de ambiente (a URL é como uma senha: não vai no config.json).
  DISCORD_WEBHOOK_EQUIPE      -> equipe, economia, mapas, mapa de calor da equipe
  DISCORD_WEBHOOK_JOGADORES   -> resumo solo, agente e mapa de calor de cada jogador
  DISCORD_WEBHOOK_FORMACOES   -> um card por duo, trio, quad e five stack do dia
  DISCORD_WEBHOOK_DICAS       -> card de dicas + links dos vídeos

Canal sem webhook configurado é simplesmente pulado. Se o Discord falhar, o report continua normal.

Uso:
    py discord_envio.py --teste            (manda uma mensagem de teste para cada canal)
    py discord_envio.py 2026-10-23         (envia o dia, se ainda não foi enviado)
    py discord_envio.py 2026-10-23 --forcar
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

import gerar_report as gr

PASTA = Path(__file__).resolve().parent
ARQ_ESTADO = gr.DADOS / "discord_enviado.json"
CANAIS = {"equipe": "DISCORD_WEBHOOK_EQUIPE", "jogadores": "DISCORD_WEBHOOK_JOGADORES",
          "formacoes": "DISCORD_WEBHOOK_FORMACOES", "dicas": "DISCORD_WEBHOOK_DICAS"}


def postar(url, conteudo="", arquivos=(), nome="NokyLabs", avatar=""):
    """Envia uma mensagem (texto + até 10 imagens). Trata o limite de velocidade do Discord."""
    payload = {"username": nome, "content": conteudo[:2000], "allowed_mentions": {"parse": []}}
    if avatar:
        payload["avatar_url"] = avatar
    limite = "----nokylabs" + uuid.uuid4().hex
    corpo = bytearray()

    def parte(cabecalho, dados):
        corpo.extend(f"--{limite}\r\n{cabecalho}\r\n\r\n".encode())
        corpo.extend(dados)
        corpo.extend(b"\r\n")

    parte('Content-Disposition: form-data; name="payload_json"\r\nContent-Type: application/json',
          json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    usados = set()
    for i, arq in enumerate(arquivos):
        arq = Path(arq)
        nome_arq = arq.name
        if nome_arq in usados:  # dois anexos com o mesmo nome: usa a pasta da formação/jogador
            nome_arq = f"{gr.nome_arquivo(arq.parent.parent.name)}_{arq.name}"
        usados.add(nome_arq)
        parte(f'Content-Disposition: form-data; name="files[{i}]"; filename="{nome_arq}"\r\nContent-Type: image/png',
              arq.read_bytes())
    corpo.extend(f"--{limite}--\r\n".encode())

    for tentativa in range(4):
        req = urllib.request.Request(url, data=bytes(corpo), method="POST", headers={
            "Content-Type": f"multipart/form-data; boundary={limite}", "User-Agent": "NokyLabs-Report/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=60):
                time.sleep(1.2)
                return True
        except urllib.error.HTTPError as e:
            if e.code == 429:
                try:
                    espera = float(json.loads(e.read()).get("retry_after", 2))
                except Exception:
                    espera = 2
                time.sleep(espera + 0.5)
                continue
            print(f"  Discord recusou ({e.code}). Confira o link do webhook.")
            return False
        except Exception as e:
            print(f"  Falha de rede ao enviar ao Discord ({e}).")
            time.sleep(2)
    return False


def cortar(texto, limite):
    """Corta no fim de uma linha, para não partir um link ao meio."""
    if len(texto) <= limite:
        return texto
    return texto[:limite].rsplit("\n", 1)[0] + "\n…"


def webhooks():
    return {c: os.environ.get(v, "").strip() for c, v in CANAIS.items() if os.environ.get(v, "").strip()}


def testar(cfg):
    hooks = webhooks()
    if not hooks:
        print("Nenhum webhook configurado (veja o LEIA-ME, seção Discord).")
    for canal, url in hooks.items():
        ok = postar(url, f"✅ Teste do canal **{canal}** — NokyLabs conectado.", nome=(cfg.get("discord") or {}).get("nome", "NokyLabs"))
        print(f"  {canal}: {'ok' if ok else 'falhou'}")


def resumo_formacoes(jogos, cfg, dia):
    formacoes = list(dict.fromkeys(j["membros"] for j in jogos))
    linhas = [f"🤝 **Duos, trios e five stack — {datetime.fromisoformat(dia):%d/%m/%Y}**", ""]
    for membros in formacoes:
        js = [j for j in jogos if j["membros"] == membros]
        vit = sum(1 for j in js if j["resultado"] == "vitória")
        trades = sum(sum(j["trades"].values()) for j in js)
        nomes = " & ".join(gr.apelido(r, cfg) for r in membros)
        linhas.append(f"**{gr.FORMACAO.get(len(membros), '?')} · {nomes}** — {len(js)} partida{'s' if len(js) > 1 else ''}, "
                      f"{vit}V {len(js) - vit}D, {trades} trade{'s' if trades != 1 else ''} entre vocês")
    return "\n".join(linhas) if formacoes else None


def enviar(dia, cfg=None, base=None, forcar=False):
    cfg = gr.config_padrao(cfg or gr.ler_json(PASTA / "config.json", {}))
    dc = cfg.get("discord") or {}
    if dc.get("ativo", True) is False:
        return False
    hooks = webhooks()
    if not hooks:
        print("Discord: nenhum webhook configurado, nada enviado.")
        return False
    estado = gr.ler_json(ARQ_ESTADO, {}) or {}
    if estado.get(dia) and not forcar:
        print(f"Discord: o dia {dia} já foi enviado (use --forcar para reenviar).")
        return False

    base = Path(base or (gr.PASTA_REPORTS / dia))
    nome, avatar = dc.get("nome", "NokyLabs"), dc.get("avatar_url", "")
    data = f"{datetime.fromisoformat(dia):%d/%m/%Y}"
    feitos = []

    def mandar(canal, texto, arquivos=()):
        arquivos = [a for a in arquivos if Path(a).exists()]
        if canal in hooks and (arquivos or texto):
            ok = postar(hooks[canal], texto, arquivos, nome, avatar)
            feitos.append((canal, ok))

    ce = base / gr.PASTA_EQUIPE / "cards"
    mandar("equipe", f"📊 **Report diário da equipe — {data}**", [ce / "equipe.png", ce / "economia.png", ce / "mapas.png", ce / "calor_equipe.png"])

    resumo = gr.ler_json(gr.PASTA_RESUMOS / f"{dia}.json") or {"jogadores": {}}
    for rid in resumo.get("jogadores", {}):
        pasta = base / gr.nome_pasta((rid,), cfg) / "cards"
        if not pasta.exists():
            continue
        mandar("jogadores", f"👤 **{gr.apelido(rid, cfg)}** — {data}", [pasta / "resumo_solo.png", pasta / "agente.png", pasta / "calor.png"])
        dicas_md = pasta / "dicas.md"
        texto = dicas_md.read_text(encoding="utf-8") if dicas_md.exists() else ""
        mandar("dicas", f"💡 **{gr.apelido(rid, cfg)}** — dicas de {data}\n" + cortar(texto.split("\n", 2)[-1], 1700), [pasta / "dicas.png"])

    if "formacoes" in hooks:
        try:
            import cards
            _, _, _, _, jogos = cards.dados_do_dia(dia, cfg)
            txt = resumo_formacoes(jogos, cfg, dia)
            imagens = []
            for membros in dict.fromkeys(j["membros"] for j in jogos):
                pasta = base / gr.nome_pasta(membros, cfg) / "cards"
                imagens.append(pasta / ("five_stack.png" if pasta.parent.name == gr.PASTA_EQUIPE else "formacao.png"))
            if txt:
                mandar("formacoes", txt, imagens[:10])
        except Exception as e:
            print(f"Discord: formações não enviadas ({e})")

    ok = all(o for _, o in feitos) and bool(feitos)
    if ok:
        estado[dia] = datetime.now().isoformat(timespec="seconds")
        ARQ_ESTADO.parent.mkdir(parents=True, exist_ok=True)
        ARQ_ESTADO.write_text(json.dumps(estado, indent=1), encoding="utf-8")
    print(f"Discord: {len(feitos)} mensagem(ns) enviada(s)" + ("" if ok else " (alguma falhou: nada marcado como enviado)"))
    return ok


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    cfg0 = gr.ler_json(PASTA / "config.json", {})
    if "--teste" in sys.argv:
        testar(cfg0)
    else:
        enviar(args[0] if args else datetime.now(gr.FUSO_BR).date().isoformat(), cfg0, forcar="--forcar" in sys.argv)
