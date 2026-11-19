// Contexto de cada partida (v45): Ranked · Scrim · Oficial · Treino · Personalizada · Outra.
// Automático: Premier = oficial; personalizada no horário de um evento da agenda (Scrim, Campeonato, Partida
// oficial, Treino) = esse contexto, com o adversário do evento; outras personalizadas = "personalizada";
// competitivo = ranked. A liderança e os treinadores podem trocar à mão (supabase/atualizar.sql).

import { B } from "./dados.js";
import { rpc } from "./nuvem.js";
import { esc, icone } from "./util.js";

export const CONTEXTOS = {
  ranked: { nome: "Ranked", plural: "Ranked", cor: "neutro" },
  scrim: { nome: "Scrim", plural: "Scrims", cor: "scrim" },
  oficial: { nome: "Oficial", plural: "Oficiais", cor: "oficial" },
  treino: { nome: "Treino", plural: "Treinos", cor: "treino" },
  personalizada: { nome: "Personalizada", plural: "Personalizadas", cor: "neutro" },
  outra: { nome: "Outra fila", plural: "Outras filas", cor: "neutro" },
};
const DO_EVENTO = { scrim: "scrim", campeonato: "oficial", oficial: "oficial", treino: "treino" };
const MARGEM_ANTES = 45 * 60e3, MARGEM_DEPOIS = 90 * 60e3;   // a partida pode começar um pouco antes ou passar do fim do evento

let manuais = new Map(), eventos = [], tiposAgenda = [];

/** Lê o que foi marcado à mão e a agenda (uma vez, ao abrir o site e depois de mudar) */
export async function carregarContextos() {
  B.contextos = new Map();
  if (!B.equipeAtual || B.editor) return;
  const [m, ag] = await Promise.all([
    rpc("partidas_contexto_listar", { p_equipe: B.equipeAtual.id }).catch(() => []),
    rpc("agenda_ler", { p_equipe: B.equipeAtual.id }).catch(() => null),
  ]);
  manuais = new Map((m || []).map((x) => [x.partida, x]));
  eventos = ag?.eventos || [];
  tiposAgenda = eventos.length ? (await import("./agenda.js").then((a) => a._interno).catch(() => null)) : null;
  for (const p of B.partidas || []) B.contextos.set(p.id, calcular(p));
}

const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function eventoDaPartida(p) {
  if (!tiposAgenda || !p.t) return null;
  const ini = new Date(p.t), dia = ymdLocal(ini);
  let melhor = null;
  for (const { e, dia: d } of tiposAgenda.entre(eventos, dia, dia)) {
    if (!DO_EVENTO[e.tipo]) continue;
    const comeco = new Date(`${d}T${e.dia_todo ? "00:00" : e.inicio || "00:00"}:00`).getTime();
    const fim = new Date(`${d}T${e.dia_todo ? "23:59" : e.fim || e.inicio || "23:59"}:00`).getTime();
    if (ini.getTime() >= comeco - MARGEM_ANTES && ini.getTime() <= fim + MARGEM_DEPOIS) {
      const dist = Math.abs(ini.getTime() - comeco);
      if (!melhor || dist < melhor.dist) melhor = { e, dia: d, dist };
    }
  }
  return melhor;
}

function calcular(p) {
  const m = manuais.get(p.id);
  let ev = p.fila === "custom" || m ? eventoDaPartida(p) : null;
  if (m) {
    if (ev && DO_EVENTO[ev.e.tipo] !== m.contexto) ev = null;   // marcada à mão como outra coisa: não é desse evento
    return { ctx: m.contexto, adversario: m.adversario || ev?.e.adversario || "", evento: ev ? { id: ev.e.id, dia: ev.dia, titulo: ev.e.titulo } : null, manual: true, por: m.por };
  }
  if (p.fila === "premier") return { ctx: "oficial", adversario: "", evento: null, premier: true };
  if (p.fila === "custom") {
    if (ev) return { ctx: DO_EVENTO[ev.e.tipo], adversario: ev.e.adversario || "", evento: { id: ev.e.id, dia: ev.dia, titulo: ev.e.titulo } };
    return { ctx: "personalizada", adversario: "", evento: null };
  }
  return { ctx: p.fila === "competitive" ? "ranked" : "outra", adversario: "", evento: null };
}

