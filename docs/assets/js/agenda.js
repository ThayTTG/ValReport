// Agenda da equipe (v25): treinos, scrims, campeonatos… com presença (Vou / Talvez / Não vou), eventos que repetem
// toda semana, tipos personalizáveis (nome e cor) e exportação para Google Agenda, .ics e Discord.
// Só a equipe vê (convidados não); líder, co-líderes e treinadores criam e editam (supabase/planejamento.sql).

import { esqueleto } from "./esqueleto.js";
import { esc, icone, imagem, imgCard, vazio, selo } from "./util.js";
import { B } from "./dados.js";
import { rpc } from "./nuvem.js";
import { janela, confirmar, avisar, textoErro } from "./janela.js";
import { lerPlanejamento, avisoErro, faltaSql, podeVerPlanejamento, fotoMembro, carregarMapas, imgFaixa, POOL_PADRAO } from "./planejamento.js";

export const TIPOS_PADRAO = [
  { id: "treino", nome: "Treino", cor: "#3fae6a" },
  { id: "scrim", nome: "Scrim", cor: "#3f8fd8" },
  { id: "campeonato", nome: "Campeonato", cor: "#f2b33d" },
  { id: "oficial", nome: "Partida oficial", cor: "#ff4655" },
  { id: "review", nome: "Review de VOD", cor: "#a068ff" },
  { id: "reuniao", nome: "Reunião", cor: "#2fb7c4" },
  { id: "folga", nome: "Folga", cor: "#8a8299" },
];
const FUSOS = [["America/Sao_Paulo", "Brasília (UTC−3)", "-0300"], ["America/Manaus", "Manaus (UTC−4)", "-0400"], ["America/Rio_Branco", "Rio Branco (UTC−5)", "-0500"],
  ["America/Noronha", "Fernando de Noronha (UTC−2)", "-0200"], ["Europe/Lisbon", "Lisboa", ""], ["UTC", "UTC", "+0000"]];
const SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PRESENCA = { vou: ["Vou", "escudo"], talvez: ["Talvez", "relogio"], nao: ["Não vou", "fechar"] };
const CORES = ["#ff4655", "#a068ff", "#ec7518", "#f2b33d", "#3fae6a", "#2fb7c4", "#3f8fd8", "#e0679a"];

// ---------- Datas (sempre "AAAA-MM-DD" no horário local) ----------
const p2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const lerYmd = (s) => { const [a, m, d] = String(s).split("-").map(Number); return new Date(a, m - 1, d); };
const somarDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const hojeYmd = () => ymd(new Date());
const nomeDia = (s, o = { weekday: "long", day: "numeric", month: "long" }) => { const t = new Intl.DateTimeFormat("pt-BR", o).format(lerYmd(s)); return t[0].toUpperCase() + t.slice(1); };
const quando = (s) => { const n = Math.round((lerYmd(s) - lerYmd(hojeYmd())) / 864e5); return n === 0 ? "Hoje" : n === 1 ? "Amanhã" : n === -1 ? "Ontem" : n > 1 && n < 7 ? `Em ${n} dias` : ""; };

const tiposDe = (pl) => (pl?.tipos_evento?.length ? pl.tipos_evento : TIPOS_PADRAO);
const tipoDe = (pl, id) => tiposDe(pl).find((t) => t.id === id) || { id: "", nome: "Evento", cor: "#8a8299" };
const fusoDe = (pl) => FUSOS.find((f) => f[0] === pl?.fuso) || FUSOS[0];
const horario = (e) => (e.dia_todo ? "Dia todo" : e.inicio ? `${e.inicio}${e.fim ? `–${e.fim}` : ""}` : "Sem horário");
const meuFuso = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ""; } })();

/** Dias em que o evento acontece entre "de" e "ate", sem os dias cancelados */
function diasDo(e, de, ate) {
  const dias = e.repete_dias;
  if (!dias?.length) return e.data >= de && e.data <= ate ? [e.data] : [];
  const fim = e.repete_ate && e.repete_ate < ate ? e.repete_ate : ate;
  const out = [];
  for (let d = lerYmd(e.data > de ? e.data : de); ymd(d) <= fim; d = somarDias(d, 1)) {
    const s = ymd(d);
    if (dias.includes(d.getDay()) && !(e.canceladas || []).includes(s)) out.push(s);
  }
  return out;
}
function entre(eventos, de, ate, ocultos = new Set()) {
  return (eventos || []).filter((e) => !ocultos.has(e.tipo)).flatMap((e) => diasDo(e, de, ate).map((dia) => ({ e, dia })))
    .sort((a, b) => a.dia.localeCompare(b.dia) || (a.e.dia_todo ? -1 : b.e.dia_todo ? 1 : (a.e.inicio || "99").localeCompare(b.e.inicio || "99")));
}
const presencasDe = (ag, eventoId, dia) => Object.fromEntries((ag.presencas || []).filter((p) => p.evento === eventoId && p.dia === dia).map((p) => [p.usuario, p.status]));

