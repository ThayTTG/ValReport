// Utilidades: formatação pt-BR, imagens (valorant-api.com), traduções e pequenos componentes HTML

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtCache = new Map();
function fmt(casas) {
  if (!fmtCache.has(casas)) fmtCache.set(casas, new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
  return fmtCache.get(casas);
}
export const num = (v, casas = 0) => (v == null || Number.isNaN(v) || !Number.isFinite(v) ? "—" : fmt(casas).format(v));
export const pct = (frac, casas = 0) => (frac == null || !Number.isFinite(frac) ? "—" : `${num(frac * 100, casas)}%`);
export const sinal = (v, casas = 1, sufixo = "") => {
  if (v == null || !Number.isFinite(v)) return "—";
  const t = num(Math.abs(v), casas);
  return `${v > 0.0001 ? "+" : v < -0.0001 ? "−" : ""}${t}${sufixo}`;
};
export const div = (a, b) => (b ? a / b : null);
export const classeSinal = (v, lim = 0.5) => (v == null ? "" : v >= lim ? "bom" : v <= -lim ? "ruim" : "neutro");
export const classeNivel = (v, bom, ruim) => (v == null ? "" : v >= bom ? "bom" : v < ruim ? "ruim" : "meio");

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const data = (iso) => (iso ? new Date(iso) : null);
export const dataCurta = (iso) => { const d = data(iso); return d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}` : "—"; };
export const hora = (iso) => { const d = data(iso); return d ? `${String(d.getHours()).padStart(2, "0")}h${String(d.getMinutes()).padStart(2, "0")}` : ""; };
export const dataHora = (iso) => (iso ? `${dataCurta(iso)} · ${hora(iso)}` : "—");
export const diaLongo = (iso) => { const d = data(iso); return d ? `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}` : "—"; };
export const chaveDia = (iso) => { const d = data(iso); return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : ""; };
export const duracao = (s) => (s ? `${Math.round(s / 60)} min` : "—");
export function relativo(iso, ref = new Date()) {
  const d = data(iso); if (!d) return "—";
  const min = Math.round((ref - d) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60); if (h < 24) return `há ${h} h`;
  const dias = Math.round(h / 24); if (dias < 31) return `há ${dias} dia${dias > 1 ? "s" : ""}`;
  return dataCurta(iso);
}

// ---------- Traduções ----------
export const FILAS = { competitive: "Competitivo", premier: "Premier", custom: "Personalizada", unrated: "Sem classificação", swiftplay: "Swiftplay" };
export const nomeFila = (id) => FILAS[id] || (id ? id[0].toUpperCase() + id.slice(1) : "Outra");
export const TIPOS = { pistol: "Pistol", eco: "Eco", force: "Force", armado: "Armado", "anti-eco": "Anti-eco" };
export const FUNCOES_ICONE = { Duelista: "⚔", Iniciador: "◎", Controlador: "◐", Sentinela: "▣" };
const TIERS = { Iron: "Ferro", Bronze: "Bronze", Silver: "Prata", Gold: "Ouro", Platinum: "Platina", Diamond: "Diamante", Ascendant: "Ascendente", Immortal: "Imortal", Radiant: "Radiante", Unrated: "Sem rank", Unranked: "Sem rank" };
export const nomeTier = (tn) => { if (!tn) return "Sem rank"; const [a, b] = tn.split(" "); return (TIERS[a] || a) + (b ? ` ${b}` : ""); };
const ORDEM_TIERS = ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Diamond", "Ascendant", "Immortal"];
/** Nome do elo pelo número do tier (3 = Ferro 1 ... 27 = Radiante) */
export const nomeTierId = (id) => (id >= 27 ? "Radiante" : id >= 3 ? `${TIERS[ORDEM_TIERS[Math.floor((id - 3) / 3)]]} ${((id - 3) % 3) + 1}` : "Sem rank");
/** Gráficos em SVG ficam mais estreitos no celular para o texto não ficar minúsculo */
export const larguraGrafico = () => (innerWidth <= 600 ? 380 : innerWidth >= 1000 ? 900 : 640);
export const FIM_ROUND = { Elimination: "Eliminação", Detonate: "Spike detonada", Defuse: "Spike desarmada", "": "Tempo esgotado" };
export const CERIMONIAS = { Ace: "Ace", TeamAce: "Ace da equipe", Clutch: "Clutch", Flawless: "Perfeito", Thrifty: "Econômico", Closer: "Fechou" };

// ---------- Imagens ----------
const CDN = "https://media.valorant-api.com";
let META = null;
export const definirMeta = (m) => { META = m; };
export const imgAgente = (nome) => { const u = META?.agentes?.[nome]?.uuid; return u ? `${CDN}/agents/${u}/displayicon.png` : null; };
export const imgAgenteRetrato = (nome) => { const u = META?.agentes?.[nome]?.uuid; return u ? `${CDN}/agents/${u}/fullportrait.png` : null; };
export const uuidMapa = (nome) => META?.mapas?.[nome]?.uuid;
export const imgMapaFaixa = (nome) => { const u = uuidMapa(nome); return u ? `${CDN}/maps/${u}/listviewicon.png` : null; };
export const imgMapaSplash = (nome) => { const u = uuidMapa(nome); return u ? `${CDN}/maps/${u}/splash.png` : null; };
export const imgMinimapa = (nome) => { const u = uuidMapa(nome); return u ? `${CDN}/maps/${u}/displayicon.png` : null; };
export const imgArma = (nome) => { const u = META?.armas?.[nome]; return u ? `${CDN}/weapons/${u}/displayicon.png` : null; };
export const imgArmaKill = (nome) => { const u = META?.armas?.[nome]; return u ? `${CDN}/weapons/${u}/killstreamicon.png` : null; };
export const imgCard = (uuid, tipo = "smallart") => (uuid ? `${CDN}/playercards/${uuid}/${tipo}.png` : null);
export const imgRank = (tier) => (tier && META?.tiers_uuid ? `${CDN}/competitivetiers/${META.tiers_uuid}/${tier}/smallicon.png` : null);

const iniciais = (t) => esc(String(t || "?").replace(/[^A-Za-zÀ-ú0-9 ]/g, "").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?");
export function imagem(src, alt, classe = "", texto = alt) {
  if (texto === "") return src ? `<img class="${esc(classe)}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-sefalhar="ocultar">` : "";
  if (!src) return `<span class="${esc(classe)} avatar-vazio" aria-hidden="true">${iniciais(texto)}</span>`;
  return `<img class="${esc(classe)}" src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-iniciais="${iniciais(texto)}">`;
}
// Imagem quebrada vira um selo com as iniciais
document.addEventListener("error", (ev) => {
  const el = ev.target;
  if (el.tagName === "IMG" && el.dataset.sefalhar === "ocultar") { el.style.display = "none"; return; }
  if (el.tagName === "IMG" && el.dataset.sefalhar === "texto" && !el.dataset.falhou) {
    el.dataset.falhou = "1";
    const s = document.createElement("span");
    s.className = "arma-txt"; s.textContent = el.alt;
    el.replaceWith(s); return;
  }
  if (el.tagName === "IMG" && el.dataset.iniciais !== undefined && !el.dataset.falhou) {
    el.dataset.falhou = "1";
    const s = document.createElement("span");
    s.className = `${el.className} avatar-vazio`;
    s.textContent = el.dataset.iniciais;
    s.setAttribute("aria-hidden", "true");
    el.replaceWith(s);
  }
}, true);

