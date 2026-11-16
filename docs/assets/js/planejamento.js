// Planejamento da equipe (v25): Map pool (voto + pontos da liderança), Comps e defaults por mapa (com o lugar de cada
// posição no minimapa ou o print enviado pela equipe), Calls e Callouts. Só a equipe vê (convidados não);
// líder, co-líderes e treinadores editam (o banco confere de novo, em supabase/planejamento.sql).

import { esc, icone, imagem, imgCard, vazio, selo, dataHora } from "./util.js";
import { B } from "./dados.js";
import { rpc, assinar, enviarArquivo, apagarArquivo } from "./nuvem.js";
import { agentesValorant, mapasValorant } from "./valapi.js";
import { janela, confirmar, avisar, textoErro, mostrarErro } from "./janela.js";

export const BALDE_PLAN = "planejamento";
const CDN = "https://media.valorant-api.com";

/** Quem vê e quem edita (o banco confere de novo; isto só decide o que aparece) */
export const podeVerPlanejamento = () => !B.editor && Boolean(B.equipeAtual) && (B.conta?.admin || (B.equipeAtual.cargo && B.equipeAtual.cargo !== "convidado"));
export const podeEditarPlanejamento = () => !B.editor && Boolean(B.equipeAtual) && (B.conta?.admin || ["lider", "colider", "treinador"].includes(B.equipeAtual.cargo));

// ---------- Dados padrão ----------
export const POOL_PADRAO = ["Abyss", "Bind", "Corrode", "Haven", "Lotus", "Summit", "Sunset"];

// Posições com os nomes que a galera BR usa, cada uma ligada ao callout oficial do jogo (o lugar no minimapa)
const POSICOES = {
  Abyss: [[["Ponta A (Main)", "A Main"], ["Meio Aggro (Top)", "Mid Top"], ["Meio Tradder (Bottom)", "Mid Bottom"], ["Ponta B (Main)", "B Main"], ["Lurk (Biblioteca)", "Mid Library"]],
    [["Âncora A (Torre)", "A Tower"], ["Rotação A (Link)", "A Link"], ["Meio (Biblioteca)", "Mid Library"], ["Âncora B (Ninho)", "B Nest"], ["Ajuda B (Danger)", "B Danger"]]],
  Ascent: [[["Ponta A (Main)", "A Main"], ["Meio (Top)", "Mid Top"], ["Cat (Meio)", "Mid Catwalk"], ["Ponta B (Main)", "B Main"], ["Lurk (B Lobby)", "B Lobby"]],
    [["Âncora A (Céu)", "A Heaven"], ["Rotação A (Garden)", "A Garden"], ["Meio (Market)", "Mid Market"], ["Âncora B (Site)", "B Site"], ["Ajuda B (Boat House)", "B Boat House"]]],
  Bind: [[["Ponta A (Short)", "A Short"], ["Banheiro (Showers)", "A Showers"], ["Hookah (controle)", "B Hookah"], ["Long B", "B Long"], ["Lurk (TP)", "A Teleporter"]],
    [["Âncora A (Caminhão)", "A Truck"], ["Céu A", "A Heaven"], ["Rotação (Garden)", "B Garden"], ["Âncora B (Elbow)", "B Elbow"], ["Janela B (Hookah)", "B Window"]]],
  Breeze: [[["Ponta A (Main)", "A Main"], ["Cave A", "A Cave"], ["Meio (Top)", "Mid Top"], ["Ponta B (Main)", "B Main"], ["Lurk (Túnel)", "Mid Tunnel"]],
    [["Âncora A (Site)", "A Site"], ["Rotação A (Hall)", "A Hall"], ["Meio (Nest)", "Mid Nest"], ["Âncora B (Site)", "B Site"], ["Ajuda B (Back)", "B Back"]]],
  Corrode: [[["Ponta A (Main)", "A Main"], ["Pátio A (Yard)", "A Yard"], ["Meio (Janela)", "Mid Window"], ["Ponta B (Main)", "B Main"], ["Lurk (Meio Bottom)", "Mid Bottom"]],
    [["Âncora A (Guindaste)", "A Crane"], ["Rotação A (Link)", "A Link"], ["Meio (Top)", "Mid Top"], ["Âncora B (Torre)", "B Tower"], ["Ajuda B (Arco)", "B Arch"]]],
  Fracture: [[["Ponta A (Main)", "A Main"], ["Corda A (Rope)", "A Rope"], ["Arcade", "B Arcade"], ["Ponta B (Main)", "B Main"], ["Lurk (Defensor)", "Defender Side Spawn"]],
    [["Âncora A (Site)", "A Site"], ["Rotação A (Drop)", "A Drop"], ["Ponte (Meio)", "Attacker Side Bridge"], ["Âncora B (Tower)", "B Tower"], ["Ajuda B (Generator)", "B Generator"]]],
  Haven: [[["Long A", "A Long"], ["Esgoto A (Short)", "A Sewer"], ["Meio (Janela)", "Mid Window"], ["Long C", "C Long"], ["Rato da Garagem", "Mid Garage"]],
    [["Âncora A (Céu)", "A Heaven"], ["Ajuda A (Link)", "A Link"], ["Meio / Janela B", "B Site"], ["Âncora C (Cubby)", "C Cubby"], ["Garagem (ajuda C)", "Mid Garage"]]],
  Icebox: [[["Ponta A (Belt)", "A Belt"], ["Rave A", "A Rafters"], ["Meio (Boiler)", "Mid Boiler"], ["Ponta B (Yellow)", "B Yellow"], ["Lurk (B Garage)", "B Garage"]],
    [["Âncora A (Nest)", "A Nest"], ["Ajuda A (Screens)", "A Screens"], ["Meio (Kitchen)", "B Kitchen"], ["Âncora B (Site)", "B Site"], ["Ajuda B (Snowman)", "B Snowman"]]],
  Lotus: [[["Ponta A (Main)", "A Main"], ["Árvore A (Tree)", "A Tree"], ["Ponta B (Pilares)", "B Pillars"], ["Ponta C (Main)", "C Main"], ["Rato do Mound", "C Mound"]],
    [["Âncora A (Cabana)", "A Hut"], ["Rotação A (Escada)", "A Stairs"], ["Âncora B (Upper)", "B Upper"], ["Âncora C (Hall)", "C Hall"], ["Ajuda C (Cascata)", "C Waterfall"]]],
  Pearl: [[["Ponta A (Main)", "A Main"], ["Restaurante A", "A Restaurant"], ["Meio (Top)", "Mid Top"], ["Ponta B (Long)", "B Long"], ["Lurk (B Club)", "B Club"]],
    [["Âncora A (Site)", "A Site"], ["Ajuda A (Link)", "A Link"], ["Meio (Connector)", "Mid Connector"], ["Âncora B (Site)", "B Site"], ["Ajuda B (Tower)", "B Tower"]]],
  Split: [[["Ponta A (Main)", "A Main"], ["Rampa A", "A Ramps"], ["Meio (Mail)", "Mid Mail"], ["Ponta B (Main)", "B Main"], ["Lurk (B Garage)", "B Garage"]],
    [["Âncora A (Céu)", "A Heaven"], ["Rotação A (Screens)", "A Screens"], ["Meio (Vent)", "Mid Vent"], ["Âncora B (Céu)", "B Heaven"], ["Ajuda B (Rafters)", "B Rafters"]]],
  Summit: [[["Ponta A (Main)", "A Main"], ["Jardim A (Garden)", "A Garden"], ["Meio (Fonte)", "Mid Fountain"], ["Ponta B (Main)", "B Main"], ["Torre B (vertical)", "B Tower"]],
    [["Âncora A (Arte)", "A Art"], ["Rotação A (Hall)", "A Hall"], ["Meio (Janela)", "Mid Window"], ["Âncora B (Academia)", "B Gym"], ["Ajuda B (Troféu)", "B Trophy"]]],
  Sunset: [[["Ponta A (Main)", "A Main"], ["Beco A (Alley)", "A Alley"], ["Meio Top (Pátio)", "Mid Courtyard"], ["Meio Bottom (Tiles)", "Mid Tiles"], ["Ponta B (Main)", "B Main"]],
    [["Âncora A", "A Site"], ["Ajuda A (Elbow)", "A Elbow"], ["Meio (Pátio)", "Mid Top"], ["Mercado (meio / B)", "B Market"], ["Âncora B (Boba)", "B Boba"]]],
};
const POSICOES_GENERICAS = [[["Ponta A", "A Main"], ["Meio", "Mid"], ["Meio (apoio)", "Mid"], ["Ponta B", "B Main"], ["Lurk", ""]],
  [["Âncora A", "A Site"], ["Rotação A", "A Link"], ["Meio", "Mid"], ["Âncora B", "B Site"], ["Rotação B", "B Link"]]];
const posicoesDe = (mapa) => POSICOES[mapa] || POSICOES_GENERICAS;
export const LADOS = { ataque: ["Ataque", "ATK", 0], defesa: ["Defesa", "DEF", 1] };

