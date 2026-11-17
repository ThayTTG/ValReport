// Navegação (v32): sidebar no computador (recolhível, só ícones) e barra de abas embaixo no celular.
// O topo fica só com a busca (Ctrl+K) e o avatar, que abre o menu da conta (atualizar, instalar, tema, sair...).

import { B, FILTROS_PADRAO } from "./dados.js";
import { esc, icone, imagem, imgCard, imgAgente, nomeTier } from "./util.js";
import { temCoroa } from "./coroa.js";
import { principaisVisiveis, paiDe, abasEquipe } from "./equipe.js";

export const COMPUTADOR = matchMedia("(min-width: 1024px)");
const K_RECOLHIDA = "valreport.lateral";
const ESTRATEGIA = new Set(["mapas", "taticas", "agenda"]);
let obterTela = () => "app";
let lateral = null, barra = null, folha = null;

const lerRecolhida = () => { try { return localStorage.getItem(K_RECOLHIDA) === "recolhida"; } catch (e) { return false; } };

/** Onde a pessoa está: { pagina: "inicio" | "equipe" | "jogador" | "sobre" | ..., pai, slug } */
function ondeEstou() {
  const [caminho] = (location.hash.replace(/^#/, "") || "/").split("?");
  const partes = caminho.split("/").filter(Boolean);
  if (!partes.length) return { pagina: "inicio" };
  if (partes[0] === "equipe") return { pagina: "equipe", pai: paiDe(partes[1] || "visao") };
  if (partes[0] === "tatica") return { pagina: "equipe", pai: "taticas" };
  if (partes[0] === "j") return { pagina: "jogador", slug: decodeURIComponent(partes[1] || "") };
  if (partes[0] === "time") return { pagina: "time" };
  return { pagina: partes[0] };
}
/** Os filtros da página atual (fila, período, mapa...) seguem junto quando se troca de aba da equipe */
function filtrosAtuais() {
  const q = new URLSearchParams((location.hash.split("?")[1]) || "");
  const out = new URLSearchParams();
  for (const k of Object.keys(FILTROS_PADRAO)) if (q.has(k)) out.set(k, q.get(k));
  const s = out.toString();
  return s ? `?${s}` : "";
}
/** As seções da equipe para esta tela: [[pai, nome, ícone, destino]] (sem dados: só o planejamento e as táticas) */
function secoesEquipe(tela) {
  if (!B.equipeAtual) return [];
  if (tela === "sem-dados") return principaisVisiveis(abasEquipe().map(([a]) => a).filter((a) => ["taticas", "agenda", "mappool", "comps", "calls"].includes(a)));
  return principaisVisiveis();
}

function item(href, ic, nome, ativo, extra = "") {
  return `<a class="lateral__item${ativo ? " ativo" : ""}" href="${esc(href)}" title="${esc(nome)}"${ativo ? ' aria-current="page"' : ""}>${icone(ic)}<span>${esc(nome)}</span>${extra}</a>`;
}
function fotoJogador(e) {
  return `<span class="lateral__foto">${imagem(imgCard(e.card) || imgAgente(e.agente), "", "", e.apelido)}${temCoroa(e.slug) ? `<span class="lateral__coroa" title="MVP da semana">${icone("coroa")}</span>` : ""}</span>`;
}
const eloCurto = (e) => (e.tn && e.tn !== "Oculto" && e.tn !== "Unrated" ? nomeTier(e.tn) : "");

function htmlLateral(tela) {
  const aqui = ondeEstou(), q = filtrosAtuais();
  const secoes = secoesEquipe(tela);
  const equipe = secoes.filter(([p]) => !ESTRATEGIA.has(p)), estrategia = secoes.filter(([p]) => ESTRATEGIA.has(p));
  const link = (p, nome, ic, destino) => item(`#/equipe/${destino}${ESTRATEGIA.has(p) ? "" : q}`, ic, nome, aqui.pagina === "equipe" && aqui.pai === p);
  const jogadores = tela === "app" ? (B.equipe || []) : [];
  const marca = document.querySelector(".topo .marca")?.innerHTML || "";
  return `<div class="lateral__topo">
      <a class="marca lateral__marca" href="#/" aria-label="ValReport, página inicial">${marca}</a>
      <button class="botao-icone lateral__recolher" type="button" data-lateral="recolher" aria-label="Recolher o menu" title="Recolher o menu">${icone("lateral")}</button>
    </div>
    ${B.equipeAtual ? `<a class="lateral__equipe" href="#/time/${esc(B.equipeAtual.slug || "")}" title="Membros e convites · ${esc(B.equipeAtual.nome || "")}">
      <span class="lateral__equipe-ic">${esc((B.equipeAtual.nome || "?").trim()[0] || "?")}</span><span><small>Equipe</small><strong>${esc(B.equipeAtual.nome || "")}</strong></span></a>` : ""}
    <nav class="lateral__nav" aria-label="Principal">
      ${item("#/", "inicio", "Início", aqui.pagina === "inicio")}
      ${equipe.length ? `<p class="lateral__titulo">Equipe</p>${equipe.map(([p, n, ic, d]) => link(p, n, ic, d)).join("")}` : ""}
      ${estrategia.length ? `<p class="lateral__titulo">Estratégia</p>${estrategia.map(([p, n, ic, d]) => link(p, n, ic, d)).join("")}` : ""}
      ${jogadores.length ? `<p class="lateral__titulo">Jogadores</p>${jogadores.map((e) => {
        const ativo = aqui.pagina === "jogador" && aqui.slug === e.slug, elo = eloCurto(e);
        return `<a class="lateral__item lateral__jogador${ativo ? " ativo" : ""}" href="#/j/${esc(e.slug)}" title="${esc(e.apelido)}${elo ? ` · ${esc(elo)}` : ""}"${ativo ? ' aria-current="page"' : ""}>
          ${fotoJogador(e)}<span><strong>${esc(e.apelido)}</strong>${elo || e.funcao ? `<small>${esc([e.funcao, elo].filter(Boolean).join(" · "))}</small>` : ""}</span></a>`;
      }).join("")}
        ${B.equipeAtual?.slug ? item(`#/time/${B.equipeAtual.slug}`, "mais", "Integrantes", aqui.pagina === "time") : ""}` : ""}
    </nav>
    <div class="lateral__rodape">
      ${item("#/sobre", "info", "Sobre e metodologia", aqui.pagina === "sobre")}
      <a class="lateral__item" href="https://thayttg.github.io/nokylabs/" rel="noopener" title="Voltar para a NokyLabs">${icone("nokylabs")}<span>NokyLabs</span></a>
    </div>`;
}

function htmlBarra(tela) {
  const aqui = ondeEstou(), secoes = secoesEquipe(tela);
  const destino = (p) => secoes.find(([x]) => x === p)?.[3];
  const naEquipe = aqui.pagina === "equipe" && !["mapas", "agenda", "taticas"].includes(aqui.pai);
  const itens = [
    ["#/", "inicio", "Início", aqui.pagina === "inicio"],
    tela === "app" ? ["#/equipe/visao", "equipe", "Equipe", naEquipe || aqui.pagina === "time"] : null,
    destino("mapas") ? [`#/equipe/${destino("mapas")}`, "mapa", "Mapas", aqui.pagina === "equipe" && aqui.pai === "mapas"] : null,
    destino("agenda") ? [`#/equipe/${destino("agenda")}`, "calendario", "Agenda", aqui.pagina === "equipe" && aqui.pai === "agenda"]
      : destino("taticas") ? [`#/equipe/${destino("taticas")}`, "slides", "Táticas", aqui.pagina === "equipe" && aqui.pai === "taticas"] : null,
  ].filter(Boolean);
  const jogadores = tela === "app" && (B.equipe || []).length;
  return `${itens.map(([href, ic, nome, ativo]) => `<a class="barra-baixo__item${ativo ? " ativo" : ""}" href="${href}"${ativo ? ' aria-current="page"' : ""}>${icone(ic)}<span>${nome}</span></a>`).join("")}
    ${jogadores ? `<button class="barra-baixo__item${aqui.pagina === "jogador" ? " ativo" : ""}" type="button" data-barra="jogadores" aria-haspopup="dialog">${icone("equipe")}<span>Jogadores</span></button>` : ""}`;
}

// ---------- Folha "Jogadores" (celular) ----------
function abrirFolha() {
  if (folha) return;
  const aqui = ondeEstou();
  folha = document.createElement("dialog");
  folha.className = "folha";
  folha.setAttribute("aria-label", "Jogadores");
  folha.innerHTML = `<div class="folha__caixa"><span class="folha__alca" aria-hidden="true"></span>
      <div class="folha__topo"><h2>Jogadores</h2><button class="botao-icone" type="button" data-folha="fechar" aria-label="Fechar">${icone("fechar")}</button></div>
      <div class="folha__lista">${(B.equipe || []).map((e) => {
        const elo = eloCurto(e);
        return `<a class="folha__jogador${aqui.slug === e.slug ? " ativo" : ""}" href="#/j/${esc(e.slug)}">${fotoJogador(e)}
          <span><strong>${esc(e.apelido)}</strong><small>${esc([e.funcao, e.agente].filter(Boolean).join(" · ") || "—")}</small></span>${elo ? `<span class="folha__elo">${esc(elo)}</span>` : ""}</a>`;
      }).join("")}
      ${B.equipeAtual?.slug ? `<a class="folha__jogador folha__jogador--mais" href="#/time/${esc(B.equipeAtual.slug)}"><span class="lateral__foto">${icone("mais")}</span><span><strong>Integrantes e convites</strong><small>treinadores, convidados e convites</small></span></a>` : ""}</div></div>`;
  document.body.appendChild(folha);
  const fechar = () => { if (!folha) return; folha.close(); folha.remove(); folha = null; };
  folha.addEventListener("click", (ev) => { if (ev.target === folha || ev.target.closest("[data-folha=fechar]") || ev.target.closest("a")) fechar(); });
  folha.addEventListener("cancel", (ev) => { ev.preventDefault(); fechar(); });
  folha.showModal();
}

/** Redesenha a sidebar e a barra (a cada troca de página e quando os dados chegam) */
export function atualizarNavegacao() {
  const tela = obterTela();
  const com = ["app", "sem-dados"].includes(tela) && Boolean(B.conta);
  document.body.classList.toggle("com-nav", com);
  if (!lateral || !barra) return;
  lateral.hidden = !com;
  barra.hidden = !com;
  if (!com) return;
  const rolagem = lateral.querySelector(".lateral__nav")?.scrollTop || 0;
  lateral.innerHTML = htmlLateral(tela);
  const nav = lateral.querySelector(".lateral__nav");
  if (nav) nav.scrollTop = rolagem;
  barra.innerHTML = htmlBarra(tela);
  const recolher = lateral.querySelector("[data-lateral=recolher]");
  const rec = document.body.classList.contains("lateral-recolhida");
  recolher?.setAttribute("aria-label", rec ? "Abrir o menu" : "Recolher o menu");
  if (recolher) recolher.title = rec ? "Abrir o menu" : "Recolher o menu";
}

export function ligarNavegacao(tela) {
  obterTela = tela;
  lateral = document.createElement("aside");
  lateral.className = "lateral";
  lateral.id = "lateral";
  lateral.hidden = true;
  barra = document.createElement("nav");
  barra.className = "barra-baixo";
  barra.id = "barra-baixo";
  barra.setAttribute("aria-label", "Principal");
  barra.hidden = true;
  document.body.prepend(lateral);
  document.body.append(barra);
  document.body.classList.toggle("lateral-recolhida", lerRecolhida());
  lateral.addEventListener("click", (ev) => {
    if (!ev.target.closest("[data-lateral=recolher]")) return;
    const rec = !document.body.classList.contains("lateral-recolhida");
    document.body.classList.toggle("lateral-recolhida", rec);
    try { localStorage.setItem(K_RECOLHIDA, rec ? "recolhida" : "aberta"); } catch (e) { /* sem armazenamento */ }
    atualizarNavegacao();
    window.dispatchEvent(new Event("resize"));   // mapas e gráficos se ajustam à nova largura
  });
  barra.addEventListener("click", (ev) => { if (ev.target.closest("[data-barra=jogadores]")) abrirFolha(); });
  window.addEventListener("hashchange", () => { if (folha) { folha.close(); folha.remove(); folha = null; } });
}

