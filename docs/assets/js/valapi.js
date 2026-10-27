// Agentes (com habilidades) e mapas (minimapa, projeção e callouts) da valorant-api.com, guardados por 7 dias
// no navegador. Sem internet para a API, usa o que o meta.json da equipe já tem (sem as habilidades).

import { B } from "./dados.js";

const CDN = "https://media.valorant-api.com/";
const SEMANA = 7 * 864e5;
const imagemOk = (u) => (typeof u === "string" && u.startsWith(CDN) ? u : null);

function lerGuardado(chave) {
  try {
    const c = JSON.parse(localStorage.getItem(`valreport.${chave}`));
    if (c && Date.now() - c.t < SEMANA && Array.isArray(c.v) && c.v.length) return c.v;
  } catch (e) { /* sem armazenamento */ }
  return null;
}
function guardar(chave, v) { try { localStorage.setItem(`valreport.${chave}`, JSON.stringify({ t: Date.now(), v })); } catch (e) { /* cheio */ } }

const promessas = new Map();
function cacheado(chave, url, transformar, reserva) {
  if (promessas.has(chave)) return promessas.get(chave);
  const p = (async () => {
    const salvo = lerGuardado(chave);
    if (salvo) return salvo;
    try {
      const j = await (await fetch(url)).json();
      const v = transformar(j?.data || []);
      if (v.length) { guardar(chave, v); return v; }
    } catch (e) { /* sem a API agora */ }
    promessas.delete(chave);   // tenta de novo na próxima vez
    return reserva();
  })();
  promessas.set(chave, p);
  return p;
}

/** [{ nome, uuid, icone, funcao, habilidades: [{ slot, nome, icone }] }] em ordem alfabética */
export const agentesValorant = () => cacheado("agentes-api", "https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=pt-BR",
  (lista) => lista.filter((a) => a?.uuid && a.displayName).map((a) => ({
    nome: String(a.displayName), uuid: a.uuid, icone: imagemOk(a.displayIcon), funcao: a.role?.displayName || "",
    habilidades: (a.abilities || []).filter((h) => h?.slot && h.slot !== "Passive" && imagemOk(h.displayIcon))
      .map((h) => ({ slot: h.slot, nome: String(h.displayName || h.slot), icone: imagemOk(h.displayIcon) })),
  })).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")),
  () => Object.entries(B.meta?.agentes || {}).map(([nome, a]) => ({
    nome, uuid: a.uuid, icone: a.uuid ? `${CDN}agents/${a.uuid}/displayicon.png` : null, funcao: "", habilidades: [],
  })).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")));

/** [{ nome, uuid, minimapa, faixa, t: [xm, ym, xs, ys], callouts: [[super, regiao, x, y]] }] (só mapas competitivos) */
export const mapasValorant = () => cacheado("mapas-api", "https://valorant-api.com/v1/maps?language=pt-BR",
  (lista) => lista.filter((m) => m?.uuid && m.tacticalDescription && imagemOk(m.displayIcon)).map((m) => ({
    nome: String(m.displayName), uuid: m.uuid, minimapa: imagemOk(m.displayIcon), faixa: imagemOk(m.listViewIcon),
    t: [m.xMultiplier, m.yMultiplier, m.xScalarToAdd, m.yScalarToAdd].every(Number.isFinite) ? [m.xMultiplier, m.yMultiplier, m.xScalarToAdd, m.yScalarToAdd] : null,
    callouts: (m.callouts || []).filter((c) => Number.isFinite(c?.location?.x) && Number.isFinite(c?.location?.y))
      .map((c) => [String(c.superRegionName || ""), String(c.regionName || ""), c.location.x, c.location.y]),
  })).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")),
  () => Object.entries(B.meta?.mapas || {}).filter(([, m]) => m.uuid).map(([nome, m]) => ({
    nome, uuid: m.uuid, minimapa: `${CDN}maps/${m.uuid}/displayicon.png`, faixa: `${CDN}maps/${m.uuid}/listviewicon.png`,
    t: m.t || null, callouts: m.callouts || [],
  })).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR")));

export async function agentePorNome(nome) {
  return (await agentesValorant()).find((a) => a.nome.toLowerCase() === String(nome || "").toLowerCase()) || null;
}
export async function mapaPorNome(nome) {
  return (await mapasValorant()).find((m) => m.nome.toLowerCase() === String(nome || "").toLowerCase()) || null;
}
