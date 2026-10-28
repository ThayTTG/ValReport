"""Diagnóstico do PC — NokyLabs

Confere se o PC está pronto para o ValReport e diz o que fazer quando algo não está:
  - leve (roda a cada coleta, vai para a página Sync/Diagnóstico do site): Python, config.json, chaves configuradas
    (só "sim" ou "não", o valor nunca aparece), tarefas do Agendador, última coleta, trava, disco, código do site
    no PC e o que ainda não foi publicado no GitHub;
  - completa (Atalhos\\diagnostico.bat): tudo acima e mais os testes de rede — HenrikDev, Supabase (e se o Sync
    está ligado no banco), GitHub e a versão do site no ar. Salva em dados\\diagnostico.txt e manda para o site.

Só usa a biblioteca padrão do Python.
"""

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

PASTA = Path(__file__).resolve().parent.parent
DADOS = PASTA / "dados"
ARQ_TXT = DADOS / "diagnostico.txt"
ARQ_REDE = DADOS / "cache" / "diagnostico_rede.json"    # o último teste de rede (o .bat), para o site mostrar
HENRIK_URL = os.environ.get("HENRIKDEV_URL", "https://api.henrikdev.xyz").rstrip("/")
SITE_URL = os.environ.get("VALREPORT_SITE_URL", "https://valreport.vercel.app").rstrip("/")
TAREFAS = {"NokyLabs - Report VALORANT": "report das 21h", "NokyLabs - Atualizar site VALORANT": "coleta de 20 em 20 minutos"}
SEM_JANELA = getattr(subprocess, "CREATE_NO_WINDOW", 0)   # a coleta roda sem console: nada de janela piscando
MARCA = {"ok": "[OK]", "aviso": "[ ! ]", "erro": "[ X ]", "info": "[ - ]"}


def _item(id_, nome, estado, detalhe, dica=""):
    return {"id": id_, "nome": nome, "estado": estado, "detalhe": detalhe, "dica": dica}


