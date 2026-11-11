// Aba "Atributos" do jogador: 7 notas de estilo de 0 a 100 (no jeito da HLTV), comparadas com quem joga a mesma função
// nos lobbies coletados. O cálculo é do ferramentas/atributos.py (chega em data/atributos.json).
// v2: as notas ficam numa coluna compacta à esquerda; os dois lados (ataque e defesa) vão juntos.
// v3: à direita das notas fica a comparação (radar com as 7 notas e os números frente a frente, "A × B"); o jeito de
// jogar em texto (por regras, sempre, e o resumo por IA por cima, quando houver) desce para baixo, na largura toda.
// No celular: comparação, notas e texto. A pessoa comparada vai no endereço (?vs=slug).
// Por enquanto só a administradora vê, até a conferência das notas com a equipe.

import { esc, num, icone } from "./util.js";
import { atributosDados, B } from "./dados.js";

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

// ---------- Comparação (radar) ----------
// 7 eixos, um por atributo, sempre de 0 a 100 e na mesma ordem da coluna de notas, começando no topo.
// O anel de 50 (o normal da função) fica marcado. A pessoa do perfil vai em linha cheia na cor de destaque; a pessoa
// escolhida, em linha tracejada neutra: a diferença não depende só da cor.
const RX = 190, RY = 168, RAIO = 108;
const ponto = (i, n, v) => {
  const ang = -Math.PI / 2 + (2 * Math.PI * i) / n, r = (RAIO * Math.max(0, Math.min(100, v ?? 0))) / 100;
  return [RX + r * Math.cos(ang), RY + r * Math.sin(ang)];
};
const caminho = (vals) => vals.map((v, i) => ponto(i, vals.length, v).map((x) => x.toFixed(1)).join(",")).join(" ");

