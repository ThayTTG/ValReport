// Recordes ("Hall da fama"): o melhor número de cada estatística, com o link da partida em que aconteceu

import { esc, num, sinal, imagem, imgAgente, imgCard, dataCurta, icone, vazio } from "./util.js";
import { B } from "./dados.js";

const MIN_ROUNDS = 10;  // partidas muito curtas (rendição) distorcem as médias por round
const tiros = (m) => m.hs + m.bs + m.ls;
const maiorAbate = (m) => {
  let melhor = null;
  for (const [arma, v] of Object.entries(m.armas || {})) if (v[8] && (!melhor || v[8] > melhor[1])) melhor = [arma, v[8]];
  return melhor;
};

/** Cada recorde: [id, título, ícone, valor(it) | null, formato(valor, it), precisa de rounds mínimos?] */
const LISTA = [
  ["k", "Mais abates", "caveira", (m) => m.k, (v) => `${v}<small> abates</small>`],
  ["acs", "Maior ACS", "estrela", (m) => m.sc / m.rt, (v) => num(v), true],
  ["adr", "Maior ADR", "raio", (m) => m.dd / m.rt, (v) => num(v), true],
  ["imp", "Maior impacto", "trofeu", (m) => (m.r ? (100 * m.imp) / m.r : null), (v) => `${sinal(v, 1, "%")}<small> por round</small>`, true],
  ["ind", "Maior índice", "estrela", (m) => m.ind, (v) => `${num(v)}<small>/100</small>`],
  ["kd", "Melhor K/D", "alvo", (m) => (m.d ? m.k / m.d : m.k), (v) => num(v, 2), true],
  ["fk", "Mais first kills", "raio", (m) => m.fk, (v) => `${v}<small> first kills</small>`],
  ["a", "Mais assistências", "equipe", (m) => m.a, (v) => `${v}<small> assistências</small>`],
  ["hs", "Maior HS%", "alvo", (m) => (tiros(m) >= 25 ? (100 * m.hs) / tiros(m) : null), (v) => `${num(v, 1)}%`],
  ["mk", "Mais multi-kills", "caveira", (m) => m.mk[1] + m.mk[2] + m.mk[3], (v, m) => `${v}<small> (3K ${m.mk[1]} · 4K ${m.mk[2]} · Ace ${m.mk[3]})</small>`],
  ["cl", "Maior clutch", "escudo", (m) => { for (let i = 4; i >= 0; i--) if (m.clv[i]) return i + 1; return null; }, (v) => `1v${v}<small> vencido</small>`],
  ["dist", "Abate mais longo", "alvo", (m) => maiorAbate(m)?.[1] ?? null, (v, m) => `${num(v)} m<small> · ${esc(maiorAbate(m)[0])}</small>`],
];

/** itens: [{p, m, slug}] → [{id, titulo, icone, valor, texto, it, empates}] */
export function calcularRecordes(itens) {
  const out = [];
  for (const [id, titulo, ic, valor, fmt, porRound] of LISTA) {
    let melhor = null, empates = 0;
    for (const it of itens) {
      if (porRound && it.m.rt < MIN_ROUNDS) continue;
      const v = valor(it.m);
      if (v == null || !Number.isFinite(v) || v <= 0) continue;
      // empate: fica o mais antigo (quem chegou lá primeiro)
      if (!melhor || v > melhor.v + 1e-9) { melhor = { v, it }; empates = 0; } else if (Math.abs(v - melhor.v) < 1e-9) { empates++; if (it.p.t < melhor.it.p.t) melhor = { v, it }; }
    }
    if (melhor) out.push({ id, titulo, icone: ic, valor: melhor.v, texto: fmt(melhor.v, melhor.it.m), it: melhor.it, empates });
  }
  // Maior sequência de vitórias (em ordem de data)
  const seq = sequencia(itens);
  if (seq.n >= 2) out.push({ id: "seq", titulo: "Maior sequência de vitórias", icone: "fogo", valor: seq.n, texto: `${seq.n}<small> seguidas</small>`, it: seq.fim, empates: 0, seq });
  return out;
}

function sequencia(itens) {
  // Na equipe, uma partida pode aparecer para vários membros: conta cada partida uma vez
  const vistas = new Map();
  for (const it of itens) if (!vistas.has(it.p.id)) vistas.set(it.p.id, it);
  const crono = [...vistas.values()].sort((a, b) => (a.p.t < b.p.t ? -1 : 1));
  let n = 0, melhor = { n: 0 }, ini = null;
  for (const it of crono) {
    if (it.m.res === "V") { if (!n) ini = it; n++; if (n > melhor.n) melhor = { n, ini, fim: it }; } else n = 0;
  }
  return melhor;
}

const NOVO_DIAS = 7;
const eNovo = (t) => B.meta?.gerado_em && new Date(B.meta.gerado_em) - new Date(t) <= NOVO_DIAS * 86400000;