def _ler(caminho, padrao=None):
    try:
        return json.loads(Path(caminho).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return padrao


def _agora():
    try:
        import avaliacao as av
        return datetime.now(av.FUSO_BR)
    except Exception:  # noqa: BLE001
        return datetime.now().astimezone()


def _rodar(args, timeout=20):
    try:
        r = subprocess.run(args, cwd=PASTA, capture_output=True, timeout=timeout, creationflags=SEM_JANELA)
    except (OSError, subprocess.TimeoutExpired):
        return None
    cod = "oem" if os.name == "nt" else "utf-8"
    try:
        saida = r.stdout.decode(cod, errors="replace")
    except LookupError:
        saida = r.stdout.decode("utf-8", errors="replace")
    return r.returncode, saida


def _ha(minutos):
    m = round(minutos)
    return f"há {m} min" if m < 120 else f"há {round(m / 60)} h" if m < 48 * 60 else f"há {round(m / 1440)} dias"


def _versao_sw(texto):
    m = re.search(r'VERSAO\s*=\s*"(valreport-v(\d+))"', texto or "")
    return (m.group(1), int(m.group(2))) if m else (None, None)


# ----------------------------------------------------------------------------
# Verificações leves (sem internet)
# ----------------------------------------------------------------------------

def _tarefas():
    if os.name != "nt":
        return [_item("tarefas", "Tarefas do Agendador", "info", "só existe no Windows")]
    out = []
    for nome, papel in TAREFAS.items():
        r = _rodar(["schtasks", "/Query", "/TN", nome, "/FO", "CSV", "/V", "/NH"])
        if not r or r[0] != 0 or not r[1].strip():
            out.append(_item("tarefa", f"Tarefa: {papel}", "erro", "não encontrada no Agendador de Tarefas",
                             "Rode Atalhos\\instalar_agendamento.ps1 (botão direito > Executar com o PowerShell)."))
            continue
        import csv
        campos = next(csv.reader([r[1].strip().splitlines()[0]]), [])
        # ordem fixa do schtasks /V (em qualquer idioma): host, nome, próxima execução, status, modo de logon,
        # última execução, último resultado, autor, tarefa, iniciar em, comentário, estado da tarefa agendada...
        c = campos + [""] * 12
        prox, status, ultima, resultado, habilitada = c[2], c[3], c[5], c[6], c[11]
        desligada = re.search(r"desab|disab", f"{status} {habilitada}", re.I)
        falhou = resultado.strip() not in ("0", "267009", "267011", "")   # 267009 = rodando agora, 267011 = ainda não rodou
        estado = "erro" if desligada else "aviso" if falhou else "ok"
        detalhe = f"{status.strip() or '?'} · última: {ultima.strip() or '—'} · próxima: {prox.strip() or '—'}"
        if falhou:
            detalhe += f" · último resultado {resultado.strip()}"
        dica = ("Abra o Agendador de Tarefas e habilite a tarefa (botão direito > Habilitar)." if desligada else
                "A última execução terminou com erro; veja o dados\\coletor.log." if falhou else "")
        out.append(_item("tarefa", f"Tarefa: {papel}", estado, detalhe, dica))
    return out


def leves(cfg=None):
    """Verificações rápidas, sem internet (rodam a cada coleta)."""
    itens = []
    v = sys.version_info
    itens.append(_item("python", "Python", "ok" if v >= (3, 9) else "erro",
                       f"Python {v.major}.{v.minor}.{v.micro} · {platform.system()} {platform.release()}",
                       "" if v >= (3, 9) else "Instale o Python 3.11 ou mais novo (python.org)."))

    bruto = _ler(PASTA / "config.json", None)
    if not isinstance(bruto, dict):
        itens.append(_item("config", "config.json", "erro", "não encontrado ou com erro de formatação",
                           "Copie o config.exemplo.json para config.json e preencha os jogadores."))
        bruto = {}
    else:
        n = len(bruto.get("jogadores") or [])
        itens.append(_item("config", "config.json", "ok" if n else "aviso", f"{n} jogador(es) na lista",
                           "" if n else "Coloque os Riot IDs da equipe em \"jogadores\"."))
    cfg = cfg or bruto

    chave_h = bool(os.environ.get("HENRIKDEV_API_KEY", "").strip())
    itens.append(_item("chave_henrik", "Chave da HenrikDev", "ok" if chave_h else "erro",
                       "configurada" if chave_h else "não configurada",
                       "" if chave_h else "Crie a variável de usuário HENRIKDEV_API_KEY (veja o LEIA-ME) e reinicie o PC."))
    chave_s = bool(os.environ.get("SUPABASE_SECRET_KEY", "").strip())
    itens.append(_item("chave_supabase", "Chave do Supabase", "ok" if chave_s else "aviso",
                       "configurada" if chave_s else "não configurada (o site não recebe os dados)",
                       "" if chave_s else "Crie a variável de usuário SUPABASE_SECRET_KEY (guia da etapa 1)."))
    try:
        import discord_envio
        n_hooks = len(discord_envio.webhooks())
    except Exception:  # noqa: BLE001
        n_hooks = 0
    itens.append(_item("discord", "Discord", "ok" if n_hooks else "info",
                       f"{n_hooks} de 4 canais configurados" if n_hooks else "nenhum canal configurado (o report não vai para o Discord)"))

    itens += _tarefas()

    rapida = _ler(DADOS / "ultima_coleta_rapida.json", {}) or {}
    quando = rapida.get("em")
    if cfg.get("coleta_rapida", True) is False:
        itens.append(_item("coleta", "Coleta rápida", "aviso", "desligada no config.json (\"coleta_rapida\": false)"))
    elif not quando:
        itens.append(_item("coleta", "Coleta rápida", "aviso", "ainda não rodou neste PC",
                           "Rode o Atalhos\\atualizar_agora.bat ou espere a tarefa de 20 minutos."))
    else:
        try:
            idade = (_agora() - datetime.fromisoformat(quando)).total_seconds() / 60
        except ValueError:
            idade = None
        estado = "ok" if idade is not None and idade <= 45 else "aviso"
        itens.append(_item("coleta", "Coleta rápida", estado,
                           f"última em {quando[:16].replace('T', ' ')}" + (f" ({_ha(idade)})" if idade is not None else ""),
                           "" if estado == "ok" else "A tarefa de 20 minutos parece parada: confira o Agendador de Tarefas."))
    estado_col = _ler(DADOS / "estado.json", {}) or {}
    ult = estado_col.get("ultima_execucao")
    if ult:
        dias = (_agora().date() - datetime.fromisoformat(ult).date()).days
        itens.append(_item("report", "Report diário", "ok" if dias <= 1 else "aviso", f"último em {ult}",
                           "" if dias <= 1 else "O report das 21h não roda há alguns dias: o PC estava desligado às 21h?"))
    trava = DADOS / "coleta.trava"
    if trava.exists():
        idade = (time.time() - trava.stat().st_mtime) / 60
        itens.append(_item("trava", "Trava da coleta", "ok" if idade < 40 else "aviso",
                           f"uma coleta está rodando ({_ha(idade)})" if idade < 40 else f"trava antiga ({_ha(idade)})",
                           "" if idade < 40 else "Ela é ignorada sozinha; se a coleta não roda, apague dados\\coleta.trava."))

    try:
        livre = shutil.disk_usage(PASTA).free / 1024 ** 3
        itens.append(_item("disco", "Espaço em disco", "ok" if livre >= 1 else "aviso", f"{livre:.1f} GB livres",
                           "" if livre >= 1 else "Libere espaço: com menos de 1 GB as partidas podem não ser salvas."))
    except OSError:
        pass
    n_partidas = len(list((DADOS / "partidas").glob("*.json*"))) if (DADOS / "partidas").exists() else 0
    itens.append(_item("partidas", "Partidas guardadas", "info", f"{n_partidas} no PC"))

    local, _ = _versao_sw((PASTA / "docs" / "sw.js").read_text(encoding="utf-8") if (PASTA / "docs" / "sw.js").exists() else "")
    itens.append(_item("codigo", "Código do site no PC", "info", local or "não encontrado"))
    if (PASTA / ".git").exists():
        r = _rodar(["git", "status", "--porcelain", "--", "docs", "ferramentas", "supabase", "guias", "Atalhos"])
        if r and r[0] == 0:
            n = len([x for x in r[1].splitlines() if x.strip()])
            itens.append(_item("git", "Publicação", "ok" if not n else "aviso",
                               "tudo publicado no GitHub" if not n else f"{n} arquivo(s) mudaram no PC e ainda não foram publicados",
                               "" if not n else "Rode o Atalhos\\publicar_site.bat."))
        elif r is None:
            itens.append(_item("git", "Publicação", "aviso", "o git não foi encontrado",
                               "Instale o Git para Windows (git-scm.com) para o publicar_site.bat funcionar."))
    else:
        itens.append(_item("git", "Publicação", "aviso", "a pasta não é um clone do repositório", "Veja o guias\\PUBLICAR.md."))
    return itens


# ----------------------------------------------------------------------------
# Verificações de rede (só no diagnostico.bat)
# ----------------------------------------------------------------------------

def _http(metodo, url, cab=None, corpo=None, timeout=20):
    """(status, corpo em texto, cabeçalhos, ms); status 0 = sem conexão."""
    dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo, headers={"User-Agent": "NokyLabs-ValReport/2.0", **(cab or {})})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), dict(r.headers), round((time.monotonic() - t0) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), dict(e.headers), round((time.monotonic() - t0) * 1000)
    except (urllib.error.URLError, OSError) as e:
        return 0, str(getattr(e, "reason", e)), {}, round((time.monotonic() - t0) * 1000)


