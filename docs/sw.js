// ValReport · service worker (app instalável + leitura offline do que já foi visto)
// Estratégia: o site e os dados vêm sempre da rede primeiro (nunca mostra versão velha quando há internet);
// sem internet, usa a última cópia guardada. Imagens do valorant-api.com ficam guardadas (não mudam).

const VERSAO = "valreport-v3";
const SITE = `${VERSAO}-site`, IMAGENS = `${VERSAO}-imagens`;
const ESSENCIAL = ["./", "index.html", "assets/css/app.css", "assets/js/app.js", "assets/js/util.js", "assets/js/dados.js",
  "assets/js/componentes.js", "assets/js/graficos.js", "assets/js/jogador.js", "assets/js/partida.js", "assets/js/equipe.js",
  "assets/js/sobre.js", "assets/js/recordes.js", "assets/js/animar.js", "assets/js/hoje.js", "assets/fonts/inter-400.woff", "assets/fonts/inter-600.woff",
  "assets/img/logo.svg", "manifest.webmanifest"];
const LIMITE_IMAGENS = 400;

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(SITE).then((c) => c.addAll(ESSENCIAL)).catch(() => null).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => !k.startsWith(VERSAO)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function redePrimeiro(req) {
  const cache = await caches.open(SITE);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  } catch (e) {
    const guardada = await cache.match(req, { ignoreSearch: true });
    if (guardada) return guardada;
    if (req.mode === "navigate") return (await cache.match("index.html")) || Response.error();
    throw e;
  }
}

async function cachePrimeiro(req) {
  const cache = await caches.open(IMAGENS);
  const guardada = await cache.match(req);
  if (guardada) return guardada;
  const resp = await fetch(req);
  if (resp.ok || resp.type === "opaque") {
    cache.put(req, resp.clone());
    cache.keys().then((ks) => { if (ks.length > LIMITE_IMAGENS) ks.slice(0, ks.length - LIMITE_IMAGENS).forEach((k) => cache.delete(k)); });
  }
  return resp;
}

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "media.valorant-api.com") { ev.respondWith(cachePrimeiro(req)); return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;  // editor de notas local: nunca guardar
  ev.respondWith(redePrimeiro(req));
});
