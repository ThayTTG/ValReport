// Janela de diálogo (v25): editores do planejamento e da agenda, confirmações e aviso flutuante.
// Usa o <dialog> do navegador: Esc fecha, o foco fica dentro e o resto da página não recebe cliques.

import { esc, icone } from "./util.js";

let atual = null;   // { el, resolver }

/**
 * Abre uma janela e espera a resposta.
 * acoes: [[valor, rótulo, classe]] da esquerda para a direita (a última é a principal; Enter aciona ela).
 * aoAbrir(form): para ligar os eventos do conteúdo. antesDeFechar(valor, form) → texto de erro para não fechar.
 * Devolve o valor do botão ("cancelar" se fechou no X, no Esc ou clicando fora).
 */
export function janela({ titulo, corpo = "", acoes = [["ok", "OK", "botao-primario"]], larga = false, aoAbrir, antesDeFechar }) {
  fecharJanela("cancelar");
  return new Promise((resolver) => {
    const el = document.createElement("dialog");
    el.className = `janela${larga ? " janela--larga" : ""}`;
    el.setAttribute("aria-labelledby", "janela-titulo");
    // Os botões ficam invertidos no HTML (e de volta no CSS): assim o Enter aciona o principal
    el.innerHTML = `<form method="dialog" class="janela__caixa" novalidate>
      <header class="janela__topo"><h2 id="janela-titulo">${titulo}</h2>
        <button type="button" class="botao-icone janela__x" data-fechar aria-label="Fechar">${icone("fechar")}</button></header>
      <div class="janela__corpo">${corpo}<p class="aviso aviso--erro janela__erro" role="alert" hidden></p></div>
      ${acoes.length ? `<footer class="janela__rodape">${[...acoes].reverse().map(([v, r, c]) => `<button class="${c || "botao-secundario"} botao-mini" value="${esc(v)}">${r}</button>`).join("")}</footer>` : ""}
    </form>`;
    document.body.appendChild(el);
    const form = el.querySelector("form");
    atual = { el, resolver };
    el.querySelector("[data-fechar]").addEventListener("click", () => fecharJanela("cancelar"));
    el.addEventListener("click", (ev) => { if (ev.target === el) fecharJanela("cancelar"); });   // clique fora
    el.addEventListener("cancel", (ev) => { ev.preventDefault(); fecharJanela("cancelar"); });     // Esc
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const valor = ev.submitter?.value || acoes.at(-1)?.[0] || "ok";
      const erro = valor !== "cancelar" && antesDeFechar ? antesDeFechar(valor, form) : "";
      if (erro) { mostrarErro(form, erro); return; }
      fecharJanela(valor, form);
    });
    el.showModal();
    aoAbrir?.(form);
    (form.querySelector("[autofocus]") || form.querySelector(".janela__corpo input, .janela__corpo select, .janela__corpo textarea"))?.focus();
  });
}

export function mostrarErro(form, texto) {
  const p = form.querySelector(".janela__erro");
  if (!p) return;
  p.textContent = texto;
  p.hidden = !texto;
}

export function fecharJanela(valor = "cancelar", form = null) {
  if (!atual) return;
  const { el, resolver } = atual;
  atual = null;
  const dados = form ? Object.fromEntries(new FormData(form)) : {};
  el.close();
  el.remove();
  resolver({ valor, dados, form });
}

export const janelaAberta = () => Boolean(atual);

export async function confirmar(titulo, texto, rotulo = "Confirmar", perigo = false) {
  const r = await janela({ titulo: esc(titulo), corpo: `<p>${texto}</p>`, acoes: [["cancelar", "Cancelar"], ["ok", rotulo, perigo ? "botao-perigo" : "botao-primario"]] });
  return r.valor === "ok";
}

// ---------- Aviso flutuante (o mesmo do "dados novos chegaram") ----------
let tempo;
export function avisar(texto, tipo = "") {
  const el = document.getElementById("aviso-dados");
  if (!el) return;
  clearTimeout(tempo);
  el.textContent = texto;
  el.className = `aviso-flutuante ${tipo}`;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("visivel"));
  tempo = setTimeout(() => { el.classList.remove("visivel"); setTimeout(() => { el.hidden = true; }, 300); }, tipo === "erro" ? 5200 : 3200);
}

/** Mensagem de erro do banco sem o prefixo técnico ("pontos: …" → "…") */
export const textoErro = (e) => String(e?.message || e || "Algo deu errado.").replace(/^[a-z_áéíóúãõç ]+: /i, (m) => (m.length < 24 ? "" : m));
