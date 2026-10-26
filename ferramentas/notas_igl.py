#!/usr/bin/env python3
"""
Editor das Notas da IGL — ValReport (NokyLabs)

Abre o site no seu PC (http://127.0.0.1:8765) com botões para escrever notas:
  - por partida (o que funcionou, a estratégia, o que treinar);
  - por round (a leitura daquele round);
  - por mapa (o plano da equipe naquele mapa).

As notas ficam em notas/notas.json e vão para o site na próxima publicação
(publicar_site.bat ou o report das 21h com "publicar_automatico": true).

⚠️ O site é público: o que você escrever aqui aparece para qualquer pessoa com o link.
   Para não publicar as notas, use "site": {"publicar_notas": false} no config.json.

Uso: dois cliques em editar_notas.bat (ou: py notas_igl.py). Feche a janela para sair.
"""

import json
import os
import sys
import threading
import tempfile
import webbrowser
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

PASTA = Path(__file__).resolve().parent.parent  # pasta principal do projeto (o código fica em ferramentas/)
DOCS = PASTA / "docs"
ARQ = PASTA / "notas" / "notas.json"
PORTA = 8765
LIMITE = 64 * 1024


def ler():
    try:
        dados = json.loads(ARQ.read_text(encoding="utf-8"))
        if isinstance(dados, dict):
            dados.setdefault("partidas", {})
            dados.setdefault("mapas", {})
            return dados
    except (OSError, ValueError):
        pass
    return {"partidas": {}, "mapas": {}}


def salvar(dados):
    ARQ.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=ARQ.parent, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=1)
    os.replace(tmp, ARQ)
    # Atualiza também o arquivo que o site lê, para ver a nota na hora
    try:
        import exportar_site as es
        import gerar_report as gr
        cfg = gr.ler_json(PASTA / "config.json", {})
        ids = {p["id"] for p in gr.ler_json(es.PASTA_DATA / "partidas.json", []) or []}
        es.gravar(es.PASTA_DATA / "notas.json", es.notas_json(cfg, ids))
        # manda só as notas para o site (sem travar o editor enquanto envia)
        threading.Thread(target=es.enviar_supabase, args=(cfg, ["notas.json"]), daemon=True).start()
    except Exception as e:  # noqa: BLE001
        print(f"Aviso: a nota foi salva, mas o site só mostra depois de exportar ({e}).")


def aplicar(dados, pedido):
    tipo, alvo = pedido.get("tipo"), str(pedido.get("id") or "")
    texto = str(pedido.get("texto") or "").strip()[:6000]
    agora = datetime.now().astimezone().isoformat(timespec="seconds")
    if tipo == "mapa":
        if texto:
            dados["mapas"][alvo] = {"texto": texto, "atualizado": agora}
        else:
            dados["mapas"].pop(alvo, None)
        return
    if tipo not in ("partida", "round") or not alvo:
        raise ValueError("pedido inválido")
    nota = dados["partidas"].setdefault(alvo, {"texto": "", "rounds": {}})
    nota.setdefault("rounds", {})
    if tipo == "partida":
        nota["texto"] = texto
    else:
        n = str(int(pedido.get("n")))
        if texto:
            nota["rounds"][n] = texto[:2000]
        else:
            nota["rounds"].pop(n, None)
    nota["atualizado"] = agora
    if not nota["texto"] and not nota["rounds"]:
        dados["partidas"].pop(alvo, None)


class Editor(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DOCS), **kwargs)

    def log_message(self, *args):  # silencioso
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, codigo, dados):
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _origem_ok(self):
        """Só aceita pedidos vindos do próprio editor (protege contra outros sites abertos no navegador)."""
        origem = self.headers.get("Origin")
        if not origem:
            return True
        host = urlparse(origem).hostname
        return host in ("127.0.0.1", "localhost") and urlparse(origem).port == self.server.server_address[1]

    def do_GET(self):
        caminho = urlparse(self.path).path
        if caminho.endswith("/api/ping"):
            return self._json(200, {"ok": True, "editor": True})
        if caminho.endswith("/api/notas"):
            return self._json(200, ler())
        if caminho.startswith("/data/"):  # os dados do site moram em dados/site (fora do GitHub)
            import exportar_site as es
            alvo = (es.PASTA_DATA / caminho[len("/data/"):]).resolve()
            if es.PASTA_DATA.resolve() not in alvo.parents or not alvo.is_file():
                return self._json(404, {"ok": False, "erro": "não encontrado"})
            corpo = alvo.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
            return None
        return super().do_GET()

    def do_POST(self):
        if not urlparse(self.path).path.endswith("/api/notas") or not self._origem_ok():
            return self._json(403, {"ok": False, "erro": "não permitido"})
        tamanho = int(self.headers.get("Content-Length") or 0)
        if tamanho <= 0 or tamanho > LIMITE:
            return self._json(413, {"ok": False, "erro": "nota grande demais"})
        try:
            pedido = json.loads(self.rfile.read(tamanho).decode("utf-8"))
            dados = ler()
            aplicar(dados, pedido)
            salvar(dados)
        except (ValueError, TypeError) as e:
            return self._json(400, {"ok": False, "erro": str(e)})
        print(f"Nota salva ({pedido.get('tipo')} {pedido.get('id')}{' R' + str(pedido.get('n')) if pedido.get('n') else ''}).")
        return self._json(200, {"ok": True, "notas": dados})


def main():
    if not (DOCS / "index.html").exists():
        print("Não encontrei a pasta docs (o site). Rode este arquivo na pasta do ValReport.")
        sys.exit(1)
    import exportar_site
    if not (exportar_site.PASTA_DATA / "partidas.json").exists():
        try:
            exportar_site.exportar()
        except Exception as e:  # noqa: BLE001
            print(f"Rode py exportar_site.py antes ({e}).")
    servidor = None
    for porta in range(PORTA, PORTA + 10):
        try:
            servidor = ThreadingHTTPServer(("127.0.0.1", porta), Editor)
            break
        except OSError:
            continue
    if not servidor:
        print("Nenhuma porta livre entre 8765 e 8774.")
        sys.exit(1)
    url = f"http://127.0.0.1:{servidor.server_address[1]}/#/equipe/partidas"
    print("=" * 64)
    print(" Editor das Notas da IGL")
    print(f" Abra: {url}")
    print(" Em cada partida, aba 'Notas da IGL'. No Rounds e nos Mapas também.")
    print(" As notas vão para o site sozinhas ao salvar (só a equipe vê; convidados não).")
    print(" Para sair, feche esta janela.")
    print("=" * 64)
    try:
        webbrowser.open(url)
    except Exception:  # noqa: BLE001
        pass
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
