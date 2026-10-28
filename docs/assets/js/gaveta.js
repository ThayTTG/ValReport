// Menu lateral do celular: o topo mostra só o logo e a foto; o resto (navegação, busca, atualizar, tema...) fica aqui

import { esc, icone, imagem, imgCard } from "./util.js";
import { B } from "./dados.js";
import { usuario, sair } from "./nuvem.js";
import { podeVerTaticas } from "./taticas.js";

export const CELULAR = matchMedia("(max-width: 700px)");
let obterTela = () => "app";
let gaveta = null, ultimoFoco = null;

function item(ic, texto, { href, acao, extra = "", atual = false } = {}) {
  const corpo = `${icone(ic)}<span>${texto}</span>${extra}`;
  return href
    ? `<a class="gaveta__item${atual ? " ativo" : ""}" href="${esc(href)}"${atual ? ' aria-current="page"' : ""}${href.startsWith("http") ? ' rel="noopener"' : ""}>${corpo}</a>`
    : `<button class="gaveta__item" type="button" data-gaveta="${esc(acao)}">${corpo}</button>`;
}

function montar() {
  const tela = obterTela(), c = B.conta || {}, p = c.perfil || {}, u = usuario() || {};
  const rota = location.hash.replace(/^#/, "") || "/";
  const em = (prefixo) => (prefixo === "/" ? rota === "/" || rota.startsWith("/?") : rota.startsWith(prefixo));
  const nome = p.apelido || u.user_metadata?.full_name || u.email || "Sua conta";
  const pend = (B.pendencias?.equipes_pendentes || 0) + (B.pendencias?.pedidos_riot || 0);
  const temTimes = (c.equipes || []).length > 1 && ["app", "sem-dados"].includes(tela);
  const escuro = (document.documentElement.dataset.tema || (matchMedia("(prefers-color-scheme: light)").matches ? "claro" : "escuro")) === "escuro";
  const instalavel = !document.getElementById("instalar")?.hidden;
  const secoes = [];
  if (tela === "app") {
    secoes.push([
      item("inicio", "Início", { href: "#/", atual: em("/") }),
      item("equipe", "Equipe", { href: "#/equipe", atual: em("/equipe") && !em("/equipe/taticas") }),
      podeVerTaticas() ? item("mapa", "Táticas", { href: "#/equipe/taticas", atual: em("/equipe/taticas") || em("/tatica/") }) : "",
      B.equipeAtual?.slug ? item("escudo", "Membros e convites", { href: `#/time/${B.equipeAtual.slug}`, atual: em(`/time/${B.equipeAtual.slug}`) }) : "",
      item("info", "Sobre e créditos", { href: "#/sobre", atual: em("/sobre") }),
    ].join(""));
  }
  if (tela === "sem-dados" && podeVerTaticas()) {
    secoes.push([
      item("mapa", "Táticas", { href: "#/equipe/taticas", atual: em("/equipe/taticas") || em("/tatica/") }),
      B.equipeAtual?.slug ? item("escudo", "Membros e convites", { href: `#/time/${B.equipeAtual.slug}`, atual: em(`/time/${B.equipeAtual.slug}`) }) : "",
    ].join(""));
  }
  if (p.apelido) {
    secoes.push([
      item("equipe", "Minhas equipes", { href: "#/equipes", atual: em("/equipes") }),
      item("busca", "Procurar jogador", { acao: "buscar" }),
      c.admin ? item("escudo", "Painel da administradora", { href: "#/painel", atual: em("/painel") && !em("/painel/sync") && !em("/painel/diagnostico"), extra: B.pendencias?.equipes_pendentes ? `<b class="gaveta__selo">${B.pendencias.equipes_pendentes}</b>` : "" }) : "",
      c.admin ? item("atualizar", "Sync dos dados", { href: "#/painel/sync", atual: em("/painel/sync") }) : "",
      c.admin ? item("info", "Diagnóstico", { href: "#/painel/diagnostico", atual: em("/painel/diagnostico") }) : "",
    ].join(""));
  }
  secoes.push([
    tela === "app" ? item("atualizar", "Procurar partidas novas", { acao: "atualizar" }) : "",
    instalavel ? item("instalar", "Instalar o app", { acao: "instalar" }) : "",
    item(escuro ? "sol" : "lua", escuro ? "Tema claro" : "Tema escuro", { acao: "tema" }),
    item("nokylabs", "Voltar para a NokyLabs", { href: "https://thayttg.github.io/nokylabs/" }),
  ].join(""));
  secoes.push([
    p.apelido ? item("nota", "Conta e privacidade", { href: "#/conta", atual: em("/conta") }) : "",
    item("voltar", "Sair", { acao: "sair" }),
  ].join(""));
  return `<div class="gaveta__fundo" data-gaveta="fechar"></div>
    <div class="gaveta__painel" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="gaveta__topo">
        <a class="gaveta__perfil" href="#/perfil"${p.cor && /^#[0-9a-f]{6}$/i.test(p.cor) ? ` style="--cor-perfil:${p.cor}"` : ""}>
          <span class="gaveta__avatar">${imagem(imgCard(p.riot_card), "", "", nome)}</span>
          <span class="gaveta__nome"><strong>${esc(nome)}</strong><small>${p.riot_id ? esc(p.riot_id) : "Meu perfil"}${pend ? ` · ${pend} pendência${pend === 1 ? "" : "s"}` : ""}</small></span></a>
        <button class="botao-icone" type="button" data-gaveta="fechar" aria-label="Fechar o menu">${icone("voltar")}</button>
      </div>
      ${temTimes ? `<label class="gaveta__equipe"><span>Equipe</span><select data-gaveta-equipe>${c.equipes.map((e) => `<option value="${esc(e.slug)}"${e.slug === B.equipeAtual?.slug ? " selected" : ""}>${esc(e.nome)}</option>`).join("")}</select></label>` : ""}
      ${secoes.filter(Boolean).map((s) => `<div class="gaveta__secao">${s}</div>`).join("")}
    </div>`;
}

export function abrirGaveta() {
  if (!gaveta) {
    gaveta = document.createElement("div");
    gaveta.className = "gaveta";
    gaveta.id = "gaveta";
    document.body.append(gaveta);
    gaveta.addEventListener("click", aoClicar);
    gaveta.addEventListener("change", (ev) => {
      const sel = ev.target.closest("[data-gaveta-equipe]");
      if (!sel) return;
      try { localStorage.setItem("valreport.equipe", sel.value); } catch (e) { /* sem armazenamento */ }
      location.hash = "#/";
      location.reload();
    });
  }
  ultimoFoco = document.activeElement;
  gaveta.innerHTML = montar();
  gaveta.hidden = false;
  document.body.classList.add("gaveta-aberta");
  requestAnimationFrame(() => {
    gaveta.classList.add("aberta");
    gaveta.querySelector(".gaveta__perfil")?.focus();
  });
  document.getElementById("conta-link")?.setAttribute("aria-expanded", "true");
}

export function fecharGaveta() {
  if (!gaveta || gaveta.hidden) return;
  gaveta.classList.remove("aberta");
  document.body.classList.remove("gaveta-aberta");
  document.getElementById("conta-link")?.setAttribute("aria-expanded", "false");
  setTimeout(() => { if (!gaveta.classList.contains("aberta")) gaveta.hidden = true; }, 220);
  ultimoFoco?.focus?.({ preventScroll: true });
}

async function aoClicar(ev) {
  const alvo = ev.target.closest("[data-gaveta], a");
  if (!alvo) return;
  const acao = alvo.dataset.gaveta;
  if (alvo.tagName === "A" || acao === "fechar") { fecharGaveta(); return; }
  fecharGaveta();
  // espera o clique atual terminar antes de acionar o botão escondido do topo
  const clicar = (id) => setTimeout(() => document.getElementById(id)?.click(), 0);
  if (acao === "buscar") clicar("buscar-topo");
  else if (acao === "atualizar") clicar("atualizar");
  else if (acao === "instalar") clicar("instalar");
  else if (acao === "tema") clicar("alternar-tema");
  else if (acao === "sair") { await sair(); location.hash = "#/"; location.reload(); }
}

/** Liga o botão da foto (no celular ele abre o menu em vez de ir direto ao perfil) */
export function ligarGaveta(tela) {
  obterTela = tela;
  const chip = document.getElementById("conta-link");
  chip?.setAttribute("aria-haspopup", "dialog");
  chip?.addEventListener("click", (ev) => {
    if (!CELULAR.matches) return;
    ev.preventDefault();
    abrirGaveta();
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") fecharGaveta(); });
  window.addEventListener("hashchange", fecharGaveta);
  CELULAR.addEventListener?.("change", () => { if (!CELULAR.matches) fecharGaveta(); });
}
