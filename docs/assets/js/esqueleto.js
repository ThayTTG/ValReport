// Esqueletos de carregamento (v40): blocos cinza com brilho no formato de cada página, no lugar do "Carregando…".
// Aparecem só quando a página demora (ver app.js) e somem sozinhos quando o conteúdo chega.

const b = (classe = "", estilo = "") => `<span class="esq ${classe}"${estilo ? ` style="${estilo}"` : ""}></span>`;
const cartao = (dentro, classe = "", alto = 0) => `<div class="esq-cartao ${classe}"${alto ? ` style="min-height:${alto}px"` : ""}>${dentro}</div>`;
const repetir = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join("");
const linhas = (n) => repetir(n, (i) => b("esq--texto", `width:${[92, 78, 85, 64, 88][i % 5]}%`));

const cabecalho = () => cartao(`<div class="esq-linha">${b("esq--foto")}<div class="esq-pilha" style="flex:1">${b("esq--titulo", "width:40%")}${b("esq--texto", "width:55%")}</div>${b("esq--pilula", "width:140px;height:44px")}</div>`, "esq-cabecalho");
const abas = (n = 7) => `<div class="esq-linha esq-abas">${repetir(n, (i) => b("esq--pilula", `width:${[96, 82, 90, 104, 78, 88, 92, 80][i % 8]}px`))}</div>`;
const blocos = (n, alto = 96) => `<div class="esq-grade">${repetir(n, () => cartao(`${b("esq--texto", "width:45%")}${b("esq--numero")}${b("esq--texto", "width:70%")}`, "", alto))}</div>`;
const lista = (n) => `<div class="esq-pilha">${repetir(n, () => cartao(`<div class="esq-linha">${b("esq--icone")}<div class="esq-pilha" style="flex:1">${b("esq--texto", "width:35%")}${b("esq--texto", "width:55%")}</div>${b("esq--texto", "width:90px")}</div>`))}</div>`;

const MODELOS = {
  inicio: () => `<div class="esq-duas">${cartao(`${b("esq--texto", "width:30%")}${b("esq--titulo", "width:60%")}${linhas(2)}`, "esq-alto")}${cartao(`<div class="esq-linha">${b("esq--foto")}<div class="esq-pilha" style="flex:1">${b("esq--texto", "width:40%")}${b("esq--titulo", "width:50%")}</div></div>`, "esq-alto")}</div>
    ${blocos(4)}${b("esq--titulo", "width:180px;margin:22px 0 12px")}${lista(4)}`,
  equipe: () => `${cabecalho()}${abas(8)}${blocos(4)}<div class="esq-grade esq-grade--largo">${repetir(3, () => cartao(`<div class="esq-linha">${b("esq--foto")}<div class="esq-pilha" style="flex:1">${b("esq--titulo", "width:50%")}${b("esq--texto", "width:70%")}</div></div>${linhas(3)}`, "esq-alto"))}</div>`,
  jogador: () => `${cabecalho()}${abas(8)}${abas(5)}${blocos(4)}<div class="esq-duas">${cartao(`${b("esq--texto", "width:40%")}${b("esq--numero", "width:30%;height:52px")}${linhas(4)}`, "esq-alto")}${cartao(`${b("esq--texto", "width:30%")}${lista(3)}`, "esq-alto")}</div>`,
  partida: () => `${cabecalho()}${abas(5)}${cartao(`${repetir(10, () => `<div class="esq-linha esq-tabela">${b("esq--icone")}${b("esq--texto", "flex:1")}${repetir(5, () => b("esq--texto", "width:48px"))}</div>`)}`)}`,
  plan: () => `<div class="esq-linha">${repetir(7, () => b("esq--pilula", "width:110px;height:34px"))}</div><div class="esq-grade esq-grade--5">${repetir(5, () => cartao(`${b("esq--foto", "margin:0 auto")}${b("esq--texto", "width:60%;margin:8px auto 0")}`, "esq-alto"))}</div>
    <div class="esq-duas">${cartao(blocos(3, 140), "esq-alto")}${cartao(blocos(3, 140), "esq-alto")}</div>`,
  agenda: () => `<div class="esq-linha">${b("esq--titulo", "width:220px")}${b("esq--pilula", "width:120px;margin-left:auto")}${b("esq--pilula", "width:120px")}</div>
    <div class="esq-agenda"><div class="esq-cal">${repetir(35, () => b("esq--dia"))}</div>${cartao(`${b("esq--texto", "width:60%")}${lista(2)}`, "esq-alto")}</div>`,
  lista: () => `${b("esq--titulo", "width:240px;margin-bottom:14px")}${lista(6)}`,
};

/** O esqueleto de um tipo de página (inicio, equipe, jogador, partida, plan, agenda, lista) */
export function esqueleto(tipo = "lista") {
  return `<div class="esqueleto" role="status" aria-live="polite" aria-label="Carregando"><span class="so-leitor">Carregando…</span>${(MODELOS[tipo] || MODELOS.lista)()}</div>`;
}

/** Qual esqueleto combina com a rota (partes do endereço) */
export function esqueletoDaRota(partes) {
  if (!partes.length) return "inicio";
  if (partes[0] === "equipe") return ["agenda"].includes(partes[1]) ? "agenda" : ["mappool", "comps", "calls"].includes(partes[1]) ? "plan" : "equipe";
  if (partes[0] === "j") return "jogador";
  if (partes[0] === "p") return "partida";
  return "lista";
}
