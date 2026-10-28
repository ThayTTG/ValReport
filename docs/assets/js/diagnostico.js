// Diagnóstico (Painel da administradora): o que está acontecendo neste navegador (versão do site e do app, sessão,
// dados, conexões, erros) e no PC que coleta as partidas (checklist que o PC manda a cada coleta).
// O relatório copiado não leva chaves, tokens nem e-mails.

import { esc, icone, dataHora, relativo } from "./util.js";
import { rpc, funcao } from "./nuvem.js";
import { B } from "./dados.js";
import { EQUIPE_PADRAO } from "./config.js";
import { errosDaSessao, limparErros } from "./registro.js";
import { nomeCargo } from "./conta.js";

const SELO = { ok: ["ok", "vitoria"], aviso: ["atenção", "alerta"], erro: ["problema", "derrota"], info: ["info", ""] };
const numVersao = (v) => Number(/valreport-v(\d+)/.exec(v || "")?.[1] || 0) || null;

async function versaoNoAr() {
  try {
    const t = await (await fetch(`sw.js?agora=${Date.now()}`, { cache: "no-store" })).text();
    return /VERSAO\s*=\s*"(valreport-v\d+)"/.exec(t)?.[1] || null;
  } catch (e) { return null; }
}
async function versaoInstalada() {
  try { return (await caches.keys()).map((k) => /^(valreport-v\d+)-site$/.exec(k)?.[1]).find(Boolean) || null; } catch (e) { return null; }
}

async function medir(nome, fn) {
  const t0 = performance.now();
  try {
    const det = await fn();
    return { nome, ok: true, ms: Math.round(performance.now() - t0), det };
  } catch (e) { return { nome, ok: false, ms: Math.round(performance.now() - t0), det: String(e?.message || e).slice(0, 120) }; }
}
function conexoes() {
  return Promise.all([
    medir("Banco de dados (Supabase)", async () => { await rpc("minha_conta"); return "login e leitura ok"; }),
    medir("Função riot (Riot ID e Premier)", async () => {
      try { await funcao("riot", { acao: "diagnostico" }); } catch (e) {
        if (e?.codigo === "acao") return "no ar";   // ela respondeu "ação desconhecida": está funcionando
        throw e;
      }
      return "no ar";
    }),
    medir("valorant-api.com (imagens e mapas)", async () => {
      const r = await fetch("https://valorant-api.com/v1/version", { cache: "no-store" });
      if (!r.ok) throw new Error(`respondeu ${r.status}`);
      return `jogo ${(await r.json())?.data?.riotClientVersion?.split("-")?.[1] || "?"}`;
    }),
  ]);
}

function navegador() {
  const ua = navigator.userAgent;
  const nome = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "outro";
  const ver = (ua.match(/(?:Edg|OPR|Firefox|Chrome|Version)\/(\d+)/) || [])[1] || "";
  const so = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "?";
  const app = matchMedia("(display-mode: standalone)").matches || navigator.standalone ? "app instalado" : "no navegador";
  return { texto: `${nome} ${ver} · ${so} · ${app}`, tela: `${innerWidth}×${innerHeight} (×${devicePixelRatio})`, online: navigator.onLine };
}

function linha(nome, valor, estado = "info", dica = "") {
  const [t, c] = SELO[estado] || SELO.info;
  return `<li class="sync-item diag-item"><span class="selo ${c ? `selo--${c}` : ""}">${esc(t)}</span>
      <div class="sync-item__texto"><strong>${esc(nome)}</strong><small class="suave">${esc(valor)}</small>${dica ? `<span class="sync-resultado">${esc(dica)}</span>` : ""}</div></li>`;
}
const bloco = (titulo, ic, itens, extra = "") => `<section class="cartao sync-bloco"><div class="cartao__titulo"><h3>${icone(ic)} ${esc(titulo)}</h3>${extra}</div>
    <ul class="sync-lista">${itens.join("")}</ul></section>`;

