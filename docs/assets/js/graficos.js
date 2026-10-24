// Gráficos em SVG/canvas feitos à mão (sem bibliotecas): linhas, histograma, corpo (precisão), mapa de calor e mapa 2D

import { esc, num, imgMinimapa } from "./util.js";
import { B } from "./dados.js";

/** Linha com pontos por partida + média móvel. pontos: [{y, rotulo, classe}] */
export function linha(pontos, { referencia = null, casas = 1, sufixo = "", janela = 5, altura = 200 } = {}) {
  if (pontos.length < 2) return `<p class="suave pequeno">Jogue pelo menos 2 partidas com estes filtros para ver a evolução.</p>`;
  const W = 640, H = altura, pe = 34, pd = 10, pt = 12, pb = 26;
  const ys = pontos.map((p) => p.y);
  if (referencia != null) ys.push(referencia);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const folga = (hi - lo) * 0.12; lo -= folga; hi += folga;
  const x = (i) => pe + (i * (W - pe - pd)) / (pontos.length - 1);
  const y = (v) => pt + ((hi - v) * (H - pt - pb)) / (hi - lo);
  const media = pontos.map((_, i) => {
    const ini = Math.max(0, i - janela + 1);
    const fatia = pontos.slice(ini, i + 1);
    return fatia.reduce((a, p) => a + p.y, 0) / fatia.length;
  });
  const marcas = [0, 0.5, 1].map((f) => lo + (hi - lo) * f);
  const passo = Math.max(1, Math.ceil(pontos.length / 8));
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução partida a partida">
    ${marcas.map((v) => `<line class="grade-linha" x1="${pe}" x2="${W - pd}" y1="${y(v)}" y2="${y(v)}"/><text x="${pe - 6}" y="${y(v) + 4}" text-anchor="end">${num(v, casas)}${sufixo}</text>`).join("")}
    ${referencia != null ? `<line class="linha-ref" x1="${pe}" x2="${W - pd}" y1="${y(referencia)}" y2="${y(referencia)}"/>` : ""}
    <polyline class="serie" points="${pontos.map((p, i) => `${x(i)},${y(p.y)}`).join(" ")}"/>
    <polyline class="serie-media" points="${media.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>
    ${pontos.map((p, i) => `<circle class="ponto ${esc(p.classe || "")}" cx="${x(i)}" cy="${y(p.y)}" r="4"><title>${esc(p.rotulo)}: ${num(p.y, casas)}${sufixo}</title></circle>`).join("")}
    ${pontos.map((p, i) => (i % passo === 0 || i === pontos.length - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(p.curto || "")}</text>` : "")).join("")}
  </svg>
  <div class="legenda"><span><i></i>por partida</span><span><i class="media"></i>média das últimas ${janela}</span>${referencia != null ? `<span>tracejado fino = referência</span>` : ""}</div>`;
}

/** Histograma das distâncias até o aliado mais próximo na morte (metros) */
export function histograma(dists, trade = 15, isolado = 30) {
  if (!dists.length) return `<p class="suave pequeno">Sem mortes com posição registrada.</p>`;
  const max = 50, passo = 5, faixas = Array(max / passo + 1).fill(0);
  for (const d of dists) faixas[Math.min(faixas.length - 1, Math.floor(d / passo))]++;
  const maior = Math.max(...faixas);
  return `<div class="histograma" role="img" aria-label="Distribuição da distância até o aliado mais próximo quando morreu">
    ${faixas.map((n, i) => {
      const ini = i * passo, cls = ini >= isolado ? "longe" : ini >= trade ? "medio" : "";
      return `<div class="${cls}" style="height:${(100 * n) / maior}%" title="${ini}${i === faixas.length - 1 ? "+" : `–${ini + passo}`} m: ${n} morte(s)"></div>`;
    }).join("")}
  </div><div class="eixo-hist"><span>0 m</span><span>${trade} m</span><span>${isolado} m</span><span>${max}+ m</span></div>
  <div class="legenda"><span><i></i>até ${trade} m (dá para trocar)</span><span><i style="background:var(--alerta)"></i>${trade}–${isolado} m</span><span><i style="background:var(--derrota)"></i>+${isolado} m (isolada)</span></div>`;
}

/** Silhueta com % de acertos na cabeça, corpo e pernas */
export function precisao(hs, bs, ls) {
  const fmt = (v) => (v == null ? "—" : `${num(v * 100, 1)}%`);
  const maior = Math.max(hs || 0, bs || 0, ls || 0);
  const on = (v) => (v === maior && v > 0 ? "on" : "");
  return `<div class="precisao">
    <svg viewBox="0 0 90 170" role="img" aria-label="Acertos: cabeça ${fmt(hs)}, corpo ${fmt(bs)}, pernas ${fmt(ls)}">
      <circle class="parte ${on(hs)}" cx="45" cy="18" r="14" style="opacity:${0.35 + 0.65 * (hs || 0) / (maior || 1)}"/>
      <path class="parte ${on(bs)}" style="opacity:${0.35 + 0.65 * (bs || 0) / (maior || 1)}" d="M24 38h42l10 44-10 4-5-26v32H29V60l-5 26-10-4z"/>
      <path class="parte ${on(ls)}" style="opacity:${0.35 + 0.65 * (ls || 0) / (maior || 1)}" d="M29 96h32l-2 70H48l-3-50-3 50H31z"/>
    </svg>
    <div class="precisao__linhas">
      <div><span>Cabeça</span><strong>${fmt(hs)}</strong></div>
      <div><span>Corpo</span><strong>${fmt(bs)}</strong></div>
      <div><span>Pernas</span><strong>${fmt(ls)}</strong></div>
    </div></div>`;
}

// ---------- Mapas ----------
export function projetar(mapa, x, y) {
  const t = B.meta.mapas?.[mapa]?.t;
  if (!t) return null;
  const [xm, ym, xs, ys] = t;
  const u = y * xm + xs, v = x * ym + ys;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [u, v] : null;
}
export function calloutMaisProximo(mapa, x, y, limite = 2600) {
  let melhor = null, dist = limite;
  for (const [sup, reg, cx, cy] of B.meta.mapas?.[mapa]?.callouts || []) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < dist) { dist = d; melhor = [sup, reg]; }
  }
  if (!melhor) return null;
  if (melhor[1] === "Spawn") return melhor[0].includes("Attacker") ? "Spawn de ataque" : "Spawn de defesa";
  return `${melhor[0]} ${melhor[1]}`;
}
function rotulosMapa(mapa) {
  const out = [];
  for (const [sup, reg, x, y] of B.meta.mapas?.[mapa]?.callouts || []) {
    if (reg !== "Site" && reg !== "Spawn") continue;
    const p = projetar(mapa, x, y);
    if (!p) continue;
    const spawn = reg === "Spawn";
    const txt = spawn ? (sup.includes("Attacker") ? "ATQ" : "DEF") : sup;
    out.push(`<span class="rotulo-mapa ${spawn ? "spawn" : ""}" style="left:${(p[0] * 100).toFixed(2)}%;top:${(p[1] * 100).toFixed(2)}%">${esc(txt)}</span>`);
  }
  return out.join("");
}
export function moldeMapa(mapa, conteudo = "") {
  const src = imgMinimapa(mapa);
  const sem = !B.meta.mapas?.[mapa]?.t;
  return `<div class="mapa-2d" data-mapa="${esc(mapa)}">
    ${src ? `<img src="${esc(src)}" alt="Minimapa de ${esc(mapa)}" loading="lazy" referrerpolicy="no-referrer" data-sefalhar="ocultar">` : ""}
    ${sem ? `<div class="sem-minimapa">Este mapa ainda não tem dados de projeção. Rode o report uma vez com internet para baixar.</div>` : ""}
    ${conteudo}${rotulosMapa(mapa)}</div>`;
}

