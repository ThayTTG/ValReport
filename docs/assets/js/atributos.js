// Aba "Atributos" do jogador: 7 notas de estilo de 0 a 100 (no jeito da HLTV), comparadas com quem joga a mesma função
// nos lobbies coletados. O cálculo é do ferramentas/atributos.py (chega em data/atributos.json).
// v2: as notas ficam numa coluna compacta à esquerda; à direita, o jeito de jogar em texto (por regras, sempre, e o
// resumo por IA por cima, quando houver). Os dois lados (ataque e defesa) vão juntos: o texto cita a diferença só
// quando ela é grande. No celular, o texto vem primeiro e as notas descem.
// Por enquanto só a administradora vê, até a conferência das notas com a equipe.

import { esc, num, icone } from "./util.js";
import { atributosDados } from "./dados.js";

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

const dataCurta = (iso) => {
  const [a, m, d] = String(iso || "").split("-");
  return d ? `${d}/${m}/${a}` : "";
};

/** Uma linha da coluna de notas: nome, nota e barra; toque abre as estatísticas */
function linhaAtributo(a, dado) {
  const n = dado?.nota ?? null;
  const linhas = (dado?.stats || []).map(([sid, v, media, pct, piso]) => {
    const s = a.stats.find((x) => x.id === sid) || { nome: sid, fmt: "n2" };
    return `<li class="atr-stat"><span class="atr-stat__nome">${esc(s.nome)}${s.maior ? "" : ` <small class="suave">(menor = mais)</small>`}</span>
        <span class="atr-stat__valor"><strong>${valor(v, s.fmt)}</strong> <small class="suave">média ${valor(media, s.fmt)}</small></span>
        ${barra(pct, s.nome)}
        ${piso != null ? `<small class="suave atr-piso">Abaixo do mínimo de ${valor(piso, s.fmt)}: a posição cai na proporção.</small>` : ""}</li>`;
  }).join("");
  return `<details class="atr-linha">
      <summary>
        <span class="atr-linha__topo"><span class="atr-linha__nome"><strong>${esc(a.nome)}</strong> <small class="suave">${esc(a.hltv)}</small></span>
          <span class="atr-nota atr--${nivel(n)}">${n ?? "—"}</span></span>
        ${barra(n, a.nome)}
      </summary>
      <div class="atr-linha__corpo">
        <p class="suave atr-desc">${esc(a.desc)}</p>
        <ul class="atr-stats">${linhas}</ul>
      </div>
    </details>`;
}

export async function htmlAtributos(e) {
  let d;
  try { d = await atributosDados(); } catch (err) { d = null; }
  const j = d?.jogadores?.[e.slug];
  if (!j) {
    return `<div class="vazio"><strong>Ainda sem Atributos</strong><p>${d ? `${esc(e.apelido)} ainda não tem rounds suficientes nas partidas coletadas.`
      : "Os Atributos aparecem depois da próxima coleta (eles chegam junto com os dados do site)."}</p></div>`;
  }
  const L = j.lados.ambos;
  const outras = Object.entries(j.outras_funcoes || {}).map(([f, n]) => `${f} (${n} rounds)`).join(", ");
  const ia = j.resumo_ia;
  return `<section class="atr">
      <div class="aviso secao atr-so-admin">${icone("info")}<span>Só você vê esta aba por enquanto. Confira com a equipe se o “jeito” de cada um bate com o que vocês veem; depois ela é liberada para todos.</span></div>
      <div class="atr-layout${j.amostra_pequena ? " atr-layout--pequena" : ""}">
        <div class="atr-painel">
          <div class="cartao atr-resumo">
            <p class="atr-frase">${esc(j.frase)}</p>
            <p class="suave pequeno">Comparado com ${num(L.base)} jogador${L.base === 1 ? "" : "es"} de ${esc(j.funcao)} nos lobbies coletados (as duas equipes de cada partida) · ${num(L.rounds)} rounds de ${esc(e.apelido)} em ${num(j.partidas)} partida${j.partidas === 1 ? "" : "s"}, ataque e defesa juntos${outras ? ` · também jogou ${esc(outras)}` : ""}.</p>
            ${j.amostra_pequena ? `<p class="atr-amostra">${icone("relogio")} Amostra pequena: menos de ${num(d.regras.amostra_firme)} rounds na função. As notas ainda mudam bastante.</p>` : ""}
            ${ia ? `<div class="atr-ia">
                <p class="atr-ia__selo"><span class="selo selo--destaque">${icone("estrela")} Resumo por IA</span> <small class="suave">${esc(dataCurta(ia.data))}${ia.atual ? "" : " · antes das partidas mais novas"}</small></p>
                <p class="atr-ia__texto">${esc(ia.texto)}</p>
              </div>` : ""}
            <div class="atr-regras">
              ${ia ? `<p class="atr-regras__rotulo">Pelos números</p>` : ""}
              <p class="atr-texto">${esc(j.texto || "")}</p>
            </div>
          </div>
          <p class="suave pequeno atr-nota-rodape">As notas dizem o que a pessoa costuma fazer, não o quanto ela é boa. 50 é o normal para quem joga ${esc(j.funcao)} com vocês. Usa todas as partidas coletadas.${ia ? " O resumo por IA é escrito só a partir destes números, sem o nome de ninguém, e pode errar: o texto “Pelos números” é sempre a referência." : ""}</p>
        </div>
        <aside class="cartao atr-notas" aria-label="Notas dos atributos">
          <div class="cartao__titulo"><h3>Notas</h3><small class="suave">0 a 100 · 50 = normal</small></div>
          ${d.atributos.map((a) => linhaAtributo(a, L.notas[a.id])).join("")}
          <p class="suave pequeno atr-notas__dica">Toque num atributo para ver as estatísticas.</p>
        </aside>
      </div>
    </section>`;
}
