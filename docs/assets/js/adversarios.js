// Adversários e scouting (v49): cada adversário das scrims e oficiais (nome vindo da agenda ou do contexto marcado
// à mão) com o histórico contra a equipe e as tendências dele: comps por mapa, onde planta, pistol, quem abre
// os rounds, retake. Usa o resumo dos rounds (p.rd) e os agentes do adversário (p.adv) da coleta.

import { B } from "./dados.js";
import { esc, icone, imagem, imgAgente, dataHora } from "./util.js";
import { contextoDe, seloContexto } from "./contexto.js";

const normal = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const pctTxt = (v, t) => (t ? `${Math.round((100 * v) / t)}%` : "—");

function adversariosDe(ps) {
  const por = new Map();
  for (const p of ps) {
    const c = contextoDe(p);
    if (!c.adversario || !["scrim", "oficial", "treino"].includes(c.ctx)) continue;
    const k = normal(c.adversario);
    if (!k) continue;
    if (!por.has(k)) por.set(k, { nome: c.adversario, ps: [] });
    por.get(k).ps.push(p);
  }
  return [...por.values()].sort((a, b) => b.ps.length - a.ps.length);
}

function resumo(adv) {
  const r = { v: 0, d: 0, mapas: new Map(), comps: new Map(), plantas: {}, pistol: [0, 0], abre: [0, 0], retake: [0, 0], ataque: [0, 0], defesa: [0, 0] };
  for (const p of adv.ps) {
    const nos = p.placar?.[p.nosso] ?? 0, eles = Object.entries(p.placar || {}).find(([t]) => t !== p.nosso)?.[1] ?? 0;
    if (nos > eles) r.v++; else if (nos < eles) r.d++;
    const m = r.mapas.get(p.mapa) || { v: 0, d: 0 };
    if (nos > eles) m.v++; else if (nos < eles) m.d++;
    r.mapas.set(p.mapa, m);
    if (p.adv?.length) {
      const chave = `${p.mapa}|${p.adv.join(",")}`;
      r.comps.set(chave, { mapa: p.mapa, ags: p.adv, n: (r.comps.get(chave)?.n || 0) + 1 });
    }
    for (const [lado, v, eu, , fk, site, , , quem] of p.rd || []) {
      // do ponto de vista do ADVERSÁRIO: ele ataca quando a equipe defende (lado 1)
      if (eu === 0) { r.pistol[1]++; if (!v) r.pistol[0]++; }
      if (fk !== -1) { r.abre[1]++; if (fk === 0) r.abre[0]++; }
      if (lado === 1) { r.ataque[1]++; if (!v) r.ataque[0]++; } else { r.defesa[1]++; if (!v) r.defesa[0]++; }
      if (quem === 0 && site) r.plantas[site] = (r.plantas[site] || 0) + 1;
      if (quem === 1) { r.retake[1]++; if (!v) r.retake[0]++; }
    }
  }
  return r;
}

function textoScouting(adv, r) {
  const plantas = Object.entries(r.plantas).sort((a, b) => b[1] - a[1]), tot = plantas.reduce((s, [, n]) => s + n, 0);
  return [`**Scouting · ${adv.nome}** (${adv.ps.length} partida${adv.ps.length === 1 ? "" : "s"} · ${r.v}V ${r.d}D contra eles)`,
    `Mapas: ${[...r.mapas.entries()].map(([m, x]) => `${m} ${x.v}-${x.d}`).join(" · ")}`,
    `Comps: ${[...r.comps.values()].map((c) => `${c.mapa}: ${c.ags.join(", ")}`).join(" | ") || "—"}`,
    `No ataque eles plantam: ${tot ? plantas.map(([s, n]) => `${s} ${Math.round((100 * n) / tot)}%`).join(" · ") : "—"}`,
    `Ganham ${pctTxt(r.ataque[0], r.ataque[1])} no ataque e ${pctTxt(r.defesa[0], r.defesa[1])} na defesa · pistol ${pctTxt(r.pistol[0], r.pistol[1])} · abrem ${pctTxt(r.abre[0], r.abre[1])} dos rounds · retake ${pctTxt(r.retake[0], r.retake[1])}`,
  ].join("\n");
}