// ---------- Leitura ----------
let cacheAg = null;
async function lerAgenda(forcar = false) {
  if (forcar || !cacheAg || cacheAg.equipe !== B.equipeAtual?.id) {
    cacheAg = { equipe: B.equipeAtual.id, p: rpc("agenda_ler", { p_equipe: B.equipeAtual.id }).catch((e) => { cacheAg = null; throw e; }) };
  }
  return cacheAg.p;
}

// ---------- Pedaços de tela ----------
function botoesPresenca(ag, pl, e, dia) {
  const mapa = presencasDe(ag, e.id, dia), minha = mapa[pl.eu] || "";
  const n = (st) => Object.values(mapa).filter((v) => v === st).length;
  const vao = (pl.membros || []).filter((m) => mapa[m.usuario_id] === "vou");
  const passou = dia < hojeYmd();
  return `<div class="presenca" data-evento="${esc(e.id)}" data-dia="${dia}">
    ${Object.entries(PRESENCA).map(([st, [rot, ic]]) => `<button type="button" class="presenca__b presenca__b--${st}${minha === st ? " ativa" : ""}" data-ag-acao="presenca" data-status="${st}" aria-pressed="${minha === st}" ${passou ? "disabled" : ""}>${icone(ic)}${rot}${n(st) ? ` <b>${n(st)}</b>` : ""}</button>`).join("")}
    ${vao.length ? `<span class="av-pilha presenca__quem" title="${esc(vao.map((m) => m.apelido).join(", "))} ${vao.length === 1 ? "vai" : "vão"}">${vao.slice(0, 5).map((m) => fotoMembro(m, "")).join("")}</span>` : ""}
  </div>`;
}

