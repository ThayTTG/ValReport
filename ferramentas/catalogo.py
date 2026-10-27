"""Catálogo de habilidades — NokyLabs

A API das partidas (HenrikDev) manda alguns abates de habilidade sem nome: a Caçador de Cabeças e a Tour de Force
do Chamber e a Sobrecarga da Neon chegam como "arma" sem nome, e granadas como "GrenadeAbility". Este módulo traduz
cada abate para o nome certo (em português, como no jogo) e diz se foi arma, habilidade, faca, spike ou queda.

Os nomes vêm da valorant-api.com (guardados por 7 dias em dados/cache/habilidades.json); sem internet, usa o que
estiver guardado e, no último caso, os nomes de reserva abaixo. Só usa a biblioteca padrão do Python.
"""

import json
import time
import urllib.request
from pathlib import Path

PASTA = Path(__file__).resolve().parent.parent
ARQ_CACHE = PASTA / "dados" / "cache" / "habilidades.json"
SEMANA = 7 * 86400
URL = "https://valorant-api.com/v1/agents?isPlayableCharacter=true&language={}"

# Habilidades que a API manda como "Weapon" sem nome (conferido nas partidas: só aparecem com o agente certo,
# e a Tour de Force só quando a ultimate foi usada)
ESPECIAIS = {
    "856d9a7e-4b06-dc37-15dc-9d809c37cb90": ("Chamber", "Ability1"),   # Caçador de Cabeças
    "39099fb5-4293-def4-1e09-2e9080ce7456": ("Chamber", "Ultimate"),   # Tour de Force
    "95336ae4-45d4-1032-cfaf-6bad01910607": ("Neon", "Ultimate"),      # Sobrecarga
}
# Abates de habilidade sem nome que a API manda pelo "espaço" da habilidade
CODIGO_SLOT = {"GrenadeAbility": "Grenade", "Ability1Ability": "Ability1", "Ability2Ability": "Ability2",
               "UltimateAbility": "Ultimate", "PrimaryAbility": "Ability1", "SecondaryAbility": "Ability2"}
RESERVA = {("Chamber", "Ability1"): "Caçador de Cabeças", ("Chamber", "Ultimate"): "Tour de Force",
           ("Neon", "Ultimate"): "Sobrecarga", ("Killjoy", "Grenade"): "Nanoenxame", ("Raze", "Grenade"): "Bumba",
           ("Gekko", "Grenade"): "Mosh Pit"}
# Contam como sniper (atributo Sniper): a Tour de Force é uma Operator de ultimate
SNIPERS = {"Operator", "Outlaw", "Marshal", "Tour de Force"}
ROTULOS = {"Melee": "Faca", "Bomb": "Spike", "Fall": "Queda"}

_catalogo = None


def _baixar(lingua):
    pedido = urllib.request.Request(URL.format(lingua), headers={"User-Agent": "NokyLabs-ValReport"})
    with urllib.request.urlopen(pedido, timeout=20) as r:
        return json.loads(r.read().decode("utf-8")).get("data") or []


def carregar(forcar=False):
    """{agente: {"uuid", "slots": {slot: {"pt", "en", "icone"}}}} — da cache, da internet ou vazio."""
    global _catalogo
    if _catalogo is not None and not forcar:
        return _catalogo
    guardado = None
    try:
        guardado = json.loads(ARQ_CACHE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    if guardado and not forcar and time.time() - guardado.get("t", 0) < SEMANA:
        _catalogo = guardado["agentes"]
        return _catalogo
    try:
        pt, en = _baixar("pt-BR"), _baixar("en-US")
        nomes_en = {(a["uuid"], h.get("slot")): h.get("displayName") for a in en for h in a.get("abilities") or []}
        agentes = {}
        for a in pt:
            slots = {}
            for h in a.get("abilities") or []:
                if not h.get("slot"):
                    continue
                slots[h["slot"]] = {"pt": h.get("displayName"), "en": nomes_en.get((a["uuid"], h["slot"])),
                                    "icone": h.get("displayIcon")}
            nome_en = next((x["displayName"] for x in en if x["uuid"] == a["uuid"]), a["displayName"])
            agentes[nome_en] = {"uuid": a["uuid"], "slots": slots}
        if agentes:
            ARQ_CACHE.parent.mkdir(parents=True, exist_ok=True)
            ARQ_CACHE.write_text(json.dumps({"t": time.time(), "agentes": agentes}, ensure_ascii=False), encoding="utf-8")
            _catalogo = agentes
            return _catalogo
    except Exception:  # sem internet ou a API fora do ar: segue com o que tiver
        pass
    _catalogo = (guardado or {}).get("agentes") or {}
    return _catalogo


def _g(d, *chaves):
    for c in chaves:
        if not isinstance(d, dict):
            return None
        d = d.get(c)
    return d


def _nome_habilidade(agente, slot):
    info = _g(carregar(), agente, "slots", slot) or {}
    return info.get("pt") or RESERVA.get((agente, slot)) or info.get("en") or f"Habilidade ({agente or '?'})"


def _por_nome_en(agente, nome_en):
    """Nome em inglês que a API manda (ex.: "Showstopper") → nome em português (ex.: "Estraga-prazeres")."""
    for slot, info in (_g(carregar(), agente, "slots") or {}).items():
        if (info.get("en") or "").lower() == nome_en.lower():
            return slot, info.get("pt") or nome_en
    for ag, dados in carregar().items():   # agente desconhecido: procura em todos
        for slot, info in (dados.get("slots") or {}).items():
            if (info.get("en") or "").lower() == nome_en.lower():
                return slot, info.get("pt") or nome_en
    return None, nome_en


def abate(k, agente=None):
    """(nome, tipo, slot) de um abate. tipo: "W" arma, "A" habilidade, "M" faca, "B" spike, "F" queda, "?" desconhecido."""
    wid, tipo, nome = _g(k, "weapon", "id") or "", _g(k, "weapon", "type") or "", _g(k, "weapon", "name")
    if wid in ESPECIAIS:
        ag, slot = ESPECIAIS[wid]
        return _nome_habilidade(ag, slot), "A", slot
    if tipo == "Ability":
        if nome:
            slot, pt = _por_nome_en(agente, nome)
            return pt, "A", slot
        slot = CODIGO_SLOT.get(wid)
        return (_nome_habilidade(agente, slot) if slot and agente else "Habilidade"), "A", slot
    if tipo in ROTULOS:
        return ROTULOS[tipo], tipo[:1], None
    if nome:
        return nome, "W", None
    return "Desconhecida", "?", None


def eh_habilidade(k):
    """Sem precisar do catálogo: o abate foi de habilidade (inclusive as que chegam como arma sem nome)?"""
    return (_g(k, "weapon", "type") or "") == "Ability" or (_g(k, "weapon", "id") or "") in ESPECIAIS


def icone(agente, slot):
    return _g(carregar(), agente, "slots", slot, "icone")
