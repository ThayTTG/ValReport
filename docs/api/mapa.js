// GET /api/mapa?u=<uuid do mapa> — o minimapa pelo próprio site (v50).
// O replay 2D lê os pixels do minimapa para achar os corredores (o caminho estimado não atravessa parede);
// o navegador só deixa ler pixels de imagem do mesmo endereço. Só aceita uuid e só busca em media.valorant-api.com.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async function mapa(req, res) {
  const u = String((req.query && req.query.u) || "");
  if (req.method !== "GET" || !UUID.test(u)) { res.statusCode = 400; res.end(); return; }
  try {
    const r = await fetch(`https://media.valorant-api.com/maps/${u}/displayicon.png`);
    const tipo = r.headers.get("content-type") || "";
    if (!r.ok || !tipo.startsWith("image/")) { res.statusCode = 404; res.setHeader("Cache-Control", "public, max-age=600"); res.end(); return; }
    const corpo = Buffer.from(await r.arrayBuffer());
    if (corpo.length > 4 * 1024 * 1024) { res.statusCode = 502; res.end(); return; }
    res.statusCode = 200;
    res.setHeader("Content-Type", tipo);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(corpo);
  } catch {
    res.statusCode = 502;
    res.end();
  }
};
