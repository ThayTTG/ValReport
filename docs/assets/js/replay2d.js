// Replay 2D (v41): o round inteiro no minimapa, com controles de vídeo e desenho por cima.
//
// De onde vêm as posições:
//   - Partidas comuns (ranked, Premier, personalizadas): a API manda a posição e a mira dos 10 jogadores em cada
//     abate, plant e defuse. Entre esses instantes o movimento é ESTIMADO (linha reta); no começo do round, cada um
//     sai do spawn do seu lado. O site avisa isso na tela.
//   - Com o replay do jogo (.vrf) processado, a partida ganha "trilhas" (posição contínua) e habilidades no mapa:
//     o mesmo visualizador usa esses dados no lugar da estimativa (d.replay, ver o plano em guias/PLANO-PRO.md).

import { B } from "./dados.js";
import { esc, icone, imgAgente, imgMinimapa, imgArmaKill } from "./util.js";
import { posicaoNaFila } from "./rever.js";

const VELOCIDADES = [0.25, 0.5, 1, 2, 4, 8];
const CORES_DESENHO = ["#ffd166", "#ff5d73", "#4cc9f0", "#ffffff"];
const RAIO_SPAWN = 450;          // espalha os 5 no spawn (unidades do jogo)
const RASTRO_MS = 3000;
const FLASH_KILL_MS = 1400;
const DETONA_MS = 45000;

const SVG_PLAY = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>`;
const SVG_PAUSA = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor"/></svg>`;
const fmtT = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// ---------- Projeção do jogo para o minimapa (0..1, sem cortar nas bordas) ----------
function projetor(mapa) {
  const t = B.meta?.mapas?.[mapa]?.t;
  if (!t) return null;
  const [xm, ym, xs, ys] = t;
  return {
    p: (x, y) => [y * xm + xs, x * ym + ys],
    // direção da mira: o vetor do jogo (cos, sin) passa pela mesma troca de eixos da projeção
    dir: (a) => { const dx = Math.sin(a) * xm, dy = Math.cos(a) * ym, n = Math.hypot(dx, dy) || 1; return [dx / n, dy / n]; },
  };
}
function spawns(mapa) {
  const out = {};
  for (const [sup, reg, x, y] of B.meta?.mapas?.[mapa]?.callouts || []) {
    if (reg !== "Spawn") continue;
    out[/attack/i.test(sup) ? "atk" : "def"] = [x, y];
  }
  return out;
}

// ---------- As trilhas de um round: por jogador, [t, x, y, mira] ordenados, e quando morreu ----------
export function montarRound(d, r) {
  const sp = spawns(d.mapa);
  const trilhas = d.jogadores.map(() => []);
  const morte = d.jogadores.map(() => null);
  let exato = Boolean(r.q?.length);
  for (const [t, ps] of r.q || []) for (const [i, x, y, a] of ps) trilhas[i]?.push([t, x, y, a]);
  for (const k of r.kills) {
    const [t, ki, vi, , , vx, vy, kx, ky] = k;
    if (vi >= 0 && vx != null) { trilhas[vi]?.push([t, vx, vy, null]); morte[vi] = { t, x: vx, y: vy }; }
    if (!r.q?.length && ki >= 0 && kx != null) trilhas[ki]?.push([t, kx, ky, null]);   // partida antiga: só quem matou e morreu
  }
  for (const ev of [r.plant, r.defuse]) if (ev?.x != null && ev.por >= 0 && !r.q?.length) trilhas[ev.por]?.push([ev.t || 0, ev.x, ev.y, null]);
  // começo: cada um no spawn do seu lado, espalhado num círculo
  const lado = (i) => (d.jogadores[i]?.time === r.atk ? "atk" : "def");
  const vagas = { atk: 0, def: 0 };
  d.jogadores.forEach((j, i) => {
    const s = sp[lado(i)];
    trilhas[i].sort((a, b) => a[0] - b[0]);
    if (s) {
      const k = vagas[lado(i)]++, ang = (k / 5) * Math.PI * 2;
      trilhas[i].unshift([0, s[0] + Math.cos(ang) * RAIO_SPAWN, s[1] + Math.sin(ang) * RAIO_SPAWN, null]);
    } else if (trilhas[i].length) trilhas[i].unshift([0, trilhas[i][0][1], trilhas[i][0][2], null]);
  });
  // fim do round: depois do último evento (ou a explosão da spike)
  const ultimo = Math.max(0, ...r.kills.map((k) => k[0]), r.plant?.t || 0, r.defuse?.t || 0);
  const fim = /detona/i.test(r.fim || "") && r.plant?.t ? r.plant.t + DETONA_MS : ultimo + 3000;
  return { trilhas, morte, fim: Math.max(fim, 8000), exato, lado };
}

/** Posição (x, y do jogo) e mira de um jogador no instante t */
function posicao(tr, t) {
  if (!tr.length) return null;
  if (t <= tr[0][0]) return { x: tr[0][1], y: tr[0][2], a: tr.find((s) => s[3] != null)?.[3] ?? null };
  for (let k = 1; k < tr.length; k++) {
    const [t1, x1, y1, a1] = tr[k];
    if (t <= t1) {
      const [t0, x0, y0, a0] = tr[k - 1], f = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
      let a = a1 ?? a0;
      if (a0 != null && a1 != null) { let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; a = a0 + da * f; }
      return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, a };
    }
  }
  const u = tr[tr.length - 1];
  return { x: u[1], y: u[2], a: [...tr].reverse().find((s) => s[3] != null)?.[3] ?? null };
}