function cartaoEvento(ag, pl, { e, dia }, { comData = false } = {}) {
  const t = tipoDe(pl, e.tipo);
  const sub = [e.adversario && `vs ${esc(e.adversario)}`, e.mapa && esc(e.mapa), e.local && !/^https?:\/\//.test(e.local) && esc(e.local)].filter(Boolean).join(" · ");
  return `<article class="evento" style="--cor-evento:${esc(t.cor)}">
    <button type="button" class="evento__abrir" data-ag-acao="abrir" data-id="${esc(e.id)}" data-dia="${dia}" aria-label="Abrir ${esc(e.titulo)}">
      <span class="evento__quando">${comData ? `<strong>${nomeDia(dia, { day: "2-digit", month: "short" })}</strong>` : ""}<span>${horario(e)}</span>${comData && quando(dia) ? `<small>${quando(dia)}</small>` : ""}</span>
      <span class="evento__meio"><span class="evento__tipo">${esc(t.nome)}${e.repete_dias?.length ? ` · ${icone("atualizar")}` : ""}</span><strong>${esc(e.titulo)}</strong>${sub ? `<span class="suave">${sub}</span>` : ""}</span>
      ${e.mapa && imgFaixa(e.mapa) ? `<img class="evento__mapa" src="${esc(imgFaixa(e.mapa))}" alt="${esc(e.mapa)}" loading="lazy">` : ""}
    </button>
    ${botoesPresenca(ag, pl, e, dia)}
  </article>`;
}

// ---------- Tela Agenda ----------
const V = { mes: null, dia: null, modo: "mes", ocultos: new Set() };

function desenharAgenda(ag, pl) {
  if (!V.dia) V.dia = hojeYmd();
  if (!V.mes) V.mes = V.dia.slice(0, 7);
  const edita = pl.pode_editar, tipos = tiposDe(pl), hoje = hojeYmd();
  const [ano, mes] = V.mes.split("-").map(Number);
  const primeiro = new Date(ano, mes - 1, 1), inicio = somarDias(primeiro, -primeiro.getDay());
  const ocs = entre(ag.eventos, ymd(inicio), ymd(somarDias(inicio, 41)), V.ocultos);
  const porDia = {};
  ocs.forEach((o) => (porDia[o.dia] ||= []).push(o));
  const nomeMes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(primeiro);
  const fuso = fusoDe(pl);
  const topo = `<div class="agenda-topo">
      <div class="agenda-topo__nav"><button type="button" class="botao-icone" data-ag-acao="mes" data-n="-1" aria-label="Mês anterior">${icone("voltar")}</button>
        <h2>${nomeMes[0].toUpperCase() + nomeMes.slice(1)}</h2>
        <button type="button" class="botao-icone" data-ag-acao="mes" data-n="1" aria-label="Próximo mês">${icone("seta")}</button>
        <button type="button" class="botao-secundario botao-mini" data-ag-acao="hoje">Hoje</button></div>
      <div class="lp-acoes"><div class="segmentos" role="group" aria-label="Ver como"><button type="button" aria-pressed="${V.modo === "mes"}" data-ag-acao="modo" data-modo="mes">Mês</button><button type="button" aria-pressed="${V.modo === "lista"}" data-ag-acao="modo" data-modo="lista">Lista</button></div>
        <button type="button" class="botao-secundario botao-mini" data-ag-acao="exportar" title="Arquivo .ics para Google Agenda, Apple ou Outlook">${icone("instalar")} Exportar</button>
        ${edita ? `<button type="button" class="botao-secundario botao-mini" data-ag-acao="tipos">${icone("etiqueta")} Tipos</button><button type="button" class="botao-primario botao-mini" data-ag-acao="novo">${icone("mais")} Novo evento</button>` : ""}</div>
    </div>
    <div class="chips agenda-legenda">${tipos.map((t) => `<button type="button" class="chip legenda${V.ocultos.has(t.id) ? " desligada" : ""}" style="--cor-evento:${esc(t.cor)}" data-ag-acao="filtro" data-tipo="${esc(t.id)}" aria-pressed="${!V.ocultos.has(t.id)}"><i></i>${esc(t.nome)}</button>`).join("")}
      ${meuFuso && meuFuso !== fuso[0] ? `<span class="chip">${icone("relogio")} horários de ${esc(fuso[1].split(" (")[0])}</span>` : ""}</div>`;

  if (V.modo === "lista") {
    const lista = entre(ag.eventos, hoje, ymd(somarDias(new Date(), 90)), V.ocultos);
    const grupos = {};
    lista.forEach((o) => (grupos[o.dia] ||= []).push(o));
    return `${topo}<div class="agenda-lista">${Object.keys(grupos).length ? Object.entries(grupos).map(([dia, itens]) => `<section class="agenda-dia"><h3>${nomeDia(dia)}${quando(dia) ? ` ${selo(quando(dia), "destaque")}` : ""}</h3>${itens.map((o) => cartaoEvento(ag, pl, o)).join("")}</section>`).join("")
      : vazio("Nada marcado nos próximos 90 dias", `<p>${edita ? "Crie o primeiro evento: treino, scrim, campeonato…" : "Quando a liderança marcar algo, aparece aqui."}</p>`)}</div>`;
  }
  const celulas = [];
  for (let i = 0; i < 42; i++) {
    const d = somarDias(inicio, i), s = ymd(d), itens = porDia[s] || [];
    celulas.push(`<button type="button" class="cal__dia${d.getMonth() !== mes - 1 ? " fora" : ""}${s === hoje ? " hoje" : ""}${s === V.dia ? " escolhido" : ""}" data-ag-acao="dia" data-dia="${s}" aria-label="${nomeDia(s)}${itens.length ? `, ${itens.length} evento${itens.length > 1 ? "s" : ""}` : ""}">
      <span class="cal__n">${d.getDate()}</span>
      <span class="cal__itens">${itens.slice(0, 3).map(({ e }) => `<span class="cal__ev" style="--cor-evento:${esc(tipoDe(pl, e.tipo).cor)}">${e.dia_todo ? "" : `<b>${esc(e.inicio)}</b> `}${esc(e.titulo)}</span>`).join("")}${itens.length > 3 ? `<span class="cal__mais">+${itens.length - 3}</span>` : ""}</span>
      <span class="cal__pontos">${itens.slice(0, 4).map(({ e }) => `<i style="--cor-evento:${esc(tipoDe(pl, e.tipo).cor)}"></i>`).join("")}</span></button>`);
  }
  const doDia = entre(ag.eventos, V.dia, V.dia, V.ocultos);
  return `${topo}<div class="agenda-grade">
      <div class="cal" role="grid">${SEMANA.map((s) => `<span class="cal__semana">${s}</span>`).join("")}${celulas.join("")}</div>
      <aside class="cartao agenda-detalhe"><div class="cartao__titulo"><h3>${nomeDia(V.dia)}</h3>${edita ? `<button type="button" class="botao-icone" data-ag-acao="novo" aria-label="Novo evento neste dia">${icone("mais")}</button>` : ""}</div>
        ${quando(V.dia) ? `<p class="suave pequeno">${quando(V.dia)}</p>` : ""}
        ${doDia.length ? doDia.map((o) => cartaoEvento(ag, pl, o)).join("") : `<p class="suave pequeno">Nada marcado neste dia.</p>`}</aside>
    </div>`;
}

function montarAgenda(desenhar, { soEquipe = true, abrir = null } = {}) {
  return {
    html: `<div class="agenda" data-agenda>${esqueleto("agenda")}</div>`,
    depois: async (main) => {
      const raiz = main.querySelector("[data-agenda]");
      if (!raiz) return;
      const pintar = async (forcar = false) => {
        try {
          const [ag, pl] = await Promise.all([lerAgenda(forcar), lerPlanejamento(forcar), carregarMapas()]);
          if (!raiz.isConnected) return;
          raiz._ag = ag; raiz._pl = pl;
          raiz.innerHTML = desenhar(ag, pl);
        } catch (e) {
          console.error(e);
          if (!raiz.isConnected) return;
          raiz.innerHTML = soEquipe ? avisoErro(e) : "";
        }
      };
      raiz._pintar = pintar;
      raiz.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-plan-recarregar]")) { pintar(true); return; }
        const b = ev.target.closest("[data-ag-acao]");
        if (b && !b.disabled && raiz._ag && ACOES_AG[b.dataset.agAcao]) ACOES_AG[b.dataset.agAcao](b, raiz);
      });
      await pintar();
      // v36: ?evento=<id>&dia=<AAAA-MM-DD> abre o evento (vem da paleta Ctrl+K)
      if (abrir && raiz._ag && raiz.isConnected) abrirEvento(raiz, abrir[0], abrir[1]);
    },
  };
}