export const CALLS_PADRAO = [
  { codigo: "123", alt: "1, 2", titulo: "Peekar juntos", texto: "Contagem regressiva para sincronizar o peek de dois ou mais jogadores. Todos devem estar prontos para aparecer no mesmo timing, evitando que o adversário consiga isolar os duelos." },
  { codigo: "BOOM", alt: "", titulo: "Flash/skill estourando", texto: "Avisa o momento exato em que a flash/skill estoura. Os jogadores devem usar esse timing para peekar e aproveitar o efeito da habilidade, evitando entrar cedo demais ou perder a janela de oportunidade." },
  { codigo: "SWING", alt: "", titulo: "Lutar junto", texto: "Coordena um peek agressivo em conjunto, geralmente para punir um adversário que está distraído ou ocupado lutando contra um teammate." },
  { codigo: "TRADE", alt: "", titulo: "Garantir a troca", texto: "O segundo jogador deve estar pronto para eliminar o adversário caso o primeiro morra. A ideia é não deixar um teammate morrer sem que o time consiga punir o responsável." },
  { codigo: "GO", alt: "", titulo: "Executar", texto: "Sinal para iniciar a execução combinada. Quando o caller der o GO, todos devem agir no timing definido, sem hesitar ou entrar individualmente." },
  { codigo: "HOLD", alt: "", titulo: "Segurar", texto: "Interromper temporariamente o avanço e aguardar o próximo comando. Usado para sincronizar habilidades, esperar uma oportunidade ou evitar uma entrada precipitada." },
  { codigo: "STOP", alt: "", titulo: "Cancelar a ação", texto: "Interromper a jogada quando o timing foi perdido ou as condições mudaram. Evita que o time continue entrando descoordenado em uma situação desfavorável." },
  { codigo: "RESET", alt: "", titulo: "Reorganizar", texto: "Abandonar a tentativa atual e reorganizar a jogada, reposicionando o time e preparando uma nova abordagem." },
  { codigo: "FREEZE", alt: "", titulo: "Parar a mira", texto: "Pede que o jogador pare momentaneamente de movimentar a mira e mantenha o ângulo ou a posição atual, sem fazer um peek ou ajuste desnecessário. Usado para preservar um ângulo e evitar entregar informação ou se expor antes da hora." },
];
export const NOTA_PADRAO = "Quero que a gente padronize essas calls para que todos entendam o que está acontecendo e reajam no mesmo timing.\n\nO objetivo é eliminar a hesitação e fazer com que nossas jogadas sejam executadas de forma sincronizada.\n\nNão queremos cinco jogadores fazendo jogadas individuais. Queremos os cinco jogadores executando a mesma jogada. :))";

export const FUNCAO_COR = { Duelista: "#f67070", Iniciador: "#54d688", Controlador: "#a068ff", Sentinela: "#f6b84c", Playmaker: "#5bb8e8" };

// ---------- Leitura (uma por equipe, guardada até alguém salvar algo) ----------
const cache = new Map();
export function esquecerPlanejamento() { cache.clear(); }
export async function lerPlanejamento(forcar = false) {
  const id = B.equipeAtual?.id;
  if (!id) throw new Error("Sem equipe selecionada.");
  if (forcar) cache.delete(id);
  if (!cache.has(id)) cache.set(id, rpc("planejamento_ler", { p_equipe: id }).catch((e) => { cache.delete(id); throw e; }));
  return cache.get(id);
}
/** Erro de "o planejamento.sql ainda não rodou no banco" */
export const faltaSql = (e) => ["PGRST202", "42883", "PGRST205", "42P01"].includes(e?.codigo) || /could not find the function|does not exist/i.test(String(e?.message || ""));
export function avisoErro(e) {
  if (faltaSql(e)) {
    return vazio("O planejamento ainda não foi ativado no banco", `<p>A administradora precisa rodar o <code>supabase/planejamento.sql</code> no SQL Editor do Supabase (uma vez). Depois é só recarregar.</p>`);
  }
  return vazio("Não deu para abrir agora", `<p class="pequeno">${esc(textoErro(e))}</p><p><button class="botao-secundario botao-mini" type="button" data-plan-recarregar>Tentar de novo</button></p>`);
}

// ---------- Membros ----------
export const membroPor = (d, uid) => (d.membros || []).find((m) => m.usuario_id === uid);
export const fotoMembro = (m, classe = "avatar") => imagem(imgCard(m?.riot_card), m?.apelido || "?", classe, m?.apelido || "?");

// ---------- Agentes e mapas da valorant-api ----------
let agentes = [];
export async function carregarAgentes() { if (!agentes.length) agentes = await agentesValorant(); return agentes; }
export const agentePor = (nome) => agentes.find((a) => a.nome.toLowerCase() === String(nome || "").toLowerCase());
export const iconeAgente = (nome, tam = 24) => {
  const a = agentePor(nome);
  return a?.icone ? `<img class="ag-ico" src="${esc(a.icone)}" alt="${esc(nome)}" title="${esc(nome)}" width="${tam}" height="${tam}" loading="lazy" decoding="async">`
    : nome ? `<span class="ag-ico ag-ico--txt" title="${esc(nome)}">${esc(nome.slice(0, 2))}</span>` : "";
};

let mapasPt = [];
export async function carregarMapas() { if (!mapasPt.length) mapasPt = await mapasValorant(); return mapasPt; }
export const mapaPor = (nome) => mapasPt.find((m) => m.nome.toLowerCase() === String(nome || "").toLowerCase());
export const imgSplash = (nome) => { const m = mapaPor(nome); return m?.uuid ? `${CDN}/maps/${m.uuid}/splash.png` : null; };
export const imgFaixa = (nome) => mapaPor(nome)?.faixa || null;

// Callouts em inglês (os nomes das posições padrão usam os nomes do jogo em inglês: "A Main", "B Site"...)
let mapasEn = null;
async function carregarMapasEn() {
  if (mapasEn) return mapasEn;
  try {
    const c = JSON.parse(localStorage.getItem("valreport.mapas-en") || "null");
    if (c && Date.now() - c.t < 7 * 864e5 && Array.isArray(c.v)) { mapasEn = c.v; return mapasEn; }
  } catch (e) { /* sem armazenamento */ }
  try {
    const j = await (await fetch("https://valorant-api.com/v1/maps")).json();
    mapasEn = (j?.data || []).filter((m) => m?.uuid && m.tacticalDescription && Number.isFinite(m.xMultiplier)).map((m) => ({
      nome: String(m.displayName), uuid: m.uuid, t: [m.xMultiplier, m.yMultiplier, m.xScalarToAdd, m.yScalarToAdd],
      callouts: (m.callouts || []).filter((c) => Number.isFinite(c?.location?.x)).map((c) => [`${c.superRegionName || ""} ${c.regionName || ""}`.trim(), c.location.x, c.location.y]),
    }));
    try { localStorage.setItem("valreport.mapas-en", JSON.stringify({ t: Date.now(), v: mapasEn })); } catch (e) { /* cheio */ }
  } catch (e) { mapasEn = []; }
  return mapasEn;
}
const norm = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
/** Ponto do callout no minimapa (0..1). Nunca troca de bombsite ("B Main" não cai em "A Main"). */
function pontoDo(mapa, lugar) {
  const m = (mapasEn || []).find((x) => x.nome.toLowerCase() === String(mapa).toLowerCase());
  if (!m || !lugar) return null;
  const q = norm(lugar);
  const conv = ([, x, y]) => ({ x: y * m.t[0] + m.t[2], y: x * m.t[1] + m.t[3] });
  const exato = m.callouts.find((c) => norm(c[0]) === q);
  if (exato) return conv(exato);
  const ps = q.split(" "), siteDe = (w) => (w.length === 1 || w === "mid" ? w : "");
  const site = siteDe(ps[0]), resto = site ? ps.slice(1) : ps;
  let melhor = null, nota = 0;
  for (const c of m.callouts) {
    const n = norm(c[0]), nw = n.split(" ");
    if (site && siteDe(nw[0]) && nw[0] !== site) continue;
    let sc = resto.filter((w) => nw.includes(w)).length * 2 + resto.filter((w) => n.includes(w)).length + (site && nw[0] === site ? 1.5 : 0);
    if (sc > nota) { nota = sc; melhor = c; }
  }
  return nota >= 2 ? conv(melhor) : null;
}
const lugaresDo = (mapa) => [...new Set(((mapasEn || []).find((x) => x.nome.toLowerCase() === String(mapa).toLowerCase())?.callouts || []).map((c) => c[0]))].sort();

/** O lugar da posição: o print da equipe (com o minimapa no canto) ou o minimapa com zoom no callout */
function miniLugar(mapa, lugar, classe = "") {
  const pt = pontoDo(mapa, lugar), mini = mapaPor(mapa)?.minimapa;
  if (!pt || !mini) return "";
  return `<span class="lugar ${classe}" style="--x:${pt.x.toFixed(4)};--y:${pt.y.toFixed(4)}"><img src="${esc(mini)}" alt="" loading="lazy" decoding="async"><i class="lugar__pino"></i></span>`;
}
export function imagemLugar(mapa, lugar, foto, { grande = false } = {}) {
  const nome = lugar ? `<span class="lugar__nome">${esc(lugar)}</span>` : "";
  if (foto) {
    return `<span class="lugar lugar--foto${grande ? " lugar--grande" : ""}"><img class="lugar__foto" src="${esc(foto)}" alt="Print de ${esc(lugar || "posição")}" loading="lazy" decoding="async">${miniLugar(mapa, lugar, "lugar--canto")}${nome}</span>`;
  }
  const mini = miniLugar(mapa, lugar, grande ? "lugar--grande" : "");
  return mini ? mini.replace("</span>", `${nome}</span>`) : `<span class="lugar lugar--vazio${grande ? " lugar--grande" : ""}">${icone("pino")}${nome}</span>`;
}

