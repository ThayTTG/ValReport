// Coroa do MVP da semana: fica com quem foi MVP na última semana fechada (domingo 21h) até a próxima fechar.
// Ao abrir o site depois que a semana fecha, o fundo desfoca e o cartão do MVP aparece com medalha e partículas.

import { esc, num, sinal, imagem, imgAgente, imgCard, icone, dataCurta } from "./util.js";
import { B } from "./dados.js";
import { semMovimento, particulas } from "./animar.js";

const CHAVE_VISTA = "valreport.coroa.vista";
export const temCoroa = (slug) => Boolean(B.coroa && B.coroa.mvp === slug);
/** Selo da coroa para pôr sobre a foto (o elemento pai precisa de position: relative) */
export const coroaSobre = (slug, classe = "") => (temCoroa(slug)
  ? `<span class="coroa ${classe}" title="MVP da semana ${dataCurta(B.coroa.ini)}–${dataCurta(B.coroa.fim)}${B.coroa.seguidas > 1 ? ` · ${B.coroa.seguidas} semanas seguidas` : ""}" aria-label="Coroa de MVP da semana">${icone("coroa")}</span>` : "");

export function textoSeguidas(c = B.coroa) {
  if (!c) return "";
  if (c.seguidas > 1) return `${c.seguidas} semanas seguidas com a coroa!`;
  if (c.mvp_anterior && c.mvp_anterior !== c.mvp) {
    const ant = B.porSlug.get(c.mvp_anterior);
    return ant ? `Tomou a coroa de ${ant.apelido}!` : "Coroa nova!";
  }
  return "A coroa é sua até a próxima semana fechar.";
}

function htmlRevelacao() {
  const c = B.coroa, e = B.porSlug.get(c.mvp);
  const mv = c.jogadores.find((j) => j.slug === c.mvp)?.semana || {};
  const fundo = imgCard(e.card, "wideart");
  return `<div class="revela" role="dialog" aria-modal="true" aria-labelledby="revela-titulo">
    <div class="revela__fundo" data-fechar-revela></div>
    <div class="revela__palco">
      <div class="com-particulas revela__alvo">
        <article class="revela__cartao">
          ${fundo ? `<span class="revela__banner" style="background-image:url('${esc(fundo)}')" aria-hidden="true"></span>` : ""}
          <span class="revela__medalha" aria-hidden="true">${icone("medalha")}</span>
          <small class="revela__rotulo">MVP da semana · ${dataCurta(c.ini)} a ${dataCurta(c.fim)}</small>
          <div class="revela__foto">${imagem(imgCard(e.card) || imgAgente(e.agente), e.apelido, "avatar", e.apelido)}<span class="revela__coroa" aria-hidden="true">${icone("coroa")}</span></div>
          <h2 id="revela-titulo">${esc(e.apelido)}</h2>
          <p class="revela__seguidas">${esc(textoSeguidas(c))}</p>
          <div class="revela__nums">
            <div><strong>${sinal(mv.impacto, 1, "%")}</strong><small>impacto/round</small></div>
            <div><strong>${num(mv.kd, 2)}</strong><small>K/D</small></div>
            <div><strong>${num(mv.adr)}</strong><small>ADR</small></div>
            <div><strong>${mv.partidas ?? "—"}</strong><small>partida${mv.partidas === 1 ? "" : "s"}</small></div>
          </div>
          <p class="revela__equipe">A equipe na semana: ${c.partidas} partida${c.partidas === 1 ? "" : "s"} · <strong class="bom">${c.v}V</strong> · <strong class="ruim">${c.d}D</strong></p>
          <div class="revela__botoes"><button type="button" class="revela__ok" data-fechar-revela>Continuar</button>
            <a class="revela__link" href="#/equipe/semana" data-fechar-revela>Ver a semana</a></div>
        </article>
      </div>
    </div>
    <div class="revela__confete" aria-hidden="true"></div>
  </div>`;
}

function confete(el) {
  if (semMovimento()) return;
  const cores = ["var(--ouro)", "var(--destaque)", "#3bb3c3", "#ffffff", "#f67070"];
  el.innerHTML = Array.from({ length: 70 }, (_, i) => {
    const x = Math.random() * 100, d = 2.4 + Math.random() * 2.2, atraso = Math.random() * 0.9, giro = (Math.random() * 720 - 360).toFixed(0);
    return `<i style="left:${x.toFixed(1)}%;--d:${d.toFixed(2)}s;--a:${atraso.toFixed(2)}s;--g:${giro}deg;--dx:${(Math.random() * 120 - 60).toFixed(0)}px;background:${cores[i % cores.length]}"></i>`;
  }).join("");
}

let aberta = null, focoAntes = null;
export function abrirRevelacao() {
  if (!B.coroa || aberta) return;
  focoAntes = document.activeElement;
  document.body.insertAdjacentHTML("beforeend", htmlRevelacao());
  aberta = document.body.lastElementChild;
  document.documentElement.classList.add("revela-aberta");
  particulas(aberta);
  confete(aberta.querySelector(".revela__confete"));
  requestAnimationFrame(() => aberta?.classList.add("visivel"));
  aberta.querySelector(".revela__ok").focus({ preventScroll: true });
  try { localStorage.setItem(CHAVE_VISTA, B.coroa.id); } catch (e) { /* sem armazenamento */ }
}
export function fecharRevelacao() {
  if (!aberta) return;
  const el = aberta;
  aberta = null;
  el.classList.remove("visivel");
  el.classList.add("saindo");
  document.documentElement.classList.remove("revela-aberta");
  setTimeout(() => el.remove(), semMovimento() ? 0 : 350);
  focoAntes?.focus?.({ preventScroll: true });
}
/** Mostra uma vez por aparelho a cada semana fechada */
export function talvezRevelar() {
  if (!B.coroa || B.editor) return;
  let vista = null;
  try { vista = localStorage.getItem(CHAVE_VISTA); } catch (e) { /* sem armazenamento: mostra */ }
  if (vista !== B.coroa.id) setTimeout(abrirRevelacao, 600);
}
document.addEventListener("click", (ev) => { if (aberta && ev.target.closest("[data-fechar-revela]")) fecharRevelacao(); });
document.addEventListener("keydown", (ev) => { if (aberta && ev.key === "Escape") fecharRevelacao(); });
