// Perfil de um jogador: Geral, Partidas, Agentes, Mapas, Armas, Performance e Calor

import {
  esc, num, pct, sinal, div, imagem, imgAgente, imgCard, imgRank, imgMapaFaixa, imgArma, nomeTier, relativo, dataCurta,
  tile, destaque, vazio, cartao as cartaoSimples, secao, barra, escala, selo, classeSinal, classeNivel, icone, TIPOS, nomeFila,
} from "./util.js";
import { B, itensDe, stats, agrupar, calor as carregarCalor, passaPartida, passaMembro } from "./dados.js";
import { barraFiltros, listaPorDia, tabela, celulaAgente, forma, vereditoSelo, linhaPartida, segmentoTipoRound, lerTipoRound, TIPO_COD, miniAbas, cartaoMin } from "./componentes.js";
import { linha, linhaElo, histograma, precisao, moldeMapa, desenharCalor, calloutMaisProximo } from "./graficos.js";
import { calcularRecordes, gradeRecordes } from "./recordes.js";
import { temCoroa, coroaSobre } from "./coroa.js";

/** Todo cartão do perfil pode ser minimizado (a escolha vale para todos os jogadores, neste aparelho) */
const chaveCartao = (t) => `j-${t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`;
const cartao = (titulo, corpo, extra = "") => cartaoMin(chaveCartao(titulo), titulo, corpo, extra);

const ultimoElo = (slug) => (B.elo[slug] || []).filter((h) => h.tier != null).at(-1);

export const ABAS_JOGADOR = [["geral", "Geral"], ["partidas", "Partidas"], ["agentes", "Agentes"], ["mapas", "Mapas"],
  ["armas", "Armas"], ["performance", "Performance"], ["calor", "Mapa de calor"]];

export function cabecalhoJogador(e) {
  const av = (B.avaliacao[e.slug] || [])[0];
  const banner = imgCard(e.card, "wideart");
  return `<header class="cabecalho">
    ${banner ? `<div class="cabecalho__banner" style="background-image:url('${esc(banner)}')"></div>` : ""}
    <div class="cabecalho__corpo">
      <span class="foto-coroa">${imagem(imgCard(e.card) || imgAgente(e.agente), e.apelido, "avatar", e.apelido)}${coroaSobre(e.slug, "coroa--grande")}</span>
      <div class="cabecalho__info">
        <h1>${esc(e.apelido)}${temCoroa(e.slug) ? ` <span class="selo selo--ouro titulo-coroa">${icone("coroa")} MVP da semana</span>` : ""}</h1>
        <div class="sub">${e.riot ? `<span>${esc(e.riot)}</span>` : ""}
          ${e.funcao ? `<span>${esc(e.funcao)}${e.agente ? ` · ${esc(e.agente)}` : ""}</span>` : ""}
          ${e.lvl ? `<span>Nível ${num(e.lvl)}</span>` : ""}
          <span>${e.partidas} partida${e.partidas === 1 ? "" : "s"} contabilizada${e.partidas === 1 ? "" : "s"}</span>
          ${e.ultima ? `<span>última ${esc(relativo(e.ultima, new Date(B.meta.gerado_em)))}</span>` : ""}</div>
      </div>
      <div class="cabecalho__lado">
        ${(() => { const el = ultimoElo(e.slug); const tier = el?.tier ?? e.tier, tn = el?.tn ?? e.tn;
          return `<div class="rank">${imagem(imgRank(tier), nomeTier(tn), "", nomeTier(tn))}<div><small>Elo</small><strong>${esc(nomeTier(tn))}</strong>${el?.rr != null ? `<small class="rank__rr">${el.rr} RR${el.delta ? ` <span class="${el.delta > 0 ? "bom" : "ruim"}">${el.delta > 0 ? "+" : ""}${el.delta}</span>` : ""}</small>` : ""}</div></div>`; })()}
        ${av ? `<div class="rank" title="Índice NokyLabs dos últimos ${B.meta.regras.janela_dias} dias"><div style="padding:0 6px 0 8px;font:700 26px var(--fonte-titulo);color:var(--destaque-texto)">${av.indice}</div><div><small>Índice</small><strong>${esc(av.funcao)}</strong></div></div>` : ""}
      </div>
    </div></header>`;
}