const PALETA = [[0, [160, 104, 255, 0]], [0.15, [160, 104, 255, 105]], [0.45, [195, 112, 230, 165]], [0.7, [246, 184, 76, 210]], [1, [246, 112, 112, 240]]];
function corCalor(t) {
  for (let i = 1; i < PALETA.length; i++) {
    const [t1, c1] = PALETA[i], [t0, c0] = PALETA[i - 1];
    if (t <= t1) { const f = (t - t0) / (t1 - t0); return c0.map((v, k) => v + (c1[k] - v) * f); }
  }
  return PALETA[PALETA.length - 1][1];
}

/** Desenha o calor (mortes) e os pontos (mortes/abates) num canvas dentro de .mapa-2d */
export function desenharCalor(el, mapa, eventos, { mostrar = "ambos" } = {}) {
  const caixa = el.querySelector(".mapa-2d");
  if (!caixa) return;
  caixa.querySelectorAll("canvas").forEach((c) => c.remove());
  const t = B.meta.mapas?.[mapa]?.t;
  if (!t) return;
  const lado = caixa.clientWidth || 600, dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement("canvas");
  cv.width = Math.round(lado * dpr); cv.height = Math.round(lado * dpr);
  caixa.insertBefore(cv, caixa.querySelector(".rotulo-mapa"));
  const ctx = cv.getContext("2d");
  const pts = eventos.map((e) => ({ tipo: e.tipo, p: projetar(mapa, e.x, e.y) })).filter((e) => e.p);
  const mortes = pts.filter((e) => e.tipo === 0), kills = pts.filter((e) => e.tipo === 1);

  if (mostrar !== "abates" && mortes.length) {
    const G = 256, off = document.createElement("canvas");
    off.width = G; off.height = G;
    const oc = off.getContext("2d");
    const raio = Math.max(10, 330 * Math.abs(t[0]) * G * 2.6);
    for (const { p } of mortes) {
      const gr = oc.createRadialGradient(p[0] * G, p[1] * G, 0, p[0] * G, p[1] * G, raio);
      gr.addColorStop(0, "rgba(0,0,0,0.22)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      oc.fillStyle = gr; oc.fillRect(p[0] * G - raio, p[1] * G - raio, raio * 2, raio * 2);
    }
    const img = oc.getImageData(0, 0, G, G), d = img.data;
    let maior = 0;
    for (let i = 3; i < d.length; i += 4) maior = Math.max(maior, d[i]);
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / (maior || 1);
      const [r, g, b, al] = a > 0.04 ? corCalor(Math.pow(a, 0.8)) : [0, 0, 0, 0];
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = al;
    }
    oc.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, cv.width, cv.height);
  }
  const ponto = (p, cor, r) => {
    ctx.beginPath(); ctx.arc(p[0] * cv.width, p[1] * cv.height, r * dpr, 0, Math.PI * 2);
    ctx.fillStyle = cor; ctx.fill(); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = "rgba(10,8,16,.85)"; ctx.stroke();
  };
  const css = getComputedStyle(document.documentElement);
  if (mostrar !== "mortes") kills.forEach(({ p }) => ponto(p, css.getPropertyValue("--vitoria").trim() || "#54d688", 4.5));
  if (mostrar !== "abates") mortes.forEach(({ p }) => ponto(p, css.getPropertyValue("--texto").trim() || "#f0ecf8", 3.4));
}