export const viewAgenda = (q) => montarAgenda(desenharAgenda, { abrir: q?.get("evento") && q?.get("dia") ? [q.get("evento"), q.get("dia")] : null });

/** Os próximos compromissos com a presença de quem está vendo (Início pessoal): [{ e, dia, inicio (ms), minha }] */
export async function proximosComPresenca(dias = 2) {
  const [ag, pl] = await Promise.all([lerAgenda(), lerPlanejamento()]);
  return entre(ag.eventos, hojeYmd(), ymd(somarDias(new Date(), dias))).map(({ e, dia }) => ({
    e, dia, inicio: new Date(`${dia}T${e.dia_todo ? "09:00" : e.inicio || "09:00"}:00`).getTime(),
    minha: presencasDe(ag, e.id, dia)[pl.eu] || "" }));
}

/** Os próximos compromissos (para a paleta Ctrl+K): [{ e, dia }] */
export async function proximosEventos(dias = 60) {
  const ag = await lerAgenda();
  return entre(ag.eventos, hojeYmd(), ymd(somarDias(new Date(), dias)));
}

/** Início: os próximos compromissos da equipe (some sozinho se não houver agenda ou acesso) */
export function comAgendaNoInicio(v) {
  if (!podeVerPlanejamento()) return v;
  const bloco = montarAgenda((ag, pl) => {
    const prox = entre(ag.eventos, hojeYmd(), ymd(somarDias(new Date(), 30))).slice(0, 4);
    if (!prox.length && !pl.pode_editar) return "";
    return `<section class="secao"><div class="secao__titulo"><h2>Próximos compromissos</h2><a class="pequeno" href="#/equipe/agenda">Ver agenda</a></div>
      ${prox.length ? `<div class="eventos-grade">${prox.map((o) => cartaoEvento(ag, pl, o, { comData: true })).join("")}</div>`
        : `<div class="cartao"><p class="suave pequeno">Nada marcado no próximo mês. <a href="#/equipe/agenda">Marcar o primeiro treino</a>.</p></div>`}</section>`;
  }, { soEquipe: false });
  return { ...v, html: `${v.html}${bloco.html}`, depois: async (main) => { if (v.depois) v.depois(main); await bloco.depois(main); } };
}

// ---------- Detalhes de um evento ----------
async function abrirEvento(raiz, id, dia) {
  const ag = raiz._ag, pl = raiz._pl;
  const e = (ag.eventos || []).find((x) => x.id === id);
  if (!e) { avisar("Esse evento não existe mais.", "erro"); return; }
  const t = tipoDe(pl, e.tipo), fuso = fusoDe(pl), mapa = presencasDe(ag, e.id, dia);
  const grupo = (st) => (pl.membros || []).filter((m) => (mapa[m.usuario_id] || "") === st);
  const pessoas = (rot, lista, cls) => (lista.length ? `<div class="presenca-grupo presenca-grupo--${cls}"><strong>${rot} · ${lista.length}</strong><span>${lista.map((m) => `<span class="pessoa">${fotoMembro(m, "")}${esc(m.apelido)}</span>`).join("")}</span></div>` : "");
  const rep = e.repete_dias?.length ? `Toda ${e.repete_dias.map((d) => SEMANA[d].toLowerCase()).join(", ")}${e.repete_ate ? ` até ${nomeDia(e.repete_ate, { day: "2-digit", month: "2-digit", year: "numeric" })}` : ""}` : "";
  const link = /^https?:\/\//.test(e.local || "");
  const r = await janela({
    titulo: `<span class="evento-ponto" style="--cor-evento:${esc(t.cor)}"></span>${esc(e.titulo)}`,
    corpo: `<div class="evento-detalhe">
      <p>${icone("relogio")} <strong>${nomeDia(dia)}</strong> · ${horario(e)}${e.dia_todo ? "" : ` <span class="suave">(${esc(fuso[1].split(" (")[0])})</span>`} ${quando(dia) ? selo(quando(dia), "destaque") : ""}</p>
      ${rep ? `<p>${icone("atualizar")} ${rep}</p>` : ""}
      <p>${icone("etiqueta")} ${selo(esc(t.nome))}</p>
      ${e.adversario ? `<p>${icone("alvo")} vs <strong>${esc(e.adversario)}</strong></p>` : ""}
      ${e.mapa ? `<p>${icone("mapa")} ${esc(e.mapa)}</p>` : ""}
      ${e.local ? `<p>${icone("pino")} ${link ? `<a href="${esc(e.local)}" target="_blank" rel="noopener noreferrer">${esc(e.local.replace(/^https?:\/\//, "").slice(0, 60))}</a>` : esc(e.local)}</p>` : ""}
      ${e.notas ? `<p class="evento-notas">${esc(e.notas)}</p>` : ""}
      <div><strong class="pequeno">Sua presença</strong>${botoesPresenca(ag, pl, e, dia)}</div>
      <div class="presenca-grupos">${pessoas("Vão", grupo("vou"), "vou")}${pessoas("Talvez", grupo("talvez"), "talvez")}${pessoas("Não vão", grupo("nao"), "nao")}${pessoas("Sem resposta", grupo(""), "sem")}</div>
      <div class="lp-acoes evento-exportar"><a class="botao-secundario botao-mini" href="${linkGoogle(pl, e)}" target="_blank" rel="noopener noreferrer">${icone("externo")} Google Agenda</a>
        <button type="button" class="botao-secundario botao-mini" data-ics>${icone("instalar")} .ics</button>
        <button type="button" class="botao-secundario botao-mini" data-discord>${icone("link")} Copiar para o Discord</button></div></div>`,
    acoes: pl.pode_editar ? [["apagar", `${icone("fechar")} Apagar`, "botao-perigo"], ["duplicar", "Duplicar"], ["editar", `${icone("lapis")} Editar`, "botao-primario"]] : [["ok", "Fechar", "botao-primario"]],
    aoAbrir: (f) => {
      f.querySelector("[data-ics]").addEventListener("click", () => baixarIcs(pl, [e], `${e.titulo}.ics`));
      f.querySelector("[data-discord]").addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(textoDiscord(pl, e, dia, mapa)); avisar("Copiado! Cole no Discord.", "novo"); } catch (er) { avisar("Não consegui copiar.", "erro"); }
      });
      f.addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-ag-acao=presenca]");
        if (!b) return;
        ev.preventDefault();
        await marcarPresenca(raiz, b.closest(".presenca"), b.dataset.status);
        f.closest("dialog")?.dispatchEvent(new Event("cancel"));
        setTimeout(() => abrirEvento(raiz, id, dia), 60);
      });
    },
  });
  if (r.valor === "editar") return editarEvento(raiz, e);
  if (r.valor === "duplicar") { const { id: _, canceladas: __, ...copia } = e; return editarEvento(raiz, { ...copia, data: dia, repete_dias: null, repete_ate: null }, true); }
  if (r.valor === "apagar") {
    if (e.repete_dias?.length) {
      const q = await janela({ titulo: "Apagar evento que repete", corpo: `<p>Apagar só ${nomeDia(dia).toLowerCase()} ou a série inteira?</p>`,
        acoes: [["cancelar", "Cancelar"], ["serie", "A série inteira", "botao-perigo"], ["um", "Só este dia", "botao-primario"]] });
      if (q.valor === "um") { if (await salvarEv(raiz, { ...e, canceladas: [...(e.canceladas || []), dia] }, "Esse dia foi cancelado ✓")) return; return; }
      if (q.valor !== "serie") return;
    } else if (!await confirmar("Apagar evento?", `“${esc(e.titulo)}” sai da agenda de toda a equipe, junto com as presenças.`, "Apagar", true)) return;
    try { await rpc("agenda_apagar", { p_id: e.id }); avisar("Evento apagado ✓"); await raiz._pintar(true); } catch (er) { avisar(textoErro(er), "erro"); }
  }
}

