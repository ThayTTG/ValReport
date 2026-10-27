#!/usr/bin/env python3
"""
Coletor diário de partidas de VALORANT (HenrikDev API) — NokyLabs

O que ele faz:
  1. Lê a lista de jogadores do config.json
  2. Busca as partidas novas de cada um (desde a última execução)
  3. Guarda só as filas que importam (Competitivo, Premier e Personalizada, por padrão)
  4. Salva tudo em dados/ :
       - dados/partidas/<match_id>.json.gz -> partida completa, compactada (base de todas as análises)
       - dados/resumos/AAAA-MM-DD.json     -> lista do dia (o gerador de reports lê este)
       - dados/historico.csv               -> uma linha por partida, para ver evolução no Excel
       - dados/estado.json                 -> controle interno (o que já foi lido)
       - dados/coletor.log                 -> registro de execuções e erros
  5. Chama o gerar_report.py para escrever os reports .md

Coleta rápida (py coletor_valorant.py --rapido, a cada 20 min pelo Agendador):
  só procura partidas novas; se achar, guarda, atualiza o site e publica (se "publicar_automatico").
  Não gera report nem manda nada ao Discord: o que ela achar entra no próximo report das 21h
  (fica guardado em dados/pendentes.json até lá).

A chave da API é lida da variável de ambiente HENRIKDEV_API_KEY (nunca fica no código).
Só usa a biblioteca padrão do Python, então não precisa instalar nada.
"""

import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import armazem
import avaliacao as av

PASTA = Path(__file__).resolve().parent.parent  # pasta principal do projeto (o código fica em ferramentas/)
ARQ_CONFIG = PASTA / "config.json"
DADOS = PASTA / "dados"
PASTA_RESUMOS = DADOS / "resumos"
ARQ_ESTADO = DADOS / "estado.json"
ARQ_HISTORICO = DADOS / "historico.csv"
ARQ_LOG = DADOS / "coletor.log"
ARQ_PENDENTES = DADOS / "pendentes.json"
ARQ_TRAVA = DADOS / "coleta.trava"

URL_PARTIDAS = "https://api.henrikdev.xyz/valorant/v4/matches/{regiao}/{plataforma}/{nome}/{tag}"
URL_PARTIDAS_PUUID = "https://api.henrikdev.xyz/valorant/v4/by-puuid/matches/{regiao}/{plataforma}/{puuid}"
URL_ELO_PUUID = "https://api.henrikdev.xyz/valorant/v2/by-puuid/mmr-history/{regiao}/{plataforma}/{puuid}"
URL_ELO_V2 = "https://api.henrikdev.xyz/valorant/v2/mmr-history/{regiao}/{plataforma}/{nome}/{tag}"
URL_ELO_V1 = "https://api.henrikdev.xyz/valorant/v1/mmr-history/{regiao}/{nome}/{tag}"
VERSAO_ESTADO = 3
g = av.g


# ----------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------

def agora_br():
    return datetime.now(av.FUSO_BR)


_BUFFER_LOG = None  # na coleta rápida, o log só vai para o arquivo se houver novidade ou erro


def log(msg):
    linha = f"[{agora_br():%Y-%m-%d %H:%M:%S}] {msg}"
    print(linha)
    if _BUFFER_LOG is not None:
        _BUFFER_LOG.append(linha)
        return
    DADOS.mkdir(parents=True, exist_ok=True)
    with open(ARQ_LOG, "a", encoding="utf-8") as f:
        f.write(linha + "\n")


def travar(esperar_s):
    """Evita duas coletas ao mesmo tempo (ex.: a rápida das 21h00 e a do report). Trava velha (>40 min) é ignorada."""
    DADOS.mkdir(parents=True, exist_ok=True)
    limite = time.time() + esperar_s
    while True:
        try:
            fd = os.open(ARQ_TRAVA, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except FileExistsError:
            try:
                if time.time() - ARQ_TRAVA.stat().st_mtime > 40 * 60:
                    ARQ_TRAVA.unlink()
                    continue
            except FileNotFoundError:
                continue
            if time.time() >= limite:
                return False
            time.sleep(5)


def destravar():
    try:
        ARQ_TRAVA.unlink()
    except FileNotFoundError:
        pass


def ler_json(caminho, padrao):
    try:
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return padrao


def salvar_json(caminho, dados):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    temp = caminho.with_suffix(caminho.suffix + ".tmp")
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2, default=str)
    os.replace(temp, caminho)


