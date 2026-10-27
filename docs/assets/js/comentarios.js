// Comentários das partidas e dos rounds (no lugar das "Notas da IGL"): toda a equipe comenta, convidados não veem.
// Cada pessoa edita e apaga os seus; líder e co-líderes apagam qualquer um. O banco confere tudo de novo.

import { esc, icone, imagem, imgCard, md, relativo, dataHora } from "./util.js";
import { B } from "./dados.js";
import { rpc } from "./nuvem.js";

const CARGOS = { lider: "Líder", colider: "Co-líder", treinador: "Treinador(a)", jogador: "Jogador(a)", convidado: "Convidado(a)" };
const textoErro = (e) => String(e?.message || e || "").replace(/^[a-z_]+: /, "");

/** Quem vê e escreve (fora do editor de notas do PC, que continua com as notas antigas) */
export const podeVerComentarios = () => !B.editor && Boolean(B.equipeAtual) && (B.conta?.admin || (B.equipeAtual.cargo && B.equipeAtual.cargo !== "convidado"));
export const lideraComentarios = () => Boolean(B.conta?.admin || ["lider", "colider"].includes(B.equipeAtual?.cargo));

// ---------- Contagem (selos nas listas e na linha do tempo dos rounds) ----------
export async function carregarContagem() {
  if (!podeVerComentarios()) { B.comentarios = {}; return; }
  try { B.comentarios = (await rpc("comentarios_contagem", { p_equipe: B.equipeAtual.id })) || {}; } catch (e) { B.comentarios = B.comentarios || {}; }
}
export const totalComentarios = (partida) => B.comentarios?.[partida]?.t || 0;
export const roundTemComentario = (partida, n) => (B.comentarios?.[partida]?.r || []).includes(Number(n));
function recontar(partida, lista) {
  B.comentarios = B.comentarios || {};
  if (!lista.length) { delete B.comentarios[partida]; return; }
  B.comentarios[partida] = { t: lista.length, r: [...new Set(lista.filter((c) => c.round).map((c) => c.round))] };
}

// ---------- Leitura ----------
const cache = new Map();   // partida -> { t, dados }
export async function lerComentarios(partida, { fresco = false } = {}) {
  const c = cache.get(partida);
  if (!fresco && c && Date.now() - c.t < 20000) return c.dados;
  const dados = await rpc("comentarios_listar", { p_equipe: B.equipeAtual.id, p_partida: partida });
  cache.set(partida, { t: Date.now(), dados });
  recontar(partida, dados.comentarios || []);
  return dados;
}

function htmlComentario(c, podeApagarTodos) {
  const cor = /^#[0-9a-f]{6}$/i.test(c.autor_cor || "") ? ` style="--cor-perfil:${c.autor_cor}"` : "";
  const acoes = [c.eu ? `<button class="limpar" type="button" data-com-acao="editar">Editar</button>` : "",
    c.eu || podeApagarTodos ? `<button class="limpar comentario__apagar" type="button" data-com-acao="apagar">Apagar</button>` : ""].join("");
  return `<li class="comentario" data-com-id="${esc(c.id)}"${cor}>
      <span class="comentario__avatar">${imagem(imgCard(c.autor_card), "", "", c.autor)}</span>
      <div class="comentario__corpo">
        <div class="comentario__topo"><strong>${esc(c.autor)}</strong>${c.autor_cargo ? `<span class="selo">${esc(CARGOS[c.autor_cargo] || c.autor_cargo)}</span>` : ""}
          <time datetime="${esc(c.criado_em)}" title="${esc(dataHora(c.criado_em))}">${esc(relativo(c.criado_em))}</time>${c.editado_em ? `<span class="suave pequeno" title="${esc(dataHora(c.editado_em))}">· editado</span>` : ""}
          ${c.origem === "notas_pc" ? `<span class="suave pequeno" title="Escrito no editor de notas do PC">· nota do PC</span>` : ""}</div>
        <div class="comentario__texto nota__texto">${md(c.texto)}</div>
        ${acoes ? `<div class="comentario__acoes">${acoes}</div>` : ""}
      </div></li>`;
}

/**
 * Lista + campo para escrever, de uma partida (round = null) ou de um round.
 * dados = resposta de lerComentarios; opções: titulo, vazio (texto quando não há nada).
 */
export function htmlComentarios(dados, partida, round = null, { titulo = null, vazio = "Ninguém comentou ainda. Comece a conversa." } = {}) {
  const lista = (dados?.comentarios || []).filter((c) => (c.round ?? null) === (round ?? null));
  return `<section class="cartao comentarios" data-comentarios data-partida="${esc(partida)}" data-round="${round ?? ""}">
      <div class="cartao__titulo"><h3>${icone("nota")} ${esc(titulo || (round ? `Comentários · round ${round}` : "Comentários"))}</h3>
        ${lista.length ? `<span class="suave pequeno">${lista.length}</span>` : ""}</div>
      ${lista.length ? `<ol class="comentarios__lista">${lista.map((c) => htmlComentario(c, dados.pode_apagar_todos)).join("")}</ol>` : `<p class="suave pequeno comentarios__vazio">${esc(vazio)}</p>`}
      <form class="comentarios__novo">
        <label class="sr" for="com-${esc(partida)}-${round ?? "p"}">Escrever um comentário</label>
        <textarea id="com-${esc(partida)}-${round ?? "p"}" rows="2" maxlength="2000" placeholder="${round ? `Comentar o round ${round}` : "Comentar a partida"} (só a equipe vê; convidados não)"></textarea>
        <div class="comentarios__rodape"><span class="suave pequeno">**negrito**, *itálico*, "- " para lista · Ctrl+Enter envia</span>
          <button class="botao-primario botao-mini" type="submit">${icone("enviar")} Enviar</button></div>
        <p class="form-msg" role="status" hidden></p>
      </form>
    </section>`;
}

