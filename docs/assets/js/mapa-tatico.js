// Mapa tático das Táticas: o minimapa do mapa da estratégia com fases, agentes, habilidades, inimigos, setas,
// desenho à mão, áreas, textos e pontos com vídeo (ligados a um agente e a uma habilidade).
// Posições guardadas de 0 a 1 sobre o minimapa (quadrado), então valem em qualquer tamanho de tela.

import { esc, icone, imagem } from "./util.js";
import { htmlMidia, selAgente, novoId, TIPOS_PONTO } from "./taticas.js";

export const CORES = [["#f6b84c", "Amarelo"], ["#a068ff", "Roxo"], ["#5fc9d6", "Ciano"], ["#f67070", "Vermelho"], ["#54d688", "Verde"],
  ["#ffffff", "Branco"], ["#ff8ad8", "Rosa"], ["#8ea6ff", "Azul"]];
const TECLA = { Ability1: "Q", Ability2: "E", Grenade: "C", Ultimate: "X" };
const FERRAMENTAS = [
  ["mover", "Mover e selecionar", "mover"], ["agente", "Agente da equipe", "equipe"], ["hab", "Habilidade", "raio"],
  ["inimigo", "Inimigo", "alvo"], ["seta", "Seta de rota", "rota"], ["traco", "Desenho à mão", "lapis"],
  ["area", "Área (smoke, molly, zona)", "circulo"], ["texto", "Texto no mapa", "texto"], ["ponto", "Ponto com vídeo", "pino"],
  ["borracha", "Borracha", "borracha"],
];
const num = (v, min, max, padrao) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : padrao);
const corOk = (c) => (CORES.some(([x]) => x === c) ? c : CORES[0][0]);
const pct = (v) => `${(num(v, 0, 1, 0.5) * 100).toFixed(2)}%`;

// ---------- Desenho comum (leitura e editor) ----------
/** Letras dos sites, bases e (escondidos até pedir) os nomes de todos os lugares do mapa */
function rotulos(mapa) {
  if (!mapa?.t) return "";
  const [xm, ym, xs, ys] = mapa.t;
  return (mapa.callouts || []).map(([sup, reg, x, y]) => {
    const site = reg === "Site", spawn = reg === "Spawn";
    const u = y * xm + xs, v = x * ym + ys;
    if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return "";
    const txt = site ? sup : spawn ? (String(sup).includes("Attacker") ? "ATQ" : "DEF") : `${sup} ${reg}`;
    return `<span class="rotulo-mapa ${site ? "" : spawn ? "spawn" : "lugar"}" style="left:${(u * 100).toFixed(2)}%;top:${(v * 100).toFixed(2)}%">${esc(txt)}</span>`;
  }).join("");
}
const agenteDe = (ctx, nome) => ctx?.agentes?.find((a) => a.nome.toLowerCase() === String(nome || "").toLowerCase());
function iconeHab(ctx, ag, slot) {
  const h = agenteDe(ctx, ag)?.habilidades?.find((x) => x.slot === slot);
  return h ? { icone: h.icone, nome: h.nome } : { icone: null, nome: TECLA[slot] || "?" };
}
const pontos = (fase) => (fase.itens || []).filter((it) => it.t === "ponto");

function svgCamada(fase, { selecionado } = {}) {
  const linha = (it) => {
    const pts = (it.pts || []).filter((p) => Array.isArray(p)).map(([x, y]) => `${(num(x, 0, 1, 0) * 1000).toFixed(1)},${(num(y, 0, 1, 0) * 1000).toFixed(1)}`).join(" ");
    if (!pts) return "";
    const cor = corOk(it.cor), sel = it.id === selecionado;
    // a linha de baixo, larga e invisível, só serve para facilitar pegar o traço com o mouse no editor
    return `<polyline data-item="${esc(it.id)}" class="tat-traco-alvo" points="${pts}"></polyline>
      <polyline data-item="${esc(it.id)}" class="tat-traco${it.t === "seta" ? " tat-traco--seta" : ""}${sel ? " sel" : ""}" points="${pts}" stroke="${cor}"
      ${it.t === "seta" ? `marker-end="url(#ponta-${cor.slice(1)})"` : ""} fill="none"></polyline>`;
  };
  const area = (it) => `<circle data-item="${esc(it.id)}" class="tat-area${it.id === selecionado ? " sel" : ""}" cx="${(num(it.x, 0, 1, 0.5) * 1000).toFixed(1)}" cy="${(num(it.y, 0, 1, 0.5) * 1000).toFixed(1)}"
      r="${(num(it.r, 0.005, 0.3, 0.04) * 1000).toFixed(1)}" fill="${corOk(it.cor)}" stroke="${corOk(it.cor)}"></circle>`;
  const habArea = (it) => (it.r ? `<circle class="tat-area tat-area--hab" cx="${(num(it.x, 0, 1, 0.5) * 1000).toFixed(1)}" cy="${(num(it.y, 0, 1, 0.5) * 1000).toFixed(1)}"
      r="${(num(it.r, 0.005, 0.3, 0.04) * 1000).toFixed(1)}"></circle>` : "");
  return `<svg class="tat-mapa__desenho" viewBox="0 0 1000 1000" aria-hidden="true">
      <defs>${CORES.map(([c]) => `<marker id="ponta-${c.slice(1)}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"></path></marker>`).join("")}</defs>
      ${(fase.itens || []).filter((it) => it.t === "area").map(area).join("")}
      ${(fase.itens || []).filter((it) => it.t === "hab").map(habArea).join("")}
      ${(fase.itens || []).filter((it) => it.t === "seta" || it.t === "traco").map(linha).join("")}
    </svg>`;
}

