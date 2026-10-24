// Carregamento dos JSONs gerados pelo exportar_site.py, filtros e agregação das estatísticas

import { div, chaveDia } from "./util.js";

const cache = new Map();
async function json(caminho) {
  if (!cache.has(caminho)) {
    cache.set(caminho, fetch(caminho, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error(`${caminho}: ${r.status}`);
      return r.json();
    }).catch((e) => { cache.delete(caminho); throw e; }));
  }
  return cache.get(caminho);
}

export const B = { meta: null, partidas: [], avaliacao: {}, formacoes: { formacoes: [], pares: [] }, porId: new Map(), equipe: [], porSlug: new Map() };

export async function carregarBase() {
  const [meta, partidas, avaliacao, formacoes] = await Promise.all([
    json("data/meta.json"), json("data/partidas.json"),
    json("data/avaliacao.json").catch(() => ({})), json("data/formacoes.json").catch(() => ({ formacoes: [], pares: [] })),
  ]);
  partidas.sort((a, b) => (a.t < b.t ? 1 : -1));  // mais recente primeiro
  Object.assign(B, { meta, partidas, avaliacao, formacoes, porId: new Map(partidas.map((p) => [p.id, p])) });
  B.equipe = meta.equipe;
  B.porSlug = new Map(meta.equipe.map((e) => [e.slug, e]));
  return B;
}
export const detalhe = (id) => json(`data/partidas/${id}.json`);
export const calor = (slug) => json(`data/calor/${slug}.json`).catch(() => ({ partidas: [], e: [] }));

// ---------- Filtros ----------
export const FILTROS_PADRAO = { fila: "todas", temporada: "todas", periodo: "tudo", mapa: "todos", agente: "todos", com: "todos" };
export const PERIODOS = { 7: "Últimos 7 dias", 14: "Últimos 14 dias", 30: "Últimos 30 dias", 90: "Últimos 90 dias", tudo: "Todo o período" };

function limiteData(periodo) {
  if (!periodo || periodo === "tudo") return null;
  const ref = new Date(B.meta.gerado_em);
  return new Date(ref.getTime() - Number(periodo) * 86400000);
}

export function passaPartida(p, f) {
  if (f.fila !== "todas" && p.fila !== f.fila) return false;
  if (f.temporada !== "todas" && p.temp !== f.temporada) return false;
  if (f.mapa !== "todos" && p.mapa !== f.mapa) return false;
  const lim = limiteData(f.periodo);
  if (lim && new Date(p.t) < lim) return false;
  return true;
}
export function passaMembro(m, f) {
  if (f.agente !== "todos" && m.ag !== f.agente) return false;
  if (f.com === "sozinho" && m.eq > 1) return false;
  if (f.com === "equipe" && m.eq <= 1) return false;
  if (!["todos", "sozinho", "equipe"].includes(f.com) && !m.com.includes(f.com)) return false;
  return true;
}
/** [{p, m}] de um jogador com os filtros aplicados (mais recente primeiro) */
export function itensDe(slug, f = FILTROS_PADRAO) {
  const out = [];
  for (const p of B.partidas) {
    const m = p.m[slug];
    if (m && passaPartida(p, f) && passaMembro(m, f)) out.push({ p, m, slug });
  }
  return out;
}
/** Partidas da equipe (qualquer membro visível), com os filtros de partida */
export function partidasDaEquipe(f = FILTROS_PADRAO) {
  return B.partidas.filter((p) => passaPartida(p, f) && Object.values(p.m).some((m) => passaMembro(m, f)));
}

