// Sync da administradora: o que ficou faltando nos dados (o PC manda a cada coleta) e os pedidos para o PC refazer.
// O PC atende na próxima coleta (de 20 em 20 minutos, com ele ligado). Tudo passa pelas funções admin_sync_* do banco.

import { esc, icone, dataHora, relativo, nomeFila } from "./util.js";
import { rpc } from "./nuvem.js";
import { B } from "./dados.js";
import { EQUIPE_PADRAO } from "./config.js";

const textoErro = (e) => String(e?.message || e || "").replace(/^[a-z_]+: /, "");
const TIPOS = { tudo: "Sincronizar tudo", partida: "Partida", elo: "Elo", card: "Card", site: "Reenviar ao site" };
const STATUS = { pendente: ["Na fila", "alerta"], fazendo: ["O PC está fazendo", "destaque"], feito: ["Feito", "vitoria"],
  erro: ["Não deu", "derrota"], cancelado: ["Cancelado", ""] };
const chave = (tipo, alvo) => `${tipo}|${alvo || ""}`;

/** Sinal de vida do PC: ok (até 30 min), atrasado (até 3 h) ou parado */
function saudePc(visto, agora) {
  if (!visto) return ["parado", "Sem notícias", "ainda não mandou o estado"];
  const min = (new Date(agora) - new Date(visto)) / 60000, quando = `visto ${relativo(visto, new Date(agora))}`;
  if (min <= 30) return ["ok", "Ligado", quando];
  if (min <= 180) return ["atrasado", "Atrasado", quando];
  return ["parado", "Parado", quando];
}

function tile(rotulo, valor, sub = "", classe = "") {
  return `<div class="tile sync-tile ${classe}"><div class="tile__rotulo">${rotulo}</div><div class="tile__valor">${valor}</div>${sub ? `<div class="tile__sub">${sub}</div>` : ""}</div>`;
}

/** Botão "Buscar de novo" ou o selo do pedido que já está na fila */
function acao(abertos, tipo, alvo, rotulo = "Buscar de novo") {
  const p = abertos.get(chave(tipo, alvo));
  if (p) {
    const [t, c] = STATUS[p.status];
    return `<span class="sync-acao"><span class="selo selo--${c}">${t}</span>${p.status === "pendente" ? `<button class="limpar pequeno" type="button" data-sync-cancelar="${esc(p.id)}">Cancelar</button>` : ""}</span>`;
  }
  return `<button class="botao-secundario botao-mini" type="button" data-sync-pedir="${esc(tipo)}" data-sync-alvo="${esc(alvo || "")}">${icone("atualizar")} ${rotulo}</button>`;
}

function linhaPartida(x, abertos, foraDoSite = false) {
  const fila = x.fila ? nomeFila(String(x.fila).toLowerCase().replace(/ game$/, "")) : "";
  const tit = [x.mapa, fila].filter(Boolean).map(esc).join(" · ") || "Partida";
  return `<li class="sync-item">
      <div class="sync-item__texto"><strong>${tit}</strong>
        <small class="suave">${esc(dataHora(x.inicio))}${x.quem?.length ? ` · ${x.quem.map(esc).join(", ")}` : ""}${foraDoSite ? " · fora do site" : ""}</small>
        <span class="sync-chips">${(x.problemas || []).map((p) => `<span class="chip">${esc(p.t)}</span>`).join("")}</span></div>
      ${foraDoSite ? "" : `<a class="limpar pequeno" href="#/p/${esc(x.id)}">Abrir</a>`}
      ${acao(abertos, "partida", x.id)}</li>`;
}

function bloco(titulo, ic, itens, vazio, ajuda = "", semEstado = false) {
  const selo = semEstado ? `<span class="selo">esperando o PC</span>`
    : itens.length ? `<span class="selo selo--alerta">${itens.length}</span>` : `<span class="selo selo--vitoria">${icone("verificado")} em dia</span>`;
  if (semEstado) vazio = "Aparece depois que o PC mandar o estado.";
  return `<section class="cartao sync-bloco">
      <div class="cartao__titulo"><h3>${icone(ic)} ${esc(titulo)}</h3>${selo}</div>
      ${ajuda ? `<p class="suave pequeno sync-ajuda">${ajuda}</p>` : ""}
      ${itens.length ? `<ul class="sync-lista">${itens.join("")}</ul>` : `<p class="suave pequeno">${esc(vazio)}</p>`}</section>`;
}

function htmlPedido(p) {
  const [t, c] = STATUS[p.status] || [p.status, ""];
  const alvo = p.tipo === "partida" ? `${p.alvo.slice(0, 8)}…` : p.alvo;
  return `<li class="sync-pedido">
      <span class="selo ${c ? `selo--${c}` : ""}">${esc(t)}</span>
      <div class="sync-item__texto"><strong>${esc(TIPOS[p.tipo] || p.tipo)}${alvo ? ` · ${esc(alvo)}` : ""}</strong>
        <small class="suave">${esc(p.criado_por || "—")} · ${esc(dataHora(p.criado_em))}${p.concluido_em ? ` · concluído ${esc(dataHora(p.concluido_em))}` : ""}</small>
        ${p.resultado ? `<span class="sync-resultado">${esc(p.resultado)}</span>` : ""}</div>
      ${p.status === "pendente" ? `<button class="limpar pequeno" type="button" data-sync-cancelar="${esc(p.id)}">Cancelar</button>` : ""}</li>`;
}

