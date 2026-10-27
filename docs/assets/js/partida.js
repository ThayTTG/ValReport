// Detalhe de uma partida: Placar, Rounds (killfeed + economia + leitura), Mapa 2D e Leitura da equipe

import { md, esc, num, sinal, imagem, imgAgente, imgRank, imgMapaSplash, imgArmaKill, nomeFila, nomeTier, dataHora, duracao, vazio, cartao, secao, selo, icone, classeSinal, TIPOS, FIM_ROUND, CERIMONIAS } from "./util.js";
import { B, detalhe, notaPartida, notaRound } from "./dados.js";
import { tabela, blocoNota } from "./componentes.js";
import { moldeMapa, svgRound } from "./graficos.js";
import { abas } from "./jogador.js";
import { podeVerComentarios, lerComentarios, htmlComentarios, ligarComentarios, roundTemComentario, totalComentarios, htmlNotasPendentes, ligarNotasPendentes } from "./comentarios.js";

const ABAS = [["placar", "Placar"], ["rounds", "Rounds"], ["mapa", "Mapa 2D"], ["leitura", "Leitura da equipe"], ["notas", "Notas da IGL"]];
/** No site, "Notas da IGL" virou "Comentários" (toda a equipe comenta; convidados não veem a aba). No editor do PC, continua igual. */
const abasPartida = () => (B.editor ? ABAS : ABAS.filter(([a]) => a !== "notas").concat(podeVerComentarios() ? [["notas", "Comentários"]] : []));
const marcaRound = (id, n) => (B.editor ? Boolean(notaRound(id, n)) : roundTemComentario(id, n));
const ICONE_FIM = { Elimination: "caveira", Detonate: "spike", Defuse: "escudo", "": "relogio" };

function cabecalho(d, p) {
  const nos = d.placar[d.nosso] ?? 0, eles = Object.entries(d.placar).find(([t]) => t !== d.nosso)?.[1] ?? 0;
  const res = nos > eles ? "V" : nos < eles ? "D" : "E";
  const membros = d.jogadores.filter((j) => j.slug);
  const splash = imgMapaSplash(d.mapa);
  return `<a class="voltar" href="#/" data-voltar>${icone("voltar")} Voltar</a>
  <header class="cabecalho">
    ${splash ? `<div class="cabecalho__banner" style="background-image:url('${esc(splash)}');opacity:.5"></div>` : ""}
    <div class="cabecalho__corpo" style="align-items:center">
      <div class="cabecalho__info">
        <h1>${esc(d.mapa)}</h1>
        <div class="sub"><span>${esc(nomeFila(d.fila))}</span><span>${esc(dataHora(d.t))}</span><span>${duracao(d.dur)}</span>${d.temp ? `<span>Temporada ${esc(d.temp.toUpperCase())}</span>` : ""}</div>
        <div class="chips" style="margin-top:10px">${membros.map((j) => `<a class="chip" href="#/j/${esc(j.slug)}">${imagem(imgAgente(j.ag), j.ag, "mini-ag")}${esc(j.nome)}</a>`).join("")}</div>
      </div>
      <div class="placar-grande ${res}" aria-label="Placar ${nos} a ${eles}"><span class="nosso">${nos}</span><span class="sep">:</span><span class="deles">${eles}</span></div>
    </div></header>`;
}

