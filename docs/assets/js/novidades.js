// Início pessoal (v40): "Desde a sua última visita" — partidas novas (da equipe e suas), elo, o próximo compromisso,
// voto da map pool pendente e táticas novas. A "última visita" é guardada neste aparelho, por equipe:
// abrir o site depois de 30 minutos parado conta como uma nova visita.

import { B, resultadoEquipe } from "./dados.js";
import { rpc } from "./nuvem.js";
import { esc, icone, nomeTier, relativo } from "./util.js";

const K_VISITAS = "valreport.ultimas-visitas", NOVA_VISITA_MS = 30 * 60 * 1000;
let desdeMemo = undefined;   // calculado uma vez por abertura do site

const normal = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Quando foi a visita anterior (Date) ou null na primeira vez; anota a visita de agora */
function visitaAnterior() {
  if (desdeMemo !== undefined) return desdeMemo;
  const eq = B.equipeAtual?.id || "local";
  let todas = {};
  try { todas = JSON.parse(localStorage.getItem(K_VISITAS)) || {}; } catch (e) { todas = {}; }
  const v = todas[eq] || {}, agora = Date.now();
  if (v.atual && agora - v.atual > NOVA_VISITA_MS) v.anterior = v.atual;   // voltou depois de um tempo: nova visita
  v.atual = agora;
  todas[eq] = v;
  try { localStorage.setItem(K_VISITAS, JSON.stringify(todas)); } catch (e) { /* sem armazenamento */ }
  desdeMemo = v.anterior ? new Date(v.anterior) : null;
  return desdeMemo;
}

/** O jogador do site que é a pessoa logada (pelo apelido do perfil), ou null */
export function meuJogador() {
  const p = B.conta?.perfil;
  if (!p) return null;
  const alvo = [normal(p.apelido), normal((p.riot_id || "").split("#")[0])].filter(Boolean);
  return (B.equipe || []).find((e) => alvo.includes(normal(e.apelido)) || alvo.includes(normal(e.slug)) || (e.riot && normal(e.riot) === normal(p.riot_id))) || null;
}

const VD = (ps, res) => { const v = ps.filter((x) => res(x) === "V").length, d = ps.filter((x) => res(x) === "D").length; return `${v}V ${d}D`; };

function itensLocais(desde, eu) {
  const out = [];
  const novas = (B.partidas || []).filter((p) => p.t && new Date(p.t) > desde);
  if (novas.length) {
    out.push({ ic: "nota", href: "#/equipe/partidas", texto: `<strong>${novas.length} partida${novas.length === 1 ? "" : "s"} nova${novas.length === 1 ? "" : "s"}</strong> da equipe · ${VD(novas, resultadoEquipe)}` });
  }
  if (eu) {
    const minhas = novas.filter((p) => p.m?.[eu.slug]);
    if (minhas.length) out.push({ ic: "raio", href: `#/j/${encodeURIComponent(eu.slug)}/partidas`, texto: `Você jogou <strong>${minhas.length}</strong> · ${VD(minhas, (p) => p.m[eu.slug].res)}` });
    const hist = (B.elo?.[eu.slug] || []).filter((h) => h.tier != null && h.t);
    const antes = [...hist].reverse().find((h) => new Date(h.t) <= desde), agora = hist.at(-1);
    if (antes && agora && new Date(agora.t) > desde && agora.tier !== antes.tier) {
      const subiu = agora.tier > antes.tier;
      out.push({ ic: subiu ? "seta-cima" : "seta-baixo", href: `#/j/${encodeURIComponent(eu.slug)}/performance`, classe: subiu ? "bom" : "ruim",
        texto: `${subiu ? "Subiu" : "Caiu"} de ${esc(nomeTier(antes.tn))} para <strong>${esc(nomeTier(agora.tn))}</strong>` });
    } else if (agora && new Date(agora.t) > desde) {
      const rr = hist.filter((h) => new Date(h.t) > desde).reduce((s, h) => s + (Number(h.delta) || 0), 0);
      if (rr) out.push({ ic: rr > 0 ? "seta-cima" : "seta-baixo", href: `#/j/${encodeURIComponent(eu.slug)}/performance`, classe: rr > 0 ? "bom" : "ruim",
        texto: `<strong>${rr > 0 ? "+" : ""}${rr} RR</strong> em ${esc(nomeTier(agora.tn))}` });
    }
    if (B.coroa?.mvp === eu.slug) out.push({ ic: "coroa", href: "#/equipe/semana", classe: "ouro", texto: "Você é o <strong>MVP da semana</strong>" });
  }
  return out;
}

