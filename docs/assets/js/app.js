// ValReport · NokyLabs — rotas, tema, filtros e eventos

import { esc, icone, imagem, imgCard, imgAgente, definirMeta, dataHora, vazio, larguraGrafico } from "./util.js";
import { B, carregarBase, FILTROS_PADRAO, salvarNota, limparCache, detectarEditor, metaFresca } from "./dados.js";
import { iniciarNuvem, rpc, entrar, usuario } from "./nuvem.js";
import { viewBoasVindas, viewCadastro, viewSemEquipe, viewConta, viewPainel } from "./conta.js";
import { viewSync } from "./sync.js";
import { viewMeuPerfil, viewPerfilPublico, ligarBusca } from "./perfil.js";
import { viewMinhasEquipes, viewTime, viewConvite, guardarConvitePendente } from "./equipes.js";
import { ligarGaveta } from "./gaveta.js";
import { alternarOrdem, trocarMiniAba, alternarMinimizado } from "./componentes.js";
import { coroaSobre, abrirRevelacao, talvezRevelar } from "./coroa.js";
import { viewJogador } from "./jogador.js";
import { viewPartida } from "./partida.js";
import { viewEquipe } from "./equipe.js";
import { viewTatica, podeVerTaticas } from "./taticas.js";
import { carregarContagem } from "./comentarios.js";
import { viewSobre } from "./sobre.js";
import { viewHoje } from "./hoje.js";
import { animar, trocarTema, ligarBrilho } from "./animar.js";

// O endereço antigo (GitHub Pages) leva para o site novo, na mesma página
if (location.hostname.endsWith("github.io")) location.replace(`https://valreport.vercel.app/${location.hash}`);

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
  if (!partes.length) return ["inicio", ""];
  if (partes[0] === "equipe") return ["equipe", partes[1] || "visao"];
  if (partes[0] === "j" || partes[0] === "p" || partes[0] === "tatica") return [`${partes[0]}/${partes[1]}`, partes[2] || ""];
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
    if (tela === "publico") { if (partes[0] === "convite") guardarConvitePendente(partes[1] || ""); v = viewBoasVindas(erroLogin, partes[0] === "convite"); }
    else if (tela === "cadastro") v = viewCadastro();
    else if (B.conta && partes[0] === "conta") v = viewConta();
    else if (B.conta && partes[0] === "painel" && partes[1] === "sync") v = await viewSync();
    else if (B.conta && partes[0] === "painel") v = await viewPainel();
    else if (B.conta && partes[0] === "perfil") v = await viewMeuPerfil();
    else if (B.conta && partes[0] === "u" && partes[1]) v = await viewPerfilPublico(decodeURIComponent(partes[1]));
    else if (B.conta && partes[0] === "equipes") v = await viewMinhasEquipes();
    else if (B.conta && partes[0] === "time" && partes[1]) v = await viewTime(decodeURIComponent(partes[1]), partes[2] || "membros");
    else if (B.conta && partes[0] === "convite" && partes[1]) v = await viewConvite(partes[1]);
    else if (tela === "sem-equipe") v = viewSemEquipe();
    else if (partes[0] === "tatica" && partes[1]) v = await viewTatica(decodeURIComponent(partes[1]), partes[2] || "", q);
    else if (tela === "sem-dados" && partes[0] === "equipe" && partes[1] === "taticas") v = await viewEquipe("taticas", f, q, { semDados: true });
    else if (tela === "sem-dados") v = { titulo: "Sem dados", html: avisoSemDados };
    else if (!partes.length) v = viewHoje(q);
    else if (partes[0] === "equipe") v = await viewEquipe(partes[1] || "visao", f, q);
    else if (partes[0] === "j") v = await viewJogador(decodeURIComponent(partes[1] || ""), partes[2] || "geral", f, q);
    else if (partes[0] === "p") v = await viewPartida(decodeURIComponent(partes[1] || ""), partes[2] || "placar", q);
    else if (partes[0] === "sobre") v = viewSobre();
    else v = { html: vazio("Página não encontrada", `<p><a href="#/">Voltar para o início</a></p>`) };
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
  document.body.dataset.modo = tela;
  if (mesmaPagina || manterRolagem) window.scrollTo(0, rolagem);
  else { window.scrollTo(0, 0); main.focus({ preventScroll: true }); }
  ultimoCaminho = caminho;
  ultimaPagina = pagina;
}

