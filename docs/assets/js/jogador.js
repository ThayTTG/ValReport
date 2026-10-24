// Perfil de um jogador: Geral, Partidas, Agentes, Mapas, Armas, Performance e Calor

import {
  esc, num, pct, sinal, div, imagem, imgAgente, imgCard, imgRank, imgMapaFaixa, imgArma, nomeTier, relativo, dataCurta,
  tile, destaque, vazio, cartao, secao, barra, escala, selo, classeSinal, classeNivel, icone, TIPOS, nomeFila,
} from "./util.js";
import { B, itensDe, stats, agrupar, calor as carregarCalor, passaPartida, passaMembro } from "./dados.js";
import { barraFiltros, listaPorDia, tabela, celulaAgente, forma, vereditoSelo, linhaPartida } from "./componentes.js";
import { linha, histograma, precisao, moldeMapa, desenharCalor, calloutMaisProximo } from "./graficos.js";

export const ABAS_JOGADOR = [["geral", "Geral"], ["partidas", "Partidas"], ["agentes", "Agentes"], ["mapas", "Mapas"],
  ["armas", "Armas"], ["performance", "Performance"], ["calor", "Mapa de calor"]];

export function cabecalhoJogador(e) {
  const av = (B.avaliacao[e.slug] || [])[0];
  const banner = imgCard(e.card, "wideart");
  return `<header class="cabecalho">
    ${banner ? `<div class="cabecalho__banner" style="background-image:url('${esc(banner)}')"></div>` : ""}
    <div class="cabecalho__corpo">
      ${imagem(imgCard(e.card) || imgAgente(e.agente), e.apelido, "avatar", e.apelido)}
      <div class="cabecalho__info">
        <h1>${esc(e.apelido)}</h1>
        <div class="sub">${e.riot ? `<span>${esc(e.riot)}</span>` : ""}
          ${e.funcao ? `<span>${esc(e.funcao)}${e.agente ? ` · ${esc(e.agente)}` : ""}</span>` : ""}
          ${e.lvl ? `<span>Nível ${num(e.lvl)}</span>` : ""}
          <span>${e.partidas} partida${e.partidas === 1 ? "" : "s"} contabilizada${e.partidas === 1 ? "" : "s"}</span>
          ${e.ultima ? `<span>última ${esc(relativo(e.ultima, new Date(B.meta.gerado_em)))}</span>` : ""}</div>
      </div>
      <div class="cabecalho__lado">
        <div class="rank">${imagem(imgRank(e.tier), nomeTier(e.tn), "", nomeTier(e.tn))}<div><small>Elo</small><strong>${esc(nomeTier(e.tn))}</strong></div></div>
        ${av ? `<div class="rank" title="Índice NokyLabs dos últimos ${B.meta.regras.janela_dias} dias"><div style="padding:0 6px 0 8px;font:700 26px var(--fonte-titulo);color:var(--destaque-texto)">${av.indice}</div><div><small>Índice</small><strong>${esc(av.funcao)}</strong></div></div>` : ""}
      </div>
    </div></header>`;
}

export function abas(base, ativa, lista, q = "") {
  return `<nav class="abas" aria-label="Seções">${lista.map(([id, t]) =>
    `<a class="aba ${id === ativa ? "ativa" : ""}" href="${base}/${id}${q}" ${id === ativa ? 'aria-current="page"' : ""}>${esc(t)}</a>`).join("")}</nav>`;
}