function placar(d) {
  const colunas = (id) => [
    { k: "nome", t: "Jogador", v: (j) => j.nome, f: (j) => `<div class="celula-ag">${imagem(imgAgente(j.ag), j.ag)}<div><strong>${j.slug ? `<a href="#/j/${esc(j.slug)}">${esc(j.nome)}</a>` : esc(j.nome)}${j.mvp === 1 ? ` <span class="selo selo--destaque" title="MVP da partida">${icone("trofeu")} MVP</span>` : j.mvp === 2 ? ` <span class="selo" title="MVP do time">${icone("trofeu")}</span>` : ""}</strong><small>${esc(j.ag)} · ${esc(nomeTier(j.tn))}</small></div>${imagem(imgRank(j.tier), nomeTier(j.tn), "rank-mini", "")}</div>` },
    { k: "acs", t: "ACS", v: (j) => j.acs }, { k: "k", t: "K", v: (j) => j.k }, { k: "d", t: "D", v: (j) => j.d }, { k: "a", t: "A", v: (j) => j.a },
    { k: "dif", t: "+/–", v: (j) => j.k - j.d, f: (j) => `<span class="${classeSinal(j.k - j.d, 1)}">${sinal(j.k - j.d, 0)}</span>` },
    { k: "kd", t: "K/D", v: (j) => (j.d ? j.k / j.d : j.k), f: (j) => num(j.d ? j.k / j.d : j.k, 2) },
    { k: "adr", t: "ADR", v: (j) => j.adr }, { k: "hs", t: "HS%", v: (j) => j.hs, f: (j) => `${j.hs}%` },
    { k: "fk", t: "FK", v: (j) => j.fk }, { k: "fd", t: "FD", v: (j) => j.fd }, { k: "kast", t: "KAST", v: (j) => j.kast, f: (j) => `${j.kast}%` },
    { k: "imp", t: "Impacto", v: (j) => j.imp, f: (j) => `<strong class="${classeSinal(j.imp, 1)}">${sinal(j.imp, 1, "%")}</strong>` },
    { k: "carga", t: "Carga média", v: (j) => j.carga, f: (j) => num(j.carga) },
  ];
  const times = [d.nosso, ...Object.keys(d.placar).filter((t) => t !== d.nosso)];
  return times.map((t, i) => {
    const js = d.jogadores.filter((j) => j.time === t);
    const pts = d.placar[t] ?? 0;
    return secao(i === 0 ? "Time da equipe" : "Time adversário", `<div class="cartao">${tabela(`placar-${i}`, js, colunas(i), { padrao: "acs", classeLinha: (j) => (j.slug ? "membro" : "") })}</div>`,
      `<span class="selo ${pts >= (d.placar[times[1 - i]] ?? 0) ? "selo--vitoria" : "selo--derrota"}">${pts} rounds</span>`);
  }).join("") + `<p class="suave pequeno" style="margin-top:12px">Quem não é da equipe (ou não autorizou aparecer) é mostrado como “Aliado” ou “Adversário”, sem nome. Impacto = quanto a pessoa mudou a chance do time vencer, em média por round.</p>`;
}

function linhaRounds(d, rSel, rota) {
  return `<div class="linha-rounds" role="group" aria-label="Rounds">${d.rounds.map((r, i) => {
    const nosso = r.venc === d.nosso;
    return `<a class="round-cel ${nosso ? "nosso" : "deles"} ${marcaRound(d.id, r.n) ? "tem-nota" : ""} ${r.n === 13 || (r.n > 24 && r.n % 2 === 1) ? "meio-tempo" : ""}" style="--i:${i}" data-n="${r.n}" href="${rota}?r=${r.n}" aria-pressed="${r.n === rSel}" title="Round ${r.n}: ${nosso ? "vitória" : "derrota"} · ${esc(FIM_ROUND[r.fim] || r.fim)}">${icone(ICONE_FIM[r.fim] || "caveira")}<span>${r.n}</span></a>`;
  }).join("")}</div>
  <p class="suave pequeno">Verde = round da equipe · vermelho = do adversário · a linha separa os tempos.</p>`;
}

function killfeed(d, r) {
  if (!r.kills.length) return `<p class="suave pequeno">Nenhum abate neste round.</p>`;
  return `<div class="killfeed">${r.kills.map(([t, ki, vi, arma, tipo]) => {
    const k = d.jogadores[ki] || { nome: "?", ag: "?" }, v = d.jogadores[vi] || { nome: "?", ag: "?" };
    const ck = k.time === d.nosso ? "nosso-txt" : "deles-txt", cv = v.time === d.nosso ? "nosso-txt" : "deles-txt";
    const icon = tipo === "W" ? imgArmaKill(arma) : null;
    const nm = (j) => (j.slug ? esc(j.nome) : `<span class="longo">${esc(j.nome)}</span><span class="curto">${esc(j.nome.replace("Adversário", "Adv.").replace("Aliado", "Ali."))}</span>`);
    return `<div class="kill"><time>${Math.floor(t / 60000)}:${String(Math.floor((t % 60000) / 1000)).padStart(2, "0")}</time>
      <span class="quem">${imagem(imgAgente(k.ag), k.ag)}<span class="${ck}">${nm(k)}</span></span>
      ${icon ? `<img class="arma" src="${esc(icon)}" alt="${esc(arma)}" title="${esc(arma)}" loading="lazy" referrerpolicy="no-referrer" data-sefalhar="texto">` : `<span class="arma-txt">${esc(arma)}</span>`}
      <span class="quem vitima"><span class="${cv}">${nm(v)}</span>${imagem(imgAgente(v.ag), v.ag)}</span></div>`;
  }).join("")}</div>`;
}