// ---------- Agregação ----------
const VAZIO_LADO = () => [0, 0, 0, 0, 0, 0, 0, 0];
export function somar(itens) {
  const t = {
    n: 0, v: 0, d: 0, e: 0, r: 0, rt: 0, k: 0, mo: 0, a: 0, sc: 0, dd: 0, dr: 0, hs: 0, bs: 0, ls: 0, fk: 0, fd: 0,
    kast: 0, tr: 0, trc: 0, imp: 0, imps: 0, ks: 0, mi: 0, mft: 0, cl: [0, 0, 0, 0, 0], clv: [0, 0, 0, 0, 0], cle: 0,
    pl: 0, df: 0, mk: [0, 0, 0, 0], ut: 0, ul: 0, kh: 0, mvp: 0, tmvp: 0, top1: 0,
    lados: { a: VAZIO_LADO(), d: VAZIO_LADO() }, tipos: {}, armas: {}, dm: [], ind: [],
  };
  for (const { m } of itens) {
    t.n++; t[m.res === "V" ? "v" : m.res === "D" ? "d" : "e"]++;
    t.r += m.r; t.rt += m.rt; t.k += m.k; t.mo += m.d; t.a += m.a; t.sc += m.sc; t.dd += m.dd; t.dr += m.dr;
    t.hs += m.hs; t.bs += m.bs; t.ls += m.ls; t.fk += m.fk; t.fd += m.fd; t.kast += m.kast; t.tr += m.tr; t.trc += m.trc;
    t.imp += m.imp; t.imps += m.imps; t.ks += m.ks; t.mi += m.mi; t.mft += m.mft; t.cle += m.cle;
    t.pl += m.pl; t.df += m.df; t.ut += m.ut; t.ul += m.ul; t.kh += m.kh;
    if (m.mvp === 1) t.mvp++; else if (m.mvp === 2) t.tmvp++;
    if (m.pos === 1) t.top1++;
    m.cl.forEach((x, i) => { t.cl[i] += x; t.clv[i] += m.clv[i]; });
    m.mk.forEach((x, i) => { t.mk[i] += x; });
    for (const l of ["a", "d"]) m.lados[l].forEach((x, i) => { t.lados[l][i] += x; });
    for (const [tp, vs] of Object.entries(m.tipos)) {
      const alvo = (t.tipos[tp] ||= [0, 0, 0, 0, 0, 0]);
      vs.forEach((x, i) => { alvo[i] += x; });
    }
    for (const [arma, vs] of Object.entries(m.armas)) {
      const alvo = (t.armas[arma] ||= [0, 0, 0, 0, 0, 0, 0, 0, 0]);
      vs.forEach((x, i) => { alvo[i] = i === 8 ? Math.max(alvo[i], x) : alvo[i] + x; });
    }
    t.dm.push(...m.dm);
    if (m.ind != null) t.ind.push(m.ind);
  }
  return t;
}

/** Estatísticas derivadas (o que aparece nas telas) */
export function derivar(t) {
  const tiros = t.hs + t.bs + t.ls;
  const dm = [...t.dm].sort((a, b) => a - b);
  const cl = t.cl.reduce((a, b) => a + b, 0), clv = t.clv.reduce((a, b) => a + b, 0);
  return {
    ...t,
    win: div(t.v, t.n), kd: div(t.k, t.mo), kda: div(t.k + t.a, t.mo), adr: div(t.dd, t.rt), acs: div(t.sc, t.rt),
    hsp: div(t.hs, tiros), bsp: div(t.bs, tiros), lsp: div(t.ls, tiros), kastp: div(t.kast, t.r),
    impr: t.r ? (100 * t.imp) / t.r : null, ddd: div(t.dd - t.dr, t.rt), kpr: div(t.k, t.rt), dpr: div(t.mo, t.rt),
    fkpr: div(t.fk, t.rt), fdpr: div(t.fd, t.rt), clutches: cl, clutchesV: clv,
    medianaDist: dm.length ? dm[Math.floor(dm.length / 2)] : null,
    alcance: dm.length ? dm.filter((x) => x <= (B.meta?.regras?.trade_m ?? 15)).length / dm.length : null,
    trocadas: div(t.trc, t.mo), indMedio: t.ind.length ? t.ind.reduce((a, b) => a + b, 0) / t.ind.length : null,
    aces: t.mk[3],
  };
}
export const stats = (itens) => derivar(somar(itens));

/** Agrupa itens por chave (agente, mapa...) e devolve [{chave, s, itens}] */
export function agrupar(itens, chave) {
  const grupos = new Map();
  for (const it of itens) {
    const k = chave(it);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(it);
  }
  return [...grupos].map(([k, lst]) => ({ chave: k, itens: lst, s: stats(lst) }));
}
export const porDia = (itens) => agrupar(itens, (it) => chaveDia(it.p.t));

/** Opções de filtro que existem para um jogador (ou para a equipe) */
export function opcoes(slug) {
  const mapas = new Set(), agentes = new Set(), filas = new Set(), com = new Set();
  for (const p of B.partidas) {
    const ms = slug ? [p.m[slug]].filter(Boolean) : Object.values(p.m);
    if (!ms.length) continue;
    mapas.add(p.mapa); filas.add(p.fila);
    for (const m of ms) { agentes.add(m.ag); m.com.forEach((c) => com.add(c)); }
  }
  return { mapas: [...mapas].sort(), agentes: [...agentes].sort(), filas: [...filas], com: [...com] };
}

/** Resumo de uma partida do ponto de vista da equipe */
export function resultadoEquipe(p) {
  const ms = Object.values(p.m).filter((m) => m.time === p.nosso);
  return ms[0]?.res || Object.values(p.m)[0]?.res || "E";
}
export function placarEquipe(p) {
  const nos = p.placar[p.nosso] ?? 0;
  const eles = Object.entries(p.placar).find(([t]) => t !== p.nosso)?.[1] ?? 0;
  return [nos, eles];
}