// ---------- Avaliação (14 dias, a mesma do Discord) ----------
function cartaoAvaliacao(x) {
  const mets = x.metricas.map((m) => {
    const fmt = (v) => (["kast", "sobrevivencia"].includes(m.k) ? pct(v) : ["impacto"].includes(m.k) ? sinal(v, 1, "%") : num(v, ["adr"].includes(m.k) ? 0 : 2));
    const bom = m.z >= 0.5, ruim = m.z <= -0.5;
    const maior = Math.max(Math.abs(m.voce), Math.abs(m.media)) || 1;
    return `<div class="comparacao__linha"><span>${esc(m.nome)}</span>
      <strong class="${bom ? "bom" : ruim ? "ruim" : ""}">${fmt(m.voce)} <span class="suave pequeno">· média ${fmt(m.media)}</span></strong>
      <div class="barras">${barra(Math.abs(m.voce) / maior, bom ? "vitoria" : ruim ? "derrota" : "")}${barra(Math.abs(m.media) / maior, "neutra")}</div></div>`;
  }).join("");
  const kit = x.kit ? `<li>Kit: ${num(x.kit.util_pr, 1)} habilidades/round (média da função ${num(x.kit.util_ref, 1)}), ${num(x.kit.ult_partida, 1)} ults por partida (média ${num(x.kit.ult_ref_partida, 1)}), ${num(x.kit.assist_por_10, 1)} assistências a cada 10 habilidades.</li>` : "";
  const trade = x.trade ? `<li>Trade: em ${x.trade.em_alcance_pct}% das mortes havia um aliado a até ${B.meta.regras.trade_m} m (mediana ~${x.trade.mediana_m} m); ${x.trade.trocadas_pct}% das mortes foram trocadas.</li>` : "";
  const cl = x.clutch ? `<li>Clutches: venceu ${x.clutch.vencidos} de ${x.clutch.tentados} (o normal nessas situações seria ~${num(x.clutch.esperado, 1)}).</li>` : "";
  const solo = x.solo && (x.solo.kills || x.solo.mortes) ? `<li>Jogadas solo (a mais de ${B.meta.regras.isolado_m} m do time): ${x.solo.kills} abates, ${x.solo.mortes} mortes, saldo de ${sinal(x.solo.impacto / 100, 1)} round(s).</li>` : "";
  return cartao(`Índice NokyLabs · ${x.funcao}`, `<div class="indice">
      <div class="indice__topo"><div class="indice__valor">${x.indice}<small>/100</small></div>
        <div><div>${vereditoSelo(x.tipo, x.veredito)}</div>
        <div class="suave pequeno" style="margin-top:4px">margem ${x.margem[0]}–${x.margem[1]} · ${x.rounds} rounds · ${x.partidas} partida${x.partidas === 1 ? "" : "s"}</div></div></div>
      ${escala(x.indice, x.margem)}
      <p class="suave pequeno">50 = média de ${esc(x.funcao.toLowerCase())} nos lobbies de vocês (últimos ${B.meta.regras.janela_dias} dias). Não muda com os filtros.</p>
      <div class="comparacao" style="margin-top:6px">${mets}</div>
      ${x.fortes.length || x.fracos.length ? `<ul class="lista-pontos">${x.fortes.length ? `<li><strong>Pontos fortes:</strong> ${esc(x.fortes.join(", "))}</li>` : ""}${x.fracos.length ? `<li><strong>A melhorar:</strong> ${esc(x.fracos.join(", "))}</li>` : ""}${kit}${trade}${cl}${solo}</ul>` : `<ul class="lista-pontos">${kit}${trade}${cl}${solo}</ul>`}
    </div>`, `<span class="suave pequeno">vs lobby</span>`);
}