function marcarNavegacao(partes) {
  const sec = !partes.length ? "inicio" : partes[0] === "sobre" ? "sobre" : ["equipe", "equipes", "time", "tatica"].includes(partes[0]) ? "equipe" : ["conta", "painel", "perfil"].includes(partes[0]) ? "conta" : "";
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
  const escolha = ev.target.closest("select[data-param-sel]");
  if (escolha) {  // seletores simples (ex.: função do Índice NokyLabs)
    const { q } = lerRota();
    if (escolha.value === escolha.dataset.padrao) q.delete(escolha.dataset.paramSel); else q.set(escolha.dataset.paramSel, escolha.value);
    irPara(q);
    return;
  }
  const sel = ev.target.closest("select[data-filtro]");
  if (!sel) return;
  const { q } = lerRota();
  if (sel.value === FILTROS_PADRAO[sel.dataset.filtro]) q.delete(sel.dataset.filtro); else q.set(sel.dataset.filtro, sel.value);
  q.delete("n");
  irPara(q);
});
main.addEventListener("click", (ev) => {
  // Cartões clicáveis por inteiro (ex.: um mapa abre as partidas nele), sem atrapalhar os botões de dentro
  const ir = ev.target.closest("[data-ir]");
  if (ir && !ev.target.closest("a, button, select, input, textarea, label")) { location.hash = ir.dataset.ir; return; }
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
  const mini = ev.target.closest("[data-mini-aba]");
  if (mini) { trocarMiniAba(mini); return; }
  const minimizar = ev.target.closest("[data-minimizar]");
  if (minimizar) { alternarMinimizado(minimizar); return; }
  if (ev.target.closest("[data-ver-coroa]")) { abrirRevelacao(); return; }
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
    status.textContent = texto.trim() ? "salvo ✓ (já segue para o site da equipe)" : "nota apagada";
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

// ---------- Topo minimizável (esconde a fileira de jogadores) ----------
const botaoTopo = document.getElementById("minimizar-topo");
function aplicarTopo(min) {
  document.body.classList.toggle("topo-min", min);
  botaoTopo.setAttribute("aria-expanded", String(!min));
  botaoTopo.setAttribute("aria-label", min ? "Mostrar os jogadores no topo" : "Esconder os jogadores do topo");
  botaoTopo.title = min ? "Mostrar jogadores" : "Esconder jogadores";
}
try { aplicarTopo(localStorage.getItem("valreport.topo") === "min"); } catch (e) { aplicarTopo(false); }
botaoTopo.addEventListener("click", () => {
  const min = !document.body.classList.contains("topo-min");
  aplicarTopo(min);
  try { localStorage.setItem("valreport.topo", min ? "min" : "aberto"); } catch (e) { /* sem armazenamento */ }
  setTimeout(ajustarTopo, 320);  // depois da transição, as abas grudam no lugar certo
});

// ---------- Dados novos: o site confere sozinho a cada 20 min (e no botão Atualizar) ----------
const INTERVALO_MS = 20 * 60 * 1000;
const botaoAtualizar = document.getElementById("atualizar");
const avisoDados = document.getElementById("aviso-dados");
let ultimaConferida = Date.now(), conferindo = false, tempoAviso;

function avisar(texto, tipo = "") {
  clearTimeout(tempoAviso);
  avisoDados.textContent = texto;
  avisoDados.className = `aviso-flutuante ${tipo}`;
  avisoDados.hidden = false;
  requestAnimationFrame(() => avisoDados.classList.add("visivel"));
  tempoAviso = setTimeout(() => { avisoDados.classList.remove("visivel"); setTimeout(() => { avisoDados.hidden = true; }, 300); }, 4200);
}

function preencherTopo() {
  definirMeta(B.meta);
  document.getElementById("lista-jogadores").innerHTML = B.equipe.map((e) =>
    `<a class="pilula-jogador" data-slug="${esc(e.slug)}" href="#/j/${esc(e.slug)}"><span class="foto-coroa">${imagem(imgCard(e.card) || imgAgente(e.agente), "", "", e.apelido)}${coroaSobre(e.slug, "coroa--mini")}</span>${esc(e.apelido)}</a>`).join("");
  document.getElementById("gerado-em").textContent = `Dados atualizados em ${dataHora(B.meta.gerado_em)} · ${B.meta.contagem.partidas} partidas · o site confere se há novidades a cada 20 minutos`;
  ajustarTopo();
  pilulaIntegrantes();
}

/** Depois dos jogadores, um atalho para os outros integrantes (treinadores e convidados) e a página da equipe */
let extrasEquipe = null;
async function pilulaIntegrantes() {
  const slug = B.equipeAtual?.slug, lista = document.getElementById("lista-jogadores");
  if (!slug || !lista) return;
  if (extrasEquipe == null) {
    try { extrasEquipe = (await rpc("equipe_detalhes", { p_slug: slug }))?.vagas?.extras ?? 0; } catch (e) { extrasEquipe = 0; }
  }
  lista.querySelector(".pilula-integrantes")?.remove();
  lista.insertAdjacentHTML("beforeend", `<a class="pilula-jogador pilula-integrantes" href="#/time/${esc(slug)}" title="Todos os integrantes da equipe">
    <span class="pilula-integrantes__mais">${extrasEquipe ? `+${extrasEquipe}` : icone("equipe")}</span>${extrasEquipe ? `integrante${extrasEquipe === 1 ? "" : "s"}` : "Integrantes"}</a>`);
}

async function conferirDados(manual = false) {
  if (conferindo || !B.meta) return;
  conferindo = true;
  botaoAtualizar.classList.add("girando-icone");
  botaoAtualizar.disabled = true;
  try {
    const meta = await metaFresca();
    ultimaConferida = Date.now();
    if (meta.gerado_em === B.meta.gerado_em) {
      if (manual) avisar(`Tudo em dia · dados de ${dataHora(B.meta.gerado_em)}`);
      return;
    }
    if (main.querySelector(".nota--editor.pendente")) {  // não atrapalha quem está escrevendo
      avisar("Chegaram dados novos. Salve a nota e toque em atualizar.", "novo");
      return;
    }
    const antes = B.meta.contagem.partidas;
    limparCache();
    await carregarBase();
    await carregarContagem();
    preencherTopo();
    await renderizar(true, "nada");
    const novas = B.meta.contagem.partidas - antes;
    avisar(novas > 0 ? `${novas} partida${novas === 1 ? " nova chegou" : "s novas chegaram"} ✨` : "Dados atualizados ✨", "novo");
  } catch (erro) {
    if (manual) avisar("Sem conexão agora. Tento de novo daqui a pouco.", "erro");
  } finally {
    conferindo = false;
    botaoAtualizar.classList.remove("girando-icone");
    botaoAtualizar.disabled = false;
  }
}
botaoAtualizar.addEventListener("click", () => conferirDados(true));
// Confere só com a aba visível; ao voltar para o site depois de um tempo, confere na hora
setInterval(() => { if (!document.hidden && Date.now() - ultimaConferida >= INTERVALO_MS) conferirDados(); }, 60 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && Date.now() - ultimaConferida >= INTERVALO_MS) conferirDados(); });

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
// Modo da tela: "publico" (sem login), "cadastro" (primeiro acesso), "sem-equipe" ou "app" (membro de equipe)
let tela = "carregando", erroLogin = null, avisoSemDados = "";