export async function viewSync() {
  if (!B.conta?.admin) return { titulo: "Sync", html: `<div class="vazio"><strong>Somente a administradora acessa o Sync.</strong></div>` };
  let d;
  try { d = await rpc("admin_sync_painel", { p_slug: EQUIPE_PADRAO }); } catch (e) {
    if (e?.codigo === "PGRST202" || e?.status === 404) {   // o supabase/sync.sql ainda não foi aplicado
      return { titulo: "Sync", html: `<section class="secao sync">
        <a class="voltar limpar pequeno" href="#/painel">${icone("voltar")} Painel da administradora</a>
        <h1>Sync</h1>
        <div class="aviso secao sync-falta-sql">${icone("info")}<div><strong>Falta ligar o Sync no banco de dados.</strong>
          <ol><li>Abra o Supabase → <strong>SQL Editor</strong> → <strong>New query</strong>.</li>
            <li>Cole todo o arquivo <code>supabase\\sync.sql</code> (da pasta ValorantReport) e clique em <strong>Run</strong>.</li>
            <li>O resultado esperado é <code>sync_pedidos | 0</code>. Depois, volte aqui: na próxima coleta (até 20 minutos) o PC manda o estado.</li></ol></div></div>
      </section>` };
    }
    return { titulo: "Sync", html: `<div class="vazio"><strong>Não foi possível abrir o Sync</strong><p>${esc(textoErro(e))}</p></div>` };
  }
  const est = d.estado || null, col = est?.coleta || {};
  const pedidos = d.pedidos || [];
  const abertos = new Map(pedidos.filter((p) => p.status === "pendente" || p.status === "fazendo").map((p) => [chave(p.tipo, p.alvo), p]));
  const [saude, rotSaude, txtSaude] = saudePc(d.pc_visto_em, d.agora);
  const fila = [...abertos.values()].length;

  const partidas = [...(est?.sem_dados || []).map((x) => linhaPartida(x, abertos, true)), ...(est?.partidas || []).map((x) => linhaPartida(x, abertos))];
  const elos = (est?.elo || []).map((x) => `<li class="sync-item"><div class="sync-item__texto"><strong>${esc(x.apelido)}</strong>
      <small class="suave">última mudança de RR: ${esc(x.ultima_mudanca ? dataHora(x.ultima_mudanca) : "nenhuma guardada")} · última competitiva: ${esc(dataHora(x.ultima_competitiva))}</small></div>
      ${acao(abertos, "elo", x.riot)}</li>`);
  const cards = (est?.cards || []).map((x) => `<li class="sync-item"><div class="sync-item__texto"><strong>${esc(x.apelido)}</strong>
      <small class="suave">${esc(x.motivo)}</small></div>${acao(abertos, "card", x.riot, "Buscar o card")}</li>`);
  const erros = (col.erros || []).map((x) => `<li class="sync-item sync-item--erro"><div class="sync-item__texto"><small class="suave">${esc(dataHora(x.t))}</small>
      <span class="sync-resultado">${esc(x.msg)}</span></div></li>`);

  const html = `<section class="secao sync">
      <a class="voltar limpar pequeno" href="#/painel">${icone("voltar")} Painel da administradora</a>
      <div class="sync-topo"><div><h1>Sync</h1>
        <p class="suave">O que ficou faltando nos dados da ${esc(d.equipe?.nome || "equipe")} e os pedidos para o PC refazer. O PC atende na próxima coleta (de 20 em 20 minutos, enquanto estiver ligado).</p></div>
        <div class="sync-botoes">${abertos.has(chave("tudo")) ? acao(abertos, "tudo", null) : `<button class="botao-primario" type="button" data-sync-pedir="tudo" data-sync-alvo="">${icone("atualizar")} Sincronizar tudo</button>`}
          ${abertos.has(chave("site")) ? "" : `<button class="botao-secundario" type="button" data-sync-pedir="site" data-sync-alvo="">${icone("enviar")} Reenviar ao site</button>`}
          <button class="botao-secundario" type="button" data-sync-recarregar title="Ler de novo">${icone("relogio")} Atualizar</button></div></div>
      <p class="form-msg sync-msg" role="status" hidden></p>
      <div class="grade-stats sync-tiles">
        ${tile("PC", `<span class="sync-saude sync-saude--${saude}" aria-hidden="true"></span>${esc(rotSaude)}`, esc(txtSaude))}
        ${tile("Coleta rápida", esc(col.rapida_em ? relativo(col.rapida_em, new Date(d.agora)) : "—"), col.rapida_ligada === false ? "desligada no config.json" : col.rapida_em ? esc(dataHora(col.rapida_em)) : "")}
        ${tile("Report diário", esc(col.report_em ? col.report_em.split("-").reverse().slice(0, 2).join("/") : "—"), col.pendentes_report ? `${col.pendentes_report} partida(s) esperando o próximo` : "")}
        ${tile("Envio ao site", esc(d.envio_em ? relativo(d.envio_em, new Date(d.agora)) : "nunca"), `${d.arquivos || 0} arquivo(s)`)}
        ${tile("Partidas no PC", esc(String(col.partidas_guardadas ?? "—")), col.jogadores ? `${col.jogadores} jogadores na coleta` : "")}
        ${tile("Pedidos na fila", esc(String(fila)), fila ? "o PC pega na próxima coleta" : "nenhum")}
      </div>
      ${!est ? `<div class="aviso secao">${icone("info")}<span>O PC ainda não mandou o estado. Depois de instalar a atualização, ele manda na próxima coleta de 20 minutos (ou rode o <code>Atalhos\\atualizar_agora.bat</code>).</span></div>`
        : saude === "parado" ? `<div class="aviso aviso--erro secao">${icone("info")}<span>O PC não aparece há algum tempo. Confira se ele está ligado e se a tarefa “NokyLabs - Atualizar site VALORANT” está ativa no Agendador de Tarefas.</span></div>` : ""}
      ${col.chave_henrik === false ? `<div class="aviso aviso--erro secao">${icone("info")}<span>O PC está sem a chave da HenrikDev (variável <code>HENRIKDEV_API_KEY</code>): a coleta não consegue buscar nada.</span></div>` : ""}
      ${est ? `<p class="suave pequeno sync-quando">Diagnóstico de ${esc(dataHora(est.gerado_em))}${d.versao ? ` · ${esc(d.versao)}` : ""}</p>` : ""}
      <div class="sync-blocos">
        ${bloco("Partidas com dados faltando", "mapa", partidas, "Todas as partidas guardadas estão completas.",
          "A API às vezes manda uma partida pela metade (sem rounds, sem a posição dos abates…). Buscar de novo costuma resolver depois de algumas horas.", !est)}
        ${bloco("Elo desatualizado", "trofeu", elos, "O elo de todo mundo está em dia com as competitivas.",
          "Quem jogou uma competitiva depois da última mudança de RR guardada. Partidas de colocação não mudam o RR.", !est)}
        ${bloco("Contas sem card", "imagem", cards, "Todo mundo da equipe tem card no site.",
          "Quem ainda não tem partida guardada fica sem card; o PC busca o card direto na conta.", !est)}
        ${bloco("Erros recentes da coleta", "info", erros, "Nenhum erro nos últimos 3 dias.", "As últimas linhas de erro do log do PC (dados\\coletor.log).", !est)}
      </div>
      <section class="cartao secao sync-bloco"><div class="cartao__titulo"><h3>${icone("relogio")} Pedidos</h3><span class="suave pequeno">os 40 mais recentes</span></div>
        ${pedidos.length ? `<ul class="sync-lista">${pedidos.map(htmlPedido).join("")}</ul>` : `<p class="suave pequeno">Nenhum pedido ainda. Use “Buscar de novo” nos itens acima ou “Sincronizar tudo”.</p>`}</section>
    </section>`;

  return {
    titulo: "Sync",
    html,
    depois: (el) => {
      const msg = el.querySelector(".sync-msg");
      const aviso = (t, erro = false) => { msg.textContent = t; msg.className = `form-msg sync-msg aviso${erro ? " aviso--erro" : ""}`; msg.hidden = !t; };
      const redesenhar = async () => {
        const v = await viewSync();
        el.innerHTML = v.html;
        v.depois?.(el);
      };
      el.querySelector(".sync").addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-sync-pedir], [data-sync-cancelar], [data-sync-recarregar]");
        if (!b) return;
        b.disabled = true;
        try {
          if (b.dataset.syncRecarregar !== undefined) { await redesenhar(); return; }
          if (b.dataset.syncCancelar) {
            await rpc("admin_sync_cancelar", { p_id: b.dataset.syncCancelar });
          } else {
            const r = await rpc("admin_sync_pedir", { p_slug: EQUIPE_PADRAO, p_tipo: b.dataset.syncPedir, p_alvo: b.dataset.syncAlvo || null });
            await redesenhar();
            el.querySelector(".sync-msg") && (() => {
              const m = el.querySelector(".sync-msg");
              m.textContent = r?.ja_existia ? "Esse pedido já estava na fila." : "Pedido na fila: o PC atende na próxima coleta.";
              m.className = "form-msg sync-msg aviso"; m.hidden = false;
            })();
            return;
          }
          await redesenhar();
        } catch (e) { b.disabled = false; aviso(textoErro(e), true); }
      });
    },
  };
}
