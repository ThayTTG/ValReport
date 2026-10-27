// Editor das Táticas (líder, co-líderes e treinadores; só no computador).
// Edita um rascunho que é salvo sozinho alguns segundos depois de cada mudança; "Publicar para a equipe"
// passa o rascunho para a versão que a equipe vê. Se outra pessoa salvar no meio, o editor avisa em vez de apagar.

import { esc, icone, imagem, dataHora, hora, relativo, vazio } from "./util.js";
import { B } from "./dados.js";
import { rpc, enviarArquivo, assinar, listarArquivos, apagarArquivos } from "./nuvem.js";
import { agentesValorant, mapasValorant } from "./valapi.js";
import {
  BALDE, LADOS, FONTES, novoId, textoErro, lerLinkVideo, formatarTempo, urlSegura, htmlMidia, ligarMidias, arquivosDoDoc,
  htmlDocumento, ligarConteudo, textoRico, esquecerTatica, esquecerLista, podeEditarTaticas, selAgente,
} from "./taticas.js";
import { htmlMapaEditor, ligarMapaEditor, novoBlocoMapa, conferirMapa } from "./mapa-tatico.js";
import { htmlSlidesEditor, ligarSlidesEditor, novoBlocoSlides, novoBlocoPdf } from "./taticas-slides.js";

export const LIMITE_IMAGEM = 1.5 * 1024 * 1024;
const TIPOS_BLOCO = [
  ["texto", "Texto", "nota", "Títulos, listas, negrito e links"],
  ["mapa", "Mapa tático", "mapa", "Fases, agentes, rotas e pontos com vídeo"],
  ["video", "Vídeo", "video", "Link do YouTube, Medal, Twitch…, clipe ou round"],
  ["imagem", "Print ou imagem", "imagem", "Capturas da partida, com legenda"],
  ["slides", "Apresentação", "slides", "Slides montados aqui no site"],
  ["pdf", "PDF", "nota", "Um PDF que vira slides (PowerPoint, Canva…)"],
  ["link", "Link", "externo", "Abre fora do site, só ao clicar"],
];
const NOME_TIPO = Object.fromEntries(TIPOS_BLOCO.map(([t, n, i]) => [t, [n, i]]));

let E = null;   // o editor aberto

// ---------- Documento ----------
const copia = (x) => JSON.parse(JSON.stringify(x));
function normalizar(doc) {
  const d = doc && typeof doc === "object" ? copia(doc) : {};
  d.v = 1;
  d.titulo = typeof d.titulo === "string" ? d.titulo : "Nova estratégia";
  d.mapa = typeof d.mapa === "string" && d.mapa ? d.mapa : null;
  d.lado = ["ataque", "defesa", "ambos"].includes(d.lado) ? d.lado : "ataque";
  d.agentes = Array.isArray(d.agentes) ? d.agentes.filter((a) => typeof a === "string").slice(0, 10) : [];
  d.capa = typeof d.capa === "string" ? d.capa : null;
  d.secoes = (Array.isArray(d.secoes) ? d.secoes : []).filter((s) => s && typeof s === "object").map((s) => ({
    id: /^[a-z0-9]{6,16}$/.test(s.id || "") ? s.id : novoId(), nome: typeof s.nome === "string" ? s.nome : "Seção",
    blocos: (Array.isArray(s.blocos) ? s.blocos : []).filter((b) => b && typeof b === "object" && typeof b.tipo === "string"),
  }));
  if (!d.secoes.length) d.secoes.push({ id: novoId(), nome: "Execução", blocos: [] });
  return d;
}
const secaoAtual = () => E.doc.secoes.find((s) => s.id === E.secao) || E.doc.secoes[0];
function acharBloco(id) {
  for (const s of E.doc.secoes) { const i = s.blocos.findIndex((b) => b.id === id); if (i >= 0) return { s, i, b: s.blocos[i] }; }
  return null;
}
const nomeArquivo = (ext) => `${E.equipe}/${E.id}/${Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, "0")).join("")}.${ext}`;

/** Problemas que impedem publicar (o banco confere de novo) */
function conferir(doc) {
  const out = [];
  if (!doc.titulo.trim()) out.push({ texto: "A estratégia está sem nome." });
  for (const s of doc.secoes) {
    if (!s.nome.trim()) out.push({ secao: s.id, texto: "Uma seção está sem nome." });
    s.blocos.forEach((b, i) => {
      const onde = `${s.nome || "Seção"} · bloco ${i + 1}`;
      const p = (texto) => out.push({ secao: s.id, bloco: b.id, texto: `${onde}: ${texto}` });
      if (b.tipo === "imagem" && !b.arquivo) p("imagem ainda não enviada.");
      if (b.tipo === "link" && !urlSegura(b.url)) p("o link precisa começar com https://.");
      if (b.tipo === "video" && !b.midia) p("vídeo sem link (ou o link não é de um site aceito).");
      if (b.tipo === "slides" && !(b.slides || []).length) p("apresentação sem slides.");
      if (b.tipo === "pdf" && !(b.paginas || []).length) p("PDF ainda não enviado.");
      if (b.tipo === "mapa") conferirMapa(b).forEach(p);
    });
  }
  return out;
}

// ---------- Salvar ----------
const CHAVE_LOCAL = (id) => `valreport.tatica.${id}`;
function guardarLocal() {
  try { localStorage.setItem(CHAVE_LOCAL(E.id), JSON.stringify({ versao: E.versao, doc: E.doc, t: Date.now() })); } catch (e) { /* sem armazenamento */ }
}
function limparLocal(id = E?.id) { try { localStorage.removeItem(CHAVE_LOCAL(id)); } catch (e) { /* sem armazenamento */ } }