/** Selo no botão do perfil: equipes esperando aprovação (administradora) e pedidos de Riot ID (liderança) */
async function mostrarPendencias() {
  if (!B.conta?.perfil) return;
  try {
    const pend = await rpc("minhas_pendencias");
    B.pendencias = pend;
    const total = (pend.equipes_pendentes || 0) + (pend.pedidos_riot || 0);
    const chip = document.getElementById("conta-link");
    chip.querySelector(".conta-chip__selo")?.remove();
    if (total) {
      chip.insertAdjacentHTML("beforeend", `<b class="conta-chip__selo" aria-label="${total} pendência${total === 1 ? "" : "s"}">${total > 9 ? "9+" : total}</b>`);
      chip.title = `Meu perfil · ${total} pendência${total === 1 ? "" : "s"}`;
    }
  } catch (e) { /* sem avisos agora */ }
}

/** Quem está em duas equipes escolhe de qual ver as estatísticas */
function trocaDeEquipe() {
  const lista = B.conta?.equipes || [];
  if (lista.length < 2) return;
  // No computador, um seletor no topo; no celular, a troca fica no menu lateral
  const criar = (id) => {
    const sel = document.createElement("select");
    sel.className = "troca-equipe";
    sel.id = id;
    sel.setAttribute("aria-label", "Equipe");
    sel.innerHTML = lista.map((e) => `<option value="${esc(e.slug)}"${e.slug === B.equipeAtual?.slug ? " selected" : ""}>${esc(e.nome)}</option>`).join("");
    sel.addEventListener("change", () => {
      try { localStorage.setItem("valreport.equipe", sel.value); } catch (e) { /* sem armazenamento */ }
      location.hash = "#/";
      location.reload();
    });
    return sel;
  };
  document.querySelector(".marca")?.after(criar("troca-equipe"));
}

