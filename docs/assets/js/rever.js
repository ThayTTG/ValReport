// Rounds para rever (v47): a fila de VOD review montada sozinha a partir do resumo dos rounds (p.rd).
// Cada round abre direto no replay 2D; "Revisado" fica salvo para a equipe toda (rounds_revisados).
// Ao abrir pela fila, o replay mostra "Próximo da fila" (a ordem fica guardada nesta aba do navegador).

import { B, partidasDaEquipe } from "./dados.js";
import { rpc } from "./nuvem.js";
import { esc, icone, dataHora } from "./util.js";
import { seloContexto } from "./contexto.js";

export const K_FILA = "valreport.fila-rever";
const TIPOS = [
  ["vantagem", "Vantagem perdida", "Pegou o primeiro abate (5v4) e perdeu o round", (x) => x.fk === 1 && x.v === 0, "ruim"],
  ["posplant", "Pós-plant perdido", "Plantou e perdeu o round", (x) => x.quem === 1 && x.v === 0, "ruim"],
  ["retake", "Retake", "O adversário plantou com a equipe na defesa", (x) => x.quem === 0, null],
  ["pistol", "Pistol perdido", "", (x) => x.eu === 0 && x.v === 0, "ruim"],
  ["virada", "Virada 4v5", "Sofreu o primeiro abate e ganhou (o que deu certo)", (x) => x.fk === 0 && x.v === 1, "bom"],
  ["eco", "Eco ganho", "Ganhou de eco (o que deu certo)", (x) => x.eu === 1 && x.v === 1, "bom"],
];

function rounds(ps) {
  const out = [];
  for (const p of ps) (p.rd || []).forEach(([lado, v, eu, , fk, site, , , quem], i) => {
    const x = { p, n: i + 1, lado, v, eu, fk, site, quem };
    const tipos = TIPOS.filter((t) => t[3](x)).map((t) => t[0]);
    if (tipos.length) out.push({ ...x, tipos });
  });
  return out;
}

export function viewRever(f, q) {
  const tipo = q.get("tipo") || "todos", limite = Number(q.get("n") || 40);
  const todos = rounds(partidasDaEquipe(f));
  if (!(B.partidas || []).some((p) => p.rd)) {
    return { html: `<div class="vazio"><strong>A fila aparece na próxima coleta</strong><p>Ela usa o resumo de cada round que as partidas ganham a partir da próxima atualização dos dados (ou toque em Atualizar).</p></div>` };
  }
  const lista = tipo === "todos" ? todos : todos.filter((x) => x.tipos.includes(tipo));
  const conta = (t) => todos.filter((x) => x.tipos.includes(t)).length;
  const html = `<section class="secao rever">
      <div class="chips rever__tipos" role="group" aria-label="Tipo de round">
        <button type="button" class="chip${tipo === "todos" ? " ativo" : ""}" data-param="tipo" data-valor="todos">Todos <small>${todos.length}</small></button>
        ${TIPOS.map(([id, nome, desc]) => `<button type="button" class="chip${tipo === id ? " ativo" : ""}" data-param="tipo" data-valor="${id}" title="${esc(desc)}">${esc(nome)} <small>${conta(id)}</small></button>`).join("")}
      </div>
      <p class="suave pequeno">Os rounds que mais valem VOD review, montados sozinhos. Use o filtro "Contexto" para ver só scrims e oficiais. Abra pela lista: o replay mostra o próximo da fila.</p>
      <ol class="rever__lista" data-rever>${lista.slice(0, limite).map((x, i) => {
        return `<li class="rever__item" data-partida="${esc(x.p.id)}" data-n="${x.n}">
          <span class="rever__res ${x.v ? "bom" : "ruim"}">${x.v ? "V" : "D"}</span>
          <span class="rever__txt"><strong>${esc(x.p.mapa)} · R${x.n} <small>${x.lado === 0 ? "ATQ" : "DEF"}${x.site ? ` · site ${esc(x.site)}` : ""}</small></strong>
            <small>${x.tipos.map((id) => { const y = TIPOS.find((z) => z[0] === id); return `<span class="rever__tag rever__tag--${y[4] || "neutro"}">${esc(y[1])}</span>`; }).join("")} ${seloContexto(x.p)} ${esc(dataHora(x.p.t))}</small></span>
          <a class="botao-primario botao-mini" href="#/p/${esc(x.p.id)}/mapa?r=${x.n}" data-abrir-fila="${i}">${icone("video")} Replay</a>
          <button type="button" class="botao-secundario botao-mini rever__feito" data-revisado aria-pressed="false" title="Marcar como revisado (a equipe vê)">${icone("verificado")} <span>Revisado</span></button>
        </li>`;
      }).join("") || `<li class="suave">Nenhum round desse tipo com estes filtros.</li>`}</ol>
      ${lista.length > limite ? `<p style="text-align:center;margin-top:12px"><button class="limpar" type="button" data-param="n" data-valor="${limite + 40}">Mostrar mais</button></p>` : ""}
    </section>`;
  const depois = async (el) => {
    const raiz = el.querySelector("[data-rever]");
    if (!raiz) return;
    // a fila (para o replay mostrar o próximo)
    raiz.addEventListener("click", (ev) => {
      const a = ev.target.closest("[data-abrir-fila]");
      if (a) {
        try { sessionStorage.setItem(K_FILA, JSON.stringify(lista.slice(0, limite).map((x) => [x.p.id, x.n]))); } catch (e) { /* sem armazenamento */ }
      }
    });
    // revisados (da equipe toda)
    let revisados = [];
    try { revisados = await rpc("rounds_revisados_listar", { p_equipe: B.equipeAtual.id }); } catch (e) { revisados = null; }
    const marcar = (li, r) => {
      const b = li.querySelector("[data-revisado]");
      b.setAttribute("aria-pressed", String(Boolean(r)));
      b.querySelector("span").textContent = r ? `Revisado${r.por ? ` · ${r.por}` : ""}` : "Revisado";
      li.classList.toggle("feito", Boolean(r));
    };
    const mapa = new Map((revisados || []).map((r) => [`${r.partida}|${r.n}`, r]));
    raiz.querySelectorAll(".rever__item").forEach((li) => {
      if (revisados === null) { li.querySelector("[data-revisado]").hidden = true; return; }   // sem o SQL novo
      marcar(li, mapa.get(`${li.dataset.partida}|${li.dataset.n}`));
    });
    raiz.addEventListener("click", async (ev) => {
      const b = ev.target.closest("[data-revisado]");
      if (!b) return;
      const li = b.closest(".rever__item"), sim = b.getAttribute("aria-pressed") !== "true";
      b.disabled = true;
      try {
        await rpc("round_marcar_revisado", { p_equipe: B.equipeAtual.id, p_partida: li.dataset.partida, p_n: Number(li.dataset.n), p_sim: sim });
        marcar(li, sim ? { por: B.conta?.perfil?.apelido } : null);
      } catch (e) { /* mantém como estava */ }
      b.disabled = false;
    });
  };
  return { html, depois };
}

/** Para o replay: a posição deste round na fila de revisão (ou null) */
export function posicaoNaFila(id, n) {
  let fila = [];
  try { fila = JSON.parse(sessionStorage.getItem(K_FILA)) || []; } catch (e) { return null; }
  const i = fila.findIndex(([a, b]) => a === id && b === n);
  return i < 0 ? null : { i, total: fila.length, proximo: fila[i + 1] || null, anterior: fila[i - 1] || null };
}