// ---------- Geral ----------
function geral(e, itens, s, q) {
  const avs = B.avaliacao[e.slug] || [];
  const av = avs[0];
  const impRef = av?.metricas.find((m) => m.k === "impacto")?.media;
  const top = (lst, n) => lst.sort((a, b) => b.itens.length - a.itens.length).slice(0, n);
  const agentes = top(agrupar(itens, (it) => it.m.ag), 4);
  const mapas = top(agrupar(itens, (it) => it.p.mapa), 4);
  const armas = Object.entries(s.armas).filter(([n]) => B.meta.armas[n]).sort((a, b) => b[1][0] - a[1][0]).slice(0, 4);
  const totalK = Object.values(s.armas).reduce((a, v) => a + v[0], 0);
  return `
    <div class="destaques">
      ${destaque("Impacto por round", sinal(s.impr, 1, "%"), impRef != null ? `média da função: ${sinal(impRef, 1, "%")}` : "quanto mudou a chance de vencer", classeSinal(s.impr, 1))}
      ${destaque("K/D", num(s.kd, 2), `KDA ${num(s.kda, 2)} · ${s.k}/${s.mo}/${s.a}`)}
      ${destaque("Vitórias", pct(s.win), `${s.v}V · ${s.d}D${s.e ? ` · ${s.e}E` : ""}`, classeNivel(s.win, 0.55, 0.45))}
      ${destaque("ADR", num(s.adr), `ACS ${num(s.acs)} · DDΔ ${sinal(s.ddd, 0)}`)}
    </div>
    <div class="grade-stats" style="margin-top:10px">
      ${tile("Partidas", num(s.n), `${num(s.r)} rounds`)}
      ${tile("HS%", pct(s.hsp, 1), "acertos na cabeça")}
      ${tile("KAST", pct(s.kastp), "rounds com participação")}
      ${tile("Abates/round", num(s.kpr, 2), `${num(s.dpr, 2)} mortes/round`)}
      ${tile("First kills", num(s.fk), `${num(s.fd)} first deaths`, s.fk > s.fd ? "bom" : s.fk < s.fd ? "ruim" : "")}
      ${tile("Trades", num(s.tr), `${pct(s.trocadas)} das mortes trocadas`)}
      ${tile("Clutches", `${s.clutchesV}/${s.clutches}`, `esperado ~${num(s.cle, 1)}`)}
      ${tile("Multi-kills", `${s.mk[1] + s.mk[2] + s.mk[3]}`, `3K ${s.mk[1]} · 4K ${s.mk[2]} · Ace ${s.mk[3]}`)}
      ${tile("Spike", `${s.pl} / ${s.df}`, "plantadas / desarmadas")}
      ${tile("MVP", num(s.mvp), `${num(s.tmvp)} MVP do time`)}
      ${tile("Habilidades", num(div(s.ut, s.r), 1), "por round")}
      ${tile("Índice médio", num(s.indMedio), "por partida (vs lobby)")}
    </div>
    <div class="grade-lateral secao">
      <div class="pilha">
        ${avs.map(cartaoAvaliacao).join("") || cartao("Índice NokyLabs", `<p class="suave pequeno">Sem partidas nos últimos ${B.meta.regras.janela_dias} dias.</p>`)}
        ${cartao("Precisão", precisao(s.hsp, s.bsp, s.lsp) + `<p class="suave pequeno" style="margin-top:10px">${num(s.hs + s.bs + s.ls)} acertos contados.</p>`)}
        ${cartao("Agentes", agentes.map(({ chave, s: a, itens: l }) => `<a class="celula-ag" style="justify-content:space-between;padding:6px 0;color:inherit" href="#/j/${e.slug}/agentes${q}">
            ${imagem(imgAgente(chave), chave)}<div style="flex:1"><strong>${esc(chave)}</strong><small>${l.length} partida${l.length === 1 ? "" : "s"} · ${pct(a.win)} vitórias</small></div>
            <strong class="${classeSinal(a.impr, 1)}">${sinal(a.impr, 1, "%")}</strong></a>`).join("") || `<p class="suave pequeno">—</p>`)}
        ${cartao("Mapas", mapas.map(({ chave, s: a, itens: l }) => `<div style="display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:6px 0">
            <strong>${esc(chave)}</strong><span class="pequeno">${a.v}V ${a.d}D · ${pct(a.win)}</span>
            <div style="grid-column:1/-1">${barra(a.win, a.win >= 0.5 ? "vitoria" : "derrota")}</div></div>`).join("") || `<p class="suave pequeno">—</p>`)}
        ${cartao("Armas", armas.map(([n, v]) => `<div style="display:flex;align-items:center;gap:10px;padding:6px 0">
            ${imgArma(n) ? `<img src="${esc(imgArma(n))}" alt="" style="height:22px;width:64px;object-fit:contain" loading="lazy" referrerpolicy="no-referrer" data-sefalhar="ocultar">` : ""}
            <strong style="flex:1">${esc(n)}</strong><span class="pequeno">${v[0]} abates · ${pct(div(v[0], totalK))}</span></div>`).join("") || `<p class="suave pequeno">—</p>`)}
      </div>
      <div>
        <div class="secao__titulo"><h2>Partidas recentes</h2><a class="pequeno" href="#/j/${e.slug}/partidas${q}">Ver todas</a></div>
        ${forma(itens)}
        ${listaPorDia(itens.slice(0, 8)) || vazio("Nenhuma partida com estes filtros")}
      </div>
    </div>`;
}