async function marcarPresenca(raiz, caixa, status) {
  const pl = raiz._pl, ag = raiz._ag, { evento, dia } = caixa.dataset;
  const atual = presencasDe(ag, evento, dia)[pl.eu] || "";
  const novo = atual === status ? "" : status;   // tocar de novo desmarca
  try {
    await rpc("agenda_presenca", { p_evento: evento, p_dia: dia, p_status: novo });
    avisar(novo ? `Presença: ${PRESENCA[novo][0]}` : "Presença desmarcada");
    await raiz._pintar(true);
  } catch (e) { avisar(faltaSql(e) ? "Falta rodar o supabase/planejamento.sql no banco." : textoErro(e), "erro"); }
}

async function salvarEv(raiz, ev, ok) {
  const corpo = { id: ev.id || null, titulo: ev.titulo, tipo: ev.tipo || "", data: ev.data, dia_todo: Boolean(ev.dia_todo), inicio: ev.inicio || "", fim: ev.fim || "",
    repete_dias: ev.repete_dias || [], repete_ate: ev.repete_ate || null, canceladas: ev.canceladas || [], local: ev.local || "", adversario: ev.adversario || "", mapa: ev.mapa || "", notas: ev.notas || "" };
  try {
    await rpc("agenda_salvar", { p_equipe: B.equipeAtual.id, p_evento: corpo });
    avisar(ok, "novo");
    V.dia = ev.data; V.mes = ev.data.slice(0, 7);
    await raiz._pintar(true);
    return true;
  } catch (e) { avisar(faltaSql(e) ? "Falta rodar o supabase/planejamento.sql no banco." : textoErro(e), "erro"); return false; }
}