// ---------- Map pool: pontos ----------
/** Pontos de cada mapa pelos votos: 1º = N pontos … último = 1 ponto (N = mapas na pool) */
export function pontosDosVotos(pool, votos, membros) {
  const n = pool.length, pts = Object.fromEntries(pool.map((m) => [m, 0])), primeiros = Object.fromEntries(pool.map((m) => [m, 0]));
  const ids = new Set((membros || []).map((m) => m.usuario_id));
  let votantes = 0;
  for (const v of votos || []) {
    const r = v.ranking || [];
    if (!ids.has(v.usuario_id) || r.length !== n || r.some((x) => !(x in pts))) continue;   // voto de antes de trocar a pool
    votantes++;
    r.forEach((m, i) => { pts[m] += n - i; if (i === 0) primeiros[m]++; });
  }
  return { pts, primeiros, votantes };
}
/** Resultado que vale: os pontos manuais da liderança (se houver) ou os dos votos */
export function resultadoPool(d) {
  const pool = d.pool?.length ? d.pool : POOL_PADRAO;
  const votos = pontosDosVotos(pool, d.votos, d.membros);
  const manual = d.pontos_manuais && Object.keys(d.pontos_manuais).length ? d.pontos_manuais : null;
  const pts = manual ? Object.fromEntries(pool.map((m) => [m, Number(manual[m]) || 0])) : votos.pts;
  const ordem = [...pool].sort((a, b) => pts[b] - pts[a] || (votos.primeiros[b] - votos.primeiros[a]) || a.localeCompare(b));
  return { pool, pts, ordem, manual: Boolean(manual), votos };
}

// ---------- Comp: função de cada agente na comp (a mesma regra da coleta para o Playmaker) ----------
const PLAYMAKERS = { Chamber: ["Sentinela", false], Yoru: ["Duelista", true] };
export function funcaoNaComp(agente, comp) {
  const a = agentePor(agente), base = a?.funcao || "";
  const regra = PLAYMAKERS[a?.nome];
  if (!regra) return base;
  const outros = comp.filter((c) => c.agente && c.agente !== a.nome && agentePor(c.agente)?.funcao === regra[0]).length;
  return (regra[1] ? outros > 0 : outros === 0) ? "Playmaker" : base;
}
export function compDe(d, mapa) {
  const c = d.defaults?.[mapa]?.comp || [];
  return [0, 1, 2, 3, 4].map((i) => ({ agente: "", usuario: null, ...(c[i] || {}) }));
}
function posicoesDoMapa(d, mapa, lado) {
  const salvas = d.defaults?.[mapa]?.[lado] || [];
  return posicoesDe(mapa)[LADOS[lado][2]].map(([rotulo, lugar], i) => ({ rotulo, lugar, usuario: null, foto: null, ...(salvas[i] || {}),
    padrao: rotulo, lugarPadrao: lugar, ...(salvas[i]?.rotulo ? {} : { rotulo }), ...(salvas[i]?.lugar ? {} : { lugar }) }));
}
const conteudoMapa = (d, mapa) => ({ comp: compDe(d, mapa), ataque: posicoesDoMapa(d, mapa, "ataque"), defesa: posicoesDoMapa(d, mapa, "defesa") });
const limparConteudo = (c) => ({
  comp: c.comp.map(({ agente, usuario }) => ({ agente: agente || "", usuario: usuario || null })),
  ataque: c.ataque.map(({ rotulo, lugar, usuario, foto }) => ({ rotulo, lugar, usuario: usuario || null, foto: foto || null })),
  defesa: c.defesa.map(({ rotulo, lugar, usuario, foto }) => ({ rotulo, lugar, usuario: usuario || null, foto: foto || null })),
});
const agenteDoJogador = (d, mapa, uid) => (uid ? compDe(d, mapa).find((c) => c.usuario === uid && c.agente)?.agente || "" : "");
const escalados = (d, mapa) => ["ataque", "defesa"].reduce((n, l) => n + posicoesDoMapa(d, mapa, l).filter((p) => p.usuario).length, 0);

// ---------- Estado da tela ----------
const T = { mapa: null, ranking: null };

/** Moldura comum: carrega os dados e redesenha só a área do planejamento */
function montar(desenhar) {
  return {
    html: `<div class="plan" data-plan><div class="carregando" role="status"><span class="girando"></span> Carregando…</div></div>`,
    depois: async (main) => {
      const raiz = main.querySelector("[data-plan]");
      if (!raiz) return;
      const pintar = async (forcar = false) => {
        try {
          const [d] = await Promise.all([lerPlanejamento(forcar), carregarAgentes(), carregarMapas(), carregarMapasEn()]);
          await comFotos(d);
          if (!raiz.isConnected) return;
          raiz.innerHTML = desenhar(d);
          raiz._dados = d;
        } catch (e) {
          console.error(e);
          if (raiz.isConnected) raiz.innerHTML = avisoErro(e);
        }
      };
      raiz._pintar = pintar;
      raiz.addEventListener("click", (ev) => {
        if (ev.target.closest("[data-plan-recarregar]")) { pintar(true); return; }
        const b = ev.target.closest("[data-plan-acao]");
        if (b && raiz._dados && ACOES[b.dataset.planAcao]) ACOES[b.dataset.planAcao](b, raiz._dados, () => pintar(true), raiz);
      });
      ligarArrastar(raiz);
      await pintar();
    },
  };
}
async function salvar(funcao, args, ok) {
  try {
    const r = await rpc(funcao, args);
    if (ok) avisar(ok, "novo");
    return r ?? true;
  } catch (e) {
    avisar(faltaSql(e) ? "Falta rodar o supabase/planejamento.sql no banco." : textoErro(e), "erro");
    return null;
  }
}

// =====================================================================
// MAP POOL
// =====================================================================
function cartoesPool(d, r) {
  const n = r.pool.length;
  return `<div class="pool">${r.ordem.map((m, i) => {
    const ban = i === n - 1, comp = compDe(d, m).filter((c) => c.agente);
    const fundo = imgSplash(m) || imgFaixa(m);
    return `<div class="pool__mapa${ban ? " pool__mapa--ban" : ""}" style="${fundo ? `background-image:url('${esc(fundo)}')` : ""}">
      <span class="pool__n">${ban ? icone("fechar") : i + 1}</span>
      ${!ban && comp.length ? `<span class="pool__comp">${comp.map((c) => iconeAgente(c.agente, 26)).join("")}</span>` : ""}
      <strong>${esc(m)}</strong><small>${ban ? "Ban" : `${r.pts[m]} pts`}</small></div>`;
  }).join("")}</div>`;
}

function meuRanking(d, r) {
  const meu = (d.votos || []).find((v) => v.usuario_id === d.eu)?.ranking;
  const valido = meu && meu.length === r.pool.length && meu.every((x) => r.pool.includes(x));
  if (T.ranking && T.ranking.length === r.pool.length && T.ranking.every((x) => r.pool.includes(x))) return { lista: T.ranking, votou: valido };
  return { lista: valido ? [...meu] : [...r.pool], votou: valido };
}

function listaRanking(lista) {
  const n = lista.length;
  return lista.map((m, i) => {
    const fundo = imgFaixa(m);
    return `<li class="voto__item${i === n - 1 ? " voto__item--ban" : ""}" data-mapa="${esc(m)}" style="${fundo ? `--fundo-mapa:url('${esc(fundo)}')` : ""}">
      <span class="voto__alca" title="Arraste para reordenar">${icone("filtro")}</span>
      <span class="voto__n">${i === n - 1 ? icone("fechar") : i + 1}</span>
      <span class="voto__nome"><strong>${esc(m)}</strong><small>${i === n - 1 ? "Ban · 1 pt" : `${i + 1}º favorito · ${n - i} pts`}</small></span>
      <span class="voto__setas">
        <button type="button" class="botao-icone" data-plan-acao="subir" data-mapa="${esc(m)}" ${i === 0 ? "disabled" : ""} aria-label="Subir ${esc(m)}">${icone("seta-cima")}</button>
        <button type="button" class="botao-icone" data-plan-acao="descer" data-mapa="${esc(m)}" ${i === n - 1 ? "disabled" : ""} aria-label="Descer ${esc(m)}">${icone("seta-baixo")}</button>
      </span></li>`;
  }).join("");
}