function status(texto, tipo = "") {
  const el = document.getElementById("tat-status");
  if (el) { el.textContent = texto; el.dataset.tipo = tipo; }
}
export function mudou({ redesenhar = false } = {}) {
  if (!E) return;
  E.mudancas++;
  E.sujo = true;
  status("Alterações ainda não salvas…");
  clearTimeout(E.timer);
  E.timer = setTimeout(() => salvar(), 1400);
  clearTimeout(E.timerLocal);
  E.timerLocal = setTimeout(guardarLocal, 400);
  if (redesenhar) desenhar();
}
async function salvar({ forcar = false } = {}) {
  if (!E || E.conflito && !forcar) return;
  if (E.salvando) { E.deNovo = true; return; }
  clearTimeout(E.timer);
  E.salvando = true;
  const editor = E, marca = editor.mudancas;
  status("Salvando…");
  try {
    const r = await rpc("tatica_salvar_rascunho", { p_id: editor.id, p_doc: editor.doc, p_versao: editor.versao, p_forcar: forcar });
    editor.versao = r.rascunho_versao;
    editor.salvoEm = new Date();
    editor.conflito = null;
    editor.erroValidacao = null;
    if (editor.mudancas === marca) { editor.sujo = false; limparLocal(editor.id); }
    if (editor === E) status(`Rascunho salvo às ${hora(editor.salvoEm.toISOString())} · só a liderança vê até publicar`, "ok");
    if (forcar && editor === E) desenhar();
  } catch (e) {
    const msg = String(e?.message || "");
    if (msg.startsWith("conflito:")) {
      editor.conflito = textoErro(e);
      if (editor === E) desenhar();
    } else if (msg.startsWith("tatica_invalida:")) {
      editor.erroValidacao = textoErro(e);
      if (editor === E) status(`Não salvou: ${editor.erroValidacao}`, "erro");
    } else {
      if (editor === E) status("Sem conexão para salvar agora. Tento de novo em 10 s (as mudanças ficam guardadas neste aparelho).", "erro");
      clearTimeout(editor.timer);
      editor.timer = setTimeout(() => { if (editor === E) salvar(); }, 10000);
    }
  } finally {
    editor.salvando = false;
    if (editor.deNovo) { editor.deNovo = false; if (editor === E) salvar(); }
    else if (editor === E && editor.sujo && !editor.conflito && !editor.erroValidacao && editor.mudancas !== marca) { clearTimeout(editor.timer); editor.timer = setTimeout(() => salvar(), 600); }
  }
}
async function esperarSalvar() {
  for (let i = 0; i < 100 && E?.salvando; i++) await new Promise((r) => setTimeout(r, 100));
}

