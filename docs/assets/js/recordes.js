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

export function gradeRecordes(recs, { mostrarNome = true } = {}) {
  if (!recs.length) return vazio("Sem recordes com estes filtros", "<p>Os recordes aparecem conforme as partidas entram no site.</p>");
  return `<div class="recordes">${recs.map((r, i) => {
    const { p, m, slug } = r.it;
    const e = B.porSlug.get(slug);
    const quem = mostrarNome && e ? `<span class="recorde__quem">${imagem(imgCard(e.card) || imgAgente(e.agente), e.apelido, "", e.apelido)}${esc(e.apelido)}</span>` : "";
    const onde = r.id === "seq" ? `${dataCurta(r.seq.ini.p.t)} → ${dataCurta(r.seq.fim.p.t)}` : `${esc(p.mapa)} · ${esc(m.ag)} · ${dataCurta(p.t)}`;
    return `<a class="recorde" style="--i:${i}" href="#/p/${esc(p.id)}">
      <span class="recorde__icone">${icone(r.icone)}</span>
      <span class="recorde__titulo">${esc(r.titulo)}</span>
      <strong class="recorde__valor">${r.texto}</strong>
      <span class="recorde__rodape">${quem}<span class="suave">${onde}</span>${r.empates ? `<span class="suave" title="Outras partidas chegaram no mesmo número">+${r.empates} empate${r.empates === 1 ? "" : "s"}</span>` : ""}</span>
    </a>`;
  }).join("")}</div>`;
}