function detalheRound(d, r, com) {
  const nosso = r.venc === d.nosso;
  const ladoNosso = r.atk === d.nosso ? "no ataque" : "na defesa";
  const outro = Object.keys(d.placar).find((t) => t !== d.nosso);
  const econ = (t) => (r.econ[t] ? `${num(r.econ[t][0])}</div><div class="tile__sub">${esc(TIPOS[r.econ[t][1]] || r.econ[t][1])}` : "—");
  const spike = (ev, txt) => (ev ? `<span class="chip">${txt} ${ev.site ? `no ${esc(ev.site)} ` : ""}aos ${Math.round((ev.t || 0) / 1000)}s${ev.por >= 0 ? ` por ${esc(d.jogadores[ev.por]?.nome || "?")}` : ""}</span>` : "");
  const membros = Object.entries(r.membros);
  return `<div class="grade-2 secao">
    ${cartao(`Round ${r.n}`, `<div class="chips">
        ${selo(nosso ? "Vitória da equipe" : "Vitória do adversário", nosso ? "vitoria" : "derrota")}
        ${selo(esc(FIM_ROUND[r.fim] || r.fim || "—"))}${r.cer && CERIMONIAS[r.cer] ? selo(esc(CERIMONIAS[r.cer]), "destaque") : ""}
        <span class="chip">Equipe ${ladoNosso}</span></div>
      <div class="grade-stats" style="grid-template-columns:repeat(2,1fr);margin-top:12px">
        <div class="tile"><div class="tile__rotulo">Carga média · equipe</div><div class="tile__valor">${econ(d.nosso)}</div></div>
        <div class="tile"><div class="tile__rotulo">Carga média · adversário</div><div class="tile__valor">${econ(outro)}</div></div></div>
      <div class="chips" style="margin-top:10px">${spike(r.plant, "Spike plantada")}${spike(r.defuse, "Spike desarmada")}</div>
      ${membros.length ? `<div class="leitura" style="margin-top:12px">${membros.map(([slug, [imp, resumo, dica]]) => `<div class="leitura__item">
          <span class="imp ${classeSinal(imp, 1)}">${sinal(imp, 0, "%")}</span>
          <div><p><strong>${esc(B.porSlug.get(slug)?.apelido || slug)}:</strong> ${esc(resumo)}</p><p>${esc(dica)}</p></div></div>`).join("")}</div>` : ""}
      ${B.editor ? blocoNota("round", d.id, notaRound(d.id, r.n), { n: r.n, titulo: `Nota da IGL · round ${r.n}` }) : ""}`)}
    ${com ? `<div class="pilha">${cartao("Abates", killfeed(d, r))}${htmlComentarios(com, d.id, r.n)}</div>` : cartao("Abates", killfeed(d, r))}
  </div>`;
}