// ---------- Imagens ----------
const paraBlob = (canvas, tipo, q) => new Promise((ok) => canvas.toBlob(ok, tipo, q));
/** Reduz (lado maior até `max`) e regrava em WebP (ou JPEG): menor e sem os dados escondidos da foto */
export async function prepararImagem(arq, { max = 1920, limite = LIMITE_IMAGEM } = {}) {
  if (!/^image\/(png|jpeg|webp|gif)$/.test(arq.type)) throw new Error("Escolha uma imagem PNG, JPEG ou WebP.");
  if (arq.size > 30 * 1024 * 1024) throw new Error("Essa imagem é grande demais (até 30 MB antes de reduzir).");
  let bmp;
  try { bmp = await createImageBitmap(arq); } catch (e) { throw new Error("Não consegui abrir essa imagem. Tente outra."); }
  return regravar(bmp, bmp.width, bmp.height, { max, limite });
}
export async function regravar(fonte, w, h, { max = 1920, limite = LIMITE_IMAGEM } = {}) {
  const escala = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * escala));
  canvas.height = Math.max(1, Math.round(h * escala));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(fonte, 0, 0, canvas.width, canvas.height);
  fonte.close?.();
  for (const q of [0.86, 0.74, 0.6, 0.45]) {
    let b = await paraBlob(canvas, "image/webp", q);
    if (!b || b.type !== "image/webp") b = await paraBlob(canvas, "image/jpeg", q);
    if (b && b.size <= limite) return b;
  }
  throw new Error("Não consegui deixar a imagem pequena o suficiente. Tente outra.");
}
/** Envia um arquivo para a pasta da estratégia e devolve o caminho */
export async function enviarParaTatica(blob, ext) {
  const caminho = nomeArquivo(ext);
  await enviarArquivo(BALDE, caminho, blob);
  const urls = await assinar(BALDE, [caminho]);
  E.urls[caminho] = urls[caminho];
  return caminho;
}
const extDe = (blob) => (blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg");

// ---------- Desenho ----------
function opcoesMapa() {
  const nomes = E.mapas.map((m) => m.nome);
  if (E.doc.mapa && !nomes.includes(E.doc.mapa)) nomes.push(E.doc.mapa);
  return `<option value="">Qualquer mapa</option>${nomes.map((n) => `<option value="${esc(n)}"${n === E.doc.mapa ? " selected" : ""}>${esc(n)}</option>`).join("")}`;
}
function htmlMeta() {
  const d = E.doc, capa = d.capa && E.urls[d.capa];
  const livres = E.agentes.filter((a) => !d.agentes.includes(a.nome));
  return `<section class="cartao tat-emeta">
      <div class="tat-emeta__capa${capa ? "" : " vazia"}">
        ${capa ? `<img src="${esc(capa)}" alt="Capa da estratégia" referrerpolicy="no-referrer">` : `<span>${icone("imagem")} Capa (opcional)</span>`}
        <div class="tat-emeta__capa-acoes">
          <label class="botao-secundario botao-mini botao-arquivo">${icone("enviar")} ${capa ? "Trocar capa" : "Escolher capa"}
            <input type="file" accept="image/png,image/jpeg,image/webp" data-enviar="capa"></label>
          ${d.capa ? `<button class="botao-secundario botao-mini" type="button" data-acao="tirar-capa">Deixar sem capa</button>` : ""}
        </div>
      </div>
      <div class="tat-emeta__campos">
        <label class="campo tat-emeta__titulo"><span>Nome da estratégia</span><input data-campo="titulo" value="${esc(d.titulo)}" maxlength="60" required></label>
        <label class="campo"><span>Mapa</span><select data-campo="mapa">${opcoesMapa()}</select></label>
        <fieldset class="campo"><legend>Lado</legend><div class="segmentos" role="group">
          ${Object.entries(LADOS).map(([k, t]) => `<button type="button" data-acao="lado" data-valor="${k}" aria-pressed="${d.lado === k}">${esc(k === "ambos" ? "Os dois" : t)}</button>`).join("")}</div></fieldset>
        <div class="campo tat-emeta__comp"><span>Composição <small class="suave">(até 5)</small></span>
          <div class="chips">${d.agentes.map((a) => `<span class="tat-agente tat-agente--tirar">${selAgente(a, E)}<button type="button" data-acao="agente-tirar" data-agente="${esc(a)}" aria-label="Tirar ${esc(a)} da composição">${icone("fechar")}</button></span>`).join("")}
            ${d.agentes.length < 5 ? `<select data-acao="agente-por" aria-label="Pôr agente na composição"><option value="">+ Agente</option>${livres.map((a) => `<option value="${esc(a.nome)}">${esc(a.nome)}</option>`).join("")}</select>` : ""}</div></div>
      </div>
      <p class="form-msg tat-emeta__msg" role="status" hidden></p>
    </section>`;
}

function htmlCorpoBloco(b) {
  switch (b.tipo) {
    case "texto":
      return `<label class="campo"><span class="sr">Texto</span><textarea data-campo="texto" rows="${Math.min(18, Math.max(4, (b.texto || "").split("\n").length + 1))}" maxlength="10000" placeholder="Escreva aqui. Dicas: **negrito**, *itálico*, # título, - lista, 1. lista, [texto](https://link)">${esc(b.texto || "")}</textarea></label>
        <details class="tat-dicas"><summary>Prévia do texto</summary><div class="tat-texto" data-previa-texto>${textoRico(b.texto || "") || `<p class="suave">Nada escrito ainda.</p>`}</div></details>`;
    case "imagem": {
      const url = b.arquivo && E.urls[b.arquivo];
      return `<div class="tat-eimagem">${url ? `<img src="${esc(url)}" alt="${esc(b.legenda || "Imagem")}" referrerpolicy="no-referrer">` : `<span class="suave">${icone("imagem")} Nenhuma imagem ainda</span>`}
          <label class="botao-secundario botao-mini botao-arquivo">${icone("enviar")} ${url ? "Trocar imagem" : "Enviar imagem"}<input type="file" accept="image/png,image/jpeg,image/webp" data-enviar="imagem"></label></div>
        <label class="campo"><span>Legenda <small class="suave">(opcional)</small></span><input data-campo="legenda" value="${esc(b.legenda || "")}" maxlength="300" placeholder="Ex.: round 7, o Cypher deles fica no fundo do A"></label>`;
    }
    case "link":
      return `<label class="campo"><span>Link</span><input data-campo="url" value="${esc(b.url || "")}" maxlength="600" placeholder="https://…" inputmode="url"></label>
        <p class="pequeno ${b.url && !urlSegura(b.url) ? "ruim" : "suave"}" data-link-status>${b.url && !urlSegura(b.url) ? "O link precisa começar com https://" : "Abre fora do site, numa aba nova, só para quem clicar."}</p>
        <div class="grade-2"><label class="campo"><span>Título <small class="suave">(opcional)</small></span><input data-campo="titulo" value="${esc(b.titulo || "")}" maxlength="120"></label>
          <label class="campo"><span>Descrição <small class="suave">(opcional)</small></span><input data-campo="descricao" value="${esc(b.descricao || "")}" maxlength="300"></label></div>`;
    case "video":
      return htmlVideoEditor(b);
    case "mapa":
      return htmlMapaEditor(b, E);
    case "slides":
    case "pdf":
      return htmlSlidesEditor(b, E);
    default:
      return `<p class="suave pequeno">Este tipo de bloco não é editável nesta versão do site.</p>`;
  }
}

/** Fonte do vídeo: link, round de partida ou clipe enviado (usado no bloco de vídeo e nos pontos do mapa) */
export function htmlFonteVideo(alvo, chave, { idAlvo }) {
  const m = alvo.midia;
  const modo = alvo.modo || (m?.fonte === "round" ? "round" : m?.fonte === "arquivo" ? "arquivo" : "link");
  const partidas = (B.partidas || []).slice(0, 80);
  const sel = m?.fonte === "round" ? m : alvo._round || {};   // _round: a escolha pela metade (partida sem round ou o contrário)
  let corpo = "";
  if (modo === "link") {
    const ok = m && !["round", "arquivo"].includes(m.fonte);
    corpo = `<label class="campo"><span>Link do vídeo</span><input data-video-campo="entrada" value="${esc(alvo.entrada ?? (ok ? "" : ""))}" maxlength="600" placeholder="Cole o link do YouTube, Medal, Streamable, Twitch ou Google Drive" inputmode="url"></label>
      <p class="pequeno ${alvo.entrada && !ok ? "ruim" : "suave"}" data-video-status>${ok ? `${icone("verificado")} ${esc(FONTES[m.fonte])}${m.inicio ? ` · começa em ${esc(formatarTempo(m.inicio))}` : ""}. Toca dentro do site.` : alvo.entrada ? "Não reconheci esse link. Aceitos: YouTube (pode ser não listado), Medal, Streamable, clipes da Twitch e Google Drive." : "Dica: no YouTube, use “não listado” para só quem tem o link ver."}</p>`;
  } else if (modo === "round") {
    corpo = partidas.length ? `<div class="grade-2"><label class="campo"><span>Partida</span><select data-video-campo="partida"><option value="">Escolha a partida</option>
        ${partidas.map((p) => `<option value="${esc(p.id)}"${p.id === sel.partida ? " selected" : ""}>${esc(p.mapa)} · ${esc(dataHora(p.t))}${p.placar ? ` · ${Object.values(p.placar).join("–")}` : ""}</option>`).join("")}</select></label>
      <label class="campo"><span>Round</span><input data-video-campo="round" type="number" min="1" max="60" value="${esc(sel.round || "")}" placeholder="7"></label></div>
      <p class="suave pequeno">Abre o round na página da partida, aqui no ValReport.</p>`
      : `<p class="suave pequeno">As partidas da equipe aparecem aqui quando a coleta começar a mandar os dados.</p>`;
  } else {
    const url = m?.fonte === "arquivo" && E.urls[m.ref];
    corpo = `<div class="tat-eclipe">${url ? `<video controls preload="metadata" src="${esc(url)}"></video>` : `<span class="suave">${icone("video")} Nenhum clipe enviado</span>`}
      <label class="botao-secundario botao-mini botao-arquivo">${icone("enviar")} ${url ? "Trocar clipe" : "Enviar clipe (MP4 ou WebM, até 15 MB)"}<input type="file" accept="video/mp4,video/webm" data-enviar="clipe" data-alvo="${esc(idAlvo)}"></label></div>
      <p class="suave pequeno">Para clipes longos, prefira um link do YouTube não listado: o espaço de arquivos da equipe é pequeno.</p>`;
  }
  return `<div class="tat-fonte" data-fonte-de="${esc(idAlvo)}" data-fonte-chave="${esc(chave)}">
    <div class="segmentos" role="group" aria-label="De onde vem o vídeo">
      <button type="button" data-acao="video-modo" data-modo="link" aria-pressed="${modo === "link"}">Link</button>
      <button type="button" data-acao="video-modo" data-modo="round" aria-pressed="${modo === "round"}">Round<span class="tat-longo"> de partida</span></button>
      <button type="button" data-acao="video-modo" data-modo="arquivo" aria-pressed="${modo === "arquivo"}">Clipe<span class="tat-longo"> enviado</span></button>
    </div>${corpo}</div>`;
}
function htmlVideoEditor(b) {
  return `${htmlFonteVideo(b, "bloco", { idAlvo: b.id })}
    <div class="tat-evideo-previa" data-previa-video>${b.midia && b.midia.fonte !== "arquivo" ? htmlMidia(b.midia, E, { titulo: b.titulo }) : ""}</div>
    <div class="grade-2"><label class="campo"><span>Título <small class="suave">(opcional)</small></span><input data-campo="titulo" value="${esc(b.titulo || "")}" maxlength="120" placeholder="Ex.: Flecha de reconhecimento no A"></label>
      <label class="campo"><span>Agente <small class="suave">(opcional)</small></span><select data-campo="ag"><option value="">Nenhum</option>${E.agentes.map((a) => `<option value="${esc(a.nome)}"${a.nome === b.ag ? " selected" : ""}>${esc(a.nome)}</option>`).join("")}</select></label></div>
    <label class="campo"><span>Passo a passo <small class="suave">(um por linha, opcional)</small></span><textarea data-campo="passos" rows="3" maxlength="2800" placeholder="Encoste na caixa do A Main&#10;Mire no pixel do vídeo">${esc((b.passos || []).join("\n"))}</textarea></label>`;
}

function htmlBlocoEditor(b, i, s) {
  const [nome, ic] = NOME_TIPO[b.tipo] || ["Bloco", "info"];
  const outras = E.doc.secoes.filter((x) => x !== s);
  return `<article class="tat-ebloco" data-bloco="${esc(b.id)}" id="bloco-${esc(b.id)}">
      <header class="tat-ebloco__topo"><span class="tat-ebloco__tipo">${icone(ic)} ${esc(nome)}</span>
        <div class="tat-ebloco__acoes">
          <button class="botao-icone botao-mini" type="button" data-acao="bloco-subir" aria-label="Subir bloco"${i === 0 ? " disabled" : ""}>${icone("seta-cima")}</button>
          <button class="botao-icone botao-mini" type="button" data-acao="bloco-descer" aria-label="Descer bloco"${i === s.blocos.length - 1 ? " disabled" : ""}>${icone("seta-baixo")}</button>
          ${outras.length ? `<select data-acao="bloco-mover" aria-label="Mover para outra seção"><option value="">Mover para…</option>${outras.map((o) => `<option value="${esc(o.id)}">${esc(o.nome || "Seção")}</option>`).join("")}</select>` : ""}
          <button class="botao-perigo botao-mini" type="button" data-acao="bloco-apagar">Apagar</button>
        </div></header>
      <div class="tat-ebloco__corpo">${htmlCorpoBloco(b)}</div>
    </article>`;
}

function htmlBarra() {
  return `<div class="tat-ebarra" role="region" aria-label="Edição">
      <span class="selo selo--destaque">${icone("lapis")} Editando</span>
      <span class="tat-ebarra__status" id="tat-status" role="status" aria-live="polite"${E.conflito ? ' data-tipo="erro"' : ""}>${E.conflito ? "Mudanças não salvas: veja o aviso abaixo" : E.salvoEm ? `Rascunho salvo às ${hora(E.salvoEm.toISOString())}` : E.ehRascunho ? `Rascunho${E.rascunhoPor ? ` de ${esc(E.rascunhoPor)}` : ""} · salvo ${esc(relativo(E.rascunhoEm))}` : "Sem mudanças ainda"}</span>
      <div class="tat-ebarra__acoes">
        <button class="botao-secundario botao-mini" type="button" data-acao="previa" aria-pressed="${E.previa}">${icone(E.previa ? "lapis" : "olho")} ${E.previa ? "Voltar a editar" : "Ver como a equipe vê"}</button>
        ${E.publicada ? `<a class="botao-secundario botao-mini" href="#/tatica/${esc(E.id)}">Sair</a>` : `<a class="botao-secundario botao-mini" href="#/equipe/taticas">Sair</a>`}
        <button class="botao-primario botao-mini" type="button" data-acao="publicar">${icone("enviar")} Publicar para a equipe</button>
      </div>
    </div>`;
}

function desenhar({ focar = null } = {}) {
  const raiz = document.getElementById("tat-editor");
  if (!raiz || !E) return;
  const rolagem = window.scrollY;
  const s = secaoAtual();
  E.secao = s.id;
  const avisos = [];
  if (E.conflito) avisos.push(`<div class="aviso aviso--erro tat-conflito">${icone("info")}<span><strong>Outra pessoa editou ao mesmo tempo.</strong> ${esc(E.conflito)} As suas últimas mudanças ainda não foram salvas.</span>
      <div class="lp-acoes"><button class="botao-secundario botao-mini" type="button" data-acao="conflito-recarregar">Ver a versão nova (perco as minhas mudanças)</button>
        <button class="botao-perigo botao-mini" type="button" data-acao="conflito-manter">Manter a minha versão</button></div></div>`);
  if (E.local) avisos.push(`<div class="aviso tat-local">${icone("relogio")}<span>Este aparelho tem mudanças que não chegaram a ser salvas (${esc(relativo(new Date(E.local.t).toISOString()))}).</span>
      <div class="lp-acoes"><button class="botao-primario botao-mini" type="button" data-acao="local-recuperar">Recuperar</button><button class="botao-secundario botao-mini" type="button" data-acao="local-descartar">Descartar</button></div></div>`);
  if (E.problemas?.length) avisos.push(`<div class="aviso aviso--erro tat-problemas"><span><strong>Falta pouco para publicar:</strong></span><ul>${E.problemas.map((p) => `<li>${esc(p.texto)}${p.bloco ? ` <button class="limpar" type="button" data-acao="ir-bloco" data-secao="${esc(p.secao)}" data-alvo="${esc(p.bloco)}">ir até lá</button>` : ""}</li>`).join("")}</ul></div>`);
  const corpo = E.previa
    ? `<div class="aviso">${icone("olho")}<span>Prévia: é assim que a equipe vai ver depois de publicar. Os vídeos e os slides funcionam aqui também.</span></div>
       <div class="tat-previa">${htmlDocumento(E.doc, E, E.secao, {})}</div>`
    : `${htmlMeta()}
      <div class="tat-corpo tat-ecorpo">
        <nav class="tat-secoes tat-esecoes" aria-label="Seções">
          <span class="tat-secoes__titulo">Seções</span>
          ${E.doc.secoes.map((x, i) => `<div class="tat-esecao${x === s ? " ativa" : ""}">
              <button class="tat-secoes__item${x === s ? " ativa" : ""}" type="button" data-acao="secao-abrir" data-secao="${esc(x.id)}"${x === s ? ' aria-current="true"' : ""}><span>${esc(x.nome || "Sem nome")}</span><small>${x.blocos.length}</small></button>
              <span class="tat-esecao__ordem"><button class="botao-icone botao-mini" type="button" data-acao="secao-subir" data-secao="${esc(x.id)}" aria-label="Subir a seção ${esc(x.nome)}"${i === 0 ? " disabled" : ""}>${icone("seta-cima")}</button>
                <button class="botao-icone botao-mini" type="button" data-acao="secao-descer" data-secao="${esc(x.id)}" aria-label="Descer a seção ${esc(x.nome)}"${i === E.doc.secoes.length - 1 ? " disabled" : ""}>${icone("seta-baixo")}</button></span></div>`).join("")}
          <button class="tat-esecoes__nova" type="button" data-acao="secao-nova"${E.doc.secoes.length >= 20 ? " disabled" : ""}>${icone("mais")} Nova seção</button>
          <p class="suave pequeno">Os nomes são livres: Execução, Retake, Vídeos de referência…</p>
        </nav>
        <div class="tat-conteudo">
          <div class="tat-esecao-topo">
            <label class="campo"><span>Nome da seção</span><input data-secao-nome value="${esc(s.nome)}" maxlength="40"></label>
            <button class="botao-perigo botao-mini" type="button" data-acao="secao-apagar"${E.doc.secoes.length < 2 ? ' disabled title="A estratégia precisa de pelo menos uma seção"' : ""}>Apagar seção</button>
          </div>
          ${s.blocos.map((b, i) => htmlBlocoEditor(b, i, s)).join("") || `<p class="suave tat-evazia">Esta seção ainda está vazia. Escolha abaixo o primeiro bloco.</p>`}
          <section class="tat-novo-bloco" aria-label="Adicionar bloco">
            <strong>${icone("mais")} Adicionar nesta seção</strong>
            <div class="tat-novo-bloco__grade">${TIPOS_BLOCO.map(([t, n, ic, d]) => `<button type="button" data-acao="bloco-novo" data-tipo="${t}"${s.blocos.length >= 60 ? " disabled" : ""}>
              <span class="tat-novo-bloco__icone">${icone(ic)}</span><span><strong>${esc(n)}</strong><small>${esc(d)}</small></span></button>`).join("")}</div>
          </section>
        </div>
      </div>
      <section class="cartao secao tat-eperigo"><div class="cartao__titulo"><h3>${E.publicada ? "Desfazer ou apagar" : "Rascunho"}</h3></div>
        <div class="lp-acoes">
          ${E.publicada && E.ehRascunho ? `<button class="botao-secundario" type="button" data-acao="descartar">Descartar esta edição (volta à versão publicada)</button>` : ""}
          ${E.publicada ? `<button class="botao-perigo" type="button" data-acao="apagar">Apagar a estratégia</button>` : `<button class="botao-perigo" type="button" data-acao="descartar">Apagar este rascunho</button>`}
        </div></section>`;
  raiz.innerHTML = `${htmlBarra()}${avisos.join("")}<p class="form-msg tat-emsg" role="status" hidden></p>${corpo}`;
  window.scrollTo(0, rolagem);
  if (E.previa) ligarConteudo(raiz.querySelector(".tat-previa"), E);
  else {
    raiz.querySelectorAll(".tat-ebloco").forEach((el) => {
      const b = acharBloco(el.dataset.bloco)?.b;
      if (!b) return;
      if (b.tipo === "mapa") ligarMapaEditor(el, b, E);
      if (b.tipo === "slides" || b.tipo === "pdf") ligarSlidesEditor(el, b, E);
    });
    ligarMidias(raiz.querySelector(".tat-ecorpo"));
  }
  if (focar) raiz.querySelector(focar)?.focus({ preventScroll: false });
}
export const redesenhar = (opcoes) => desenhar(opcoes);

function aviso(texto, erro = true) {
  const m = document.querySelector("#tat-editor .tat-emsg");
  if (!m) return;
  m.textContent = texto;
  m.className = `form-msg tat-emsg aviso${erro ? " aviso--erro" : ""}`;
  m.hidden = !texto;
  if (texto) m.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// ---------- Ações ----------
function novoBloco(tipo) {
  const id = novoId();
  if (tipo === "texto") return { id, tipo, texto: "" };
  if (tipo === "imagem") return { id, tipo, arquivo: null, legenda: "" };
  if (tipo === "link") return { id, tipo, url: "", titulo: "", descricao: "" };
  if (tipo === "video") return { id, tipo, midia: null, entrada: "", titulo: "", ag: null, passos: [] };
  if (tipo === "mapa") return novoBlocoMapa(id, E);
  if (tipo === "slides") return novoBlocoSlides(id);
  if (tipo === "pdf") return novoBlocoPdf(id);
  return null;
}
function mover(lista, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= lista.length) return false;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  return true;
}

/** Aplica a mudança de um campo de vídeo (link, round ou clipe) num bloco de vídeo ou num ponto do mapa */
export function aplicarCampoVideo(alvo, campo, valor) {
  if (campo === "entrada") {
    alvo.entrada = valor;
    const m = lerLinkVideo(valor);
    alvo.midia = m;
    return Boolean(m);
  }
  if (campo === "partida" || campo === "round") {
    const atual = alvo.midia?.fonte === "round" ? alvo.midia : alvo._round || { fonte: "round" };
    const novo = { fonte: "round", partida: atual.partida || "", round: atual.round || 0, [campo]: campo === "round" ? Math.max(0, Math.min(60, Math.round(Number(valor) || 0))) : String(valor || "") };
    if (novo.partida && novo.round >= 1) { alvo.midia = { fonte: "round", partida: novo.partida, round: novo.round }; delete alvo._round; }
    else { alvo.midia = null; alvo._round = novo; }   // guarda a escolha pela metade enquanto falta a outra parte
    return true;
  }
  return false;
}

async function acao(b, el) {
  const a = b.dataset.acao, s = secaoAtual();
  const bloco = b.closest("[data-bloco]") ? acharBloco(b.closest("[data-bloco]").dataset.bloco) : null;
  switch (a) {
    case "lado": E.doc.lado = b.dataset.valor; mudou({ redesenhar: true }); break;
    case "agente-tirar": E.doc.agentes = E.doc.agentes.filter((x) => x !== b.dataset.agente); mudou({ redesenhar: true }); break;
    case "tirar-capa": E.doc.capa = null; mudou({ redesenhar: true }); break;
    case "secao-abrir": E.secao = b.dataset.secao; E.problemas = null; desenhar(); break;
    case "secao-subir": case "secao-descer": {
      const i = E.doc.secoes.findIndex((x) => x.id === b.dataset.secao);
      if (mover(E.doc.secoes, i, a === "secao-subir" ? -1 : 1)) mudou({ redesenhar: true });
      break;
    }
    case "secao-nova": {
      if (E.doc.secoes.length >= 20) break;
      const nova = { id: novoId(), nome: "Nova seção", blocos: [] };
      E.doc.secoes.push(nova);
      E.secao = nova.id;
      mudou();
      desenhar({ focar: "[data-secao-nome]" });
      document.querySelector("[data-secao-nome]")?.select();
      break;
    }
    case "secao-apagar":
      if (E.doc.secoes.length < 2) break;
      if (s.blocos.length && !confirm(`Apagar a seção "${s.nome}" e os ${s.blocos.length} blocos dela?`)) break;
      E.doc.secoes = E.doc.secoes.filter((x) => x !== s);
      E.secao = E.doc.secoes[0].id;
      mudou({ redesenhar: true });
      break;
    case "bloco-novo": {
      const nb = novoBloco(b.dataset.tipo);
      if (!nb || s.blocos.length >= 60) break;
      s.blocos.push(nb);
      mudou();
      desenhar();
      document.getElementById(`bloco-${nb.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      document.querySelector(`#bloco-${nb.id} textarea, #bloco-${nb.id} input:not([type=file])`)?.focus({ preventScroll: true });
      break;
    }
    case "bloco-subir": case "bloco-descer":
      if (bloco && mover(bloco.s.blocos, bloco.i, a === "bloco-subir" ? -1 : 1)) {
        mudou();
        desenhar();
        document.getElementById(`bloco-${bloco.b.id}`)?.scrollIntoView({ block: "nearest" });
      }
      break;
    case "bloco-apagar":
      if (!bloco) break;
      if (!confirm("Apagar este bloco?")) break;
      bloco.s.blocos.splice(bloco.i, 1);
      mudou({ redesenhar: true });
      break;
    case "video-modo": {
      const alvo = alvoVideo(b);
      if (!alvo) break;
      alvo.modo = b.dataset.modo;
      if ((alvo.midia?.fonte === "round") !== (alvo.modo === "round") || (alvo.midia?.fonte === "arquivo") !== (alvo.modo === "arquivo")) alvo.midia = null;
      mudou({ redesenhar: true });
      break;
    }
    case "ir-bloco":
      E.secao = b.dataset.secao;
      E.previa = false;
      desenhar();
      document.getElementById(`bloco-${b.dataset.alvo}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      document.getElementById(`bloco-${b.dataset.alvo}`)?.classList.add("tat-ebloco--alerta");
      break;
    case "previa": E.previa = !E.previa; desenhar(); window.scrollTo(0, 0); break;
    case "publicar": await publicar(b); break;
    case "descartar": await descartar(b); break;
    case "apagar": await apagar(b); break;
    case "conflito-recarregar":
      limparLocal();
      E = null;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      break;
    case "conflito-manter":
      E.conflito = null;
      await salvar({ forcar: true });
      break;
    case "local-recuperar":
      E.doc = normalizar(E.local.doc);
      E.local = null;
      E.urls = { ...E.urls, ...(await urlsSeguras(arquivosDoDoc(E.doc))) };
      mudou({ redesenhar: true });
      break;
    case "local-descartar": E.local = null; limparLocal(); desenhar(); break;
    default: break;
  }
}
/** O alvo de um campo de vídeo: o bloco de vídeo ou o ponto do mapa (data-fonte-de = id) */
export function alvoVideo(el) {
  const caixa = el.closest("[data-fonte-de]");
  if (!caixa) return null;
  const id = caixa.dataset.fonteDe;
  const achado = acharBloco(id);
  if (achado) return achado.b;
  for (const s of E.doc.secoes) for (const b of s.blocos) {
    if (b.tipo !== "mapa") continue;
    for (const f of b.fases || []) { const it = (f.itens || []).find((x) => x.id === id); if (it) return it; }
  }
  return null;
}
async function urlsSeguras(lista) { try { return await assinar(BALDE, lista); } catch (e) { return {}; } }

async function publicar(botao) {
  const problemas = conferir(E.doc);
  if (problemas.length) { E.problemas = problemas; E.previa = false; desenhar(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  E.problemas = null;
  if (!confirm(E.publicada ? "Publicar esta versão para a equipe? Ela substitui a que a equipe vê agora." : "Publicar a estratégia para a equipe? Jogadores, co-líderes e treinadores passam a ver (convidados não).")) return;
  botao.disabled = true;
  clearTimeout(E.timer);
  await esperarSalvar();
  const editor = E;
  try {
    status("Publicando…");
    const r = await rpc("tatica_publicar", { p_id: editor.id, p_doc: editor.doc, p_versao: editor.versao });
    editor.versao = r.rascunho_versao;
    editor.sujo = false;
    limparLocal(editor.id);
    esquecerTatica(editor.id);
    await limparArquivos(editor, arquivosDoDoc(editor.doc));
    E = null;
    location.hash = `#/tatica/${editor.id}`;
  } catch (e) {
    botao.disabled = false;
    const msg = String(e?.message || "");
    if (msg.startsWith("conflito:")) { editor.conflito = textoErro(e); desenhar(); return; }
    status("Não publicou.", "erro");
    aviso(`Não foi possível publicar: ${textoErro(e)}`);
  }
}
/** Apaga da pasta da estratégia os arquivos que nenhuma versão usa mais */
async function limparArquivos(editor, usados) {
  try {
    const pasta = `${editor.equipe}/${editor.id}`;
    const manter = new Set(usados);
    const lista = await listarArquivos(BALDE, pasta);
    const sobra = lista.map((f) => `${pasta}/${f.nome}`).filter((c) => !manter.has(c));
    if (sobra.length) await apagarArquivos(BALDE, sobra);
  } catch (e) { /* fica para a próxima publicação */ }
}
async function descartar(botao) {
  const publicada = E.publicada;
  if (!confirm(publicada ? "Descartar esta edição? A equipe continua vendo a versão publicada, e o que foi mudado aqui se perde." : "Apagar este rascunho? A estratégia ainda não foi publicada, então ela some.")) return;
  botao.disabled = true;
  clearTimeout(E.timer);
  await esperarSalvar();
  const editor = E;
  try {
    await rpc("tatica_descartar_rascunho", { p_id: editor.id });
    limparLocal(editor.id);
    esquecerTatica(editor.id);
    let usados = [];
    if (publicada) { try { usados = arquivosDoDoc((await rpc("tatica_ler", { p_id: editor.id }))?.doc); } catch (e) { usados = null; } }
    if (usados) await limparArquivos(editor, usados);
    E = null;
    location.hash = publicada ? `#/tatica/${editor.id}` : "#/equipe/taticas";
  } catch (e) { botao.disabled = false; aviso(textoErro(e)); }
}
async function apagar(botao) {
  if (!confirm(`Apagar "${E.doc.titulo}" para sempre? A equipe deixa de ver, e as imagens e os clipes dela também são apagados.`)) return;
  botao.disabled = true;
  clearTimeout(E.timer);
  await esperarSalvar();
  const editor = E;
  try {
    await rpc("tatica_apagar", { p_id: editor.id });
    limparLocal(editor.id);
    esquecerTatica(editor.id);
    await limparArquivos(editor, []);
    E = null;
    location.hash = "#/equipe/taticas";
  } catch (e) { botao.disabled = false; aviso(textoErro(e)); }
}

async function enviarArquivoCampo(input) {
  const arq = input.files?.[0];
  if (!arq) return;
  const tipo = input.dataset.enviar;
  const lugar = input.closest(".tat-ebloco, .tat-emeta, .tat-mapa-editor");
  input.disabled = true;
  const rotulo = input.closest("label");
  const antes = rotulo?.firstChild?.textContent;
  try {
    if (tipo === "clipe") {
      if (!/^video\/(mp4|webm)$/.test(arq.type)) throw new Error("O clipe precisa ser MP4 ou WebM.");
      if (arq.size > 15 * 1024 * 1024) throw new Error("O clipe passou de 15 MB. Corte o trecho ou use um link do YouTube não listado.");
      status("Enviando o clipe…");
      const caminho = await enviarParaTatica(arq, arq.type === "video/webm" ? "webm" : "mp4");
      const alvo = alvoVideo(input);
      if (alvo) { alvo.midia = { fonte: "arquivo", ref: caminho }; alvo.modo = "arquivo"; }
    } else {
      status("Preparando a imagem…");
      const blob = await prepararImagem(arq, tipo === "capa" ? { max: 1600 } : {});
      status("Enviando a imagem…");
      const caminho = await enviarParaTatica(blob, extDe(blob));
      if (tipo === "capa") E.doc.capa = caminho;
      else if (tipo === "imagem") { const x = acharBloco(input.closest("[data-bloco]").dataset.bloco); if (x) x.b.arquivo = caminho; }
    }
    mudou({ redesenhar: true });
  } catch (e) {
    input.disabled = false;
    input.value = "";
    status("Envio não concluído.", "erro");
    aviso(textoErro(e));
    if (rotulo && antes) rotulo.firstChild.textContent = antes;
  }
  void lugar;
}

function campoMudou(el) {
  if (el.matches("[data-campo]") && el.closest(".tat-emeta")) {
    const c = el.dataset.campo;
    if (c === "titulo") E.doc.titulo = el.value.slice(0, 60);
    if (c === "mapa") { E.doc.mapa = el.value || null; mudou({ redesenhar: true }); return; }
    mudou();
    return;
  }
  if (el.matches("[data-secao-nome]")) {
    secaoAtual().nome = el.value.slice(0, 40);
    const item = document.querySelector(`.tat-esecao.ativa .tat-secoes__item span`);
    if (item) item.textContent = el.value || "Sem nome";
    mudou();
    return;
  }
  if (el.matches("[data-video-campo]")) {
    const alvo = alvoVideo(el);
    if (!alvo) return;
    const ok = aplicarCampoVideo(alvo, el.dataset.videoCampo, el.value);
    const caixa = el.closest("[data-fonte-de]");
    const st = caixa?.querySelector("[data-video-status]");
    if (st && el.dataset.videoCampo === "entrada") {
      const m = alvo.midia;
      st.className = `pequeno ${el.value && !ok ? "ruim" : "suave"}`;
      st.innerHTML = ok ? `${icone("verificado")} ${esc(FONTES[m.fonte])}${m.inicio ? ` · começa em ${esc(formatarTempo(m.inicio))}` : ""}. Toca dentro do site.`
        : el.value ? "Não reconheci esse link. Aceitos: YouTube (pode ser não listado), Medal, Streamable, clipes da Twitch e Google Drive." : "Dica: no YouTube, use “não listado” para só quem tem o link ver.";
    }
    const previa = el.closest(".tat-ebloco")?.querySelector("[data-previa-video]");
    if (previa && acharBloco(caixa.dataset.fonteDe)) previa.innerHTML = alvo.midia ? htmlMidia(alvo.midia, E, { titulo: alvo.titulo }) : "";
    mudou();
    return;
  }
  const blocoEl = el.closest("[data-bloco]");
  if (blocoEl && el.matches("[data-campo]")) {
    const x = acharBloco(blocoEl.dataset.bloco);
    if (!x) return;
    const c = el.dataset.campo, b = x.b;
    if (c === "passos") b.passos = el.value.split("\n").map((l) => l.trim().slice(0, 240)).filter(Boolean).slice(0, 12);
    else if (c === "ag") b.ag = el.value || null;
    else b[c] = el.value;
    if (c === "texto") {
      const pv = blocoEl.querySelector("[data-previa-texto]");
      if (pv && blocoEl.querySelector("details")?.open) pv.innerHTML = textoRico(b.texto) || `<p class="suave">Nada escrito ainda.</p>`;
    }
    if (c === "url") {
      const st = blocoEl.querySelector("[data-link-status]");
      if (st) { const ruim = b.url && !urlSegura(b.url); st.className = `pequeno ${ruim ? "ruim" : "suave"}`; st.textContent = ruim ? "O link precisa começar com https://" : "Abre fora do site, numa aba nova, só para quem clicar."; }
    }
    mudou();
  }
}

function ligarEditor(raiz) {
  raiz.addEventListener("click", (ev) => {
    const verSecao = ev.target.closest("[data-ver-secao]");   // seções na prévia
    if (verSecao) { E.secao = verSecao.dataset.verSecao; desenhar(); return; }
    const b = ev.target.closest("[data-acao]");
    if (!b || b.tagName === "SELECT" || !raiz.contains(b)) return;
    if (b.closest(".tat-mapa-editor") && !b.closest("[data-fonte-de]")) return;   // o mapa cuida dos próprios botões
    if (b.closest(".tat-eslides") && !b.closest("[data-fonte-de]")) return;
    acao(b, raiz);
  });
  raiz.addEventListener("input", (ev) => {
    if (ev.target.closest(".tat-mapa-editor") && !ev.target.closest("[data-fonte-de]")) return;
    if (ev.target.closest(".tat-eslides")) return;
    if (ev.target.matches("input:not([type=file]), textarea")) campoMudou(ev.target);
  });
  raiz.addEventListener("change", (ev) => {
    const el = ev.target;
    if (el.matches("input[type=file][data-enviar]") && !el.closest(".tat-eslides")) { enviarArquivoCampo(el); return; }
    if (el.closest(".tat-mapa-editor") && !el.closest("[data-fonte-de]")) return;
    if (el.closest(".tat-eslides")) return;
    if (el.matches("select[data-acao=agente-por]")) { if (el.value && E.doc.agentes.length < 5) { E.doc.agentes.push(el.value); mudou({ redesenhar: true }); } return; }
    if (el.matches("select[data-acao=bloco-mover]")) {
      const x = acharBloco(el.closest("[data-bloco]").dataset.bloco), destino = E.doc.secoes.find((s) => s.id === el.value);
      if (x && destino && destino.blocos.length < 60) { x.s.blocos.splice(x.i, 1); destino.blocos.push(x.b); mudou({ redesenhar: true }); aviso(`Bloco movido para "${destino.nome}".`, false); }
      return;
    }
    if (el.matches("select")) campoMudou(el);
  });
}

// O editor salva sozinho ao sair da página; ao fechar a aba com algo pendente, o navegador pergunta antes
window.addEventListener("beforeunload", (ev) => {
  if (E && (E.sujo || E.salvando) && document.getElementById("tat-editor")) { guardarLocal(); ev.preventDefault(); ev.returnValue = ""; }
});
window.addEventListener("hashchange", () => {
  if (!E || location.hash.startsWith(`#/tatica/${E.id}/editar`)) return;
  const editor = E;
  if (editor.sujo && !editor.conflito) salvar();
  setTimeout(() => { if (E === editor && !document.getElementById("tat-editor")) E = null; }, 15000);
});

// ---------- Tela ----------
export async function viewEditor(id) {
  if (!podeEditarTaticas()) return { titulo: "Tática", html: vazio("Só a liderança e os treinadores editam as táticas") };
  if (innerWidth < 760) {
    return { titulo: "Editar estratégia", html: vazio("A edição das táticas é feita no computador", `<p>No celular dá para ver tudo e assistir aos vídeos. Abra o ValReport no computador para editar.</p><p><a class="botao-secundario" href="#/tatica/${esc(id)}">Ver a estratégia</a></p>`) };
  }
  let dados;
  try { dados = await rpc("tatica_editar", { p_id: id }); } catch (e) {
    return { titulo: "Tática", html: vazio("Não foi possível abrir o editor", `<p>${esc(textoErro(e))}</p><p><a href="#/equipe/taticas">Voltar para as Táticas</a></p>`) };
  }
  if (!dados?.doc) return { titulo: "Tática", html: vazio("Estratégia não encontrada", `<p><a href="#/equipe/taticas">Voltar para as Táticas</a></p>`) };
  const [agentes, mapas] = await Promise.all([agentesValorant(), mapasValorant()]);
  const doc = normalizar(dados.doc);
  const anterior = E?.id === id ? E : null;
  E = {
    id, equipe: dados.equipe_id, doc, versao: dados.rascunho_versao, publicada: dados.publicada, ehRascunho: dados.eh_rascunho,
    rascunhoPor: dados.eu ? "você" : dados.rascunho_por, rascunhoEm: dados.rascunho_em, secao: anterior?.secao || doc.secoes[0].id,
    agentes, mapas, urls: {}, mudancas: 0, sujo: false, salvando: false, previa: false, conflito: null, local: null, problemas: null,
  };
  E.api = { mudou, htmlFonteVideo, aplicarCampoVideo, status, aviso, prepararImagem, regravar, enviarParaTatica };
  Object.defineProperty(E, "mapa", { get() { return this.mapas.find((m) => m.nome.toLowerCase() === String(this.doc.mapa || "").toLowerCase()) || null; } });
  E.urls = await urlsSeguras(arquivosDoDoc(doc));
  try {
    const local = JSON.parse(localStorage.getItem(CHAVE_LOCAL(id)));
    if (local?.doc && local.versao === dados.rascunho_versao && JSON.stringify(local.doc) !== JSON.stringify(dados.doc)) {
      E.local = local;
      E.urls = { ...E.urls, ...(await urlsSeguras(arquivosDoDoc(local.doc))) };
    } else if (local) limparLocal(id);
  } catch (e) { /* sem cópia local */ }
  esquecerLista();
  return {
    titulo: `Editando · ${doc.titulo}`,
    html: `<div class="tatica tat-editor" id="tat-editor"></div>`,
    depois: (el) => { const raiz = el.querySelector("#tat-editor"); ligarEditor(raiz); desenhar(); },
  };
}
