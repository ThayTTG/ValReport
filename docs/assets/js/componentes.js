// Componentes compartilhados: barra de filtros, linha de partida, tabela ordenável, agrupamento por dia

import { esc, num, pct, sinal, imagem, imgAgente, imgMapaFaixa, imgCard, nomeFila, hora, diaLongo, classeSinal, icone, selo, md } from "./util.js";
import { B, PERIODOS, FILTROS_PADRAO, opcoes, porDia, stats } from "./dados.js";

// ---------- Filtros ----------
export function barraFiltros(f, slug, { mostrar = ["fila", "temporada", "periodo", "mapa", "agente", "com"] } = {}) {
  const op = opcoes(slug);
  const sel = (nome, rotulo, itens) => {
    if (!mostrar.includes(nome)) return "";
    const ligado = f[nome] !== FILTROS_PADRAO[nome];
    return `<label class="filtro"><span class="sr">${esc(rotulo)}</span>
      <select data-filtro="${nome}" class="${ligado ? "ligado" : ""}">
        ${itens.map(([v, t]) => `<option value="${esc(v)}" ${String(f[nome]) === String(v) ? "selected" : ""}>${esc(t)}</option>`).join("")}
      </select></label>`;
  };
  const membros = B.equipe.filter((e) => e.slug !== slug && op.com.includes(e.slug));
  const algumLigado = Object.keys(FILTROS_PADRAO).some((k) => mostrar.includes(k) && f[k] !== FILTROS_PADRAO[k]);
  return `<div class="filtros" role="group" aria-label="Filtros">
    ${icone("filtro", "filtros__icone")}
    ${sel("fila", "Fila", [["todas", "Todas as filas"], ...op.filas.map((x) => [x, nomeFila(x)])])}
    ${Object.keys(B.meta.temporadas || {}).length > 1 ? sel("temporada", "Temporada", [["todas", "Todas as temporadas"], ...Object.keys(B.meta.temporadas).sort().reverse().map((t) => [t, `Temporada ${t.toUpperCase()}`])]) : ""}
    ${sel("periodo", "Período", Object.entries(PERIODOS).map(([v, t]) => [v, t]))}
    ${sel("mapa", "Mapa", [["todos", "Todos os mapas"], ...op.mapas.map((x) => [x, x])])}
    ${sel("agente", "Agente", [["todos", "Todos os agentes"], ...op.agentes.map((x) => [x, x])])}
    ${slug ? sel("com", "Com quem", [["todos", "Com qualquer um"], ["sozinho", "Sem a equipe"], ["equipe", "Com a equipe"], ...membros.map((e) => [e.slug, `Com ${e.apelido}`])]) : ""}
    ${algumLigado ? `<button class="limpar" type="button" data-limpar-filtros>Limpar</button>` : ""}
  </div>`;
}

// ---------- Notas da IGL ----------
/** Mostra a nota; no editor local (editar_notas.bat) vira um campo para escrever */
export function blocoNota(tipo, id, texto, { n = null, titulo = "Nota da IGL", vazio = "" } = {}) {
  const chave = [tipo, id, n ?? ""].join("|");
  if (B.editor) {
    return `<div class="nota nota--editor" data-nota="${esc(chave)}">
      <div class="nota__topo">${icone("nota")}<strong>${esc(titulo)}</strong><span class="suave pequeno">vai para o site público</span></div>
      <textarea rows="${tipo === "round" ? 3 : 6}" placeholder="Escreva aqui. Dá para usar **negrito**, *itálico* e listas começando com - ">${esc(texto || "")}</textarea>
      <div class="nota__acoes"><button class="botao" type="button" data-salvar-nota="${esc(chave)}">Salvar</button><span class="nota__status pequeno" aria-live="polite"></span></div>
    </div>`;
  }
  if (!texto) return vazio;
  return `<div class="nota"><div class="nota__topo">${icone("nota")}<strong>${esc(titulo)}</strong></div><div class="nota__texto">${md(texto)}</div></div>`;
}
// ---------- Tipo de round (economia) no mapa de calor ----------
export const TIPO_COD = { pistol: 0, eco: 1, force: 2, armado: 3, "anti-eco": 4 };
export function segmentoTipoRound(sel) {
  return `<div class="segmentos segmentos--rolar" role="group" aria-label="Tipo de round" style="margin-top:8px">${[["todos", "Todos os rounds"], ["pistol", "Pistol"], ["eco", "Eco"], ["force", "Force"], ["armado", "Armado"], ["anti-eco", "Anti-eco"]].map(([k, t]) =>
    `<button type="button" data-param="tr" data-valor="${k}" aria-pressed="${k === sel}">${t}</button>`).join("")}</div>`;
}
export const lerTipoRound = (q) => (q.get("tr") in TIPO_COD ? q.get("tr") : "todos");

/** ▲/▼ comparado com a semana anterior */
export function delta(atual, anterior, casas = 1, sufixo = "", { inverso = false } = {}) {
  if (atual == null || anterior == null) return "";
  const d = atual - anterior;
  if (Math.abs(d) < 10 ** -casas / 2) return `<small class="delta">=</small>`;
  const bom = inverso ? d < 0 : d > 0;
  return `<small class="delta ${bom ? "bom" : "ruim"}" title="Semana anterior: ${num(anterior, casas)}${sufixo}">${d > 0 ? "▲" : "▼"} ${num(Math.abs(d), casas)}${sufixo}</small>`;
}

