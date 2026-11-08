// Aba "Atributos" do jogador: 7 notas de estilo de 0 a 100 (no jeito da HLTV), comparadas com quem joga a mesma função
// nos lobbies coletados. O cálculo é do ferramentas/atributos.py (chega em data/atributos.json).
// Por enquanto só a administradora vê, até a conferência das notas com a equipe.

import { esc, num, icone } from "./util.js";
import { atributosDados } from "./dados.js";

const LADOS = [["ambos", "Os dois lados"], ["ataque", "Ataque"], ["defesa", "Defesa"]];

function valor(v, fmt) {
  if (v == null) return "—";
  if (fmt === "pct") return `${num(v * 100, 0)}%`;
  if (fmt === "s") return `${num(v, 1)} s`;
  return num(v, fmt === "n2" ? 2 : 1);
}

const nivel = (n) => (n == null ? "" : n >= 65 ? "alto" : n <= 35 ? "baixo" : "medio");

function barra(n, rotulo) {
  return `<span class="atr-barra" role="img" aria-label="${esc(rotulo)}: ${n ?? "sem nota"} de 100">
      <span class="atr-barra__fill atr--${nivel(n)}" style="width:${n ?? 0}%"></span><span class="atr-barra__media" aria-hidden="true"></span></span>`;
}

function cartaoAtributo(a, dado) {
  const n = dado?.nota ?? null;
  const linhas = (dado?.stats || []).map(([sid, v, media, pct]) => {
    const s = a.stats.find((x) => x.id === sid) || { nome: sid, fmt: "n2" };
    return `<li class="atr-stat"><span class="atr-stat__nome">${esc(s.nome)}${s.maior ? "" : ` <small class="suave">(menor = mais)</small>`}</span>
        <span class="atr-stat__valor"><strong>${valor(v, s.fmt)}</strong> <small class="suave">média ${valor(media, s.fmt)}</small></span>
        ${barra(pct, s.nome)}</li>`;
  }).join("");
  return `<details class="cartao atr-cartao">
      <summary>
        <span class="atr-cartao__topo"><span><strong>${esc(a.nome)}</strong> <small class="suave">${esc(a.hltv)}</small></span>
          <span class="atr-nota atr--${nivel(n)}">${n ?? "—"}</span></span>
        ${barra(n, a.nome)}
        <small class="suave atr-desc">${esc(a.desc)}</small>
      </summary>
      <ul class="atr-stats">${linhas}</ul>
    </details>`;
}

export async function htmlAtributos(e, q) {
  let d;
  try { d = await atributosDados(); } catch (err) { d = null; }
  const j = d?.jogadores?.[e.slug];
  if (!j) {
    return `<div class="vazio"><strong>Ainda sem Atributos</strong><p>${d ? `${esc(e.apelido)} ainda não tem rounds suficientes nas partidas coletadas.`
      : "Os Atributos aparecem depois da próxima coleta (eles chegam junto com os dados do site)."}</p></div>`;
  }
  const lado = LADOS.some(([k]) => k === q.get("lado")) ? q.get("lado") : "ambos";
  const L = j.lados[lado] || j.lados.ambos;
  const outras = Object.entries(j.outras_funcoes || {}).map(([f, n]) => `${f} (${n} rounds)`).join(", ");
  return `<section class="atr">
      <div class="aviso secao atr-so-admin">${icone("info")}<span>Só você vê esta aba por enquanto. Confira com a equipe se o “jeito” de cada um bate com o que vocês veem; depois ela é liberada para todos.</span></div>
      <div class="cartao atr-resumo">
        <p class="atr-frase">${esc(j.frase)}</p>
        <p class="suave pequeno">Comparado com ${num(L.base)} jogador${L.base === 1 ? "" : "es"} de ${esc(j.funcao)} nos lobbies coletados (as duas equipes de cada partida) · ${num(L.rounds)} rounds de ${esc(e.apelido)} em ${num(j.partidas)} partida${j.partidas === 1 ? "" : "s"}${outras ? ` · também jogou ${esc(outras)}` : ""}.</p>
        ${j.amostra_pequena ? `<p class="atr-amostra">${icone("relogio")} Amostra pequena: menos de ${num(d.regras.amostra_firme)} rounds na função. As notas ainda mudam bastante.</p>` : ""}
        <div class="segmentos" role="group" aria-label="Lado">${LADOS.map(([k, t]) =>
          `<button type="button" data-param="lado" data-valor="${k}" aria-pressed="${k === lado}">${t}</button>`).join("")}</div>
      </div>
      <div class="atr-grade${j.amostra_pequena ? " atr-grade--pequena" : ""}">${d.atributos.map((a) => cartaoAtributo(a, L.notas[a.id])).join("")}</div>
      <p class="suave pequeno atr-nota-rodape">As notas dizem o que a pessoa costuma fazer, não o quanto ela é boa. 50 é o normal para quem joga ${esc(j.funcao)} com vocês; cada estatística mostra a posição da pessoa entre esses jogadores. Usa todas as partidas coletadas. Toque num atributo para ver as estatísticas.</p>
    </section>`;
}