// ---------- HTML ----------
// Layout de analista (mapa grande, times à direita, ferramentas, rounds e linha do tempo embaixo)
export function htmlReplay(d, rSel) {
  const vence = (r) => (r.venc === d.nosso ? "nosso" : "deles");
  const ladoNosso = (r) => (r.atk === d.nosso ? "ATQ" : "DEF");
  const ferr = (id, ic, rot) => `<button type="button" class="rp-ferr" data-ferr="${id}" aria-pressed="false" title="${rot}" aria-label="${rot}">${ic}</button>`;
  const acao = (id, ic, rot) => `<button type="button" class="rp-ferr" data-acao="${id}" title="${rot}" aria-label="${rot}">${ic}</button>`;
  const temQuadros = d.rounds.some((r) => r.q?.length);
  const meio = Math.min(12, Math.floor(d.rounds.length / 2));
  return `<div class="rp" data-replay tabindex="-1">
    <div class="rp-palco" data-palco>
      <canvas class="rp-mapa" data-tela-mapa></canvas>
      <canvas class="rp-desenho" data-tela-desenho></canvas>
      <div class="rp-selo" data-placar></div>
      <p class="rp-aviso-mapa" title="${temQuadros ? "Posições exatas em cada abate, plant e defuse; entre eles o caminho é estimado. Com o replay do jogo (.vrf), o movimento fica completo." : "Partida exportada antes do replay 2D: só quem matou e quem morreu."}">${icone("info")} ${temQuadros ? "Movimento estimado entre os eventos" : "Só abates (partida antiga)"}</p>
    </div>
    <aside class="rp-times" data-times aria-label="Times"></aside>
    <div class="rp-barra">
      <div class="rp-ferramentas" role="toolbar" aria-label="Ferramentas">
        <span class="rp-pop"><button type="button" class="rp-ferr" data-abrir="config" title="Configurações" aria-label="Configurações" aria-expanded="false">${icone("filtro")}</button>
          <span class="rp-pop__caixa" data-pop="config" hidden>
            <label><input type="checkbox" data-op="nomes" checked> Nomes <kbd>N</kbd></label>
            <label><input type="checkbox" data-op="mira" checked> Cone da mira <kbd>V</kbd></label>
            <label><input type="checkbox" data-op="rastro" checked> Rastro (3 s) <kbd>R</kbd></label></span></span>
        <span class="rp-pop"><button type="button" class="rp-ferr" data-abrir="teclas" title="Atalhos" aria-label="Atalhos do teclado" aria-expanded="false">${icone("texto")}</button>
          <span class="rp-pop__caixa rp-pop__caixa--teclas" data-pop="teclas" hidden>
            <span><kbd>Espaço</kbd> play/pausa</span><span><kbd>←</kbd><kbd>→</kbd> 5 s (Shift: 1 s)</span><span><kbd>,</kbd><kbd>.</kbd> round anterior/próximo</span>
            <span><kbd>1</kbd>…<kbd>6</kbd> velocidade</span><span><kbd>P</kbd> caneta · <kbd>A</kbd> seta · <kbd>C</kbd> círculo · <kbd>E</kbd> borracha</span>
            <span><kbd>Esc</kbd> só assistir · <kbd>Ctrl</kbd><kbd>Z</kbd> desfazer · <kbd>F</kbd> tela cheia</span>
            <span>Roda do mouse: zoom · arrastar: mover o mapa · duplo clique: mapa inteiro</span></span></span>
        <i class="rp-sep"></i>
        ${ferr("mover", icone("mover"), "Mão: arrastar o mapa · toque = play/pausa (Esc)")}
        ${ferr("caneta", icone("lapis"), "Caneta (P)")}
        ${ferr("seta", icone("seta"), "Seta (A)")}
        ${ferr("circulo", icone("circulo"), "Círculo (C)")}
        ${ferr("borracha", icone("borracha"), "Borracha (E)")}
        <span class="rp-cores">${CORES_DESENHO.map((c, k) => `<button type="button" class="rp-cor" data-cor="${c}" aria-pressed="${k === 0}" style="--c:${c}" aria-label="Cor ${k + 1}"></button>`).join("")}</span>
        <i class="rp-sep"></i>
        ${acao("desfazer", icone("desfazer"), "Desfazer (Ctrl+Z)")}
        ${acao("limpar", icone("fechar"), "Limpar o desenho do round")}
        ${acao("salvar", icone("imagem"), "Salvar imagem (mapa + desenho)")}
        ${acao("zoom-mais", icone("mais"), "Aproximar (roda do mouse)")}
        ${acao("zoom-menos", "<b class=\"rp-menos\">−</b>", "Afastar (duplo clique volta ao mapa inteiro)")}
        ${acao("tela-cheia", icone("expandir"), "Tela cheia (F)")}
      </div>
      <div class="rp-rounds-linha">
        <button type="button" class="rp-multi" data-acao="multi" aria-pressed="false" title="Ver vários rounds juntos (toque nos números para escolher)">${icone("slides")} Vários rounds</button>
        <span class="rp-multi-atalhos"><button type="button" data-acao="multi-atk">Ataques</button><button type="button" data-acao="multi-def">Defesas</button></span>
        <button type="button" class="rp-seta" data-acao="anterior" aria-label="Round anterior">${icone("voltar")}</button>
        <div class="rp-rounds" data-rounds role="tablist" aria-label="Rounds">${d.rounds.map((r) => `${r.n === meio + 1 ? `<i class="rp-meio" aria-hidden="true"></i>` : ""}<button type="button" class="rp-round rp-round--${vence(r)}" data-round="${r.n}" aria-pressed="${r.n === rSel}" title="Round ${r.n} · ${ladoNosso(r)} · ${vence(r) === "nosso" ? "vitória" : "derrota"}">${r.n}</button>`).join("")}</div>
        <button type="button" class="rp-seta rp-seta--prox" data-acao="proximo" aria-label="Próximo round">${icone("voltar")}</button>
      </div>
      <div class="rp-tempo-linha">
        <button type="button" class="rp-play" data-acao="play" title="Play/pausa (espaço)" aria-label="Play">${SVG_PLAY}</button>
        <button type="button" class="rp-vel" data-acao="vel" title="Velocidade (1 a 6)" aria-label="Velocidade">1x</button>
        <span class="rp-relogio">${icone("relogio")}<b data-tempo>0:00</b></span>
        <div class="rp-trilha" data-trilha role="slider" tabindex="0" aria-label="Tempo do round" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="rp-trilha__eventos" data-marcas></div>
          <i class="rp-cabeca" data-cabeca></i>
        </div>
      </div>
    </div>
    <div class="rp-feed" data-feed aria-live="off"></div>
    <div class="rp-fila" data-fila hidden></div>
  </div>`;
}

