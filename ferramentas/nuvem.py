"""Coleta na nuvem — NokyLabs

A coleta de 20 em 20 minutos e o report das 21h rodam no GitHub Actions (.github/workflows), sem depender do PC.
A pasta dados mora num espaço privado do Supabase ("coleta"), que só a chave secreta acessa:

  preparar   (nuvem) baixa a configuração do banco (config.json) e restaura a pasta dados: primeiro do cache do
             GitHub (criptografado com a chave secreta), e do espaço privado quando o cache estiver velho ou faltar.
  coletar    (nuvem) roda a coleta rápida (ou, com --report, a coleta completa + report + Discord). Tudo o que a
             coleta escreve vai para o log privado (dados/nuvem.log); no log público do GitHub aparecem só contagens,
             porque num repositório público qualquer pessoa vê esses logs.
  guardar    (nuvem) devolve a pasta dados ao espaço privado (só quando algo mudou), guarda uma cópia por dia
             (as dos últimos 14 dias) e prepara o cache criptografado para a próxima execução.
  manter     (nuvem) mantém os agendamentos ligados (o GitHub desliga depois de 60 dias sem atividade).
  enviar     (PC, uma vez) manda o config.json e a pasta dados do PC para a nuvem e oferece desligar as tarefas do PC.
  trazer     (PC, se um dia quiser voltar) traz a pasta dados da nuvem para o PC.

Só usa a biblioteca padrão do Python (e o openssl, que já vem no GitHub Actions, para o cache criptografado).
"""

import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

PASTA = Path(__file__).resolve().parent.parent
DADOS = PASTA / "dados"
ARQ_CONFIG = PASTA / "config.json"
ARQ_MARCA = DADOS / ".nuvem.json"          # o que esta cópia da pasta dados sabe de si mesma (sequência, quando enviou)
ARQ_LOG = DADOS / "nuvem.log"              # log privado de tudo o que a coleta escreveu na nuvem
BALDE = "coleta"
OBJ_ESTADO = "estado.tar.gz"
OBJ_MARCA = "marca.json"
PASTA_COPIAS = "copias/"                   # uma cópia por dia, para voltar atrás se algo der errado
DIAS_COPIAS = 14
ARQ_PREPARADO = DADOS / ".preparado"     # só existe quando o "preparar" terminou bem nesta execução
FORA = {"site", "reports", "coleta.trava", ".nuvem.json", ".preparado", "nuvem.log.tmp"}   # o site e os reports são refeitos a cada execução
FORA_CACHE = {"agentes", "mapas"}          # imagens públicas: ficam num cache à parte, sem segredo nenhum
NA_NUVEM = os.environ.get("GITHUB_ACTIONS") == "true"
TAREFAS_PC = ["NokyLabs - Report VALORANT", "NokyLabs - Atualizar site VALORANT"]


class FaltaNaNuvem(Exception):
    pass


# ----------------------------------------------------------------------------
# Supabase (chave secreta)
# ----------------------------------------------------------------------------

def _supabase():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import elenco_site
    cfg = _ler_json(ARQ_CONFIG, {}) or {}
    url, chave, slug = elenco_site._supabase(cfg)
    if not chave:
        raise FaltaNaNuvem("falta a SUPABASE_SECRET_KEY")
    return url, chave, slug


def _cab(chave, extra=None):
    cab = {"apikey": chave, "User-Agent": "NokyLabs-ValReport/2.0"}
    if chave.startswith("eyJ"):
        cab["Authorization"] = f"Bearer {chave}"
    cab.update(extra or {})
    return cab


def _http(metodo, url, chave, dados=None, tipo=None, extra=None, timeout=120):
    cab = _cab(chave, extra)
    if tipo:
        cab["Content-Type"] = tipo
    req = urllib.request.Request(url, data=dados, method=metodo, headers=cab)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def rpc(nome, corpo):
    url, chave, _ = _supabase()
    t = _http("POST", f"{url}/rest/v1/rpc/{nome}", chave, json.dumps(corpo, ensure_ascii=False).encode("utf-8"), "application/json")
    return json.loads(t) if t.strip() else None


def baixar(nome):
    """Bytes de um arquivo do espaço privado, ou None se não existir."""
    url, chave, _ = _supabase()
    try:
        return _http("GET", f"{url}/storage/v1/object/authenticated/{BALDE}/{urllib.parse.quote(nome)}", chave)
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            return None
        raise