function desenharPool(d) {
  const r = resultadoPool(d), edita = d.pode_editar;
  const { lista, votou } = meuRanking(d, r);
  const membros = d.membros || [];
  const votosPor = new Map((d.votos || []).map((v) => [v.usuario_id, v.ranking]));
  const n = r.pool.length;
  const faltam = membros.filter((m) => !(votosPor.get(m.usuario_id)?.length === n));
  const max = Math.max(1, ...Object.values(r.pts));
  const origem = r.manual
    ? `<p class="aviso">${icone("lapis")}<span><strong>Pontos definidos pela liderança</strong>${d.pontos_manuais_por ? ` (${esc(d.pontos_manuais_por)}, ${esc(dataHora(d.pontos_manuais_em))})` : ""}. Eles valem no lugar da votação até alguém da liderança tirar.</span></p>`
    : `<p class="suave pequeno">${r.votos.votantes} de ${membros.length} votaram · 1º lugar vale ${n} pontos, o último vale 1. Empate: ganha quem tem mais votos de 1º lugar.</p>`;
  const tabelaTime = `<div class="rolagem"><table class="tabela tabela--votos"><thead><tr><th>Ranking</th>${membros.map((m) => `<th class="${m.usuario_id === d.eu ? "eu" : ""}">${esc(m.apelido)}</th>`).join("")}</tr></thead>
    <tbody>${r.pool.map((_, i) => `<tr><td><strong>${i === n - 1 ? "Ban" : `${i + 1}º favorito`}</strong></td>${membros.map((m) => {
      const v = votosPor.get(m.usuario_id), ok = v?.length === n;
      return `<td class="${m.usuario_id === d.eu ? "eu" : ""}">${ok ? `<span class="pilula-mapa">${esc(v[i])}</span>` : `<span class="suave">—</span>`}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`;

  return `<section class="secao">
      <div class="secao__titulo"><h2>Map pool da equipe</h2>
        <span class="lp-acoes">${edita ? `<button class="botao-secundario botao-mini" type="button" data-plan-acao="editar-pontos">${icone("lapis")} ${r.manual ? "Editar pontos" : "Definir pontos"}</button>
          ${r.manual ? `<button class="botao-secundario botao-mini" type="button" data-plan-acao="tirar-pontos">Voltar para a votação</button>` : ""}
          <button class="botao-secundario botao-mini" type="button" data-plan-acao="editar-pool">${icone("mapa")} Mapas da pool</button>` : ""}</span></div>
      ${origem}
      <div style="margin-top:12px">${cartoesPool(d, r)}</div>
    </section>
    <div class="grade-2 grade-2--voto secao">
      <section class="cartao">
        <div class="cartao__titulo"><h3>Seu voto</h3>${votou ? selo(`${icone("escudo")} enviado`, "vitoria") : selo("não enviado", "alerta")}</div>
        <p class="suave pequeno">Ordene do favorito ao ban: arraste pela alça ou use as setas.${votou ? " Cada mudança salva sozinha." : ""}${r.manual ? " Enquanto houver pontos da liderança, o voto fica guardado para a próxima votação." : ""}</p>
        <ol class="voto" data-voto>${listaRanking(lista)}</ol>
        ${votou ? "" : `<div class="lp-acoes" style="margin-top:12px"><button class="botao-primario" type="button" data-plan-acao="votar">${icone("escudo")} Enviar meu voto</button></div>`}
      </section>
      <section class="cartao">
        <div class="cartao__titulo"><h3>${r.manual ? "Pontos da liderança" : "Pontos da votação"}</h3>
          ${edita && (d.votos || []).length ? `<button class="botao-secundario botao-mini" type="button" data-plan-acao="limpar-votos">Nova votação</button>` : ""}</div>
        <div class="barras-pool">${r.ordem.map((m, i) => `<div class="barras-pool__linha${i === n - 1 ? " ban" : ""}"><span>${i === n - 1 ? "Ban" : `${i + 1}º`}</span><strong>${esc(m)}</strong>
          <span class="barra"><span style="width:${((r.pts[m] / max) * 100).toFixed(1)}%"></span></span><b>${r.pts[m]}</b></div>`).join("")}</div>
        ${r.manual ? `<p class="suave pequeno" style="margin-top:10px">Pela votação seria: ${[...r.pool].sort((a, b) => r.votos.pts[b] - r.votos.pts[a]).map((m) => `${esc(m)} ${r.votos.pts[m]}`).join(" · ")}</p>` : ""}
        ${faltam.length && !r.manual ? `<p class="suave pequeno" style="margin-top:10px">Faltam votar: ${faltam.map((m) => esc(m.apelido)).join(", ")}.</p>` : ""}
      </section>
    </div>
    <section class="secao"><div class="secao__titulo"><h2>Planilha do time</h2><span class="suave pequeno">o ranking de cada um</span></div><div class="cartao">${tabelaTime}</div></section>`;
}

async function enviarRanking(lista, raiz, mensagem) {
  T.ranking = lista;
  const ok = await salvar("votar_mapas", { p_equipe: B.equipeAtual.id, p_ranking: lista }, mensagem);
  if (ok) { T.ranking = null; await raiz._pintar(true); }
}

/** Arrastar com mouse ou toque (no toque, pela alça; o resto da linha rola a página) */
function ligarArrastar(raiz) {
  let arr = null;
  raiz.addEventListener("pointerdown", (ev) => {
    const li = ev.target.closest(".voto__item");
    if (!li || ev.target.closest("button")) return;
    if (ev.pointerType !== "mouse" && !ev.target.closest(".voto__alca")) return;
    ev.preventDefault();
    arr = { li, mexeu: false };
    try { li.setPointerCapture(ev.pointerId); } catch (e) { /* ponteiro sintético */ }
    li.classList.add("arrastando");
  });
  raiz.addEventListener("pointermove", (ev) => {
    if (!arr) return;
    const lista = arr.li.parentElement, outros = [...lista.children].filter((x) => x !== arr.li);
    const depois = outros.find((x) => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
    if (depois !== arr.li.nextElementSibling) { lista.insertBefore(arr.li, depois || null); arr.mexeu = true; }
  });
  const soltar = async () => {
    if (!arr) return;
    const { li, mexeu } = arr;
    arr = null;
    li.classList.remove("arrastando");
    if (!mexeu) return;
    const lista = [...raiz.querySelectorAll(".voto__item")].map((x) => x.dataset.mapa);
    T.ranking = lista;
    raiz.querySelector("[data-voto]").innerHTML = listaRanking(lista);
    const d = raiz._dados, r = resultadoPool(d);
    if (meuRanking(d, r).votou) await enviarRanking(lista, raiz, "Voto salvo ✓");
  };
  raiz.addEventListener("pointerup", soltar);
  raiz.addEventListener("pointercancel", soltar);
}

async function editarPontos(d, recarregar) {
  const r = resultadoPool(d);
  const ordem = r.ordem;
  const res = await janela({
    titulo: "Pontos da map pool",
    corpo: `<p class="suave pequeno">Escreva os pontos de cada mapa. Eles valem no lugar da votação (o maior é o 1º pick, o menor é o ban). Para voltar a valer a votação, use “Voltar para a votação”.</p>
      <div class="pontos-campos">${ordem.map((m) => `<label class="campo"><span>${esc(m)}</span><input type="number" name="${esc(m)}" min="0" max="9999" step="1" inputmode="numeric" value="${r.pts[m]}" required></label>`).join("")}</div>`,
    acoes: [["cancelar", "Cancelar"], ["ok", "Salvar pontos", "botao-primario"]],
    antesDeFechar: (_, f) => {
      for (const m of ordem) { const v = f.elements[m].value; if (!/^\d{1,4}$/.test(v)) return `Use números inteiros de 0 a 9999 (${m}).`; }
      return "";
    },
  });
  if (res.valor !== "ok") return;
  const pontos = Object.fromEntries(ordem.map((m) => [m, Number(res.dados[m])]));
  if (await salvar("definir_pontos_manuais", { p_equipe: B.equipeAtual.id, p_pontos: pontos }, "Pontos salvos ✓")) recarregar();
}

async function editarPool(d, recarregar) {
  const todos = [...new Set([...mapasPt.map((m) => m.nome), ...POOL_PADRAO, ...(d.pool || [])])].sort((a, b) => a.localeCompare(b));
  const atual = new Set(d.pool?.length ? d.pool : POOL_PADRAO);
  const res = await janela({
    titulo: "Mapas da pool",
    corpo: `<p class="suave pequeno">Marque os mapas da pool atual (de 3 a 12). Quando a Riot muda a rotação, troque aqui. Votos de antes da troca deixam de contar; pontos da liderança de mapas que saíram somem.</p>
      <div class="pool-escolha">${todos.map((m) => `<label class="pool-escolha__op"><input type="checkbox" name="m" value="${esc(m)}"${atual.has(m) ? " checked" : ""}>
        ${imgFaixa(m) ? `<img src="${esc(imgFaixa(m))}" alt="" loading="lazy">` : ""}<span>${esc(m)}</span></label>`).join("")}</div>`,
    acoes: [["cancelar", "Cancelar"], ["ok", "Salvar pool", "botao-primario"]],
    larga: true,
    antesDeFechar: (_, f) => { const n = f.querySelectorAll("input[name=m]:checked").length; return n < 3 || n > 12 ? "Escolha de 3 a 12 mapas." : ""; },
  });
  if (res.valor !== "ok") return;
  const pool = [...res.form.querySelectorAll("input[name=m]:checked")].map((x) => x.value);
  if (await salvar("definir_pool", { p_equipe: B.equipeAtual.id, p_pool: pool }, "Pool atualizada ✓")) { T.ranking = null; recarregar(); }
}

// =====================================================================
// COMPS E DEFAULTS
// =====================================================================
function chipsMapas(d, atual, acao = "mapa") {
  const pool = d.pool?.length ? d.pool : POOL_PADRAO;
  return `<div class="chips chips--mapas" role="tablist">${pool.map((m) => {
    const c = compDe(d, m).filter((x) => x.agente).length, e = escalados(d, m);
    return `<button type="button" class="chip chip--mapa${m === atual ? " ativo" : ""}" data-plan-acao="${acao}" data-mapa="${esc(m)}" aria-pressed="${m === atual}">
      ${imgFaixa(m) ? `<img src="${esc(imgFaixa(m))}" alt="" loading="lazy">` : ""}${esc(m)}${acao === "mapa" ? `<small class="${c === 5 && e === 10 ? "completo" : ""}">${c}/5 · ${e}/10</small>` : ""}</button>`;
  }).join("")}</div>`;
}

function desenharComps(d) {
  const pool = d.pool?.length ? d.pool : POOL_PADRAO;
  if (!T.mapa || !pool.includes(T.mapa)) T.mapa = resultadoPool(d).ordem[0] || pool[0];
  const mapa = T.mapa, edita = d.pode_editar;
  const comp = compDe(d, mapa);
  const naComp = new Set(comp.map((c) => c.usuario).filter(Boolean));
  const funcoes = {};
  comp.forEach((c) => { if (c.agente) { const f = funcaoNaComp(c.agente, comp); funcoes[f] = (funcoes[f] || 0) + 1; } });
  const nComp = comp.filter((c) => c.agente).length;
  const avisos = [];
  if (nComp >= 3 && !funcoes.Controlador) avisos.push("Sem controlador: ninguém faz smoke.");
  if (nComp >= 4 && !funcoes.Iniciador) avisos.push("Sem iniciador: pouca info e pouca flash para entrar.");
  const repetidos = comp.map((c) => c.usuario).filter((u, i, a) => u && a.indexOf(u) !== i);
  if (repetidos.length) avisos.push(`${[...new Set(repetidos)].map((u) => esc(membroPor(d, u)?.apelido || "?")).join(", ")} está em duas vagas.`);

  const vagas = comp.map((c, i) => {
    const a = agentePor(c.agente), m = membroPor(d, c.usuario), fn = c.agente ? funcaoNaComp(c.agente, comp) : "";
    const dentro = `<span class="comp__retrato">${a?.icone ? `<img src="${esc(a.icone)}" alt="" loading="lazy">` : c.agente ? `<b>${esc(c.agente.slice(0, 2))}</b>` : icone("mais")}</span>
      <strong>${c.agente ? esc(c.agente) : edita ? "Escolher agente" : "Vaga livre"}</strong>
      ${fn ? `<span class="selo" style="--cor-funcao:${FUNCAO_COR[fn] || "var(--destaque)"}" data-funcao>${esc(fn)}</span>` : ""}
      <span class="comp__jogador">${m ? `${fotoMembro(m, "comp__avatar")}${esc(m.apelido)}` : c.agente ? `<span class="suave">sem jogador</span>` : ""}</span>
      ${c.usuario && c.usuario === d.eu ? `<span class="comp__voce">você</span>` : ""}`;
    const cor = FUNCAO_COR[fn] || "var(--destaque)";
    return edita ? `<button type="button" class="comp__vaga${c.agente ? "" : " vazia"}" style="--cor-funcao:${cor}" data-plan-acao="comp" data-i="${i}" aria-label="Editar vaga ${i + 1} da comp">${dentro}</button>`
      : `<div class="comp__vaga${c.agente ? "" : " vazia"}" style="--cor-funcao:${cor}">${dentro}</div>`;
  }).join("");

  const lado = (l) => {
    const ps = posicoesComUrl(d, mapa, l);
    const rep = ps.map((p) => p.usuario).filter((u, i, a) => u && a.indexOf(u) !== i);
    return `<section class="cartao lado lado--${l}">
      <div class="cartao__titulo"><h3><span class="lado__sigla">${LADOS[l][1]}</span> ${LADOS[l][0]}</h3></div>
      <div class="posicoes">${ps.map((p, i) => {
        const m = membroPor(d, p.usuario), ag = agenteDoJogador(d, mapa, p.usuario);
        const avisoP = p.usuario && rep.includes(p.usuario) ? "repetido neste lado" : p.usuario && nComp && !naComp.has(p.usuario) ? "fora da comp" : "";
        const dentro = `${imagemLugar(mapa, p.lugar, p._url)}
          <span class="posicao__nome">${esc(p.rotulo)}</span>
          <span class="posicao__jogador">${m ? `${fotoMembro(m, "comp__avatar")}<strong>${esc(m.apelido)}</strong>` : `<span class="suave">${edita ? `${icone("mais")} Escalar` : "Sem jogador"}</span>`}</span>
          ${ag ? `<span class="posicao__agente">${iconeAgente(ag, 20)}${esc(ag)}</span>` : ""}
          ${avisoP ? `<span class="selo selo--alerta">${esc(avisoP)}</span>` : ""}
          ${p.usuario && p.usuario === d.eu ? `<span class="comp__voce">você</span>` : ""}`;
        return edita ? `<button type="button" class="posicao${p.usuario ? "" : " vazia"}${avisoP ? " com-aviso" : ""}" data-plan-acao="posicao" data-lado="${l}" data-i="${i}" aria-label="Editar ${esc(p.rotulo)}">${dentro}</button>`
          : `<div class="posicao${p.usuario === d.eu && d.eu ? " minha" : ""}" ${p._url ? `data-plan-acao="ver-foto" data-lado="${l}" data-i="${i}" role="button" tabindex="0"` : ""}>${dentro}</div>`;
      }).join("")}</div></section>`;
  };

  const calloutsMapa = (mapaPor(mapa)?.callouts || []);
  const grupos = {};
  calloutsMapa.forEach(([sup, reg]) => { (grupos[sup || "Outros"] ||= new Set()).add(reg); });
  const callouts = Object.keys(grupos).length ? `<section class="secao"><div class="secao__titulo"><h2>Callouts de ${esc(mapa)}</h2><span class="suave pequeno">nomes oficiais do jogo · toque para copiar</span></div>
    <div class="grade-callouts">${Object.entries(grupos).sort((a, b) => a[0].localeCompare(b[0])).map(([g, rs]) => `<div class="cartao"><div class="cartao__titulo"><h3>${esc(g)}</h3></div>
      <div class="chips">${[...rs].sort().map((r) => `<button type="button" class="chip" data-plan-acao="copiar" data-texto="${esc(`${g} ${r}`.trim())}">${esc(r)}</button>`).join("")}</div></div>`).join("")}</div></section>` : "";

  return `${chipsMapas(d, mapa)}
    <section class="secao">
      <div class="secao__titulo"><h2>Comp · ${esc(mapa)}</h2><span class="suave pequeno">${nComp}/5 agentes${Object.keys(funcoes).length ? ` · ${Object.entries(funcoes).map(([f, n]) => `${n} ${f}`).join(" · ")}` : ""}</span></div>
      <div class="comp">${vagas}</div>
      ${avisos.length ? `<p class="aviso aviso--alerta" style="margin-top:10px">${icone("info")}<span>${avisos.join(" ")}</span></p>` : ""}
      ${edita ? `<p class="suave pequeno" style="margin-top:8px">Monte a comp primeiro: o agente de cada posição vem dela (no Valorant ele é o mesmo no ataque e na defesa). Chamber sem outro sentinela e Yoru com outro duelista contam como Playmaker.</p>` : ""}
    </section>
    <div class="grade-2 secao">${lado("ataque")}${lado("defesa")}</div>
    ${edita ? `<p class="lp-acoes" style="margin-top:10px"><button class="botao-secundario botao-mini" type="button" data-plan-acao="restaurar">Restaurar nomes e lugares das posições</button></p>` : ""}
    ${callouts}`;
}

/** Endereços temporários dos prints (balde privado), antes de desenhar */
async function comFotos(d) {
  const caminhos = [];
  for (const mapa of Object.keys(d.defaults || {})) for (const l of ["ataque", "defesa"]) for (const p of d.defaults[mapa][l] || []) if (p?.foto) caminhos.push(p.foto);
  let urls = {};
  if (caminhos.length) { try { urls = await assinar(BALDE_PLAN, caminhos); } catch (e) { urls = {}; } }
  d._urls = urls;
  return d;
}
// As posições com o endereço temporário do print em p._url
function posicoesComUrl(d, mapa, lado) { return posicoesDoMapa(d, mapa, lado).map((p) => ({ ...p, _url: p.foto ? d._urls?.[p.foto] || null : null })); }

async function editarComp(d, i, recarregar) {
  const mapa = T.mapa, c = conteudoMapa(d, mapa), atual = { ...c.comp[i] };
  const usados = Object.fromEntries(c.comp.map((x, j) => [x.agente, j]).filter(([a, j]) => a && j !== i));
  const funcoesApi = [...new Set(agentes.map((a) => a.funcao).filter(Boolean))];
  const res = await janela({
    titulo: `${esc(mapa)} · comp · vaga ${i + 1}`,
    larga: true,
    corpo: `<fieldset class="campo"><legend>Jogador</legend><div class="escolhas escolhas--jogadores">
        <button type="button" class="escolha${atual.usuario ? "" : " ativa"}" data-jogador="">${icone("fechar")}<span>Ninguém</span></button>
        ${(d.membros || []).map((m) => `<button type="button" class="escolha${atual.usuario === m.usuario_id ? " ativa" : ""}" data-jogador="${esc(m.usuario_id)}" data-mains="${esc((m.agentes || []).join(","))}">
          ${fotoMembro(m, "comp__avatar")}<span>${esc(m.apelido)}</span>${(m.agentes || []).length ? `<span class="escolha__mains">${(m.agentes || []).slice(0, 3).map((a) => iconeAgente(a, 18)).join("")}</span>` : ""}</button>`).join("")}</div></fieldset>
      <fieldset class="campo"><legend>Agente <small class="suave">· estrela = agente favorito do jogador escolhido</small></legend>
        <div class="segmentos" role="group">${["Todos", ...funcoesApi].map((f, k) => `<button type="button" aria-pressed="${k === 0}" data-funcao-filtro="${k === 0 ? "" : esc(f)}">${esc(f)}</button>`).join("")}</div>
        <div class="escolhas escolhas--agentes">
          <button type="button" class="escolha escolha--agente${atual.agente ? "" : " ativa"}" data-agente="">${icone("fechar")}<span>Nenhum</span></button>
          ${agentes.map((a) => { const usado = a.nome in usados; const fav = (membroPor(d, atual.usuario)?.agentes || []).includes(a.nome);
            return `<button type="button" class="escolha escolha--agente${atual.agente === a.nome ? " ativa" : ""}${fav ? " favorito" : ""}" data-agente="${esc(a.nome)}" data-f="${esc(a.funcao)}" style="--cor-funcao:${FUNCAO_COR[a.funcao] || "var(--destaque)"}" ${usado ? `disabled title="Já está na vaga ${usados[a.nome] + 1}"` : ""}>
              ${a.icone ? `<img src="${esc(a.icone)}" alt="" loading="lazy">` : ""}<span>${esc(a.nome)}</span>${usado ? `<small>na comp</small>` : ""}</button>`; }).join("")}
        </div></fieldset>`,
    acoes: [["cancelar", "Cancelar"], ["ok", "Salvar", "botao-primario"]],
    aoAbrir: (f) => f.addEventListener("click", (ev) => {
      const j = ev.target.closest("[data-jogador]"), a = ev.target.closest("[data-agente]"), fl = ev.target.closest("[data-funcao-filtro]");
      if (j) {
        atual.usuario = j.dataset.jogador || null;
        f.querySelectorAll("[data-jogador]").forEach((x) => x.classList.toggle("ativa", x === j));
        const mains = (j.dataset.mains || "").split(",").filter(Boolean);
        f.querySelectorAll("[data-agente]").forEach((x) => x.classList.toggle("favorito", mains.includes(x.dataset.agente)));
      }
      if (a && !a.disabled) { atual.agente = a.dataset.agente; f.querySelectorAll("[data-agente]").forEach((x) => x.classList.toggle("ativa", x === a)); }
      if (fl) { f.querySelectorAll("[data-funcao-filtro]").forEach((x) => x.setAttribute("aria-pressed", String(x === fl))); f.querySelectorAll("[data-f]").forEach((x) => { x.hidden = Boolean(fl.dataset.funcaoFiltro) && x.dataset.f !== fl.dataset.funcaoFiltro; }); }
    }),
  });
  if (res.valor !== "ok") return;
  if (atual.usuario) c.comp.forEach((x, j) => { if (j !== i && x.usuario === atual.usuario) x.usuario = null; });   // a mesma pessoa não fica em duas vagas
  c.comp[i] = atual;
  if (await salvar("salvar_default_mapa", { p_equipe: B.equipeAtual.id, p_mapa: mapa, p_conteudo: limparConteudo(c) }, atual.agente ? `${atual.agente} na comp de ${mapa} ✓` : "Comp salva ✓")) recarregar();
}

/** Reduz o print para 960×540 (WebP) antes de enviar */
async function reduzirPrint(arquivo) {
  if (!arquivo?.type?.startsWith("image/")) throw new Error("Escolha uma imagem (PNG, JPEG ou WebP).");
  if (arquivo.size > 20e6) throw new Error("Imagem grande demais (máximo 20 MB).");
  const bmp = await createImageBitmap(arquivo).catch(() => { throw new Error("Não consegui ler essa imagem."); });
  const W = 960, H = 540, esc_ = Math.max(W / bmp.width, H / bmp.height), sw = W / esc_, sh = H / esc_;
  const tela = document.createElement("canvas");
  tela.width = W; tela.height = H;
  tela.getContext("2d").drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, W, H);
  const webp = await new Promise((r) => tela.toBlob(r, "image/webp", 0.85));
  return webp?.type === "image/webp" ? webp : new Promise((r) => tela.toBlob(r, "image/png"));
}
const nomeAleatorio = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

async function editarPosicao(d, lado, i, recarregar) {
  const mapa = T.mapa, c = conteudoMapa(d, mapa), p = { ...c[lado][i] };
  const original = p.foto || null, enviados = [];
  let urlFoto = p.foto ? d._urls?.[p.foto] || null : null;
  const lugares = lugaresDo(mapa);
  const linhaAgente = (uid) => {
    if (!uid) return `<span class="suave">Escolha um jogador.</span>`;
    const ag = agenteDoJogador(d, mapa, uid);
    return ag ? `Agente neste mapa: <span class="posicao__agente">${iconeAgente(ag, 20)}${esc(ag)}</span>` : `<span class="selo selo--alerta">fora da comp de ${esc(mapa)}</span> <span class="suave pequeno">Adicione na comp para mostrar o agente.</span>`;
  };
  const tomadas = Object.fromEntries(c[lado].map((x, j) => [x.usuario, j]).filter(([u, j]) => u && j !== i));
  const res = await janela({
    titulo: `${esc(mapa)} · ${LADOS[lado][1]} · posição ${i + 1}`,
    larga: true,
    corpo: `<div class="posicao-editor">
        <div class="pilha-form">
          <label class="campo"><span>Nome da posição</span><input name="rotulo" maxlength="40" value="${esc(p.rotulo)}"><small>Padrão: ${esc(p.padrao)}</small></label>
          <label class="campo"><span>Lugar no mapa</span><input name="lugar" maxlength="40" value="${esc(p.lugar)}" list="lugares-plan" autocomplete="off"><small>Callout oficial do jogo. Padrão: ${esc(p.lugarPadrao || "—")}</small></label>
          <datalist id="lugares-plan">${lugares.map((l) => `<option value="${esc(l)}">`).join("")}</datalist>
        </div>
        <div class="foto-lugar" data-foto tabindex="0" aria-label="Print do lugar: cole com Ctrl+V ou arraste a imagem">
          <div data-previa>${imagemLugar(mapa, p.lugar, urlFoto, { grande: true })}</div>
          <div class="lp-acoes"><label class="botao-secundario botao-mini">${icone("imagem")} <span data-foto-rotulo>${p.foto ? "Trocar print" : "Enviar print"}</span><input type="file" accept="image/png,image/jpeg,image/webp" hidden data-foto-arquivo></label>
            <button type="button" class="botao-secundario botao-mini" data-foto-tirar ${p.foto ? "" : "hidden"}>Tirar print</button></div>
          <small class="suave">Tire um print no jogo e <strong>cole aqui com Ctrl+V</strong>, ou arraste a imagem. Sem print, aparece o minimapa com o lugar marcado.</small>
        </div>
      </div>
      <fieldset class="campo"><legend>Jogador</legend><div class="escolhas escolhas--jogadores">
        <button type="button" class="escolha${p.usuario ? "" : " ativa"}" data-jogador="">${icone("fechar")}<span>Ninguém</span></button>
        ${(d.membros || []).map((m) => { const ag = agenteDoJogador(d, mapa, m.usuario_id); return `<button type="button" class="escolha${p.usuario === m.usuario_id ? " ativa" : ""}" data-jogador="${esc(m.usuario_id)}">
          ${fotoMembro(m, "comp__avatar")}<span>${esc(m.apelido)}</span>${ag ? `<span class="escolha__mains">${iconeAgente(ag, 18)}</span>` : ""}${m.usuario_id in tomadas ? `<small>já em ${esc(c[lado][tomadas[m.usuario_id]].rotulo)}</small>` : ""}</button>`; }).join("")}</div>
        <p class="linha-agente" data-linha-agente>${linhaAgente(p.usuario)}</p></fieldset>`,
    acoes: [["cancelar", "Cancelar"], ["ok", "Salvar", "botao-primario"]],
    aoAbrir: (f) => {
      const previa = () => {
        f.querySelector("[data-previa]").innerHTML = imagemLugar(mapa, f.elements.lugar.value.trim(), urlFoto, { grande: true });
        f.querySelector("[data-foto-tirar]").hidden = !p.foto;
        f.querySelector("[data-foto-rotulo]").textContent = p.foto ? "Trocar print" : "Enviar print";
      };
      const receber = async (arquivo) => {
        if (!arquivo) return;
        const caixa = f.querySelector("[data-foto]");
        caixa.classList.add("enviando");
        try {
          const blob = await reduzirPrint(arquivo);
          const caminho = `${B.equipeAtual.id}/${nomeAleatorio()}.${blob.type === "image/webp" ? "webp" : "png"}`;
          await enviarArquivo(BALDE_PLAN, caminho, blob);
          enviados.push(caminho);
          p.foto = caminho;
          urlFoto = URL.createObjectURL(blob);
          previa();
        } catch (e) { mostrarErro(f, textoErro(e)); }
        finally { caixa.classList.remove("enviando"); }
      };
      f.elements.lugar.addEventListener("input", previa);
      f.querySelector("[data-foto-arquivo]").addEventListener("change", (ev) => { receber(ev.target.files[0]); ev.target.value = ""; });
      f.querySelector("[data-foto-tirar]").addEventListener("click", () => { p.foto = null; urlFoto = null; previa(); });
      f.addEventListener("paste", (ev) => { const a = [...(ev.clipboardData?.files || [])].find((x) => x.type.startsWith("image/")); if (a) { ev.preventDefault(); receber(a); } });
      const caixa = f.querySelector("[data-foto]");
      caixa.addEventListener("dragover", (ev) => { ev.preventDefault(); caixa.classList.add("sobre"); });
      caixa.addEventListener("dragleave", () => caixa.classList.remove("sobre"));
      caixa.addEventListener("drop", (ev) => { ev.preventDefault(); caixa.classList.remove("sobre"); receber([...ev.dataTransfer.files].find((x) => x.type.startsWith("image/"))); });
      f.addEventListener("click", (ev) => {
        const j = ev.target.closest("[data-jogador]");
        if (!j) return;
        p.usuario = j.dataset.jogador || null;
        f.querySelectorAll("[data-jogador]").forEach((x) => x.classList.toggle("ativa", x === j));
        f.querySelector("[data-linha-agente]").innerHTML = linhaAgente(p.usuario);
      });
    },
  });
  const descartar = (lista) => lista.forEach((cam) => apagarArquivo(BALDE_PLAN, cam).catch(() => null));
  if (res.valor !== "ok") { descartar(enviados); return; }
  p.rotulo = res.dados.rotulo?.trim() || p.padrao;
  p.lugar = res.dados.lugar?.trim() || p.lugarPadrao;
  c[lado][i] = p;
  if (await salvar("salvar_default_mapa", { p_equipe: B.equipeAtual.id, p_mapa: mapa, p_conteudo: limparConteudo(c) }, "Posição salva ✓")) {
    descartar(enviados.filter((cam) => cam !== p.foto));
    if (original && original !== p.foto) descartar([original]);
    recarregar();
  } else descartar(enviados);
}

// =====================================================================
// CALLS
// =====================================================================
const callsDe = (d) => (d.calls?.lista ? d.calls : { lista: CALLS_PADRAO, nota: NOTA_PADRAO });
function callsParaDiscord(calls) {
  return `**Guia de Calls Básicas**\n\n${calls.lista.map((c, i) => `${i + 1}- \`${c.codigo}\`${c.alt ? ` ou \`${c.alt}\`` : ""} = ${c.titulo}: ${c.texto}`).join("\n\n")}${calls.nota ? `\n\n@everyone ${calls.nota}` : ""}`;
}
let rascunhoCalls = null;
function desenharCalls(d) {
  const edita = d.pode_editar;
  if (rascunhoCalls) {
    const c = rascunhoCalls;
    return `<section class="secao"><div class="secao__titulo"><h2>Editar calls</h2>
        <span class="lp-acoes"><button class="botao-secundario botao-mini" type="button" data-plan-acao="calls-cancelar">Cancelar</button>
          <button class="botao-primario botao-mini" type="button" data-plan-acao="calls-salvar">Salvar calls</button></span></div>
      <label class="campo"><span>Mensagem para a equipe (@everyone)</span><textarea rows="5" maxlength="1500" data-call-campo="nota">${esc(c.nota || "")}</textarea></label>
      <div class="calls-editar">${c.lista.map((x, i) => `<div class="cartao call-editar">
        <div class="cartao__titulo"><h3>Call ${i + 1}</h3><span class="lp-acoes">
          <button type="button" class="botao-icone" data-plan-acao="call-subir" data-i="${i}" ${i === 0 ? "disabled" : ""} aria-label="Subir">${icone("seta-cima")}</button>
          <button type="button" class="botao-icone" data-plan-acao="call-descer" data-i="${i}" ${i === c.lista.length - 1 ? "disabled" : ""} aria-label="Descer">${icone("seta-baixo")}</button>
          <button type="button" class="botao-icone" data-plan-acao="call-tirar" data-i="${i}" aria-label="Remover">${icone("fechar")}</button></span></div>
        <div class="grade-3">
          <label class="campo"><span>Call</span><input maxlength="20" value="${esc(x.codigo)}" data-call-campo="${i}.codigo"></label>
          <label class="campo"><span>Variação <small class="suave">(opcional)</small></span><input maxlength="20" value="${esc(x.alt || "")}" data-call-campo="${i}.alt"></label>
          <label class="campo"><span>Significado</span><input maxlength="60" value="${esc(x.titulo)}" data-call-campo="${i}.titulo"></label></div>
        <label class="campo" style="margin-top:8px"><span>Explicação</span><textarea rows="2" maxlength="600" data-call-campo="${i}.texto">${esc(x.texto)}</textarea></label></div>`).join("")}
        <button type="button" class="botao-secundario" data-plan-acao="call-nova">${icone("mais")} Adicionar call</button></div></section>`;
  }
  const c = callsDe(d);
  return `<section class="secao"><div class="secao__titulo"><h2>Guia de calls básicas</h2>
      <span class="lp-acoes"><button class="botao-secundario botao-mini" type="button" data-plan-acao="calls-discord">${icone("link")} Copiar para o Discord</button>
        ${edita ? `<button class="botao-primario botao-mini" type="button" data-plan-acao="calls-editar">${icone("lapis")} Editar</button>` : ""}</span></div>
    ${c.nota ? `<blockquote class="cartao calls-nota"><span class="selo selo--destaque">@everyone</span>${c.nota.split(/\n{2,}/).map((t) => `<p>${esc(t)}</p>`).join("")}</blockquote>` : ""}
    <ol class="calls">${c.lista.map((x, i) => `<li class="cartao call"><div class="call__topo"><span class="call__n">${i + 1}</span><code class="call__codigo">${esc(x.codigo)}</code>${x.alt ? `<span class="suave">ou</span><code class="call__codigo call__codigo--alt">${esc(x.alt)}</code>` : ""}</div>
      <h3>${esc(x.titulo)}</h3><p>${esc(x.texto)}</p></li>`).join("")}</ol></section>`;
}

// =====================================================================
// Ações (cliques)
// =====================================================================
const ACOES = {
  // map pool
  subir: (b, d, _, raiz) => mover(b, -1, d, raiz),
  descer: (b, d, _, raiz) => mover(b, 1, d, raiz),
  votar: async (b, d, recarregar, raiz) => { b.disabled = true; await enviarRanking([...raiz.querySelectorAll(".voto__item")].map((x) => x.dataset.mapa), raiz, "Voto enviado ✓"); },
  "editar-pontos": (_, d, recarregar) => editarPontos(d, recarregar),
  "tirar-pontos": async (_, d, recarregar) => {
    if (!await confirmar("Voltar para a votação?", "Os pontos da liderança saem e a map pool volta a seguir os votos da equipe.", "Voltar para a votação")) return;
    if (await salvar("definir_pontos_manuais", { p_equipe: B.equipeAtual.id, p_pontos: null }, "Agora vale a votação ✓")) recarregar();
  },
  "limpar-votos": async (_, d, recarregar) => {
    if (!await confirmar("Começar uma votação nova?", "Os votos de todo mundo são apagados e cada um ordena os mapas de novo.", "Apagar votos", true)) return;
    if (await salvar("limpar_votos_mapas", { p_equipe: B.equipeAtual.id }, "Votação nova aberta ✓") !== null) { T.ranking = null; recarregar(); }
  },
  "editar-pool": (_, d, recarregar) => editarPool(d, recarregar),
  // comps
  mapa: (b, d, _, raiz) => { T.mapa = b.dataset.mapa; raiz._pintar(); },
  comp: (b, d, recarregar) => editarComp(d, Number(b.dataset.i), recarregar),
  posicao: (b, d, recarregar) => editarPosicao(d, b.dataset.lado, Number(b.dataset.i), recarregar),
  "ver-foto": async (b, d) => {
    const p = posicoesComUrl(d, T.mapa, b.dataset.lado)[Number(b.dataset.i)];
    if (p?._url) await janela({ titulo: `${esc(p.rotulo)} · ${esc(T.mapa)}`, larga: true, corpo: `<img class="foto-cheia" src="${esc(p._url)}" alt="Print de ${esc(p.lugar)}">`, acoes: [["ok", "Fechar", "botao-primario"]] });
  },
  restaurar: async (_, d, recarregar) => {
    if (!await confirmar("Restaurar posições?", `Os nomes e os lugares das posições de ${esc(T.mapa)} voltam para o padrão. Jogadores, prints e a comp continuam.`, "Restaurar")) return;
    const c = conteudoMapa(d, T.mapa);
    for (const l of ["ataque", "defesa"]) c[l].forEach((p) => { p.rotulo = p.padrao; p.lugar = p.lugarPadrao; });
    if (await salvar("salvar_default_mapa", { p_equipe: B.equipeAtual.id, p_mapa: T.mapa, p_conteudo: limparConteudo(c) }, "Posições restauradas ✓")) recarregar();
  },
  copiar: async (b) => { try { await navigator.clipboard.writeText(b.dataset.texto); avisar(`“${b.dataset.texto}” copiado`); } catch (e) { avisar("Não consegui copiar.", "erro"); } },
  // calls
  "calls-discord": async (_, d) => { try { await navigator.clipboard.writeText(callsParaDiscord(callsDe(d))); avisar("Guia copiado! Cole no Discord.", "novo"); } catch (e) { avisar("Não consegui copiar.", "erro"); } },
  "calls-editar": (_, d, __, raiz) => { rascunhoCalls = JSON.parse(JSON.stringify(callsDe(d))); raiz._pintar(); },
  "calls-cancelar": (_, d, __, raiz) => { rascunhoCalls = null; raiz._pintar(); },
  "call-nova": (_, d, __, raiz) => { lerCampos(raiz); rascunhoCalls.lista.push({ codigo: "", alt: "", titulo: "", texto: "" }); raiz._pintar(); },
  "call-tirar": (b, d, __, raiz) => { lerCampos(raiz); rascunhoCalls.lista.splice(Number(b.dataset.i), 1); raiz._pintar(); },
  "call-subir": (b, d, __, raiz) => trocarCall(raiz, Number(b.dataset.i), -1),
  "call-descer": (b, d, __, raiz) => trocarCall(raiz, Number(b.dataset.i), 1),
  "calls-salvar": async (b, d, recarregar, raiz) => {
    lerCampos(raiz);
    b.disabled = true;
    const ok = await salvar("salvar_calls", { p_equipe: B.equipeAtual.id, p_calls: { lista: rascunhoCalls.lista.filter((c) => c.codigo.trim()), nota: rascunhoCalls.nota || "" } }, "Calls salvas ✓");
    b.disabled = false;
    if (ok) { rascunhoCalls = null; recarregar(); }
  },
};
function mover(b, passo, d, raiz) {
  const r = resultadoPool(d), lista = [...meuRanking(d, r).lista];
  const i = lista.indexOf(b.dataset.mapa), j = i + passo;
  if (j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  T.ranking = lista;
  raiz.querySelector("[data-voto]").innerHTML = listaRanking(lista);
  raiz.querySelector(`[data-plan-acao="${passo < 0 ? "subir" : "descer"}"][data-mapa="${CSS.escape(b.dataset.mapa)}"]`)?.focus();
  if (meuRanking(d, r).votou) enviarRanking(lista, raiz, "Voto salvo ✓");
}
function lerCampos(raiz) {
  raiz.querySelectorAll("[data-call-campo]").forEach((el) => {
    const k = el.dataset.callCampo;
    if (k === "nota") rascunhoCalls.nota = el.value;
    else { const [i, campo] = k.split("."); if (rascunhoCalls.lista[i]) rascunhoCalls.lista[i][campo] = el.value; }
  });
}
function trocarCall(raiz, i, passo) {
  lerCampos(raiz);
  const l = rascunhoCalls.lista, j = i + passo;
  if (j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]];
  raiz._pintar();
}

// =====================================================================
// Telas (Equipe → Map pool · Comps · Calls)
// =====================================================================
export const viewMapPool = () => montar((d) => desenharPool(d));
export const viewComps = () => montar((d) => desenharComps(d));
export const viewCalls = () => { rascunhoCalls = null; return montar((d) => desenharCalls(d)); };

// =====================================================================
// Partidas fora das estatísticas (v25)
// =====================================================================
/** Lista da equipe (B.excluidas = Set "partida|slug"); o site já tira das contas na hora, a coleta tira de tudo */
export async function carregarExcluidas() {
  B.excluidas = new Set();
  B.excluidasLista = [];
  if (B.editor || !B.equipeAtual?.id) return;
  try {
    const lista = await rpc("partidas_excluidas_listar", { p_equipe: B.equipeAtual.id });
    B.excluidasLista = Array.isArray(lista) ? lista : [];
    B.excluidas = new Set(B.excluidasLista.map((x) => `${x.partida}|${x.slug}`));
  } catch (e) { /* sem o planejamento.sql: nada fica fora */ }
}
export const estaExcluida = (partida, slug) => Boolean(B.excluidas?.has(`${partida}|${slug}`));

export async function alternarExclusao(partida, slug, excluir, resumo = {}) {
  let motivo = "";
  if (excluir) {
    const nome = B.porSlug.get(slug)?.apelido || slug;
    const r = await janela({
      titulo: `Tirar a partida das contas de ${esc(nome)}?`,
      corpo: `<p>A partida deixa de contar para ${esc(nome)} em tudo: K/D, Índice NokyLabs, atributos, recordes, mapa de calor, formações e report. Para os outros jogadores ela continua valendo.</p>
        <label class="campo" style="margin-top:12px"><span>Motivo <small class="suave">(opcional, a equipe vê)</small></span>
          <input name="motivo" maxlength="140" placeholder="Ex.: outra pessoa jogou na conta, jogou passando mal…"></label>
        <p class="suave pequeno" style="margin-top:8px">No site muda na hora; o Índice e os atributos são refeitos na próxima coleta (em até 20 minutos). Dá para voltar a contar quando quiser.</p>`,
      acoes: [["cancelar", "Cancelar"], ["ok", "Tirar das contas", "botao-perigo"]],
    });
    if (r.valor !== "ok") return false;
    motivo = (r.dados.motivo || "").trim();
  }
  try {
    await rpc("excluir_partida", { p_equipe: B.equipeAtual.id, p_partida: partida, p_slug: slug, p_excluir: excluir, p_motivo: motivo, p_resumo: resumo });
    await carregarExcluidas();
    avisar(excluir ? "Partida fora das contas ✓" : "A partida volta a contar ✓", "novo");
    return true;
  } catch (e) {
    avisar(faltaSql(e) ? "Falta rodar o supabase/planejamento.sql no banco." : textoErro(e), "erro");
    return false;
  }
}

/** Cartão no placar da partida: quem conta e quem não conta (a liderança muda) */
export function cartaoExclusoes(p) {
  if (!p || B.editor || !B.equipeAtual) return "";
  const slugs = Object.keys(p.m || {});
  const fora = slugs.filter((s) => estaExcluida(p.id, s));
  const edita = podeEditarPlanejamento();
  if (!edita && !fora.length) return "";
  return `<section class="cartao secao exclusoes" data-exclusoes="${esc(p.id)}">
    <div class="cartao__titulo"><h3>Contar nas estatísticas</h3></div>
    ${slugs.map((s) => {
      const e = B.porSlug.get(s), x = estaExcluida(p.id, s), info = (B.excluidasLista || []).find((y) => y.partida === p.id && y.slug === s);
      return `<div class="exclusoes__linha"><span><strong>${esc(e?.apelido || s)}</strong>${x ? ` ${selo("fora das contas", "alerta")}${info?.motivo ? ` <span class="suave pequeno">· ${esc(info.motivo)}</span>` : ""}` : ` <span class="suave pequeno">conta normalmente</span>`}</span>
        ${edita ? `<button type="button" class="botao-secundario botao-mini" data-excluir="${esc(s)}" data-valor="${x ? "0" : "1"}">${x ? "Voltar a contar" : "Tirar das contas"}</button>` : ""}</div>`;
    }).join("")}
    ${edita ? `<p class="suave pequeno" style="margin-top:8px">Use quando outra pessoa jogou na conta ou a partida não representa o jogador (passando mal, teste…).</p>` : ""}
  </section>`;
}
export function ligarExclusoes(el, aoMudar) {
  el.querySelectorAll("[data-exclusoes]").forEach((caixa) => caixa.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-excluir]");
    if (!b) return;
    const partida = caixa.dataset.exclusoes, slug = b.dataset.excluir, p = B.porId.get(partida);
    const m = p?.m?.[slug];
    b.disabled = true;
    const ok = await alternarExclusao(partida, slug, b.dataset.valor === "1", p ? { mapa: p.mapa, t: p.t, agente: m?.ag, kda: m ? `${m.k}/${m.d}/${m.a}` : "" } : {});
    b.disabled = false;
    if (ok) aoMudar?.();
  }));
}
/** Na aba Partidas do jogador: as partidas que estão fora das contas dele */
export function listaExcluidasDe(slug) {
  const lista = (B.excluidasLista || []).filter((x) => x.slug === slug);
  if (!lista.length) return "";
  const edita = podeEditarPlanejamento();
  return `<section class="cartao secao exclusoes" data-exclusoes-jogador>
    <div class="cartao__titulo"><h3>Fora das estatísticas · ${lista.length}</h3></div>
    ${lista.map((x) => `<div class="exclusoes__linha"><span><a href="#/p/${esc(x.partida)}"><strong>${esc(x.resumo?.mapa || "Partida")}</strong></a>
        <span class="suave pequeno">${x.resumo?.t ? ` · ${esc(dataHora(x.resumo.t))}` : ""}${x.resumo?.agente ? ` · ${esc(x.resumo.agente)}` : ""}${x.resumo?.kda ? ` · ${esc(x.resumo.kda)}` : ""}${x.motivo ? ` · ${esc(x.motivo)}` : ""}${x.por ? ` · por ${esc(x.por)}` : ""}</span></span>
      ${edita ? `<button type="button" class="botao-secundario botao-mini" data-voltar-contar="${esc(x.partida)}">Voltar a contar</button>` : ""}</div>`).join("")}
  </section>`;
}
export function ligarExcluidasJogador(el, slug, aoMudar) {
  el.querySelector("[data-exclusoes-jogador]")?.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-voltar-contar]");
    if (!b) return;
    b.disabled = true;
    if (await alternarExclusao(b.dataset.voltarContar, slug, false)) aoMudar?.();
    else b.disabled = false;
  });
}