// ---------- Comportamento ----------
export function ligarReplay(raiz, d, rSel = 1) {
  const el = raiz.querySelector("[data-replay]");
  if (!el) return;
  const proj = projetor(d.mapa);
  const palco = el.querySelector("[data-palco]"), cv = el.querySelector("[data-tela-mapa]"), cd = el.querySelector("[data-tela-desenho]");
  const ctx = cv.getContext("2d"), cx = cd.getContext("2d");
  const trilha = el.querySelector("[data-trilha]"), cabeca = el.querySelector("[data-cabeca]"), tempoEl = el.querySelector("[data-tempo]"), velEl = el.querySelector('[data-acao="vel"]');
  const mostrarTempo = () => {
    const f = S.round ? S.t / S.round.fim : 0;
    cabeca.style.left = `${(f * 100).toFixed(3)}%`;
    trilha.setAttribute("aria-valuenow", String(Math.round(f * 100)));
    tempoEl.textContent = fmtT(S.t);
  };
  const definirVel = (v) => { S.vel = v; velEl.textContent = `${v}x`; };
  const css = getComputedStyle(document.documentElement);
  const COR = { nosso: css.getPropertyValue("--nosso").trim() || "#4cc9f0", deles: css.getPropertyValue("--deles").trim() || "#ff5d73" };
  const imgs = new Map();
  let manchado = false;   // alguma imagem veio sem permissão (CORS): o canvas não pode virar arquivo
  const imagemDe = (src) => {
    if (!src) return null;
    if (!imgs.has(src)) {
      const im = new Image();
      im.crossOrigin = "anonymous"; im.referrerPolicy = "no-referrer";
      im.onload = () => pedir();
      im.onerror = () => {   // o servidor (ou o cache do app) não liberou: carrega sem CORS
        const im2 = new Image(); im2.referrerPolicy = "no-referrer";
        im2.onload = () => { manchado = true; pedir(); };
        im2.src = src; imgs.set(src, im2);
      };
      im.src = src; imgs.set(src, im);
    }
    const im = imgs.get(src);
    return im.complete && im.naturalWidth ? im : null;
  };
  const S = { round: null, r: null, t: 0, tocando: false, vel: 1, ult: 0, op: { nomes: true, mira: true, rastro: true },
    ferr: "mover", cor: CORES_DESENHO[0], desenhos: new Map(), atual: null, lado: 0,
    zoom: 1, cx: 0.5, cy: 0.5, multi: null };   // multi: Set de rounds tocando juntos (null = um round só)

  // tamanho do palco (quadrado, nítido em telas de alta densidade)
  const medir = () => {
    const lado = Math.floor(palco.clientWidth);
    if (!lado || lado === S.lado) return;
    S.lado = lado;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [cv, cd]) { c.width = lado * dpr; c.height = lado * dpr; c.style.width = c.style.height = `${lado}px`; c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0); }
    pedir(); desenharTinta();
  };
  new ResizeObserver(medir).observe(palco);

  // ---------- round ----------
  function abrirRound(n, { tocar = false } = {}) {
    const r = d.rounds.find((x) => x.n === n) || d.rounds[0];
    if (!r) return;
    S.r = r; S.round = montarRound(d, r); S.t = 0;
    el.querySelectorAll("[data-round]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.round) === r.n)));
    el.querySelector(`[data-round="${r.n}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
    // marcas na linha do tempo
    const pos = (t) => `${(100 * t / S.round.fim).toFixed(2)}%`;
    const time = (i) => (d.jogadores[i]?.time === d.nosso ? "nosso" : "deles");
    const fimSpike = r.defuse ? r.defuse.t || 0 : S.round.fim;
    el.querySelector("[data-marcas]").innerHTML = (r.plant ? `<span class="rp-spike" style="left:${pos(r.plant.t || 0)};width:${(100 * (fimSpike - (r.plant.t || 0)) / S.round.fim).toFixed(2)}%"><b>Spike${r.plant.site ? ` ${esc(r.plant.site)}` : ""}</b></span>` : "")
      + r.kills.map(([t, ki, vi]) => `<i class="rp-evento rp-evento--${time(ki)}" style="left:${pos(t)}" title="${fmtT(t)} · ${esc(nomeDe(ki))} → ${esc(nomeDe(vi))}"></i>`).join("")
      + (r.plant ? `<i class="rp-evento rp-evento--plant" style="left:${pos(r.plant.t || 0)}" title="Plant ${fmtT(r.plant.t || 0)}"></i>` : "")
      + (r.defuse ? `<i class="rp-evento rp-evento--defuse" style="left:${pos(r.defuse.t || 0)}" title="Defuse ${fmtT(r.defuse.t || 0)}"></i>` : "");
    try { history.replaceState(null, "", location.hash.replace(/([?&])r=\d+/, `$1r=${r.n}`).replace(/^(#[^?]*)$/, `$1?r=${r.n}`)); } catch (e) { /* ok */ }
    // v47: veio da fila "Rounds para rever"? mostra a posição e o próximo
    const fila = posicaoNaFila(d.id, r.n), barra = el.querySelector("[data-fila]");
    barra.hidden = !fila;
    if (fila) {
      const ir = (x) => `#/p/${encodeURIComponent(x[0])}/mapa?r=${x[1]}`;
      barra.innerHTML = `<span>${icone("video")} Fila de revisão · <b>${fila.i + 1}</b> de ${fila.total}</span>
        ${fila.anterior ? `<a class="botao-secundario botao-mini" href="${ir(fila.anterior)}">Anterior</a>` : ""}
        ${fila.proximo ? `<a class="botao-primario botao-mini" href="${ir(fila.proximo)}">Próximo da fila ${icone("seta")}</a>` : `<a class="botao-secundario botao-mini" href="#/equipe/rever">Fim da fila · voltar à lista</a>`}`;
    }
    desenharTinta();
    tocar ? play(true) : atualizar();
  }

  // ---------- quadro ----------
  let pedido = 0;
  function pedir() { if (!pedido) pedido = requestAnimationFrame(() => { pedido = 0; desenhar(); }); }
  // mapa (0..1) → tela, com zoom e centro; e o inverso (para o desenho e o zoom no cursor)
  const tela = (u, v) => [((u - S.cx) * S.zoom + 0.5) * S.lado, ((v - S.cy) * S.zoom + 0.5) * S.lado];
  const mapaDe = (sx, sy) => [(sx / S.lado - 0.5) / S.zoom + S.cx, (sy / S.lado - 0.5) / S.zoom + S.cy];
  function px(x, y) { const [u, v] = proj.p(x, y); return tela(u, v); }
  function limitarCentro() {
    const m = 0.5 / S.zoom;
    S.cx = Math.min(1 - m, Math.max(m, S.cx)); S.cy = Math.min(1 - m, Math.max(m, S.cy));
    if (S.zoom <= 1) { S.cx = 0.5; S.cy = 0.5; }
  }
  function zoomEm(fator, sx = S.lado / 2, sy = S.lado / 2) {
    const [u, v] = mapaDe(sx, sy);
    S.zoom = Math.min(5, Math.max(1, S.zoom * fator));
    // mantém o ponto do cursor no mesmo lugar da tela
    S.cx = u - (sx / S.lado - 0.5) / S.zoom; S.cy = v - (sy / S.lado - 0.5) / S.zoom;
    limitarCentro(); pedir(); desenharTinta();
  }
  function desenhar() {
    if (!S.lado || !S.round) return;
    const L = S.lado, t = S.t;
    ctx.clearRect(0, 0, L, L);
    const mini = imagemDe(imgMinimapa(d.mapa));
    if (mini) { const [x0, y0] = tela(0, 0); ctx.globalAlpha = .9; ctx.drawImage(mini, x0, y0, L * S.zoom, L * S.zoom); ctx.globalAlpha = 1; }
    if (!proj) return;
    const rp = Math.max(7, L * 0.0155);   // tamanho do boneco na tela (não cresce com o zoom)
    if (S.multi?.size) {
      for (const n of S.multi) { const x = rodadas.get(n); if (x) desenharRound(x.r, x.R, Math.min(t, x.R.fim), rp * 0.72, n); }
    } else desenharRound(S.r, S.round, t, rp, null);
  }
  const rodadas = new Map();   // n → { r, R } (vários rounds)
  function desenharRound(r, R, t, rp, rotulo) {
    const L = S.lado, multi = rotulo != null;
    // spike
    if (r.plant?.x != null && t >= (r.plant.t || 0)) {
      const [x, y] = px(r.plant.x, r.plant.y), pulso = 1 + 0.25 * Math.sin(t / 180);
      const desarmada = r.defuse && t >= (r.defuse.t || 0);
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = desarmada ? "#4cc9f0" : "#ff5d73"; ctx.strokeStyle = "#0b0912"; ctx.lineWidth = 2;
      const sz = rp * 0.85 * (desarmada ? 1 : pulso); ctx.fillRect(-sz / 2, -sz / 2, sz, sz); ctx.strokeRect(-sz / 2, -sz / 2, sz, sz); ctx.restore();
    }
    // abates recentes: linha de quem matou até quem morreu
    if (!multi) for (const [tk, ki, , , , vx, vy, kx, ky] of r.kills) {
      if (t < tk || t - tk > FLASH_KILL_MS || vx == null) continue;
      const pk = kx != null ? px(kx, ky) : null, pv = px(vx, vy), f = 1 - (t - tk) / FLASH_KILL_MS;
      if (pk) { ctx.strokeStyle = d.jogadores[ki]?.time === d.nosso ? COR.nosso : COR.deles; ctx.globalAlpha = f; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(...pk); ctx.lineTo(...pv); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
    }
    // jogadores
    d.jogadores.forEach((j, i) => {
      const tr = R.trilhas[i];
      if (!tr.length) return;
      const cor = j.time === d.nosso ? COR.nosso : COR.deles, m = R.morte[i];
      if (m && t >= m.t) {   // morto: X onde caiu
        const [x, y] = px(m.x, m.y), k = rp * .55;
        ctx.globalAlpha = multi ? .5 : .75; ctx.strokeStyle = cor; ctx.lineWidth = 2.5; ctx.beginPath();
        ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.stroke(); ctx.globalAlpha = 1;
        return;
      }
      const p = posicao(tr, t);
      if (!p) return;
      const [x, y] = px(p.x, p.y);
      if (S.op.rastro) {
        ctx.strokeStyle = cor; ctx.globalAlpha = multi ? .25 : .35; ctx.lineWidth = 2; ctx.beginPath();
        for (let k = 0; k <= 12; k++) { const q = posicao(tr, Math.max(0, t - RASTRO_MS + (k * RASTRO_MS) / 12)); const [a, b] = px(q.x, q.y); k ? ctx.lineTo(a, b) : ctx.moveTo(a, b); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (S.op.mira && p.a != null && !multi) {
        const [dx, dy] = proj.dir(p.a), ang = Math.atan2(dy, dx), alc = rp * 4;
        ctx.globalAlpha = .28; ctx.fillStyle = cor; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, alc, ang - 0.5, ang + 0.5); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.arc(x, y, rp, 0, Math.PI * 2); ctx.fillStyle = "#0b0912"; ctx.fill();
      const ic = imagemDe(imgAgente(j.ag));
      if (ic) { ctx.save(); ctx.beginPath(); ctx.arc(x, y, rp - 1.5, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(ic, x - rp, y - rp, rp * 2, rp * 2); ctx.restore(); }
      ctx.lineWidth = 2.5; ctx.strokeStyle = cor; ctx.beginPath(); ctx.arc(x, y, rp, 0, Math.PI * 2); ctx.stroke();
      const rot = multi ? `R${rotulo}` : S.op.nomes ? (j.slug ? j.nome : j.ag) : "";
      if (rot) {
        ctx.font = `600 ${multi ? 9.5 : Math.max(10, L * 0.0145)}px Inter, system-ui, sans-serif`; ctx.textAlign = "center";
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(11,9,18,.85)"; ctx.strokeText(rot, x, y + rp + 11); ctx.fillStyle = "#fff"; ctx.fillText(rot, x, y + rp + 11);
      }
    });
  }

  const nomeDe = (i) => { const j = d.jogadores[i]; return j ? (j.slug ? j.nome : j.ag) : "?"; };
  // ---------- painéis (times, placar, killfeed) ----------
  function atualizar() {
    if (S.multi) { mostrarTempo(); pedir(); return; }
    const R = S.round, r = S.r, t = S.t;
    mostrarTempo();
    const placarAte = (n) => d.rounds.filter((x) => x.n < n).reduce((o, x) => { o[x.venc === d.nosso ? 0 : 1]++; return o; }, [0, 0]);
    const [a, b] = placarAte(r.n);
    el.querySelector("[data-placar]").innerHTML = `R${r.n} · ${r.atk === d.nosso ? "Equipe no ataque" : "Equipe na defesa"}`;
    const eco = Object.fromEntries((r.eco || []).map(([i, arma, escudo, carga, sobra]) => [i, { arma, escudo, carga, sobra }]));
    // abates e mortes na partida até este instante (rounds anteriores + o atual até t)
    const kd = d.jogadores.map(() => [0, 0]);
    for (const x of d.rounds) {
      if (x.n > r.n) break;
      for (const [tk, ki, vi] of x.kills) { if (x.n === r.n && tk > t) continue; if (kd[ki]) kd[ki][0]++; if (kd[vi]) kd[vi][1]++; }
    }
    const escudo = (n) => (/heavy/i.test(n) ? "Pesado" : /light/i.test(n) ? "Leve" : /regen/i.test(n) ? "Regen." : n ? "Colete" : "");
    const linha = (j, i) => {
      const m = R.morte[i], morto = m && t >= m.t, e = eco[i] || {};
      const arma = e.arma ? imgArmaKill(e.arma) : null;
      return `<div class="rp-j${morto ? " morto" : ""}">
        <span class="rp-j__topo"><span class="rp-j__ag">${imgAgente(j.ag) ? `<img src="${esc(imgAgente(j.ag))}" alt="" loading="lazy">` : ""}</span>
          <strong>${esc(j.slug ? j.nome : j.ag)}</strong><small>${kd[i][0]} / ${kd[i][1]}</small>
          ${arma ? `<img class="rp-j__arma" src="${esc(arma)}" alt="${esc(e.arma)}" title="${esc(e.arma)}" loading="lazy">` : `<small class="rp-j__arma-txt">${esc(e.arma || "")}</small>`}</span>
        <span class="rp-j__vida"><i style="width:${morto ? 0 : 100}%"></i></span>
        <span class="rp-j__base"><small>${e.sobra != null ? `$${e.sobra}` : e.carga ? `equip. ${e.carga}` : ""}</small><small>${escudo(e.escudo) ? `${icone("escudo")} ${escudo(e.escudo)}` : ""}</small>
          <small class="rp-j__estado">${morto ? "morto" : ""}</small></span></div>`;
    };
    const cartaoTime = (nosso, pts) => {
      const lista = d.jogadores.map((j, i) => [j, i]).filter(([j]) => (j.time === d.nosso) === nosso);
      const lado = (r.atk === d.nosso) === nosso ? "ATQ" : "DEF";
      return `<section class="rp-time rp-time--${nosso ? "nosso" : "deles"}"><header><strong>${nosso ? esc(B.equipeAtual?.nome || "Equipe") : "Adversário"}</strong><small>${lado}</small><b>${pts}</b></header>
        ${lista.map(([j, i]) => linha(j, i)).join("")}</section>`;
    };
    el.querySelector("[data-times]").innerHTML = cartaoTime(true, a) + cartaoTime(false, b);
    el.querySelector("[data-feed]").innerHTML = r.kills.map(([tk, ki, vi, arma, tipo]) => {
      const k = d.jogadores[ki] || {}, v = d.jogadores[vi] || {}, ja = tk <= t;
      const icon = tipo === "W" ? imgArmaKill(arma) : null;
      return `<button type="button" class="rp-kill${ja ? "" : " futuro"}" data-ir="${tk}"><time>${fmtT(tk)}</time>
        <span class="${k.time === d.nosso ? "nosso-txt" : "deles-txt"}">${esc(k.slug ? k.nome : k.ag || "?")}</span>
        ${icon ? `<img src="${esc(icon)}" alt="${esc(arma)}" loading="lazy">` : `<small>${esc(arma || "")}</small>`}
        <span class="${v.time === d.nosso ? "nosso-txt" : "deles-txt"}">${esc(v.slug ? v.nome : v.ag || "?")}</span></button>`;
    }).join("") || `<p class="suave pequeno">Nenhum abate neste round.</p>`;
    pedir();
  }

  // ---------- tocar ----------
  function passo(agora) {
    if (!S.tocando) return;
    const dt = Math.min(100, agora - (S.ult || agora));
    S.ult = agora;
    S.t = Math.min(S.round.fim, S.t + dt * S.vel);
    atualizarLeve();
    if (S.t >= S.round.fim) { play(false); return; }
    requestAnimationFrame(passo);
  }
  let ultPainel = 0;
  function atualizarLeve() {   // o mapa a cada quadro; os painéis 4x por segundo
    pedir();
    mostrarTempo();
    if (performance.now() - ultPainel > 250) { ultPainel = performance.now(); atualizar(); }
  }
  function play(sim = !S.tocando) {
    if (sim && S.t >= S.round.fim) S.t = 0;
    S.tocando = sim; S.ult = 0;
    const b = el.querySelector('[data-acao="play"]');
    b.classList.toggle("tocando", sim); b.setAttribute("aria-label", sim ? "Pausar" : "Play"); b.innerHTML = sim ? SVG_PAUSA : SVG_PLAY;
    if (sim) requestAnimationFrame(passo); else atualizar();
  }
  const irPara = (t) => { S.t = Math.max(0, Math.min(S.round.fim, t)); atualizar(); };

  // ---------- desenho ----------
  const tinta = () => { if (!S.desenhos.has(S.r.n)) S.desenhos.set(S.r.n, []); return S.desenhos.get(S.r.n); };
  function desenharTinta() {
    if (!S.lado || !S.r) return;
    const L = S.lado;
    cx.clearRect(0, 0, L, L);
    for (const tr of [...tinta(), ...(S.atual ? [S.atual] : [])]) {
      cx.strokeStyle = tr.cor; cx.fillStyle = tr.cor; cx.lineWidth = Math.max(3, L * 0.005); cx.lineCap = "round"; cx.lineJoin = "round";
      const pts = tr.pts.map(([u, v]) => tela(u, v));
      if (!pts.length) continue;
      if (tr.tipo === "caneta") { cx.beginPath(); pts.forEach(([x, y], k) => (k ? cx.lineTo(x, y) : cx.moveTo(x, y))); cx.stroke(); }
      else if (tr.tipo === "seta" && pts.length > 1) {
        const [a, b] = [pts[0], pts[pts.length - 1]], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), cab = Math.max(12, L * 0.025);
        cx.beginPath(); cx.moveTo(...a); cx.lineTo(...b); cx.stroke();
        cx.beginPath(); cx.moveTo(...b); cx.lineTo(b[0] - cab * Math.cos(ang - 0.45), b[1] - cab * Math.sin(ang - 0.45)); cx.lineTo(b[0] - cab * Math.cos(ang + 0.45), b[1] - cab * Math.sin(ang + 0.45)); cx.closePath(); cx.fill();
      } else if (tr.tipo === "circulo" && pts.length > 1) {
        const [a, b] = [pts[0], pts[pts.length - 1]];
        cx.beginPath(); cx.arc(a[0], a[1], Math.hypot(b[0] - a[0], b[1] - a[1]), 0, Math.PI * 2); cx.stroke();
      }
    }
  }
  const ponto = (ev) => { const b = cd.getBoundingClientRect(); return mapaDe(((ev.clientX - b.left) / b.width) * S.lado, ((ev.clientY - b.top) / b.height) * S.lado); };
  // mão: arrastar move o mapa (com zoom); um toque sem arrastar dá play/pausa
  let arrasto = null;
  cd.addEventListener("pointerdown", (ev) => {
    if (S.ferr === "mover") { cd.setPointerCapture(ev.pointerId); arrasto = { x: ev.clientX, y: ev.clientY, cx: S.cx, cy: S.cy, moveu: false }; return; }
    cd.setPointerCapture(ev.pointerId);
    if (S.ferr === "borracha") { apagarPerto(ponto(ev)); return; }
    S.atual = { tipo: S.ferr, cor: S.cor, pts: [ponto(ev)] };
  });
  cd.addEventListener("pointermove", (ev) => {
    if (arrasto) {
      const b = cd.getBoundingClientRect(), dx = (ev.clientX - arrasto.x) / b.width, dy = (ev.clientY - arrasto.y) / b.height;
      if (Math.abs(dx) + Math.abs(dy) > 0.006) arrasto.moveu = true;
      if (arrasto.moveu && S.zoom > 1) { S.cx = arrasto.cx - dx / S.zoom; S.cy = arrasto.cy - dy / S.zoom; limitarCentro(); pedir(); desenharTinta(); }
      return;
    }
    if (S.ferr === "borracha" && ev.buttons) { apagarPerto(ponto(ev)); return; }
    if (!S.atual) return;
    const p = ponto(ev);
    if (S.atual.tipo === "caneta") S.atual.pts.push(p); else S.atual.pts[1] = p;
    desenharTinta();
  });
  const soltar = () => {
    if (arrasto) { const clique = !arrasto.moveu; arrasto = null; if (clique) play(); return; }
    if (S.atual) { if (S.atual.pts.length > 1 || S.atual.tipo === "caneta") tinta().push(S.atual); S.atual = null; desenharTinta(); } };
  cd.addEventListener("pointerup", soltar);
  cd.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const b = cd.getBoundingClientRect();
    zoomEm(ev.deltaY < 0 ? 1.18 : 1 / 1.18, ((ev.clientX - b.left) / b.width) * S.lado, ((ev.clientY - b.top) / b.height) * S.lado);
  }, { passive: false });
  cd.addEventListener("dblclick", () => { S.zoom = 1; limitarCentro(); pedir(); desenharTinta(); });
  cd.addEventListener("pointercancel", soltar);
  function apagarPerto([u, v]) {
    const lista = tinta(), antes = lista.length;
    const fica = lista.filter((tr) => !tr.pts.some(([a, b]) => Math.hypot(a - u, b - v) < 0.02));
    if (fica.length !== antes) { S.desenhos.set(S.r.n, fica); desenharTinta(); }
  }
  function escolherFerramenta(f) {
    S.ferr = f;
    el.querySelectorAll("[data-ferr]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.ferr === f)));
    cd.classList.toggle("ativo", f !== "mover");
    cd.style.cursor = f === "mover" ? "grab" : f === "borracha" ? "cell" : "crosshair";
  }
  function salvarImagem() {
    try {
      const L = S.lado, dpr = cv.width / L, junto = document.createElement("canvas");
      junto.width = cv.width; junto.height = cv.height;
      const j = junto.getContext("2d"); j.fillStyle = "#0b0912"; j.fillRect(0, 0, junto.width, junto.height);
      j.drawImage(cv, 0, 0); j.drawImage(cd, 0, 0);
      j.scale(dpr, dpr); j.font = "600 14px Inter, system-ui, sans-serif"; j.fillStyle = "#fff"; j.fillText(`${d.mapa} · R${S.r.n} · ${fmtT(S.t)} · ValReport`, 10, L - 10);
      const a = document.createElement("a"); a.download = `${d.mapa}-R${S.r.n}-${fmtT(S.t).replace(":", "m")}s.png`; a.href = junto.toDataURL("image/png"); a.click();
    } catch (e) { alert(manchado ? "As imagens do jogo vieram sem permissão para virar arquivo neste navegador. Use o print da tela (Win+Shift+S)." : "Não deu para salvar a imagem neste navegador."); }
  }

  // ---------- vários rounds ao mesmo tempo ----------
  function prepararMulti() {
    rodadas.clear();
    for (const n of S.multi) { const r = d.rounds.find((x) => x.n === n); if (r) rodadas.set(n, { r, R: montarRound(d, r) }); }
    const fim = Math.max(8000, ...[...rodadas.values()].map((x) => x.R.fim));
    S.round = { ...S.round, fim };
    el.querySelectorAll("[data-round]").forEach((b) => b.classList.toggle("rp-round--multi", S.multi.has(Number(b.dataset.round))));
    el.querySelector("[data-placar]").innerHTML = `${S.multi.size} round${S.multi.size === 1 ? "" : "s"} juntos`;
    el.querySelector("[data-marcas]").innerHTML = "";
    S.t = Math.min(S.t, fim); mostrarTempo(); pedir();
  }
  function alternarMulti() {
    const b = el.querySelector('[data-acao="multi"]');
    if (S.multi) {   // sai do modo: volta para o round que estava aberto
      S.multi = null; b.setAttribute("aria-pressed", "false"); el.classList.remove("rp--multi");
      el.querySelectorAll("[data-round]").forEach((x) => x.classList.remove("rp-round--multi"));
      abrirRound(S.r.n); return;
    }
    S.multi = new Set([S.r.n]); b.setAttribute("aria-pressed", "true"); el.classList.add("rp--multi");
    prepararMulti();
  }
  function alternarRoundMulti(n) { if (S.multi.has(n) && S.multi.size > 1) S.multi.delete(n); else S.multi.add(n); prepararMulti(); }
  function escolherLado(ataque) {
    if (!S.multi) alternarMulti();
    S.multi = new Set(d.rounds.filter((r) => (r.atk === d.nosso) === ataque).map((r) => r.n));
    prepararMulti();
  }

  // ---------- eventos ----------
  el.addEventListener("click", (ev) => {
    const rb = ev.target.closest("[data-round]");
    if (rb) { if (S.multi) alternarRoundMulti(Number(rb.dataset.round)); else abrirRound(Number(rb.dataset.round)); return; }
    const fb = ev.target.closest("[data-ferr]"); if (fb) { escolherFerramenta(fb.dataset.ferr); return; }
    const cb = ev.target.closest("[data-cor]");
    if (cb) { S.cor = cb.dataset.cor; el.querySelectorAll("[data-cor]").forEach((x) => x.setAttribute("aria-pressed", String(x === cb))); if (S.ferr === "mover" || S.ferr === "borracha") escolherFerramenta("caneta"); return; }
    const ir = ev.target.closest("[data-ir]"); if (ir) { irPara(Number(ir.dataset.ir) - 1500); return; }
    const ab = ev.target.closest("[data-abrir]");
    if (ab) {
      const caixa = el.querySelector(`[data-pop="${ab.dataset.abrir}"]`), abrir = caixa.hidden;
      el.querySelectorAll("[data-pop]").forEach((x) => { x.hidden = true; });
      el.querySelectorAll("[data-abrir]").forEach((x) => x.setAttribute("aria-expanded", "false"));
      caixa.hidden = !abrir; ab.setAttribute("aria-expanded", String(abrir)); return;
    }
    if (!ev.target.closest(".rp-pop")) el.querySelectorAll("[data-pop]").forEach((x) => { x.hidden = true; });
    const ac = ev.target.closest("[data-acao]")?.dataset.acao;
    if (ac === "zoom-mais") zoomEm(1.4);
    else if (ac === "zoom-menos") zoomEm(1 / 1.4);
    else if (ac === "multi") alternarMulti();
    else if (ac === "multi-atk" || ac === "multi-def") escolherLado(ac === "multi-atk");
    else if (ac === "vel") definirVel(VELOCIDADES[(VELOCIDADES.indexOf(S.vel) + 1) % VELOCIDADES.length]);
    else if (ac === "play") play();
    else if (ac === "anterior") abrirRound(Math.max(1, S.r.n - 1));
    else if (ac === "proximo") abrirRound(Math.min(d.rounds.length, S.r.n + 1));
    else if (ac === "desfazer") { tinta().pop(); desenharTinta(); }
    else if (ac === "limpar") { S.desenhos.set(S.r.n, []); desenharTinta(); }
    else if (ac === "salvar") salvarImagem();
    else if (ac === "tela-cheia") { if (document.fullscreenElement) document.exitFullscreen(); else el.requestFullscreen?.().catch(() => null); }
  });
  // linha do tempo: tocar ou arrastar
  const tempoDoPonteiro = (ev) => { const b = trilha.getBoundingClientRect(); return Math.max(0, Math.min(1, (ev.clientX - b.left) / b.width)) * S.round.fim; };
  trilha.addEventListener("pointerdown", (ev) => { trilha.setPointerCapture(ev.pointerId); S.arrastando = true; S.t = tempoDoPonteiro(ev); atualizarLeve(); });
  trilha.addEventListener("pointermove", (ev) => { if (S.arrastando) { S.t = tempoDoPonteiro(ev); atualizarLeve(); } });
  const soltarTrilha = () => { if (S.arrastando) { S.arrastando = false; atualizar(); } };
  trilha.addEventListener("pointerup", soltarTrilha);
  trilha.addEventListener("pointercancel", soltarTrilha);
  trilha.addEventListener("keydown", (ev) => { if (ev.key === "Home") irPara(0); else if (ev.key === "End") irPara(S.round.fim); });
  el.querySelectorAll("[data-op]").forEach((c) => c.addEventListener("change", () => { S.op[c.dataset.op] = c.checked; pedir(); }));
  const teclas = (ev) => {
    if (!el.isConnected) { document.removeEventListener("keydown", teclas); S.tocando = false; return; }
    if (ev.target.closest("input:not([type=range]), textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
    const k = ev.key;
    if (k === " ") { ev.preventDefault(); play(); }
    else if (k === "ArrowRight" || k === "ArrowLeft") { ev.preventDefault(); irPara(S.t + (k === "ArrowRight" ? 1 : -1) * (ev.shiftKey ? 1000 : 5000)); }
    else if (k === "," && !S.multi) abrirRound(Math.max(1, S.r.n - 1));
    else if (k === "." && !S.multi) abrirRound(Math.min(d.rounds.length, S.r.n + 1));
    else if (/^[1-6]$/.test(k)) definirVel(VELOCIDADES[Number(k) - 1]);
    else if (k.toLowerCase() === "p") escolherFerramenta("caneta");
    else if (k.toLowerCase() === "a") escolherFerramenta("seta");
    else if (k.toLowerCase() === "c" && !ev.ctrlKey && !ev.metaKey) escolherFerramenta("circulo");
    else if (k.toLowerCase() === "e") escolherFerramenta("borracha");
    else if (k.toLowerCase() === "n" || k.toLowerCase() === "v" || k.toLowerCase() === "r") {
      const nome = { n: "nomes", v: "mira", r: "rastro" }[k.toLowerCase()], c = el.querySelector(`[data-op="${nome}"]`); c.checked = !c.checked; S.op[nome] = c.checked; pedir();
    }
    else if (k.toLowerCase() === "f") el.querySelector('[data-acao="tela-cheia"]').click();
    else if (k.toLowerCase() === "z" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); tinta().pop(); desenharTinta(); }
    else if (k === "Escape" && S.ferr !== "mover") escolherFerramenta("mover");
  };
  document.addEventListener("keydown", teclas);
  window.addEventListener("hashchange", () => { S.tocando = false; }, { once: true });

  escolherFerramenta("mover");
  medir();
  abrirRound(rSel);
  // ocupa a tela: rola até o replay, logo abaixo do topo fixo do site
  requestAnimationFrame(() => {
    const topo = (document.querySelector(".topo")?.offsetHeight || 0) + (document.querySelector("main .abas")?.offsetHeight || 0);
    window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - topo - 8));
  });
}
