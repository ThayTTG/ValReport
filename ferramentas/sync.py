"""Sync da administradora — NokyLabs

Roda no fim de cada coleta (a rápida, de 20 em 20 minutos, e a do report das 21h), sempre com a trava da coleta:
  1. Pega no Supabase os pedidos da página "Sync" do Painel (buscar de novo uma partida, o elo ou o card de alguém,
     sincronizar tudo, reenviar ao site) e atende, respeitando um limite de chamadas à HenrikDev por coleta.
  2. Se algo mudou, exporta e envia o site de novo.
  3. Marca cada pedido como feito, com erro ou "continua na próxima coleta", com um texto que aparece na página.
  4. Faz o diagnóstico (o que está faltando) e manda para o site junto com o "sinal de vida" do PC.

Nunca derruba a coleta: qualquer problema vira uma linha no log. Precisa da SUPABASE_SECRET_KEY (a mesma do envio
dos dados); sem ela, não faz nada. Só usa a biblioteca padrão do Python.
"""

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import armazem
import avaliacao as av

PASTA = Path(__file__).resolve().parent.parent
DADOS = PASTA / "dados"
ARQ_ESTADO = DADOS / "estado.json"
ARQ_PENDENTES = DADOS / "pendentes.json"
ARQ_LOG = DADOS / "coletor.log"
ARQ_CONTAS = DADOS / "cache" / "contas.json"            # card e nível de quem ainda não tem partida na janela
ARQ_TENTATIVAS = DADOS / "cache" / "sync_tentativas.json"  # o "sincronizar tudo" não repete a mesma coisa toda hora
VERSAO = "sync 1"
ORCAMENTO_API = 8           # chamadas à HenrikDev por coleta (a API tem limite por minuto)
TEMPO_MAXIMO_S = 6 * 60     # depois disso, o resto fica para a próxima coleta
REPETIR_TUDO_H = 6          # no "sincronizar tudo", o que já foi tentado há menos disso fica para depois
HENRIK_URL = os.environ.get("HENRIKDEV_URL", "https://api.henrikdev.xyz").rstrip("/")
RE_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
FILAS_10 = {"competitive", "premier"}
g = av.g


class SemOrcamento(Exception):
    """Acabaram as chamadas desta coleta: o pedido continua na próxima."""


class NaoEncontrado(Exception):
    pass


# ----------------------------------------------------------------------------
# Arquivos
# ----------------------------------------------------------------------------