function relatorio(c) {
  const L = [`Diagnóstico do ValReport · ${new Date().toLocaleString("pt-BR")}`, "",
    `Site: no ar ${c.noAr || "?"} · neste navegador ${c.instalada || "sem cache"}`,
    `Navegador: ${c.nav.texto} · tela ${c.nav.tela} · ${c.nav.online ? "online" : "OFFLINE"}`,
    `Sessão: ${B.conta?.perfil?.apelido || "?"} · ${B.conta?.admin ? "administradora · " : ""}${B.equipeAtual?.nome || "sem equipe"} (${B.equipeAtual?.cargo || "-"})`,
    `Dados: gerados ${B.meta?.gerado_em || "?"} · ${B.partidas?.length || 0} partidas · ${B.equipe?.length || 0} jogadores`, "", "Conexões:"];
  for (const x of c.con) L.push(`  ${x.ok ? "ok " : "ERRO"} ${x.nome}: ${x.det} (${x.ms} ms)`);
  L.push("", `Erros desta sessão: ${c.erros.length || "nenhum"}`);
  for (const e of c.erros.slice(-10)) L.push(`  ${e.t.slice(11, 19)} ${e.tipo}: ${e.msg}${e.onde ? ` (${e.onde})` : ""} [${e.rota}]`);
  const itens = [...(c.pc?.itens || []), ...(c.pc?.rede?.itens || [])];
  if (itens.length) {
    L.push("", `PC (${c.pc.t || "?"}):`);
    for (const x of itens) L.push(`  ${({ ok: "ok ", aviso: "!  ", erro: "ERRO", info: "-  " })[x.estado] || "-  "} ${x.nome}: ${x.detalhe}`);
  }
  return L.join("\n").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "(e-mail)");
}

