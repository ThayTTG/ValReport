// Paleta de comandos (v31): Ctrl+K (⌘K no Mac), "/" ou o botão de busca.
// Acha páginas, abas da equipe, jogadores (e as abas de cada um), mapas, partidas recentes e ações,
// e procura qualquer jogador do site por nick#tag (a busca antiga, que fica dentro dela).

import { B } from "./dados.js";
import { rpc } from "./nuvem.js";
import { esc, icone, imagem, imgCard, dataHora } from "./util.js";
import { ABAS_JOGADOR } from "./jogador.js";
import { abasEquipe } from "./equipe.js";

const ICONE_ABA = { visao: "equipe", semana: "relogio", partidas: "nota", formacoes: "rota", sinergia: "rota", comparar: "filtro", mapas: "mapa",
  recordes: "trofeu", taticas: "slides", agenda: "relogio", mappool: "mapa", comps: "alvo", calls: "texto" };

const normalizar = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const ehMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const atalhoPaleta = ehMac ? "⌘K" : "Ctrl K";

/** Tudo o que dá para abrir agora: [{ grupo, rotulo, sub, ic, href | acao, chaves }] */
function itens() {
  const out = [];
  const add = (grupo, rotulo, destino, { sub = "", ic = "seta", chaves = "", img = "", nome = rotulo } = {}) =>
    out.push({ grupo, rotulo, sub, ic, img, nome, chaves: normalizar(`${rotulo} ${sub} ${chaves}`), ...(typeof destino === "function" ? { acao: destino } : { href: destino }) });

  add("Páginas", "Início", "#/", { ic: "inicio", chaves: "home hoje dia" });
  const temEquipe = Boolean(B.equipeAtual);
  if (temEquipe) {
    for (const [id, nome] of abasEquipe()) add("Equipe", nome, `#/equipe/${id}`, { ic: ICONE_ABA[id] || "equipe", chaves: `${id} equipe` });
    if (B.equipeAtual.slug) add("Equipe", "Membros e convites", `#/time/${encodeURIComponent(B.equipeAtual.slug)}`, { ic: "equipe", chaves: "convidar elenco integrantes" });
  }
  if (B.conta) {
    add("Páginas", "Meu perfil", "#/perfil", { ic: "lapis", chaves: "conta elo riot foto" });
    add("Páginas", "Minhas equipes", "#/equipes", { ic: "equipe", chaves: "trocar equipe" });
  }
  add("Páginas", "Sobre e metodologia", "#/sobre", { ic: "info", chaves: "creditos indice como funciona" });

  for (const e of B.equipe || []) {
    add("Jogadores", e.apelido, `#/j/${encodeURIComponent(e.slug)}`, { img: imgCard(e.card), nome: e.apelido, sub: [e.funcao, e.agente].filter(Boolean).join(" · "), chaves: e.slug });
    for (const [id, nome] of ABAS_JOGADOR.slice(1)) add("Abas dos jogadores", `${e.apelido} · ${nome}`, `#/j/${encodeURIComponent(e.slug)}/${id}`, { img: imgCard(e.card), nome: e.apelido, chaves: e.slug });
  }

  const mapas = [...new Set((B.partidas || []).map((p) => p.mapa).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  for (const m of mapas) {
    add("Mapas", m, `#/equipe/mapas?mapa=${encodeURIComponent(m)}`, { ic: "mapa", sub: "desempenho da equipe" });
    if (abasEquipe().some(([a]) => a === "comps")) add("Mapas", `${m} · comp e defaults`, `#/equipe/comps?mapa=${encodeURIComponent(m)}`, { ic: "alvo", chaves: "comp defaults posicoes" });
  }

  for (const p of (B.partidas || []).slice(0, 25)) {
    const nos = p.placar?.[p.nosso], eles = Object.entries(p.placar || {}).find(([t]) => t !== p.nosso)?.[1];
    const quem = Object.keys(p.m || {}).map((s) => B.porSlug?.get(s)?.apelido || s).join(", ");
    add("Partidas recentes", `${p.mapa} ${nos ?? "?"}–${eles ?? "?"}`, `#/p/${encodeURIComponent(p.id)}`, { ic: "nota", sub: `${dataHora(p.t)}${quem ? ` · ${quem}` : ""}`, chaves: "partida" });
  }

  const clicar = (id) => () => document.getElementById(id)?.click();
  if (document.getElementById("atualizar")) add("Ações", "Atualizar dados", clicar("atualizar"), { ic: "atualizar", chaves: "recarregar coleta stats atributos" });
  if (document.getElementById("alternar-tema")) add("Ações", "Trocar tema (claro/escuro)", clicar("alternar-tema"), { ic: "lua", chaves: "dark light modo" });
  const inst = document.getElementById("instalar");
  if (inst && !inst.hidden) add("Ações", "Instalar o app", clicar("instalar"), { ic: "instalar", chaves: "pwa celular" });
  return out;
}

/** Filtra e ordena: todas as palavras precisam aparecer; começar com o termo vale mais */
function filtrar(lista, termo) {
  const t = normalizar(termo).trim();
  if (!t) {   // sem termo: o essencial (sem as abas de cada jogador e só as 5 partidas mais recentes)
    let partidas = 0;
    return lista.filter((x) => x.grupo !== "Abas dos jogadores" && x.grupo !== "Mapas" && (x.grupo !== "Partidas recentes" || ++partidas <= 5));
  }
  const partes = t.split(/\s+/);
  return lista
    .map((x, i) => {
      if (!partes.every((p) => x.chaves.includes(p))) return null;
      const r = normalizar(x.rotulo);
      const nota = (r === t ? 0 : r.startsWith(t) ? 1 : r.split(/[\s·]+/).some((w) => w.startsWith(partes[0])) ? 2 : 3) * 1000 + i;
      return { x, nota };
    })
    .filter(Boolean)
    .sort((a, b) => a.nota - b.nota)
    .slice(0, 40)
    .map((o) => o.x);
}

let dialogo = null;

export function abrirPaleta(inicial = "") {
  if (dialogo) { dialogo.querySelector("input").focus(); return; }
  const todos = itens();
  const el = document.createElement("dialog");
  el.className = "paleta";
  el.setAttribute("aria-label", "Ir para");
  el.innerHTML = `<div class="paleta__caixa">
      <label class="paleta__campo">${icone("busca")}<input type="text" role="combobox" aria-expanded="true" aria-controls="paleta-lista" aria-autocomplete="list"
        placeholder="Ir para página, jogador, mapa… ou procurar Nome#TAG" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></label>
      <div class="paleta__lista" id="paleta-lista" role="listbox"></div>
      <p class="paleta__rodape"><span><kbd>↑</kbd><kbd>↓</kbd> escolher</span><span><kbd>Enter</kbd> abrir</span><span><kbd>${atalhoPaleta}</kbd> abre de qualquer tela</span></p>
    </div>`;
  document.body.appendChild(el);
  dialogo = el;
  const campo = el.querySelector("input"), lista = el.querySelector(".paleta__lista");
  let atuais = [], sel = 0, espera = null, ultimaBusca = "", remotos = [];

  const fechar = () => { if (!dialogo) return; el.close(); el.remove(); dialogo = null; document.getElementById("buscar-topo")?.setAttribute("aria-expanded", "false"); };
  const abrirItem = (x) => {
    if (!x) return;
    fechar();
    if (x.acao) x.acao();
    else if (x.href && x.href !== location.hash) location.hash = x.href;
  };
  const desenhar = () => {
    const termo = campo.value;
    atuais = [...filtrar(todos, termo), ...remotos];
    sel = Math.min(sel, Math.max(0, atuais.length - 1));
    let grupo = "";
    lista.innerHTML = atuais.length ? atuais.map((x, i) => {
      const cab = x.grupo !== grupo ? `<p class="paleta__grupo">${esc((grupo = x.grupo))}</p>` : "";
      return `${cab}<a class="paleta__item${i === sel ? " ativo" : ""}" role="option" id="paleta-${i}" aria-selected="${i === sel}" data-i="${i}" href="${esc(x.href || "#")}">
        ${x.img !== undefined && x.img !== "" ? imagem(x.img, "", "paleta__foto", x.nome || x.rotulo) : `<span class="paleta__ic">${icone(x.ic || "seta")}</span>`}
        <span class="paleta__texto"><strong>${esc(x.rotulo)}</strong>${x.sub ? `<small>${esc(x.sub)}</small>` : ""}</span></a>`;
    }).join("") : `<p class="paleta__vazio">Nada encontrado. Para achar alguém de fora da equipe, digite o nick#tag.</p>`;
    campo.setAttribute("aria-activedescendant", atuais.length ? `paleta-${sel}` : "");
    lista.querySelector(".ativo")?.scrollIntoView({ block: "nearest" });
  };
  // Jogadores de fora da equipe (perfis verificados), como a busca antiga
  const procurarFora = async () => {
    const termo = campo.value.trim();
    ultimaBusca = termo;
    if (!B.conta || termo.length < 3) { if (remotos.length) { remotos = []; desenhar(); } return; }
    try {
      const r = await rpc("buscar_jogadores", { p_termo: termo });
      if (termo !== ultimaBusca || !dialogo) return;
      const daEquipe = new Set((B.equipe || []).map((e) => normalizar(e.apelido)));
      remotos = (r || []).filter((j) => !(j.mesma_equipe && daEquipe.has(normalizar(j.apelido)))).slice(0, 8).map((j) => ({
        grupo: "Jogadores no ValReport", rotulo: j.riot_id, sub: `${j.apelido}${j.mesma_equipe ? " · da sua equipe" : ""}`,
        img: imgCard(j.riot_card) || null, nome: j.apelido || j.riot_id, href: `#/u/${encodeURIComponent(j.riot_id)}`, chaves: "" }));
      desenhar();
    } catch (e) { /* sem conexão: fica só o que é local */ }
  };

  campo.addEventListener("input", () => { sel = 0; desenhar(); clearTimeout(espera); espera = setTimeout(procurarFora, 250); });
  campo.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || (ev.key === "Tab" && !ev.shiftKey)) { ev.preventDefault(); sel = (sel + 1) % Math.max(1, atuais.length); desenhar(); }
    else if (ev.key === "ArrowUp" || (ev.key === "Tab" && ev.shiftKey)) { ev.preventDefault(); sel = (sel - 1 + atuais.length) % Math.max(1, atuais.length); desenhar(); }
    else if (ev.key === "Enter") { ev.preventDefault(); abrirItem(atuais[sel]); }
  });
  lista.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-i]");
    if (!a) return;
    ev.preventDefault();
    abrirItem(atuais[Number(a.dataset.i)]);
  });
  lista.addEventListener("mousemove", (ev) => {
    const a = ev.target.closest("[data-i]");
    if (a && Number(a.dataset.i) !== sel) { sel = Number(a.dataset.i); lista.querySelectorAll(".paleta__item").forEach((b, i) => { b.classList.toggle("ativo", i === sel); b.setAttribute("aria-selected", String(i === sel)); }); }
  });
  el.addEventListener("cancel", (ev) => { ev.preventDefault(); fechar(); });
  el.addEventListener("click", (ev) => { if (ev.target === el) fechar(); });

  el.showModal();
  document.getElementById("buscar-topo")?.setAttribute("aria-expanded", "true");
  campo.value = inicial;
  desenhar();
  campo.focus();
  if (inicial) procurarFora();
}

