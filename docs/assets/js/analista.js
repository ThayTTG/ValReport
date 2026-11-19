// Planilha do analista (v46): o time por mapa e lado — pistol, compras, vantagem (5v4 e 4v5), pós-plant, retake
// e onde cada um planta. Usa o resumo de cada round (p.rd, da coleta) e segue os filtros (contexto, fila, período).

import { partidasDaEquipe } from "./dados.js";
import { esc, icone } from "./util.js";

const MIN = 5;           // abaixo disso, o número aparece apagado (amostra pequena)
const MIN_TREINO = 8;    // para entrar em "O que treinar"
const COMPRAS = [[1, "Eco"], [2, "Force"], [3, "Completa"]];

function novo() {
  const c = () => [0, 0];   // [vitórias, total]
  return { rounds: c(), atk: c(), def: c(), pistolAtk: c(), pistolDef: c(), posPistolGanho: c(), posPistolPerdido: c(),
    compra: { 1: c(), 2: c(), 3: c() }, conv: c(), recup: c(), posPlant: c(), retake: c(),
    plantas: {}, tempoPlant: [], sofridos: {}, partidas: 0 };
}
const soma = (par, venceu) => { par[1]++; if (venceu) par[0]++; };

function agregar(ps) {
  const por = new Map(), todos = novo();
  for (const p of ps) {
    if (!p.rd?.length) continue;
    if (!por.has(p.mapa)) por.set(p.mapa, novo());
    for (const g of [por.get(p.mapa), todos]) {
      g.partidas++;
      p.rd.forEach(([lado, v, eu, , fk, site, tp, , quem], i) => {
        soma(g.rounds, v);
        soma(lado === 0 ? g.atk : g.def, v);
        if (eu === 0) soma(lado === 0 ? g.pistolAtk : g.pistolDef, v);
        if (i === 1 || i === 13) { const anterior = p.rd[i - 1]; if (anterior) soma(anterior[1] ? g.posPistolGanho : g.posPistolPerdido, v); }
        if (eu === 4) soma(g.compra[3], v); else if (g.compra[eu]) soma(g.compra[eu], v);
        if (fk === 1) soma(g.conv, v); else if (fk === 0) soma(g.recup, v);
        if (quem === 1) { soma(g.posPlant, v); if (site) g.plantas[site] = (g.plantas[site] || 0) + 1; if (tp >= 0) g.tempoPlant.push(tp); }
        if (quem === 0) { soma(g.retake, v); if (site) g.sofridos[site] = (g.sofridos[site] || 0) + 1; }
      });
    }
  }
  return { por, todos };
}

const pct = ([v, t]) => (t ? Math.round((100 * v) / t) : null);
function celula(par, { bom = 55, ruim = 45 } = {}) {
  const x = pct(par);
  if (x == null) return `<td class="an-v an-v--vazio">—</td>`;
  const cls = par[1] < MIN ? "an-v--pouco" : x >= bom ? "an-v--bom" : x <= ruim ? "an-v--ruim" : "";
  return `<td class="an-v ${cls}" title="${par[0]} de ${par[1]} rounds"><b>${x}%</b><small>${par[0]}/${par[1]}</small></td>`;
}
function sites(obj) {
  const tot = Object.values(obj).reduce((a, b) => a + b, 0);
  if (!tot) return "—";
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([s, n]) => `<span class="an-site"><b>${esc(s)}</b> ${Math.round((100 * n) / tot)}%</span>`).join("");
}
const media = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const tempo = (s) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

/** Os 3 números mais fracos (com amostra) para treinar */
function oQueTreinar(por) {
  const itens = [];
  for (const [mapa, g] of por) {
    const add = (nome, par, dica, linha = 45) => { const x = pct(par); if (par[1] >= MIN_TREINO && x != null && x <= linha) itens.push({ mapa, nome, x, par, dica }); };
    add("Pistol de ataque", g.pistolAtk, "execução de pistol e o plano de compra do round 2", 40);
    add("Pistol de defesa", g.pistolDef, "posições e utilitário do pistol de defesa", 40);
    add("Converter 5v4", g.conv, "jogar a vantagem: trocar, não dar duelo seco, fechar o site", 60);
    add("Pós-plant", g.posPlant, "posições de pós-plant e quem segura cada ângulo", 55);
    const pior = Object.entries(g.sofridos).sort((a, b) => b[1] - a[1])[0]?.[0];
    add("Retake", g.retake, `retake${pior ? ` do ${pior}` : ""} (com quantos e com qual utilitário)`, 30);
    add("Rounds de force", g.compra[2], "quando forçar e o que comprar", 30);
  }
  return itens.sort((a, b) => a.x - b.x).slice(0, 3);
}