export function viewAdversarios(f, q) {
  const advs = adversariosDe(B.partidas || []);
  const sel = q.get("adv");
  if (!advs.length) {
    return { html: `<div class="vazio"><strong>Nenhum adversário ainda</strong><p>O adversário vem do evento da agenda (Scrim, Campeonato ou Partida oficial com o campo "Adversário") ou do contexto marcado à mão na partida ("Mudar" no cabeçalho). As tendências usam as partidas a partir da próxima coleta.</p></div>` };
  }
  const atual = advs.find((a) => normal(a.nome) === normal(sel)) || advs[0];
  const r = resumo(atual);
  const plantas = Object.entries(r.plantas).sort((a, b) => b[1] - a[1]), tot = plantas.reduce((s, [, n]) => s + n, 0);
  const comps = [...r.comps.values()].sort((a, b) => b.n - a.n);
  const html = `<section class="secao adv">
      <div class="chips" role="group" aria-label="Adversários">${advs.map((a) => `<button type="button" class="chip${a === atual ? " ativo" : ""}" data-param="adv" data-valor="${esc(a.nome)}">${esc(a.nome)} <small>${a.ps.length}</small></button>`).join("")}</div>
      <div class="adv-topo cartao"><div><h2>${esc(atual.nome)}</h2><p class="suave">${atual.ps.length} partida${atual.ps.length === 1 ? "" : "s"} · <b class="bom">${r.v}V</b> <b class="ruim">${r.d}D</b> contra eles</p></div>
        <button type="button" class="botao-secundario" data-copiar-scouting>${icone("texto")} Copiar scouting para o Discord</button></div>
      <div class="adv-grade">
        <div class="cartao"><div class="cartao__titulo"><h3>Tendências</h3><small class="suave">do ponto de vista deles</small></div>
          <div class="adv-numeros">
            <div><small>Vitória no ataque</small><b>${pctTxt(r.ataque[0], r.ataque[1])}</b></div><div><small>Vitória na defesa</small><b>${pctTxt(r.defesa[0], r.defesa[1])}</b></div>
            <div><small>Pistols</small><b>${pctTxt(r.pistol[0], r.pistol[1])}</b></div><div><small>Abrem o round</small><b>${pctTxt(r.abre[0], r.abre[1])}</b></div>
            <div><small>Retake</small><b>${pctTxt(r.retake[0], r.retake[1])}</b></div>
          </div>
          <p class="adv-plantas"><small class="suave">No ataque, plantam em</small> ${tot ? plantas.map(([s, n]) => `<span class="an-site"><b>${esc(s)}</b> ${Math.round((100 * n) / tot)}%</span>`).join("") : "—"}</p></div>
        <div class="cartao"><div class="cartao__titulo"><h3>Comps</h3></div>
          ${comps.length ? comps.map((c) => `<div class="adv-comp"><strong>${esc(c.mapa)}</strong><span class="adv-comp__ags">${c.ags.map((a) => `<span title="${esc(a)}">${imagem(imgAgente(a), a, "", a)}</span>`).join("")}</span><small class="suave">${c.n}x</small></div>`).join("")
            : `<p class="suave pequeno">Aparecem a partir da próxima coleta.</p>`}</div>
      </div>
      <h3 class="secao__titulo" style="margin-top:16px">Partidas</h3>
      <div class="adv-partidas">${atual.ps.sort((a, b) => (a.t < b.t ? 1 : -1)).map((p) => {
        const nos = p.placar?.[p.nosso] ?? 0, eles = Object.entries(p.placar || {}).find(([t]) => t !== p.nosso)?.[1] ?? 0;
        return `<a class="evento-partida" href="#/p/${esc(p.id)}"><b class="${nos > eles ? "bom" : nos < eles ? "ruim" : ""}">${nos}–${eles}</b> ${esc(p.mapa)} ${seloContexto(p)} <span class="suave">${esc(dataHora(p.t))}</span>${icone("seta")}</a>`;
      }).join("")}</div>
    </section>`;
  const depois = (el) => {
    const b = el.querySelector("[data-copiar-scouting]");
    b?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(textoScouting(atual, r)); b.textContent = "Copiado ✓"; } catch (e) { b.textContent = "Não deu para copiar"; }
    });
  };
  return { html, depois };
}
