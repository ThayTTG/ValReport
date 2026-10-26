// Abas da equipe: Visão geral, Partidas, Formações, Sinergia, Comparar e Mapas

import { esc, num, pct, sinal, div, imagem, imgAgente, imgCard, imgRank, imgMapaFaixa, nomeTier, nomeFila, hora, diaLongo, chaveDia, relativo, dataHora,
  tile, destaque, vazio, cartao, secao, barra, selo, classeSinal, classeNivel, icone, dataCurta, TIPOS } from "./util.js";
import { B, itensDe, stats, partidasDaEquipe, passaPartida, passaMembro, resultadoEquipe, placarEquipe, calor as carregarCalor, agrupar, notaMapa } from "./dados.js";
import { barraFiltros, tabela, forma, celulaAgente, blocoNota, segmentoTipoRound, lerTipoRound, TIPO_COD, delta } from "./componentes.js";
import { calcularRecordes, gradeRecordes, podioRecordes, contarDonos, cartaoMvp } from "./recordes.js";
import { temCoroa, coroaSobre } from "./coroa.js";
import { moldeMapa, desenharCalor, calloutMaisProximo } from "./graficos.js";
import { abas, filtrosQuery } from "./jogador.js";

export const ABAS_EQUIPE = [["visao", "Visão geral"], ["semana", "Semana"], ["partidas", "Partidas"], ["formacoes", "Formações"], ["sinergia", "Sinergia"],
  ["comparar", "Comparar"], ["mapas", "Mapas"], ["recordes", "Destaques"]];
const membrosCom = () => B.equipe.filter((e) => e.partidas > 0);

function cabecalhoEquipe(f) {
  const ps = partidasDaEquipe(f);
  const res = ps.map(resultadoEquipe);
  const v = res.filter((r) => r === "V").length, d = res.filter((r) => r === "D").length;
  return `<header class="cabecalho"><div class="cabecalho__corpo" style="padding-top:22px">
      <div class="cabecalho__info"><h1>${esc(B.equipeAtual?.nome || "Equipe")}</h1>
        <div class="sub"><span>${B.equipe.length} jogador${B.equipe.length === 1 ? "" : "es"} no site</span><span>${ps.length} partida${ps.length === 1 ? "" : "s"} · ${v}V ${d}D</span>
          <span>atualizado ${esc(relativo(B.meta.gerado_em))} (${esc(dataHora(B.meta.gerado_em))})</span></div></div>
      <div class="cabecalho__lado"><div class="rank"><div style="padding:0 8px;font:700 26px var(--fonte-titulo);color:var(--destaque-texto)">${pct(div(v, v + d))}</div><div><small>Vitórias</small><strong>com alguém da equipe</strong></div></div>
        ${B.equipeAtual?.slug ? `<a class="botao-secundario botao-mini" href="#/time/${esc(B.equipeAtual.slug)}">Membros e convites</a>` : ""}</div>
    </div></header>`;
}

// ---------- Visão geral ----------
function cartaoMembro(e, f, nRec = 0) {
  const itens = itensDe(e.slug, { ...f, agente: "todos", com: "todos" });
  const s = stats(itens);
  const av = (B.avaliacao[e.slug] || [])[0];
  const banner = imgCard(e.card, "wideart");
  return `<a class="membro-cartao" href="#/j/${esc(e.slug)}${filtrosQuery({ fila: f.fila, temporada: f.temporada, periodo: f.periodo, mapa: f.mapa })}">
    <div class="membro-cartao__banner" style="${banner ? `background-image:url('${esc(banner)}')` : ""}"></div>
    <div class="membro-cartao__corpo">
      <div class="membro-cartao__topo"><span class="foto-coroa">${imagem(imgCard(e.card) || imgAgente(e.agente), e.apelido, "avatar", e.apelido)}${coroaSobre(e.slug)}</span>
        <div class="membro-cartao__nome"><strong>${esc(e.apelido)}</strong><small>${esc(e.funcao || "sem partidas")}${e.agente ? ` · ${esc(e.agente)}` : ""}</small></div>
        <div class="membro-cartao__indice">${av ? `<strong>${av.indice}</strong><small>índice</small>` : `<small>sem índice</small>`}</div></div>
      <div style="display:flex;align-items:center;gap:8px;margin-top:10px">${imagem(imgRank(e.tier), nomeTier(e.tn), "mini-rank", "")}<span class="pequeno">${esc(nomeTier(e.tn))}</span>
        ${av ? `<span class="pequeno suave" style="margin-left:auto">${esc(av.funcao)} · margem ${av.margem[0]}–${av.margem[1]}</span>` : ""}</div>
      <div class="mini-stats">
        <div><small>K/D</small><strong>${num(s.kd, 2)}</strong></div><div><small>Vitórias</small><strong>${pct(s.win)}</strong></div>
        <div><small>ADR</small><strong>${num(s.adr)}</strong></div><div><small>Impacto</small><strong class="${classeSinal(s.impr, 1)}">${sinal(s.impr, 1, "%")}</strong></div></div>
      ${forma(itens)}
      ${temCoroa(e.slug) || nRec ? `<div class="membro-cartao__selos">${temCoroa(e.slug) ? `<span class="selo selo--ouro">${icone("coroa")} MVP da semana${B.coroa.seguidas > 1 ? ` · ${B.coroa.seguidas}×` : ""}</span>` : ""}${nRec ? `<span class="selo selo--destaque">${icone("estrela")} ${nRec} recorde${nRec === 1 ? "" : "s"}</span>` : ""}</div>` : ""}
    </div></a>`;
}