function htmlItens(fase, ctx, { editor = false, selecionado = null, pontoAtivo = null } = {}) {
  const lista = pontos(fase);
  return (fase.itens || []).map((it) => {
    const sel = it.id === selecionado ? " sel" : "";
    const pos = `left:${pct(it.x)};top:${pct(it.y)}`;
    const tag = editor ? "button" : "span";
    const attrs = editor ? `type="button" data-item="${esc(it.id)}"` : "";
    if (it.t === "agente") {
      const a = agenteDe(ctx, it.ag);
      return `<${tag} class="tat-ficha tat-ficha--agente${sel}" style="${pos}" ${attrs} title="${esc(it.ag)}" aria-label="${esc(it.ag)}">${imagem(a?.icone, "", "", it.ag)}</${tag}>`;
    }
    if (it.t === "inimigo") {
      const a = it.ag ? agenteDe(ctx, it.ag) : null;
      return `<${tag} class="tat-ficha tat-ficha--inimigo${sel}" style="${pos}" ${attrs} title="Inimigo${it.ag ? `: ${esc(it.ag)}` : ""}" aria-label="Inimigo${it.ag ? ` ${esc(it.ag)}` : ""}">${a ? imagem(a.icone, "", "", it.ag) : `<span aria-hidden="true">!</span>`}</${tag}>`;
    }
    if (it.t === "hab") {
      const h = iconeHab(ctx, it.ag, it.slot);
      return `<${tag} class="tat-ficha tat-ficha--hab${sel}" style="${pos}" ${attrs} title="${esc(it.ag)} · ${esc(h.nome)}" aria-label="${esc(it.ag)}: ${esc(h.nome)}">${h.icone ? imagem(h.icone, "", "", "") : `<span>${esc(TECLA[it.slot] || "?")}</span>`}</${tag}>`;
    }
    if (it.t === "texto") {
      return `<${tag} class="tat-ficha tat-ficha--texto${sel}" style="${pos};--cor:${corOk(it.cor)}" ${attrs}>${esc(it.texto || "Texto")}</${tag}>`;
    }
    if (it.t === "ponto") {
      const n = lista.indexOf(it) + 1, ativo = it.id === pontoAtivo ? " ativo" : "";
      return editor
        ? `<button class="tat-pino${sel}" style="${pos}" type="button" data-item="${esc(it.id)}" aria-label="Ponto ${n}: ${esc(it.titulo || "sem nome")}"><span>${n}</span></button>`
        : `<button class="tat-pino${ativo}" style="${pos}" type="button" data-ponto="${esc(it.id)}" aria-label="Ponto ${n}: ${esc(it.titulo || "sem nome")}"><span>${n}</span></button>`;
    }
    return "";
  }).join("");
}

function quadro(fase, ctx, opcoes = {}) {
  const m = ctx?.mapa;
  return `<div class="tat-mapa__quadro${m?.minimapa ? "" : " sem-minimapa"}${opcoes.nomes ? " com-nomes" : ""}"${opcoes.editor ? ' tabindex="0" aria-label="Mapa em edição: use as ferramentas ao lado"' : ""}>
      ${m?.minimapa ? `<img class="tat-mapa__fundo" src="${esc(m.minimapa)}" alt="Minimapa de ${esc(m.nome)}" referrerpolicy="no-referrer" draggable="false">`
        : `<span class="tat-mapa__aviso">${esc(ctx?.doc?.mapa ? `Sem o minimapa de ${ctx.doc.mapa} agora` : "Escolha o mapa da estratégia (no topo) para aparecer o minimapa")}</span>`}
      ${rotulos(m)}
      ${svgCamada(fase, opcoes)}
      ${htmlItens(fase, ctx, opcoes)}
    </div>`;
}

function htmlDetalhePonto(it, ctx, n) {
  if (!it) return `<p class="suave pequeno">Toque num ponto numerado do mapa para ver o vídeo e o passo a passo.</p>`;
  const h = it.ag && it.slot ? iconeHab(ctx, it.ag, it.slot) : null;
  return `<div class="tat-ponto">
      <span class="suave pequeno">Ponto ${n}${it.tipo ? ` · ${esc(TIPOS_PONTO[it.tipo] || it.tipo)}` : ""}</span>
      <strong class="tat-ponto__titulo">${esc(it.titulo || "Ponto sem nome")}</strong>
      ${it.ag ? `<div class="chips">${selAgente(it.ag, ctx)}${h ? `<span class="tat-agente">${imagem(h.icone, "", "", "")}${esc(h.nome)}</span>` : ""}</div>` : ""}
      ${it.midia ? htmlMidia(it.midia, ctx, { titulo: it.titulo }) : ""}
      ${(it.passos || []).filter(Boolean).length ? `<ol class="tat-passos">${it.passos.filter(Boolean).map((p) => `<li>${esc(p)}</li>`).join("")}</ol>` : ""}
    </div>`;
}
function htmlListaPontos(fase) {
  const lista = pontos(fase);
  if (!lista.length) return "";
  return `<div class="tat-pontos" role="list">${lista.map((it, i) => `<button class="tat-pontos__item" type="button" role="listitem" data-ponto="${esc(it.id)}">
      <span class="tat-pontos__n">${i + 1}</span><span><strong>${esc(it.titulo || "Ponto sem nome")}</strong>
      <small>${[it.ag, it.tipo && TIPOS_PONTO[it.tipo], it.midia ? "com vídeo" : ""].filter(Boolean).map(esc).join(" · ")}</small></span></button>`).join("")}</div>`;
}