function leituraEquipe(d) {
  const slugs = [...new Set(d.rounds.flatMap((r) => Object.keys(r.membros)))];
  if (!slugs.length) return vazio("Sem leitura para esta partida");
  return slugs.map((slug) => {
    const nome = B.porSlug.get(slug)?.apelido || slug;
    const rs = d.rounds.filter((r) => r.membros[slug]).map((r) => ({ n: r.n, imp: r.membros[slug][0], resumo: r.membros[slug][1], dica: r.membros[slug][2], venc: r.venc === d.nosso }));
    const maior = Math.max(10, ...rs.map((r) => Math.abs(r.imp)));
    const total = rs.reduce((a, r) => a + r.imp, 0);
    const melhores = [...rs].sort((a, b) => b.imp - a.imp).slice(0, 3).filter((r) => r.imp >= 10);
    const piores = [...rs].sort((a, b) => a.imp - b.imp).slice(0, 3).filter((r) => r.imp <= -10);
    const item = (r) => `<div class="leitura__item"><span class="imp ${classeSinal(r.imp, 1)}">${sinal(r.imp, 0, "%")}</span><div><p><strong>R${r.n}</strong> · ${esc(r.resumo)}</p><p>${esc(r.dica)}</p></div></div>`;
    return secao(nome, `<div class="cartao">
      <div class="barra-imp" role="img" aria-label="Impacto de ${esc(nome)} round a round">${rs.map((r, i) => `<div style="--i:${i}" title="R${r.n}: ${sinal(r.imp, 0, "%")}">
        <span style="height:${Math.max(0, r.imp) / maior * 50}%;background:var(--vitoria);margin-top:auto"></span>
        <span style="height:${Math.max(0, -r.imp) / maior * 50}%;background:var(--derrota);margin-bottom:auto"></span></div>`).join("")}</div>
      <p class="suave pequeno">Cada barra é um round (verde ajudou, vermelho atrapalhou). Total: <strong class="${classeSinal(total / 100, 0.3)}">${sinal(total / 100, 1)} round(s)</strong> gerados para o time.</p>
      <div class="grade-2" style="margin-top:12px"><div><h3 style="margin-bottom:8px">Melhores rounds</h3><div class="leitura">${melhores.map(item).join("") || `<p class="suave pequeno">Nada acima de +10%.</p>`}</div></div>
      <div><h3 style="margin-bottom:8px">Para rever no VOD</h3><div class="leitura">${piores.map(item).join("") || `<p class="suave pequeno">Nada abaixo de −10%.</p>`}</div></div></div></div>`);
  }).join("");
}

