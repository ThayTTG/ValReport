// ValReport · função "riot" (Supabase Edge Function)
// Confirma o Riot ID de uma pessoa: a administradora (ou a liderança da equipe dela) confirma que a conta é dela,
// e a função busca na API o puuid, o card e o nível. Também atualiza o card/nível e desliga o Riot ID.
// (O desafio do card continua aqui, mas o site não usa: a API só muda o card depois de uma partida.)
// Como colar: Supabase → Edge Functions → Deploy a new function → Via Editor → nome "riot" → apague o exemplo,
// cole este arquivo inteiro → Deploy. Segredos (Edge Functions → Secrets): HENRIKDEV_API_KEY e VALREPORT_SECRET_KEY.

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const CHAVE = Deno.env.get("VALREPORT_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HENRIK = Deno.env.get("HENRIKDEV_API_KEY") ?? "";
const HENRIK_URL = (Deno.env.get("HENRIKDEV_URL") ?? "https://api.henrikdev.xyz").replace(/\/$/, "");
const MINUTOS_DESAFIO = 15;
const ESPERA_ENTRE_CONFERIDAS_S = 6;
const ESPERA_ATUALIZAR_MIN = 10;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class Problema extends Error {
  codigo: string;
  status: number;
  constructor(codigo: string, mensagem: string, status = 400) {
    super(mensagem);
    this.codigo = codigo;
    this.status = status;
  }
}

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------- Banco (com a chave secreta: só esta função escreve o Riot ID) ----------
async function banco(caminho: string, metodo = "GET", corpo?: unknown, prefer?: string) {
  const cab: Record<string, string> = { apikey: CHAVE, "Content-Type": "application/json", Accept: "application/json" };
  if (CHAVE.startsWith("eyJ")) cab.Authorization = `Bearer ${CHAVE}`;
  if (prefer) cab.Prefer = prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    method: metodo, headers: cab, body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await r.text();
  if (!r.ok) {
    let j: { message?: string; code?: string } = {};
    try { j = JSON.parse(texto); } catch { /* sem corpo */ }
    if (j.code === "23505") throw new Problema("riot_em_uso", "Esse Riot ID já está ligado a outra conta. Fale com a administradora.", 409);
    throw new Problema("banco", `O banco recusou (${r.status}): ${j.message ?? texto.slice(0, 200)}`, 500);
  }
  return texto ? JSON.parse(texto) : null;
}
const um = async (caminho: string) => ((await banco(caminho)) as unknown[])[0] ?? null;

async function quemEsta(req: Request): Promise<string> {
  const aut = req.headers.get("Authorization") ?? "";
  if (!aut.startsWith("Bearer ")) throw new Problema("sem_login", "Entre na sua conta primeiro.", 401);
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: CHAVE, Authorization: aut } });
  if (!r.ok) throw new Problema("sem_login", "Sua sessão terminou. Entre de novo.", 401);
  const u = await r.json();
  if (!u?.id) throw new Problema("sem_login", "Sua sessão terminou. Entre de novo.", 401);
  return u.id as string;
}

// ---------- HenrikDev ----------
type Conta = { puuid: string; nome: string; tag: string; card: string; titulo: string | null; nivel: number | null };

