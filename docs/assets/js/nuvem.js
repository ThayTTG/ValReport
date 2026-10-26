// Cliente mínimo do Supabase, só com o que o ValReport usa:
// login com Google (fluxo PKCE: nenhum token passa pela barra de endereço), renovação da sessão,
// leitura dos dados da equipe e as funções do banco. As regras de acesso ficam no banco (RLS).

import { SUPABASE_URL, SUPABASE_CHAVE } from "./config.js";

const K_SESSAO = "valreport.sessao", K_PKCE = "valreport.pkce";
let sessao = lerGuardado(K_SESSAO);

function lerGuardado(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function guardar(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } }
function definirSessao(s) { sessao = s; guardar(K_SESSAO, s); }

export class ErroNuvem extends Error {
  constructor(codigo, mensagem, status) { super(mensagem); this.codigo = codigo; this.status = status; }
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Vai para a tela de login do Google; a volta cai na mesma página, com ?code= */
export async function entrar() {
  const verificador = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const desafio = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador)));
  guardar(K_PKCE, { v: verificador, hash: location.hash || "" });
  const volta = location.origin + location.pathname;
  const q = new URLSearchParams({ provider: "google", redirect_to: volta, code_challenge: desafio, code_challenge_method: "s256" });
  location.assign(`${SUPABASE_URL}/auth/v1/authorize?${q}`);
}

async function pedirToken(tipo, corpo) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${tipo}`, {
    method: "POST", headers: { apikey: SUPABASE_CHAVE, "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new ErroNuvem(j.error_code || j.error || "token", j.msg || j.error_description || "Não foi possível entrar.", r.status);
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: j.user || null };
}

/** Chamado ao abrir o site: completa o login que voltou do Google (se houver). → { logado, erro } */
export async function iniciarNuvem() {
  const url = new URL(location.href);
  const codigo = url.searchParams.get("code");
  const erro = url.searchParams.get("error_description") || url.searchParams.get("error");
  const limparUrl = (hash) => history.replaceState(null, "", location.pathname + (hash ?? location.hash));
  if (erro) { limparUrl(); return { logado: Boolean(sessao), erro }; }
  if (codigo) {
    const pk = lerGuardado(K_PKCE);
    guardar(K_PKCE, null);
    if (!pk?.v) { limparUrl(); return { logado: false, erro: "O login expirou. Tente de novo." }; }
    try {
      definirSessao(await pedirToken("pkce", { auth_code: codigo, code_verifier: pk.v }));
      limparUrl(pk.hash);
    } catch (e) {
      limparUrl();
      return { logado: false, erro: e.message };
    }
  }
  return { logado: Boolean(sessao && await token()), erro: null };
}

/** Token válido (renova sozinho quando está para vencer). null = sem sessão. */
export async function token() {
  if (!sessao) return null;
  if (sessao.expires_at - 60 > Date.now() / 1000) return sessao.access_token;
  try {
    const nova = await pedirToken("refresh_token", { refresh_token: sessao.refresh_token });
    definirSessao({ ...nova, user: nova.user || sessao.user });
    return sessao.access_token;
  } catch (e) {
    if (e.status >= 400 && e.status < 500) definirSessao(null);  // sessão vencida ou revogada
    return null;
  }
}

export const usuario = () => sessao?.user || null;

export async function sair() {
  const t = sessao?.access_token;
  definirSessao(null);
  if (t) fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: SUPABASE_CHAVE, Authorization: `Bearer ${t}` } }).catch(() => null);
}

async function pedido(caminho, { metodo = "GET", corpo, prefer } = {}) {
  const t = await token();
  if (!t) throw new ErroNuvem("sem_sessao", "Sua sessão terminou. Entre de novo.", 401);
  const cab = { apikey: SUPABASE_CHAVE, Authorization: `Bearer ${t}`, Accept: "application/json" };
  if (corpo !== undefined) cab["Content-Type"] = "application/json";
  if (prefer) cab.Prefer = prefer;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { method: metodo, headers: cab, body: corpo === undefined ? undefined : JSON.stringify(corpo), cache: "no-store" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new ErroNuvem(e.code || String(r.status), e.message || `Erro ${r.status}`, r.status);
  }
  if (r.status === 204) return null;
  const texto = await r.text();
  return texto ? JSON.parse(texto) : null;
}

export const rpc = (funcao, args = {}) => pedido(`rpc/${funcao}`, { metodo: "POST", corpo: args });
export const inserir = (tabela, linha) => pedido(tabela, { metodo: "POST", corpo: linha, prefer: "return=minimal" });
export const atualizar = (tabela, filtro, mudancas) => pedido(`${tabela}?${filtro}`, { metodo: "PATCH", corpo: mudancas, prefer: "return=minimal" });

/** Chama uma função do servidor (Supabase Edge Function), ex.: funcao("riot", { acao: "iniciar", riot_id }) */
export async function funcao(nome, corpo = {}) {
  const t = await token();
  if (!t) throw new ErroNuvem("sem_sessao", "Sua sessão terminou. Entre de novo.", 401);
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/${nome}`, {
      method: "POST", headers: { apikey: SUPABASE_CHAVE, Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    });
  } catch (e) { throw new ErroNuvem("rede", "Sem conexão com o servidor agora. Tente de novo.", 0); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ErroNuvem(j.erro || String(r.status), j.mensagem || (r.status === 404 ? "A função do servidor ainda não foi criada no Supabase." : `Erro ${r.status}`), r.status);
  return j;
}

/** Um arquivo de dados da equipe (o mesmo JSON que antes ficava em docs/data/) */
export async function lerDado(equipeId, caminho) {
  const linhas = await pedido(`dados_equipe?select=conteudo&equipe_id=eq.${encodeURIComponent(equipeId)}&caminho=eq.${encodeURIComponent(caminho)}`);
  if (!linhas?.length) throw new ErroNuvem("404", `${caminho}: não encontrado`, 404);
  return linhas[0].conteudo;
}