// ---------- Agentes ----------
function agentes(itens) {
  const grupos = agrupar(itens, (it) => it.m.ag);
  if (!grupos.length) return vazio("Nenhum agente com estes filtros");
  return secao("Agentes", tabela("agentes", grupos, [
    { k: "ag", t: "Agente", v: (g) => g.chave, f: (g) => celulaAgente(g.chave, esc(B.meta.agentes[g.chave]?.fn || "")) },
    { k: "n", t: "Partidas", v: (g) => g.s.n },
    { k: "win", t: "Vitórias", v: (g) => g.s.win, f: (g) => `<span class="${classeNivel(g.s.win, 0.55, 0.45)}">${pct(g.s.win)}</span>` },
    { k: "kd", t: "K/D", v: (g) => g.s.kd, f: (g) => num(g.s.kd, 2) },
    { k: "kda", t: "KDA", v: (g) => g.s.kda, f: (g) => num(g.s.kda, 2) },
    { k: "adr", t: "ADR", v: (g) => g.s.adr, f: (g) => num(g.s.adr) },
    { k: "acs", t: "ACS", v: (g) => g.s.acs, f: (g) => num(g.s.acs) },
    { k: "hs", t: "HS%", v: (g) => g.s.hsp, f: (g) => pct(g.s.hsp, 1) },
    { k: "kast", t: "KAST", v: (g) => g.s.kastp, f: (g) => pct(g.s.kastp) },
    { k: "fk", t: "FK–FD", v: (g) => g.s.fk - g.s.fd, f: (g) => `${g.s.fk}–${g.s.fd}` },
    { k: "imp", t: "Impacto/round", v: (g) => g.s.impr, f: (g) => `<strong class="${classeSinal(g.s.impr, 1)}">${sinal(g.s.impr, 1, "%")}</strong>` },
    { k: "ind", t: "Índice médio", v: (g) => g.s.indMedio, f: (g) => num(g.s.indMedio) },
  ], { padrao: "n" }), `<span class="suave pequeno">toque no título da coluna para ordenar</span>`);
}

// ---------- Mapas ----------
function mapas(itens) {
  const grupos = agrupar(itens, (it) => it.p.mapa).sort((a, b) => b.itens.length - a.itens.length);
  if (!grupos.length) return vazio("Nenhum mapa com estes filtros");
  return secao("Mapas", `<div class="grade-mapas">${grupos.map(({ chave, s: g, itens: l }) => {
    const [ra, rva] = g.lados.a, [rd, rvd] = g.lados.d;
    const ag = agrupar(l, (it) => it.m.ag).sort((a, b) => b.itens.length - a.itens.length)[0];
    return `<article class="mapa-cartao">
      <div class="mapa-cartao__banner" style="${imgMapaFaixa(chave) ? `background-image:url('${esc(imgMapaFaixa(chave))}')` : ""}"><strong>${esc(chave)}</strong>${selo(`${g.v}V · ${g.d}D`, g.win >= 0.5 ? "vitoria" : "derrota")}</div>
      <div class="mapa-cartao__corpo">
        <div class="lado-barra"><span>Vitórias</span>${barra(g.win, g.win >= 0.5 ? "vitoria" : "derrota")}<span>${pct(g.win)}</span></div>
        <div class="lado-barra"><span>Ataque</span>${barra(div(rva, ra))}<span>${pct(div(rva, ra))} <small class="suave">${ra}r</small></span></div>
        <div class="lado-barra"><span>Defesa</span>${barra(div(rvd, rd))}<span>${pct(div(rvd, rd))} <small class="suave">${rd}r</small></span></div>
        <div class="grade-stats" style="grid-template-columns:repeat(4,1fr);margin-top:4px">
          ${tile("K/D", num(g.kd, 2))}${tile("ADR", num(g.adr))}${tile("HS%", pct(g.hsp))}${tile("Impacto", sinal(g.impr, 1, "%"), "", classeSinal(g.impr, 1))}
        </div>
        ${ag ? `<div class="celula-ag" style="min-width:0">${imagem(imgAgente(ag.chave), ag.chave)}<div><strong>${esc(ag.chave)}</strong><small>agente mais jogado aqui · ${ag.itens.length} partida${ag.itens.length === 1 ? "" : "s"}</small></div></div>` : ""}
      </div></article>`;
  }).join("")}</div>`);
}