def rede(cfg):
    itens = []
    chave = os.environ.get("HENRIKDEV_API_KEY", "").strip()
    if chave:
        st, corpo, cab, ms = _http("GET", f"{HENRIK_URL}/valorant/v1/version/{cfg.get('regiao', 'br')}",
                                   {"Authorization": chave, "Accept": "application/json"})
        resto = next((v for k, v in cab.items() if k.lower() == "x-ratelimit-remaining"), None)
        if st == 200:
            versao = (_ler_json_texto(corpo).get("data") or {}).get("version_for_api") or ""
            itens.append(_item("henrik", "HenrikDev API", "ok", f"respondeu em {ms} ms" + (f" · jogo {versao}" if versao else "")
                               + (f" · {resto} chamada(s) livres no minuto" if resto else "")))
        elif st in (401, 403):
            itens.append(_item("henrik", "HenrikDev API", "erro", "recusou a chave", "Confira a HENRIKDEV_API_KEY (pode ter expirado)."))
        elif st == 429:
            itens.append(_item("henrik", "HenrikDev API", "aviso", "no limite de requisições agora", "Normal logo depois de uma coleta; tente de novo em 1 minuto."))
        else:
            itens.append(_item("henrik", "HenrikDev API", "erro", f"não respondeu ({st or corpo[:80]})", "A API pode estar fora do ar; tente mais tarde."))

    try:
        import elenco_site
        url, segredo, slug = elenco_site._supabase(cfg)
    except Exception:  # noqa: BLE001
        url, segredo, slug = None, "", None
    if segredo:
        cab = {"apikey": segredo, "Content-Type": "application/json", "Accept": "application/json"}
        if segredo.startswith("eyJ"):
            cab["Authorization"] = f"Bearer {segredo}"
        st, corpo, _, ms = _http("POST", f"{url}/rest/v1/rpc/pc_elenco_equipe", cab, {"p_slug": slug})
        if st == 200:
            itens.append(_item("supabase", "Supabase", "ok", f"respondeu em {ms} ms (equipe {slug})"))
            # o Sync está ligado? (concluir um pedido que não existe não muda nada)
            st2, _, _, _ = _http("POST", f"{url}/rest/v1/rpc/pc_sync_concluir", cab,
                                 {"p_id": "00000000-0000-0000-0000-000000000000", "p_status": "feito", "p_resultado": "teste"})
            itens.append(_item("sync_sql", "Sync no banco", "ok" if st2 in (200, 204) else "aviso",
                               "ligado" if st2 in (200, 204) else "ainda não ligado",
                               "" if st2 in (200, 204) else "Rode o supabase\\sync.sql no SQL Editor do Supabase."))
        elif st in (401, 403):
            itens.append(_item("supabase", "Supabase", "erro", "recusou a chave", "Confira a SUPABASE_SECRET_KEY."))
        else:
            itens.append(_item("supabase", "Supabase", "erro", f"não respondeu ({st or corpo[:80]})", "Confira a internet do PC."))

    if (PASTA / ".git").exists():
        r = _rodar(["git", "ls-remote", "--heads", "origin"], timeout=30)
        ok = bool(r and r[0] == 0)
        itens.append(_item("github", "GitHub", "ok" if ok else "erro", "acessível" if ok else "não consegui falar com o repositório",
                           "" if ok else "Confira a internet e o login do Git (o publicar_site.bat usa o mesmo)."))

    st, corpo, _, ms = _http("GET", f"{SITE_URL}/sw.js")
    no_ar, n_ar = _versao_sw(corpo) if st == 200 else (None, None)
    _, n_pc = _versao_sw((PASTA / "docs" / "sw.js").read_text(encoding="utf-8") if (PASTA / "docs" / "sw.js").exists() else "")
    if not no_ar:
        itens.append(_item("site", "Site no ar", "erro", f"não respondeu ({st or corpo[:80]})", "Veja se a Vercel está no ar."))
    elif n_pc and n_ar < n_pc:
        itens.append(_item("site", "Site no ar", "aviso", f"{no_ar}, mas o PC tem a v{n_pc}", "Rode o Atalhos\\publicar_site.bat."))
    else:
        itens.append(_item("site", "Site no ar", "ok", f"{no_ar} · respondeu em {ms} ms"))
    return itens


