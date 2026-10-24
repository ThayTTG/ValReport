// Início: o resumo do dia da equipe (ou um convite para jogar quando ainda não há partidas)

import { esc, num, pct, sinal, imagem, imgAgente, imgCard, classeSinal, icone, diaLongo, chaveDia, relativo, dataHora, destaque, secao } from "./util.js";
import { B, stats, itensDe, resultadoEquipe } from "./dados.js";
import { listaEquipe } from "./equipe.js";
import { cartaoMvp } from "./recordes.js";

const hojeChave = () => chaveDia(new Date().toISOString());
const saudacao = () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? "Bom dia" : h >= 12 && h < 18 ? "Boa tarde" : "Boa noite"; };
const partidasDoDia = (dia) => B.partidas.filter((p) => chaveDia(p.t) === dia);
const diasComPartidas = () => [...new Set(B.partidas.map((p) => chaveDia(p.t)))].sort();  // crescente
const isoDoDia = (dia) => `${dia}T12:00:00`;

function navDias(dia) {
  const dias = diasComPartidas(), hoje = hojeChave();
  const antes = dias.filter((d) => d < dia).at(-1), depois = dias.find((d) => d > dia && d <= hoje);
  const link = (d, txt, ic) => (d ? `<a class="chip hoje-nav__btn" href="#/${d === hoje ? "" : `?dia=${d}`}">${ic}${txt}</a>` : `<span class="chip hoje-nav__btn" aria-disabled="true">${ic}${txt}</span>`);
  return `<nav class="hoje-nav" aria-label="Outros dias">${link(antes, "Dia anterior", icone("voltar"))}
    ${dia !== hoje ? `<a class="chip hoje-nav__btn" href="#/">Hoje</a>` : ""}
    ${link(depois && depois !== dia ? depois : null, "Próximo dia", "")}</nav>`;
}

function cadaUm(dia) {
  const linhas = B.equipe.map((e) => ({ e, itens: itensDe(e.slug).filter((it) => chaveDia(it.p.t) === dia) }))
    .filter((x) => x.itens.length).map((x) => ({ ...x, s: stats(x.itens) }))
    .sort((a, b) => (b.s.impr ?? -99) - (a.s.impr ?? -99));
  return linhas;
}

function cartaoDestaqueDia(x) {
  const fundo = imgCard(x.e.card, "wideart");
  return `<div class="com-particulas"><a class="mvp mvp--grande hoje-mvp" href="#/j/${esc(x.e.slug)}/partidas">
    ${fundo ? `<span class="mvp__fundo" style="background-image:url('${esc(fundo)}')" aria-hidden="true"></span>` : ""}
    <span class="mvp__brilho" aria-hidden="true"></span>
    ${imagem(imgCard(x.e.card) || imgAgente(x.e.agente), x.e.apelido, "avatar", x.e.apelido)}
    <span class="mvp__texto"><small>${icone("estrela")} Destaque do dia</small><strong>${esc(x.e.apelido)}</strong>
      <span class="pequeno">${sinal(x.s.impr, 1, "%")} por round · K/D ${num(x.s.kd, 2)} · ADR ${num(x.s.adr)} · ${x.s.n} partida${x.s.n === 1 ? "" : "s"}</span></span></a></div>`;
}

function atalhos() {
  const a = (href, ic, t, sub) => `<a class="atalho" href="${href}">${icone(ic)}<span><strong>${t}</strong><small>${sub}</small></span></a>`;
  return secao("Atalhos", `<div class="atalhos">
    ${a("#/equipe", "equipe", "Equipe", "elenco, ranking e partidas")}
    ${a("#/equipe/semana", "relogio", "Semana", "MVP e comparação")}
    ${a("#/equipe/recordes", "trofeu", "Destaques", "MVP e Hall da fama")}
    ${a("#/equipe/mapas", "alvo", "Mapas", "calor e planos da IGL")}
  </div>`);
}