function radar(atributos, series) {
  const n = atributos.length;
  const aneis = [25, 50, 75, 100].map((v) =>
    `<polygon class="atr-radar__anel${v === 50 ? " atr-radar__anel--meio" : ""}" points="${caminho(atributos.map(() => v))}"/>`).join("");
  const eixos = atributos.map((a, i) => {
    const [x, y] = ponto(i, n, 100), [tx, ty] = ponto(i, n, 122);
    const ancora = Math.abs(tx - RX) < 12 ? "middle" : tx > RX ? "start" : "end";
    return `<line class="atr-radar__eixo" x1="${RX}" y1="${RY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>
      <text class="atr-radar__rotulo" x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}" text-anchor="${ancora}">${esc(a.nome)}</text>`;
  }).join("");
  const formas = [...series].reverse().map((s) => `<polygon class="atr-radar__forma atr-radar__forma--${s.tipo}" points="${caminho(s.notas)}"/>
      ${s.notas.map((v, i) => { const [x, y] = ponto(i, n, v); return `<circle class="atr-radar__ponto atr-radar__ponto--${s.tipo}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`; }).join("")}`).join("");
  const [mx, my] = ponto(0, n, 50);
  const fala = series.map((s) => `${s.nome}: ${atributos.map((a, i) => `${a.nome} ${s.notas[i] ?? "sem nota"}`).join(", ")}`).join(". ");
  return `<svg class="atr-radar" viewBox="0 0 380 330" role="img" aria-label="${esc(`Radar das 7 notas. ${fala}`)}">
      ${aneis}${eixos}<text class="atr-radar__escala" x="${(mx + 5).toFixed(1)}" y="${(my + 3).toFixed(1)}">50</text>${formas}</svg>`;
}

function comparacao(d, e, j, vs) {
  const outros = Object.keys(d.jogadores).filter((s) => s !== e.slug && d.jogadores[s].lados?.ambos);
  const nome = (s) => B.porSlug.get(s)?.apelido || s;
  const o = vs && outros.includes(vs) ? d.jogadores[vs] : null;
  const nota = (jog, a) => jog.lados.ambos.notas[a.id]?.nota ?? null;
  const series = [{ tipo: "a", nome: e.apelido, notas: d.atributos.map((a) => nota(j, a)) }];
  if (o) series.push({ tipo: "b", nome: nome(vs), notas: d.atributos.map((a) => nota(o, a)) });
  const linhas = d.atributos.map((a) => {
    const na = nota(j, a), nb = o ? nota(o, a) : null;
    const maior = o && na != null && nb != null && na !== nb ? (na > nb ? "a" : "b") : "";
    return `<tr><th scope="row">${esc(a.nome)}</th>
        <td class="${maior === "a" ? "atr-vs__maior" : ""}">${na ?? "—"}</td>
        ${o ? `<td class="${maior === "b" ? "atr-vs__maior" : ""}">${nb ?? "—"}</td>` : ""}</tr>`;
  }).join("");
  const funcoes = o && o.funcao !== j.funcao
    ? `Cada nota compara a pessoa com quem joga a mesma função que ela: ${esc(e.apelido)} entre quem joga de ${esc(j.funcao)}, ${esc(nome(vs))} entre quem joga de ${esc(o.funcao)}.`
    : o ? `Os dois são comparados com quem joga de ${esc(j.funcao)}.` : "";
  const pequena = [j.amostra_pequena ? e.apelido : null, o?.amostra_pequena ? nome(vs) : null].filter(Boolean);
  return `<section class="cartao atr-vs" aria-label="Comparação dos atributos">
      <div class="atr-vs__topo">
        <h3 class="atr-vs__titulo"><span class="atr-vs__a">${esc(e.apelido)}</span>${o ? ` <span class="suave" aria-label="comparado com">×</span> <span class="atr-vs__b">${esc(nome(vs))}</span>` : ""}</h3>
        ${outros.length ? `<div class="chips atr-vs__escolha" role="group" aria-label="Comparar com">
            <span class="suave pequeno">Comparar com</span>
            ${outros.map((s) => `<button class="chip atr-vs__chip" type="button" data-param="vs" data-valor="${esc(s)}" aria-pressed="${s === vs && !!o}">${esc(nome(s))}</button>`).join("")}
            ${o ? `<button class="chip atr-vs__chip" type="button" data-param="vs" data-valor="-" aria-pressed="false">Ninguém</button>` : ""}
          </div>` : ""}
      </div>
      <div class="atr-vs__corpo">
        ${radar(d.atributos, series)}
        <table class="atr-vs__tabela">
          <thead><tr><th scope="col"><span class="sr">Atributo</span></th>
            <th scope="col"><span class="atr-vs__marca atr-vs__marca--a" aria-hidden="true"></span>${esc(e.apelido)}<small class="suave">${esc(j.funcao)}</small></th>
            ${o ? `<th scope="col"><span class="atr-vs__marca atr-vs__marca--b" aria-hidden="true"></span>${esc(nome(vs))}<small class="suave">${esc(o.funcao)}</small></th>` : ""}</tr></thead>
          <tbody>${linhas}</tbody>
          <tfoot><tr><th scope="row">Rounds</th><td>${num(j.rounds)}</td>${o ? `<td>${num(o.rounds)}</td>` : ""}</tr></tfoot>
        </table>
      </div>
      <p class="suave pequeno atr-vs__nota">O anel marcado é o 50, o normal da função. Mais para fora quer dizer que a pessoa faz mais aquilo, não que joga melhor.${funcoes ? ` ${funcoes}` : ""}${pequena.length ? ` Amostra pequena (${esc(pequena.join(" e "))}): o desenho ainda muda bastante.` : ""}</p>
    </section>`;
}

export async function htmlAtributos(e, q) {
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
        ${comparacao(d, e, j, q?.get("vs"))}
        <aside class="cartao atr-notas" aria-label="Notas dos atributos">
          <div class="cartao__titulo"><h3>Notas</h3><small class="suave">0 a 100 · 50 = normal</small></div>
          ${d.atributos.map((a) => linhaAtributo(a, L.notas[a.id])).join("")}
          <p class="suave pequeno atr-notas__dica">Toque num atributo para ver as estatísticas.</p>
        </aside>
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
      </div>
    </section>`;
}