export function abas(base, ativa, lista, q = "") {
  return `<nav class="abas" aria-label="Seções">${lista.map(([id, t]) =>
    `<a class="aba ${id === ativa ? "ativa" : ""}" href="${base}/${id}${q}" ${id === ativa ? 'aria-current="page"' : ""}>${esc(t)}</a>`).join("")}</nav>`;
}

// ---------- Avaliação (14 dias, a mesma do Discord) ----------
function cartaoAvaliacao(x, todas = [x]) {
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
  const seletor = todas.length > 1 ? `<label class="seletor-funcao"><span>Função</span><select data-param-sel="fn" data-padrao="${esc(todas[0].funcao)}" aria-label="Escolher a função do índice">
      ${todas.map((o) => `<option value="${esc(o.funcao)}"${o.funcao === x.funcao ? " selected" : ""}>${esc(o.funcao)} · ${o.indice}</option>`).join("")}</select></label>` : "";
  const pontos = [x.fortes.length ? `<li><strong>Pontos fortes:</strong> ${esc(x.fortes.join(", "))}</li>` : "", x.fracos.length ? `<li><strong>A melhorar:</strong> ${esc(x.fracos.join(", "))}</li>` : ""].join("");
  const detalhes = [kit, trade, cl, solo].join("");
  const resumo = `${pontos ? `<ul class="lista-pontos">${pontos}</ul>` : `<p class="suave pequeno">Nenhum ponto muito acima ou abaixo da média da função.</p>`}
      <p class="suave pequeno" style="margin-top:8px">50 = média de ${esc(x.funcao.toLowerCase())} nos lobbies de vocês (últimos ${B.meta.regras.janela_dias} dias). Não muda com os filtros.</p>`;
  const elo = x.vs_elo ? `<div class="vs-elo">
        <div class="vs-elo__topo"><span class="vs-elo__rotulo">vs ${esc(x.funcao.toLowerCase())} no ${esc(nomeTier(x.vs_elo.faixa))}</span>
          <strong>${x.vs_elo.indice}<small>/100</small></strong><span class="suave pequeno">margem ${x.vs_elo.margem[0]}–${x.vs_elo.margem[1]}</span></div>
        ${escala(x.vs_elo.indice, x.vs_elo.margem)}
        <p class="suave pequeno">Mesmo cálculo, mas comparando só com quem jogou ${esc(x.funcao.toLowerCase())} no ${esc(nomeTier(x.vs_elo.faixa))} nas partidas salvas (${x.vs_elo.amostras} ${x.vs_elo.amostras === 1 ? "referência" : "referências"}).${x.vs_elo.amostras < 15 ? " <strong>Poucas referências nesse elo:</strong> por enquanto a régua se apoia bastante na média geral, então leia com cautela." : ""}</p>
      </div>` : "";
  const extra = `${seletor}${x.vs_elo ? `<span class="selo selo--destaque indice__elo-mini" title="Índice comparando só com o mesmo elo">vs elo ${x.vs_elo.indice}</span>` : ""}`;
  return cartaoMin("indice", todas.length > 1 ? "Índice NokyLabs" : `Índice NokyLabs · ${x.funcao}`, `<div class="indice">
      <div class="indice__topo"><div class="indice__valor">${x.indice}<small>/100</small></div>
        <div><div>${vereditoSelo(x.tipo, x.veredito)}</div>
        <div class="suave pequeno" style="margin-top:4px">margem ${x.margem[0]}–${x.margem[1]} · ${x.rounds} rounds · ${x.partidas} partida${x.partidas === 1 ? "" : "s"}</div></div></div>
      ${escala(x.indice, x.margem)}
      ${miniAbas("indice", [["resumo", "Resumo", resumo], ["elo", "vs elo", elo], ["metricas", "Métricas", `<div class="comparacao">${mets}</div>`], ["detalhes", "Detalhes", detalhes ? `<ul class="lista-pontos">${detalhes}</ul>` : ""]])}
    </div>`, extra);
}