/** Liga um bloco de comentários já desenhado (o próprio bloco é redesenhado depois de cada mudança) */
export function ligarComentarios(secao, aoMudar = () => {}) {
  if (!secao) return;
  const partida = secao.dataset.partida, round = secao.dataset.round ? Number(secao.dataset.round) : null;
  const msg = secao.querySelector(".comentarios__novo .form-msg");
  const aviso = (t) => { msg.textContent = t; msg.className = "form-msg aviso aviso--erro"; msg.hidden = !t; };
  const redesenhar = async (focoNovo = false) => {
    const dados = await lerComentarios(partida, { fresco: true });
    const novo = document.createElement("div");
    novo.innerHTML = htmlComentarios(dados, partida, round);
    const el = novo.firstElementChild;
    secao.replaceWith(el);
    ligarComentarios(el, aoMudar);
    if (focoNovo) el.querySelector(".comentarios__novo textarea")?.focus();
    aoMudar(dados);
  };
  const form = secao.querySelector(".comentarios__novo");
  const enviar = async () => {
    const ta = form.querySelector("textarea"), botao = form.querySelector("[type=submit]");
    if (!ta.value.trim()) { aviso("Escreva alguma coisa antes de enviar."); return; }
    botao.disabled = true; ta.disabled = true;
    try {
      await rpc("comentario_criar", { p_equipe: B.equipeAtual.id, p_partida: partida, p_round: round, p_texto: ta.value });
      await redesenhar(true);
    } catch (e) { botao.disabled = false; ta.disabled = false; aviso(textoErro(e)); }
  };
  form.addEventListener("submit", (ev) => { ev.preventDefault(); enviar(); });
  form.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); enviar(); } });

  secao.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-com-acao]");
    if (!b) return;
    const item = b.closest("[data-com-id]"), id = item.dataset.comId;
    if (b.dataset.comAcao === "apagar") {
      if (!confirm("Apagar este comentário?")) return;
      b.disabled = true;
      try { await rpc("comentario_apagar", { p_id: id }); await redesenhar(); } catch (e) { b.disabled = false; aviso(textoErro(e)); }
      return;
    }
    if (b.dataset.comAcao === "editar") {
      const c = (cache.get(partida)?.dados?.comentarios || []).find((x) => x.id === id);
      const caixa = item.querySelector(".comentario__texto");
      caixa.outerHTML = `<form class="comentario__edicao"><textarea rows="3" maxlength="2000" aria-label="Editar comentário">${esc(c?.texto || "")}</textarea>
        <div class="comentarios__rodape"><button class="botao-secundario botao-mini" type="button" data-com-acao="cancelar">Cancelar</button>
          <button class="botao-primario botao-mini" type="submit">Salvar</button></div></form>`;
      item.querySelector(".comentario__acoes")?.remove();
      const f = item.querySelector(".comentario__edicao"), ta = f.querySelector("textarea");
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      const salvar = async () => {
        f.querySelectorAll("button, textarea").forEach((x) => { x.disabled = true; });
        try { await rpc("comentario_editar", { p_id: id, p_texto: ta.value }); await redesenhar(); }
        catch (e) { f.querySelectorAll("button, textarea").forEach((x) => { x.disabled = false; }); aviso(textoErro(e)); }
      };
      f.addEventListener("submit", (e2) => { e2.preventDefault(); salvar(); });
      ta.addEventListener("keydown", (e2) => { if (e2.key === "Enter" && (e2.ctrlKey || e2.metaKey)) { e2.preventDefault(); salvar(); } if (e2.key === "Escape") redesenhar(); });
      return;
    }
    if (b.dataset.comAcao === "cancelar") redesenhar();
  });
}

/** Aviso para a liderança: notas do editar_notas.bat que ainda não viraram comentários */
export async function htmlNotasPendentes() {
  if (!lideraComentarios()) return "";
  let n = 0;
  try { n = await rpc("comentarios_pendentes", { p_equipe: B.equipeAtual.id }); } catch (e) { return ""; }
  if (!n) return "";
  return `<div class="aviso secao com-pendentes">${icone("nota")}<span>${n === 1 ? "Há 1 nota" : `Há ${n} notas`} do editor do PC que ainda não ${n === 1 ? "virou comentário" : "viraram comentários"}. Ao trazer, ${n === 1 ? "ela aparece" : "elas aparecem"} com o seu nome nas partidas e nos rounds.</span>
    <button class="botao-secundario botao-mini" type="button" data-trazer-notas>Trazer as notas</button></div>`;
}
export function ligarNotasPendentes(raiz, aoTerminar) {
  raiz?.querySelector("[data-trazer-notas]")?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      await rpc("comentarios_importar_notas", { p_equipe: B.equipeAtual.id });
      cache.clear();
      await carregarContagem();
      aoTerminar();
    } catch (e) { b.disabled = false; b.closest(".aviso").querySelector("span").textContent = textoErro(e); }
  });
}