/** SVG com os abates de um round: linha de quem matou até quem morreu */
export function svgRound(mapa, round, jogadores, nosso) {
  const linhas = [];
  for (const [t, ki, vi, arma, , vx, vy, kx, ky] of round.kills) {
    const pv = vx != null ? projetar(mapa, vx, vy) : null;
    const pk = kx != null ? projetar(mapa, kx, ky) : null;
    const matador = jogadores[ki], vitima = jogadores[vi];
    const corK = matador?.time === nosso ? "var(--nosso)" : "var(--deles)";
    const corV = vitima?.time === nosso ? "var(--nosso)" : "var(--deles)";
    const titulo = `${Math.round(t / 1000)}s · ${matador?.nome || "?"} (${matador?.ag || "?"}) → ${vitima?.nome || "?"} (${vitima?.ag || "?"}) · ${arma}`;
    if (pv && pk) linhas.push(`<line x1="${pk[0] * 1000}" y1="${pk[1] * 1000}" x2="${pv[0] * 1000}" y2="${pv[1] * 1000}" stroke="${corK}" stroke-width="5" stroke-opacity=".6" stroke-dasharray="12 8"/>`);
    if (pk) linhas.push(`<circle cx="${pk[0] * 1000}" cy="${pk[1] * 1000}" r="16" fill="${corK}" stroke="#0b0912" stroke-width="4"><title>${esc(titulo)}</title></circle>`);
    if (pv) linhas.push(`<g transform="translate(${pv[0] * 1000} ${pv[1] * 1000})"><title>${esc(titulo)}</title><circle r="19" fill="#0b0912" opacity=".8"/><path d="M-10-10L10 10M10-10L-10 10" stroke="${corV}" stroke-width="6" stroke-linecap="round"/></g>`);
  }
  for (const [ev, cor, txt] of [[round.plant, "var(--alerta)", "Spike plantada"], [round.defuse, "var(--vitoria)", "Spike desarmada"]]) {
    if (!ev || ev.x == null) continue;
    const p = projetar(mapa, ev.x, ev.y);
    if (p) linhas.push(`<g transform="translate(${p[0] * 1000} ${p[1] * 1000})"><title>${txt} aos ${Math.round((ev.t || 0) / 1000)}s</title><rect x="-17" y="-17" width="34" height="34" rx="7" transform="rotate(45)" fill="${cor}" stroke="#0b0912" stroke-width="4"/></g>`);
  }
  return `<svg viewBox="0 0 1000 1000" aria-hidden="true">${linhas.join("")}</svg>`;
}