// ---------- Criar / editar ----------
async function editarEvento(raiz, ev = null, copia = false) {
  const pl = raiz._pl, tipos = tiposDe(pl);
  const e = { titulo: "", tipo: tipos[0]?.id || "", data: V.dia || hojeYmd(), dia_todo: false, inicio: "20:00", fim: "22:00", repete_dias: null, repete_ate: null,
    local: "", adversario: "", mapa: "", notas: "", canceladas: [], ...(ev || {}) };
  const repete = Boolean(e.repete_dias?.length);
  const dias = new Set(e.repete_dias?.length ? e.repete_dias : [lerYmd(e.data).getDay()]);
  const pool = pl.pool?.length ? pl.pool : POOL_PADRAO;
  const r = await janela({
    titulo: ev?.id && !copia ? "Editar evento" : copia ? "Duplicar evento" : "Novo evento",
    larga: true,
    corpo: `<div class="pilha-form">
      <label class="campo"><span>Nome</span><input name="titulo" maxlength="80" value="${esc(e.titulo)}" placeholder="Ex.: Treino da line, Scrim vs Time X, Copa…" autofocus></label>
      <fieldset class="campo"><legend>Tipo</legend><div class="tipos-evento">${tipos.map((t) => `<label class="tipo-op" style="--cor-evento:${esc(t.cor)}"><input type="radio" name="tipo" value="${esc(t.id)}"${e.tipo === t.id ? " checked" : ""}><i></i>${esc(t.nome)}</label>`).join("")}</div></fieldset>
      <div class="grade-2 grade-2--fixa">
        <label class="campo"><span data-rotulo-data>${repete ? "Começa em" : "Data"}</span><input type="date" name="data" value="${esc(e.data)}" required></label>
        <fieldset class="campo campo-horario${e.dia_todo ? " dia-todo" : ""}"><legend>Horário <small class="suave">(${esc(fusoDe(pl)[1].split(" (")[0])})</small></legend>
          <div class="horario"><input type="time" name="inicio" value="${esc(e.inicio)}" aria-label="Começa"><span class="suave">até</span><input type="time" name="fim" value="${esc(e.fim)}" aria-label="Termina"></div>
          <label class="campo--check"><input type="checkbox" name="dia_todo"${e.dia_todo ? " checked" : ""}><span>Dia todo</span></label></fieldset>
      </div>
      <fieldset class="campo"><label class="campo--check"><input type="checkbox" name="repete"${repete ? " checked" : ""}><span>Repete toda semana</span></label>
        <div class="repeticao" ${repete ? "" : "hidden"}>
          <div class="dias-semana">${SEMANA.map((s, i) => `<label class="dia-op"><input type="checkbox" name="dia${i}"${dias.has(i) ? " checked" : ""}><span>${s}</span></label>`).join("")}</div>
          <label class="campo"><span>Até <small class="suave">(opcional)</small></span><input type="date" name="repete_ate" value="${esc(e.repete_ate || "")}"></label></div></fieldset>
      <div class="grade-2 grade-2--fixa">
        <label class="campo"><span>Adversário <small class="suave">(opcional)</small></span><input name="adversario" maxlength="80" value="${esc(e.adversario)}" placeholder="Para scrims e partidas"></label>
        <label class="campo"><span>Mapa <small class="suave">(opcional)</small></span><select name="mapa"><option value="">—</option>${pool.map((m) => `<option${e.mapa === m ? " selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
      </div>
      <label class="campo"><span>Local ou link <small class="suave">(opcional)</small></span><input name="local" maxlength="300" value="${esc(e.local)}" placeholder="Discord, link do campeonato, LAN…"></label>
      <label class="campo"><span>Observações <small class="suave">(opcional)</small></span><textarea name="notas" rows="3" maxlength="2000">${esc(e.notas)}</textarea></label></div>`,
    acoes: [["cancelar", "Cancelar"], ["ok", ev?.id && !copia ? "Salvar" : "Criar evento", "botao-primario"]],
    aoAbrir: (f) => {
      f.elements.dia_todo.addEventListener("change", () => f.querySelector(".campo-horario").classList.toggle("dia-todo", f.elements.dia_todo.checked));
      f.elements.repete.addEventListener("change", () => { f.querySelector(".repeticao").hidden = !f.elements.repete.checked; f.querySelector("[data-rotulo-data]").textContent = f.elements.repete.checked ? "Começa em" : "Data"; });
      f.elements.data.addEventListener("change", () => {   // num evento novo, a repetição sugere o dia da semana da data
        if (ev?.id || !f.elements.data.value) return;
        const dsem = lerYmd(f.elements.data.value).getDay();
        SEMANA.forEach((_, i) => { f.elements[`dia${i}`].checked = i === dsem; });
      });
    },
    antesDeFechar: (_, f) => {
      if (!f.elements.titulo.value.trim()) return "Dê um nome ao evento.";
      if (!f.elements.data.value) return "Escolha a data.";
      if (f.elements.repete.checked && !SEMANA.some((_, i) => f.elements[`dia${i}`].checked)) return "Marque pelo menos um dia da semana.";
      if (f.elements.repete.checked && f.elements.repete_ate.value && f.elements.repete_ate.value < f.elements.data.value) return "A data final da repetição é antes do começo.";
      return "";
    },
  });
  if (r.valor !== "ok") return;
  const f = r.form, rep = f.elements.repete.checked, todo = f.elements.dia_todo.checked;
  await salvarEv(raiz, {
    id: ev?.id && !copia ? ev.id : null, titulo: f.elements.titulo.value.trim(), tipo: f.querySelector("input[name=tipo]:checked")?.value || "",
    data: f.elements.data.value, dia_todo: todo, inicio: todo ? "" : f.elements.inicio.value, fim: todo ? "" : f.elements.fim.value,
    repete_dias: rep ? SEMANA.map((_, i) => i).filter((i) => f.elements[`dia${i}`].checked) : [], repete_ate: rep ? f.elements.repete_ate.value || null : null,
    canceladas: rep ? (ev?.canceladas || []).filter((x) => x >= f.elements.data.value) : [],
    adversario: f.elements.adversario.value.trim(), mapa: f.elements.mapa.value, local: f.elements.local.value.trim(), notas: f.elements.notas.value.trim(),
  }, ev?.id && !copia ? "Evento salvo ✓" : "Evento criado ✓");
}

// ---------- Tipos e fuso ----------
async function editarTipos(raiz) {
  const pl = raiz._pl, lista = tiposDe(pl).map((t) => ({ ...t }));
  const linha = (t, i) => `<div class="tipo-linha" data-i="${i}"><input type="color" value="${esc(t.cor)}" data-k="cor" aria-label="Cor"><input value="${esc(t.nome)}" data-k="nome" maxlength="30" aria-label="Nome"><button type="button" class="botao-icone" data-tirar="${i}" aria-label="Apagar tipo">${icone("fechar")}</button></div>`;
  const r = await janela({
    titulo: "Tipos de evento",
    corpo: `<p class="suave pequeno">Renomeie, troque a cor, crie ou apague. Eventos de um tipo apagado ficam como “Evento”.</p>
      <div class="tipos-lista">${lista.map(linha).join("")}</div>
      <p class="lp-acoes"><button type="button" class="botao-secundario botao-mini" data-novo>${icone("mais")} Novo tipo</button><button type="button" class="botao-secundario botao-mini" data-padrao>Restaurar padrão</button></p>
      <label class="campo"><span>Fuso dos horários</span><select name="fuso">${FUSOS.map(([id, nome]) => `<option value="${id}"${fusoDe(pl)[0] === id ? " selected" : ""}>${esc(nome)}</option>`).join("")}</select>
        <small>Os horários aparecem e são exportados nesse fuso.</small></label>`,
    acoes: [["cancelar", "Cancelar"], ["ok", "Salvar", "botao-primario"]],
    aoAbrir: (f) => {
      const caixa = f.querySelector(".tipos-lista"), redesenhar = () => { caixa.innerHTML = lista.map(linha).join(""); };
      f.addEventListener("input", (ev) => { const l = ev.target.closest(".tipo-linha"); if (l && ev.target.dataset.k) lista[l.dataset.i][ev.target.dataset.k] = ev.target.value; });
      f.addEventListener("click", (ev) => {
        const t = ev.target.closest("[data-tirar]");
        if (t) { if (lista.length <= 1) { avisar("Precisa ter pelo menos um tipo.", "erro"); return; } lista.splice(Number(t.dataset.tirar), 1); redesenhar(); }
        if (ev.target.closest("[data-novo]")) { lista.push({ id: `t${Date.now().toString(36)}`, nome: "Novo tipo", cor: CORES[lista.length % CORES.length] }); redesenhar(); caixa.lastElementChild?.querySelector("[data-k=nome]")?.select(); }
        if (ev.target.closest("[data-padrao]")) { lista.splice(0, lista.length, ...TIPOS_PADRAO.map((t) => ({ ...t }))); redesenhar(); }
      });
    },
  });
  if (r.valor !== "ok") return;
  try {
    await rpc("agenda_configurar", { p_equipe: B.equipeAtual.id, p_tipos: lista.map((t) => ({ id: t.id, nome: t.nome.trim() || "Sem nome", cor: t.cor })), p_fuso: r.dados.fuso });
    avisar("Tipos salvos ✓");
    await raiz._pintar(true);
  } catch (e) { avisar(textoErro(e), "erro"); }
}

// ---------- Exportar: Google Agenda, .ics e Discord ----------
const DIA_ICS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const junto = (s) => s.replace(/-/g, "");
function limites(e, dia) {
  const seguinte = ymd(somarDias(lerYmd(dia), 1));
  if (e.dia_todo || !e.inicio) return { todo: true, a: junto(dia), b: junto(seguinte) };
  let fim = e.fim, diaFim = dia;
  if (!fim) { const h = Number(e.inicio.slice(0, 2)) + 1; fim = `${p2(h % 24)}:${e.inicio.slice(3)}`; if (h >= 24) diaFim = seguinte; }
  else if (fim <= e.inicio) diaFim = seguinte;   // passa da meia-noite (22:00 até 01:00)
  return { todo: false, a: `${junto(dia)}T${e.inicio.replace(":", "")}00`, b: `${junto(diaFim)}T${fim.replace(":", "")}00` };
}
const rrule = (e) => (e.repete_dias?.length ? `RRULE:FREQ=WEEKLY;BYDAY=${e.repete_dias.map((d) => DIA_ICS[d]).join(",")}${e.repete_ate ? `;UNTIL=${junto(e.repete_ate)}T235959Z` : ""}` : "");
const descricao = (pl, e) => [e.adversario && `Adversário: ${e.adversario}`, e.mapa && `Mapa: ${e.mapa}`, e.notas, `${B.equipeAtual?.nome || "Equipe"} · ValReport`].filter(Boolean).join("\n");
function linkGoogle(pl, e) {
  const l = limites(e, e.data);
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.titulo, dates: `${l.a}/${l.b}`, details: descricao(pl, e), location: e.local || "" });
  if (!l.todo) q.set("ctz", fusoDe(pl)[0]);
  if (rrule(e)) q.set("recur", rrule(e));
  return `https://calendar.google.com/calendar/render?${q}`;
}
const textoIcs = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function dobrar(linha) {   // linhas de no máximo 75 bytes (RFC 5545)
  const out = [], enc = new TextEncoder();
  let atual = "";
  for (const ch of linha) { if (enc.encode(atual + ch).length > 74) { out.push(atual); atual = ` ${ch}`; } else atual += ch; }
  out.push(atual);
  return out.join("\r\n");
}
function montarIcs(pl, eventos) {
  const [fid, , desloc] = fusoDe(pl);
  const carimbo = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NokyLabs//ValReport//PT-BR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${textoIcs(B.equipeAtual?.nome || "Equipe")}`, `X-WR-TIMEZONE:${fid}`];
  if (desloc) L.push("BEGIN:VTIMEZONE", `TZID:${fid}`, "BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${desloc}`, `TZOFFSETTO:${desloc}`, "END:STANDARD", "END:VTIMEZONE");
  for (const e of eventos) {
    const l = limites(e, e.data);
    L.push("BEGIN:VEVENT", `UID:${e.id}@valreport`, `DTSTAMP:${carimbo}`, `SUMMARY:${textoIcs(e.titulo)}`,
      l.todo ? `DTSTART;VALUE=DATE:${l.a}` : `DTSTART;TZID=${fid}:${l.a}`, l.todo ? `DTEND;VALUE=DATE:${l.b}` : `DTEND;TZID=${fid}:${l.b}`);
    if (rrule(e)) L.push(rrule(e));
    for (const x of e.canceladas || []) L.push(l.todo ? `EXDATE;VALUE=DATE:${junto(x)}` : `EXDATE;TZID=${fid}:${junto(x)}T${e.inicio.replace(":", "")}00`);
    L.push(`CATEGORIES:${textoIcs(tipoDe(pl, e.tipo).nome)}`, `DESCRIPTION:${textoIcs(descricao(pl, e))}`);
    if (e.local) L.push(`LOCATION:${textoIcs(e.local)}`);
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return `${L.map(dobrar).join("\r\n")}\r\n`;
}
function baixarIcs(pl, eventos, nome) {
  const url = URL.createObjectURL(new Blob([montarIcs(pl, eventos)], { type: "text/calendar;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome.replace(/[\\/:*?"<>|]/g, "-") });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  avisar("Arquivo .ics baixado. Abra para pôr na sua agenda.");
}
function textoDiscord(pl, e, dia, mapa) {
  const t = tipoDe(pl, e.tipo), vao = (pl.membros || []).filter((m) => mapa[m.usuario_id] === "vou").map((m) => m.apelido);
  return [`📅 **${e.titulo}** (${t.nome})`, `${nomeDia(dia)} · ${horario(e)}${e.dia_todo ? "" : ` (${fusoDe(pl)[1].split(" (")[0]})`}`,
    e.adversario && `⚔️ vs ${e.adversario}`, e.mapa && `🗺️ ${e.mapa}`, e.local && `📍 ${e.local}`, e.notas,
    vao.length ? `✅ Confirmados: ${vao.join(", ")}` : "", `@everyone confirmem presença: ${location.origin}/#/equipe/agenda`].filter(Boolean).join("\n");
}

// ---------- Ações ----------
const ACOES_AG = {
  mes: (b, raiz) => { const [a, m] = V.mes.split("-").map(Number); V.mes = ymd(new Date(a, m - 1 + Number(b.dataset.n), 1)).slice(0, 7); raiz._pintar(); },
  hoje: (b, raiz) => { V.dia = hojeYmd(); V.mes = V.dia.slice(0, 7); raiz._pintar(); },
  modo: (b, raiz) => { V.modo = b.dataset.modo; raiz._pintar(); },
  dia: (b, raiz) => {
    V.dia = b.dataset.dia;
    if (b.classList.contains("fora")) V.mes = V.dia.slice(0, 7);
    raiz._pintar().then(() => { if (matchMedia("(max-width: 899px)").matches) raiz.querySelector(".agenda-detalhe")?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  },
  filtro: (b, raiz) => { V.ocultos.has(b.dataset.tipo) ? V.ocultos.delete(b.dataset.tipo) : V.ocultos.add(b.dataset.tipo); raiz._pintar(); },
  novo: (b, raiz) => editarEvento(raiz, null),
  tipos: (b, raiz) => editarTipos(raiz),
  exportar: (b, raiz) => { const evs = raiz._ag.eventos || []; if (!evs.length) { avisar("A agenda está vazia.", "erro"); return; } baixarIcs(raiz._pl, evs, `Agenda ${B.equipeAtual?.nome || "equipe"}.ics`); },
  abrir: (b, raiz) => abrirEvento(raiz, b.dataset.id, b.dataset.dia),
  presenca: (b, raiz) => marcarPresenca(raiz, b.closest(".presenca"), b.dataset.status),
};

/** Para testes e para a página Sobre */
export const _interno = { diasDo, entre, montarIcs, limites };
