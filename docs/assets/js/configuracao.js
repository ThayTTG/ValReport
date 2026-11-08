// Configuração da coleta (Painel > Configuração): o que antes era o config.json do PC agora fica no banco.
// A nuvem lê a versão mais nova a cada execução. Cada "Salvar" vira uma versão nova (as 30 anteriores ficam no
// histórico e dá para trazer qualquer uma de volta). Se outra aba salvar no meio, o banco recusa e pede para abrir de novo.

import { esc, icone, dataHora, relativo, nomeFila } from "./util.js";
import { rpc } from "./nuvem.js";
import { B } from "./dados.js";
import { EQUIPE_PADRAO } from "./config.js";
import { dispararNuvem } from "./sync.js";

const textoErro = (e) => String(e?.message || e || "").replace(/^[a-z_]+: /, "");
const FILAS = ["competitive", "premier", "custom", "unrated", "swiftplay", "hurm", "deathmatch", "spikerush"];
const REGIOES = { br: "Brasil", latam: "América Latina", na: "América do Norte", eu: "Europa", ap: "Ásia-Pacífico", kr: "Coreia" };
const RIOT_ID = /^[^#\p{Cc}]{1,16}#[^#\p{Cc}]{1,5}$/u;
// [chave, rótulo, ajuda, mínimo, máximo] (os mesmos limites que o banco confere)
const NUM_COLETA = [["max_paginas_por_jogador", "Páginas por jogador", "Quantas páginas de histórico a coleta lê de cada um (10 partidas por página).", 1, 10]];
const NUM_REPORT = [
  ["janela_dias", "Janela do report (dias)", "Quantos dias o report diário olha.", 1, 365],
  ["janela_referencia_dias", "Janela de referência (dias)", "A base para comparar a fase recente.", 7, 3650],
  ["amostra_minima_rounds", "Amostra mínima (rounds)", "Abaixo disso, o número aparece como pouca amostra.", 10, 5000],
  ["min_partidas_grupo", "Partidas mínimas por grupo", "Para um mapa ou agente entrar nas comparações.", 1, 50],
  ["destaque_impacto_pct", "Destaque a partir de (%)", "Impacto acima da média para ganhar destaque.", 0, 500],
  ["observar_impacto_pct", "Observar abaixo de (%)", "Impacto abaixo da média para pedir atenção (número negativo).", -500, 0],
  ["max_rounds_no_resumo", "Rounds no resumo", "Quantos rounds marcantes o resumo mostra.", 0, 30],
  ["validacao_por_jogador", "Partidas de validação por jogador", "", 0, 20],
];

const campoNum = ([k, rot, ajuda, min, max], v) => `<label class="campo"><span>${esc(rot)}</span>
    <input type="number" inputmode="numeric" data-num="${k}" min="${min}" max="${max}" step="1" value="${v ?? ""}" placeholder="padrão">
    ${ajuda ? `<small>${esc(ajuda)} (${min} a ${max})</small>` : `<small>${min} a ${max}</small>`}</label>`;
const check = (attr, rot, ligado, ajuda = "") => `<label class="campo--check"><input type="checkbox" ${attr}${ligado ? " checked" : ""}>
    <span><strong>${esc(rot)}</strong>${ajuda ? `<br><small class="suave">${esc(ajuda)}</small>` : ""}</span></label>`;

function linhaJogador(riot = "", apelido = "", noSite = true) {
  return `<li class="cfg-jogador">
      <input data-j="riot" value="${esc(riot)}" placeholder="Nome#TAG" maxlength="22" aria-label="Riot ID" autocomplete="off" spellcheck="false">
      <input data-j="apelido" value="${esc(apelido)}" placeholder="Apelido (opcional)" maxlength="24" aria-label="Apelido" autocomplete="off">
      <label class="cfg-jogador__site" title="Aparece pelo nome no site"><input type="checkbox" data-j="site"${noSite ? " checked" : ""}> no site</label>
      <button class="limpar pequeno" type="button" data-cfg="tirar" aria-label="Tirar da lista">${icone("fechar")}</button></li>`;
}

function htmlHistorico(h, versao) {
  if (!h?.length) return `<p class="suave pequeno">Ainda não há versões anteriores. Cada vez que você salvar, a anterior fica guardada aqui.</p>`;
  return `<ul class="sync-lista">${h.map((x) => `<li class="sync-item"><div class="sync-item__texto">
      <strong>Versão ${esc(String(x.versao))}</strong>
      <small class="suave">${esc(x.origem === "pc" ? "veio do PC" : x.origem === "site" ? `site${x.salvo_por ? ` · ${x.salvo_por}` : ""}` : x.origem || "")} · ${esc(dataHora(x.salvo_em))}</small></div>
      <button class="botao-secundario botao-mini" type="button" data-cfg="restaurar" data-versao="${esc(String(x.versao))}">Trazer para o formulário</button></li>`).join("")}</ul>
    <p class="suave pequeno">Trazer uma versão só preenche o formulário; ela vale depois de “Salvar” (e vira a versão ${versao + 1}).</p>`;
}

function formulario(cfg) {
  const ap = cfg.apelidos || {}, site = cfg.site || {};
  const aut = new Set((site.jogadores_autorizados || []).map((r) => String(r).toLowerCase()));
  const filas = new Set(cfg.filas_incluidas || ["competitive", "premier", "custom"]);
  return `
    <section class="cartao sync-bloco cfg-bloco">
      <div class="cartao__titulo"><h3>${icone("equipe")} Jogadores</h3><span class="suave pequeno"><span data-cfg-conta>${(cfg.jogadores || []).length}</span> de 40</span></div>
      <p class="suave pequeno sync-ajuda">Quem é da equipe no site com o Riot ID confirmado já entra sozinho na coleta. Aqui ficam os extras (quem ainda não entrou no site) e os apelidos que aparecem no report. “No site” deixa a pessoa aparecer pelo nome.</p>
      <ul class="cfg-jogadores">${(cfg.jogadores || []).map((r) => linhaJogador(r, ap[r] || "", aut.has(String(r).toLowerCase()))).join("")}</ul>
      <button class="botao-secundario botao-mini" type="button" data-cfg="mais">${icone("mais")} Adicionar jogador</button>
    </section>
    <section class="cartao sync-bloco cfg-bloco">
      <div class="cartao__titulo"><h3>${icone("atualizar")} Coleta</h3></div>
      ${check('data-bool="coleta_rapida"', "Coleta rápida (de 20 em 20 minutos)", cfg.coleta_rapida !== false, "Desligada, só o report diário coleta.")}
      ${check('data-bool="coletar_elo"', "Acompanhar o elo", cfg.coletar_elo !== false, "Guarda as mudanças de RR depois de cada competitiva.")}
      <label class="campo"><span>Região</span><select data-cfg-regiao>${Object.entries(REGIOES).map(([k, n]) => `<option value="${k}"${(cfg.regiao || "br") === k ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
      <fieldset class="campo"><legend>Filas que entram</legend><div class="cfg-filas">
        ${FILAS.map((f) => `<label class="chip cfg-fila"><input type="checkbox" data-fila="${f}"${filas.has(f) ? " checked" : ""}> ${esc(nomeFila(f))}</label>`).join("")}</div></fieldset>
      <div class="cfg-numeros">${NUM_COLETA.map((n) => campoNum(n, cfg[n[0]])).join("")}</div>
    </section>
    <section class="cartao sync-bloco cfg-bloco">
      <div class="cartao__titulo"><h3>${icone("trofeu")} Report</h3></div>
      <div class="cfg-numeros">${NUM_REPORT.map((n) => campoNum(n, cfg[n[0]])).join("")}</div>
      <p class="suave pequeno">Campo vazio usa o valor padrão do report.</p>
    </section>
    <section class="cartao sync-bloco cfg-bloco">
      <div class="cartao__titulo"><h3>${icone("escudo")} Site</h3></div>
      ${check('data-site="mostrar_riot_id"', "Mostrar o Riot ID completo (com a TAG)", site.mostrar_riot_id === true, "Desligado, o site mostra só o apelido.")}
    </section>`;
}

/** Junta o que está no formulário com a configuração atual (o que o formulário não mostra continua igual) */
function lerFormulario(raiz, base) {
  const cfg = structuredClone(base || {});
  const linhas = [...raiz.querySelectorAll(".cfg-jogador")].map((li) => ({
    riot: li.querySelector('[data-j="riot"]').value.trim(), apelido: li.querySelector('[data-j="apelido"]').value.trim(),
    site: li.querySelector('[data-j="site"]').checked })).filter((x) => x.riot);
  const ruins = linhas.filter((x) => !RIOT_ID.test(x.riot)).map((x) => x.riot);
  if (ruins.length) throw new Error(`Riot ID inválido: ${ruins.slice(0, 3).join(", ")} (use Nome#TAG).`);
  const vistos = new Set();
  for (const x of linhas) { const k = x.riot.toLowerCase(); if (vistos.has(k)) throw new Error(`${x.riot} aparece duas vezes.`); vistos.add(k); }
  if (linhas.length > 40) throw new Error("No máximo 40 jogadores.");
  cfg.jogadores = linhas.map((x) => x.riot);
  cfg.apelidos = Object.fromEntries(linhas.filter((x) => x.apelido).map((x) => [x.riot, x.apelido]));
  const site = { ...(cfg.site || {}) };
  const antes = new Set((base?.jogadores || []).map((r) => r.toLowerCase()));
  // quem não está na lista (por exemplo, quem entrou pelo elenco do site) continua autorizado como estava
  const deFora = (site.jogadores_autorizados || []).filter((r) => !antes.has(String(r).toLowerCase()) && !vistos.has(String(r).toLowerCase()));
  site.jogadores_autorizados = [...deFora, ...linhas.filter((x) => x.site).map((x) => x.riot)];
  site.mostrar_riot_id = raiz.querySelector('[data-site="mostrar_riot_id"]').checked;
  cfg.site = site;
  for (const el of raiz.querySelectorAll("[data-bool]")) cfg[el.dataset.bool] = el.checked;
  cfg.regiao = raiz.querySelector("[data-cfg-regiao]").value;
  cfg.filas_incluidas = [...raiz.querySelectorAll("[data-fila]:checked")].map((el) => el.dataset.fila);
  if (!cfg.filas_incluidas.length) throw new Error("Escolha pelo menos uma fila.");
  for (const [k, rot, , min, max] of [...NUM_COLETA, ...NUM_REPORT]) {
    const v = raiz.querySelector(`[data-num="${k}"]`).value.trim();
    if (v === "") { delete cfg[k]; continue; }
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`“${rot}” precisa ficar entre ${min} e ${max}.`);
    cfg[k] = n;
  }
  return cfg;
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export async function viewConfiguracao() {
  const voltar = `<a class="voltar limpar pequeno" href="#/painel">${icone("voltar")} Painel da administradora</a>`;
  if (!B.conta?.admin) return { titulo: "Configuração", html: `<div class="vazio"><strong>Somente a administradora acessa a Configuração.</strong></div>` };
  let d, painel;
  try {
    [d, painel] = await Promise.all([rpc("admin_config_ler", { p_slug: EQUIPE_PADRAO }), rpc("admin_sync_painel", { p_slug: EQUIPE_PADRAO }).catch(() => null)]);
  } catch (e) {
    if (e?.codigo === "PGRST202" || e?.status === 404) {
      return { titulo: "Configuração", html: `<section class="secao sync cfg">${voltar}<h1>Configuração</h1>
        <div class="aviso secao">${icone("info")}<div><strong>Falta ligar a Configuração no banco de dados.</strong>
          <ol><li>Abra o Supabase → <strong>SQL Editor</strong> → <strong>New query</strong>.</li>
            <li>Cole todo o arquivo <code>supabase\\nuvem.sql</code> e clique em <strong>Run</strong>.</li>
            <li>O resultado esperado é <code>coleta | false</code>. Depois, rode o <code>Atalhos\\enviar_para_nuvem.bat</code> no PC uma vez para trazer a configuração dele.</li></ol></div></div></section>` };
    }
    return { titulo: "Configuração", html: `<div class="vazio"><strong>Não foi possível abrir a Configuração</strong><p>${esc(textoErro(e))}</p></div>` };
  }
  const naNuvem = painel?.estado?.ambiente === "nuvem";
  let base = d.config || null, versao = d.versao || 0;

  const html = `<section class="secao sync cfg">
      ${voltar}
      <div class="sync-topo"><div><h1>Configuração</h1>
        <p class="suave">O que a coleta e o report usam (antes, o <code>config.json</code> do PC). ${naNuvem
          ? "A nuvem lê a versão mais nova a cada execução."
          : "Vale para a coleta na nuvem; enquanto o PC estiver coletando, ele continua usando o config.json dele."}</p></div>
        ${base ? `<div class="sync-botoes"><button class="botao-primario" type="button" data-cfg="salvar">${icone("verificado")} Salvar</button>
          <button class="botao-secundario" type="button" data-cfg="desfazer">Desfazer mudanças</button></div>` : ""}</div>
      <p class="form-msg sync-msg" role="status" hidden></p>
      ${base ? `<p class="suave pequeno sync-quando" data-cfg-versao>Versão ${esc(String(versao))} · ${esc(d.origem === "pc" ? "veio do PC" : `salva no site${d.atualizado_por ? ` por ${d.atualizado_por}` : ""}`)} · ${esc(relativo(d.atualizado_em))}</p>
      <div class="sync-blocos cfg-form">${formulario(base)}</div>
      <details class="cartao secao sync-bloco cfg-avancado"><summary><strong>${icone("nota")} Avançado: editar o JSON</strong></summary>
        <p class="suave pequeno sync-ajuda">Tudo o que a coleta lê, inclusive o que não aparece no formulário. Se você mexer aqui, o JSON vale no lugar do formulário. Chaves e webhooks nunca entram aqui (eles ficam nos segredos do GitHub).</p>
        <textarea class="cfg-json" rows="18" spellcheck="false" aria-label="Configuração em JSON">${esc(JSON.stringify(base, null, 2))}</textarea></details>
      <section class="cartao secao sync-bloco"><div class="cartao__titulo"><h3>${icone("relogio")} Versões anteriores</h3><span class="suave pequeno">as 30 mais recentes</span></div>
        <div data-cfg-historico>${htmlHistorico(d.historico, versao)}</div></section>`
      : `<div class="aviso secao">${icone("info")}<span>A configuração ainda não está na nuvem. Rode o <code>Atalhos\\enviar_para_nuvem.bat</code> no PC uma vez: ele manda o config.json e a pasta dados.</span></div>`}
    </section>`;

  return {
    titulo: "Configuração",
    html,
    depois: (el) => {
      const raiz = el.querySelector(".cfg"), msg = el.querySelector(".sync-msg");
      if (!base) return;
      const aviso = (t, erro = false, extra = "") => { msg.innerHTML = `${esc(t)}${extra}`; msg.className = `form-msg sync-msg aviso${erro ? " aviso--erro" : ""}`; msg.hidden = !t; };
      const txt = raiz.querySelector(".cfg-json");
      let jsonOriginal = txt.value, fonte = base, mexeu = false;   // fonte: a configuração que está no formulário agora
      const recontar = () => { raiz.querySelector("[data-cfg-conta]").textContent = raiz.querySelectorAll(".cfg-jogador").length; };
      const preencher = (cfg) => {
        fonte = cfg; mexeu = false;
        raiz.querySelector(".cfg-form").innerHTML = formulario(cfg);
        txt.value = jsonOriginal = JSON.stringify(cfg, null, 2);
      };
      const atual = () => {
        if (txt.value !== jsonOriginal) {
          try { return JSON.parse(txt.value); } catch (e) { throw new Error(`O JSON do Avançado tem um erro: ${e.message}`); }
        }
        return mexeu ? lerFormulario(raiz, fonte) : structuredClone(fonte);   // sem mexer, vale a configuração exatamente como veio
      };
      // o JSON acompanha o formulário (enquanto ninguém mexer nele)
      raiz.querySelector(".cfg-form").addEventListener("input", () => {
        mexeu = true;
        if (txt.value !== jsonOriginal) return;
        try { txt.value = jsonOriginal = JSON.stringify(lerFormulario(raiz, fonte), null, 2); } catch (e) { /* ainda digitando */ }
      });

      raiz.addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-cfg]");
        if (!b) return;
        const acao = b.dataset.cfg;
        if (acao === "mais") {
          if (raiz.querySelectorAll(".cfg-jogador").length >= 40) { aviso("No máximo 40 jogadores.", true); return; }
          raiz.querySelector(".cfg-jogadores").insertAdjacentHTML("beforeend", linhaJogador());
          raiz.querySelector(".cfg-jogador:last-child input").focus();
          recontar(); return;
        }
        if (acao === "tirar") { mexeu = true; b.closest(".cfg-jogador").remove(); recontar(); raiz.querySelector(".cfg-form").dispatchEvent(new Event("input")); return; }
        if (acao === "desfazer") { preencher(base); aviso("Formulário de volta à versão salva."); return; }
        if (acao === "agora") {
          b.disabled = true;
          const r = await dispararNuvem();
          aviso(r.motivo || (r.ok ? "A nuvem começou a coletar." : "Não deu para chamar a nuvem."), !r.ok && r.codigo !== "espera");
          return;
        }
        b.disabled = true;
        try {
          if (acao === "restaurar") {
            const v = await rpc("admin_config_versao", { p_slug: EQUIPE_PADRAO, p_versao: Number(b.dataset.versao) });
            preencher(v);
            aviso(`Versão ${b.dataset.versao} no formulário. Confira e clique em Salvar para ela voltar a valer.`);
            raiz.querySelector(".cfg-form").scrollIntoView({ behavior: "smooth", block: "start" });
          } else if (acao === "salvar") {
            const nova = atual();
            if (igual(nova, base)) { aviso("Nada mudou desde a última versão."); return; }
            const r = await rpc("admin_config_salvar", { p_slug: EQUIPE_PADRAO, p_config: nova, p_versao_base: versao });
            base = r.config; versao = r.versao;
            preencher(base);
            raiz.querySelector("[data-cfg-versao]").textContent = `Versão ${versao} · salva no site agora`;
            raiz.querySelector("[data-cfg-historico]").innerHTML = htmlHistorico(r.historico, versao);
            aviso(`Salvo (versão ${versao}). ${naNuvem ? "A próxima coleta da nuvem já usa." : "Vale quando a coleta estiver na nuvem."}`, false,
              naNuvem ? ` <button class="limpar pequeno" type="button" data-cfg="agora">Coletar agora</button>` : "");
          }
        } catch (e) {
          aviso(textoErro(e), true);
        } finally { b.disabled = false; }
      });
    },
  };
}