async function itensDaEquipe(desde) {
  const out = [], eq = B.equipeAtual?.id;
  if (!eq || B.editor) return out;
  const [{ podeVerPlanejamento, lerPlanejamento, resultadoPool }, { podeVerTaticas }] = await Promise.all([import("./planejamento.js"), import("./taticas.js")]);
  const tarefas = [];
  if (podeVerPlanejamento()) {
    tarefas.push((async () => {   // próximo compromisso nas próximas 24 h, com a presença da pessoa
      const { proximosComPresenca } = await import("./agenda.js");
      const prox = (await proximosComPresenca(2)).find((x) => x.inicio && x.inicio - Date.now() < 24 * 3600e3 && x.inicio - Date.now() > -2 * 3600e3);
      if (prox) {
        const quando = new Date(prox.inicio).toDateString() === new Date().toDateString() ? "hoje" : "amanhã";
        const resp = { vou: "você vai", talvez: "você marcou talvez", nao: "você não vai" }[prox.minha];
        out.push({ ic: "calendario", href: `#/equipe/agenda?evento=${encodeURIComponent(prox.e.id)}&dia=${prox.dia}`, classe: prox.minha ? "" : "alerta", ordem: -1,
          texto: `<strong>${esc(prox.e.titulo)}</strong> ${quando}${prox.e.dia_todo ? "" : ` às ${esc(prox.e.inicio)}`} · ${resp || "<strong>responda a presença</strong>"}` });
      }
    })().catch(() => null));
    tarefas.push((async () => {   // voto da map pool
      const d = await lerPlanejamento();
      const r = resultadoPool(d);
      const votei = (d.votos || []).some((v) => v.usuario_id === d.eu && v.ranking?.length === r.pool.length);
      if (!r.manual && !votei && (d.membros || []).some((m) => m.usuario_id === d.eu)) {
        out.push({ ic: "mapa", href: "#/equipe/mappool", classe: "alerta", texto: "Falta o <strong>seu voto</strong> na map pool" });
      }
    })().catch(() => null));
  }
  if (podeVerTaticas()) {
    tarefas.push((async () => {   // táticas publicadas ou atualizadas desde a visita
      const lista = (await rpc("taticas_listar", { p_equipe: eq }))?.taticas || [];
      const novas = lista.filter((t) => t.publicada && t.atualizada_em && new Date(t.atualizada_em) > desde);
      if (novas.length) {
        out.push({ ic: "slides", href: novas.length === 1 ? `#/tatica/${encodeURIComponent(novas[0].id)}` : "#/equipe/taticas",
          texto: novas.length === 1 ? `Tática nova ou atualizada: <strong>${esc(novas[0].titulo || "estratégia")}</strong>` : `<strong>${novas.length} táticas</strong> novas ou atualizadas` });
      }
    })().catch(() => null));
  }
  await Promise.all(tarefas);
  return out;
}

/** Junta o cartão "Desde a sua última visita" no começo de uma view { html, depois } */
export function comNovidades(v) {
  if (!B.conta || B.editor) return v;
  const desde = visitaAnterior();
  return {
    ...v,
    html: `<section class="novidades" data-novidades hidden aria-live="polite"></section>${v.html}`,
    depois: async (main) => {
      if (v.depois) await v.depois(main);
      const el = main.querySelector("[data-novidades]");
      if (!el) return;
      const eu = meuJogador();
      // Primeira visita neste aparelho: só os avisos do que vale para agora (compromisso, voto)
      const base = desde || new Date(Date.now() - 24 * 3600e3);
      const itens = [...(desde ? itensLocais(base, eu) : []), ...(await itensDaEquipe(base))];
      if (!el.isConnected || !itens.length) return;
      itens.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      el.innerHTML = `<div class="novidades__topo"><h2>${desde ? "Desde a sua última visita" : "Para agora"}</h2>${desde ? `<small class="suave">${esc(relativo(desde.toISOString()))}</small>` : ""}</div>
        <ul class="novidades__lista">${itens.map((x) => `<li><a class="novidades__item${x.classe ? ` novidades__item--${x.classe}` : ""}" href="${esc(x.href)}">
          <span class="novidades__ic">${icone(x.ic)}</span><span>${x.texto}</span>${icone("seta")}</a></li>`).join("")}</ul>`;
      el.hidden = false;
    },
  };
}
