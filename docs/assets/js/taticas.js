// Táticas (Equipe → Táticas): lista de estratégias, página da estratégia e o que é comum ao editor
// (vídeos que tocam dentro do site, texto com formatação simples, arquivos do balde privado).
// Só a equipe vê (convidados não); líder, co-líderes e treinadores editam (taticas-editor.js).

import { esc, icone, imagem, dataHora, relativo, vazio } from "./util.js";
import { B } from "./dados.js";
import { rpc, assinar } from "./nuvem.js";
import { agentesValorant, mapasValorant } from "./valapi.js";
import { htmlMapaLeitura, ligarMapaLeitura } from "./mapa-tatico.js";

export const BALDE = "taticas";
export const LADOS = { ataque: "Ataque", defesa: "Defesa", ambos: "Ataque e defesa" };
export const FONTES = { youtube: "YouTube", medal: "Medal", streamable: "Streamable", twitch: "Twitch", drive: "Google Drive", arquivo: "Clipe enviado", round: "Round de partida" };
export const TIPOS_PONTO = { pixel: "pixel", lineup: "lineup", posicao: "posição", timing: "timing", outro: "dica" };

/** Quem pode ver e quem pode editar (o banco confere de novo; isto só decide o que aparece) */
export const podeVerTaticas = () => !B.editor && Boolean(B.equipeAtual) && (B.conta?.admin || (B.equipeAtual.cargo && B.equipeAtual.cargo !== "convidado"));
export const podeEditarTaticas = () => !B.editor && Boolean(B.equipeAtual) && (B.conta?.admin || ["lider", "colider", "treinador"].includes(B.equipeAtual.cargo));

export const novoId = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
export const textoErro = (e) => String(e?.message || e || "").replace(/^[a-z_]+: /, "");