def fila_incluida(partida, incluidas):
    """Compara pelo id E pelo nome da fila. 'custom' cobre Custom Game / Personalizada."""
    qid = (g(partida, "metadata", "queue", "id") or "").lower()
    nome = (g(partida, "metadata", "queue", "name") or "").lower()
    if qid in incluidas or nome in incluidas:
        return True
    if "custom" in incluidas and ("custom" in qid or "custom" in nome or "personaliz" in nome):
        return True
    return False


# ----------------------------------------------------------------------------
# Acesso à API
# ----------------------------------------------------------------------------

def buscar_pagina(chave, regiao, plataforma, nome, tag, start, size=10):
    pu = av.PUUIDS.get(f"{nome}#{tag}".lower())   # quem está no site é buscado pelo puuid (troca de nick não atrapalha)
    if pu:
        url = URL_PARTIDAS_PUUID.format(regiao=regiao, plataforma=plataforma, puuid=urllib.parse.quote(pu, safe=""))
    else:
        url = URL_PARTIDAS.format(
            regiao=regiao,
            plataforma=plataforma,
            nome=urllib.parse.quote(nome, safe=""),
            tag=urllib.parse.quote(tag, safe=""),
        )
    url += "?" + urllib.parse.urlencode({"size": size, "start": start})

    req = urllib.request.Request(url, headers={
        "Authorization": chave,
        "Accept": "application/json",
        "User-Agent": "NokyLabs-ValorantReport/2.0",
    })

    for tentativa in range(1, 4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                corpo = json.loads(resp.read().decode("utf-8"))
                return corpo.get("data") or []
        except urllib.error.HTTPError as e:
            if e.code == 429:
                espera = int(e.headers.get("Retry-After") or 60)
                log(f"  Limite de requisições atingido, esperando {espera}s...")
                time.sleep(espera)
            elif e.code >= 500 and tentativa < 3:
                log(f"  Erro {e.code} no servidor, tentando de novo em 15s...")
                time.sleep(15)
            elif e.code in (401, 403):
                raise RuntimeError("Chave da API recusada (verifique a variável HENRIKDEV_API_KEY).")
            elif e.code == 404:
                raise RuntimeError("Conta não encontrada (confira nome, tag e região).")
            else:
                raise RuntimeError(f"Erro HTTP {e.code} ao buscar partidas.")
        except urllib.error.URLError as e:
            if tentativa < 3:
                log(f"  Sem conexão ({e.reason}), tentando de novo em 15s...")
                time.sleep(15)
            else:
                raise RuntimeError(f"Sem conexão com a API: {e.reason}")
    raise RuntimeError("Não foi possível buscar as partidas após 3 tentativas.")


# ----------------------------------------------------------------------------
# Histórico de elo (RR)
# ----------------------------------------------------------------------------

def _get_json(url, chave):
    req = urllib.request.Request(url, headers={"Authorization": chave, "Accept": "application/json",
                                               "User-Agent": "NokyLabs-ValorantReport/2.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def normalizar_elo(e):
    """Uma entrada do histórico de elo, venha da v2 (tier{id,name}, rr, last_change, date) ou da v1
    (currenttier, ranking_in_tier, mmr_change_to_last_game, date_raw)."""
    tier = g(e, "tier", "id") if isinstance(e.get("tier"), dict) else e.get("currenttier")
    tn = g(e, "tier", "name") if isinstance(e.get("tier"), dict) else e.get("currenttierpatched")
    data = e.get("date")
    if e.get("date_raw") and (not data or not str(data)[:4].isdigit()):
        data = datetime.fromtimestamp(int(e["date_raw"]), timezone.utc).isoformat()
    rr = e.get("rr", e.get("ranking_in_tier"))
    delta = e.get("last_change", e.get("mmr_change_to_last_game"))
    if not e.get("match_id") or tier is None or rr is None:
        return None
    return {"match_id": e["match_id"], "t": data, "tier": tier, "tn": tn, "rr": rr, "delta": delta,
            "elo": e.get("elo"), "mapa": g(e, "map", "name") if isinstance(e.get("map"), dict) else e.get("map")}


def coletar_elo(chave, cfg, riot_id):
    """Guarda em dados/elo/ as últimas mudanças de RR do jogador (a API devolve ~20 partidas)."""
    nome, _, tag = riot_id.partition("#")
    q = dict(regiao=cfg.get("regiao", "br"), plataforma=cfg.get("plataforma", "pc"),
             nome=urllib.parse.quote(nome, safe=""), tag=urllib.parse.quote(tag, safe=""))
    entradas = None
    pu = av.PUUIDS.get(riot_id.lower())
    urls = ([URL_ELO_PUUID.format(regiao=q["regiao"], plataforma=q["plataforma"], puuid=urllib.parse.quote(pu, safe=""))] if pu else []) \
        + [URL_ELO_V2.format(**q), URL_ELO_V1.format(**q)]
    for url in urls:
        try:
            corpo = _get_json(url, chave)
            dados = corpo.get("data")
            entradas = dados.get("history") if isinstance(dados, dict) else dados
            if entradas is not None:
                break
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(int(e.headers.get("Retry-After") or 60))
            continue
        except Exception:  # noqa: BLE001
            continue
    if not entradas:
        return 0
    arq = PASTA / "dados" / "elo" / f"{gerar_nome(riot_id)}.json"
    atual = {x["match_id"]: x for x in ler_json(arq, [])}
    novos = 0
    for e in entradas:
        x = normalizar_elo(e or {})
        if x:
            novos += x["match_id"] not in atual
            atual[x["match_id"]] = x
    salvar_json(arq, sorted(atual.values(), key=lambda x: x["t"] or ""))
    return novos


def gerar_nome(riot_id):
    import re
    import unicodedata
    t = unicodedata.normalize("NFKD", riot_id).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9_-]+", "", t.replace(" ", "-").replace("#", "_")) or "jogador"


# ----------------------------------------------------------------------------
# Histórico CSV
# ----------------------------------------------------------------------------

CAMPOS_CSV = ["data", "jogador", "match_id", "mapa", "fila", "agente", "funcao", "resultado", "placar",
              "rounds", "rounds_afk", "kills", "mortes", "assistencias", "kd", "acs", "adr", "hs_pct",
              "kast_pct", "first_kills", "first_deaths", "trades_feitos", "loadout_medio", "arma_principal"]


def anexar_historico(jogador, r):
    novo = not ARQ_HISTORICO.exists()
    with open(ARQ_HISTORICO, "a", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS_CSV, delimiter=";")
        if novo:
            w.writeheader()
        linha = {c: r.get(c) for c in CAMPOS_CSV}
        dt = av.hora_br(r.get("inicio"))
        linha["data"] = f"{dt:%Y-%m-%d}" if dt else ""
        linha["jogador"] = jogador
        linha["arma_principal"] = next(iter(r.get("armas_kills") or {}), "")
        w.writerow(linha)


# ----------------------------------------------------------------------------
# Migração da versão anterior
# ----------------------------------------------------------------------------

def refazer_historico(cfg):
    if ARQ_HISTORICO.exists():
        backup = DADOS / "historico_backup.csv"
        if backup.exists():
            backup.unlink()
        ARQ_HISTORICO.rename(backup)
    idx = armazem.indice()
    for mid in sorted(idx, key=lambda m: idx[m] or ""):
        p = armazem.ler_partida(mid)
        if not p or not av.partida_valida(p):
            continue
        a = av.analisar_partida_completa(p, None, cfg)
        for rid in cfg.get("jogadores", []):
            j = av.localizar(a, rid)
            if j and j["rounds"]:
                anexar_historico(rid, av.resumo_basico(a, j))


def migrar(estado, cfg):
    """Versão 1 -> 2: compacta as partidas, refaz o histórico com as correções e libera para nova
    leitura as partidas que tinham sido ignoradas (ex.: as personalizadas, que não entravam por engano).
    Versão 2 -> 3: tira do histórico as personalizadas fora do 5v5 padrão (Skirmish, Swift Play, DM)."""
    versao = estado.get("versao", 1)
    if versao >= VERSAO_ESTADO:
        return estado
    if versao >= 2:
        refazer_historico(cfg)
        log("Histórico refeito só com partidas 5v5 no modo padrão (o anterior ficou em historico_backup.csv).")
        estado["versao"] = VERSAO_ESTADO
        return estado
    log("Atualizando os dados para a versão 3 (só acontece uma vez)...")

    pasta = armazem.PASTA_PARTIDAS
    antigos = list(pasta.glob("*.json")) if pasta.exists() else []
    for arq in antigos:
        p = ler_json(arq, None)
        if p:
            armazem.salvar_partida(p)
    log(f"  {len(antigos)} partida(s) compactada(s).")

    estado["lidas"] = {rid: [m for m in mids if armazem.partida_existe(m)]
                       for rid, mids in (estado.get("lidas") or {}).items()}

    refazer_historico(cfg)
    log("  historico.csv refeito com as correções (o antigo ficou em historico_backup.csv).")

    estado["versao"] = VERSAO_ESTADO
    return estado


# ----------------------------------------------------------------------------
# Execução principal
# ----------------------------------------------------------------------------

def coletar_jogador(chave, cfg, riot_id, ja_lidas, ja_ignoradas, incluidas, primeira_vez):
    nome, _, tag = riot_id.partition("#")
    novas = []
    max_pag = 1 if primeira_vez else cfg.get("max_paginas_por_jogador", 3)

    for pagina in range(max_pag):
        dados = buscar_pagina(chave, cfg["regiao"], cfg["plataforma"], nome, tag, start=pagina * 10)
        if not dados:
            break
        achou_conhecida = False
        for partida in dados:
            mid = g(partida, "metadata", "match_id")
            if not mid:
                continue
            # Já lida, ou ignorada e a fila continua fora do config -> conhecida
            if mid in ja_lidas or (mid in ja_ignoradas and not fila_incluida(partida, incluidas)):
                achou_conhecida = True
                continue
            novas.append(partida)
        if achou_conhecida or len(dados) < 10:
            break
        time.sleep(2)  # gentileza com o limite da API
    return novas


def processar_jogador(chave, cfg, estado, riot_id, incluidas):
    """Busca, filtra e guarda as partidas novas de um jogador. Atualiza estado["lidas"/"ignoradas"]."""
    lidas = list(estado["lidas"].get(riot_id, []))
    ignoradas = list(estado["ignoradas"].get(riot_id, []))
    bloco = {"status": "ok", "partidas": [], "ignoradas": 0, "filas_ignoradas": {}}
    try:
        novas = coletar_jogador(chave, cfg, riot_id, set(lidas), set(ignoradas), incluidas,
                                primeira_vez=not lidas and not ignoradas)
        for partida in sorted(novas, key=lambda p: g(p, "metadata", "started_at") or ""):
            mid = g(partida, "metadata", "match_id")
            qid = g(partida, "metadata", "queue", "id") or "sem id"
            nome_fila = g(partida, "metadata", "queue", "name") or qid

            motivo = None
            if not fila_incluida(partida, incluidas):
                motivo = f"{nome_fila} [{qid}]"
            elif not partida.get("rounds"):
                motivo = f"{nome_fila} [{qid}, sem dados de rounds]"
            elif not av.partida_valida(partida):
                motivo = f"{nome_fila} [{av.motivo_invalida(partida)}]"
            if motivo:
                bloco["ignoradas"] += 1
                bloco["filas_ignoradas"][motivo] = bloco["filas_ignoradas"].get(motivo, 0) + 1
                if mid not in ignoradas:
                    ignoradas.append(mid)
                continue

            armazem.salvar_partida(partida)
            lidas.append(mid)
            if mid in ignoradas:
                ignoradas.remove(mid)

            a = av.analisar_partida_completa(partida, None, cfg)
            j = av.localizar(a, riot_id)
            if j and j["rounds"]:
                r = av.resumo_basico(a, j)
                bloco["partidas"].append(r)
                anexar_historico(riot_id, r)

        ign = ", ".join(f"{n} ({q})" for n, q in bloco["filas_ignoradas"].items())
        log(f"  {len(bloco['partidas'])} partida(s) nova(s) analisada(s), {bloco['ignoradas']} ignorada(s)"
            + (f": {ign}" if ign else "") + ".")
        # Guarda só os últimos IDs para o arquivo não crescer sem fim
        estado["lidas"][riot_id] = lidas[-1000:]
        estado["ignoradas"][riot_id] = ignoradas[-1000:]
    except Exception as e:  # noqa: BLE001 — queremos registrar qualquer falha e seguir
        bloco["status"] = "erro"
        bloco["erro"] = str(e)
        log(f"  ERRO: {e}")

    return bloco


def main():
    log("=" * 60)
    log("Iniciando coleta")

    chave = os.environ.get("HENRIKDEV_API_KEY", "").strip()
    if not chave:
        log("ERRO: variável de ambiente HENRIKDEV_API_KEY não encontrada.")
        sys.exit(1)

    cfg = ler_json(ARQ_CONFIG, None)
    if not cfg:
        log("ERRO: config.json não encontrado ao lado do script.")
        sys.exit(1)
    incluidas = [f.lower() for f in cfg.get("filas_incluidas", ["competitive", "premier", "custom"])]
    cfg = com_elenco_do_site(cfg)

    if not travar(esperar_s=10 * 60):
        log("Outra coleta ficou travada por muito tempo; seguindo mesmo assim.")
    try:
        _main_travado(chave, cfg, incluidas)
    finally:
        destravar()


def com_elenco_do_site(cfg):
    """Junta os membros da equipe no site (etapa 3b) com a lista do config.json."""
    try:
        import elenco_site
        return elenco_site.aplicar(cfg)
    except Exception as e:  # noqa: BLE001 — a coleta nunca para por causa do site
        log(f"Elenco do site não aplicado ({e}); usando só o config.json.")
        return cfg


def juntar_pendentes(resumo):
    """Partidas que a coleta rápida achou desde o último report entram neste report."""
    pend = ler_json(ARQ_PENDENTES, None)
    if not pend:
        return 0
    total = 0
    for riot_id, velho in (pend.get("jogadores") or {}).items():
        novo = resumo["jogadores"].setdefault(riot_id, {"status": "ok", "partidas": [], "ignoradas": 0, "filas_ignoradas": {}})
        ids = {p["match_id"] for p in novo["partidas"]}
        extra = [p for p in velho.get("partidas", []) if p["match_id"] not in ids]
        novo["partidas"] = extra + novo["partidas"]
        total += len(extra)
        novo["ignoradas"] += velho.get("ignoradas", 0)
        for k, v in (velho.get("filas_ignoradas") or {}).items():
            novo["filas_ignoradas"][k] = novo["filas_ignoradas"].get(k, 0) + v
    return total


def _main_travado(chave, cfg, incluidas):
    estado = ler_json(ARQ_ESTADO, {"ultima_execucao": None, "lidas": {}})
    estado.setdefault("lidas", {})
    estado.setdefault("ignoradas", {})
    estado = migrar(estado, cfg)
    hoje = agora_br().date()

    dias_sem_leitura = 0
    if estado.get("ultima_execucao"):
        anterior = datetime.fromisoformat(estado["ultima_execucao"]).date()
        dias_sem_leitura = max((hoje - anterior).days - 1, 0)

    resumo = {
        "gerado_em": agora_br().isoformat(timespec="seconds"),
        "data_do_report": hoje.isoformat(),
        "ultima_leitura_anterior": estado.get("ultima_execucao"),
        "dias_sem_leitura_antes_deste": dias_sem_leitura,
        "carga_inicial": not estado.get("ultima_execucao"),
        "jogadores": {},
    }

    for riot_id in cfg.get("jogadores", []):
        log(f"Buscando partidas de {riot_id}...")
        bloco = processar_jogador(chave, cfg, estado, riot_id, incluidas)
        resumo["jogadores"][riot_id] = bloco
        time.sleep(2)

    # Histórico de elo (para o gráfico do site). Nunca derruba a coleta.
    if cfg.get("coletar_elo", True):
        for riot_id in cfg.get("jogadores", []):
            try:
                n = coletar_elo(chave, cfg, riot_id)
                log(f"Elo de {riot_id}: {n} mudança(s) nova(s) de RR.")
            except Exception as e:  # noqa: BLE001
                log(f"  Elo de {riot_id} não lido ({e}).")
            time.sleep(2)

    n_pend = juntar_pendentes(resumo)
    if n_pend:
        log(f"{n_pend} partida(s) achada(s) pela coleta rápida entram neste report.")

    # Se já houve uma execução hoje (ex.: manual às 15h e agendada às 21h), soma em vez de substituir
    arq_resumo = PASTA_RESUMOS / f"{hoje.isoformat()}.json"
    anterior = ler_json(arq_resumo, None)
    if anterior and anterior.get("data_do_report") == hoje.isoformat():
        for chave in ("ultima_leitura_anterior", "dias_sem_leitura_antes_deste", "carga_inicial"):
            resumo[chave] = anterior.get(chave, resumo[chave])
        for riot_id, velho in (anterior.get("jogadores") or {}).items():
            novo = resumo["jogadores"].setdefault(riot_id, {"status": "ok", "partidas": [], "ignoradas": 0,
                                                            "filas_ignoradas": {}})
            ids_novos = {p["match_id"] for p in novo["partidas"]}
            novo["partidas"] = [p for p in velho.get("partidas", []) if p["match_id"] not in ids_novos] + novo["partidas"]
            novo["ignoradas"] += velho.get("ignoradas", 0)
            for k, v in (velho.get("filas_ignoradas") or {}).items():
                novo["filas_ignoradas"][k] = novo["filas_ignoradas"].get(k, 0) + v
    salvar_json(arq_resumo, resumo)
    estado["ultima_execucao"] = hoje.isoformat()
    salvar_json(ARQ_ESTADO, estado)
    if ARQ_PENDENTES.exists():
        ARQ_PENDENTES.unlink()
    log(f"Resumo salvo em dados/resumos/{hoje.isoformat()}.json")

    try:  # elenco das equipes Premier do site, uma vez por dia (quem saiu do elenco no jogo vira convidado)
        import elenco_site
        n = elenco_site.sincronizar_premier(os.environ.get("HENRIKDEV_API_KEY", "").strip(), cfg)
        if n:
            log(f"Elenco Premier conferido em {n} equipe(s).")
    except Exception as e:  # noqa: BLE001
        log(f"Elenco Premier não conferido ({e}).")

    try:
        import gerar_report
        destino = gerar_report.gerar(hoje.isoformat(), cfg)
        if destino:
            log(f"Reports .md salvos em {destino.relative_to(PASTA)}")
    except Exception as e:  # noqa: BLE001
        import traceback
        log(f"ERRO ao gerar o report .md: {e}")
        log(traceback.format_exc())


# ----------------------------------------------------------------------------
# Coleta rápida (a cada 20 min): só partidas novas -> site
# ----------------------------------------------------------------------------

def rapido():
    global _BUFFER_LOG
    _BUFFER_LOG = []
    houve_algo = False
    try:
        chave = os.environ.get("HENRIKDEV_API_KEY", "").strip()
        cfg = ler_json(ARQ_CONFIG, None)
        if not chave or not cfg:
            log("Coleta rápida: falta a HENRIKDEV_API_KEY ou o config.json.")
            houve_algo = True
            return
        if cfg.get("coleta_rapida", True) is False:
            print("Coleta rápida desligada no config.json (\"coleta_rapida\": false).")
            return
        if not travar(esperar_s=0):
            print("Outra coleta está rodando agora; fica para a próxima.")
            return
        cfg = com_elenco_do_site(cfg)
        try:
            houve_algo = _rapido_travado(chave, cfg)
        finally:
            destravar()
    except Exception as e:  # noqa: BLE001
        import traceback
        log(f"Coleta rápida: ERRO {e}")
        log(traceback.format_exc())
        houve_algo = True
    finally:
        buffer, _BUFFER_LOG = _BUFFER_LOG, None
        if houve_algo and buffer:
            DADOS.mkdir(parents=True, exist_ok=True)
            with open(ARQ_LOG, "a", encoding="utf-8") as f:
                f.write("\n".join(buffer) + "\n")
        salvar_json(DADOS / "ultima_coleta_rapida.json", {"em": agora_br().isoformat(timespec="seconds"), "novidade": houve_algo})


def _rapido_travado(chave, cfg):
    estado = ler_json(ARQ_ESTADO, None)
    if not estado or estado.get("versao", 1) < VERSAO_ESTADO or not estado.get("ultima_execucao"):
        print("A primeira coleta (e qualquer atualização de dados) fica com o report completo das 21h.")
        return False
    estado.setdefault("lidas", {})
    estado.setdefault("ignoradas", {})
    incluidas = [f.lower() for f in cfg.get("filas_incluidas", ["competitive", "premier", "custom"])]
    log("Coleta rápida: procurando partidas novas...")
    pend = ler_json(ARQ_PENDENTES, {"jogadores": {}})
    novas_total, erros, com_novas = 0, 0, []
    for riot_id in cfg.get("jogadores", []):
        bloco = processar_jogador(chave, cfg, estado, riot_id, incluidas)
        if bloco["status"] != "ok":
            erros += 1
            continue
        if bloco["partidas"] or bloco["ignoradas"]:
            alvo = pend["jogadores"].setdefault(riot_id, {"partidas": [], "ignoradas": 0, "filas_ignoradas": {}})
            alvo["partidas"] += bloco["partidas"]
            alvo["ignoradas"] += bloco["ignoradas"]
            for k, v in bloco["filas_ignoradas"].items():
                alvo["filas_ignoradas"][k] = alvo["filas_ignoradas"].get(k, 0) + v
        if bloco["partidas"]:
            novas_total += len(bloco["partidas"])
            com_novas.append(riot_id)
        time.sleep(1)
    salvar_json(ARQ_ESTADO, estado)
    if pend["jogadores"]:
        salvar_json(ARQ_PENDENTES, pend)
    if not novas_total:
        print("Nenhuma partida nova. Até daqui a pouco!")
        return erros > 0
    if cfg.get("coletar_elo", True):
        for riot_id in com_novas:
            try:
                coletar_elo(chave, cfg, riot_id)
            except Exception as e:  # noqa: BLE001
                log(f"  Elo de {riot_id} não lido ({e}).")
            time.sleep(1)
    import exportar_site
    site = cfg.get("site") or {}
    if site.get("ativo", True) is not False and not exportar_site.exportar_e_publicar(cfg):
        log("Site exportado, mas não enviado ao Supabase (veja a mensagem acima).")
    log(f"Coleta rápida: {novas_total} partida(s) nova(s); entram também no report das 21h.")
    return True


if __name__ == "__main__":
    if "--rapido" in sys.argv:
        rapido()
    else:
        main()