// ---------- Geral ----------
function geral(e, itens, s, q, qp) {
  const avs = B.avaliacao[e.slug] || [];
  const avSel = avs.find((x) => x.funcao === qp.get("fn")) || avs[0];
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
        ${avSel ? cartaoAvaliacao(avSel, avs) : cartao("Índice NokyLabs", `<p class="suave pequeno">Sem partidas nos últimos ${B.meta.regras.janela_dias} dias.</p>`)}
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
  }).join("")}</div>`) + resumosMapas(itens);
}

// Resumo do mapa a cada 5 partidas, separando solo (sem a equipe) e com a equipe
const BLOCO = 5;
function colunaPerfil(titulo, lst) {
  if (!lst.length) return `<div class="perfil-col perfil-col--vazio"><small>${titulo}</small><span class="suave pequeno">nenhuma partida neste bloco</span></div>`;
  const x = stats(lst);
  return `<div class="perfil-col"><small>${titulo} · ${x.n} partida${x.n === 1 ? "" : "s"}</small>
    <strong class="${classeSinal(x.impr, 1)}">${sinal(x.impr, 1, "%")}<span class="suave"> por round</span></strong>
    <span>${x.v}V ${x.d}D · K/D ${num(x.kd, 2)} · ADR ${num(x.adr)}</span></div>`;
}
function textoBloco(mapa, bloco, anterior) {
  const t = stats(bloco);
  const solo = bloco.filter((it) => it.m.eq <= 1), eq = bloco.filter((it) => it.m.eq > 1);
  const frases = [`Em ${mapa}, este bloco fechou em ${t.v}V ${t.d}D, com ${sinal(t.impr, 1, "%")} de impacto por round.`];
  if (solo.length && eq.length) {
    const ss = stats(solo), se = stats(eq), dif = (se.impr ?? 0) - (ss.impr ?? 0);
    frases.push(Math.abs(dif) < 2 ? "Solo e com a equipe o rendimento foi parecido."
      : `${dif > 0 ? "Com a equipe" : "Solo"} rendeu mais (${sinal(dif > 0 ? se.impr : ss.impr, 1, "%")} por round, contra ${sinal(dif > 0 ? ss.impr : se.impr, 1, "%")} ${dif > 0 ? "solo" : "com a equipe"}).`);
  } else frases.push(eq.length ? "Todas as partidas do bloco foram com a equipe." : "Todas as partidas do bloco foram sem a equipe.");
  if (anterior) {
    const a = stats(anterior), d = (t.impr ?? 0) - (a.impr ?? 0);
    frases.push(Math.abs(d) < 1.5 ? `Em relação às ${BLOCO} anteriores, ficou estável (K/D ${num(a.kd, 2)} → ${num(t.kd, 2)}).`
      : `Em relação às ${BLOCO} anteriores, o impacto ${d > 0 ? "subiu" : "caiu"} ${num(Math.abs(d), 1)} ponto${Math.abs(d) >= 1.95 ? "s" : ""} (K/D ${num(a.kd, 2)} → ${num(t.kd, 2)}).`);
  }
  const ag = agrupar(bloco, (it) => it.m.ag).sort((a, b) => b.itens.length - a.itens.length)[0];
  if (ag) frases.push(`Agente mais jogado: ${ag.chave}${ag.itens.length > 1 ? ` (${ag.itens.length}×)` : ""}.`);
  return frases.join(" ");
}
function resumosMapas(itens) {
  const grupos = agrupar(itens, (it) => it.p.mapa).map((g) => ({ mapa: g.chave, crono: [...g.itens].reverse() }));
  const prontos = grupos.filter((g) => g.crono.length >= BLOCO).sort((a, b) => b.crono.length - a.crono.length);
  const faltam = grupos.filter((g) => g.crono.length < BLOCO).sort((a, b) => b.crono.length - a.crono.length);
  const progresso = faltam.length ? `<div class="chips">${faltam.map((g) => `<span class="chip chip--progresso" style="--p:${(g.crono.length / BLOCO).toFixed(2)}">${esc(g.mapa)} <strong>${g.crono.length}/${BLOCO}</strong></span>`).join("")}</div>` : "";
  const cartoes = prontos.map(({ mapa, crono }) => {
    const nb = Math.floor(crono.length / BLOCO);
    const blocos = Array.from({ length: nb }, (_, i) => crono.slice(i * BLOCO, (i + 1) * BLOCO));
    const atual = blocos.at(-1), ant = blocos.at(-2);
    const proximo = BLOCO - (crono.length % BLOCO);
    const linhaAntiga = (b, i) => { const x = stats(b); const so = b.filter((it) => it.m.eq <= 1), eq = b.filter((it) => it.m.eq > 1);
      return `<li><strong>Partidas ${i * BLOCO + 1}–${(i + 1) * BLOCO}</strong> · ${x.v}V ${x.d}D · <span class="${classeSinal(x.impr, 1)}">${sinal(x.impr, 1, "%")}</span>
        <span class="suave">· solo ${so.length ? sinal(stats(so).impr, 1, "%") : "—"} · equipe ${eq.length ? sinal(stats(eq).impr, 1, "%") : "—"}</span></li>`; };
    return `<article class="resumo-mapa">
      <div class="resumo-mapa__topo" style="${imgMapaFaixa(mapa) ? `background-image:url('${esc(imgMapaFaixa(mapa))}')` : ""}">
        <strong>${esc(mapa)}</strong><span>Partidas ${(nb - 1) * BLOCO + 1}–${nb * BLOCO} de ${crono.length}</span></div>
      <div class="resumo-mapa__corpo">
        <div class="perfis">${colunaPerfil("Solo", atual.filter((it) => it.m.eq <= 1))}${colunaPerfil("Com a equipe", atual.filter((it) => it.m.eq > 1))}</div>
        <p class="resumo-mapa__texto">${esc(textoBloco(mapa, atual, ant))}</p>
        <div class="resumo-mapa__prox"><span class="suave pequeno">Próximo resumo em ${proximo} partida${proximo === 1 ? "" : "s"} neste mapa</span>${barra((BLOCO - proximo) / BLOCO)}</div>
        ${blocos.length > 1 ? `<details class="resumo-mapa__antes"><summary>Blocos anteriores (${blocos.length - 1})</summary><ul>${blocos.slice(0, -1).map(linhaAntiga).reverse().join("")}</ul></details>` : ""}
      </div></article>`;
  }).join("");
  return secao(`Resumo a cada ${BLOCO} partidas`, `${cartoes ? `<div class="grade-resumos">${cartoes}</div>` : `<p class="suave pequeno" style="margin-bottom:10px">Quando um mapa chegar a ${BLOCO} partidas, o resumo aparece aqui, separando o jogo solo do jogo com a equipe.</p>`}
      ${progresso ? `<div style="margin-top:12px"><p class="suave pequeno" style="margin-bottom:8px">Caminho até o próximo resumo:</p>${progresso}</div>` : ""}`,
    `<span class="suave pequeno">segue os filtros · solo = sem ninguém da equipe no time</span>`);
}

// ---------- Armas ----------
// Família de cada arma, para descrever o estilo de jogo
const FAMILIA = {
  Operator: "longa", Marshal: "longa", Outlaw: "longa", Warden: "longa",
  Vandal: "rifle", Phantom: "rifle", Bulldog: "rifle",
  Guardian: "precisao", Sheriff: "precisao", Ghost: "precisao",
  Spectre: "curta", Stinger: "curta", Bucky: "curta", Judge: "curta", Shorty: "curta",
  Ares: "pesada", Odin: "pesada",
  Classic: "pistola", Frenzy: "pistola", Bandit: "pistola",
};
const TEXTO_FAMILIA = {
  longa: "O seu jogo é preciso e meticuloso: você busca vantagem com picks a longa distância e abates que mudam o round logo no começo.",
  rifle: "O seu jogo gira em torno do rifle: duelos de média distância, posicionamento firme e consistência round após round.",
  precisao: "Você gosta de tiro calculado: poucas balas, paciência e mira na altura da cabeça para vencer o duelo no primeiro acerto.",
  curta: "O seu jogo é agressivo e de perto: entradas rápidas, cantos fechados e pressão em cima de quem está segurando o site.",
  pesada: "Você segura espaço com volume de fogo: spam nas entradas, wallbang e controle de área para atrasar o inimigo.",
  pistola: "Você aproveita muito bem os rounds de economia: boa parte dos seus abates sai da arma secundária, o que rende rounds baratos.",
};
const DETALHE_ARMA = {
  Vandal: "A Vandal na frente mostra preferência pelo tiro certeiro: um acerto na cabeça resolve em qualquer distância.",
  Phantom: "A Phantom na frente mostra preferência por spray controlado e ângulos de média distância.",
  Operator: "Com a Operator, cada pick seu dá vantagem numérica para o time.",
  Sheriff: "Com a Sheriff, você transforma round de economia em ameaça real.",
  Ghost: "A Ghost mostra calma nos rounds de pistola e eco: tiro a tiro, sem desperdiçar bala.",
};
const COMPLEMENTO = {
  longa: (a) => `E ainda puxa a ${a} para segurar ângulos longos.`,
  rifle: (a) => `Quando o dinheiro permite, a ${a} é a base.`,
  precisao: (a) => `Nos rounds mais apertados, a ${a} entra com tiro calculado, sem desperdiçar bala.`,
  curta: (a) => `A ${a} aparece nos momentos de entrar rápido ou segurar de perto.`,
  pesada: (a) => `A ${a} entra para segurar spam e controle de área.`,
  pistola: (a) => `Nos ecos, a ${a} ainda garante abates.`,
};

function estiloDeJogo(top, todas) {
  if (!top.length) return "";
  const nomes = top.map((l) => l.n);
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}` : nomes[0];
  const fam = FAMILIA[top[0].n] || "rifle";
  const frases = [TEXTO_FAMILIA[fam]];
  if (DETALHE_ARMA[top[0].n]) frases.push(DETALHE_ARMA[top[0].n]);
  const outra = top.slice(1).find((l) => (FAMILIA[l.n] || "rifle") !== fam);
  if (outra) frases.push(COMPLEMENTO[FAMILIA[outra.n] || "rifle"](outra.n));
  const soma = todas.reduce((a, l) => [a[0] + l.distSoma, a[1] + l.distN], [0, 0]);
  const dist = soma[1] ? soma[0] / soma[1] : null;
  if (dist != null) frases.push(dist < 12 ? `Seus abates saem bem de perto (média de ${num(dist)} m): você vive no corpo a corpo.`
    : dist > 22 ? `Seus abates saem longe (média de ${num(dist)} m): você prefere manter distância e controlar a linha de visão.`
      : `Seus abates saem em média a ${num(dist)} m, a distância típica de duelo.`);
  const total = todas.reduce((a, l) => a + l.k, 0);
  const pouco = total < 15 ? ` <span class="suave">(ainda são só ${total} abates; o retrato fica mais fiel com mais partidas)</span>` : "";
  return `<p class="estilo__texto"><strong>${esc(lista)}.</strong> ${esc(frases.join(" "))}${pouco}</p>`;
}