// ---------- Armas ----------
function armas(itens) {
  const s = stats(itens);
  const linhas = Object.entries(s.armas).map(([n, v]) => ({ n, k: v[0], hs: v[1], bs: v[2], ls: v[3], dano: v[4], r: v[5], dist: div(v[6], v[7]), maior: v[8] }));
  const total = linhas.reduce((a, l) => a + l.k, 0);
  const armasReais = linhas.filter((l) => B.meta.armas[l.n] && (l.k || l.r));
  const outros = linhas.filter((l) => !B.meta.armas[l.n] && l.k);
  if (!armasReais.length) return vazio("Nenhuma arma com estes filtros");
  const tab = tabela("armas", armasReais, [
    { k: "n", t: "Arma", v: (l) => l.n, f: (l) => `<div class="celula-ag" style="min-width:170px">${imgArma(l.n) ? `<img src="${esc(imgArma(l.n))}" alt="" style="width:70px;height:26px;object-fit:contain;background:none" loading="lazy" referrerpolicy="no-referrer" data-sefalhar="ocultar">` : ""}<strong>${esc(l.n)}</strong></div>` },
    { k: "k", t: "Abates", v: (l) => l.k },
    { k: "p", t: "% dos abates", v: (l) => div(l.k, total), f: (l) => pct(div(l.k, total)) },
    { k: "hs", t: "HS% (aprox.)", v: (l) => div(l.hs, l.hs + l.bs + l.ls), f: (l) => pct(div(l.hs, l.hs + l.bs + l.ls)) },
    { k: "dr", t: "Dano/round", v: (l) => div(l.dano, l.r), f: (l) => num(div(l.dano, l.r)) },
    { k: "r", t: "Rounds", v: (l) => l.r },
    { k: "dist", t: "Dist. média", v: (l) => l.dist, f: (l) => (l.dist != null ? `${num(l.dist)} m` : "—") },
    { k: "maior", t: "Maior abate", v: (l) => l.maior, f: (l) => (l.maior ? `${num(l.maior)} m` : "—") },
  ], { padrao: "k" });
  return secao("Armas", tab + `<p class="suave pequeno" style="margin-top:10px">Abates por arma são exatos. HS% e dano por arma usam a arma comprada no round (a API não diz qual arma acertou cada tiro), então são aproximados, como em outros trackers.</p>`)
    + (outros.length ? secao("Outros abates", `<div class="chips">${outros.sort((a, b) => b.k - a.k).map((l) => `<span class="chip">${esc(l.n)} <strong>${l.k}</strong></span>`).join("")}</div>`) : "");
}

// ---------- Performance ----------
const METRICAS_GRAF = [["imp", "Impacto/round", (m) => (m.r ? (100 * m.imp) / m.r : null), 1, "%", 0], ["kd", "K/D", (m) => (m.d ? m.k / m.d : m.k), 2, "", 1],
  ["adr", "ADR", (m) => m.dd / m.rt, 0, "", null], ["acs", "ACS", (m) => m.sc / m.rt, 0, "", null],
  ["hs", "HS%", (m) => { const t = m.hs + m.bs + m.ls; return t ? (100 * m.hs) / t : null; }, 1, "%", null], ["ind", "Índice", (m) => m.ind, 0, "", 50]];
