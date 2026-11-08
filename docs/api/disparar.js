// POST /api/disparar — "Coletar agora" do Sync: chama a coleta na nuvem (GitHub Actions) na hora, sem esperar os 20 minutos.
// Quem pede manda o login do site (Authorization: Bearer <token do Supabase>); o banco confere se é a administradora e
// segura o ritmo (no máximo 1 por minuto e 30 por hora) na função admin_nuvem_disparo. O token do GitHub fica só aqui,
// na variável VALREPORT_GITHUB_TOKEN do Vercel (fine-grained, só Actions: leitura e escrita no ThayTTG/ValReport).
// Nada de segredo volta na resposta, nem no log.

const SUPABASE_URL = process.env.VALREPORT_SUPABASE_URL || "https://qmstulzsoizdrhqwcrbu.supabase.co";
const SUPABASE_CHAVE = process.env.VALREPORT_SUPABASE_CHAVE || "sb_publishable_fOqA_YiWnDKoBhHMv4z7bw_qjl23we-";   // pública (a mesma do site)
const GITHUB_API = process.env.VALREPORT_GITHUB_API || "https://api.github.com";
const REPO = "ThayTTG/ValReport", FLUXO = "coleta.yml", EQUIPE = "juventus-academy";

function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(corpo));
}

async function lerJson(r) {
  try { return await r.json(); } catch { return null; }
}

module.exports = async function disparar(req, res) {
  if (req.method !== "POST") return responder(res, 405, { ok: false, codigo: "metodo", motivo: "Use POST." });
  const jwt = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt || jwt.length > 4096) return responder(res, 401, { ok: false, codigo: "login", motivo: "Entre no site de novo." });
  const token = process.env.VALREPORT_GITHUB_TOKEN;
  if (!token) return responder(res, 503, { ok: false, codigo: "sem_token", motivo: "Falta o token do GitHub no Vercel (VALREPORT_GITHUB_TOKEN)." });

  // 1. A administradora? E dá para chamar agora? (o banco decide e anota)
  let d;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_nuvem_disparo`, {
      method: "POST",
      headers: { apikey: SUPABASE_CHAVE, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: EQUIPE }),
    });
    d = await lerJson(r);
    if (r.status === 401 || r.status === 403) return responder(res, 403, { ok: false, codigo: "admin", motivo: "Somente a administradora chama a coleta." });
    if (r.status === 404) return responder(res, 503, { ok: false, codigo: "sem_sql", motivo: "Falta aplicar o supabase/nuvem.sql no banco." });
    if (!r.ok) return responder(res, 502, { ok: false, codigo: "banco", motivo: "O banco não respondeu direito; tente de novo em instantes." });
  } catch {
    return responder(res, 502, { ok: false, codigo: "banco", motivo: "Não deu para falar com o banco agora." });
  }
  if (!d?.pode) return responder(res, 429, { ok: false, codigo: "espera", motivo: d?.motivo || "Espere um pouco antes de chamar de novo." });

  // 2. Chama o fluxo "coleta.yml" no GitHub
  try {
    const g = await fetch(`${GITHUB_API}/repos/${REPO}/actions/workflows/${FLUXO}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ValReport", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { motivo: "site" } }),
    });
    if (g.status === 204 || g.status === 200) return responder(res, 200, { ok: true, motivo: "A nuvem começou a coletar; em 2 a 4 minutos o resultado aparece aqui." });
    const motivo = g.status === 401 ? "O token do GitHub no Vercel venceu ou está errado (VALREPORT_GITHUB_TOKEN)."
      : g.status === 403 || g.status === 404 ? "O token do GitHub não tem permissão de Actions (leitura e escrita) no ThayTTG/ValReport."
      : g.status === 422 ? "O GitHub recusou: confira se o fluxo “Coleta” está ativo na aba Actions."
      : "O GitHub não aceitou agora; tente de novo em instantes.";
    console.error(`disparar: GitHub respondeu ${g.status}`);
    return responder(res, 502, { ok: false, codigo: `github_${g.status}`, motivo });
  } catch {
    return responder(res, 502, { ok: false, codigo: "github", motivo: "Não deu para falar com o GitHub agora." });
  }
};