def _ler_json_texto(t):
    try:
        return json.loads(t)
    except ValueError:
        return {}


# ----------------------------------------------------------------------------
# Para o site e para a tela
# ----------------------------------------------------------------------------

def para_o_site(cfg=None):
    """O que vai no estado do Sync: as verificações leves de agora e o último teste de rede (do .bat)."""
    return {"t": _agora().isoformat(timespec="seconds"), "itens": leves(cfg), "rede": _ler(ARQ_REDE, None)}


def texto(itens, quando):
    linhas = [f"Diagnóstico do PC · ValReport · {quando}", ""]
    for x in itens:
        linhas.append(f"{MARCA.get(x['estado'], '[ - ]')} {x['nome']}: {x['detalhe']}")
        if x.get("dica"):
            linhas.append(f"        -> {x['dica']}")
    erros = sum(x["estado"] == "erro" for x in itens)
    avisos = sum(x["estado"] == "aviso" for x in itens)
    linhas += ["", "Tudo certo!" if not erros and not avisos else f"{erros} problema(s) e {avisos} aviso(s)."]
    return "\n".join(linhas)


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import gerar_report as gr
    cfg = gr.ler_json(PASTA / "config.json", {}) or {}
    try:
        cfg = gr.config_padrao(cfg)
        import elenco_site
        cfg = elenco_site.aplicar(cfg, avisar=False)
    except Exception:  # noqa: BLE001
        pass
    print("Conferindo o PC (leva uns segundos)...\n")
    quando = _agora().isoformat(timespec="seconds")
    itens_rede = rede(cfg)
    itens = leves(cfg) + itens_rede
    t = texto(itens, quando[:16].replace("T", " "))
    print(t)
    try:
        DADOS.mkdir(parents=True, exist_ok=True)
        ARQ_TXT.write_text(t + "\n", encoding="utf-8")
        ARQ_REDE.parent.mkdir(parents=True, exist_ok=True)
        ARQ_REDE.write_text(json.dumps({"t": quando, "itens": itens_rede}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"\nSalvo em dados\\diagnostico.txt.")
    except OSError as e:
        print(f"\nNão consegui salvar o dados\\diagnostico.txt ({e}).")
    try:   # manda para o site (página Sync e Diagnóstico do Painel)
        import sync
        s = sync.Sessao(os.environ.get("HENRIKDEV_API_KEY", ""), cfg)
        if s.ativo:
            s.rpc("pc_sync_estado", {"p_slug": s.slug, "p_estado": sync.diagnosticar(cfg), "p_versao": sync.VERSAO})
            print("Enviado ao site (Painel > Diagnóstico).")
    except urllib.error.HTTPError as e:
        print("O Sync ainda não está ligado no Supabase; o resultado ficou só aqui." if e.code == 404 else f"Não enviado ao site ({e}).")
    except Exception as e:  # noqa: BLE001
        print(f"Não enviado ao site ({e}).")


if __name__ == "__main__":
    main()