function performance(e, itens, s, q) {
  const met = METRICAS_GRAF.find((x) => x[0] === q.get("metrica")) || METRICAS_GRAF[0];
  const crono = [...itens].reverse();
  const pontos = crono.map(({ p, m }) => ({ y: met[2](m), rotulo: `${dataCurta(p.t)} ${p.mapa} (${m.ag})`, curto: dataCurta(p.t), classe: m.res })).filter((p) => p.y != null);
  const tipos = Object.entries(TIPOS).map(([k, t]) => ({ k, t, v: s.tipos[k] })).filter((x) => x.v);
  const lado = (l) => ({ r: l[0], v: l[1], k: l[2], d: l[3], imp: l[4], dano: l[5], fk: l[6], fd: l[7] });
  const A = lado(s.lados.a), D = lado(s.lados.d);
  const avKit = (B.avaliacao[e.slug] || [])[0]?.kit;
  return `
    ${secao("Evolução", `<div class="cartao"><div class="segmentos" role="group" aria-label="Métrica">${METRICAS_GRAF.map(([k, t]) =>
      `<button type="button" data-param="metrica" data-valor="${k}" aria-pressed="${k === met[0]}">${t}</button>`).join("")}</div>
      <div style="margin-top:12px">${linha(pontos, { referencia: met[5], casas: met[3], sufixo: met[4] })}</div></div>`)}
    <div class="grade-2 secao">
      ${cartao("Economia (tipo de round)", tabela("economia", tipos, [
        { k: "t", t: "Tipo", v: (x) => x.t, f: (x) => `<strong>${esc(x.t)}</strong>` },
        { k: "r", t: "Rounds", v: (x) => x.v[0] },
        { k: "w", t: "Vitórias", v: (x) => div(x.v[1], x.v[0]), f: (x) => pct(div(x.v[1], x.v[0])) },
        { k: "kd", t: "K/D", v: (x) => div(x.v[2], x.v[3]), f: (x) => num(div(x.v[2], x.v[3]) ?? x.v[2], 2) },
        { k: "adr", t: "ADR", v: (x) => div(x.v[5], x.v[0]), f: (x) => num(div(x.v[5], x.v[0])) },
        { k: "i", t: "Impacto/round", v: (x) => div(100 * x.v[4], x.v[0]), f: (x) => `<strong class="${classeSinal(div(100 * x.v[4], x.v[0]), 1)}">${sinal(div(100 * x.v[4], x.v[0]), 1, "%")}</strong>` },
      ], { padrao: "r" }) + `<p class="suave pequeno" style="margin-top:8px">Eco: carga média abaixo de ${num(B.meta.regras.eco)}; armado: a partir de ${num(B.meta.regras.armado)}. Anti-eco = vocês armados contra eco.</p>`)}
      ${cartao("Ataque × Defesa", `<div class="grade-stats" style="grid-template-columns:repeat(2,1fr)">
          ${[["Ataque", A], ["Defesa", D]].map(([t, x]) => `<div class="tile"><div class="tile__rotulo">${t}</div>
            <div class="tile__valor ${classeSinal(div(100 * x.imp, x.r), 1)}">${sinal(div(100 * x.imp, x.r), 1, "%")}</div>
            <div class="tile__sub">${x.r} rounds · ${pct(div(x.v, x.r))} vencidos</div>
            <div class="tile__sub">K/D ${num(div(x.k, x.d) ?? x.k, 2)} · ADR ${num(div(x.dano, x.r))} · FK ${x.fk}–${x.fd}</div></div>`).join("")}
        </div>`)}
      ${cartao("Primeiros duelos", `<div class="grade-stats" style="grid-template-columns:repeat(3,1fr)">
          ${tile("First kills", num(s.fk), `${pct(s.fkpr)} dos rounds`, "bom")}${tile("First deaths", num(s.fd), `${pct(s.fdpr)} dos rounds`, "ruim")}
          ${tile("Saldo", sinal(s.fk - s.fd, 0), "abriu − foi aberta", classeSinal(s.fk - s.fd, 1))}</div>`)}
      ${cartao("Clutches", tabela("clutch", [0, 1, 2, 3, 4].map((i) => ({ i, t: s.cl[i], v: s.clv[i] })).filter((x) => x.t), [
        { k: "s", t: "Situação", v: (x) => x.i, f: (x) => `<strong>1v${x.i + 1}</strong>` },
        { k: "t", t: "Tentativas", v: (x) => x.t }, { k: "v", t: "Vencidos", v: (x) => x.v },
        { k: "p", t: "Taxa", v: (x) => div(x.v, x.t), f: (x) => pct(div(x.v, x.t)) },
      ], { padrao: "s" }) + `<p class="suave pequeno" style="margin-top:8px">Pelo modelo de chance de vitória, o esperado nessas situações seria vencer ~${num(s.cle, 1)} de ${s.clutches}.</p>`)}
      ${cartao("Trade e posicionamento", `${histograma(s.dm, B.meta.regras.trade_m, B.meta.regras.isolado_m)}
        <div class="grade-stats" style="grid-template-columns:repeat(3,1fr);margin-top:12px">
          ${tile("Aliado perto", pct(s.alcance), `até ${B.meta.regras.trade_m} m na morte`, classeNivel(s.alcance, 0.6, 0.45))}
          ${tile("Mortes trocadas", pct(s.trocadas), `${s.trc} de ${s.mo}`)}
          ${tile("Mediana", s.medianaDist != null ? `${num(s.medianaDist)} m` : "—", "até o aliado")}</div>`)}
      ${cartao("Jogadas solo", `<div class="grade-stats" style="grid-template-columns:repeat(3,1fr)">
          ${tile("Abates solo", num(s.ks), `a +${B.meta.regras.isolado_m} m do time`)}${tile("Mortes isoladas", num(s.mi), `${s.mft} fora do alcance de trade`)}
          ${tile("Saldo", sinal(s.imps, 1), "rounds gerados", classeSinal(s.imps, 0.3))}</div>
          <p class="suave pequeno" style="margin-top:8px">Saldo positivo = o lurk/flanco está dando resultado. Negativo = está custando rounds.</p>`)}
      ${cartao("Kit (habilidades)", `<div class="grade-stats" style="grid-template-columns:repeat(3,1fr)">
          ${tile("Habilidades", num(div(s.ut, s.r), 1), avKit ? `por round · média ${num(avKit.util_ref, 1)}` : "por round")}
          ${tile("Ultimates", num(div(s.ul, s.n), 1), avKit ? `por partida · média ${num(avKit.ult_ref_partida, 1)}` : "por partida")}
          ${tile("Abates com skill", num(s.kh), "no período")}</div>
          <p class="suave pequeno" style="margin-top:8px">A API informa só o total de habilidades da partida (não quando nem onde). Médias da função: últimos ${B.meta.regras.janela_dias} dias.</p>`)}
      ${cartao("Multi-kills", `<div class="grade-stats" style="grid-template-columns:repeat(4,1fr)">
          ${tile("2K", num(s.mk[0]))}${tile("3K", num(s.mk[1]))}${tile("4K", num(s.mk[2]))}${tile("Ace", num(s.mk[3]), "", s.mk[3] ? "bom" : "")}</div>`)}
    </div>`;
}

