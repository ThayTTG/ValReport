// ValReport · NokyLabs — rotas, tema, filtros e eventos

import { esc, imagem, imgCard, imgAgente, definirMeta, dataHora, vazio, larguraGrafico } from "./util.js";
import { B, carregarBase, FILTROS_PADRAO, salvarNota } from "./dados.js";
import { alternarOrdem } from "./componentes.js";
import { viewJogador } from "./jogador.js";
import { viewPartida } from "./partida.js";
import { viewEquipe } from "./equipe.js";
import { viewSobre } from "./sobre.js";
import { animar, trocarTema, ligarBrilho } from "./animar.js";

const main = document.getElementById("conteudo");

// ---------- Tema ----------
function temaAtual() {
  const t = document.documentElement.dataset.tema;
  if (t) return t;
  return matchMedia("(prefers-color-scheme: light)").matches ? "claro" : "escuro";
}
document.getElementById("alternar-tema").addEventListener("click", (ev) => {
  const novo = temaAtual() === "claro" ? "escuro" : "claro";
  trocarTema(ev.currentTarget, async () => {
    document.documentElement.dataset.tema = novo;
    try { localStorage.setItem("valreport.tema", novo); } catch (e) { /* sem armazenamento */ }
    await renderizar(true, "nada");  // redesenha canvas com as cores do tema
  });
});

// ---------- Rotas ----------
function lerRota() {
  const bruto = location.hash.replace(/^#/, "") || "/";
  const [caminho, busca = ""] = bruto.split("?");
  const partes = caminho.split("/").filter(Boolean);
  const q = new URLSearchParams(busca);
  const f = { ...FILTROS_PADRAO };
  for (const k of Object.keys(f)) if (q.has(k)) f[k] = q.get(k);
  return { partes, q, f, caminho };
}
function irPara(q, caminho = lerRota().caminho) {
  const s = q.toString();
  const novo = `#${caminho}${s ? `?${s}` : ""}`;
  if (novo !== location.hash) location.hash = novo;
}

/** [página, aba] da rota, para saber quanto animar */
function chaveRota(partes) {
  if (!partes.length || partes[0] === "equipe") return ["equipe", partes[1] || "visao"];
  if (partes[0] === "j" || partes[0] === "p") return [`${partes[0]}/${partes[1]}`, partes[2] || ""];
  return [partes.join("/"), ""];
}

let ultimoCaminho = null, ultimaPagina = null, renderizando = 0;
async function renderizar(manterRolagem = false, modoForcado = null) {
  const id = ++renderizando;
  const { partes, q, f, caminho } = lerRota();
  const mesmaPagina = caminho === ultimoCaminho;
  const [pagina] = chaveRota(partes);
  const modo = modoForcado || (ultimoCaminho == null ? "pagina" : mesmaPagina ? (manterRolagem ? "nada" : "suave") : pagina === ultimaPagina ? "aba" : "pagina");
  const rolagem = window.scrollY;
  let v;
  try {
    if (!partes.length || partes[0] === "equipe") v = await viewEquipe(partes[1] || "visao", f, q);
    else if (partes[0] === "j") v = await viewJogador(decodeURIComponent(partes[1] || ""), partes[2] || "geral", f, q);
    else if (partes[0] === "p") v = await viewPartida(decodeURIComponent(partes[1] || ""), partes[2] || "placar", q);
    else if (partes[0] === "sobre") v = viewSobre();
    else v = { html: vazio("Página não encontrada", `<p><a href="#/">Voltar para a equipe</a></p>`) };
  } catch (erro) {
    console.error(erro);
    v = { html: vazio("Algo deu errado ao montar esta página", `<p class="pequeno">${esc(erro.message)}</p>`) };
  }
  if (id !== renderizando) return;  // outra navegação começou depois
  main.innerHTML = v.html;
  animar(main, modo);
  document.title = v.titulo ? `${v.titulo} · ValReport` : "ValReport · NokyLabs";
  marcarNavegacao(partes);
  if (v.depois) requestAnimationFrame(() => v.depois(main));
  if (mesmaPagina || manterRolagem) window.scrollTo(0, rolagem);
  else { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  ultimoCaminho = caminho;
  ultimaPagina = pagina;
}

function marcarNavegacao(partes) {
  const sec = partes[0] === "sobre" ? "sobre" : partes[0] === "j" || partes[0] === "p" ? "" : "equipe";
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("ativo", a.dataset.nav === sec));
  const slug = partes[0] === "j" ? partes[1] : null;
  document.querySelectorAll(".pilula-jogador").forEach((a) => {
    const on = a.dataset.slug === slug;
    a.classList.toggle("ativo", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

// ---------- Eventos ----------
main.addEventListener("change", (ev) => {
  const sel = ev.target.closest("select[data-filtro]");
  if (!sel) return;
  const { q } = lerRota();
  if (sel.value === FILTROS_PADRAO[sel.dataset.filtro]) q.delete(sel.dataset.filtro); else q.set(sel.dataset.filtro, sel.value);
  q.delete("n");
  irPara(q);
});
main.addEventListener("click", (ev) => {
  const th = ev.target.closest("th[data-ordenar]");
  if (th) {
    alternarOrdem(th.closest("table").dataset.tabela, th.dataset.ordenar);
    renderizar(true);
    return;
  }
  const limpar = ev.target.closest("[data-limpar-filtros]");
  if (limpar) {
    const { q } = lerRota();
    Object.keys(FILTROS_PADRAO).forEach((k) => q.delete(k));
    irPara(q);
    return;
  }
  const param = ev.target.closest("[data-param]");
  if (param) {
    const { q } = lerRota();
    q.set(param.dataset.param, param.dataset.valor);
    irPara(q);
    return;
  }
  const rolar = ev.target.closest("[data-rolar]");
  if (rolar) {
    document.getElementById(rolar.dataset.rolar)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const salvar = ev.target.closest("[data-salvar-nota]");
  if (salvar) { gravarNota(salvar); return; }
  const voltar = ev.target.closest("[data-voltar]");
  if (voltar && history.length > 1) { ev.preventDefault(); history.back(); }
});
// Ctrl+Enter salva a nota que está sendo escrita
main.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && ev.target.matches(".nota--editor textarea")) {
    ev.preventDefault();
    gravarNota(ev.target.closest(".nota--editor").querySelector("[data-salvar-nota]"));
  }
});
main.addEventListener("input", (ev) => {
  const caixa = ev.target.closest(".nota--editor");
  if (caixa) { caixa.querySelector(".nota__status").textContent = "não salvo"; caixa.classList.add("pendente"); }
});
async function gravarNota(botao) {
  const caixa = botao.closest(".nota--editor");
  const status = caixa.querySelector(".nota__status");
  const [tipo, id, n] = botao.dataset.salvarNota.split("|");
  const texto = caixa.querySelector("textarea").value;
  botao.disabled = true;
  status.textContent = "salvando…";
  try {
    await salvarNota({ tipo, id, n: n ? Number(n) : null, texto });
    status.textContent = texto.trim() ? "salvo ✓ (publique para ir ao site)" : "nota apagada";
    caixa.classList.remove("pendente");
    caixa.classList.add("salvo");
    setTimeout(() => caixa.classList.remove("salvo"), 900);
    if (tipo === "round") main.querySelector(`.round-cel[data-n="${n}"]`)?.classList.toggle("tem-nota", Boolean(texto.trim()));
  } catch (erro) {
    status.textContent = `não salvou: ${erro.message}. O editar_notas.bat ainda está aberto?`;
  } finally {
    botao.disabled = false;
  }
}
// Aviso ao fechar a aba com nota não salva
window.addEventListener("beforeunload", (ev) => {
  if (B.editor && main.querySelector(".nota--editor.pendente")) { ev.preventDefault(); ev.returnValue = ""; }
});

window.addEventListener("hashchange", async () => {
  // No editor, uma nota escrita e não salva é salva sozinha ao trocar de página
  if (B.editor) {
    const pendentes = [...main.querySelectorAll(".nota--editor.pendente")].map((c) => {
      const [tipo, id, n] = c.querySelector("[data-salvar-nota]").dataset.salvarNota.split("|");
      return { tipo, id, n: n ? Number(n) : null, texto: c.querySelector("textarea").value };
    });
    for (const pedido of pendentes) await salvarNota(pedido).catch(() => null);
  }
  renderizar();
});
let redim, larguraAntes = larguraGrafico();
window.addEventListener("resize", () => {
  clearTimeout(redim);
  redim = setTimeout(() => {
    ajustarTopo();
    const mudouGrafico = larguraGrafico() !== larguraAntes && main.querySelector(".grafico");
    larguraAntes = larguraGrafico();
    if (main.querySelector(".mapa-2d canvas") || mudouGrafico) renderizar(true);
  }, 250);
});

function ajustarTopo() {
  const h = document.querySelector(".topo")?.offsetHeight || 104;
  document.documentElement.style.setProperty("--topo-altura", `${h}px`);
}

// ---------- App instalável (PWA) ----------
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => null));
}
let pedidoInstalar = null;
const botaoInstalar = document.getElementById("instalar");
addEventListener("beforeinstallprompt", (ev) => {
  ev.preventDefault();
  pedidoInstalar = ev;
  botaoInstalar.hidden = false;
});
botaoInstalar.addEventListener("click", async () => {
  if (!pedidoInstalar) return;
  pedidoInstalar.prompt();
  await pedidoInstalar.userChoice.catch(() => null);
  pedidoInstalar = null;
  botaoInstalar.hidden = true;
});
addEventListener("appinstalled", () => { botaoInstalar.hidden = true; });