/** Cartão de cada recorde: quem conseguiu fica em destaque (foto, nome e o card de jogador ao fundo) */
export function gradeRecordes(recs, { mostrarNome = true } = {}) {
  if (!recs.length) return vazio("Sem recordes com estes filtros", "<p>Os recordes aparecem conforme as partidas entram no site.</p>");
  return `<div class="recordes${mostrarNome ? "" : " recordes--pessoal"}">${recs.map((r, i) => {
    const { p, m, slug } = r.it;
    const e = r.id === "seq" ? null : B.porSlug.get(slug);
    const onde = r.id === "seq" ? `${dataCurta(r.seq.ini.p.t)} → ${dataCurta(r.seq.fim.p.t)}` : `${esc(p.mapa)} · ${esc(m.ag)} · ${dataCurta(p.t)}`;
    const novo = eNovo(p.t);
    const empates = r.empates ? ` · <span title="Outras partidas chegaram no mesmo número">+${r.empates} empate${r.empates === 1 ? "" : "s"}</span>` : "";
    const fundo = mostrarNome && e ? imgCard(e.card, "wideart") : null;
    const dono = !mostrarNome ? `<span class="recorde__onde suave">${onde}${empates}</span>`
      : `<span class="recorde__dono">${e ? imagem(imgCard(e.card) || imgAgente(e.agente), e.apelido, "recorde__foto", e.apelido) : `<span class="recorde__foto recorde__foto--equipe">${icone("equipe")}</span>`}
          <span class="recorde__quem"><strong>${e ? esc(e.apelido) : "Equipe"}</strong><small class="suave">${onde}${empates}</small></span></span>`;
    return `<a class="recorde${novo ? " recorde--novo" : ""}" style="--i:${i}" href="#/p/${esc(p.id)}">
      ${fundo ? `<span class="recorde__fundo" style="background-image:url('${esc(fundo)}')" aria-hidden="true"></span>` : ""}
      <span class="recorde__topo"><span class="recorde__icone">${icone(r.icone)}</span><span class="recorde__titulo">${esc(r.titulo)}</span>
        ${novo ? `<span class="recorde__novo" title="Conquistado nos últimos ${NOVO_DIAS} dias">novo</span>` : ""}</span>
      <strong class="recorde__valor">${r.texto}</strong>
      ${dono}
    </a>`;
  }).join("")}</div>`;
}

/** Quantos recordes cada jogador tem (a sequência de vitórias é da equipe e não entra) */
export function contarDonos(recs) {
  const n = new Map();
  for (const r of recs) if (r.id !== "seq") n.set(r.it.slug, (n.get(r.it.slug) || 0) + 1);
  return n;
}

/** Pódio "donos dos recordes": quem tem mais recordes aparece primeiro, com coroa */
export function podioRecordes(recs) {
  const n = contarDonos(recs);
  const lista = [...n.entries()].map(([slug, q]) => ({ e: B.porSlug.get(slug), q, novos: recs.filter((r) => r.id !== "seq" && r.it.slug === slug && eNovo(r.it.p.t)).length }))
    .filter((x) => x.e).sort((a, b) => b.q - a.q || b.novos - a.novos);
  if (!lista.length) return "";
  const topo = lista[0].q;
  return `<div class="donos">${lista.map((x, i) => `<a class="dono${x.q === topo ? " dono--lider" : ""}" style="--i:${i}" href="#/j/${esc(x.e.slug)}/performance">
      ${x.q === topo ? `<span class="dono__coroa" aria-hidden="true">${icone("trofeu")}</span>` : ""}
      ${imagem(imgCard(x.e.card) || imgAgente(x.e.agente), x.e.apelido, "dono__foto", x.e.apelido)}
      <strong class="dono__nome">${esc(x.e.apelido)}</strong>
      <span class="dono__qtd"><b>${x.q}</b> recorde${x.q === 1 ? "" : "s"}</span>
      ${x.novos ? `<span class="recorde__novo">${x.novos} novo${x.novos === 1 ? "" : "s"}</span>` : ""}
    </a>`).join("")}</div>`;
}

/** Cartão grande do MVP da semana (usado na aba Semana e no Hall da fama) */
export function cartaoMvp({ grande = false } = {}) {
  const S = B.semana;
  const mvp = S && B.porSlug.get(S.mvp);
  const mv = mvp && S.jogadores.find((j) => j.slug === S.mvp)?.semana;
  if (!mvp || !mv) return "";
  const fundo = imgCard(mvp.card, "wideart");
  return `<a class="mvp${grande ? " mvp--grande" : ""}" href="#/j/${esc(mvp.slug)}?periodo=7">
      ${grande && fundo ? `<span class="mvp__fundo" style="background-image:url('${esc(fundo)}')" aria-hidden="true"></span>` : ""}
      <span class="mvp__brilho" aria-hidden="true"></span>
      ${imagem(imgCard(mvp.card) || imgAgente(mvp.agente), mvp.apelido, "avatar", mvp.apelido)}
      <span class="mvp__texto"><small>${icone("trofeu")} MVP da semana${grande ? ` · ${dataCurta(S.ini)} a ${dataCurta(S.fim)}` : ""}</small><strong>${esc(mvp.apelido)}</strong>
        <span class="pequeno">${sinal(mv.impacto, 1, "%")} por round · K/D ${num(mv.kd, 2)} · ADR ${num(mv.adr)}${grande ? ` · ${mv.partidas} partida${mv.partidas === 1 ? "" : "s"}` : ""}</span></span></a>`;
}