// ---------- Mapa de calor ----------
async function calor(e, itens, q) {
  const dados = await carregarCalor(e.slug);
  const ok = new Map(itens.map((it) => [it.p.id, it]));
  const evs = dados.e.map(([mi, tipo, lado, x, y, n]) => ({ id: dados.partidas[mi], tipo, lado, x, y, n })).filter((ev) => ok.has(ev.id));
  const porMapa = new Map(), partidasPorMapa = new Map();
  for (const ev of evs) {
    const m = ok.get(ev.id).p.mapa;
    porMapa.set(m, (porMapa.get(m) || 0) + 1);
    if (!partidasPorMapa.has(m)) partidasPorMapa.set(m, new Set());
    partidasPorMapa.get(m).add(ev.id);
  }
  if (!porMapa.size) return { html: vazio("Sem posições registradas com estes filtros") };
  const mapas = [...porMapa].sort((a, b) => b[1] - a[1]).map(([m]) => m);
  const mapa = mapas.includes(q.get("cm")) ? q.get("cm") : mapas[0];
  const ver = ["mortes", "abates", "ambos"].includes(q.get("cv")) ? q.get("cv") : "ambos";
  const lado = ["0", "1"].includes(q.get("cl")) ? Number(q.get("cl")) : -1;
  const sel = evs.filter((ev) => ok.get(ev.id).p.mapa === mapa && (lado < 0 || ev.lado === lado));
  const mortes = sel.filter((ev) => ev.tipo === 0), kills = sel.filter((ev) => ev.tipo === 1);
  const regioes = new Map();
  for (const ev of mortes) {
    const r = calloutMaisProximo(mapa, ev.x, ev.y);
    if (!r) continue;
    const x = regioes.get(r) || { n: 0, a: 0, d: 0 };
    x.n++; ev.lado === 0 ? x.a++ : x.d++; regioes.set(r, x);
  }
  const top = [...regioes].sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  const partidasMapa = new Set(sel.map((ev) => ev.id)).size;
  const html = `<div class="grade-mapa secao">
    <div class="cartao">${moldeMapa(mapa)}
      <p class="suave pequeno" style="margin-top:10px">Calor = onde as mortes se repetem; pontos claros = mortes; verdes = de onde saiu o abate. Mortes na própria spike não entram (igual ao placar).</p></div>
    <div class="pilha">
      ${cartao("Mapa (partidas)", `<div class="chips">${mapas.map((m) => `<button class="chip" style="cursor:pointer;${m === mapa ? "border-color:var(--destaque);color:var(--destaque-texto)" : ""}" type="button" data-param="cm" data-valor="${esc(m)}" aria-pressed="${m === mapa}">${esc(m)} <strong>${partidasPorMapa.get(m).size}</strong></button>`).join("")}</div>`)}
      ${cartao("Mostrar", `<div class="segmentos">${[["ambos", "Mortes e abates"], ["mortes", "Só mortes"], ["abates", "Só abates"]].map(([k, t]) =>
        `<button type="button" data-param="cv" data-valor="${k}" aria-pressed="${k === ver}">${t}</button>`).join("")}</div>
        <div class="segmentos" style="margin-top:8px">${[["-1", "Os dois lados"], ["0", "Ataque"], ["1", "Defesa"]].map(([k, t]) =>
        `<button type="button" data-param="cl" data-valor="${k}" aria-pressed="${String(lado) === k}">${t}</button>`).join("")}</div>
        <div class="chips" style="margin-top:12px"><span class="chip chip--ponto">${mortes.length} mortes</span><span class="chip chip--ponto chip--kill">${kills.length} abates</span><span class="chip">${partidasMapa} partida${partidasMapa === 1 ? "" : "s"}</span></div>`)}
      ${cartao("Onde mais morre", top.length ? `<div class="pilha" style="display:grid;gap:8px">${top.map(([r, x]) => `<div>
          <div style="display:flex;justify-content:space-between;font-size:13.5px"><strong>${esc(r)}</strong><span>${x.n}× <span class="suave">(${x.a} atq · ${x.d} def)</span></span></div>
          ${barra(x.n / top[0][1].n, "derrota")}</div>`).join("")}</div>` : `<p class="suave pequeno">Os nomes das regiões aparecem quando os dados do mapa são baixados pelo report.</p>`)}
    </div>
  </div>`;
  return { html, depois: (el) => desenharCalor(el, mapa, sel, { mostrar: ver }) };
}