export const contextoDe = (p) => B.contextos?.get(p.id) || calcular(p);

/** Selo "Scrim vs LOUD" para listas e cabeçalhos (ranked e filas comuns não ganham selo) */
export function seloContexto(p, { completo = false } = {}) {
  const c = contextoDe(p);
  if (c.ctx === "ranked" || (c.ctx === "outra" && !completo)) return "";
  const nome = c.premier ? "Oficial · Premier" : CONTEXTOS[c.ctx]?.nome || c.ctx;
  return `<span class="selo selo--ctx selo--ctx-${CONTEXTOS[c.ctx]?.cor || "neutro"}" title="${c.manual ? `Marcado por ${esc(c.por || "a liderança")}` : c.evento ? `Pelo evento da agenda: ${esc(c.evento.titulo)}` : "Automático"}">${esc(nome)}${c.adversario ? ` vs ${esc(c.adversario)}` : ""}</span>`;
}

/** As opções do filtro (só os contextos que existem nas partidas) */
export function opcoesContexto() {
  const tem = new Set((B.partidas || []).map((p) => contextoDe(p).ctx));
  return Object.entries(CONTEXTOS).filter(([k]) => tem.has(k)).map(([k, v]) => [k, v.plural]);
}

export const podeMudarContexto = () => !B.editor && (B.conta?.admin || ["lider", "colider", "treinador"].includes(B.equipeAtual?.cargo));

/** Janela para trocar o contexto da partida (liderança e treinadores) */
export async function editarContexto(p) {
  const { janela, avisar, textoErro } = await import("./janela.js");
  const c = contextoDe(p);
  const res = await janela({
    titulo: "Contexto da partida",
    corpo: `<p class="suave pequeno">Separa as estatísticas: ranked, scrims e oficiais aparecem juntos ou separados pelo filtro "Contexto". ${c.manual ? "" : `Agora está no automático (${esc(c.evento ? `evento "${c.evento.titulo}"` : p.fila === "premier" ? "Premier" : "pela fila")}).`}</p>
      <label class="campo"><span>Contexto</span><select name="ctx">
        <option value="">Automático</option>
        ${Object.entries(CONTEXTOS).map(([k, v]) => `<option value="${k}"${c.manual && c.ctx === k ? " selected" : ""}>${esc(v.nome)}</option>`).join("")}</select></label>
      <label class="campo"><span>Adversário <small class="suave">(opcional)</small></span><input name="adv" maxlength="40" value="${esc(c.adversario || "")}" placeholder="Ex.: LOUD Academy"></label>`,
    acoes: [["cancelar", "Cancelar"], ["ok", "Salvar", "botao-primario"]],
  });
  if (res.valor !== "ok") return false;
  try {
    await rpc("partida_definir_contexto", { p_equipe: B.equipeAtual.id, p_partida: p.id, p_contexto: res.dados.ctx || "", p_adversario: res.dados.adv || "" });
    await carregarContextos();
    avisar("Contexto salvo ✓", "novo");
    return true;
  } catch (e) {
    avisar(/could not find|PGRST202/i.test(String(e?.message)) || e?.codigo === "PGRST202" ? "Falta rodar o supabase/atualizar.sql no banco." : textoErro(e), "erro");
    return false;
  }
}

/** As partidas ligadas a um evento da agenda (para a janela do evento) */
export function partidasDoEvento(eventoId, dia) {
  return (B.partidas || []).filter((p) => { const c = contextoDe(p); return c.evento?.id === eventoId && c.evento.dia === dia; });
}

export const iconeContexto = () => icone("alvo");