// ---------- Leitura ----------
export function htmlMapaLeitura(b, ctx) {
  const fases = (b.fases || []).filter((f) => f && Array.isArray(f.itens));
  if (!fases.length) return `<p class="suave pequeno">Mapa sem fases.</p>`;
  const temPontos = fases.some((f) => pontos(f).length);
  return `<div class="tat-mapa" data-mapa-bloco="${esc(b.id)}">
      <div class="tat-mapa__barra">
        ${fases.length > 1 ? `<div class="segmentos tat-mapa__fases" role="tablist" aria-label="Fases">${fases.map((f, i) => `<button type="button" role="tab" data-fase="${esc(f.id)}" aria-selected="${i === 0}" aria-pressed="${i === 0}">${esc(f.nome || `Fase ${i + 1}`)}</button>`).join("")}</div>` : `<span class="suave pequeno">${esc(fases[0].nome || "")}</span>`}
        ${ctx?.mapa?.callouts?.length ? `<label class="tat-mapa__nomes"><input type="checkbox" data-mapa-nomes> Nomes dos lugares</label>` : ""}
      </div>
      ${fases.map((f, i) => `<div class="tat-mapa__fase" data-fase-corpo="${esc(f.id)}"${i ? " hidden" : ""}>
        <div class="tat-mapa__area${temPontos ? "" : " sem-lado"}">
          ${quadro(f, ctx)}
          ${temPontos ? `<div class="tat-mapa__lado">${htmlListaPontos(f) || `<p class="suave pequeno">Nenhum ponto nesta fase.</p>`}
            <div class="tat-mapa__detalhe" data-detalhe aria-live="polite">${htmlDetalhePonto(null)}</div></div>` : ""}
        </div></div>`).join("")}
    </div>`;
}
export function ligarMapaLeitura(raiz, ctx) {
  if (!raiz) return;
  raiz.addEventListener("click", (ev) => {
    const fase = ev.target.closest(".tat-mapa [data-fase]");
    if (fase) {
      const mapa = fase.closest(".tat-mapa");
      mapa.querySelectorAll("[data-fase]").forEach((b) => { const on = b === fase; b.setAttribute("aria-selected", String(on)); b.setAttribute("aria-pressed", String(on)); });
      mapa.querySelectorAll("[data-fase-corpo]").forEach((c) => { c.hidden = c.dataset.faseCorpo !== fase.dataset.fase; });
      return;
    }
    const p = ev.target.closest(".tat-mapa [data-ponto]");
    if (!p) return;
    const mapa = p.closest(".tat-mapa"), corpo = p.closest("[data-fase-corpo]");
    const bloco = acharBlocoDoc(ctx?.doc, mapa.dataset.mapaBloco);
    const f = bloco?.fases?.find((x) => x.id === corpo.dataset.faseCorpo);
    const lista = f ? pontos(f) : [];
    const it = lista.find((x) => x.id === p.dataset.ponto);
    corpo.querySelectorAll("[data-ponto]").forEach((x) => x.classList.toggle("ativo", x.dataset.ponto === p.dataset.ponto));
    const det = corpo.querySelector("[data-detalhe]");
    if (det) { det.innerHTML = htmlDetalhePonto(it, ctx, lista.indexOf(it) + 1); if (innerWidth < 900) det.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  });
  raiz.addEventListener("change", (ev) => {
    const c = ev.target.closest(".tat-mapa [data-mapa-nomes]");
    if (c) c.closest(".tat-mapa").querySelectorAll(".tat-mapa__quadro").forEach((q) => q.classList.toggle("com-nomes", c.checked));
  });
}
function acharBlocoDoc(doc, id) {
  for (const s of doc?.secoes || []) { const b = (s.blocos || []).find((x) => x.id === id); if (b) return b; }
  return null;
}

// ---------- Editor ----------
export const novoBlocoMapa = (id) => ({ id, tipo: "mapa", titulo: "", fases: [{ id: novoId(), nome: "Fase 1", itens: [] }] });
export function conferirMapa(b) {
  const out = [];
  (b.fases || []).forEach((f) => pontos(f).forEach((it, i) => { if (!String(it.titulo || "").trim()) out.push(`ponto ${i + 1} da fase "${f.nome}" está sem nome.`); }));
  return out;
}

const estados = new Map();   // id do bloco -> estado da ferramenta
function estadoDe(b, E) {
  if (!estados.has(b.id)) {
    estados.set(b.id, { ferramenta: "mover", fase: b.fases[0]?.id, sel: null, agente: E.doc.agentes[0] || E.agentes[0]?.nome || null, slot: null, cor: CORES[0][0], historico: [], nomes: false });
  }
  const st = estados.get(b.id);
  if (!b.fases.some((f) => f.id === st.fase)) st.fase = b.fases[0]?.id;
  return st;
}
const faseDe = (b, st) => b.fases.find((f) => f.id === st.fase) || b.fases[0];
const itemDe = (b, st) => faseDe(b, st)?.itens.find((x) => x.id === st.sel) || null;

function htmlPainel(b, st, E) {
  const fase = faseDe(b, st), it = itemDe(b, st);
  const comp = E.doc.agentes.map((n) => agenteDe(E, n)).filter(Boolean);
  const outros = E.agentes.filter((a) => !E.doc.agentes.includes(a.nome));
  const botaoAgente = (a) => `<button type="button" class="tat-emapa__ag${st.agente === a.nome ? " ativo" : ""}" data-mapa-acao="escolher-agente" data-agente="${esc(a.nome)}" aria-pressed="${st.agente === a.nome}" title="${esc(a.nome)}">${imagem(a.icone, "", "", a.nome)}<span>${esc(a.nome)}</span></button>`;
  const paleta = (acao, atual) => `<div class="tat-emapa__cores" role="group" aria-label="Cor">${CORES.map(([c, n]) => `<button type="button" class="tat-emapa__cor${atual === c ? " ativa" : ""}" style="--cor:${c}" data-mapa-acao="${acao}" data-cor="${c}" aria-label="${n}" aria-pressed="${atual === c}"></button>`).join("")}</div>`;
  const cores = paleta("cor", st.cor);
  if (it) {
    const titulo = { agente: "Agente", inimigo: "Inimigo", hab: "Habilidade", seta: "Seta", traco: "Desenho", area: "Área", texto: "Texto", ponto: "Ponto com vídeo" }[it.t] || "Item";
    let corpo = "";
    if (it.t === "agente" || it.t === "inimigo" || it.t === "hab") {
      corpo += `<label class="campo"><span>Agente</span><select data-item-campo="ag">${it.t === "inimigo" ? `<option value="">Sem agente</option>` : ""}${E.agentes.map((a) => `<option value="${esc(a.nome)}"${a.nome === it.ag ? " selected" : ""}>${esc(a.nome)}</option>`).join("")}</select></label>`;
    }
    if (it.t === "hab") {
      const habs = agenteDe(E, it.ag)?.habilidades || [];
      corpo += habs.length ? `<label class="campo"><span>Habilidade</span><select data-item-campo="slot">${habs.map((h) => `<option value="${esc(h.slot)}"${h.slot === it.slot ? " selected" : ""}>${esc(TECLA[h.slot] || "")} · ${esc(h.nome)}</option>`).join("")}</select></label>` : "";
    }
    if (it.t === "hab" || it.t === "area") {
      corpo += `<label class="campo"><span>Tamanho da área${it.t === "hab" ? " (0 = só o ícone)" : ""}</span><input type="range" min="${it.t === "hab" ? 0 : 1}" max="30" step="1" value="${Math.round((it.r || 0) * 100)}" data-item-campo="r"></label>`;
    }
    if (it.t === "texto") corpo += `<label class="campo"><span>Texto</span><input data-item-campo="texto" maxlength="60" value="${esc(it.texto || "")}"></label>`;
    if (["seta", "traco", "area", "texto"].includes(it.t)) corpo += `<div class="campo"><span>Cor</span>${paleta("cor-item", corOk(it.cor))}</div>`;
    if (it.t === "ponto") {
      const habs = agenteDe(E, it.ag)?.habilidades || [];
      corpo += `<label class="campo"><span>Nome do ponto</span><input data-item-campo="titulo" maxlength="100" value="${esc(it.titulo || "")}" placeholder="Ex.: Flecha de reconhecimento no A"></label>
        <div class="grade-2"><label class="campo"><span>Agente</span><select data-item-campo="ag"><option value="">Nenhum</option>${E.agentes.map((a) => `<option value="${esc(a.nome)}"${a.nome === it.ag ? " selected" : ""}>${esc(a.nome)}</option>`).join("")}</select></label>
          <label class="campo"><span>Habilidade</span><select data-item-campo="slot"${habs.length ? "" : " disabled"}><option value="">Nenhuma</option>${habs.map((h) => `<option value="${esc(h.slot)}"${h.slot === it.slot ? " selected" : ""}>${esc(TECLA[h.slot] || "")} · ${esc(h.nome)}</option>`).join("")}</select></label></div>
        <label class="campo"><span>Tipo</span><select data-item-campo="tipo">${Object.entries(TIPOS_PONTO).map(([k, t]) => `<option value="${k}"${(it.tipo || "pixel") === k ? " selected" : ""}>${esc(t[0].toUpperCase() + t.slice(1))}</option>`).join("")}</select></label>
        ${E.api.htmlFonteVideo(it, "ponto", { idAlvo: it.id })}
        <label class="campo"><span>Passo a passo <small class="suave">(um por linha)</small></span><textarea data-item-campo="passos" rows="3" maxlength="2800">${esc((it.passos || []).join("\n"))}</textarea></label>`;
    }
    return `<div class="tat-emapa__painel-topo"><strong>${esc(titulo)}</strong><button class="botao-perigo botao-mini" type="button" data-mapa-acao="apagar-item">Apagar</button></div>${corpo}
      <p class="suave pequeno">Arraste no mapa para mover. Delete apaga; Ctrl+Z desfaz.</p>`;
  }
  const f = st.ferramenta;
  if (f === "agente" || f === "hab" || f === "inimigo") {
    const habs = agenteDe(E, st.agente)?.habilidades || [];
    return `<strong>${f === "agente" ? "Escolha o agente e toque no mapa" : f === "hab" ? "Escolha o agente, a habilidade e toque no mapa" : "Toque no mapa para marcar um inimigo"}</strong>
      ${f !== "inimigo" ? `${comp.length ? `<span class="suave pequeno">Composição</span><div class="tat-emapa__ags">${comp.map(botaoAgente).join("")}</div>` : ""}
        <details${comp.length ? "" : " open"}><summary class="pequeno">Todos os agentes</summary><div class="tat-emapa__ags">${outros.map(botaoAgente).join("")}</div></details>` : ""}
      ${f === "hab" ? (habs.length ? `<span class="suave pequeno">Habilidades de ${esc(st.agente || "")}</span><div class="tat-emapa__habs">${habs.map((h) => `<button type="button" class="tat-emapa__hab${st.slot === h.slot ? " ativo" : ""}" data-mapa-acao="escolher-hab" data-slot="${esc(h.slot)}" aria-pressed="${st.slot === h.slot}" title="${esc(h.nome)}">${imagem(h.icone, "", "", "")}<span><b>${esc(TECLA[h.slot] || "")}</b> ${esc(h.nome)}</span></button>`).join("")}</div>`
        : `<p class="suave pequeno">${st.agente ? "As habilidades não carregaram agora (a valorant-api.com não respondeu)." : "Escolha um agente."}</p>`) : ""}`;
  }
  if (f === "seta" || f === "traco" || f === "area" || f === "texto") {
    return `<strong>${{ seta: "Arraste no mapa para desenhar a rota (a ponta fica onde você soltar)", traco: "Arraste para desenhar à mão livre", area: "Toque no mapa para marcar uma área", texto: "Toque no mapa onde o texto deve ficar" }[f]}</strong>
      <span class="suave pequeno">Cor</span>${cores}`;
  }
  if (f === "ponto") return `<strong>Toque no mapa onde fica o ponto</strong><p class="suave pequeno">Depois dê um nome, ligue a um agente e a uma habilidade e cole o link do vídeo (pixel, lineup, posição…).</p>`;
  if (f === "borracha") return `<strong>Toque no que quer apagar</strong><p class="suave pequeno">Funciona em agentes, habilidades, setas, desenhos, áreas, textos e pontos.</p>`;
  return `<strong>Mover e selecionar</strong><p class="suave pequeno">Arraste os itens para mudar de lugar. Toque num item para editar. Os ${pontos(fase).length} ponto(s) desta fase aparecem numerados para a equipe.</p>`;
}

export function htmlMapaEditor(b, E) {
  const st = estadoDe(b, E), fase = faseDe(b, st);
  return `<div class="tat-mapa-editor" data-mapa-editor="${esc(b.id)}">
      <label class="campo"><span>Título do mapa <small class="suave">(opcional)</small></span><input data-mapa-campo="titulo" value="${esc(b.titulo || "")}" maxlength="120" placeholder="Ex.: Posições e utilitários"></label>
      <div class="tat-emapa__fases">
        <div class="segmentos" role="tablist" aria-label="Fases">${b.fases.map((f, i) => `<button type="button" role="tab" data-mapa-acao="fase" data-fase="${esc(f.id)}" aria-selected="${f === fase}" aria-pressed="${f === fase}">${esc(f.nome || `Fase ${i + 1}`)}</button>`).join("")}</div>
        <button class="botao-secundario botao-mini" type="button" data-mapa-acao="fase-copiar"${b.fases.length >= 10 ? " disabled" : ""} title="A nova fase começa com tudo o que está nesta">${icone("mais")} Fase (copiando esta)</button>
        <button class="botao-secundario botao-mini" type="button" data-mapa-acao="fase-nova"${b.fases.length >= 10 ? " disabled" : ""}>${icone("mais")} Fase vazia</button>
      </div>
      <div class="tat-emapa__fase-campos">
        <label class="campo"><span>Nome da fase</span><input data-mapa-campo="fase-nome" value="${esc(fase.nome || "")}" maxlength="40" placeholder="Ex.: Entrada, Plant, Pós-plant"></label>
        <span class="tat-emapa__fase-acoes">
          <button class="botao-icone botao-mini" type="button" data-mapa-acao="fase-esq" aria-label="Fase para a esquerda"${b.fases[0] === fase ? " disabled" : ""}>${icone("voltar")}</button>
          <button class="botao-icone botao-mini" type="button" data-mapa-acao="fase-dir" aria-label="Fase para a direita"${b.fases[b.fases.length - 1] === fase ? " disabled" : ""}>${icone("seta")}</button>
          <button class="botao-perigo botao-mini" type="button" data-mapa-acao="fase-apagar"${b.fases.length < 2 ? " disabled" : ""}>Apagar fase</button>
        </span>
      </div>
      <div class="tat-emapa__area">
        <div class="tat-emapa__ferramentas" role="toolbar" aria-label="Ferramentas do mapa" aria-orientation="vertical">
          ${FERRAMENTAS.map(([id, nome, ic]) => `<button type="button" class="tat-emapa__ferr${st.ferramenta === id ? " ativa" : ""}" data-mapa-acao="ferramenta" data-ferramenta="${id}" aria-pressed="${st.ferramenta === id}" aria-label="${esc(nome)}" title="${esc(nome)}">${icone(ic)}</button>`).join("")}
          <span class="tat-emapa__sep" aria-hidden="true"></span>
          <button type="button" class="tat-emapa__ferr" data-mapa-acao="desfazer" aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)"${st.historico.length ? "" : " disabled"}>${icone("desfazer")}</button>
          <button type="button" class="tat-emapa__ferr${st.nomes ? " ativa" : ""}" data-mapa-acao="nomes" aria-pressed="${st.nomes}" aria-label="Nomes dos lugares" title="Nomes dos lugares">${icone("etiqueta")}</button>
        </div>
        <div class="tat-emapa__palco" data-ferramenta-atual="${esc(st.ferramenta)}">${quadro(fase, E, { editor: true, selecionado: st.sel, nomes: st.nomes })}</div>
        <div class="tat-emapa__painel">${htmlPainel(b, st, E)}</div>
      </div>
    </div>`;
}

// Simplifica um traço (Ramer–Douglas–Peucker) para guardar poucos pontos
function simplificar(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maior = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i], dx = b[0] - a[0], dy = b[1] - a[1];
    const d = dx || dy ? Math.abs(dy * x - dx * y + b[0] * a[1] - b[1] * a[0]) / Math.hypot(dx, dy) : Math.hypot(x - a[0], y - a[1]);
    if (d > maior) { maior = d; idx = i; }
  }
  if (maior <= eps) return [a, b];
  return [...simplificar(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplificar(pts.slice(idx), eps)];
}
const r4 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;

