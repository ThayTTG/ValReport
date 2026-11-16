"""ValReport · partidas fora das estatísticas (v25)

A liderança pode tirar uma partida das contas de um jogador pelo site (outra pessoa jogou na conta, jogou passando
mal...). A coleta lê essa lista no banco e, logo depois de analisar cada partida, tira o jogador dela: a partida
deixa de contar para ele em tudo (K/D, Índice NokyLabs, atributos, recordes, mapa de calor, formações e report).
Ela continua valendo para os outros jogadores da partida.

  - Lida uma vez por execução (pc_partidas_excluidas, com a chave secreta).
  - Se o banco não responder, usa a última lista salva em dados/exclusoes.json.
  - Sem a chave secreta (ou sem o supabase/planejamento.sql rodado), nada é excluído.
"""
import json
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

import elenco_site

PASTA = Path(__file__).resolve().parent.parent
ARQ_CACHE = PASTA / "dados" / "exclusoes.json"

_memoria = {}   # uma busca por execução


def _ler_cache(equipe):
    try:
        c = json.loads(ARQ_CACHE.read_text(encoding="utf-8"))
        return c.get("lista") if c.get("equipe") == equipe else None
    except (OSError, ValueError):
        return None


def buscar(cfg):
    """{(match_id, slug)} das partidas fora das contas de cada jogador."""
    url, chave, equipe = elenco_site._supabase(cfg or {})
    if equipe in _memoria:
        return _memoria[equipe]
    lista = None
    if chave:
        try:
            r = elenco_site._pedido("POST", f"{url}/rest/v1/rpc/pc_partidas_excluidas", chave, {"p_slug": equipe})
            if isinstance(r, list):
                lista = [x for x in r if isinstance(x, dict) and x.get("partida") and x.get("slug")]
                try:
                    ARQ_CACHE.parent.mkdir(parents=True, exist_ok=True)
                    ARQ_CACHE.write_text(json.dumps({"equipe": equipe, "lista": lista,
                                                     "lido_em": datetime.now(timezone.utc).isoformat(timespec="seconds")},
                                                    ensure_ascii=False, indent=1), encoding="utf-8")
                except OSError:
                    pass
        except urllib.error.HTTPError as e:
            # 404 = o planejamento.sql ainda não rodou no banco: segue sem exclusões
            if e.code != 404:
                print(f"Partidas excluídas: não consegui ler agora (erro {e.code}); usando a última lista salva.")
        except (urllib.error.URLError, OSError, ValueError) as e:
            print(f"Partidas excluídas: não consegui ler agora ({e}); usando a última lista salva.")
    if lista is None:
        lista = _ler_cache(equipe) or []
    res = {(x["partida"], x["slug"]) for x in lista}
    _memoria[equipe] = res
    return res


def aplicar(analise, excluidos_pu):
    """Tira da análise os jogadores excluídos desta partida. excluidos_pu = {puuid}. Devolve quantos saíram.
    Eles ficam guardados em analise["excluidos"] (o placar da partida continua mostrando todo mundo)."""
    if not excluidos_pu:
        return 0
    n = 0
    for pu in list(excluidos_pu):
        j = analise["jogadores"].pop(pu, None)
        if j is not None:
            analise.setdefault("excluidos", {})[pu] = j
            n += 1
    return n
