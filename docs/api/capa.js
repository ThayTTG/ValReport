// GET /api/capa?v=<id do YouTube> — a capa do vídeo pelo próprio site (v33).
// Assim a imagem é "do mesmo endereço": nenhuma regra de segurança (CSP) nem bloqueador derruba a prévia das táticas.
// Só aceita ids do YouTube (11 caracteres) e só busca em i.ytimg.com. A CDN da Vercel guarda a resposta por 7 dias.

const ID = /^[A-Za-z0-9_-]{11}$/;

module.exports = async function capa(req, res) {
  const v = String((req.query && req.query.v) || "");
  if (req.method !== "GET" || !ID.test(v)) { res.statusCode = 400; res.end(); return; }
  try {
    // hqdefault existe para todo vídeo; mqdefault fica de reserva
    let r = await fetch(`https://i.ytimg.com/vi/${v}/hqdefault.jpg`);
    if (!r.ok) r = await fetch(`https://i.ytimg.com/vi/${v}/mqdefault.jpg`);
    const tipo = r.headers.get("content-type") || "";
    if (!r.ok || !tipo.startsWith("image/")) { res.statusCode = 404; res.setHeader("Cache-Control", "public, max-age=600"); res.end(); return; }
    const corpo = Buffer.from(await r.arrayBuffer());
    if (corpo.length > 2 * 1024 * 1024) { res.statusCode = 502; res.end(); return; }
    res.statusCode = 200;
    res.setHeader("Content-Type", tipo);
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(corpo);
  } catch {
    res.statusCode = 502;
    res.end();
  }
};