// ---------- Entrada ----------
export async function viewJogador(slug, aba, f, q) {
  const e = B.porSlug.get(slug);
  if (!e) return { html: vazio("Jogador não encontrado", `<p>Volte para a <a href="#/">equipe</a>.</p>`) };
  aba = ABAS_JOGADOR.some(([id]) => id === aba) ? aba : "geral";
  const itens = itensDe(slug, f);
  const s = stats(itens);
  const qs = filtrosQuery(f);
  let corpo = "", depois = null;
  if (!e.partidas) corpo = vazio("Ainda sem partidas", `<p>Quando ${esc(e.apelido)} jogar uma partida válida, ela aparece aqui.</p>`);
  else if (!itens.length && aba !== "geral") corpo = vazio("Nenhuma partida com estes filtros", `<p><button class="limpar" type="button" data-limpar-filtros>Limpar filtros</button></p>`);
  else if (aba === "geral") corpo = geral(e, itens, s, qs);
  else if (aba === "partidas") corpo = `${forma(itens, 20)}${listaPorDia(itens.slice(0, Number(q.get("n") || 40)))}
      ${itens.length > Number(q.get("n") || 40) ? `<p style="text-align:center;margin-top:14px"><button class="limpar" type="button" data-param="n" data-valor="${Number(q.get("n") || 40) + 40}">Mostrar mais partidas</button></p>` : ""}`;
  else if (aba === "agentes") corpo = agentes(itens);
  else if (aba === "mapas") corpo = mapas(itens);
  else if (aba === "armas") corpo = armas(itens);
  else if (aba === "performance") corpo = performance(e, itens, s, q);
  else if (aba === "calor") ({ html: corpo, depois } = await calor(e, itens, q));
  return {
    titulo: `${e.apelido} · ${ABAS_JOGADOR.find(([id]) => id === aba)[1]}`,
    html: `${cabecalhoJogador(e)}${abas(`#/j/${slug}`, aba, ABAS_JOGADOR, qs)}${barraFiltros(f, slug)}
      ${itens.length && aba !== "geral" ? `<p class="suave pequeno" style="margin-top:6px">${itens.length} partida${itens.length === 1 ? "" : "s"} · ${s.v}V ${s.d}D · ${num(s.r)} rounds</p>` : ""}
      <div class="secao">${corpo}</div>`,
    depois,
  };
}

export function filtrosQuery(f) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (!["todas", "todos", "tudo"].includes(String(v))) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
export { linhaPartida, passaPartida, passaMembro };