export function viewHoje(q) {
  const hoje = hojeChave();
  const pedido = q.get("dia");
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(pedido || "") && pedido <= hoje ? pedido : hoje;
  const ehHoje = dia === hoje;
  const ps = partidasDoDia(dia);
  const res = ps.map(resultadoEquipe);
  const v = res.filter((r) => r === "V").length, d = res.filter((r) => r === "D").length;
  const topo = `<header class="hoje-topo">
      <div class="hoje-topo__texto"><small>${esc(diaLongo(isoDoDia(dia)))}${ehHoje ? " · hoje" : ""}</small>
        <h1>${ehHoje ? `${saudacao()}, equipe!` : "Resumo do dia"}</h1>
        <p>${ps.length ? `${ps.length} partida${ps.length === 1 ? "" : "s"} ${ehHoje ? "até agora" : "neste dia"}: <strong class="bom">${v}V</strong> · <strong class="ruim">${d}D</strong>` : ehHoje ? "Ainda sem partidas hoje." : "Sem partidas neste dia."}
          <span class="suave"> · dados atualizados ${esc(relativo(B.meta.gerado_em))}</span></p></div>
      ${ps.length ? `<div class="hoje-placar"><strong>${pct(v + d ? v / (v + d) : null)}</strong><small>de vitórias</small></div>` : ""}
    </header>${navDias(dia)}`;

  if (!ps.length) {
    const ultimo = diasComPartidas().filter((x) => x < dia).at(-1);
    const psU = ultimo ? partidasDoDia(ultimo) : [];
    const rU = psU.map(resultadoEquipe);
    const melhorU = ultimo ? cadaUm(ultimo)[0] : null;
    const S = B.semana;
    return { titulo: "Início", html: `${topo}
      <section class="hoje-vazio">
        <span class="hoje-vazio__icone" aria-hidden="true">${icone("alvo")}</span>
        <h2>${ehHoje ? "Sem partidas por ora." : "Ninguém da equipe jogou neste dia."}</h2>
        ${ehHoje ? `<p>Vejamos nossa performance hoje! Assim que alguém da equipe jogar, o resumo aparece aqui. O site confere sozinho a cada 20 minutos.</p>` : ""}
      </section>
      <div class="grade-2 secao hoje-enquanto">
        ${ultimo ? `<a class="cartao hoje-ultimo" href="#/?dia=${ultimo}">
            <div class="cartao__titulo"><h3>Último dia com partidas</h3>${icone("seta")}</div>
            <strong class="hoje-ultimo__dia">${esc(diaLongo(isoDoDia(ultimo)))}</strong>
            <p>${psU.length} partida${psU.length === 1 ? "" : "s"} · <strong class="bom">${rU.filter((r) => r === "V").length}V</strong> · <strong class="ruim">${rU.filter((r) => r === "D").length}D</strong>${melhorU ? ` · destaque: <strong>${esc(melhorU.e.apelido)}</strong> (${sinal(melhorU.s.impr, 1, "%")} por round)` : ""}</p></a>` : ""}
        ${cartaoMvp() || (S?.partidas ? "" : "")}
      </div>
      ${atalhos()}` };
  }

  const linhas = cadaUm(dia);
  const todos = linhas.flatMap((x) => x.itens);
  const t = stats(todos);
  const melhor = linhas.find((x) => x.s.impr != null);
  const html = `${topo}
    <div class="destaques secao">
      ${destaque("Partidas", num(ps.length), `${num(ps.reduce((a, p) => a + Math.max(...Object.values(p.m).map((m) => m.rt || 0)), 0))} rounds`)}
      ${destaque("Vitórias", pct(v + d ? v / (v + d) : null), `${v}V · ${d}D`, v > d ? "bom" : v < d ? "ruim" : "")}
      ${destaque("Impacto da equipe", sinal(t.impr, 1, "%"), "por round, somando todos", classeSinal(t.impr, 1))}
      ${destaque("K/D da equipe", num(t.kd, 2), `${t.k} abates · ${t.mo} mortes`)}
    </div>
    <div class="hoje-meio secao">
      ${melhor ? cartaoDestaqueDia(melhor) : ""}
      <div class="hoje-jogadores">${linhas.map((x) => `<a class="hoje-jog" href="#/j/${esc(x.e.slug)}/partidas">
          ${imagem(imgCard(x.e.card) || imgAgente(x.e.agente), x.e.apelido, "hoje-jog__foto", x.e.apelido)}
          <span class="hoje-jog__nome"><strong>${esc(x.e.apelido)}</strong><small>${x.s.n} partida${x.s.n === 1 ? "" : "s"} · ${x.s.v}V ${x.s.d}D</small></span>
          <span class="hoje-jog__num"><strong class="${classeSinal(x.s.impr, 1)}">${sinal(x.s.impr, 1, "%")}</strong><small>K/D ${num(x.s.kd, 2)}</small></span></a>`).join("")}</div>
    </div>
    ${secao(ehHoje ? "Partidas de hoje" : "Partidas do dia", listaEquipe(ps))}
    ${atalhos()}`;
  return { titulo: "Início", html };
}
