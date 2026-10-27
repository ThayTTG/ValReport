// Contador de habilidades: quantas vezes cada pessoa usou C, Q, E e X, por round, comparado com a média do agente
// no lobby (todas as pessoas, das duas equipes, nas partidas que o PC exportou). A contagem vem da Riot, por partida.

import { esc, num, imagem, imgAgente, div } from "./util.js";
import { B } from "./dados.js";

export const TECLAS = ["C", "Q", "E", "X"];
const CDN = "https://media.valorant-api.com/";

/** {h: [[nome, ícone] × 4], m: [média por round × 4], n: rounds na amostra} do agente, ou null */
export const infoAgente = (ag) => B.meta?.hab_agentes?.[ag] || null;
const iconeSeguro = (u) => (typeof u === "string" && u.startsWith(CDN) ? u : null);
export const temContagem = (hb) => Array.isArray(hb) && hb.length === 4 && hb.some((x) => x > 0);

/** Comparação com a média: "acima", "abaixo" ou "" (dentro de ±25%, ou amostra pequena) */
function comparar(valor, media, nAmostra) {
  if (valor == null || !media || nAmostra < 30) return "";
  const r = valor / media;
  return r >= 1.25 ? "acima" : r <= 0.75 ? "abaixo" : "";
}
const TEXTO_CMP = { acima: "acima da média do agente", abaixo: "abaixo da média do agente" };

/** Uma célula: ícone da habilidade, quantas vezes, por round e a média do agente */
function celula(ag, i, total, rounds, umaPartida = false) {
  const info = infoAgente(ag);
  const [nome, ic] = info?.h?.[i] || [TECLAS[i], null];
  const pr = div(total, rounds), media = info?.m?.[i];
  const cmp = umaPartida && i === 3 ? "" : comparar(pr, media, info?.n || 0);   // ultimate de uma partida só: pouco para comparar
  const dica = `${TECLAS[i]} · ${nome}: ${total} na partida${pr != null ? ` (${num(pr, 2)} por round)` : ""}${media != null ? ` · média do agente ${num(media, 2)}` : ""}${cmp ? ` · ${TEXTO_CMP[cmp]}` : ""}`;
  return `<div class="hab-uso ${cmp ? `hab-uso--${cmp}` : ""}" title="${esc(dica)}">
      <span class="hab-uso__icone">${iconeSeguro(ic) ? `<img src="${esc(ic)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-sefalhar="ocultar">` : ""}<kbd>${TECLAS[i]}</kbd></span>
      <span class="hab-uso__n"><strong>${total}</strong><small>${pr != null && !(umaPartida && i === 3) ? `${num(pr, 1)}/r` : i === 3 ? "ult" : ""}</small></span>
      <span class="sr">${esc(dica)}</span></div>`;
}

/**
 * Tabela compacta do placar: linhas = [{nome, slug, ag, hb, rounds}].
 * Cada linha mostra as 4 habilidades com a contagem e o uso por round.
 */
export function htmlUsoPartida(linhas) {
  const com = linhas.filter((l) => temContagem(l.hb));
  if (!com.length) return "";
  return `<div class="cartao"><ol class="habs-partida">${com.map((l, i) => `<li class="hab-linha${i && l.time !== com[i - 1].time ? " hab-linha--outro-time" : ""}">
      <span class="hab-linha__quem">${imagem(imgAgente(l.ag), l.ag)}<span><strong>${l.slug ? `<a href="#/j/${esc(l.slug)}/habilidades">${esc(l.nome)}</a>` : esc(l.nome)}</strong><small>${esc(l.ag)}</small></span></span>
      <span class="hab-linha__usos">${l.hb.map((x, k) => celula(l.ag, k, x, l.rounds, true)).join("")}</span></li>`).join("")}</ol></div>`;
}

/** Utilidade por round (C + Q + E, sem a ultimate) */
export const utilPorRound = (hb, rounds) => (temContagem(hb) ? div(hb[0] + hb[1] + hb[2], rounds) : null);

/** Aba Habilidades do jogador: por agente, uso por round × média do agente, com barras */
export function htmlHabilidadesJogador(grupos) {
  const blocos = grupos.map(({ chave: ag, itens }) => {
    const soma = [0, 0, 0, 0];
    let rounds = 0, kh = 0, partidas = 0;
    for (const { m } of itens) {
      if (!temContagem(m.hb)) continue;
      m.hb.forEach((x, i) => { soma[i] += x; });
      rounds += m.rt; kh += m.kh || 0; partidas++;
    }
    if (!partidas) return null;
    const info = infoAgente(ag);
    const barras = soma.map((total, i) => {
      const [nome, ic] = info?.h?.[i] || [TECLAS[i], null];
      const pr = div(total, rounds), media = info?.m?.[i];
      const cmp = comparar(pr, media, info?.n || 0);
      const escala = Math.max(pr || 0, media || 0, 0.01) * 1.15;
      return `<li class="hab-barra ${cmp ? `hab-uso--${cmp}` : ""}">
          <span class="hab-uso__icone">${iconeSeguro(ic) ? `<img src="${esc(ic)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-sefalhar="ocultar">` : ""}<kbd>${TECLAS[i]}</kbd></span>
          <span class="hab-barra__nome"><strong>${esc(nome)}</strong><small>${total} uso${total === 1 ? "" : "s"}${i === 3 ? ` · ${num(div(total, partidas), 1)} por partida` : ""}</small></span>
          <span class="hab-barra__trilho" aria-hidden="true">
            <span class="hab-barra__voce" style="width:${Math.min(100, (100 * (pr || 0)) / escala).toFixed(1)}%"></span>
            ${media != null ? `<span class="hab-barra__media" style="left:${Math.min(100, (100 * media) / escala).toFixed(1)}%" title="Média do agente"></span>` : ""}
          </span>
          <span class="hab-barra__valor"><strong>${num(pr, 2)}</strong><small>${media != null ? `média ${num(media, 2)}` : "sem média"}</small></span>
        </li>`;
    }).join("");
    const util = div(soma[0] + soma[1] + soma[2], rounds), utilMedia = info ? info.m[0] + info.m[1] + info.m[2] : null;
    return { partidas, html: `<section class="cartao hab-agente">
        <div class="cartao__titulo"><h3 class="celula-ag">${imagem(imgAgente(ag), ag)} ${esc(ag)}</h3>
          <span class="suave pequeno">${partidas} partida${partidas === 1 ? "" : "s"} · ${num(rounds)} rounds</span></div>
        <div class="chips hab-agente__resumo">
          <span class="chip">Utilitário/round <strong>${num(util, 2)}</strong>${utilMedia ? `<span class="suave">&nbsp;(média ${num(utilMedia, 2)})</span>` : ""}</span>
          <span class="chip">Abates com habilidade <strong>${kh}</strong></span></div>
        <ul class="hab-barras">${barras}</ul></section>` };
  }).filter(Boolean).sort((a, b) => b.partidas - a.partidas);
  if (!blocos.length) return "";
  return `<div class="habs-jogador">${blocos.map((b) => b.html).join("")}</div>
    <p class="suave pequeno" style="margin-top:10px">Usos por round em cada agente, segue os filtros. A barra é você; o risquinho é a média do agente no lobby (todas as pessoas das partidas da equipe, dos dois lados). Verde = 25% acima da média, vermelho = 25% abaixo. A Riot conta os usos da partida inteira, então não dá para separar por round ou por lado.</p>`;
}