export function ligarMapaEditor(blocoEl, b, E) {
  const caixa = blocoEl.querySelector(".tat-mapa-editor");
  if (!caixa) return;
  const st = estadoDe(b, E);
  const redesenhar = (focoNoMapa = false) => {
    caixa.outerHTML = htmlMapaEditor(b, E);
    ligarMapaEditor(blocoEl, b, E);
    if (focoNoMapa) blocoEl.querySelector(".tat-emapa__palco .tat-mapa__quadro")?.focus({ preventScroll: true });
  };
  const guardarHistorico = () => { st.historico.push(JSON.stringify(b.fases)); if (st.historico.length > 50) st.historico.shift(); };
  const mudouMapa = (redesenhar_ = true, foco = false) => { E.api.mudou(); if (redesenhar_) redesenhar(foco); };
  const fase = () => faseDe(b, st);
  const quadroEl = caixa.querySelector(".tat-emapa__palco .tat-mapa__quadro");
  const posicao = (ev) => {
    const r = quadroEl.getBoundingClientRect();
    return [r4((ev.clientX - r.left) / r.width), r4((ev.clientY - r.top) / r.height)];
  };

  // botões do mapa (ferramentas, fases, painel)
  caixa.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-mapa-acao]");
    if (!btn || btn.closest("[data-fonte-de]")) return;
    const a = btn.dataset.mapaAcao;
    if (a === "ferramenta") { st.ferramenta = btn.dataset.ferramenta; st.sel = null; redesenhar(); return; }
    if (a === "fase") { st.fase = btn.dataset.fase; st.sel = null; redesenhar(); return; }
    if (a === "nomes") { st.nomes = !st.nomes; redesenhar(); return; }
    if (a === "escolher-agente") {
      st.agente = btn.dataset.agente;
      const habs = agenteDe(E, st.agente)?.habilidades || [];
      if (!habs.some((h) => h.slot === st.slot)) st.slot = habs[0]?.slot || null;
      redesenhar();
      return;
    }
    if (a === "escolher-hab") { st.slot = btn.dataset.slot; redesenhar(); return; }
    if (a === "cor") { st.cor = btn.dataset.cor; redesenhar(); return; }
    if (a === "cor-item") { const it = itemDe(b, st); if (it) { guardarHistorico(); it.cor = btn.dataset.cor; mudouMapa(); } return; }
    if (a === "apagar-item") { const f = fase(); guardarHistorico(); f.itens = f.itens.filter((x) => x.id !== st.sel); st.sel = null; mudouMapa(true, true); return; }
    if (a === "desfazer") { desfazer(); return; }
    if (a === "fase-nova" || a === "fase-copiar") {
      if (b.fases.length >= 10) return;
      guardarHistorico();
      const atual = fase(), i = b.fases.indexOf(atual);
      const nova = { id: novoId(), nome: `Fase ${b.fases.length + 1}`, itens: a === "fase-copiar" ? atual.itens.map((x) => ({ ...JSON.parse(JSON.stringify(x)), id: novoId() })) : [] };
      b.fases.splice(i + 1, 0, nova);
      st.fase = nova.id; st.sel = null;
      mudouMapa();
      blocoEl.querySelector("[data-mapa-campo=fase-nome]")?.select();
      return;
    }
    if (a === "fase-esq" || a === "fase-dir") {
      const i = b.fases.indexOf(fase()), j = i + (a === "fase-esq" ? -1 : 1);
      if (j < 0 || j >= b.fases.length) return;
      [b.fases[i], b.fases[j]] = [b.fases[j], b.fases[i]];
      mudouMapa();
      return;
    }
    if (a === "fase-apagar") {
      if (b.fases.length < 2) return;
      const f = fase();
      if (f.itens.length && !confirm(`Apagar a fase "${f.nome}" e tudo o que está nela?`)) return;
      guardarHistorico();
      b.fases = b.fases.filter((x) => x !== f);
      st.fase = b.fases[0].id; st.sel = null;
      mudouMapa();
    }
  });

  function desfazer() {
    const antes = st.historico.pop();
    if (!antes) return;
    b.fases = JSON.parse(antes);
    if (!b.fases.some((f) => f.id === st.fase)) st.fase = b.fases[0].id;
    st.sel = null;
    mudouMapa(true, true);
  }

  // campos do painel (item selecionado), título e nome da fase
  caixa.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el.closest("[data-fonte-de]")) return;   // vídeo do ponto: o editor cuida
    if (el.matches("[data-mapa-campo=titulo]")) { b.titulo = el.value.slice(0, 120); E.api.mudou(); return; }
    if (el.matches("[data-mapa-campo=fase-nome]")) {
      fase().nome = el.value.slice(0, 40);
      const aba = caixa.querySelector(`[data-mapa-acao=fase][data-fase="${CSS.escape(st.fase)}"]`);
      if (aba) aba.textContent = el.value || "Fase";
      E.api.mudou();
      return;
    }
    const it = itemDe(b, st);
    if (!it || !el.matches("[data-item-campo]")) return;
    const c = el.dataset.itemCampo;
    if (c === "texto") { it.texto = el.value.slice(0, 60); const fe = quadroEl.querySelector(`[data-item="${CSS.escape(it.id)}"]`); if (fe) fe.textContent = it.texto || "Texto"; }
    else if (c === "titulo") { it.titulo = el.value.slice(0, 100); }
    else if (c === "passos") { it.passos = el.value.split("\n").map((l) => l.trim().slice(0, 240)).filter(Boolean).slice(0, 12); }
    else if (c === "r") { it.r = Number(el.value) / 100 || (it.t === "area" ? 0.01 : 0); if (!it.r) delete it.r; atualizarSvg(); }
    E.api.mudou();
  });
  caixa.addEventListener("change", (ev) => {
    const el = ev.target, it = itemDe(b, st);
    if (el.closest("[data-fonte-de]") || !it || !el.matches("select[data-item-campo]")) return;
    guardarHistorico();
    const c = el.dataset.itemCampo;
    if (c === "ag") {
      it.ag = el.value || null;
      if (!it.ag) delete it.ag;
      if (it.t === "hab" || it.t === "ponto") { const habs = agenteDe(E, it.ag)?.habilidades || []; if (!habs.some((h) => h.slot === it.slot)) { if (it.t === "hab") it.slot = habs[0]?.slot || it.slot; else delete it.slot; } }
    } else if (c === "slot") { if (el.value) it.slot = el.value; else delete it.slot; }
    else if (c === "tipo") it.tipo = el.value;
    mudouMapa();
  });
  function atualizarSvg() {
    const velho = quadroEl.querySelector("svg.tat-mapa__desenho");
    if (velho) velho.outerHTML = svgCamada(fase(), { selecionado: st.sel });
  }

  // teclado no mapa: Delete apaga, Ctrl+Z desfaz, setas movem um pouco
  quadroEl.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); desfazer(); return; }
    const it = itemDe(b, st);
    if (!it) return;
    if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); guardarHistorico(); const f = fase(); f.itens = f.itens.filter((x) => x !== it); st.sel = null; mudouMapa(true, true); return; }
    const passo = ev.shiftKey ? 0.02 : 0.005, d = { ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo] }[ev.key];
    if (d && Number.isFinite(it.x)) { ev.preventDefault(); guardarHistorico(); it.x = r4(it.x + d[0]); it.y = r4(it.y + d[1]); mudouMapa(true, true); }
  });

  // ponteiro: colocar, arrastar, desenhar e apagar
  let arrasto = null;
  quadroEl.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const f = fase(), ferr = st.ferramenta, alvoEl = ev.target.closest("[data-item]");
    const alvo = alvoEl ? f.itens.find((x) => x.id === alvoEl.dataset.item) : null;
    const [x, y] = posicao(ev);
    if (ferr === "borracha") {
      if (alvo) { guardarHistorico(); f.itens = f.itens.filter((i) => i !== alvo); if (st.sel === alvo.id) st.sel = null; mudouMapa(true, true); }
      return;
    }
    if (ferr === "mover" || (alvo && !["seta", "traco"].includes(ferr))) {
      if (!alvo) { if (st.sel) { st.sel = null; redesenhar(true); } return; }
      ev.preventDefault();
      quadroEl.setPointerCapture(ev.pointerId);
      arrasto = { tipo: "mover", it: alvo, x0: x, y0: y, orig: JSON.stringify(alvo), moveu: false, el: alvoEl };
      if (st.sel !== alvo.id) { st.sel = alvo.id; arrasto.trocouSel = true; }
      return;
    }
    if (f.itens.length >= 300) { alert("Esta fase chegou a 300 itens. Crie outra fase."); return; }
    if (ferr === "seta" || ferr === "traco") {
      ev.preventDefault();
      quadroEl.setPointerCapture(ev.pointerId);
      const svg = quadroEl.querySelector("svg.tat-mapa__desenho");
      const linha = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      linha.setAttribute("class", `tat-traco${ferr === "seta" ? " tat-traco--seta" : ""}`);
      linha.setAttribute("stroke", st.cor);
      linha.setAttribute("fill", "none");
      svg.append(linha);
      arrasto = { tipo: "desenho", pts: [[x, y]], linha };
      return;
    }
    // ferramentas que colocam um item com um toque
    let novo = null;
    const id = novoId();
    if (ferr === "agente") { if (!st.agente) { alert("Escolha um agente no painel ao lado."); return; } novo = { id, t: "agente", ag: st.agente, x, y }; }
    if (ferr === "inimigo") novo = { id, t: "inimigo", x, y };
    if (ferr === "hab") { if (!st.agente || !st.slot) { alert("Escolha o agente e a habilidade no painel ao lado."); return; } novo = { id, t: "hab", ag: st.agente, slot: st.slot, x, y }; }
    if (ferr === "area") novo = { id, t: "area", x, y, r: 0.04, cor: st.cor };
    if (ferr === "texto") novo = { id, t: "texto", x, y, texto: "Texto", cor: st.cor };
    if (ferr === "ponto") novo = { id, t: "ponto", x, y, titulo: "", tipo: "pixel", midia: null, passos: [], ...(st.agente && E.doc.agentes.includes(st.agente) ? { ag: st.agente } : {}) };
    if (!novo) return;
    guardarHistorico();
    f.itens.push(novo);
    if (["texto", "ponto", "area"].includes(ferr)) { st.sel = id; st.ferramenta = "mover"; }
    mudouMapa();
    if (ferr === "texto") blocoEl.querySelector("[data-item-campo=texto]")?.select();
    if (ferr === "ponto") blocoEl.querySelector("[data-item-campo=titulo]")?.focus();
  });
  quadroEl.addEventListener("pointermove", (ev) => {
    if (!arrasto) return;
    const [x, y] = posicao(ev);
    if (arrasto.tipo === "desenho") {
      const ult = arrasto.pts[arrasto.pts.length - 1];
      if (Math.hypot(x - ult[0], y - ult[1]) < 0.004) return;
      arrasto.pts.push([x, y]);
      arrasto.linha.setAttribute("points", arrasto.pts.map(([a, c]) => `${a * 1000},${c * 1000}`).join(" "));
      return;
    }
    const dx = x - arrasto.x0, dy = y - arrasto.y0;
    if (!arrasto.moveu && Math.hypot(dx, dy) < 0.006) return;
    if (!arrasto.moveu) guardarHistorico();
    arrasto.moveu = true;
    const it = arrasto.it, o = JSON.parse(arrasto.orig);
    if (Array.isArray(o.pts)) {
      it.pts = o.pts.map(([a, c]) => [r4(a + dx), r4(c + dy)]);
      atualizarSvg();
    } else {
      it.x = r4(o.x + dx); it.y = r4(o.y + dy);
      if (it.t === "area" || (it.t === "hab" && it.r)) atualizarSvg();
      if (arrasto.el?.style) { arrasto.el.style.left = pct(it.x); arrasto.el.style.top = pct(it.y); }
    }
  });
  const soltar = () => {
    if (!arrasto) return;
    const a = arrasto;
    arrasto = null;
    if (a.tipo === "desenho") {
      const eps = st.ferramenta === "seta" ? 0.006 : 0.0025;
      let pts = simplificar(a.pts, eps).map(([x, y]) => [r4(x), r4(y)]);
      if (pts.length < 2 || Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) < 0.01) { a.linha.remove(); return; }
      if (pts.length > 400) pts = pts.filter((_, i) => i % Math.ceil(pts.length / 400) === 0).concat([pts[pts.length - 1]]);
      guardarHistorico();
      fase().itens.push({ id: novoId(), t: st.ferramenta, pts, cor: st.cor });
      mudouMapa();
      return;
    }
    if (a.moveu) mudouMapa(true, true);
    else if (a.trocouSel) redesenhar(true);
  };
  quadroEl.addEventListener("pointerup", soltar);
  quadroEl.addEventListener("pointercancel", soltar);
  // traços e áreas do SVG só recebem o toque nas ferramentas de mover e apagar
  quadroEl.classList.toggle("pega-desenho", st.ferramenta === "mover" || st.ferramenta === "borracha");
}