function podioArmas(top, total) {
  return `<div class="podio-armas">${top.map((l, i) => `<div class="arma-top arma-top--${i + 1}" style="--i:${i}">
      <span class="arma-top__pos">${i + 1}º</span>
      ${imgArma(l.n) ? `<img class="arma-top__img" src="${esc(imgArma(l.n))}" alt="" loading="lazy" referrerpolicy="no-referrer" data-sefalhar="ocultar">` : ""}
      <strong class="arma-top__nome">${esc(l.n)}</strong>
      <span class="arma-top__k"><b>${l.k}</b> abate${l.k === 1 ? "" : "s"} · ${pct(div(l.k, total))}</span>
      <span class="arma-top__sub suave">${l.dist != null ? `${num(l.dist)} m em média · ` : ""}${l.r} round${l.r === 1 ? "" : "s"}</span>
    </div>`).join("")}</div>`;
}

function armas(itens) {
  const s = stats(itens);
  const linhas = Object.entries(s.armas).map(([n, v]) => ({ n, k: v[0], hs: v[1], bs: v[2], ls: v[3], dano: v[4], r: v[5], dist: div(v[6], v[7]), distSoma: v[6], distN: v[7], maior: v[8] }));
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
  const top = [...armasReais].filter((l) => l.k).sort((a, b) => b.k - a.k || b.r - a.r).slice(0, 3);
  const estilo = top.length ? secao("Top 3 armas", `${podioArmas(top, total)}
      <div class="estilo">${icone("alvo")}<div><small>Estilo de jogo</small>${estiloDeJogo(top, armasReais)}</div></div>`, `<span class="suave pequeno">pelos abates · segue os filtros</span>`) : "";
  return estilo + secao("Armas", tab + `<p class="suave pequeno" style="margin-top:10px">Abates por arma são exatos. HS% e dano por arma usam a arma comprada no round (a API não diz qual arma acertou cada tiro), então são aproximados, como em outros trackers.</p>`)
    + (outros.length ? secao("Outros abates", `<div class="chips">${outros.sort((a, b) => b.k - a.k).map((l) => `<span class="chip">${esc(l.n)} <strong>${l.k}</strong></span>`).join("")}</div>`) : "");
}