async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch (e) {
    const ta = Object.assign(document.createElement("textarea"), { value: texto });
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

export async function viewDiagnostico() {
  if (!B.conta?.admin) return { titulo: "Diagnóstico", html: `<div class="vazio"><strong>Somente a administradora acessa o Diagnóstico.</strong></div>` };
  const [noAr, instalada, con, painel] = await Promise.all([versaoNoAr(), versaoInstalada(), conexoes(),
    rpc("admin_sync_painel", { p_slug: EQUIPE_PADRAO }).catch((e) => ({ erro: e }))]);
  const nav = navegador();
  const erros = errosDaSessao();
  const pc = painel?.estado?.pc || null, semSync = Boolean(painel?.erro);
  const c = { noAr, instalada, con, nav, erros, pc };

  const nAr = numVersao(noAr), nCache = numVersao(instalada);
  const atrasado = nAr && nCache && nCache < nAr;
  const exp = (() => { try { return JSON.parse(localStorage.getItem("valreport.sessao"))?.expires_at; } catch (e) { return null; } })();
  const quota = await (navigator.storage?.estimate?.().catch(() => null) ?? null);

  const site = [
    linha("Site no ar", noAr || "não consegui ler", noAr ? "ok" : "aviso"),
    linha("Neste navegador", instalada ? `${instalada}${atrasado ? " (versão antiga guardada)" : ""}` : "sem cópia guardada (normal fora do app)", atrasado ? "aviso" : "ok",
      atrasado ? "Use “Forçar atualização” para trocar pela versão nova." : ""),
    linha("Navegador", `${nav.texto} · tela ${nav.tela}`, nav.online ? "info" : "aviso", nav.online ? "" : "Sem internet agora: o site mostra só o que já tinha guardado."),
    quota ? linha("Espaço usado pelo site", `${(quota.usage / 1048576).toFixed(1)} MB`, "info") : "",
  ];
  const sessao = [
    linha("Conta", `${B.conta?.perfil?.apelido || "?"}${B.conta?.admin ? " · administradora" : ""}`, "ok"),
    linha("Equipe", B.equipeAtual ? `${B.equipeAtual.nome} · ${nomeCargo(B.equipeAtual.cargo)}` : "nenhuma escolhida", B.equipeAtual ? "ok" : "aviso"),
    linha("Login", exp ? `renova sozinho · vale até ${dataHora(new Date(exp * 1000).toISOString())}` : "?", "info"),
    linha("Dados da equipe", B.meta ? `gerados ${relativo(B.meta.gerado_em)} · ${B.partidas.length} partidas · ${B.equipe.length} jogadores` : "não carregados",
      B.meta ? "ok" : "aviso"),
  ];
  const conexoesHtml = con.map((x) => linha(x.nome, `${x.det} · ${x.ms} ms`, x.ok ? (x.ms > 3000 ? "aviso" : "ok") : "erro", x.ok && x.ms > 3000 ? "Respondeu, mas devagar." : ""));
  const errosHtml = erros.length ? erros.slice().reverse().map((e) => `<li class="sync-item sync-item--erro"><div class="sync-item__texto">
      <small class="suave">${esc(dataHora(e.t))} · ${esc(e.tipo)}${e.rota ? ` · ${esc(e.rota)}` : ""}</small>
      <span class="sync-resultado">${esc(e.msg)}${e.onde ? ` (${esc(e.onde)})` : ""}</span></div></li>`) : [`<li class="sync-item"><small class="suave">Nenhum erro nesta sessão. 🎉</small></li>`];
  const pcItens = [...(pc?.itens || []), ...(pc?.rede?.itens || [])].map((x) => linha(x.nome, x.detalhe, x.estado, x.dica));
  const pcHtml = semSync ? [`<li class="sync-item"><small class="suave">O checklist do PC aparece aqui depois que o Sync estiver ligado no banco (o <code>supabase\\sync.sql</code>).</small></li>`]
    : !pc ? [`<li class="sync-item"><small class="suave">O PC ainda não mandou o checklist. Ele manda a cada coleta de 20 minutos; para o teste completo (com internet), rode o <code>Atalhos\\diagnostico.bat</code>.</small></li>`]
    : pcItens;
  const problemasPc = [...(pc?.itens || []), ...(pc?.rede?.itens || [])].filter((x) => x.estado === "erro" || x.estado === "aviso").length;

  return {
    titulo: "Diagnóstico",
    html: `<section class="secao sync diag">
      <a class="voltar limpar pequeno" href="#/painel">${icone("voltar")} Painel da administradora</a>
      <div class="sync-topo"><div><h1>Diagnóstico</h1>
        <p class="suave">O que está acontecendo neste navegador e no PC que coleta as partidas. Para os dados (partidas, elo, cards), veja o <a href="#/painel/sync">Sync</a>.</p></div>
        <div class="sync-botoes">
          <button class="botao-primario" type="button" data-diag="copiar">${icone("nota")} Copiar relatório</button>
          <button class="botao-secundario" type="button" data-diag="atualizar">${icone("atualizar")} Forçar atualização</button>
          <button class="botao-secundario" type="button" data-diag="testar">${icone("relogio")} Testar de novo</button></div></div>
      <p class="form-msg sync-msg" role="status" hidden></p>
      <div class="sync-blocos">
        ${bloco("Site e navegador", "inicio", site.filter(Boolean))}
        ${bloco("Sessão e dados", "equipe", sessao)}
        ${bloco("Conexões", "raio", conexoesHtml)}
        ${bloco("Erros desta sessão", "info", errosHtml, erros.length ? `<button class="limpar pequeno" type="button" data-diag="limpar">Limpar</button>` : "")}
      </div>
      <div class="secao">${bloco("PC da coleta", "escudo", pcHtml,
        pc?.t ? `<span class="suave pequeno">${problemasPc ? `${problemasPc} ponto(s) para olhar · ` : ""}${esc(relativo(pc.t))}${pc.rede?.t ? ` · teste completo ${esc(relativo(pc.rede.t))}` : ""}</span>` : "")}</div>
      <p class="suave pequeno">O relatório copiado não leva chaves, tokens nem e-mails: dá para colar no Discord ou mandar para o Claude.</p>
    </section>`,
    depois: (el) => {
      const raiz = el.querySelector(".diag"), msg = el.querySelector(".sync-msg");
      const aviso = (t, erro = false) => { msg.textContent = t; msg.className = `form-msg sync-msg aviso${erro ? " aviso--erro" : ""}`; msg.hidden = !t; };
      const redesenhar = async () => { const v = await viewDiagnostico(); el.innerHTML = v.html; v.depois?.(el); };
      raiz.addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-diag]");
        if (!b) return;
        const acao = b.dataset.diag;
        if (acao === "copiar") { aviso(await copiar(relatorio(c)) ? "Relatório copiado. É só colar onde quiser." : "Não consegui copiar; tente de novo.", false); return; }
        if (acao === "limpar") { limparErros(); await redesenhar(); return; }
        if (acao === "testar") { b.disabled = true; await redesenhar(); return; }
        if (acao === "atualizar") {
          if (!confirm("Forçar a atualização? O site recarrega com a versão mais nova (você continua logada).")) return;
          b.disabled = true;
          try {
            for (const r of (await navigator.serviceWorker?.getRegistrations?.()) || []) await r.unregister();
            for (const k of await caches.keys()) if (k.startsWith("valreport")) await caches.delete(k);
          } catch (e) { /* sem service worker ou cache bloqueado: só recarrega */ }
          location.reload();
        }
      });
    },
  };
}