export async function viewPartida(id, aba, q) {
  const p = B.porId.get(id);
  let d;
  try { d = await detalhe(id); } catch (e) { return { html: vazio("Partida não encontrada", `<p>Ela pode ter saído do período exportado. <a href="#/">Voltar</a></p>`) }; }
  const lista = abasPartida();
  aba = lista.some(([a]) => a === aba) ? aba : "placar";
  const rota = `#/p/${id}/${aba}`;
  const rSel = Math.min(d.rounds.length, Math.max(1, Number(q.get("r") || 1)));
  const r = d.rounds.find((x) => x.n === rSel) || d.rounds[0];
  let corpo = "";
  const nota = notaPartida(id);
  // Comentários (fora do editor do PC): lidos de uma vez para a partida toda
  let com = null, erroCom = "";
  if (!B.editor && podeVerComentarios() && (aba === "notas" || aba === "rounds")) {
    try { com = await lerComentarios(id); } catch (e) { erroCom = String(e?.message || e).replace(/^[a-z_]+: /, ""); }
  }
  const nCom = B.editor ? 0 : totalComentarios(id);
  if (aba === "placar") {
    corpo = B.editor ? (`<div class="secao">${blocoNota("partida", id, nota?.texto)}</div>` + placar(d))
      : (nCom && podeVerComentarios() ? `<a class="com-atalho secao" href="#/p/${esc(id)}/notas">${icone("nota")}<span><strong>${nCom} comentário${nCom === 1 ? "" : "s"}</strong> da equipe nesta partida</span>${icone("seta")}</a>` : "") + placar(d);
  }
  else if (aba === "notas" && !B.editor) {
    const doRound = (com?.comentarios || []).filter((c) => c.round);
    const porRound = [...new Set(doRound.map((c) => c.round))].sort((a, b) => a - b);
    corpo = (erroCom ? `<p class="aviso aviso--erro">${esc(erroCom)}</p>` : "")
      + (await htmlNotasPendentes())
      + (com ? htmlComentarios(com, id, null, { titulo: "Comentários da partida" }) : "")
      + (porRound.length ? secao("Comentários dos rounds", `<div class="leitura">${porRound.map((n) => {
          const cs = doRound.filter((c) => c.round === n);
          return `<a class="leitura__item com-round" style="color:inherit" href="#/p/${esc(id)}/rounds?r=${n}"><span class="imp">R${n}</span><div>${cs.map((c) => `<p><strong>${esc(c.autor)}:</strong> ${esc(c.texto.length > 220 ? `${c.texto.slice(0, 220)}…` : c.texto)}</p>`).join("")}<p class="suave pequeno">${cs.length} comentário${cs.length === 1 ? "" : "s"} · abrir o round</p></div></a>`;
        }).join("")}</div>`) : "")
      + `<p class="suave pequeno" style="margin-top:12px">Para comentar um round, abra a aba Rounds e escolha o round.</p>`;
  }
  else if (aba === "notas") {
    const rs = Object.entries(nota?.rounds || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
    corpo = blocoNota("partida", id, nota?.texto, { vazio: vazio("Sem nota da IGL nesta partida", "<p>A IGL escreve as notas no editor do PC; elas aparecem aqui depois da publicação.</p>") })
      + (rs.length ? secao("Notas por round", `<div class="leitura">${rs.map(([n, t]) => `<a class="leitura__item" style="color:inherit" href="#/p/${esc(id)}/rounds?r=${esc(n)}"><span class="imp">R${esc(n)}</span><div class="nota__texto">${md(t)}</div></a>`).join("")}</div>`) : "")
      + (B.editor ? `<p class="suave pequeno" style="margin-top:12px">Para anotar um round, abra a aba Rounds e escolha o round.</p>` : "");
  }
  else if (aba === "rounds") corpo = secao("Linha do tempo", `<div class="cartao">${linhaRounds(d, rSel, rota)}</div>`) + (erroCom ? `<p class="aviso aviso--erro secao">${esc(erroCom)}</p>` : "") + (r ? detalheRound(d, r, com) : "");
  else if (aba === "mapa") corpo = secao("Abates no mapa", `<div class="cartao">${linhaRounds(d, rSel, rota)}</div>`)
    + `<div class="grade-mapa secao"><div class="cartao">${moldeMapa(d.mapa, svgRound(d.mapa, r, d.jogadores, d.nosso))}</div><div class="pilha">${cartao(`Round ${r.n}`, `<div class="chips"><span class="chip"><span style="width:10px;height:10px;border-radius:50%;background:var(--nosso);display:inline-block"></span>Equipe</span><span class="chip"><span style="width:10px;height:10px;border-radius:50%;background:var(--deles);display:inline-block"></span>Adversário</span></div>
        <p class="suave pequeno" style="margin-top:10px">Círculo = onde estava quem matou · X = onde a pessoa morreu · losango = spike. Passe o dedo/mouse para ver quem foi.</p>`)}${cartao("Abates", killfeed(d, r))}</div></div>`;
  else corpo = leituraEquipe(d);
  // Deixa o round escolhido à vista na linha do tempo (no celular ela rola de lado)
  const depois = (el) => {
    const linha = el.querySelector(".linha-rounds"), cel = linha?.querySelector('[aria-pressed="true"]');
    if (cel && linha.scrollWidth > linha.clientWidth) linha.scrollLeft += cel.getBoundingClientRect().left - linha.getBoundingClientRect().left - (linha.clientWidth - cel.offsetWidth) / 2;
    // Depois de comentar ou apagar: a marca do round na linha do tempo e o resumo da aba acompanham
    el.querySelectorAll("[data-comentarios]").forEach((s) => ligarComentarios(s, () => {
      el.querySelectorAll(".round-cel[data-n]").forEach((c) => c.classList.toggle("tem-nota", roundTemComentario(id, c.dataset.n)));
    }));
    ligarNotasPendentes(el, () => window.dispatchEvent(new HashChangeEvent("hashchange")));
  };
  return { titulo: `${d.mapa} · ${dataHora(d.t)}`, html: `${cabecalho(d, p)}${abas(`#/p/${id}`, aba, lista)}<div class="secao">${corpo}</div>`, depois };
}