function separar(riot: string): [string, string] {
  const m = /^\s*([^#]{3,16})#([A-Za-z0-9]{2,5})\s*$/.exec(riot ?? "");
  if (!m) throw new Problema("formato", "Escreva o Riot ID no formato Nome#TAG (ex.: NokyTTG#1178).");
  return [m[1].trim(), m[2]];
}

async function lerConta(caminho: string): Promise<Conta> {
  if (!HENRIK) throw new Problema("config", "A chave da HenrikDev não está configurada na função.", 500);
  const r = await fetch(`${HENRIK_URL}${caminho}${caminho.includes("?") ? "&" : "?"}force=true`, { headers: { Authorization: HENRIK } });
  if (r.status === 404) throw new Problema("nao_encontrado", "Não encontramos esse Riot ID. Confira o nome e a tag.", 404);
  if (r.status === 429) throw new Problema("api_ocupada", "A API do VALORANT está ocupada. Tente de novo em alguns segundos.", 429);
  if (!r.ok) throw new Problema("api", `A API do VALORANT não respondeu agora (erro ${r.status}). Tente de novo daqui a pouco.`, 502);
  const d = (await r.json())?.data ?? {};
  const card = typeof d.card === "string" ? d.card : d.card?.id;
  if (!d.puuid || !card) throw new Problema("api", "A API não trouxe o card dessa conta. Tente de novo daqui a pouco.", 502);
  const titulo = typeof d.title === "string" ? d.title : d.title?.id ?? null;
  return { puuid: d.puuid, nome: d.name, tag: d.tag, card, titulo: titulo || null, nivel: d.account_level ?? null };
}
const contaPorRiot = (riot: string) => {
  const [nome, tag] = separar(riot);
  return lerConta(`/valorant/v2/account/${encodeURIComponent(nome)}/${encodeURIComponent(tag)}`);
};
const contaPorPuuid = (puuid: string) => lerConta(`/valorant/v2/by-puuid/account/${encodeURIComponent(puuid)}`);

async function conferirDono(puuid: string, usuario: string) {
  const outro = await um(`perfis?riot_puuid=eq.${encodeURIComponent(puuid)}&select=id`) as { id: string } | null;
  if (outro && outro.id !== usuario) throw new Problema("riot_em_uso", "Esse Riot ID já está ligado a outra conta. Fale com a administradora.", 409);
}

async function gravarVerificado(usuario: string, c: Conta, verificadoEm: string | null) {
  const agora = new Date().toISOString();
  await banco(`perfis?id=eq.${usuario}`, "PATCH", {
    riot_id: `${c.nome}#${c.tag}`, riot_puuid: c.puuid, riot_card: c.card, riot_titulo: c.titulo, riot_nivel: c.nivel,
    riot_verificado_em: verificadoEm ?? agora, riot_atualizado_em: agora,
  }, "return=minimal");
  return { riot_id: `${c.nome}#${c.tag}`, riot_card: c.card, riot_titulo: c.titulo, riot_nivel: c.nivel };
}

// ---------- Ações ----------
type Desafio = { riot_id: string; riot_puuid: string; card_inicial: string; card_trocado: string | null; passo: number; expira_em: string; ultimo_pedido: string };

async function iniciar(usuario: string, riot: string) {
  const c = await contaPorRiot(riot);
  await conferirDono(c.puuid, usuario);
  const expira = new Date(Date.now() + MINUTOS_DESAFIO * 60_000).toISOString();
  await banco("desafios_riot?on_conflict=usuario_id", "POST", {
    usuario_id: usuario, riot_id: `${c.nome}#${c.tag}`, riot_puuid: c.puuid, card_inicial: c.card, card_trocado: null,
    passo: 1, expira_em: expira, ultimo_pedido: new Date().toISOString(),
  }, "resolution=merge-duplicates,return=minimal");
  return { passo: 1, riot_id: `${c.nome}#${c.tag}`, card_inicial: c.card, expira_em: expira };
}

async function conferir(usuario: string) {
  const d = await um(`desafios_riot?usuario_id=eq.${usuario}&select=*`) as Desafio | null;
  if (!d) throw new Problema("sem_desafio", "Nenhum desafio em andamento. Comece de novo.", 404);
  if (new Date(d.expira_em).getTime() < Date.now()) {
    await banco(`desafios_riot?usuario_id=eq.${usuario}`, "DELETE");
    throw new Problema("expirou", `O desafio passou de ${MINUTOS_DESAFIO} minutos e expirou. Comece de novo.`, 410);
  }
  const base = { riot_id: d.riot_id, card_inicial: d.card_inicial, expira_em: d.expira_em };
  const espera = ESPERA_ENTRE_CONFERIDAS_S * 1000 - (Date.now() - new Date(d.ultimo_pedido).getTime());
  if (espera > 0) return { ...base, passo: d.passo, espere_s: Math.ceil(espera / 1000) };
  await banco(`desafios_riot?usuario_id=eq.${usuario}`, "PATCH", { ultimo_pedido: new Date().toISOString() }, "return=minimal");
  const c = await contaPorPuuid(d.riot_puuid);
  if (d.passo === 1) {
    if (c.card === d.card_inicial) return { ...base, passo: 1, card_atual: c.card, mudou: false };
    await banco(`desafios_riot?usuario_id=eq.${usuario}`, "PATCH", { passo: 2, card_trocado: c.card }, "return=minimal");
    return { ...base, passo: 2, card_atual: c.card, mudou: true };
  }
  if (c.card !== d.card_inicial) return { ...base, passo: 2, card_atual: c.card, mudou: false };
  await conferirDono(c.puuid, usuario);
  const perfil = await gravarVerificado(usuario, c, null);
  await banco(`desafios_riot?usuario_id=eq.${usuario}`, "DELETE");
  return { verificado: true, ...perfil };
}

async function atualizar(usuario: string) {
  const p = await um(`perfis?id=eq.${usuario}&select=riot_puuid,riot_verificado_em,riot_atualizado_em`) as
    { riot_puuid: string | null; riot_verificado_em: string | null; riot_atualizado_em: string | null } | null;
  if (!p?.riot_puuid || !p.riot_verificado_em) throw new Problema("sem_riot", "Verifique o seu Riot ID primeiro.", 400);
  const desde = p.riot_atualizado_em ? (Date.now() - new Date(p.riot_atualizado_em).getTime()) / 60_000 : Infinity;
  if (desde < ESPERA_ATUALIZAR_MIN) {
    throw new Problema("cedo", `Dá para atualizar de novo em ${Math.ceil(ESPERA_ATUALIZAR_MIN - desde)} min.`, 429);
  }
  return { atualizado: true, ...(await gravarVerificado(usuario, await contaPorPuuid(p.riot_puuid), p.riot_verificado_em)) };
}

async function desvincular(usuario: string) {
  await banco(`desafios_riot?usuario_id=eq.${usuario}`, "DELETE");
  await banco(`perfis?id=eq.${usuario}`, "PATCH", {
    riot_id: null, riot_puuid: null, riot_card: null, riot_titulo: null, riot_nivel: null, riot_verificado_em: null, riot_atualizado_em: null,
  }, "return=minimal");
  return { desvinculado: true };
}

async function adminVerificar(usuario: string, alvo: string, riot: string) {
  if (!(await um(`administradores?usuario_id=eq.${usuario}&select=usuario_id`))) {
    throw new Problema("sem_permissao", "Somente a administradora.", 403);
  }
  if (!/^[0-9a-f-]{36}$/.test(alvo ?? "")) throw new Problema("formato", "Pessoa inválida.");
  if (!(await um(`perfis?id=eq.${alvo}&select=id`))) throw new Problema("sem_perfil", "Essa pessoa ainda não completou o cadastro.", 404);
  const c = await contaPorRiot(riot);
  await conferirDono(c.puuid, alvo);
  return { verificado: true, ...(await gravarVerificado(alvo, c, null)) };
}

// A liderança (líder ou co-líder) confirma o Riot ID de alguém da própria equipe aprovada
async function liderVerificar(usuario: string, alvo: string, riot: string) {
  if (!/^[0-9a-f-]{36}$/.test(alvo ?? "")) throw new Problema("formato", "Pessoa inválida.");
  const ehAdmin = Boolean(await um(`administradores?usuario_id=eq.${usuario}&select=usuario_id`));
  if (!ehAdmin) {
    const minhas = (await banco(`membros?usuario_id=eq.${usuario}&cargo=in.(lider,colider)&select=equipe_id`)) as { equipe_id: string }[];
    const ids = minhas.map((m) => m.equipe_id);
    const aprovadas = ids.length ? (await banco(`equipes?id=in.(${ids.join(",")})&status=eq.aprovada&select=id`)) as { id: string }[] : [];
    const dela = aprovadas.length
      ? (await banco(`membros?usuario_id=eq.${alvo}&equipe_id=in.(${aprovadas.map((e) => e.id).join(",")})&select=equipe_id`)) as unknown[]
      : [];
    if (!dela.length) throw new Problema("sem_permissao", "Só a liderança da equipe dessa pessoa pode confirmar o Riot ID.", 403);
  }
  if (!(await um(`perfis?id=eq.${alvo}&select=id`))) throw new Problema("sem_perfil", "Essa pessoa ainda não completou o cadastro.", 404);
  const c = await contaPorRiot(riot);
  await conferirDono(c.puuid, alvo);
  return { verificado: true, ...(await gravarVerificado(alvo, c, null)) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return resposta({ erro: "metodo", mensagem: "Use POST." }, 405);
  try {
    if (!SUPABASE_URL || !CHAVE) throw new Problema("config", "A função não está configurada (falta VALREPORT_SECRET_KEY).", 500);
    const usuario = await quemEsta(req);
    const corpo = await req.json().catch(() => ({}));
    switch (corpo?.acao) {
      case "iniciar": return resposta(await iniciar(usuario, String(corpo.riot_id ?? "")));
      case "conferir": return resposta(await conferir(usuario));
      case "cancelar":
        await banco(`desafios_riot?usuario_id=eq.${usuario}`, "DELETE");
        return resposta({ cancelado: true });
      case "atualizar": return resposta(await atualizar(usuario));
      case "desvincular": return resposta(await desvincular(usuario));
      case "admin_verificar": return resposta(await adminVerificar(usuario, String(corpo.usuario_id ?? ""), String(corpo.riot_id ?? "")));
      case "lider_verificar": return resposta(await liderVerificar(usuario, String(corpo.usuario_id ?? ""), String(corpo.riot_id ?? "")));
      default: throw new Problema("acao", "Ação desconhecida.");
    }
  } catch (e) {
    if (e instanceof Problema) return resposta({ erro: e.codigo, mensagem: e.message }, e.status);
    console.error(e);
    return resposta({ erro: "interno", mensagem: "Algo deu errado na função. Tente de novo." }, 500);
  }
});