// ---------- Início ----------
async function iniciar() {
  try {
    await carregarBase();
  } catch (erro) {
    main.innerHTML = vazio("Ainda não há dados para mostrar", `<p>Os arquivos em <code>docs/data/</code> não foram encontrados. Rode <code>py exportar_site.py</code> no PC da equipe e publique de novo.</p><p class="pequeno suave">${esc(erro.message)}</p>`);
    return;
  }
  definirMeta(B.meta);
  if (B.editor) {
    document.body.classList.add("modo-editor");
    main.insertAdjacentHTML("beforebegin", `<div class="faixa-editor" role="status">Modo editor das notas da IGL · o que você salvar aparece no site público depois de publicar. Evite citar pelo nome quem não autorizou aparecer.</div>`);
  }
  document.getElementById("lista-jogadores").innerHTML = B.equipe.map((e) =>
    `<a class="pilula-jogador" data-slug="${esc(e.slug)}" href="#/j/${esc(e.slug)}">${imagem(imgCard(e.card) || imgAgente(e.agente), "", "", e.apelido)}${esc(e.apelido)}</a>`).join("");
  document.getElementById("gerado-em").textContent = `Dados atualizados em ${dataHora(B.meta.gerado_em)} · ${B.meta.contagem.partidas} partidas`;
  ajustarTopo();
  ligarBrilho(main);
  renderizar();
}
iniciar();