// ---------- Performance ----------
/** Ataque × Defesa: números grandes + barras espelhadas (ataque à esquerda, defesa à direita) */
function ladosGrafico(A, D) {
  if (!A.r && !D.r) return `<p class="suave pequeno">Sem rounds com estes filtros.</p>`;
  const imp = (x) => div(100 * x.imp, x.r);
  const linhas = [
    ["Rounds vencidos", (x) => div(x.v, x.r), (v) => pct(v)],
    ["Impacto/round", imp, (v) => sinal(v, 1, "%")],
    ["K/D", (x) => div(x.k, x.d) ?? x.k, (v) => num(v, 2)],
    ["ADR", (x) => div(x.dano, x.r), (v) => num(v)],
    ["Saldo de duelos", (x) => x.fk - x.fd, (v) => sinal(v, 0)],
  ];
  const lado = (t, x, c) => `<div class="lados__num lados__num--${c}"><small>${t}</small>
      <strong class="${classeSinal(imp(x), 1)}">${sinal(imp(x), 1, "%")}</strong><span>${x.r} rounds · K/D ${num(div(x.k, x.d) ?? x.k, 2)}</span></div>`;
  const corpo = linhas.map(([rot, f, fmt], i) => {
    const a = f(A), d = f(D);
    const maior = Math.max(Math.abs(a || 0), Math.abs(d || 0)) || 1;
    const barra = (v, c) => `<div class="lados__barra lados__barra--${c}"><i class="${(v || 0) < 0 ? "neg" : ""}" style="--w:${(Math.abs(v || 0) / maior).toFixed(3)};--i:${i}"></i></div>`;
    return `<div class="lados__linha"><span class="lados__rot">${rot}</span>
      <span class="lados__v">${a == null ? "—" : fmt(a)}</span>${barra(a, "a")}${barra(d, "d")}<span class="lados__v lados__v--d">${d == null ? "—" : fmt(d)}</span></div>`;
  }).join("");
  const dif = (imp(D) ?? 0) - (imp(A) ?? 0);
  const conclusao = !A.r || !D.r ? "" : Math.abs(dif) < 1.5 ? "Rendimento equilibrado entre os dois lados."
    : `Rende mais ${dif > 0 ? "na defesa" : "no ataque"}: ${num(Math.abs(dif), 1)} ponto${Math.abs(dif) >= 1.95 ? "s" : ""} de impacto por round a mais.`;
  return `<div class="lados">
      <div class="lados__topo">${lado("Ataque", A, "a")}${lado("Defesa", D, "d")}</div>
      <div class="lados__grafico">${corpo}</div>
      ${conclusao ? `<p class="suave pequeno" style="margin-top:10px">${conclusao}</p>` : ""}
    </div>`;
}

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
  const hist = (B.elo[e.slug] || []).filter((h) => h.tier != null);
  const el = hist.at(-1);
  const pico = hist.reduce((m, h) => (!m || h.tier * 100 + h.rr > m.tier * 100 + m.rr ? h : m), null);
  const saldo = hist.reduce((a, h) => a + (h.delta || 0), 0);
  const blocoElo = hist.length ? secao("Evolução de elo", `<div class="cartao">
      <div class="grade-stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">
        ${tile("Agora", `${esc(nomeTier(el.tn))}`, `${el.rr} RR`)}
        ${tile("Pico", `${esc(nomeTier(pico.tn))}`, `${pico.rr} RR · ${dataCurta(pico.t)}`)}
        ${tile("Saldo de RR", sinal(saldo, 0), `em ${hist.length} partida${hist.length === 1 ? "" : "s"} ranqueada${hist.length === 1 ? "" : "s"}`, classeSinal(saldo, 1))}
      </div>${linhaElo(hist)}
      <p class="suave pequeno" style="margin-top:8px">Histórico de RR da HenrikDev, guardado pelo report a cada coleta. Não muda com os filtros.</p></div>`) : "";
  return `
    ${blocoElo}
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
      ${cartao("Ataque × Defesa", ladosGrafico(A, D))}
      ${cartao("Trade e posicionamento", `${histograma(s.dm, B.meta.regras.trade_m, B.meta.regras.isolado_m)}
        <div class="grade-stats" style="grid-template-columns:repeat(3,1fr);margin-top:12px">
          ${tile("Aliado perto", pct(s.alcance), `até ${B.meta.regras.trade_m} m na morte`, classeNivel(s.alcance, 0.6, 0.45))}
          ${tile("Mortes trocadas", pct(s.trocadas), `${s.trc} de ${s.mo}`)}
          ${tile("Mediana", s.medianaDist != null ? `${num(s.medianaDist)} m` : "—", "até o aliado")}</div>`)}
      ${cartao("Clutches", tabela("clutch", [0, 1, 2, 3, 4].map((i) => ({ i, t: s.cl[i], v: s.clv[i] })).filter((x) => x.t), [
        { k: "s", t: "Situação", v: (x) => x.i, f: (x) => `<strong>1v${x.i + 1}</strong>` },
        { k: "t", t: "Tentativas", v: (x) => x.t }, { k: "v", t: "Vencidos", v: (x) => x.v },
        { k: "p", t: "Taxa", v: (x) => div(x.v, x.t), f: (x) => pct(div(x.v, x.t)) },
      ], { padrao: "s" }) + `<p class="suave pequeno" style="margin-top:8px">${s.clutches ? `Pelo modelo de chance de vitória, o esperado nessas situações seria vencer ~${num(s.cle, 1)} de ${s.clutches}.` : "Nenhum clutch com estes filtros."}</p>`)}
      ${cartao("Duelos e jogadas solo", `<div class="mini-titulo">Primeiros duelos</div>
          <div class="grade-stats" style="grid-template-columns:repeat(3,1fr)">
          ${tile("First kills", num(s.fk), `${pct(s.fkpr)} dos rounds`, "bom")}${tile("First deaths", num(s.fd), `${pct(s.fdpr)} dos rounds`, "ruim")}
          ${tile("Saldo", sinal(s.fk - s.fd, 0), "abriu − foi aberta", classeSinal(s.fk - s.fd, 1))}</div>
          <div class="mini-titulo" style="margin-top:14px">Jogadas solo <span class="suave">· a +${B.meta.regras.isolado_m} m do time</span></div>
          <div class="grade-stats" style="grid-template-columns:repeat(3,1fr)">
          ${tile("Abates solo", num(s.ks), "longe do time")}${tile("Mortes isoladas", num(s.mi), `${s.mft} sem chance de trade`)}
          ${tile("Saldo", sinal(s.imps, 1), "rounds gerados", classeSinal(s.imps, 0.3))}</div>
          <p class="suave pequeno" style="margin-top:8px">Saldo solo positivo = o lurk/flanco está dando resultado; negativo = está custando rounds.</p>`)}
      <div class="pilha">
      ${cartao("Kit (habilidades)", `<div class="grade-stats" style="grid-template-columns:repeat(3,1fr)">
          ${tile("Habilidades", num(div(s.ut, s.r), 1), avKit ? `por round · média ${num(avKit.util_ref, 1)}` : "por round")}
          ${tile("Ultimates", num(div(s.ul, s.n), 1), avKit ? `por partida · média ${num(avKit.ult_ref_partida, 1)}` : "por partida")}
          ${tile("Abates com skill", num(s.kh), "no período")}</div>
          <p class="suave pequeno" style="margin-top:8px">A API informa só o total de habilidades da partida (não quando nem onde). Médias da função: últimos ${B.meta.regras.janela_dias} dias.</p>`)}
      ${cartao("Multi-kills", `<div class="grade-stats" style="grid-template-columns:repeat(4,1fr)">
          ${tile("2K", num(s.mk[0]))}${tile("3K", num(s.mk[1]))}${tile("4K", num(s.mk[2]))}${tile("Ace", num(s.mk[3]), "", s.mk[3] ? "bom" : "")}</div>`)}
      </div>
    </div>
    ${secao("Recordes pessoais", gradeRecordes(calcularRecordes(itens), { mostrarNome: false }), `<span class="suave pequeno">seguem os filtros · toque para abrir a partida</span>`)}`;
}