function linhaEquipe(p) {
  const res = resultadoEquipe(p), [a, b] = placarEquipe(p);
  const ms = Object.entries(p.m);
  return `<a class="partida ${res}" href="#/p/${esc(p.id)}">
    <span class="partida__fundo" style="${imgMapaFaixa(p.mapa) ? `background-image:url('${esc(imgMapaFaixa(p.mapa))}')` : ""}"></span>
    ${imagem(imgAgente(ms[0][1].ag), ms[0][1].ag, "partida__ag")}
    <div class="partida__meio"><div class="partida__titulo"><span>${esc(p.mapa)}</span><span class="placar ${res === "V" ? "bom" : res === "D" ? "ruim" : ""}">${a}–${b}</span></div>
      <div class="partida__sub"><span>${esc(nomeFila(p.fila))}</span><span>${hora(p.t)}</span><span>${(() => { const eq = Math.max(...ms.map(([, m]) => m.eq || 1)); return eq > 1 ? `${eq} da equipe no time` : "sem a equipe"; })()}</span></div></div>
    <div class="partida__nums">${ms.map(([slug, m]) => `<div title="${esc(B.porSlug.get(slug)?.apelido)} de ${esc(m.ag)}"><small>${esc(B.porSlug.get(slug)?.apelido || slug)}</small><strong>${m.k}/${m.d}/${m.a}</strong></div>`).join("")}</div></a>`;
}
export function listaEquipe(ps) {
  const dias = new Map();
  for (const p of ps) { const k = chaveDia(p.t); if (!dias.has(k)) dias.set(k, []); dias.get(k).push(p); }
  return [...dias.values()].map((lst) => {
    const r = lst.map(resultadoEquipe);
    return `<div class="dia"><div class="dia__topo"><h3>${esc(diaLongo(lst[0].t))}</h3><div class="dia__resumo"><strong class="bom">${r.filter((x) => x === "V").length}V</strong><strong class="ruim">${r.filter((x) => x === "D").length}D</strong></div></div>
      <div class="partidas">${lst.map(linhaEquipe).join("")}</div></div>`;
  }).join("");
}

function visao(f) {
  const ms = B.equipe;
  const linhas = membrosCom().map((e) => ({ e, s: stats(itensDe(e.slug, { ...f, agente: "todos", com: "todos" })), av: (B.avaliacao[e.slug] || [])[0] })).filter((x) => x.s.n);
  const ranking = linhas.length ? tabela("ranking", linhas, [
    { k: "nome", t: "Jogador", v: (x) => x.e.apelido, f: (x) => `<a class="celula-ag" href="#/j/${esc(x.e.slug)}" style="color:inherit">${imagem(imgCard(x.e.card), x.e.apelido, "", x.e.apelido)}<div><strong>${esc(x.e.apelido)}</strong><small>${esc(x.e.funcao || "")}</small></div></a>` },
    { k: "ind", t: "Índice", v: (x) => x.av?.indice ?? null, f: (x) => (x.av ? `<strong style="color:var(--destaque-texto)">${x.av.indice}</strong>` : "—") },
    { k: "n", t: "Partidas", v: (x) => x.s.n },
    { k: "win", t: "Vitórias", v: (x) => x.s.win, f: (x) => pct(x.s.win) },
    { k: "imp", t: "Impacto", v: (x) => x.s.impr, f: (x) => `<span class="${classeSinal(x.s.impr, 1)}">${sinal(x.s.impr, 1, "%")}</span>` },
    { k: "kd", t: "K/D", v: (x) => x.s.kd, f: (x) => num(x.s.kd, 2) },
    { k: "adr", t: "ADR", v: (x) => x.s.adr, f: (x) => num(x.s.adr) },
    { k: "acs", t: "ACS", v: (x) => x.s.acs, f: (x) => num(x.s.acs) },
    { k: "hs", t: "HS%", v: (x) => x.s.hsp, f: (x) => pct(x.s.hsp, 1) },
    { k: "kast", t: "KAST", v: (x) => x.s.kastp, f: (x) => pct(x.s.kastp) },
    { k: "fk", t: "FK–FD", v: (x) => x.s.fk - x.s.fd, f: (x) => `${x.s.fk}–${x.s.fd}` },
    { k: "cl", t: "Clutches", v: (x) => x.s.clutchesV, f: (x) => `${x.s.clutchesV}/${x.s.clutches}` },
    { k: "alc", t: "Aliado perto", v: (x) => x.s.alcance, f: (x) => pct(x.s.alcance) },
  ], { padrao: "imp" }) : "";
  const ps = partidasDaEquipe(f).slice(0, 8);
  const forms = (B.formacoes.formacoes || []).slice(0, 3);
  const donos = contarDonos(calcularRecordes(membrosCom().flatMap((e) => itensDe(e.slug, f))));
  return `<div class="elenco">${ms.map((e) => cartaoMembro(e, f, donos.get(e.slug) || 0)).join("")}</div>
    ${B.meta.ocultos ? `<div class="aviso" style="margin-top:12px">${icone("info")}<span>${B.meta.ocultos} jogador${B.meta.ocultos === 1 ? "" : "es"} da equipe ainda não ${B.meta.ocultos === 1 ? "autorizou" : "autorizaram"} aparecer no site. Nas partidas, aparece${B.meta.ocultos === 1 ? "" : "m"} como “Aliado”, sem nome.</span></div>` : ""}
    ${ranking ? secao("Ranking da equipe", `<div class="cartao">${ranking}</div>`, `<span class="suave pequeno">Índice = últimos ${B.meta.regras.janela_dias} dias; o resto segue os filtros</span>`) : ""}
    <div class="grade-lateral secao">
      <div class="pilha">${forms.length ? cartao("Formações mais jogadas", forms.map((x) => `<a href="#/equipe/formacoes" style="display:flex;align-items:center;gap:10px;padding:6px 0;color:inherit">
          <span class="av-pilha">${x.membros.map((s) => imagem(imgCard(B.porSlug.get(s)?.card), B.porSlug.get(s)?.apelido || s, "", B.porSlug.get(s)?.apelido || s)).join("")}</span>
          <span style="flex:1;margin-left:8px"><strong>${esc(x.membros.map((s) => B.porSlug.get(s)?.apelido || s).join(" & "))}</strong><br><small class="suave">${x.partidas.length} partida${x.partidas.length === 1 ? "" : "s"} · ${x.v}V ${x.d}D</small></span></a>`).join(""))
        : cartao("Formações", `<p class="suave pequeno">Quando duas ou mais pessoas da equipe jogarem juntas, a formação aparece aqui.</p>`)}</div>
      <div>${secao("Partidas recentes", listaEquipe(ps) || vazio("Nenhuma partida com estes filtros"), `<a class="pequeno" href="#/equipe/partidas${filtrosQuery(f)}">Ver todas</a>`)}</div>
    </div>`;
}