def _ler(caminho, padrao):
    try:
        return json.loads(Path(caminho).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return padrao


def _salvar(caminho, dados):
    caminho = Path(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    temp = caminho.with_suffix(caminho.suffix + ".tmp")
    temp.write_text(json.dumps(dados, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    os.replace(temp, caminho)


def _quando(texto):
    """ISO (com ou sem fuso, com Z) -> datetime com fuso; None se não der."""
    if not texto:
        return None
    try:
        d = datetime.fromisoformat(str(texto).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=av.FUSO_BR)


def _agora():
    return datetime.now(av.FUSO_BR)


# ----------------------------------------------------------------------------
# O que falta numa partida
# ----------------------------------------------------------------------------

def problemas(p):
    """Lista de {"c": código, "t": texto} do que está faltando numa partida guardada (vazia = completa)."""
    if not p:
        return [{"c": "arquivo", "t": "a partida não está guardada no PC"}]
    out = []
    md = p.get("metadata") or {}
    fila = (g(md, "queue", "id") or "").lower()
    rounds = av.rounds_validos(p)
    kills = p.get("kills") or []
    players = p.get("players") or []
    if md.get("is_completed") is False:
        out.append({"c": "incompleta", "t": "a API marcou a partida como não terminada"})
    if not rounds:
        out.append({"c": "rounds", "t": "sem os rounds"})
        return out
    if not kills:
        out.append({"c": "abates", "t": "sem os abates"})
    else:
        sem_pos = sum(1 for k in kills if not k.get("location") or not k.get("player_locations"))
        if sem_pos / len(kills) > 0.10:
            out.append({"c": "posicoes", "t": f"{round(100 * sem_pos / len(kills))}% dos abates sem posição (mapa 2D e de calor)"})
    if fila in FILAS_10 and len(players) != 10:
        out.append({"c": "jogadores", "t": f"só {len(players)} de 10 jogadores"})
    if players and not any(isinstance(x.get("ability_casts"), dict) and any(v for v in x["ability_casts"].values() if v)
                           for x in players):
        out.append({"c": "habilidades", "t": "sem o uso de habilidades"})
    sem_eco = sum(1 for r in rounds if not any(g(s, "economy") for s in r.get("stats") or []))
    if sem_eco / len(rounds) > 0.20:
        out.append({"c": "economia", "t": f"{sem_eco} round(s) sem economia (carga e tipo de round)"})
    return out


def pontos(p):
    """Quão completa é a partida (para não trocar uma versão boa por uma pior)."""
    if not p:
        return -1
    kills = p.get("kills") or []
    return (len(av.rounds_validos(p)) * 10 + len(kills)
            + sum(1 for k in kills if k.get("location") and k.get("player_locations"))
            + sum(1 for x in p.get("players") or [] if isinstance(x.get("ability_casts"), dict))
            + sum(1 for r in p.get("rounds") or [] for s in r.get("stats") or [] if g(s, "economy")))


def _descrever(lista):
    return "; ".join(x["t"] for x in lista)


# ----------------------------------------------------------------------------
# Quem é quem
# ----------------------------------------------------------------------------

def _apelido(riot, cfg):
    for k, v in (cfg.get("apelidos") or {}).items():
        if k.lower() == riot.lower():
            return v
    return riot.split("#")[0]


def _puuids(cfg):
    """Riot ID (minúsculas) -> puuid, do elenco do site e do que o report já aprendeu."""
    out = dict(_ler(DADOS / "puuids_conhecidos.json", {}) or {})
    out.update(av.PUUIDS)
    return {k.lower(): v for k, v in out.items() if v}


def _jogadores_na_partida(p, cfg, pus):
    """Riot IDs da equipe (config + site) que jogaram a partida, com o tier de cada um."""
    achados = {}
    for x in p.get("players") or []:
        rid_partida = f"{x.get('name', '')}#{x.get('tag', '')}".lower()
        for riot in cfg.get("jogadores") or []:
            if riot.lower() == rid_partida or (pus.get(riot.lower()) and pus.get(riot.lower()) == x.get("puuid")):
                achados[riot] = g(x, "tier", "id") or 0
    return achados


# ----------------------------------------------------------------------------
# Diagnóstico
# ----------------------------------------------------------------------------

def _erros_recentes(dias=3, maximo=6):
    try:
        linhas = ARQ_LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-600:]
    except OSError:
        return []
    limite = _agora() - timedelta(days=dias)
    out = []
    for ln in linhas:
        m = re.match(r"^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\]\s+(.*)$", ln)
        if not m or not re.search(r"ERRO|não lido|recusou|sem conexão|Sem conexão|não enviado|não conferido|não aplicado", m.group(2)):
            continue
        quando = _quando(m.group(1).replace(" ", "T"))
        if quando and quando >= limite:
            out.append({"t": quando.isoformat(timespec="minutes"), "msg": m.group(2).strip()[:220]})
    return out[-maximo:]


def _ultimo_elo(riot):
    import coletor_valorant as col
    hist = _ler(DADOS / "elo" / f"{col.gerar_nome(riot)}.json", None)
    if not hist:
        return None
    return max((x.get("t") for x in hist if x.get("t")), default=None)


def diagnosticar(cfg, estado=None):
    estado = estado if estado is not None else _ler(ARQ_ESTADO, {}) or {}
    pus = _puuids(cfg)
    jogadores = cfg.get("jogadores") or []
    rapida = _ler(DADOS / "ultima_coleta_rapida.json", {}) or {}
    pend = _ler(ARQ_PENDENTES, {}) or {}

    partidas, ultima_comp = [], {}
    idx = armazem.indice()
    for mid, inicio in sorted(idx.items(), key=lambda x: x[1] or "", reverse=True):
        p = armazem.ler_partida(mid)
        if not p or not av.partida_valida(p):   # Deathmatch, Skirmish etc. não vão para o site
            continue
        quem = _jogadores_na_partida(p, cfg, pus)
        if (g(p, "metadata", "queue", "id") or "").lower() == "competitive":
            for riot, tier in quem.items():
                if tier and riot not in ultima_comp:
                    ultima_comp[riot] = g(p, "metadata", "started_at")
        probs = problemas(p)
        if probs and len(partidas) < 60:
            partidas.append({"id": mid, "inicio": g(p, "metadata", "started_at") or inicio,
                             "mapa": g(p, "metadata", "map", "name"), "fila": g(p, "metadata", "queue", "name"),
                             "quem": [_apelido(r, cfg) for r in quem], "problemas": probs})

    sem_dados = []
    for mid, info in sorted((estado.get("sem_dados") or {}).items(), key=lambda x: x[1].get("t") or "", reverse=True)[:30]:
        if armazem.partida_existe(mid):
            continue
        sem_dados.append({"id": mid, "inicio": info.get("t"), "mapa": info.get("mapa"), "fila": info.get("fila"),
                          "quem": [_apelido(info["jogador"], cfg)] if info.get("jogador") else [],
                          "problemas": [{"c": "rounds", "t": "a API mandou sem os rounds (ficou fora do site)"}]})

    elo = []
    if cfg.get("coletar_elo", True):
        for riot in jogadores:
            comp = ultima_comp.get(riot)
            if not comp:
                continue
            ult = _ultimo_elo(riot)
            dc, de = _quando(comp), _quando(ult)
            if de is None or (dc and dc - de > timedelta(minutes=30)):
                elo.append({"riot": riot, "apelido": _apelido(riot, cfg), "ultima_mudanca": ult, "ultima_competitiva": comp})

    cards = []
    meta = _ler(DADOS / "site" / "meta.json", {}) or {}
    try:
        import exportar_site
        slug_riot = {exportar_site.slug_de(r, cfg): r for r in jogadores}
    except Exception:  # noqa: BLE001
        slug_riot = {}
    for m in meta.get("equipe") or []:
        if not m.get("card") and slug_riot.get(m.get("slug")):
            cards.append({"riot": slug_riot[m["slug"]], "apelido": m.get("apelido"),
                          "motivo": "nenhuma partida guardada" if not m.get("partidas") else "a API não mandou o card"})

    reports = sorted((p.name for p in (DADOS / "reports").glob("20*") if p.is_dir()), reverse=True) if (DADOS / "reports").exists() else []
    return {
        "versao": VERSAO, "gerado_em": _agora().isoformat(timespec="seconds"),
        "coleta": {
            "rapida_em": rapida.get("em"), "rapida_novidade": rapida.get("novidade"),
            "rapida_ligada": cfg.get("coleta_rapida", True) is not False,
            "report_em": reports[0] if reports else estado.get("ultima_execucao"),
            "ultima_execucao": estado.get("ultima_execucao"),
            "chave_henrik": bool(os.environ.get("HENRIKDEV_API_KEY", "").strip()),
            "jogadores": len(jogadores), "partidas_guardadas": len(idx),
            "pendentes_report": sum(len(v.get("partidas") or []) for v in (pend.get("jogadores") or {}).values()),
            "site_gerado_em": meta.get("gerado_em"),
            "erros": _erros_recentes(),
        },
        "partidas": partidas, "sem_dados": sem_dados, "elo": elo, "cards": cards,
    }


# ----------------------------------------------------------------------------
# Atendimento
# ----------------------------------------------------------------------------

class Sessao:
    def __init__(self, chave_henrik, cfg, log=print):
        import elenco_site
        self.url, self.chave, self.slug = elenco_site._supabase(cfg)
        self._pedido = elenco_site._pedido
        self.henrik = (chave_henrik or "").strip()
        self.cfg = cfg
        self.log = log
        self.chamadas = 0
        self.inicio = time.monotonic()

    @property
    def ativo(self):
        return bool(self.chave)

    def rpc(self, nome, corpo):
        return self._pedido("POST", f"{self.url}/rest/v1/rpc/{nome}", self.chave, corpo, timeout=20)

    def sem_tempo(self):
        return time.monotonic() - self.inicio > TEMPO_MAXIMO_S

    def api(self, caminho):
        """GET na HenrikDev (dentro do orçamento desta coleta)."""
        if not self.henrik:
            raise RuntimeError("falta a HENRIKDEV_API_KEY no PC")
        if self.chamadas >= ORCAMENTO_API or self.sem_tempo():
            raise SemOrcamento()
        self.chamadas += 1
        req = urllib.request.Request(f"{HENRIK_URL}{caminho}", headers={
            "Authorization": self.henrik, "Accept": "application/json", "User-Agent": "NokyLabs-ValReport/2.0"})
        for tentativa in (1, 2):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    return json.loads(r.read().decode("utf-8")).get("data")
            except urllib.error.HTTPError as e:
                if e.code == 429 and tentativa == 1:
                    time.sleep(min(int(e.headers.get("Retry-After") or 30), 60))
                    continue
                if e.code == 429:
                    raise SemOrcamento()
                if e.code == 404:
                    raise NaoEncontrado()
                if e.code in (401, 403):
                    raise RuntimeError("a HenrikDev recusou a chave (confira a HENRIKDEV_API_KEY)")
                raise RuntimeError(f"a HenrikDev respondeu com erro {e.code}")
            except urllib.error.URLError as e:
                raise RuntimeError(f"sem conexão com a HenrikDev ({e.reason})")
        raise SemOrcamento()

    # ---------- cada tipo ----------
    def partida(self, mid, estado, pend):
        """Busca a partida de novo; guarda se vier pelo menos tão completa quanto a do PC."""
        mid = mid.lower()
        if not RE_UUID.match(mid):
            raise RuntimeError("id de partida inválido")
        antes = armazem.ler_partida(mid)
        try:
            nova = self.api(f"/valorant/v4/match/{urllib.parse.quote(self.cfg.get('regiao', 'br'))}/{mid}")
        except NaoEncontrado:
            raise RuntimeError("a HenrikDev não achou essa partida")
        if not isinstance(nova, dict) or g(nova, "metadata", "match_id") != mid:
            raise RuntimeError("a HenrikDev não devolveu essa partida")
        probs = problemas(nova)
        if not av.rounds_validos(nova):
            return "erro", "A API ainda manda essa partida sem os rounds. Tente de novo mais tarde.", False
        if antes is not None and pontos(nova) < pontos(antes):
            return "feito", "A API mandou uma versão menos completa que a do PC; ficou a do PC.", False
        armazem.salvar_partida(nova)
        novos = self._registrar(nova, estado, pend)
        txt = "Partida completa agora." if not probs else f"Partida atualizada, mas ainda falta: {_descrever(probs)}."
        if novos:
            txt += f" Entrou para {', '.join(_apelido(r, self.cfg) for r in novos)} (vai no próximo report)."
        return "feito", txt, True

    def _registrar(self, p, estado, pend):
        """Partida que antes ficou de fora (sem rounds) entra como lida para quem jogou, como na coleta."""
        import coletor_valorant as col
        mid = g(p, "metadata", "match_id")
        (estado.get("sem_dados") or {}).pop(mid, None)
        incluidas = [f.lower() for f in self.cfg.get("filas_incluidas", ["competitive", "premier", "custom"])]
        if not col.fila_incluida(p, incluidas) or not av.partida_valida(p):
            return []
        a = av.analisar_partida_completa(p, None, self.cfg)
        novos = []
        for riot in self.cfg.get("jogadores") or []:
            j = av.localizar(a, riot)
            lidas = estado.setdefault("lidas", {}).setdefault(riot, [])
            if not j or not j["rounds"] or mid in lidas:
                continue
            lidas.append(mid)
            ign = estado.setdefault("ignoradas", {}).get(riot) or []
            if mid in ign:
                ign.remove(mid)
            r = av.resumo_basico(a, j)
            alvo = pend.setdefault("jogadores", {}).setdefault(riot, {"partidas": [], "ignoradas": 0, "filas_ignoradas": {}})
            alvo["partidas"].append(r)
            col.anexar_historico(riot, r)
            novos.append(riot)
        return novos

    def elo(self, riot):
        import coletor_valorant as col
        if riot.lower() not in {r.lower() for r in self.cfg.get("jogadores") or []}:
            raise RuntimeError("essa pessoa não está na lista de jogadores da coleta")
        if self.chamadas + 2 > ORCAMENTO_API or self.sem_tempo():
            raise SemOrcamento()
        self.chamadas += 2   # o elo tenta até 3 endereços
        riot = next(r for r in self.cfg["jogadores"] if r.lower() == riot.lower())
        n = col.coletar_elo(self.henrik, self.cfg, riot)
        if n:
            return "feito", f"{n} mudança(s) nova(s) de RR.", True
        return "feito", "A API não tem mudança nova de RR (se a última foi de colocação, ela não aparece).", False

    def card(self, riot):
        nome, _, tag = riot.partition("#")
        pu = _puuids(self.cfg).get(riot.lower())
        try:
            d = self.api(f"/valorant/v2/by-puuid/account/{urllib.parse.quote(pu, safe='')}?force=true" if pu else
                         f"/valorant/v2/account/{urllib.parse.quote(nome, safe='')}/{urllib.parse.quote(tag, safe='')}?force=true")
        except NaoEncontrado:
            raise RuntimeError("a HenrikDev não achou essa conta (confira o Riot ID)")
        d = d or {}
        card = d.get("card") if isinstance(d.get("card"), str) else g(d, "card", "id")
        if not card:
            return "erro", "A API não trouxe o card dessa conta agora.", False
        contas = _ler(ARQ_CONTAS, {}) or {}
        velho = (contas.get(riot.lower()) or {}).get("card")
        contas[riot.lower()] = {"card": card, "nivel": d.get("account_level"),
                                "titulo": d.get("title") if isinstance(d.get("title"), str) else g(d, "title", "id"),
                                "puuid": d.get("puuid"), "t": _agora().isoformat(timespec="seconds")}
        _salvar(ARQ_CONTAS, contas)
        nivel = f" (nível {d['account_level']})" if d.get("account_level") else ""
        return "feito", f"Card encontrado{nivel}.", card != velho

    def tudo(self, cfg, estado, pend):
        """Refaz o que o diagnóstico aponta, até acabar o orçamento; o resto fica para a próxima coleta."""
        diag = diagnosticar(cfg, estado)
        tentativas = _ler(ARQ_TENTATIVAS, {}) or {}
        limite = (_agora() - timedelta(hours=REPETIR_TUDO_H)).isoformat()
        itens = ([("partida", x["id"]) for x in diag["sem_dados"]] + [("partida", x["id"]) for x in diag["partidas"]]
                 + [("elo", x["riot"]) for x in diag["elo"]] + [("card", x["riot"]) for x in diag["cards"]])
        itens = [i for i in dict.fromkeys(itens) if (tentativas.get(f"{i[0]}:{i[1]}") or "") < limite]
        feitos, mudou, falhas = 0, False, 0
        for tipo, alvo in itens:
            try:
                st, _txt, m = (self.partida(alvo, estado, pend) if tipo == "partida" else
                               self.elo(alvo) if tipo == "elo" else self.card(alvo))
                falhas += st == "erro"
            except SemOrcamento:
                break
            except Exception:  # noqa: BLE001 — um item com problema não para os outros
                falhas += 1
                m = False
            feitos += 1
            mudou = mudou or m
            tentativas[f"{tipo}:{alvo}"] = _agora().isoformat(timespec="seconds")
        _salvar(ARQ_TENTATIVAS, {k: v for k, v in tentativas.items() if v >= (_agora() - timedelta(days=7)).isoformat()})
        resto = len(itens) - feitos
        if not itens:
            return "feito", "Nada faltando para buscar de novo. Site reenviado.", True
        texto = f"{feitos} de {len(itens)} item(ns) refeito(s)" + (f", {falhas} sem melhora" if falhas else "")
        if resto:
            return "pendente", texto + f"; os outros {resto} continuam na próxima coleta (a API tem limite por minuto).", mudou
        return "feito", texto + ".", True

    def atender(self, p, estado, pend):
        tipo, alvo = p.get("tipo"), p.get("alvo") or ""
        if tipo == "partida":
            return self.partida(alvo, estado, pend)
        if tipo == "elo":
            return self.elo(alvo)
        if tipo == "card":
            return self.card(alvo)
        if tipo == "site":
            return "feito", "Site reenviado.", True
        if tipo == "tudo":
            return self.tudo(self.cfg, estado, pend)
        return "erro", "Tipo de pedido desconhecido.", False


def rodar(chave_henrik, cfg, log=print):
    """Chamado pela coleta, com a trava. Devolve True se fez alguma coisa que vale registrar no log."""
    try:
        s = Sessao(chave_henrik, cfg, log)
    except Exception as e:  # noqa: BLE001
        log(f"Sync: não iniciado ({e}).")
        return True
    if not s.ativo:
        return False
    try:
        pedidos = s.rpc("pc_sync_pegar", {"p_slug": s.slug, "p_limite": 10}) or []
    except urllib.error.HTTPError as e:
        if e.code == 404:   # o supabase/sync.sql ainda não foi aplicado: fica quieto até lá
            print("Sync: ainda não ligado no Supabase (falta rodar o supabase/sync.sql).")
            return False
        log(f"Sync: não consegui ler os pedidos do site ({e}).")
        pedidos = []
    except (urllib.error.URLError, OSError, ValueError) as e:
        log(f"Sync: não consegui ler os pedidos do site ({e}).")
        pedidos = []

    estado = _ler(ARQ_ESTADO, None)
    pend = _ler(ARQ_PENDENTES, None) or {"jogadores": {}}
    respostas, exportar = [], False
    for p in pedidos:
        try:
            if estado is None and p.get("tipo") in ("partida", "tudo"):
                raise RuntimeError("o PC ainda não fez a primeira coleta completa (a das 21h)")
            st, txt, mudou = s.atender(p, estado if estado is not None else {}, pend)
        except SemOrcamento:
            st, txt, mudou = "pendente", "A API está no limite desta coleta; continua na próxima.", False
        except Exception as e:  # noqa: BLE001
            st, txt, mudou = "erro", f"Não deu: {str(e)[:300]}.", False
        exportar = exportar or mudou
        respostas.append([p, st, txt])
        log(f"Sync: {p.get('tipo')} {p.get('alvo') or ''} -> {st}: {txt}")

    if estado is not None and pedidos:
        import coletor_valorant as col
        sd = estado.get("sem_dados") or {}
        if len(sd) > 40:
            estado["sem_dados"] = dict(sorted(sd.items(), key=lambda x: x[1].get("t") or "")[-40:])
        col.salvar_json(ARQ_ESTADO, estado)
        if pend.get("jogadores"):
            col.salvar_json(ARQ_PENDENTES, pend)

    if exportar and (cfg.get("site") or {}).get("ativo", True) is not False:
        try:
            import exportar_site
            ok = exportar_site.exportar_e_publicar(cfg)
        except Exception as e:  # noqa: BLE001
            log(f"Sync: erro ao atualizar o site ({e}).")
            ok = False
        for r in respostas:
            if r[1] == "feito":
                r[2] += " Site atualizado." if ok else " O site não foi atualizado (veja o log do PC)."

    for p, st, txt in respostas:
        try:
            s.rpc("pc_sync_concluir", {"p_id": p["id"], "p_status": st, "p_resultado": txt})
        except (urllib.error.URLError, OSError, ValueError) as e:
            log(f"Sync: não consegui marcar o pedido no site ({e}).")

    try:
        diag = diagnosticar(cfg)
        s.rpc("pc_sync_estado", {"p_slug": s.slug, "p_estado": diag, "p_versao": VERSAO})
    except Exception as e:  # noqa: BLE001
        log(f"Sync: estado não enviado ao site ({e}).")
        return True
    return bool(pedidos)


if __name__ == "__main__":   # py ferramentas\sync.py -> mostra o diagnóstico (não pede nada à API)
    import gerar_report as gr
    cfg = gr.config_padrao(gr.ler_json(PASTA / "config.json", {}))
    try:
        import elenco_site
        cfg = elenco_site.aplicar(cfg)
    except Exception:  # noqa: BLE001
        pass
    print(json.dumps(diagnosticar(cfg), ensure_ascii=False, indent=1))