export function viewAnalista(f) {
  const ps = partidasDaEquipe(f);
  const temResumo = ps.some((p) => p.rd?.length);
  if (!temResumo) {
    return `<div class="vazio"><strong>A planilha aparece na próxima coleta</strong><p>Ela usa um resumo de cada round que as partidas ganham a partir da próxima atualização dos dados (ou toque em Atualizar).</p></div>`;
  }
  const { por, todos } = agregar(ps);
  const mapas = [...por.entries()].sort((a, b) => b[1].rounds[1] - a[1].rounds[1]);
  const treinar = oQueTreinar(por);
  const linha = (nome, g, total = false) => `<tr class="${total ? "an-total" : ""}"><th scope="row">${esc(nome)}<small>${g.partidas} partida${g.partidas === 1 ? "" : "s"} · ${g.rounds[1]} rounds</small></th>
    ${celula(g.atk)}${celula(g.def)}${celula(g.pistolAtk)}${celula(g.pistolDef)}${celula(g.posPistolGanho, { bom: 70, ruim: 55 })}${celula(g.posPistolPerdido, { bom: 35, ruim: 15 })}
    ${COMPRAS.map(([k]) => celula(g.compra[k], k === 3 ? {} : { bom: 35, ruim: 15 })).join("")}
    ${celula(g.conv, { bom: 70, ruim: 60 })}${celula(g.recup, { bom: 35, ruim: 25 })}${celula(g.posPlant, { bom: 65, ruim: 50 })}${celula(g.retake, { bom: 35, ruim: 20 })}
    <td class="an-sites">${sites(g.plantas)}<small>plant médio ${tempo(media(g.tempoPlant))}</small></td><td class="an-sites">${sites(g.sofridos)}</td></tr>`;
  return `<section class="secao">
      ${treinar.length ? `<div class="an-treinar">${treinar.map((x) => `<div class="an-treinar__item"><span class="an-treinar__n">${x.x}%</span>
        <span><strong>${esc(x.nome)} · ${esc(x.mapa)}</strong><small>${x.par[0]} de ${x.par[1]} rounds · treinar ${esc(x.dica)}</small></span></div>`).join("")}</div>` : ""}
      <div class="rolagem"><table class="tabela an-tabela">
        <thead><tr><th rowspan="2">Mapa</th><th colspan="2">Lado</th><th colspan="2">Pistol</th><th colspan="2">Round 2 depois do pistol</th><th colspan="3">Compra da equipe</th>
          <th colspan="2">Vantagem</th><th>Pós-plant</th><th>Retake</th><th>Onde plantamos</th><th>Onde nos atacam</th></tr>
          <tr><th>ATQ</th><th>DEF</th><th>ATQ</th><th>DEF</th><th title="Ganhou o pistol">ganhou</th><th title="Perdeu o pistol">perdeu</th>${COMPRAS.map(([, n]) => `<th>${n}</th>`).join("")}
          <th title="Pegou o primeiro abate (5v4)">5v4</th><th title="Sofreu o primeiro abate (4v5)">4v5</th><th title="Rounds em que a equipe plantou">vitória</th><th title="Rounds em que o adversário plantou e a equipe defendia">vitória</th><th></th><th></th></tr></thead>
        <tbody>${mapas.map(([m, g]) => linha(m, g)).join("")}${mapas.length > 1 ? linha("Todos os mapas", todos, true) : ""}</tbody></table></div>
      <p class="suave pequeno" style="margin-top:8px">${icone("info")} Verde = acima do esperado, vermelho = abaixo; apagado = menos de ${MIN} rounds. Segue os filtros (use "Contexto" para ver só scrims e oficiais).
        "Compra" é o que a equipe tinha (eco abaixo do force; "completa" inclui anti-eco). Vantagem: quem pega o primeiro abate fecha o round em quanto?</p>
    </section>`;
}