// ---------- Formações ----------
function matrizTrades(membros, trades) {
  const mapa = new Map(trades.map(([a, b, n]) => [`${a}>${b}`, n]));
  const maior = Math.max(1, ...trades.map((t) => t[2]));
  const nome = (s) => esc(B.porSlug.get(s)?.apelido || s);
  return `<div class="rolagem"><table class="matriz" aria-label="Quem vingou quem: linha vingou a coluna">
    <thead><tr><th>vingou ↓ / foi vingado →</th>${membros.map((s) => `<th>${nome(s)}</th>`).join("")}</tr></thead>
    <tbody>${membros.map((a) => `<tr><th>${nome(a)}</th>${membros.map((b) => {
      if (a === b) return `<td class="diag"></td>`;
      const n = mapa.get(`${a}>${b}`) || 0;
      return `<td style="${n ? `background:color-mix(in srgb, var(--destaque) ${20 + 70 * n / maior}%, var(--superficie-2));color:${n / maior > .5 ? "var(--sobre-destaque)" : "inherit"}` : ""}">${n ? `${n}×` : `<span class="suave">0</span>`}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function formacoes() {
  const lista = B.formacoes.formacoes || [];
  if (!lista.length) return vazio("Nenhuma formação ainda", "<p>Quando 2+ pessoas da equipe (que autorizaram aparecer) jogarem no mesmo time, a formação aparece aqui.</p>");
  const NOMES = { 2: "Duo", 3: "Trio", 4: "Quad", 5: "Five stack" };
  return `<p class="suave pequeno">Todas as partidas salvas (os filtros não se aplicam aqui). “Sozinho” = sem ninguém da equipe no time; “juntos” = qualquer partida com todos estes no mesmo time.</p>` + lista.map((x) => {
    const nomes = x.membros.map((s) => B.porSlug.get(s)?.apelido || s);
    const n = x.partidas.length;
    const comp = x.membros.map((s) => {
      const c = x.comparacao[s] || {};
      const so = c.sozinho, ju = c.juntos;
      const ok = so && ju && so.partidas >= x.minimo && ju.partidas >= x.minimo;
      const dif = ok ? ju.impacto - so.impacto : null;
      return `<tr><td><strong>${esc(B.porSlug.get(s)?.apelido || s)}</strong></td>
        <td>${so ? `${sinal(so.impacto, 1, "%")} <small class="suave">${so.partidas}p</small>` : "—"}</td>
        <td>${ju ? `${sinal(ju.impacto, 1, "%")} <small class="suave">${ju.partidas}p</small>` : "—"}</td>
        <td>${ok ? `<span class="selo ${dif >= 3 ? "selo--vitoria" : dif <= -3 ? "selo--derrota" : "selo--destaque"}">${dif >= 3 ? "rende mais junto" : dif <= -3 ? "rende menos junto" : "parecido"} ${sinal(dif, 1)}</span>` : `<span class="selo">amostra pequena (mín. ${x.minimo})</span>`}</td></tr>`;
    }).join("");
    return `<article class="cartao" style="margin-top:14px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span class="av-pilha av-pilha--grande">${x.membros.map((s) => imagem(imgCard(B.porSlug.get(s)?.card), B.porSlug.get(s)?.apelido || s, "", B.porSlug.get(s)?.apelido || s)).join("")}</span>
        <div style="flex:1;min-width:180px;margin-left:12px"><span class="selo selo--destaque">${NOMES[x.membros.length] || "Grupo"}</span>
          <h2 style="margin-top:4px">${esc(nomes.join(" & "))}</h2></div>
        <div class="destaque" style="padding:8px 14px"><div class="destaque__rotulo">Vitórias</div><div class="destaque__valor" style="font-size:24px">${pct(div(x.v, n))}</div><div class="destaque__sub">${x.v}V · ${x.d}D em ${n}</div></div>
      </div>
      <div class="grade-2" style="margin-top:14px">
        <div>
          <h3 style="margin-bottom:8px">Sozinho × juntos (impacto por round)</h3>
          <div class="rolagem"><table class="tabela"><thead><tr><th>Jogador</th><th>Sozinho</th><th>Juntos</th><th>Efeito</th></tr></thead><tbody>${comp}</tbody></table></div>
          <h3 style="margin:14px 0 8px">Mapas</h3>
          <div class="chips">${Object.entries(x.mapas).sort((a, b) => b[1][0] + b[1][1] - a[1][0] - a[1][1]).map(([m, [v, d]]) => `<span class="chip">${esc(m)} <strong class="${v >= d ? "bom" : "ruim"}">${v}V ${d}D</strong></span>`).join("")}</div>
          <h3 style="margin:14px 0 8px">Composições</h3>
          <div class="chips">${x.comps.slice(0, 4).map(([ags, c, v]) => `<span class="chip">${ags.map((a) => imagem(imgAgente(a), a, "mini-ag")).join("")} ${c}× · ${v}V</span>`).join("")}</div>
        </div>
        <div>
          <h3 style="margin-bottom:8px">Quem vinga quem</h3>
          ${x.trades.length ? matrizTrades(x.membros, x.trades) : `<p class="suave pequeno">Nenhuma troca entre vocês ainda. Jogar a até ~${B.meta.regras.trade_m} m um do outro é o que mais aproveita estarem juntos.</p>`}
          ${x.dist.n ? `<p class="pequeno" style="margin-top:10px">Quando alguém do grupo morreu, havia um parceiro a até ${B.meta.regras.trade_m} m em <strong class="${classeNivel(x.dist.alcance_pct / 100, 0.6, 0.45)}">${x.dist.alcance_pct}%</strong> das vezes (mediana ~${x.dist.mediana_m} m, ${x.dist.n} mortes).</p>` : ""}
        </div>
      </div>
      <div class="chips" style="margin-top:12px">${x.partidas.slice(-6).reverse().map((id) => { const p = B.porId.get(id); return p ? `<a class="chip" href="#/p/${esc(id)}">${esc(p.mapa)} · ${esc(dataHora(p.t))}</a>` : ""; }).join("")}</div>
    </article>`;
  }).join("");
}

// ---------- Sinergia ----------
function sinergia(f) {
  const ms = membrosCom();
  if (ms.length < 2) return vazio("Precisa de pelo menos 2 pessoas com partidas");
  const pares = new Map((B.formacoes.pares || []).map((p) => [[p.a, p.b].sort().join("|"), p]));
  const par = (a, b) => pares.get([a, b].sort().join("|"));
  const nome = (s) => esc(B.porSlug.get(s)?.apelido || s);
  const matriz = `<div class="rolagem"><table class="matriz" aria-label="Partidas juntos e vitórias">
    <thead><tr><th></th>${ms.map((e) => `<th>${nome(e.slug)}</th>`).join("")}</tr></thead>
    <tbody>${ms.map((a) => `<tr><th>${nome(a.slug)}</th>${ms.map((b) => {
      if (a.slug === b.slug) return `<td class="diag"></td>`;
      const p = par(a.slug, b.slug);
      if (!p) return `<td><span class="suave">—</span></td>`;
      const w = p.v / p.partidas;
      return `<td style="background:color-mix(in srgb, ${w >= 0.5 ? "var(--vitoria)" : "var(--derrota)"} ${15 + 45 * Math.abs(w - 0.5) * 2}%, var(--superficie-2))">${pct(w)}<small>${p.partidas} juntos</small></td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`;
  // Com × sem: para cada pessoa, como ela rende com e sem cada parceiro (respeita os filtros)
  const linhas = [];
  for (const a of ms) for (const b of ms) {
    if (a.slug === b.slug) continue;
    const com = itensDe(a.slug, { ...f, com: b.slug }), sem = itensDe(a.slug, f).filter((it) => !it.m.com.includes(b.slug));
    if (!com.length) continue;
    const sc = stats(com), ss = stats(sem);
    linhas.push({ a, b, sc, ss, dw: sc.win != null && ss.win != null ? sc.win - ss.win : null, di: sc.impr != null && ss.impr != null ? sc.impr - ss.impr : null });
  }
  const tab = tabela("com-sem", linhas, [
    { k: "a", t: "Jogador", v: (l) => `${l.a.apelido} ${l.b.apelido}`, f: (l) => `<strong>${nome(l.a.slug)}</strong> <span class="suave">com</span> <strong>${nome(l.b.slug)}</strong>` },
    { k: "n", t: "Juntos", v: (l) => l.sc.n }, { k: "ns", t: "Sem", v: (l) => l.ss.n },
    { k: "wc", t: "Vitórias com", v: (l) => l.sc.win, f: (l) => pct(l.sc.win) }, { k: "ws", t: "Vitórias sem", v: (l) => l.ss.win, f: (l) => pct(l.ss.win) },
    { k: "ic", t: "Impacto com", v: (l) => l.sc.impr, f: (l) => sinal(l.sc.impr, 1, "%") }, { k: "is", t: "Impacto sem", v: (l) => l.ss.impr, f: (l) => sinal(l.ss.impr, 1, "%") },
    { k: "di", t: "Diferença", v: (l) => l.di, f: (l) => `<strong class="${classeSinal(l.di, 1.5)}">${sinal(l.di, 1, " pts")}</strong>` },
  ], { padrao: "n" });
  const trades = (B.formacoes.pares || []).filter((p) => p.ab || p.ba);
  return secao("Vitórias jogando juntos", `<div class="cartao">${matriz}<p class="suave pequeno" style="margin-top:8px">Cada célula: % de vitórias quando os dois estavam no mesmo time (todas as partidas salvas).</p></div>`)
    + secao("Com e sem cada parceiro", `<div class="cartao">${linhas.length ? tab : `<p class="suave pequeno">Sem partidas juntos com estes filtros.</p>`}
      <p class="suave pequeno" style="margin-top:8px">Diferença = impacto por round com o parceiro menos sem ele. Amostras pequenas variam muito: olhe a coluna “Juntos”.</p></div>`)
    + (trades.length ? secao("Trades entre a equipe", `<div class="cartao">${matrizTrades(ms.map((e) => e.slug), trades.flatMap((p) => [[p.a, p.b, p.ab], [p.b, p.a, p.ba]]).filter((t) => t[2]))}</div>`) : "");
}

// ---------- Comparar ----------
const LINHAS_COMP = [["Partidas", (s) => s.n, 0, null], ["Vitórias", (s) => s.win, "pct", 1], ["Impacto/round", (s) => s.impr, "imp", 1], ["K/D", (s) => s.kd, 2, 1],
  ["KDA", (s) => s.kda, 2, 1], ["ADR", (s) => s.adr, 0, 1], ["ACS", (s) => s.acs, 0, 1], ["HS%", (s) => s.hsp, "pct1", 1], ["KAST", (s) => s.kastp, "pct", 1],
  ["Abates/round", (s) => s.kpr, 2, 1], ["First kills/round", (s) => s.fkpr, 2, 1], ["First deaths/round", (s) => s.fdpr, 2, -1], ["Trades", (s) => s.tr, 0, 1],
  ["Aliado perto na morte", (s) => s.alcance, "pct", 1], ["Clutches vencidos", (s) => s.clutchesV, 0, 1], ["Índice médio/partida", (s) => s.indMedio, 0, 1]];
function comparar(f, q) {
  const ms = membrosCom();
  if (ms.length < 2) return vazio("Precisa de pelo menos 2 pessoas com partidas");
  const escolhidos = (q.get("quem") || "").split(",").filter((s) => ms.some((e) => e.slug === s));
  const sel = escolhidos.length >= 2 ? escolhidos : ms.slice().sort((a, b) => b.partidas - a.partidas).slice(0, 2).map((e) => e.slug);
  const dados = sel.map((s) => ({ e: B.porSlug.get(s), s: stats(itensDe(s, { ...f, agente: "todos", com: "todos" })) }));
  const fmt = (v, t) => (t === "pct" ? pct(v) : t === "pct1" ? pct(v, 1) : t === "imp" ? sinal(v, 1, "%") : num(v, t));
  const botoes = ms.map((e) => { const on = sel.includes(e.slug); const nova = on ? sel.filter((x) => x !== e.slug) : [...sel, e.slug];
    return `<button type="button" data-param="quem" data-valor="${esc(nova.join(","))}" aria-pressed="${on}" ${on && sel.length <= 2 ? "disabled" : ""}>${esc(e.apelido)}</button>`; }).join("");
  const corpo = LINHAS_COMP.map(([t, fn, tipo, dir]) => {
    const vals = dados.map((x) => fn(x.s));
    const validos = vals.filter((v) => v != null);
    const melhor = dir == null || validos.length < 2 ? null : (dir > 0 ? Math.max(...validos) : Math.min(...validos));
    return `<tr><td><strong>${esc(t)}</strong></td>${vals.map((v) => `<td class="${melhor != null && v === melhor ? "bom" : ""}" style="${melhor != null && v === melhor ? "font-weight:800" : ""}">${fmt(v, tipo)}</td>`).join("")}</tr>`;
  }).join("");
  const juntos = sel.length >= 2 ? B.partidas.filter((p) => passaPartida(p, f) && sel.every((s) => p.m[s] && p.m[sel[0]].time === p.m[s].time)) : [];
  return `<div class="cartao"><div class="segmentos" role="group" aria-label="Quem comparar">${botoes}</div>
      <p class="suave pequeno" style="margin-top:8px">Escolha duas ou mais pessoas. Em verde, o melhor valor de cada linha. Comparar funções diferentes (ex.: duelista × controlador) diz pouco: use junto com o índice, que é por função.</p></div>
    <div class="cartao" style="margin-top:14px"><div class="rolagem"><table class="tabela"><thead><tr><th>Estatística</th>${dados.map((x) => `<th>${esc(x.e.apelido)}</th>`).join("")}</tr></thead><tbody>
      <tr><td><strong>Índice NokyLabs</strong></td>${dados.map((x) => { const av = (B.avaliacao[x.e.slug] || [])[0]; return `<td>${av ? `<strong style="color:var(--destaque-texto)">${av.indice}</strong> <small class="suave">${esc(av.funcao)}</small>` : "—"}</td>`; }).join("")}</tr>
      ${corpo}</tbody></table></div></div>
    ${juntos.length ? secao(`Partidas com ${sel.map((s) => B.porSlug.get(s).apelido).join(" & ")} no mesmo time`, `<div class="partidas">${juntos.slice(0, 10).map(linhaEquipe).join("")}</div>`) : ""}`;
}

// ---------- Semana ----------
function itemRound(x, { nome = true } = {}) {
  const e = B.porSlug.get(x.slug);
  return `<a class="leitura__item leitura__item--link" href="#/p/${esc(x.match_id)}/rounds?r=${x.n}">
    <span class="imp ${classeSinal(x.imp, 1)}">${sinal(x.imp, 0, "%")}</span>
    <div><p><strong>${nome && e ? `${esc(e.apelido)} · ` : ""}R${x.n}</strong> <span class="suave">· ${esc(x.mapa)} (${esc(x.agente)})${x.tipo ? ` · ${esc(TIPOS[x.tipo] || x.tipo)}` : ""} · ${dataCurta(x.inicio)}</span></p>
      <p>${esc(x.resumo)}</p>${x.dica ? `<p class="suave">${esc(x.dica)}</p>` : ""}</div></a>`;
}
function semana() {
  const S = B.semana;
  if (!S || !S.partidas) return vazio("Ninguém da equipe jogou nos últimos 7 dias", "<p>O resumo da semana aparece aqui quando houver partidas. Aos domingos ele também vai para o Discord.</p>");
  const linhas = S.jogadores.filter((j) => j.semana && B.porSlug.get(j.slug));
  const parados = S.jogadores.filter((j) => !j.semana && B.porSlug.get(j.slug));
  const mapas = Object.entries(S.mapas || {}).sort((a, b) => b[1][0] + b[1][1] - a[1][0] - a[1][1]);
  const tab = tabela("semana", linhas, [
    { k: "nome", t: "Jogador", v: (j) => B.porSlug.get(j.slug).apelido, f: (j) => { const e = B.porSlug.get(j.slug); return `<a class="celula-ag" href="#/j/${esc(e.slug)}?periodo=7" style="color:inherit">${imagem(imgCard(e.card), e.apelido, "", e.apelido)}<div><strong>${esc(e.apelido)}${j.slug === S.mvp ? ` <span class="selo selo--destaque">${icone("trofeu")} MVP</span>` : ""}</strong><small>${j.semana.partidas} partida${j.semana.partidas === 1 ? "" : "s"} · ${j.semana.v}V ${j.semana.d}D</small></div></a>`; } },
    { k: "imp", t: "Impacto/round", v: (j) => j.semana.impacto, f: (j) => `<strong class="${classeSinal(j.semana.impacto, 1)}">${sinal(j.semana.impacto, 1, "%")}</strong> ${delta(j.semana.impacto, j.anterior?.impacto, 1)}` },
    { k: "kd", t: "K/D", v: (j) => j.semana.kd, f: (j) => `${num(j.semana.kd, 2)} ${delta(j.semana.kd, j.anterior?.kd, 2)}` },
    { k: "adr", t: "ADR", v: (j) => j.semana.adr, f: (j) => `${num(j.semana.adr)} ${delta(j.semana.adr, j.anterior?.adr, 0)}` },
    { k: "kast", t: "KAST", v: (j) => j.semana.kast, f: (j) => `${num(j.semana.kast)}% ${delta(j.semana.kast, j.anterior?.kast, 0, "%")}` },
    { k: "r", t: "Rounds", v: (j) => j.semana.rounds },
  ], { padrao: "imp" });
  return `<div class="semana-topo">
      <div><span class="selo selo--destaque">${icone("relogio")} ${dataCurta(S.ini)} a ${dataCurta(S.fim)}</span>
        <h2 style="margin-top:8px">Resumo da semana</h2>
        <p class="suave pequeno">${S.partidas} partida${S.partidas === 1 ? "" : "s"} com alguém da equipe · <strong class="bom">${S.v}V</strong> · <strong class="ruim">${S.d}D</strong> · calculado em ${esc(dataHora(B.meta.gerado_em))} (não muda com os filtros)</p></div>
      <div class="pilha-mvp">${cartaoMvp({ rolante: true })}${B.coroa ? `<button class="limpar ver-coroa" type="button" data-ver-coroa>${icone("coroa")} Ver de novo o MVP da semana fechada</button>` : ""}</div>
    </div>
    ${secao("Cada um na semana", `<div class="cartao">${tab}${parados.length ? `<p class="suave pequeno" style="margin-top:10px">Não jogou nesta semana: ${esc(parados.map((j) => B.porSlug.get(j.slug).apelido).join(", "))}.</p>` : ""}</div>`, `<span class="suave pequeno">▲▼ = comparado com a semana anterior</span>`)}
    ${mapas.length ? secao("Mapas da semana", `<div class="chips">${mapas.map(([m, [v, d]]) => `<span class="chip">${esc(m)} <strong class="${v >= d ? "bom" : "ruim"}">${v}V ${d}D</strong></span>`).join("")}</div>`) : ""}
    <div class="grade-2 secao">
      ${cartao("Rounds da semana", S.destaques?.length ? `<div class="leitura">${S.destaques.map((x) => itemRound(x)).join("")}</div>` : `<p class="suave pequeno">Nenhum round passou de +15% de impacto.</p>`)}
      ${cartao("Para rever no VOD", S.rever?.length ? `<div class="leitura">${S.rever.map((x) => itemRound(x)).join("")}</div>` : `<p class="suave pequeno">Nenhum round abaixo de −15%. Semana limpa!</p>`)}
    </div>`;
}

// ---------- Recordes ----------
function recordesEquipe(f) {
  const itens = membrosCom().flatMap((e) => itensDe(e.slug, f));
  const recs = calcularRecordes(itens);
  const mvp = cartaoMvp({ grande: true }), podio = podioRecordes(recs);
  return `${mvp || podio ? `<div class="hall-topo">${mvp}${podio ? `<div class="hall-donos"><h2 class="hall-donos__titulo">${icone("estrela")} Donos dos recordes</h2>${podio}</div>` : ""}</div>` : ""}
    ${secao("Hall da fama", gradeRecordes(recs), `<span class="suave pequeno">segue os filtros · médias por round só com 10+ rounds · toque para abrir a partida</span>`)}`;
}

// ---------- Mapas da equipe ----------
async function mapasEquipe(f, q) {
  const ps = partidasDaEquipe(f);
  if (!ps.length) return { html: vazio("Nenhuma partida com estes filtros") };
  const porMapa = new Map();
  for (const p of ps) {
    if (!porMapa.has(p.mapa)) porMapa.set(p.mapa, []);
    porMapa.get(p.mapa).push(p);
  }
  const cartoes = [...porMapa].sort((a, b) => b[1].length - a[1].length).map(([mapa, lst]) => {
    const res = lst.map(resultadoEquipe);
    const v = res.filter((r) => r === "V").length, d = res.filter((r) => r === "D").length;
    let ra = 0, rva = 0, rd = 0, rvd = 0;
    for (const p of lst) { const m = Object.values(p.m).find((x) => x.time === p.nosso) || Object.values(p.m)[0]; ra += m.lados.a[0]; rva += m.lados.a[1]; rd += m.lados.d[0]; rvd += m.lados.d[1]; }
    const melhores = membrosCom().map((e) => ({ e, s: stats(lst.filter((p) => p.m[e.slug] && passaMembro(p.m[e.slug], f)).map((p) => ({ p, m: p.m[e.slug] }))) }))
      .filter((x) => x.s.r >= 20).sort((a, b) => b.s.impr - a.s.impr);
    const partidas = `#/equipe/partidas${filtrosQuery({ ...f, mapa })}`;
    return `<article class="mapa-cartao" data-ir="${esc(partidas)}">
      <a class="mapa-cartao__banner" href="${esc(partidas)}" title="Ver as partidas da equipe em ${esc(mapa)}" style="${imgMapaFaixa(mapa) ? `background-image:url('${esc(imgMapaFaixa(mapa))}')` : ""}"><strong>${esc(mapa)}</strong>${selo(`${v}V · ${d}D`, v >= d ? "vitoria" : "derrota")}</a>
      <div class="mapa-cartao__corpo">
        ${notaMapa(mapa)?.texto ? `<a class="selo selo--destaque" style="justify-self:start" href="#/equipe/mapas${filtrosQuery(f)}${filtrosQuery(f) ? "&" : "?"}cm=${encodeURIComponent(mapa)}">${icone("nota")} plano da IGL</a>` : ""}
        <div class="lado-barra"><span>Vitórias</span>${barra(div(v, v + d), v >= d ? "vitoria" : "derrota")}<span>${pct(div(v, v + d))}</span></div>
        <div class="lado-barra"><span>Ataque</span>${barra(div(rva, ra))}<span>${pct(div(rva, ra))} <small class="suave">${ra}r</small></span></div>
        <div class="lado-barra"><span>Defesa</span>${barra(div(rvd, rd))}<span>${pct(div(rvd, rd))} <small class="suave">${rd}r</small></span></div>
        ${melhores[0] ? `<p class="pequeno">Destaque: <strong>${esc(melhores[0].e.apelido)}</strong> (${sinal(melhores[0].s.impr, 1, "%")} por round)</p>` : `<p class="suave pequeno">Destaque aparece com 20+ rounds no mapa.</p>`}
        <div class="mapa-cartao__acoes"><a class="botao-secundario botao-mini" href="${esc(partidas)}">${icone("seta")} ${lst.length} partida${lst.length === 1 ? "" : "s"}</a>
          <a class="botao-secundario botao-mini" href="#/equipe/mapas${filtrosQuery(f)}${filtrosQuery(f) ? "&" : "?"}cm=${encodeURIComponent(mapa)}&foco=calor">${icone("fogo")} Mapa de calor</a></div>
      </div></article>`;
  }).join("");
  // Calor da equipe no mapa escolhido
  const mapas = [...porMapa].sort((a, b) => b[1].length - a[1].length).map(([m]) => m);
  const mapa = mapas.includes(q.get("cm")) ? q.get("cm") : mapas[0];
  const ids = new Set(porMapa.get(mapa).map((p) => p.id));
  const todos = await Promise.all(membrosCom().map(async (e) => ({ e, c: await carregarCalor(e.slug) })));
  const tr = lerTipoRound(q);
  const evs = [];
  for (const { e, c } of todos) c.e.forEach(([mi, tipo, lado, x, y, , tp]) => { if (ids.has(c.partidas[mi]) && (tr === "todos" || tp === TIPO_COD[tr])) evs.push({ tipo, lado, x, y, quem: e.apelido }); });
  const regioes = new Map();
  for (const ev of evs.filter((x) => x.tipo === 0)) {
    const r = calloutMaisProximo(mapa, ev.x, ev.y); if (!r) continue;
    const x = regioes.get(r) || { n: 0, quem: new Map() }; x.n++; x.quem.set(ev.quem, (x.quem.get(ev.quem) || 0) + 1); regioes.set(r, x);
  }
  const top = [...regioes].sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  const html = `<div class="grade-mapas">${cartoes}</div>
    <div id="calor-equipe">${secao(`Mapa de calor da equipe · ${mapa}`, `<div class="grade-mapa"><div class="cartao">${moldeMapa(mapa)}</div><div class="pilha">
      ${blocoNota("mapa", mapa, notaMapa(mapa)?.texto, { titulo: `Plano da IGL · ${mapa}` })}
      ${cartao("Mapa", `<div class="chips">${mapas.map((m) => `<button class="chip" style="cursor:pointer;${m === mapa ? "border-color:var(--destaque);color:var(--destaque-texto)" : ""}" type="button" data-param="cm" data-valor="${esc(m)}" aria-pressed="${m === mapa}">${esc(m)}</button>`).join("")}</div>
        ${segmentoTipoRound(tr)}<p class="suave pequeno" style="margin-top:8px">${evs.filter((x) => x.tipo === 0).length} mortes e ${evs.filter((x) => x.tipo === 1).length} abates${tr === "todos" ? "" : ` em rounds de ${esc(TIPOS[tr].toLowerCase())}`}.</p>`)}
      ${cartao("Onde a equipe mais morre", top.length ? top.map(([r, x]) => { const [quem, k] = [...x.quem].sort((a, b) => b[1] - a[1])[0]; return `<div style="padding:5px 0"><div style="display:flex;justify-content:space-between;font-size:13.5px"><strong>${esc(r)}</strong><span>${x.n}× <span class="suave">(mais: ${esc(quem)} ${k})</span></span></div>${barra(x.n / top[0][1].n, "derrota")}</div>`; }).join("") : `<p class="suave pequeno">Sem nomes de regiões para este mapa ainda.</p>`)}
    </div></div>`)}</div>`;
  return { html, depois: (el) => {
    desenharCalor(el, mapa, evs, { mostrar: "ambos" });
    if (q.get("foco") === "calor") el.querySelector("#calor-equipe")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } };
}

export async function viewEquipe(aba, f, q) {
  aba = ABAS_EQUIPE.some(([a]) => a === aba) ? aba : "visao";
  const qs = filtrosQuery(f);
  let corpo = "", depois = null;
  const semFiltros = ["formacoes", "semana"].includes(aba);
  if (!B.partidas.length) corpo = vazio("Ainda não há partidas exportadas", "<p>Rode o report no PC para gerar os dados do site.</p>");
  else if (aba === "visao") corpo = visao(f);
  else if (aba === "partidas") { const ps = partidasDaEquipe(f); corpo = listaEquipe(ps.slice(0, Number(q.get("n") || 40))) || vazio("Nenhuma partida com estes filtros"); if (ps.length > Number(q.get("n") || 40)) corpo += `<p style="text-align:center;margin-top:14px"><button class="limpar" type="button" data-param="n" data-valor="${Number(q.get("n") || 40) + 40}">Mostrar mais</button></p>`; }
  else if (aba === "formacoes") corpo = formacoes();
  else if (aba === "semana") corpo = semana();
  else if (aba === "recordes") corpo = recordesEquipe(f);
  else if (aba === "sinergia") corpo = sinergia(f);
  else if (aba === "comparar") corpo = comparar(f, q);
  else if (aba === "mapas") ({ html: corpo, depois } = await mapasEquipe(f, q));
  return {
    titulo: `Equipe · ${ABAS_EQUIPE.find(([a]) => a === aba)[1]}`,
    html: `${cabecalhoEquipe(f)}${abas("#/equipe", aba, ABAS_EQUIPE, qs)}${semFiltros ? "" : barraFiltros(f, null, { mostrar: ["fila", "temporada", "periodo", "mapa"] })}<div class="secao">${corpo}</div>`,
    depois,
  };
}