/** Botão redondo da conta: o card verificado, ou a inicial do apelido */
function desenharChip() {
  const u = usuario() || {}, p = B.conta?.perfil || {};
  const el = document.getElementById("conta-inicial");
  const inicial = esc((p.apelido || u.user_metadata?.full_name || u.email || "?").slice(0, 1).toUpperCase());
  el.innerHTML = p.riot_card ? imagem(imgCard(p.riot_card), "", "conta-chip__img", p.apelido || "?") : inicial;
  const chip = document.getElementById("conta-link");
  if (/^#[0-9a-f]{6}$/i.test(p.cor || "")) chip.style.setProperty("--cor-perfil", p.cor); else chip.style.removeProperty("--cor-perfil");
}
window.addEventListener("valreport:perfil", desenharChip);

function telaDeErro(titulo, texto) {
  main.innerHTML = vazio(titulo, `<p>${esc(texto)}</p><p><button class="botao-secundario" type="button" data-tentar>Tentar de novo</button></p>`);
  main.querySelector("[data-tentar]")?.addEventListener("click", () => location.reload());
}

async function iniciar() {
  B.editor = await detectarEditor();
  if (!B.editor) {
    const login = await iniciarNuvem();
    if (login.repetir) { entrar(); return; }
    erroLogin = login.erro;
    if (!login.logado) {
      tela = "publico";
      await renderizar();
      return;
    }
    try {
      B.conta = await rpc("minha_conta");
    } catch (erro) {
      telaDeErro("Não foi possível abrir a sua conta", erro.message);
      return;
    }
    document.getElementById("conta-link").hidden = false;
    desenharChip();
    if (B.conta.perfil) { document.getElementById("buscar-topo").hidden = false; ligarBusca(); }
    if (!B.conta.perfil) { tela = "cadastro"; await renderizar(); return; }
    await mostrarPendencias();
    if (!B.conta.equipes.length) { tela = "sem-equipe"; await renderizar(); return; }
    let salva = null;
    try { salva = localStorage.getItem("valreport.equipe"); } catch (e) { /* sem armazenamento */ }
    B.equipeAtual = B.conta.equipes.find((e) => e.slug === salva) || B.conta.equipes[0];
    trocaDeEquipe();
  }
  try {
    await carregarBase();
  } catch (erro) {
    avisoSemDados = vazio("Ainda não há dados para mostrar", B.editor
      ? `<p>Rode <code>py ferramentas\\exportar_site.py</code> no PC da equipe.</p><p class="pequeno suave">${esc(erro.message)}</p>`
      : `<p>As estatísticas da ${esc(B.equipeAtual?.nome || "equipe")} ainda não chegaram. Elas aparecem quando a coleta da administradora começar a buscar as partidas da equipe.</p>
         <p class="lp-acoes" style="justify-content:center"><a class="botao-primario" href="#/time/${esc(B.equipeAtual?.slug || "")}">Membros e convites</a>
           ${podeVerTaticas() ? `<a class="botao-secundario" href="#/equipe/taticas">Táticas</a>` : ""}<a class="botao-secundario" href="#/equipes">Minhas equipes</a><a class="botao-secundario" href="#/perfil">Meu perfil</a></p>`);
    tela = "sem-dados";
    await renderizar();
    return;
  }
  if (B.editor) {
    document.body.classList.add("modo-editor");
    main.insertAdjacentHTML("beforebegin", `<div class="faixa-editor" role="status">Modo editor das notas da IGL · o que você salvar vai para o site da equipe sozinho (só membros veem; convidados não).</div>`);
  }
  tela = "app";
  await carregarContagem();
  preencherTopo();
  ultimaConferida = Date.now();
  ligarBrilho(main);
  await renderizar();
  talvezRevelar();
}
window.addEventListener("valreport:recarregar", () => location.reload());
ligarGaveta(() => tela);
document.getElementById("entrar-topo")?.addEventListener("click", () => entrar());
iniciar();