// ---------- Mapa de calor ----------
async function calor(e, itens, q) {
  const dados = await carregarCalor(e.slug);
  const ok = new Map(itens.map((it) => [it.p.id, it]));
  const tr = lerTipoRound(q);
  const evs = dados.e.map(([mi, tipo, lado, x, y, n, tp]) => ({ id: dados.partidas[mi], tipo, lado, x, y, n, tp }))
    .filter((ev) => ok.has(ev.id) && (tr === "todos" || ev.tp === TIPO_COD[tr]));
  const porMapa = new Map(), partidasPorMapa = new Map();
  for (const ev of evs) {
    const m = ok.get(ev.id).p.mapa;
    porMapa.set(m, (porMapa.get(m) || 0) + 1);
    if (!partidasPorMapa.has(m)) partidasPorMapa.set(m, new Set());
    partidasPorMapa.get(m).add(ev.id);
  }
  if (!porMapa.size) return { html: tr !== "todos" ? `${segmentoTipoRound(tr)}${vazio(`Sem posições em rounds de ${TIPOS[tr].toLowerCase()} com estes filtros`)}` : vazio("Sem posições registradas com estes filtros") };
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
      ${cartaoSimples("Mapa (partidas)", `<div class="chips">${mapas.map((m) => `<button class="chip" style="cursor:pointer;${m === mapa ? "border-color:var(--destaque);color:var(--destaque-texto)" : ""}" type="button" data-param="cm" data-valor="${esc(m)}" aria-pressed="${m === mapa}">${esc(m)} <strong>${partidasPorMapa.get(m).size}</strong></button>`).join("")}</div>`)}
      ${cartaoSimples("Mostrar", `<div class="segmentos">${[["ambos", "Mortes e abates"], ["mortes", "Só mortes"], ["abates", "Só abates"]].map(([k, t]) =>
        `<button type="button" data-param="cv" data-valor="${k}" aria-pressed="${k === ver}">${t}</button>`).join("")}</div>
        <div class="segmentos" style="margin-top:8px">${[["-1", "Os dois lados"], ["0", "Ataque"], ["1", "Defesa"]].map(([k, t]) =>
        `<button type="button" data-param="cl" data-valor="${k}" aria-pressed="${String(lado) === k}">${t}</button>`).join("")}</div>
        ${segmentoTipoRound(tr)}
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
  if (!e) return { html: vazio("Jogador não encontrado", `<p>Volte para a <a href="#/equipe">equipe</a>.</p>`) };
  aba = ABAS_JOGADOR.some(([id]) => id === aba) ? aba : "geral";
  const itens = itensDe(slug, f);
  const s = stats(itens);
  const qs = filtrosQuery(f);
  let corpo = "", depois = null;
  if (!e.partidas) corpo = vazio("Ainda sem partidas", `<p>Quando ${esc(e.apelido)} jogar uma partida válida, ela aparece aqui.</p>`);
  else if (!itens.length && aba !== "geral") corpo = vazio("Nenhuma partida com estes filtros", `<p><button class="limpar" type="button" data-limpar-filtros>Limpar filtros</button></p>`);
  else if (aba === "geral") corpo = geral(e, itens, s, qs, q);
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