export const temNota = (id) => Boolean(B.notas.partidas?.[id]?.texto || Object.keys(B.notas.partidas?.[id]?.rounds || {}).length);

// ---------- Partidas ----------
export function linhaPartida({ p, m, slug }, { mostrarNome = false } = {}) {
  const [a, b] = m.placar.split("-");
  const imp = m.r ? (100 * m.imp) / m.r : null;
  const tiros = m.hs + m.bs + m.ls;
  const posicao = m.mvp === 1 ? `<span class="selo selo--destaque">${icone("trofeu")} MVP</span>`
    : m.mvp === 2 ? `<span class="selo">${icone("trofeu")} MVP do time</span>` : m.pos ? `<span class="selo">#${m.pos} no time</span>` : "";
  const com = m.com.map((c) => B.porSlug.get(c)).filter(Boolean);
  const membro = B.porSlug.get(slug);
  return `<a class="partida ${m.res}" href="#/p/${esc(p.id)}" aria-label="${esc(p.mapa)}, ${m.res === "V" ? "vitória" : m.res === "D" ? "derrota" : "empate"} ${esc(m.placar)}">
    <span class="partida__fundo" style="${imgMapaFaixa(p.mapa) ? `background-image:url('${esc(imgMapaFaixa(p.mapa))}')` : ""}"></span>
    ${imagem(imgAgente(m.ag), m.ag, "partida__ag")}
    <div class="partida__meio">
      <div class="partida__titulo">${mostrarNome && membro ? `<span>${esc(membro.apelido)}</span><span class="suave">·</span>` : ""}<span>${esc(p.mapa)}</span>
        <span class="placar ${m.res === "V" ? "bom" : m.res === "D" ? "ruim" : ""}">${esc(a)}–${esc(b)}</span></div>
      <div class="partida__sub"><span>${esc(m.ag)}</span><span>${esc(nomeFila(p.fila))}</span><span>${hora(p.t)}</span>${m.eq > 1 ? `<span>com ${m.eq - 1} da equipe</span>` : ""}${temNota(p.id) ? `<span class="selo selo--destaque" title="Tem nota da IGL">${icone("nota")} nota</span>` : ""}${posicao}</div>
      ${com.length ? `<div class="com" title="Jogou com ${esc(com.map((c) => c.apelido).join(", "))}">${com.map((c) => imagem(imgCard(c.card), c.apelido, "", c.apelido)).join("")}</div>` : ""}
    </div>
    <div class="partida__nums">
      <div><small>K/D/A</small><strong>${m.k}/${m.d}/${m.a}</strong></div>
      <div><small>K/D</small><strong>${num(m.d ? m.k / m.d : m.k, 2)}</strong></div>
      <div class="partida__extra"><small>HS%</small><strong>${tiros ? num((100 * m.hs) / tiros) : "—"}%</strong></div>
      <div><small>ADR</small><strong>${num(m.dd / m.rt)}</strong></div>
      <div class="partida__extra"><small>ACS</small><strong>${num(m.sc / m.rt)}</strong></div>
      <div><small>Impacto</small><strong class="${classeSinal(imp, 1)}">${sinal(imp, 1, "%")}</strong></div>
    </div></a>`;
}

export function listaPorDia(itens, opcoesLinha = {}) {
  if (!itens.length) return "";
  return porDia(itens).map(({ itens: lst, s }) => `<div class="dia">
      <div class="dia__topo"><h3>${esc(diaLongo(lst[0].p.t))}</h3>
        <div class="dia__resumo"><span><strong class="bom">${s.v}V</strong> · <strong class="ruim">${s.d}D</strong></span>
          <span>K/D ${num(s.kd, 2)}</span><span>ADR ${num(s.adr)}</span><span>HS ${pct(s.hsp)}</span>
          <span class="${classeSinal(s.impr, 1)}">Impacto ${sinal(s.impr, 1, "%")}</span></div></div>
      <div class="partidas">${lst.map((it) => linhaPartida(it, opcoesLinha)).join("")}</div></div>`).join("");
}

