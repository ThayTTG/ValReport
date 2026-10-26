#!/usr/bin/env python3
"""
Armazenamento das partidas — NokyLabs

- Partidas novas são salvas compactadas (.json.gz, ~10x menores). As antigas (.json) continuam funcionando.
- Um índice (dados/indice_partidas.json) guarda a data de cada partida, para buscar só as da janela
  sem precisar abrir todos os arquivos.
- O modelo de probabilidade de vitória é guardado (dados/modelo_vitoria.json) e só aprende com as
  partidas novas a cada execução, então o tempo de execução não cresce com o histórico.
"""

import gzip
import json
import os
from pathlib import Path

import avaliacao as av

PASTA = Path(__file__).resolve().parent.parent  # pasta principal do projeto (o código fica em ferramentas/)
DADOS = PASTA / "dados"
PASTA_PARTIDAS = DADOS / "partidas"
ARQ_INDICE = DADOS / "indice_partidas.json"
ARQ_MODELO = DADOS / "modelo_vitoria.json"
VERSAO_MODELO = 2


def _salvar_json(caminho, dados, compactar=False):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    temp = caminho.with_name(caminho.name + ".tmp")
    if compactar:
        with gzip.open(temp, "wt", encoding="utf-8") as f:
            json.dump(dados, f, ensure_ascii=False)
    else:
        with open(temp, "w", encoding="utf-8") as f:
            json.dump(dados, f, ensure_ascii=False, indent=2)
    os.replace(temp, caminho)


def _ler_json(caminho, padrao=None):
    try:
        if caminho.suffix == ".gz":
            with gzip.open(caminho, "rt", encoding="utf-8") as f:
                return json.load(f)
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return padrao


def caminho_partida(mid):
    gz = PASTA_PARTIDAS / f"{mid}.json.gz"
    if gz.exists():
        return gz
    js = PASTA_PARTIDAS / f"{mid}.json"
    return js if js.exists() else None


def partida_existe(mid):
    return caminho_partida(mid) is not None


def ler_partida(mid):
    c = caminho_partida(mid)
    return _ler_json(c) if c else None


def salvar_partida(partida):
    mid = av.g(partida, "metadata", "match_id")
    _salvar_json(PASTA_PARTIDAS / f"{mid}.json.gz", partida, compactar=True)
    antigo = PASTA_PARTIDAS / f"{mid}.json"
    if antigo.exists():
        antigo.unlink()
    idx = indice()
    idx[mid] = av.g(partida, "metadata", "started_at")
    _salvar_json(ARQ_INDICE, idx)


def indice():
    """{match_id: started_at}. Completa sozinho com partidas que ainda não estavam no índice."""
    idx = _ler_json(ARQ_INDICE, {}) or {}
    mudou = False
    if PASTA_PARTIDAS.exists():
        for arq in PASTA_PARTIDAS.iterdir():
            nome = arq.name
            if not (nome.endswith(".json") or nome.endswith(".json.gz")):
                continue
            mid = nome.split(".json")[0]
            if mid not in idx:
                p = _ler_json(arq)
                if p:
                    idx[mid] = av.g(p, "metadata", "started_at")
                    mudou = True
    if mudou:
        _salvar_json(ARQ_INDICE, idx)
    return idx


def partidas_no_periodo(inicio_dt, fim_dt):
    """IDs das partidas que começaram entre inicio_dt e fim_dt (datetimes com fuso)."""
    out = []
    for mid, iso in indice().items():
        dt = av.hora_br(iso)
        if dt and inicio_dt <= dt <= fim_dt:
            out.append((dt, mid))
    return [mid for _, mid in sorted(out)]


def carregar_modelo(cfg):
    """Modelo de vitória já treinado com tudo o que foi guardado, aprendendo só com as partidas novas."""
    salvo = _ler_json(ARQ_MODELO, {}) or {}
    if salvo.get("versao") != VERSAO_MODELO:
        salvo = {}  # versão antiga (podia incluir partidas fora do 5v5): reaprende do zero
    modelo = av.ModeloVitoria(cfg)
    for chave, (v, n) in (salvo.get("contagem") or {}).items():
        a, d, p = chave.split(",")
        modelo.contagem[(int(a), int(d), p == "1")] = [v, n]
    modelo.rounds_usados = salvo.get("rounds_usados", 0)
    vistas = set(salvo.get("partidas") or [])

    novas = [mid for mid in indice() if mid not in vistas]
    if novas:
        modelo.ajustar(p for p in (ler_partida(mid) for mid in novas) if p)
        vistas.update(novas)
        _salvar_json(ARQ_MODELO, {
            "versao": VERSAO_MODELO,
            "rounds_usados": modelo.rounds_usados,
            "partidas": sorted(vistas),
            "contagem": {f"{a},{d},{1 if p else 0}": c for (a, d, p), c in modelo.contagem.items()},
        })
    return modelo