/** Markdown simples e seguro para as notas: **negrito**, *itálico*, listas com "- " e parágrafos */
export function md(texto) {
  const linhas = esc(texto || "").split(/\r?\n/);
  const out = [];
  let lista = false;
  const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>");
  for (const l of linhas) {
    const item = l.match(/^\s*[-•]\s+(.*)$/);
    if (item) { if (!lista) { out.push("<ul>"); lista = true; } out.push(`<li>${inline(item[1])}</li>`); continue; }
    if (lista) { out.push("</ul>"); lista = false; }
    out.push(l.trim() ? `<p>${inline(l)}</p>` : "");
  }
  if (lista) out.push("</ul>");
  return out.join("");
}

export const icone = (id, classe = "") => `<svg class="${classe}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

// ---------- Componentes ----------
export const selo = (texto, tipo = "") => `<span class="selo ${tipo ? `selo--${tipo}` : ""}">${texto}</span>`;
export const barra = (frac, tipo = "") => `<div class="barra ${tipo ? `barra--${tipo}` : ""}"><span style="width:${Math.max(0, Math.min(100, (frac || 0) * 100)).toFixed(1)}%"></span></div>`;
export const tile = (rotulo, valor, sub = "", classe = "") =>
  `<div class="tile"><div class="tile__rotulo">${esc(rotulo)}</div><div class="tile__valor ${classe}">${valor}</div>${sub ? `<div class="tile__sub">${sub}</div>` : ""}</div>`;
export const destaque = (rotulo, valor, sub = "", classe = "") =>
  `<div class="destaque"><div class="destaque__rotulo">${esc(rotulo)}</div><div class="destaque__valor ${classe}">${valor}</div>${sub ? `<div class="destaque__sub">${sub}</div>` : ""}</div>`;
export const vazio = (titulo, texto = "") => `<div class="vazio"><strong>${esc(titulo)}</strong>${texto}</div>`;
export const cartao = (titulo, corpo, extra = "") =>
  `<section class="cartao">${titulo ? `<div class="cartao__titulo"><h3>${esc(titulo)}</h3>${extra}</div>` : ""}${corpo}</section>`;
export const secao = (titulo, corpo, extra = "") =>
  `<section class="secao"><div class="secao__titulo"><h2>${esc(titulo)}</h2>${extra}</div>${corpo}</section>`;

export function escala(indice, margem) {
  const [lo, hi] = margem || [indice, indice];
  return `<div class="escala" role="img" aria-label="Índice ${indice}, margem de ${lo} a ${hi}. Linha do meio = 50, média da função.">
    <div class="escala__margem" style="left:${lo}%;width:${Math.max(2, hi - lo)}%"></div>
    <div class="escala__media"></div><div class="escala__ponto" style="left:${indice}%"></div></div>`;
}

export function guardar(chave, valor) { try { localStorage.setItem(`valreport.${chave}`, JSON.stringify(valor)); } catch (e) { /* sem armazenamento */ } }
export function ler(chave, padrao) { try { const v = localStorage.getItem(`valreport.${chave}`); return v == null ? padrao : JSON.parse(v); } catch (e) { return padrao; } }