def enviar_arquivo(nome, dados, tipo="application/octet-stream"):
    url, chave, _ = _supabase()
    _http("POST", f"{url}/storage/v1/object/{BALDE}/{urllib.parse.quote(nome)}", chave, dados, tipo, {"x-upsert": "true"})


def listar(prefixo):
    url, chave, _ = _supabase()
    t = _http("POST", f"{url}/storage/v1/object/list/{BALDE}", chave,
              json.dumps({"prefix": prefixo, "limit": 1000}).encode(), "application/json")
    return [x["name"] for x in json.loads(t) if x.get("name")]


def apagar(nomes):
    if not nomes:
        return
    url, chave, _ = _supabase()
    _http("DELETE", f"{url}/storage/v1/object/{BALDE}", chave, json.dumps({"prefixes": nomes}).encode(), "application/json")


# ----------------------------------------------------------------------------
# A pasta dados como um pacote
# ----------------------------------------------------------------------------

def _ler_json(caminho, padrao):
    try:
        return json.loads(Path(caminho).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return padrao


def _arquivos():
    """Arquivos da pasta dados que vão para a nuvem (sem o site, os reports, a trava e as imagens públicas)."""
    if not DADOS.exists():
        return []
    out = []
    for p in sorted(DADOS.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(DADOS).parts
        if rel[0] in FORA or (rel[0] == "cache" and len(rel) > 1 and rel[1] in FORA_CACHE) or p.suffix == ".tmp":
            continue
        out.append(p)
    return out


def impressao():
    """Resumo do conteúdo (muda se qualquer arquivo mudar)."""
    h = hashlib.sha256()
    for p in _arquivos():
        h.update(p.relative_to(DADOS).as_posix().encode() + b"\0" + hashlib.sha256(p.read_bytes()).digest())
    return h.hexdigest()


def empacotar():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", compresslevel=6) as tar:
        for p in _arquivos():
            info = tar.gettarinfo(str(p), arcname=p.relative_to(DADOS).as_posix())
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            with open(p, "rb") as f:
                tar.addfile(info, f)
    return buf.getvalue()


def desempacotar(dados):
    """Restaura a pasta dados a partir de um pacote (só arquivos comuns, sempre dentro da pasta dados)."""
    DADOS.mkdir(parents=True, exist_ok=True)
    raiz = DADOS.resolve()
    with tarfile.open(fileobj=io.BytesIO(dados), mode="r:gz") as tar:
        for m in tar.getmembers():
            alvo = (DADOS / m.name).resolve()
            if not m.isfile() or (raiz not in alvo.parents):
                continue
            alvo.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(m) as f:
                alvo.write_bytes(f.read())


def _openssl(modo, entrada, saida):
    """Criptografa/abre o cache do GitHub com a chave secreta do Supabase (o cache de um repositório público
    pode ser lido por outros fluxos; criptografado, não serve para ninguém sem a chave)."""
    if not os.environ.get("SUPABASE_SECRET_KEY"):
        raise FaltaNaNuvem("falta a SUPABASE_SECRET_KEY")
    args = ["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-md", "sha256", "-pass", "env:SUPABASE_SECRET_KEY",
            "-in", str(entrada), "-out", str(saida)]
    if modo == "abrir":
        args.insert(2, "-d")
    else:
        args.insert(2, "-salt")
    r = subprocess.run(args, capture_output=True)
    if r.returncode:
        raise RuntimeError("não consegui abrir o cache (a chave secreta mudou?)" if modo == "abrir" else "não consegui criptografar o cache")


def _agora():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import avaliacao as av
    return datetime.now(av.FUSO_BR)


# ----------------------------------------------------------------------------
# Comandos da nuvem
# ----------------------------------------------------------------------------

def preparar(cache=None):
    # 1. Configuração (o config.json mora no banco; o elenco continua vindo do site)
    c = rpc("pc_config_ler", {"p_slug": _supabase()[2]})
    if not c or not c.get("config"):
        raise FaltaNaNuvem("a configuração da coleta ainda não está na nuvem (rode o Atalhos\\enviar_para_nuvem.bat no PC)")
    ARQ_CONFIG.write_text(json.dumps(c["config"], ensure_ascii=False, indent=2), encoding="utf-8")

    # 2. Pasta dados: do cache do GitHub, se ele for tão novo quanto a nuvem; senão, do espaço privado
    marca_nuvem = json.loads(baixar(OBJ_MARCA) or b"null") or {}
    origem = None
    if cache and Path(cache).exists():
        try:
            tmp = Path(cache).with_suffix(".tar.gz")
            _openssl("abrir", cache, tmp)
            desempacotar(tmp.read_bytes())
            tmp.unlink(missing_ok=True)
            local = _ler_json(ARQ_MARCA, {}) or {}
            if local.get("seq", 0) >= marca_nuvem.get("seq", 0):
                origem = "cache"
            else:
                print(f"O cache estava atrás da nuvem (versão {local.get('seq', 0)} e {marca_nuvem.get('seq')}); baixando a nuvem.")
        except Exception as e:  # noqa: BLE001
            print(f"Cache não usado: {e}.")
    if origem is None:
        pacote = baixar(OBJ_ESTADO)
        if not pacote:
            raise FaltaNaNuvem("a pasta dados ainda não está na nuvem (rode o Atalhos\\enviar_para_nuvem.bat no PC)")
        desempacotar(pacote)
        origem = "nuvem"
        if marca_nuvem:
            ARQ_MARCA.write_text(json.dumps({**(_ler_json(ARQ_MARCA, {}) or {}), "seq": marca_nuvem.get("seq", 0),
                                             "hash": marca_nuvem.get("hash")}), encoding="utf-8")
    ARQ_PREPARADO.write_text(_agora().isoformat(timespec="seconds"), encoding="utf-8")
    n = len(list((DADOS / "partidas").glob("*.json*"))) if (DADOS / "partidas").exists() else 0
    print(f"Pronto para coletar: configuração versão {c.get('versao')}, pasta dados restaurada do {origem} ({n} partidas guardadas).")


def coletar(report=False):
    """Roda a coleta com toda a saída no log privado; no log público, só contagens."""
    antes = len(list((DADOS / "partidas").glob("*.json*"))) if (DADOS / "partidas").exists() else 0
    DADOS.mkdir(parents=True, exist_ok=True)
    args = [sys.executable, str(PASTA / "ferramentas" / "coletor_valorant.py")] + ([] if report else ["--rapido"])
    t0 = time.monotonic()
    with open(ARQ_LOG, "a", encoding="utf-8") as log:
        log.write(f"\n===== {_agora().isoformat(timespec='seconds')} · {'report' if report else 'coleta rápida'} =====\n")
        log.flush()
        r = subprocess.run(args, cwd=PASTA, stdout=log, stderr=subprocess.STDOUT, env={**os.environ, "PYTHONUTF8": "1"})
    depois = len(list((DADOS / "partidas").glob("*.json*"))) if (DADOS / "partidas").exists() else 0
    print(f"{'Report' if report else 'Coleta'} terminou em {round(time.monotonic() - t0)} s "
          f"({'ok' if r.returncode == 0 else 'com erro: veja o Diagnóstico no site'}) · partidas guardadas: {depois} ({depois - antes:+d}).")
    return r.returncode


def guardar(cache=None):
    """Devolve a pasta dados ao espaço privado se algo mudou, guarda a cópia do dia e prepara o cache."""
    if NA_NUVEM and not ARQ_PREPARADO.exists():
        print("Nada guardado: a preparação desta execução não terminou (a pasta dados da nuvem continua como estava).")
        return
    (DADOS / "coleta.trava").unlink(missing_ok=True)
    if ARQ_LOG.exists():   # o log privado guarda só o fim
        linhas = ARQ_LOG.read_text(encoding="utf-8", errors="replace").splitlines()
        if len(linhas) > 4000:
            ARQ_LOG.write_text("\n".join(linhas[-3000:]) + "\n", encoding="utf-8")
    marca = _ler_json(ARQ_MARCA, {}) or {}
    h = impressao()
    hoje = _agora().date().isoformat()
    pacote = None
    if h != marca.get("hash"):
        marca_nuvem = json.loads(baixar(OBJ_MARCA) or b"null") or {}
        if marca_nuvem.get("seq", 0) > marca.get("seq", 0):
            raise RuntimeError("a nuvem tem uma pasta dados mais nova que esta; nada foi enviado para não perder nada")
        marca.update({"seq": marca.get("seq", 0) + 1, "hash": h, "enviado_em": _agora().isoformat(timespec="seconds"),
                      "ambiente": "nuvem" if NA_NUVEM else "pc"})
        pacote = empacotar()
        enviar_arquivo(OBJ_ESTADO, pacote, "application/gzip")
        enviar_arquivo(OBJ_MARCA, json.dumps(marca).encode(), "application/json")
        print(f"Pasta dados guardada na nuvem (versão {marca['seq']}, {len(pacote) // 1024} KB).")
    else:
        print("Nada mudou na pasta dados.")
    if NA_NUVEM:   # sinal de vida (o PC olha isto para não coletar junto com a nuvem)
        marca.update({"ambiente": "nuvem", "visto_em": _agora().isoformat(timespec="seconds")})
        enviar_arquivo(OBJ_MARCA, json.dumps(marca).encode(), "application/json")
    if marca.get("copia_dia") != hoje:
        pacote = pacote or empacotar()
        enviar_arquivo(f"{PASTA_COPIAS}{hoje}.tar.gz", pacote, "application/gzip")
        limite = (_agora().date() - timedelta(days=DIAS_COPIAS)).isoformat()
        velhas = [f"{PASTA_COPIAS}{n}" for n in listar(PASTA_COPIAS.rstrip("/")) if n.endswith(".tar.gz") and n[:10] < limite]
        apagar(velhas)
        marca["copia_dia"] = hoje
        print(f"Cópia do dia guardada ({len(velhas)} cópia(s) antiga(s) apagada(s)).")
    ARQ_MARCA.write_text(json.dumps(marca), encoding="utf-8")
    if cache:   # o cache leva a marca junto, para a próxima execução saber se ele está em dia
        tmp = Path(cache).with_suffix(".tar.gz")
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for p in _arquivos() + [ARQ_MARCA]:
                tar.add(str(p), arcname=p.relative_to(DADOS).as_posix())
        tmp.write_bytes(buf.getvalue())
        _openssl("fechar", tmp, cache)
        tmp.unlink(missing_ok=True)


def diagnostico():
    """Diagnóstico completo (com os testes de rede) no log privado; no log público, só a contagem."""
    with open(ARQ_LOG, "a", encoding="utf-8") as log:
        log.write(f"\n===== {_agora().isoformat(timespec='seconds')} · diagnóstico =====\n")
        log.flush()
        subprocess.run([sys.executable, str(PASTA / "ferramentas" / "diagnostico.py")], cwd=PASTA, stdout=log, stderr=subprocess.STDOUT,
                       env={**os.environ, "PYTHONUTF8": "1"})
    t = ""
    try:
        t = (DADOS / "diagnostico.txt").read_text(encoding="utf-8")
    except OSError:
        pass
    ultima = (t.strip().splitlines() or ["?"])[-1]
    print(f"Diagnóstico: {ultima if ('problema' in ultima or 'Tudo certo' in ultima) else 'veja no site (Painel > Diagnóstico)'}")


def manter():
    """O GitHub desliga os agendamentos de repositório público depois de 60 dias sem atividade:
    a cada 20 dias, liga de novo (pela API, sem criar commit)."""
    marca = _ler_json(ARQ_MARCA, {}) or {}
    ultima = marca.get("mantido_em")
    if ultima and datetime.fromisoformat(ultima) > _agora() - timedelta(days=20):
        return
    repo = os.environ.get("GITHUB_REPOSITORY")
    if not repo:
        return
    ok = True
    for fluxo in ("coleta.yml", "report.yml"):
        r = subprocess.run(["gh", "api", "-X", "PUT", f"repos/{repo}/actions/workflows/{fluxo}/enable"], capture_output=True)
        ok = ok and r.returncode == 0
    if ok:
        marca["mantido_em"] = _agora().isoformat(timespec="seconds")
        ARQ_MARCA.write_text(json.dumps(marca), encoding="utf-8")
        print("Agendamentos renovados (o GitHub não vai desligá-los por falta de atividade).")
    else:
        print("Aviso: não consegui renovar os agendamentos agora; tento de novo na próxima execução.")


# ----------------------------------------------------------------------------
# Para o PC
# ----------------------------------------------------------------------------

def nuvem_ativa():
    """True se a nuvem guardou a pasta dados há menos de 3 horas (aí a coleta do PC não roda, para não duplicar)."""
    if NA_NUVEM or not os.environ.get("SUPABASE_SECRET_KEY", "").strip():
        return False
    try:
        m = json.loads(baixar(OBJ_MARCA) or b"null") or {}
        quando = m.get("visto_em") or m.get("enviado_em")
        return m.get("ambiente") == "nuvem" and bool(quando) and datetime.fromisoformat(quando) > _agora() - timedelta(hours=3)
    except Exception:  # noqa: BLE001 — sem internet ou sem o espaço privado: o PC segue como sempre
        return False


def _perguntar(texto):
    try:
        return input(texto).strip().lower().startswith("s")
    except EOFError:
        return False


def enviar_do_pc(forcar=False):
    print("Mandando a configuração e a pasta dados do PC para a nuvem...\n")
    cfg = _ler_json(ARQ_CONFIG, None)
    if not isinstance(cfg, dict):
        raise FaltaNaNuvem("não achei o config.json")
    r = rpc("pc_config_enviar", {"p_slug": _supabase()[2], "p_config": cfg, "p_substituir": bool(forcar)})
    print("Configuração: já estava na nuvem (mantive a de lá; para trocar, use o Painel > Configuração)." if r.get("ja_existia")
          else f"Configuração enviada (versão {r.get('versao')}).")
    marca_nuvem = json.loads(baixar(OBJ_MARCA) or b"null") or {}
    if marca_nuvem.get("ambiente") == "nuvem" and not forcar:
        print("\nA nuvem já está coletando sozinha: não mandei a pasta dados do PC para não apagar o que ela coletou.")
        print("(Se quiser mesmo substituir, rode: py ferramentas\\nuvem.py enviar --forcar)")
    else:
        marca = _ler_json(ARQ_MARCA, {}) or {}
        marca["seq"] = max(marca.get("seq", 0), marca_nuvem.get("seq", 0))
        ARQ_MARCA.write_text(json.dumps(marca), encoding="utf-8")
        guardar()
        n = len(list((DADOS / "partidas").glob("*.json*")))
        print(f"Pasta dados enviada ({n} partidas).")
    if os.name == "nt":
        print("\nAgora a coleta e o report rodam na nuvem. As tarefas do PC precisam ser desligadas para as duas não rodarem juntas.")
        if _perguntar("Desligar as tarefas do PC agora? (S/N) "):
            for t in TAREFAS_PC:
                r = subprocess.run(["schtasks", "/Change", "/TN", t, "/Disable"], capture_output=True)
                print(f"  {t}: {'desligada' if r.returncode == 0 else 'não encontrada (tudo bem)'}")
        else:
            print("Tudo bem: enquanto a nuvem estiver ativa, a coleta do PC percebe e não roda.")
    print("\nPronto! Volte para o site: Painel > Sync mostra quando a nuvem rodar.")


def trazer_para_o_pc():
    pacote = baixar(OBJ_ESTADO)
    if not pacote:
        raise FaltaNaNuvem("não há pasta dados na nuvem")
    if nuvem_ativa():
        print("Atenção: a nuvem continua coletando. Para o PC voltar a coletar, desligue antes a variável VALREPORT_NUVEM no GitHub.\n")
    if not _perguntar("Isso troca a pasta dados do PC pela da nuvem (a atual ganha uma cópia antes). Continuar? (S/N) "):
        return
    if DADOS.exists():
        copia = shutil.make_archive(str(PASTA / f"dados_antes_da_nuvem_{_agora():%Y%m%d-%H%M}"), "zip", DADOS)
        print(f"Cópia da pasta dados atual: {Path(copia).name}")
    desempacotar(pacote)
    c = rpc("pc_config_ler", {"p_slug": _supabase()[2]})
    if c and c.get("config"):
        ARQ_CONFIG.write_text(json.dumps(c["config"], ensure_ascii=False, indent=2), encoding="utf-8")
    print("Pasta dados e configuração trazidas da nuvem.")


def main(args):
    cmd = args[0] if args else ""
    cache = next((args[i + 1] for i, a in enumerate(args) if a == "--cache" and i + 1 < len(args)), None)
    try:
        if cmd == "preparar":
            preparar(cache)
        elif cmd == "coletar":
            return coletar(report="--report" in args)
        elif cmd == "guardar":
            guardar(cache)
        elif cmd == "manter":
            manter()
        elif cmd == "diagnostico":
            diagnostico()
        elif cmd == "enviar":
            enviar_do_pc(forcar="--forcar" in args)
        elif cmd == "trazer":
            trazer_para_o_pc()
        else:
            print(__doc__)
            return 2
    except FaltaNaNuvem as e:
        print(f"Falta configurar: {e}.")
        return 3
    except urllib.error.HTTPError as e:
        print(f"O Supabase recusou o pedido (HTTP {e.code}). Confira se o supabase\\nuvem.sql foi aplicado e se a chave secreta está certa.")
        return 4
    except (urllib.error.URLError, OSError) as e:
        print(f"Sem conexão com o Supabase ({type(e).__name__}).")
        return 5
    except RuntimeError as e:
        print(f"Não deu: {e}.")
        return 6
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