/** Liga o atalho e o botão de busca do topo (no lugar da busca antiga) */
export function ligarPaleta() {
  const botao = document.getElementById("buscar-topo");
  if (botao) {
    botao.hidden = false;
    botao.title = `Ir para… (${atalhoPaleta})`;
    botao.setAttribute("aria-label", `Ir para página, jogador ou mapa (${atalhoPaleta})`);
    botao.setAttribute("aria-haspopup", "dialog");
    botao.removeAttribute("aria-controls");
    // no computador, o botão vira um campo "Buscar… Ctrl K"
    if (!botao.querySelector(".buscar__texto")) botao.insertAdjacentHTML("beforeend", `<span class="buscar__texto">Buscar…</span><kbd class="buscar__atalho">${atalhoPaleta}</kbd>`);
    botao.addEventListener("click", () => abrirPaleta());
  }
  document.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.key.toLowerCase() === "k") {
      ev.preventDefault();
      if (dialogo) dialogo.querySelector("input").focus(); else if (!document.querySelector("dialog[open]")) abrirPaleta();
      return;
    }
    // "/" abre fora de campos de texto (como no GitHub e no YouTube)
    const alvo = ev.target, digitando = alvo.closest?.("input, textarea, select, [contenteditable=''], [contenteditable='true']");
    if (ev.key === "/" && !digitando && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !document.querySelector("dialog[open]")) { ev.preventDefault(); abrirPaleta(); }
  });
  window.addEventListener("hashchange", () => { if (dialogo) { dialogo.close(); dialogo.remove(); dialogo = null; } });
}