// ---------- Tabela ordenável ----------
const ordem = new Map();
/** colunas: [{k, t, v: (linha)=>valor numérico/texto, f: (linha)=>html, cls?}] — a primeira coluna é o rótulo */
export function tabela(id, linhas, colunas, { padrao = null, classeLinha = null } = {}) {
  const est = ordem.get(id) || { k: padrao || colunas[1]?.k, asc: false };
  const col = colunas.find((c) => c.k === est.k) || colunas[1];
  const ord = [...linhas].sort((a, b) => {
    const va = col.v(a), vb = col.v(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const r = typeof va === "string" ? va.localeCompare(vb, "pt-BR") : va - vb;
    return est.asc ? r : -r;
  });
  return `<div class="rolagem"><table class="tabela" data-tabela="${esc(id)}">
    <thead><tr>${colunas.map((c) => `<th scope="col" data-ordenar="${esc(c.k)}" class="${c.k === col.k ? `ordenado ${est.asc ? "asc" : ""}` : ""}" ${c.k === col.k ? `aria-sort="${est.asc ? "ascending" : "descending"}"` : ""}>${esc(c.t)}</th>`).join("")}</tr></thead>
    <tbody>${ord.map((l) => `<tr class="${classeLinha ? classeLinha(l) : ""}">${colunas.map((c) => `<td class="${c.cls ? c.cls(l) : ""}">${c.f ? c.f(l) : esc(c.v(l))}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}
export function alternarOrdem(id, k) {
  const est = ordem.get(id);
  ordem.set(id, est && est.k === k ? { k, asc: !est.asc } : { k, asc: false });
}

export const celulaAgente = (nome, sub = "") =>
  `<div class="celula-ag">${imagem(imgAgente(nome), nome)}<div><strong>${esc(nome)}</strong>${sub ? `<small>${sub}</small>` : ""}</div></div>`;

export function forma(itens, n = 10) {
  const ult = itens.slice(0, n).reverse();
  const s = stats(itens.slice(0, n));
  return `<div class="forma" aria-label="Últimas ${ult.length} partidas">${ult.map(({ m }) => `<span class="${m.res}" title="${m.res === "V" ? "Vitória" : m.res === "D" ? "Derrota" : "Empate"} ${esc(m.placar)}"></span>`).join("")}
    <small>${ult.length ? `${s.v}V ${s.d}D nas últimas ${ult.length}` : "sem partidas"}</small></div>`;
}

export const vereditoSelo = (tipo, texto) => ({
  acima: selo("Acima da média da função", "vitoria"), abaixo: selo("Abaixo da média da função", "derrota"),
  media: selo("Na média da função", "destaque"), insuf: selo(esc(texto.replace("dados insuficientes", "Amostra pequena")), ""),
}[tipo] || "");

// ---------- Abas internas de um cartão (sem recarregar a página) ----------
const escolhaMini = new Map();  // grupo -> aba escolhida (vale enquanto o site está aberto)
/** abas: [[id, título, html]] (as vazias são ignoradas) */
export function miniAbas(grupo, abas) {
  const lista = abas.filter(([, , html]) => html);
  if (!lista.length) return "";
  const ativa = lista.some(([id]) => id === escolhaMini.get(grupo)) ? escolhaMini.get(grupo) : lista[0][0];
  return `<div class="mini-abas" data-grupo="${esc(grupo)}">
    <div class="mini-abas__lista" role="tablist">${lista.map(([id, t]) => `<button type="button" role="tab" data-mini-aba="${esc(id)}" aria-selected="${id === ativa}">${esc(t)}</button>`).join("")}</div>
    ${lista.map(([id, , html]) => `<div class="mini-abas__painel" role="tabpanel" data-painel="${esc(id)}"${id === ativa ? "" : " hidden"}>${html}</div>`).join("")}
  </div>`;
}
export function trocarMiniAba(botao) {
  const caixa = botao.closest(".mini-abas");
  const id = botao.dataset.miniAba;
  escolhaMini.set(caixa.dataset.grupo, id);
  caixa.querySelectorAll(":scope > .mini-abas__lista [data-mini-aba]").forEach((b) => b.setAttribute("aria-selected", String(b === botao)));
  caixa.querySelectorAll(":scope > .mini-abas__painel").forEach((p) => { p.hidden = p.dataset.painel !== id; });
}

// ---------- Cartões que podem ser minimizados (lembra a escolha neste aparelho) ----------
const CHAVE_MIN = "valreport.minimizados";
function lerMin() { try { return new Set(JSON.parse(localStorage.getItem(CHAVE_MIN) || "[]")); } catch (e) { return new Set(); } }
export const estaMinimizado = (chave) => lerMin().has(chave);
export function cartaoMin(chave, titulo, corpo, extra = "") {
  const min = estaMinimizado(chave);
  return `<section class="cartao cartao--min${min ? " minimizado" : ""}" data-min="${esc(chave)}">
    <div class="cartao__titulo"><h3>${esc(titulo)}</h3><div class="cartao__acoes">${extra}
      <button class="minimizar" type="button" data-minimizar aria-expanded="${!min}" aria-label="${min ? "Mostrar" : "Minimizar"} ${esc(titulo)}" title="${min ? "Mostrar" : "Minimizar"}">${icone("seta")}</button></div></div>
    <div class="cartao__corpo">${corpo}</div></section>`;
}
export function alternarMinimizado(botao) {
  const cartao = botao.closest("[data-min]");
  const chave = cartao.dataset.min;
  const set = lerMin();
  const min = !set.has(chave);
  if (min) set.add(chave); else set.delete(chave);
  try { localStorage.setItem(CHAVE_MIN, JSON.stringify([...set])); } catch (e) { /* sem armazenamento */ }
  cartao.classList.toggle("minimizado", min);
  botao.setAttribute("aria-expanded", String(!min));
  botao.title = min ? "Mostrar" : "Minimizar";
}
