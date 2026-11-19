"""ValReport · relatório pós-scrim no Discord (v48)

Quando a coleta acha uma partida nova PERSONALIZADA (scrim, treino, campeonato de terceiros) ou PREMIER da equipe,
manda um resumo para o canal da equipe (DISCORD_WEBHOOK_EQUIPE):
  - placar e mapa;
  - pistols, conversão de vantagem (5v4), recuperação (4v5), pós-plant e retake;
  - onde a equipe plantou;
  - o MVP da equipe na partida (impacto por round);
  - até 3 rounds para rever, com link direto para o replay 2D do site.
Cada partida é enviada uma vez só (dados/cache/pos_scrim.json). Para desligar: "discord": {"pos_scrim": false}.
O contexto exato (Scrim vs X, Oficial) é do site (agenda); aqui a partida aparece como Personalizada ou Premier.
"""
import json
from pathlib import Path

import armazem
import avaliacao as av
import gerar_report as gr

PASTA = Path(__file__).resolve().parent.parent
ARQ_ENVIADOS = PASTA / "dados" / "cache" / "pos_scrim.json"
FILAS = {"custom": ("🎯", "Personalizada"), "premier": ("🏆", "Premier")}


def _enviados():
    try:
        return set(json.loads(ARQ_ENVIADOS.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return set()


def _guardar(ids):
    try:
        ARQ_ENVIADOS.parent.mkdir(parents=True, exist_ok=True)
        ARQ_ENVIADOS.write_text(json.dumps(sorted(ids)[-500:]), encoding="utf-8")
    except OSError:
        pass


def _par(v, t):
    return f"{v}/{t} ({round(100 * v / t)}%)" if t else "—"


def montar(mid, cfg):
    """O texto do relatório de uma partida (ou None se a partida não é da equipe)."""
    bruta = armazem.ler_partida(mid)
    if not bruta or not av.partida_valida(bruta):
        return None
    a = av.analisar_partida_completa(bruta, armazem.carregar_modelo(cfg), cfg)
    if a.get("fila_id") not in FILAS:
        return None
    nossos = {}
    for rid in cfg.get("jogadores", []):
        j = av.localizar(a, rid)
        if j:
            nossos[j["puuid"]] = (rid, j)
    if not nossos:
        return None
    from collections import Counter
    nosso = Counter(j["time"] for _, j in nossos.values()).most_common(1)[0][0]
    import exportar_site
    rd = exportar_site.rounds_resumo(bruta, nosso, cfg)
    placar = {t.get("team_id"): av.g(t, "rounds", "won", padrao=0) for t in bruta.get("teams") or []}
    nos = placar.get(nosso, 0)
    eles = next((v for k, v in placar.items() if k != nosso), 0)
    res = "vitória" if nos > eles else "derrota" if nos < eles else "empate"

    pist = [(r[0], r[1]) for i, r in enumerate(rd) if r[2] == 0]
    pistol = " · ".join(f"{'ATQ' if lado == 0 else 'DEF'} {'✅' if v else '❌'}" for lado, v in pist) or "—"
    conv = [r[1] for r in rd if r[4] == 1]
    recup = [r[1] for r in rd if r[4] == 0]
    pos = [r[1] for r in rd if r[8] == 1]
    ret = [r[1] for r in rd if r[8] == 0]
    sites = Counter(r[5] for r in rd if r[8] == 1 and r[5])
    tot_s = sum(sites.values())
    sites_txt = " · ".join(f"{s} {round(100 * n / tot_s)}%" for s, n in sites.most_common()) or "—"

    # MVP da equipe: maior impacto por round
    melhores = sorted(((round(100 * sum(r["wpa"] for r in j["rounds"]) / max(1, len(j["rounds"])), 1), rid, j)
                       for rid, j in nossos.values() if j["rounds"]), reverse=True)
    mvp = ""
    if melhores:
        imp, rid, j = melhores[0]
        k = sum(r["kills"] for r in j["rounds"])
        d = sum(1 for r in j["rounds"] if r.get("morreu"))
        mvp = f"**MVP:** {gr.apelido(rid, cfg)} ({j['agente']}) · impacto {imp:+.1f}%/round · {k}/{d}"

    # rounds para rever: vantagem perdida, pós-plant perdido, retake perdido
    base = gr.url_site(cfg)
    rever = []
    for i, r in enumerate(rd):
        motivo = ("vantagem perdida" if r[4] == 1 and not r[1] else "pós-plant perdido" if r[8] == 1 and not r[1]
                  else "retake perdido" if r[8] == 0 and not r[1] else "")
        if motivo:
            rever.append(f"[R{i + 1} · {motivo}](<{base}#/p/{mid}/mapa?r={i + 1}>)")
    emoji, nome = FILAS[a["fila_id"]]
    linhas = [
        f"## {emoji} {nome} · {a['mapa']} {nos}–{eles} ({res})",
        f"**Pistols:** {pistol}",
        f"**Vantagem 5v4:** {_par(sum(conv), len(conv))} · **4v5:** {_par(sum(recup), len(recup))}",
        f"**Pós-plant:** {_par(sum(pos), len(pos))} · **Retake:** {_par(sum(ret), len(ret))}",
        f"**Onde plantamos:** {sites_txt}",
    ]
    if mvp:
        linhas.append(mvp)
    if rever:
        linhas.append("**Para rever:** " + " · ".join(rever[:3]))
    linhas.append(f"[Abrir a partida no site](<{base}#/p/{mid}>) · [Replay 2D](<{base}#/p/{mid}/mapa>)")
    return "\n".join(linhas)


def enviar(ids, cfg):
    """Manda o relatório das partidas novas (personalizadas e Premier) que ainda não foram enviadas."""
    if (cfg.get("discord") or {}).get("pos_scrim") is False:
        return 0
    import discord_envio
    url = discord_envio.webhooks().get("equipe")
    if not url:
        return 0
    enviados = _enviados()
    n = 0
    for mid in ids:
        if mid in enviados:
            continue
        try:
            texto = montar(mid, cfg)
        except Exception as e:  # noqa: BLE001 — o relatório nunca derruba a coleta
            print(f"  Relatório pós-scrim de {mid[:8]} não montado ({e}).")
            continue
        enviados.add(mid)
        if texto and discord_envio.postar(url, texto, nome=(cfg.get("discord") or {}).get("nome", "NokyLabs")):
            n += 1
    _guardar(enviados)
    return n