// ---------- Texto com formatação simples e segura ----------
// **negrito**, *itálico*, "# título", "## subtítulo", "- lista", "1. lista" e [texto](https://link). Tudo é escapado antes.
function inline(t) {
  return t
    .replace(/\[([^\]\n]{1,200})\]\((https:\/\/[^\s()<>"]{1,500})\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>");
}
export function textoRico(texto) {
  const out = [];
  let lista = null;
  const fechar = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  for (const l of esc(texto || "").split(/\r?\n/)) {
    const ul = l.match(/^\s*[-•]\s+(.*)$/), ol = l.match(/^\s*\d{1,3}[.)]\s+(.*)$/), h = l.match(/^(#{1,2})\s+(.*)$/);
    if (ul || ol) {
      const tipo = ul ? "ul" : "ol";
      if (lista !== tipo) { fechar(); out.push(`<${tipo}>`); lista = tipo; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    fechar();
    if (h) out.push(h[1].length === 1 ? `<h3>${inline(h[2])}</h3>` : `<h4>${inline(h[2])}</h4>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  fechar();
  return out.join("");
}

// ---------- Vídeos: links que tocam dentro do site ----------
const REF_OK = {
  youtube: /^[A-Za-z0-9_-]{11}$/, streamable: /^[a-z0-9]{3,16}$/, twitch: /^[A-Za-z0-9_-]{3,120}$/, drive: /^[A-Za-z0-9_-]{20,80}$/,
  medal: /^(games\/[a-z0-9-]{1,40}\/)?clips?\/[A-Za-z0-9_-]{3,60}(\/[A-Za-z0-9_-]{1,80})?$/,
  arquivo: /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[a-f0-9]{16,32}\.(mp4|webm)$/,
};
/** "1m30s", "90", "1:30" → segundos */
export function lerTempo(t) {
  const s = String(t || "").trim();
  if (!s) return 0;
  let n = 0;
  if (/^\d+$/.test(s)) n = Number(s);
  else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(s)) n = s.split(":").reduce((a, x) => a * 60 + Number(x), 0);
  else { const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/); if (m) n = (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0); }
  return Math.max(0, Math.min(36000, Math.round(n)));
}
export const formatarTempo = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };

/** Link colado → { fonte, ref, inicio } dos sites aceitos (YouTube, Medal, Streamable, Twitch, Google Drive), ou null */
export function lerLinkVideo(texto) {
  let u;
  try { u = new URL(String(texto || "").trim()); } catch (e) { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const partes = u.pathname.split("/").filter(Boolean);
  const inicio = lerTempo(u.searchParams.get("t") || u.searchParams.get("start") || (u.hash.match(/t=([^&]+)/) || [])[1]);
  const com = (fonte, ref) => (ref && REF_OK[fonte].test(ref) ? { fonte, ref, ...(inicio && fonte === "youtube" ? { inicio } : {}) } : null);
  if (["youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
    if (["embed", "shorts", "live", "v"].includes(partes[0])) return com("youtube", partes[1]);
    return com("youtube", u.searchParams.get("v"));
  }
  if (host === "youtu.be") return com("youtube", partes[0]);
  if (host === "streamable.com") return com("streamable", ["e", "o", "s"].includes(partes[0]) ? partes[1] : partes[0]);
  if (host === "clips.twitch.tv") return com("twitch", partes[0] === "embed" ? u.searchParams.get("clip") : partes[0]);
  if (host === "twitch.tv") return com("twitch", partes[1] === "clip" ? partes[2] : null);
  if (host === "medal.tv") {
    const m = u.pathname.match(/^\/((?:games\/[a-z0-9-]{1,40}\/)?clips?\/[A-Za-z0-9_-]{3,60}(?:\/[A-Za-z0-9_-]{1,80})?)/);
    return com("medal", m && m[1]);
  }
  if (host === "drive.google.com") return com("drive", partes[0] === "file" && partes[1] === "d" ? partes[2] : u.searchParams.get("id"));
  return null;
}

/** Endereço do player incorporado (só montado a partir de identificadores conferidos) */
export function urlEmbed(m) {
  if (!m || !REF_OK[m.fonte]?.test(m.ref || "")) return null;
  const r = encodeURIComponent(m.ref);
  switch (m.fonte) {
    case "youtube": return `https://www.youtube-nocookie.com/embed/${r}?autoplay=1&rel=0&modestbranding=1&playsinline=1${m.inicio ? `&start=${Math.round(m.inicio)}` : ""}`;
    case "streamable": return `https://streamable.com/e/${r}?autoplay=1`;
    case "twitch": return `https://clips.twitch.tv/embed?clip=${r}&parent=${encodeURIComponent(location.hostname)}&autoplay=true`;
    case "medal": return `https://medal.tv/${m.ref.split("/").map(encodeURIComponent).join("/").replace(/^((?:games\/[^/]+\/)?)clips\//, "$1clip/")}?autoplay=1&loop=0&cta=0`;
    case "drive": return `https://drive.google.com/file/d/${r}/preview`;
    default: return null;
  }
}
/** Endereço original (para "abrir no site do vídeo") */
export function urlOriginal(m) {
  if (!m || !REF_OK[m.fonte]?.test(m.ref || "")) return null;
  const r = encodeURIComponent(m.ref);
  switch (m.fonte) {
    case "youtube": return `https://www.youtube.com/watch?v=${r}${m.inicio ? `&t=${Math.round(m.inicio)}s` : ""}`;
    case "streamable": return `https://streamable.com/${r}`;
    case "twitch": return `https://clips.twitch.tv/${r}`;
    case "medal": return `https://medal.tv/${m.ref.split("/").map(encodeURIComponent).join("/")}`;
    case "drive": return `https://drive.google.com/file/d/${r}/view`;
    default: return null;
  }
}
export const urlSegura = (u) => (/^https:\/\/[A-Za-z0-9.-]+(:\d{2,5})?(\/[^\s<>"]*)?$/.test(String(u || "")) ? String(u) : null);

/** Mídia de um vídeo, pronta para assistir: player com capa "Assistir" (o vídeo só carrega ao clicar) */
export function htmlMidia(m, ctx, { titulo = "" } = {}) {
  if (!m) return `<div class="tat-midia tat-midia--vazia">${icone("info")} Sem vídeo ainda</div>`;
  if (m.fonte === "round") {
    const p = B.porId?.get(m.partida);
    const sub = p ? `${esc(p.mapa)} · ${esc(dataHora(p.t))}` : "Partida da equipe";
    return `<a class="tat-round" href="#/p/${esc(m.partida)}/rounds?r=${Number(m.round) || 1}">
      <span class="tat-round__n">R${Number(m.round) || "?"}</span>
      <span><strong>${esc(titulo || `Round ${Number(m.round) || "?"}`)}</strong><small>${sub} · abre no ValReport</small></span>${icone("seta")}</a>`;
  }
  if (m.fonte === "arquivo") {
    const url = ctx?.urls?.[m.ref];
    return url ? `<div class="tat-midia"><video controls preload="metadata" playsinline src="${esc(url)}"></video></div>`
      : `<div class="tat-midia tat-midia--vazia">${icone("info")} O clipe não abriu agora. Recarregue a página.</div>`;
  }
  const src = urlEmbed(m);
  if (!src) return `<div class="tat-midia tat-midia--vazia">${icone("info")} Link de vídeo inválido</div>`;
  const original = urlOriginal(m);
  return `<div class="tat-midia" data-embed="${esc(src)}" data-fonte="${esc(m.fonte)}">
      <button class="tat-midia__play" type="button" aria-label="Assistir${titulo ? `: ${esc(titulo)}` : ""} (${esc(FONTES[m.fonte])})">
        <span class="tat-midia__icone"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></span>
        <span class="tat-midia__fonte">${esc(FONTES[m.fonte])}${m.inicio ? ` · começa em ${esc(formatarTempo(m.inicio))}` : ""}</span>
      </button>
    </div>
    ${original ? `<a class="tat-midia__original" href="${esc(original)}" target="_blank" rel="noopener noreferrer">Abrir no ${esc(FONTES[m.fonte])} ${icone("externo")}</a>` : ""}`;
}
/** Troca a capa "Assistir" pelo player (iframe com permissões mínimas) */
export function ligarMidias(raiz) {
  raiz.addEventListener("click", (ev) => {
    const b = ev.target.closest(".tat-midia__play");
    if (!b) return;
    const caixa = b.closest(".tat-midia[data-embed]");
    const src = caixa?.dataset.embed;
    if (!src || !/^https:\/\/(www\.youtube-nocookie\.com|streamable\.com|clips\.twitch\.tv|medal\.tv|drive\.google\.com)\//.test(src)) return;
    const f = document.createElement("iframe");
    f.src = src;
    f.title = b.getAttribute("aria-label") || "Vídeo";
    f.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
    f.allowFullscreen = true;
    f.referrerPolicy = "strict-origin-when-cross-origin";
    f.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox");
    f.loading = "lazy";
    caixa.replaceChildren(f);
    caixa.classList.add("tocando");
  });
}

// ---------- Arquivos do documento ----------
/** Todos os arquivos que o documento usa (capa, imagens, slides, páginas de PDF e clipes) */
export function arquivosDoDoc(doc) {
  const out = new Set();
  const add = (c) => { if (typeof c === "string" && c) out.add(c); };
  add(doc?.capa);
  for (const s of doc?.secoes || []) for (const b of s.blocos || []) {
    if (b.tipo === "imagem") add(b.arquivo);
    if (b.tipo === "video" && b.midia?.fonte === "arquivo") add(b.midia.ref);
    if (b.tipo === "slides") (b.slides || []).forEach((x) => add(x.imagem));
    if (b.tipo === "pdf") (b.paginas || []).forEach(add);
    if (b.tipo === "mapa") for (const f of b.fases || []) for (const it of f.itens || []) if (it.midia?.fonte === "arquivo") add(it.midia.ref);
  }
  return [...out];
}
export async function urlsDoDoc(doc) {
  const lista = arquivosDoDoc(doc);
  if (!lista.length) return {};
  try { return await assinar(BALDE, lista); } catch (e) { return {}; }
}

// ---------- Blocos (leitura) ----------
const imagemArquivo = (url, alt, classe = "") => (url ? `<img class="${esc(classe)}" src="${esc(url)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : "");

function htmlSlides(b, ctx) {
  const slides = b.tipo === "pdf"
    ? (b.paginas || []).map((p, i) => ({ id: `p${i}`, imagem: p, pagina: true }))
    : (b.slides || []);
  if (!slides.length) return `<p class="suave pequeno">Apresentação sem slides ainda.</p>`;
  const total = slides.length;
  return `<div class="tat-slides" data-total="${total}" data-atual="0" tabindex="0" aria-roledescription="apresentação" aria-label="${esc(b.titulo || (b.tipo === "pdf" ? b.nome || "PDF" : "Apresentação"))}">
      <div class="tat-slides__palco">${slides.map((s, i) => `<div class="tat-slide${s.pagina ? " tat-slide--pagina" : ""}${s.imagem && !s.pagina ? " tat-slide--com-imagem" : ""}" data-i="${i}"${i ? " hidden" : ""} role="group" aria-label="Slide ${i + 1} de ${total}">
        ${s.pagina ? imagemArquivo(ctx.urls?.[s.imagem], `Página ${i + 1}`) || `<span class="suave">Página ${i + 1} não abriu</span>`
          : `<div class="tat-slide__texto">${s.titulo ? `<strong class="tat-slide__titulo">${esc(s.titulo)}</strong>` : ""}${s.texto ? `<div class="tat-slide__corpo">${textoRico(s.texto)}</div>` : ""}</div>
             ${s.imagem ? `<div class="tat-slide__imagem">${imagemArquivo(ctx.urls?.[s.imagem], s.titulo || `Slide ${i + 1}`)}</div>` : ""}`}
      </div>`).join("")}</div>
      <div class="tat-slides__barra">
        <button class="botao-icone" type="button" data-slide="-1" aria-label="Slide anterior">${icone("voltar")}</button>
        <span class="tat-slides__n" aria-live="polite">1 / ${total}</span>
        <button class="botao-icone" type="button" data-slide="1" aria-label="Próximo slide">${icone("seta")}</button>
        <button class="botao-icone" type="button" data-slide-tela aria-label="Tela cheia">${icone("expandir")}</button>
      </div>
    </div>`;
}
export function ligarSlides(raiz) {
  const mover = (caixa, delta) => {
    const total = Number(caixa.dataset.total), atual = (Number(caixa.dataset.atual) + delta + total) % total;
    caixa.dataset.atual = String(atual);
    caixa.querySelectorAll(".tat-slide").forEach((s) => { s.hidden = Number(s.dataset.i) !== atual; });
    caixa.querySelector(".tat-slides__n").textContent = `${atual + 1} / ${total}`;
  };
  raiz.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-slide], [data-slide-tela]");
    if (!b) return;
    const caixa = b.closest(".tat-slides");
    if (b.hasAttribute("data-slide-tela")) {
      if (document.fullscreenElement) document.exitFullscreen?.(); else caixa.requestFullscreen?.().catch(() => null);
      return;
    }
    mover(caixa, Number(b.dataset.slide));
  });
  raiz.addEventListener("keydown", (ev) => {
    const caixa = ev.target.closest?.(".tat-slides");
    if (!caixa || !["ArrowLeft", "ArrowRight"].includes(ev.key)) return;
    ev.preventDefault();
    mover(caixa, ev.key === "ArrowRight" ? 1 : -1);
  });
  // no celular, arrastar o dedo para o lado troca o slide
  let toque = null;
  raiz.addEventListener("touchstart", (ev) => {
    const palco = ev.target.closest?.(".tat-slides__palco");
    toque = palco && ev.touches.length === 1 ? { caixa: palco.closest(".tat-slides"), x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null;
  }, { passive: true });
  raiz.addEventListener("touchend", (ev) => {
    if (!toque) return;
    const t = ev.changedTouches[0], dx = t.clientX - toque.x, dy = t.clientY - toque.y, caixa = toque.caixa;
    toque = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5 && Number(caixa.dataset.total) > 1) mover(caixa, dx < 0 ? 1 : -1);
  }, { passive: true });
}

/** Um bloco já pronto para ler. ctx = { urls, agentes, mapa, doc } */
export function htmlBloco(b, ctx) {
  switch (b.tipo) {
    case "texto":
      return b.texto?.trim() ? `<article class="tat-bloco tat-bloco--texto"><div class="tat-texto">${textoRico(b.texto)}</div></article>` : "";
    case "imagem": {
      const url = ctx.urls?.[b.arquivo];
      return `<figure class="tat-bloco tat-bloco--imagem">${url ? `<button class="tat-imagem" type="button" data-ampliar="${esc(url)}" aria-label="Ampliar a imagem${b.legenda ? `: ${esc(b.legenda)}` : ""}">${imagemArquivo(url, b.legenda || "Imagem da estratégia")}</button>` : `<div class="tat-midia tat-midia--vazia">Imagem ainda não enviada</div>`}
        ${b.legenda ? `<figcaption>${esc(b.legenda)}</figcaption>` : ""}</figure>`;
    }
    case "link": {
      const url = urlSegura(b.url);
      if (!url) return "";
      let dominio = "";
      try { dominio = new URL(url).hostname.replace(/^www\./, ""); } catch (e) { /* já conferido */ }
      return `<article class="tat-bloco"><a class="tat-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">
          <span class="tat-link__icone">${icone("externo")}</span>
          <span class="tat-link__texto"><strong>${esc(b.titulo || dominio)}</strong>${b.descricao ? `<span>${esc(b.descricao)}</span>` : ""}<small>${esc(dominio)} · abre fora do site</small></span></a></article>`;
    }
    case "video":
      return `<article class="tat-bloco tat-bloco--video">
          ${b.titulo || b.ag ? `<div class="tat-bloco__topo">${b.ag ? selAgente(b.ag, ctx) : ""}${b.titulo ? `<h3>${esc(b.titulo)}</h3>` : ""}</div>` : ""}
          ${htmlMidia(b.midia, ctx, { titulo: b.titulo })}
          ${(b.passos || []).filter(Boolean).length ? `<ol class="tat-passos">${b.passos.filter(Boolean).map((p) => `<li>${esc(p)}</li>`).join("")}</ol>` : ""}</article>`;
    case "mapa":
      return `<article class="tat-bloco tat-bloco--mapa">${b.titulo ? `<h3>${esc(b.titulo)}</h3>` : ""}${htmlMapaLeitura(b, ctx)}</article>`;
    case "slides":
    case "pdf":
      return `<article class="tat-bloco tat-bloco--slides">${b.titulo ? `<h3>${esc(b.titulo)}</h3>` : ""}${htmlSlides(b, ctx)}
        ${b.tipo === "pdf" && b.nome ? `<p class="suave pequeno">${icone("nota")} ${esc(b.nome)} · ${(b.paginas || []).length} página${(b.paginas || []).length === 1 ? "" : "s"}</p>` : ""}</article>`;
    default:
      return "";
  }
}
/** Selo de agente com o ícone */
export function selAgente(nome, ctx) {
  const a = ctx?.agentes?.find((x) => x.nome.toLowerCase() === String(nome).toLowerCase());
  return `<span class="tat-agente">${imagem(a?.icone, "", "", "")}${esc(nome)}</span>`;
}

/** Liga o que é interativo dentro de uma seção já desenhada (vídeos, slides, mapa e imagens ampliadas) */
export function ligarConteudo(raiz, ctx) {
  ligarMidias(raiz);
  ligarSlides(raiz);
  ligarMapaLeitura(raiz, ctx);
  raiz.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-ampliar]");
    if (!b) return;
    abrirImagem(b.dataset.ampliar, b.querySelector("img")?.alt || "");
  });
}
function abrirImagem(url, alt) {
  const caixa = document.createElement("div");
  caixa.className = "tat-ampliada";
  caixa.setAttribute("role", "dialog");
  caixa.setAttribute("aria-modal", "true");
  caixa.setAttribute("aria-label", alt || "Imagem ampliada");
  caixa.innerHTML = `<button class="botao-icone tat-ampliada__fechar" type="button" aria-label="Fechar">${icone("fechar")}</button>${imagemArquivo(url, alt)}`;
  const fechar = () => { caixa.remove(); document.removeEventListener("keydown", tecla); };
  const tecla = (ev) => { if (ev.key === "Escape") fechar(); };
  caixa.addEventListener("click", (ev) => { if (ev.target === caixa || ev.target.closest(".tat-ampliada__fechar")) fechar(); });
  document.addEventListener("keydown", tecla);
  document.body.append(caixa);
  caixa.querySelector("button").focus();
}

// ---------- Lista ----------
let cacheLista = null;   // { equipe, t, dados }
export const esquecerLista = () => { cacheLista = null; };
async function lerLista() {
  const equipe = B.equipeAtual.id;
  if (cacheLista?.equipe === equipe && Date.now() - cacheLista.t < 30000) return cacheLista.dados;
  const dados = await rpc("taticas_listar", { p_equipe: equipe });
  cacheLista = { equipe, t: Date.now(), dados };
  return dados;
}

/** Quantas estratégias a equipe tem em cada mapa (para a aba Mapas); null se não deu para ler agora */
export async function contarTaticasPorMapa() {
  if (!podeVerTaticas()) return null;
  try {
    const dados = await lerLista();
    const out = new Map();
    for (const t of dados.taticas || []) if (t.mapa) out.set(t.mapa, (out.get(t.mapa) || 0) + 1);
    return out;
  } catch (e) { return null; }
}

function cartaoTatica(t, urls, mapas) {
  const capa = t.capa && urls[t.capa];
  // sem foto escolhida, o cartão usa a faixa do mapa (como os cartões da aba Mapas)
  const faixa = !capa && mapas.find((m) => m.nome.toLowerCase() === String(t.mapa || "").toLowerCase())?.faixa;
  const resumo = t.resumo || {};
  const busca = [t.titulo, t.mapa, ...(t.agentes || []), ...(resumo.secoes || [])].filter(Boolean).join(" ").toLowerCase();
  return `<a class="tat-cartao" href="#/tatica/${esc(t.id)}${t.publicada ? "" : "/editar"}" data-busca="${esc(busca)}">
      <div class="tat-cartao__capa${capa ? "" : faixa ? " tat-cartao__capa--mapa" : " tat-cartao__capa--vazia"}">
        ${capa ? imagemArquivo(capa, "", "") : faixa ? `<img src="${esc(faixa)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-sefalhar="ocultar">` : `<span class="tat-cartao__mapa">${esc(t.mapa || "Geral")}</span>`}
        <span class="tat-cartao__selos"><span class="selo selo--escuro">${esc(t.mapa || "Qualquer mapa")}</span><span class="selo selo--lado-${esc(t.lado)}">${esc(LADOS[t.lado] || "")}</span></span>
      </div>
      <div class="tat-cartao__corpo">
        <strong class="tat-cartao__titulo">${esc(t.titulo || "Sem nome")}</strong>
        ${(resumo.secoes || []).length ? `<span class="tat-cartao__secoes">${resumo.secoes.slice(0, 4).map((s) => `<span class="selo">${esc(s)}</span>`).join("")}${resumo.secoes.length > 4 ? `<span class="selo">+${resumo.secoes.length - 4}</span>` : ""}</span>` : ""}
        <span class="tat-cartao__meta">
          ${resumo.videos ? `<span>${icone("video")} ${resumo.videos} vídeo${resumo.videos === 1 ? "" : "s"}</span>` : ""}
          ${resumo.pontos ? `<span>${icone("pino")} ${resumo.pontos} ponto${resumo.pontos === 1 ? "" : "s"}</span>` : ""}
          ${!t.publicada ? `<span class="selo selo--alerta">Rascunho, só a liderança vê</span>` : t.tem_rascunho ? `<span class="selo selo--alerta">Edição em andamento</span>` : ""}
          <span class="tat-cartao__autor">${t.autor ? `por ${esc(t.autor)} · ` : ""}${esc(relativo(t.atualizada_em))}</span>
        </span>
      </div></a>`;
}

/** Conteúdo da aba Táticas. q: tm (mapa), tl (lado). Devolve { html, depois }. */
export async function viewTaticas(q) {
  if (!podeVerTaticas()) {
    return { html: vazio("Táticas são só da equipe", "<p>Convidados não veem as estratégias. Fale com a liderança se você deveria ver.</p>") };
  }
  let dados;
  try { dados = await lerLista(); } catch (e) {
    return { html: vazio("Não foi possível abrir as táticas", `<p>${esc(textoErro(e))}</p>`) };
  }
  const lista = dados.taticas || [];
  const mapaSel = q.get("tm") || "", ladoSel = ["ataque", "defesa"].includes(q.get("tl")) ? q.get("tl") : "";
  const mapasUsados = [...new Set(lista.map((t) => t.mapa || "Geral"))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filtrada = lista.filter((t) => (!mapaSel || (t.mapa || "Geral") === mapaSel) && (!ladoSel || t.lado === ladoSel || t.lado === "ambos"));
  const [urls, mapas] = await Promise.all([
    (async () => { try { return await assinar(BALDE, filtrada.map((t) => t.capa).filter(Boolean)); } catch (e) { return {}; } })(),
    mapasValorant().catch(() => []),
  ]);
  let planos = [];
  if (dados.pode_editar) { try { planos = await rpc("taticas_planos_pendentes", { p_equipe: B.equipeAtual.id }); } catch (e) { planos = []; } }
  const chip = (valor, texto, param, atual) => `<button class="chip${valor === atual ? " ativo" : ""}" type="button" data-param="${param}" data-valor="${esc(valor)}" aria-pressed="${valor === atual}">${esc(texto)}</button>`;
  const html = `<section class="tat-lista-pagina">
    <div class="tat-topo">
      <div><h2 class="tat-topo__titulo">Táticas</h2>
        <p class="suave">Estratégias da ${esc(B.equipeAtual?.nome || "equipe")}, com desenhos no mapa, vídeos, prints e apresentações. Só a equipe vê; convidados não.</p></div>
      ${dados.pode_editar ? `<button class="botao-primario" type="button" data-nova-tatica>${icone("mais")} Nova estratégia</button>` : ""}
    </div>
    ${planos.length ? `<div class="aviso secao tat-planos">${icone("nota")}<span>${planos.length === 1 ? "Há 1 plano de mapa" : `Há ${planos.length} planos de mapa`} nas Notas da IGL (${esc(planos.map((p) => p.mapa).join(", "))}). Cada um pode virar uma estratégia aqui, com o mesmo texto.</span>
      <button class="botao-secundario botao-mini" type="button" data-importar-planos>Trazer para as Táticas</button></div>` : ""}
    ${lista.length ? `<div class="tat-filtros cartao">
        <label class="tat-busca">${icone("busca")}<span class="sr">Procurar estratégia</span><input type="search" placeholder="Procurar por nome, agente ou seção" data-tat-busca autocomplete="off"></label>
        <div class="chips" role="group" aria-label="Mapa">${chip("", "Todos os mapas", "tm", mapaSel)}${mapasUsados.map((m) => chip(m, m, "tm", mapaSel)).join("")}</div>
        <div class="segmentos" role="group" aria-label="Lado">
          <button type="button" data-param="tl" data-valor="" aria-pressed="${!ladoSel}">Todos</button>
          <button type="button" data-param="tl" data-valor="ataque" aria-pressed="${ladoSel === "ataque"}">Ataque</button>
          <button type="button" data-param="tl" data-valor="defesa" aria-pressed="${ladoSel === "defesa"}">Defesa</button>
        </div>
      </div>
      <p class="suave pequeno tat-contagem" aria-live="polite">${filtrada.length} estratégia${filtrada.length === 1 ? "" : "s"}${mapaSel ? ` em ${esc(mapaSel)}` : ""}</p>
      ${filtrada.length ? `<div class="tat-grade">${filtrada.map((t) => cartaoTatica(t, urls, mapas)).join("")}</div>` : vazio("Nenhuma estratégia com estes filtros")}
      <p class="vazio tat-sem-resultado" hidden><strong>Nenhuma estratégia com esse nome</strong></p>`
      : vazio("Nenhuma estratégia ainda", dados.pode_editar ? "<p>Crie a primeira em <strong>Nova estratégia</strong>: dá para montar seções com textos, desenhos no mapa, vídeos, prints e apresentações.</p>" : "<p>Quando a liderança publicar uma estratégia, ela aparece aqui.</p>")}
    <p class="form-msg" role="status" hidden></p>
  </section>`;
  return {
    html,
    depois: (el) => {
      const msg = el.querySelector(".tat-lista-pagina > .form-msg");
      const erro = (e) => { msg.textContent = textoErro(e); msg.className = "form-msg aviso aviso--erro"; msg.hidden = false; };
      el.querySelector("[data-tat-busca]")?.addEventListener("input", (ev) => {
        const t = ev.target.value.trim().toLowerCase();
        let n = 0;
        el.querySelectorAll(".tat-cartao").forEach((c) => { const ok = !t || c.dataset.busca.includes(t); c.hidden = !ok; if (ok) n++; });
        el.querySelector(".tat-sem-resultado").hidden = n > 0;
        el.querySelector(".tat-contagem").textContent = `${n} estratégia${n === 1 ? "" : "s"}`;
      });
      el.querySelector("[data-nova-tatica]")?.addEventListener("click", async (ev) => {
        const b = ev.currentTarget;
        b.disabled = true;
        try {
          const id = await rpc("tatica_criar", { p_equipe: B.equipeAtual.id, p_titulo: "Nova estratégia", p_mapa: mapaSel && mapaSel !== "Geral" ? mapaSel : null, p_lado: ladoSel || "ataque" });
          esquecerLista();
          location.hash = `#/tatica/${id}/editar`;
        } catch (e) { erro(e); b.disabled = false; }
      });
      el.querySelector("[data-importar-planos]")?.addEventListener("click", async (ev) => {
        const b = ev.currentTarget;
        b.disabled = true;
        try {
          await rpc("taticas_importar_planos", { p_equipe: B.equipeAtual.id });
          esquecerLista();
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        } catch (e) { erro(e); b.disabled = false; }
      });
    },
  };
}

// ---------- Página da estratégia ----------
const cacheTatica = new Map();   // id -> { t, dados }
export const esquecerTatica = (id) => { cacheTatica.delete(id); esquecerLista(); };
async function lerTatica(id) {
  const c = cacheTatica.get(id);
  if (c && Date.now() - c.t < 30000) return c.dados;
  const dados = await rpc("tatica_ler", { p_id: id });
  if (dados) cacheTatica.set(id, { t: Date.now(), dados });
  return dados;
}

/** Contexto comum à leitura e à prévia do editor: endereços dos arquivos, agentes e o mapa da estratégia */
export async function contextoDoc(doc) {
  const [urls, agentes, mapas] = await Promise.all([urlsDoDoc(doc), agentesValorant(), mapasValorant()]);
  const mapa = mapas.find((m) => m.nome.toLowerCase() === String(doc?.mapa || "").toLowerCase()) || null;
  return { urls, agentes, mapas, mapa, doc };
}

/** Capa + seções + blocos da seção escolhida (usado na página e na prévia do editor) */
export function htmlDocumento(doc, ctx, secaoId, { meta = "", acoes = "", aviso = "", baseLink = null } = {}) {
  const secoes = doc.secoes || [];
  const secao = secoes.find((s) => s.id === secaoId) || secoes[0];
  const capa = doc.capa && ctx.urls?.[doc.capa];
  const faixa = !capa && ctx.mapa?.faixa;   // sem foto, a faixa do mapa
  const corpo = (secao?.blocos || []).map((b) => htmlBloco(b, ctx)).filter(Boolean).join("");
  const linkSecao = (s) => (baseLink ? `href="${esc(baseLink)}?s=${esc(s.id)}"` : `type="button" data-ver-secao="${esc(s.id)}"`);
  const tagSecao = baseLink ? "a" : "button";
  return `<section class="tat-capa${capa || faixa ? " tat-capa--foto" : ""}">
      ${capa ? imagemArquivo(capa, "", "tat-capa__img") : faixa ? `<img class="tat-capa__img" src="${esc(faixa)}" alt="" decoding="async" referrerpolicy="no-referrer" data-sefalhar="ocultar">` : ""}
      <div class="tat-capa__info">
        <div class="tat-capa__texto">
          <div class="chips"><span class="selo selo--escuro">${esc(doc.mapa || "Qualquer mapa")}</span><span class="selo selo--lado-${esc(doc.lado)}">${esc(LADOS[doc.lado] || "")}</span>
            ${(doc.agentes || []).map((a) => selAgente(a, ctx)).join("")}</div>
          <h1>${esc(doc.titulo || "Sem nome")}</h1>
          ${meta ? `<p class="tat-capa__meta">${meta}</p>` : ""}
        </div>
        ${acoes ? `<div class="tat-capa__acoes">${acoes}</div>` : ""}
      </div>
    </section>
    ${aviso}
    <div class="tat-corpo">
      <nav class="tat-secoes" aria-label="Seções da estratégia">
        <span class="tat-secoes__titulo">Nesta estratégia</span>
        ${secoes.map((s) => `<${tagSecao} class="tat-secoes__item${s === secao ? " ativa" : ""}" ${linkSecao(s)}${s === secao ? ' aria-current="true"' : ""}>
          <span>${esc(s.nome)}</span><small>${(s.blocos || []).length}</small></${tagSecao}>`).join("")}
      </nav>
      <div class="tat-conteudo">
        <h2 class="tat-conteudo__titulo">${esc(secao?.nome || "")}</h2>
        ${corpo || `<div class="vazio"><strong>Seção vazia</strong><p>Ainda não há nada nesta seção.</p></div>`}
      </div>
    </div>`;
}

export async function viewTatica(id, sub, q) {
  if (!podeVerTaticas()) return { titulo: "Tática", html: vazio("Táticas são só da equipe", "<p>Convidados não veem as estratégias.</p>") };
  if (sub === "editar") {
    const { viewEditor } = await import("./taticas-editor.js");
    return viewEditor(id);
  }
  let t;
  try { t = await lerTatica(id); } catch (e) {
    return { titulo: "Tática", html: vazio("Não foi possível abrir a estratégia", `<p>${esc(textoErro(e))}</p>`) };
  }
  if (!t) return { titulo: "Tática", html: vazio("Estratégia não encontrada", `<p>Ela pode ter sido apagada. <a href="#/equipe/taticas">Voltar para as Táticas</a></p>`) };
  if (!t.doc) {   // nunca publicada: só quem edita chega aqui, e vai direto para o editor
    location.replace(`#/tatica/${encodeURIComponent(id)}/editar`);
    return { titulo: "Tática", html: "" };
  }
  const ctx = await contextoDoc(t.doc);
  const meta = `${t.publicada_por ? `Publicada por ${esc(t.publicada_por)} · ` : ""}atualizada ${esc(relativo(t.publicada_em))}`;
  const acoes = `<button class="botao-secundario" type="button" data-copiar-link>${icone("link")} Copiar link</button>
    ${t.pode_editar ? `<a class="botao-primario" href="#/tatica/${esc(id)}/editar">${icone("lapis")} ${t.tem_rascunho ? "Continuar edição" : "Editar"}</a>` : ""}`;
  const aviso = t.tem_rascunho ? `<p class="aviso secao">${icone("relogio")}<span>Há uma edição em andamento${t.rascunho_por ? ` de ${esc(t.rascunho_por)}` : ""} (${esc(relativo(t.rascunho_em))}), ainda não publicada. A equipe continua vendo esta versão.</span></p>` : "";
  return {
    titulo: t.doc.titulo,
    html: `<div class="tatica">
      <a class="tat-voltar" href="#/equipe/taticas">${icone("voltar")} Táticas</a>
      ${htmlDocumento(t.doc, ctx, q.get("s"), { meta, acoes, aviso, baseLink: `#/tatica/${id}` })}
      <p class="form-msg" role="status" hidden></p></div>`,
    depois: (el) => {
      // liga no contêiner da página (refeito a cada visita), nunca no <main>: senão os cliques se acumulam entre as seções
      ligarConteudo(el.querySelector(".tatica"), ctx);
      el.querySelector("[data-copiar-link]")?.addEventListener("click", async () => {
        const msg = el.querySelector(".tatica > .form-msg");
        const url = `${location.origin}${location.pathname}#/tatica/${id}`;
        try { await navigator.clipboard.writeText(url); msg.textContent = "Link copiado ✓ (só a equipe consegue abrir)"; }
        catch (e) { msg.textContent = url; }
        msg.className = "form-msg aviso"; msg.hidden = false;
      });
    },
  };
}
