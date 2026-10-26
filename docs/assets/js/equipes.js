// Equipes: minhas equipes, criar equipe, página da equipe (membros, cargos, convites, ajustes) e aceitar convite

import { esc, icone, imagem, imgCard, dataHora } from "./util.js";
import { B } from "./dados.js";
import { rpc, funcao } from "./nuvem.js";
import { nomeCargo } from "./conta.js";

const NOMES_CARGO_PLURAL = { lider: "Liderança", colider: "Co-liderança", treinador: "Treinadores", jogador: "Jogadores", convidado: "Convidados" };
const CARGOS_EDITAVEIS = ["colider", "jogador", "treinador", "convidado"];
const K_CONVITE = "valreport.convite";

/** Mensagem do banco sem o código técnico do começo ("vagas_jogadores: ...") */
export function textoErro(e) {
  return String(e?.message || e).replace(/^[a-z_]+: /, "");
}
const recarregar = () => window.dispatchEvent(new CustomEvent("valreport:recarregar"));
const irPara = (hash) => { location.hash = hash; recarregar(); };

export function imagemEquipe(e, classe = "equipe-img") {
  const src = e.imagem_url || (e.imagem_card ? imgCard(e.imagem_card, "smallart") : null);
  return imagem(src, "", classe, e.nome);
}
const urlConvite = (codigo) => `${location.origin}${location.pathname}#/convite/${codigo}`;
const seloStatus = (e) => e.status === "pendente" ? `<span class="selo selo--alerta">${icone("relogio")} aguardando aprovação</span>`
  : e.status === "recusada" ? `<span class="selo selo--derrota">recusada</span>` : "";
const seloTipo = (e) => `<span class="selo">${e.tipo === "premier" ? "Premier" : "Própria"} · ${e.visibilidade === "publica" ? "pública" : "privada"}</span>`;

function mensagem(el, texto, erro = false) {
  if (!el) return;
  el.textContent = texto;
  el.className = `${el.className.split(" ")[0]} aviso${erro ? " aviso--erro" : ""}`;
  el.hidden = !texto;
}

// ---------- Galeria de cards (imagem da equipe) ----------
let cardsPromessa = null;
function listaCards() {
  if (cardsPromessa) return cardsPromessa;
  cardsPromessa = (async () => {
    try {
      const c = JSON.parse(localStorage.getItem("valreport.cards"));
      if (c && Date.now() - c.t < 7 * 864e5 && c.v?.length) return c.v;
    } catch (e) { /* sem armazenamento */ }
    try {
      const j = await (await fetch("https://valorant-api.com/v1/playercards?language=pt-BR")).json();
      const v = (j.data || []).map((x) => ({ u: x.uuid, n: x.displayName || "" }));
      if (v.length) { try { localStorage.setItem("valreport.cards", JSON.stringify({ t: Date.now(), v })); } catch (e) { /* cheio */ } }
      return v;
    } catch (e) { cardsPromessa = null; return []; }
  })();
  return cardsPromessa;
}

/** Campo de escolha de card: mostra o escolhido e abre uma galeria com busca */
function campoCard(nome, atual) {
  return `<div class="campo campo-card" data-campo-card="${esc(nome)}">
    <span>Imagem da equipe</span>
    <div class="campo-card__linha">
      <span class="campo-card__previa">${atual ? imagem(imgCard(atual, "smallart"), "", "", "?") : `<span class="avatar-vazio">?</span>`}</span>
      <input type="hidden" name="${esc(nome)}" value="${esc(atual || "")}">
      <button class="botao-secundario botao-mini" type="button" data-abrir-galeria>Escolher um card do jogo</button>
      <button class="botao-secundario botao-mini" type="button" data-limpar-card${atual ? "" : " hidden"}>Tirar</button>
    </div>
    <small>Enviar uma imagem própria chega na próxima atualização.</small>
    <div class="galeria" hidden>
      <input type="search" placeholder="Procurar card pelo nome (ex.: Jett, Champions, Premier)" aria-label="Procurar card">
      <div class="galeria__grade" role="listbox" aria-label="Cards"></div>
    </div></div>`;
}
function ligarCampoCard(el) {
  el.querySelectorAll("[data-campo-card]").forEach((bloco) => {
    const oculto = bloco.querySelector("input[type=hidden]"), previa = bloco.querySelector(".campo-card__previa");
    const galeria = bloco.querySelector(".galeria"), grade = bloco.querySelector(".galeria__grade"), busca = galeria.querySelector("input");
    const tirar = bloco.querySelector("[data-limpar-card]");
    const escolher = (u) => {
      oculto.value = u || "";
      previa.innerHTML = u ? imagem(imgCard(u, "smallart"), "", "", "?") : `<span class="avatar-vazio">?</span>`;
      tirar.hidden = !u;
    };
    const desenhar = async () => {
      const todos = await listaCards();
      if (!todos.length) {
        const meu = B.conta?.perfil?.riot_card;
        grade.innerHTML = `<p class="suave pequeno">Não foi possível carregar a galeria agora.${meu ? " Você pode usar o seu card:" : ""}</p>
          ${meu ? `<button type="button" class="galeria__item" data-card="${esc(meu)}">${imagem(imgCard(meu, "smallart"), "Seu card", "", "")}</button>` : ""}`;
        return;
      }
      const t = busca.value.trim().toLowerCase();
      const lista = (t ? todos.filter((c) => c.n.toLowerCase().includes(t)) : todos).slice(0, 48);
      grade.innerHTML = lista.length ? lista.map((c) => `<button type="button" class="galeria__item${c.u === oculto.value ? " escolhido" : ""}" data-card="${esc(c.u)}" title="${esc(c.n)}" role="option">
          ${imagem(imgCard(c.u, "smallart"), c.n, "", "")}</button>`).join("") : `<p class="suave pequeno">Nenhum card com esse nome.</p>`;
    };
    let espera = null;
    busca.addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(desenhar, 200); });
    bloco.querySelector("[data-abrir-galeria]").addEventListener("click", () => {
      galeria.hidden = !galeria.hidden;
      if (!galeria.hidden) { grade.innerHTML = `<p class="suave pequeno">Carregando cards…</p>`; desenhar(); busca.focus(); }
    });
    tirar.addEventListener("click", () => escolher(null));
    grade.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-card]");
      if (!b) return;
      escolher(b.dataset.card);
      galeria.hidden = true;
    });
  });
}

const camposVisibilidade = (atual = "privada") => `<fieldset class="campo"><legend>Quem pode ver a equipe</legend>
    <label class="campo--check"><input type="radio" name="visibilidade" value="privada"${atual !== "publica" ? " checked" : ""}>
      <span><strong>Privada</strong>: só quem é da equipe vê a página e os membros.</span></label>
    <label class="campo--check"><input type="radio" name="visibilidade" value="publica"${atual === "publica" ? " checked" : ""}>
      <span><strong>Pública</strong>: qualquer pessoa logada vê o nome e os membros (quem tem 16 ou 17 anos fica de fora).</span></label>
    <small>Partidas, estratégias e conversas são sempre só da equipe.</small></fieldset>`;

// ---------- Minhas equipes ----------
export async function viewMinhasEquipes() {
  let lista = [];
  try { lista = await rpc("minhas_equipes"); } catch (e) {
    return { titulo: "Minhas equipes", html: `<div class="vazio"><strong>Não foi possível abrir as suas equipes</strong><p>${esc(textoErro(e))}</p></div>` };
  }
  const temPropria = lista.some((e) => e.tipo === "propria" && e.status !== "recusada");
  const temPendente = lista.some((e) => e.status === "pendente");
  const podeCriar = B.conta.admin || (!temPropria && !temPendente);
  const cartoes = lista.map((e) => `<a class="equipe-cartao" href="#/time/${esc(e.slug)}">
      ${imagemEquipe(e)}
      <span class="equipe-cartao__texto"><strong>${esc(e.nome)}</strong>
        <span class="equipe-cartao__selos">${seloTipo(e)}<span class="selo selo--destaque">${esc(nomeCargo(e.cargo))}</span>${seloStatus(e)}</span>
        <small>${e.membros} membro${e.membros === 1 ? "" : "s"}${e.status === "recusada" && e.motivo_recusa ? ` · Motivo: ${esc(e.motivo_recusa)}` : ""}</small></span>
      ${icone("seta")}</a>`).join("");
  return {
    titulo: "Minhas equipes",
    html: `<section class="secao">
      <h1>Minhas equipes</h1>
      <p class="suave">Cada pessoa pode estar em uma equipe própria e em uma equipe Premier.</p>
      ${cartoes ? `<div class="equipes-lista secao">${cartoes}</div>` : `<div class="vazio secao"><strong>Você ainda não está em nenhuma equipe</strong><p>Crie a sua ou entre com o link de convite que a sua equipe mandou.</p></div>`}
      <div class="grade-2 secao">
        <section class="cartao"><div class="cartao__titulo"><h3>${icone("equipe")} Criar equipe</h3></div>
          ${podeCriar ? `<form id="form-criar-equipe" class="pilha-form">
              <label class="campo"><span>Nome da equipe</span><input name="nome" maxlength="40" required placeholder="Ex.: Juventus Academy"></label>
              ${camposVisibilidade()}
              ${campoCard("imagem_card", null)}
              <p class="form-msg" role="status" hidden></p>
              <p class="suave pequeno">${B.conta.admin ? "Como administradora, a sua equipe já nasce aprovada." : "A equipe fica aguardando a aprovação da administradora. Enquanto isso, só você está nela."}</p>
              <div class="lp-acoes"><button class="botao-primario" type="submit">Criar equipe</button></div></form>`
            : `<p class="suave pequeno">${temPendente ? "Você já tem uma equipe esperando aprovação." : "Você já está numa equipe própria. Para criar outra, saia dela antes."}</p>`}
          <p class="suave pequeno" style="margin-top:12px">Equipes Premier (conferidas pelo elenco do jogo) chegam na próxima atualização.</p></section>
        <section class="cartao"><div class="cartao__titulo"><h3>${icone("externo")} Tenho um convite</h3></div>
          <form id="form-convite" class="pilha-form">
            <label class="campo"><span>Link ou código do convite</span><input name="codigo" required placeholder="Cole aqui o link que a equipe mandou" autocomplete="off"></label>
            <p class="form-msg" role="status" hidden></p>
            <div class="lp-acoes"><button class="botao-secundario" type="submit">Abrir convite</button></div></form></section>
      </div></section>`,
    depois: (el) => {
      ligarCampoCard(el);
      const f = el.querySelector("#form-criar-equipe");
      f?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const msg = f.querySelector(".form-msg"), b = f.querySelector("[type=submit]");
        b.disabled = true;
        try {
          const r = await rpc("criar_equipe", { p_nome: f.nome.value, p_visibilidade: f.visibilidade.value, p_imagem_card: f.imagem_card.value || null });
          irPara(`#/time/${r.slug}`);
        } catch (e) { mensagem(msg, textoErro(e), true); b.disabled = false; }
      });
      const fc = el.querySelector("#form-convite");
      fc.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const m = /([a-z0-9]{16,40})\s*$/i.exec(fc.codigo.value.trim());
        if (!m) { mensagem(fc.querySelector(".form-msg"), "Não reconheci esse convite. Cole o link inteiro que a equipe mandou.", true); return; }
        location.hash = `#/convite/${m[1].toLowerCase()}`;
      });
    },
  };
}

// ---------- Convite ----------
export function guardarConvitePendente(codigo) { try { sessionStorage.setItem(K_CONVITE, codigo); } catch (e) { /* sem armazenamento */ } }
export function convitePendente() { try { return sessionStorage.getItem(K_CONVITE); } catch (e) { return null; } }

export async function viewConvite(codigo) {
  let c;
  try { c = await rpc("ver_convite", { p_codigo: codigo }); } catch (e) {
    return { titulo: "Convite", html: `<div class="vazio"><strong>Não foi possível abrir o convite</strong><p>${esc(textoErro(e))}</p></div>` };
  }
  const e = c.equipe;
  const corpo = !e ? "" : `<div class="convite__equipe">${imagemEquipe(e, "equipe-img equipe-img--grande")}
      <div><h1>${esc(e.nome)}</h1><p class="suave">${e.tipo === "premier" ? "Equipe Premier" : "Equipe"} · ${e.membros} membro${e.membros === 1 ? "" : "s"}</p></div></div>`;
  return {
    titulo: e ? `Convite · ${e.nome}` : "Convite",
    html: `<section class="cadastro cartao convite">
      <span class="lp-selo">${icone("equipe")} Convite para equipe</span>
      ${corpo}
      ${c.ja_membro ? `<p class="aviso">${icone("info")}<span>Você já faz parte desta equipe.</span></p><div class="lp-acoes"><a class="botao-primario" href="#/time/${esc(e.slug)}">Abrir a equipe</a></div>`
        : !c.valido ? `<p class="aviso aviso--erro">${icone("info")}<span>${esc(c.motivo)}</span></p><div class="lp-acoes"><a class="botao-secundario" href="#/equipes">Minhas equipes</a></div>`
          : `<p>Você entra como <strong>convidado</strong>: vê as partidas da equipe, e a liderança define o seu cargo depois.</p>
             ${B.conta?.perfil?.riot_verificado_em ? "" : `<p class="suave pequeno">Dica: peça a verificação do seu Riot ID no Meu perfil. A liderança da equipe pode confirmar.</p>`}
             <p class="form-msg" role="status" hidden></p>
             <div class="lp-acoes"><button class="botao-primario" type="button" data-aceitar>Entrar na equipe</button>
               <a class="botao-secundario" href="#/equipes">Agora não</a></div>`}
    </section>`,
    depois: (el) => {
      guardarConvitePendente("");
      el.querySelector("[data-aceitar]")?.addEventListener("click", async (ev) => {
        const b = ev.currentTarget;
        b.disabled = true;
        try {
          const slug = await rpc("entrar_por_convite", { p_codigo: codigo });
          irPara(`#/time/${slug}`);
        } catch (e) { mensagem(el.querySelector(".form-msg"), textoErro(e), true); b.disabled = false; }
      });
    },
  };
}

// ---------- Página da equipe ----------
const ABAS_TIME = [["membros", "Membros"], ["convites", "Convites"], ["ajustes", "Ajustes"]];

export async function viewTime(slug, aba = "membros") {
  let d = null;
  try { d = await rpc("equipe_detalhes", { p_slug: slug }); } catch (e) { d = null; }
  if (!d) {
    return { titulo: "Equipe", html: `<div class="vazio"><strong>Equipe não encontrada</strong><p>Ela pode ser privada ou ter sido encerrada.</p>
      <p><a class="botao-secundario" href="#/equipes">Minhas equipes</a></p></div>` };
  }
  const lider = d.admin || d.meu_cargo === "lider";
  const abasVisiveis = ABAS_TIME.filter(([a]) => a === "membros" || (a === "convites" && d.lideranca && d.status === "aprovada") || (a === "ajustes" && (d.sou_membro || d.admin)));
  if (!abasVisiveis.some(([a]) => a === aba)) aba = "membros";
  const temEstatisticas = (B.conta?.equipes || []).some((e) => e.slug === d.slug) && d.status === "aprovada";
  const cabeca = `<header class="time-cabeca">
      ${imagemEquipe(d, "equipe-img equipe-img--grande")}
      <div class="time-cabeca__texto"><h1>${esc(d.nome)}</h1>
        <p class="equipe-cartao__selos">${seloTipo(d)}${seloStatus(d)}${d.meu_cargo ? `<span class="selo selo--destaque">Você: ${esc(nomeCargo(d.meu_cargo))}</span>` : ""}</p></div>
      <div class="time-cabeca__acoes">${temEstatisticas ? `<button class="botao-secundario" type="button" data-ver-estatisticas="${esc(d.slug)}">${icone("raio")} Estatísticas</button>` : ""}</div>
    </header>
    ${d.status === "pendente" ? `<p class="aviso secao">${icone("relogio")}<span>Esta equipe está esperando a aprovação da administradora. Convites e cargos liberam depois.</span></p>
      ${d.admin ? `<div class="lp-acoes"><button class="botao-primario" type="button" data-revisar="sim">Aprovar equipe</button><button class="botao-perigo" type="button" data-revisar="nao">Recusar</button></div>` : ""}` : ""}
    ${d.status === "recusada" ? `<p class="aviso aviso--erro secao">${icone("info")}<span>A equipe não foi aprovada.${d.motivo_recusa ? ` Motivo: ${esc(d.motivo_recusa)}` : ""} Você pode encerrá-la em Ajustes e criar outra.</span></p>` : ""}
    <p class="form-msg secao" role="status" hidden></p>
    ${abasVisiveis.length > 1 ? `<nav class="abas" aria-label="Seções da equipe">${abasVisiveis.map(([a, t]) => `<a class="aba${a === aba ? " ativa" : ""}" href="#/time/${esc(d.slug)}/${a}"${a === aba ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav>` : ""}`;
  let corpo = "";
  let convites = [];
  if (aba === "convites") {
    try { convites = await rpc("listar_convites", { p_equipe: d.id }); } catch (e) { convites = []; }
  }
  if (aba === "membros") corpo = abaMembros(d, lider);
  else if (aba === "convites") corpo = abaConvites(d, convites);
  else corpo = abaAjustes(d, lider);
  return {
    titulo: d.nome,
    html: `<div class="time">${cabeca}<div class="secao">${corpo}</div></div>`,
    depois: (el) => ligarTime(el, d),
  };
}

function abaMembros(d, lider) {
  const linha = (m) => {
    const podeExpulsar = d.sou_membro !== undefined && m.usuario_id && !m.eu && m.cargo !== "lider"
      && (lider || (d.meu_cargo === "colider" && ["jogador", "treinador", "convidado"].includes(m.cargo)));
    const riot = m.riot_id ? `<a href="#/u/${encodeURIComponent(m.riot_id)}">${esc(m.riot_id)}</a> <span class="selo selo--verificado">${icone("verificado")}</span>`
      : m.riot_id_pedido ? `<span class="selo selo--alerta">pediu verificação: ${esc(m.riot_id_pedido)}</span>` : `<span class="suave">sem Riot ID verificado</span>`;
    const acoes = [];
    if (d.lideranca && m.usuario_id && m.riot_id_pedido && d.status === "aprovada") {
      acoes.push(`<button class="botao-primario botao-mini" type="button" data-acao="confirmar" data-riot="${esc(m.riot_id_pedido)}" title="Confirme que essa conta é mesmo dessa pessoa">Confirmar Riot ID</button>`);
    }
    if (lider && m.usuario_id && m.cargo !== "lider" && d.status === "aprovada") {
      acoes.push(`<select data-acao="cargo" aria-label="Cargo de ${esc(m.apelido)}">${CARGOS_EDITAVEIS.map((c) => `<option value="${c}"${c === m.cargo ? " selected" : ""}>${esc(nomeCargo(c))}</option>`).join("")}</select>`);
      acoes.push(`<button class="botao-secundario botao-mini" type="button" data-acao="lideranca">Passar a liderança</button>`);
    }
    if (podeExpulsar) acoes.push(`<button class="botao-perigo botao-mini" type="button" data-acao="expulsar">Remover</button>`);
    return `<li class="membro" data-usuario="${esc(m.usuario_id || "")}" data-apelido="${esc(m.apelido)}"${/^#[0-9a-f]{6}$/i.test(m.cor || "") ? ` style="--cor-perfil:${m.cor}"` : ""}>
      <span class="membro__avatar">${imagem(imgCard(m.riot_card), "", "", m.apelido)}</span>
      <div class="membro__texto"><strong>${esc(m.apelido)}${m.eu ? ` <span class="suave">(você)</span>` : ""}</strong>
        <span><span class="selo">${esc(nomeCargo(m.cargo))}</span>${m.protegido ? ` <span class="selo selo--alerta" title="16 ou 17 anos">modo protegido</span>` : ""} ${riot}</span></div>
      ${acoes.length ? `<div class="membro__acoes">${acoes.join("")}</div>` : ""}</li>`;
  };
  return `<p class="vagas"><span><strong>${d.vagas.jogadores}/7</strong> jogadores (liderança inclusa)</span><span><strong>${d.vagas.extras}/8</strong> treinadores e convidados</span></p>
    <ul class="membros">${d.membros.map(linha).join("")}</ul>
    ${d.ocultos ? `<p class="suave pequeno">+${d.ocultos} membro${d.ocultos === 1 ? "" : "s"} no modo protegido (só a equipe vê).</p>` : ""}
    ${lider && d.status === "aprovada" ? `<p class="suave pequeno">Cargos: até 2 co-líderes e 2 treinadores. Co-líderes criam convites, confirmam Riot IDs e removem jogadores, treinadores e convidados. Convidados não veem as notas da IGL.</p>` : ""}`;
}

function abaConvites(d, convites) {
  const quando = (c) => c.expira_em ? `vence ${esc(dataHora(c.expira_em))}` : "sem prazo";
  const usos = (c) => c.usos_max ? `${c.usos}/${c.usos_max} usos` : `${c.usos} uso${c.usos === 1 ? "" : "s"} · ilimitado`;
  return `<section class="cartao"><div class="cartao__titulo"><h3>Novo link de convite</h3></div>
      <form id="form-novo-convite" class="convite-form">
        <label class="campo"><span>Validade</span><select name="horas"><option value="24">1 dia</option><option value="168" selected>7 dias</option><option value="720">30 dias</option><option value="">Sem prazo</option></select></label>
        <label class="campo"><span>Quantas pessoas</span><select name="usos"><option value="1">1 pessoa</option><option value="5">até 5</option><option value="10">até 10</option><option value="" selected>Sem limite</option></select></label>
        <div class="lp-acoes"><button class="botao-primario" type="submit">Criar link</button></div></form>
      <p class="suave pequeno">Quem entra pelo link chega como convidado. Depois, a liderança define o cargo em Membros.</p></section>
    <section class="cartao secao"><div class="cartao__titulo"><h3>Links ativos</h3></div>
      ${convites.length ? `<ul class="convites">${convites.map((c) => `<li class="${c.ativo ? "" : "inativo"}" data-codigo="${esc(c.codigo)}">
          <input readonly value="${esc(urlConvite(c.codigo))}" aria-label="Link do convite">
          <small>${c.ativo ? "" : "<strong>encerrado</strong> · "}${quando(c)} · ${usos(c)}${c.criado_por ? ` · criado por ${esc(c.criado_por)}` : ""}</small>
          <div class="lp-acoes"><button class="botao-secundario botao-mini" type="button" data-copiar>Copiar link</button>
            <button class="botao-perigo botao-mini" type="button" data-revogar>Cancelar</button></div></li>`).join("")}</ul>`
        : `<p class="suave pequeno">Nenhum link ainda.</p>`}</section>`;
}

function abaAjustes(d, lider) {
  return `${lider ? `<form id="form-ajustes" class="cartao pilha-form">
      <div class="cartao__titulo"><h3>Dados da equipe</h3></div>
      <label class="campo"><span>Nome</span><input name="nome" value="${esc(d.nome)}" maxlength="40" required></label>
      ${camposVisibilidade(d.visibilidade)}
      ${campoCard("imagem_card", d.imagem_card)}
      <div class="lp-acoes"><button class="botao-primario" type="submit">Salvar</button></div></form>` : ""}
    ${d.sou_membro ? `<section class="cartao secao"><div class="cartao__titulo"><h3>Sair da equipe</h3></div>
      <p class="suave pequeno">${d.meu_cargo === "lider" ? (d.membros.length > 1 ? "Para sair, passe a liderança para outra pessoa em Membros." : "Você é a única pessoa da equipe: ao sair, a equipe é encerrada.") : "Você deixa de ver as partidas e as conversas da equipe."}</p>
      <div class="lp-acoes"><button class="botao-perigo" type="button" data-sair-equipe${d.meu_cargo === "lider" && d.membros.length > 1 ? " disabled" : ""}>${d.membros.length === 1 ? "Encerrar a equipe" : "Sair da equipe"}</button></div></section>` : ""}`;
}

function ligarTime(el, d) {
  ligarCampoCard(el);
  const msg = el.querySelector(".form-msg");
  const acao = async (b, fn) => {
    b.disabled = true;
    try { await fn(); recarregar(); } catch (e) { mensagem(msg, textoErro(e), true); msg.scrollIntoView({ block: "nearest" }); b.disabled = false; }
  };
  el.querySelector("[data-ver-estatisticas]")?.addEventListener("click", (ev) => {
    try { localStorage.setItem("valreport.equipe", ev.currentTarget.dataset.verEstatisticas); } catch (e) { /* sem armazenamento */ }
    irPara("#/equipe");
  });
  el.querySelectorAll("[data-revisar]").forEach((b) => b.addEventListener("click", () => {
    const aprovar = b.dataset.revisar === "sim";
    const motivo = aprovar ? null : prompt("Motivo da recusa (aparece para quem criou a equipe):", "");
    if (!aprovar && motivo === null) return;
    acao(b, () => rpc("admin_revisar_equipe", { p_equipe: d.id, p_aprovar: aprovar, p_motivo: motivo }));
  }));
  el.querySelector(".membros")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acao]");
    if (!b) return;
    const li = b.closest(".membro"), alvo = li.dataset.usuario, apelido = li.dataset.apelido;
    if (b.dataset.acao === "confirmar") {
      if (!confirm(`Confirmar que ${b.dataset.riot} é a conta de ${apelido}? Só confirme se você tem certeza de que é dessa pessoa.`)) return;
      acao(b, () => funcao("riot", { acao: "lider_verificar", usuario_id: alvo, riot_id: b.dataset.riot }));
    } else if (b.dataset.acao === "lideranca") {
      if (!confirm(`Passar a liderança para ${apelido}? Você vira co-líder (ou jogador, se já houver 2 co-líderes).`)) return;
      acao(b, () => rpc("passar_lideranca", { p_equipe: d.id, p_usuario: alvo }));
    } else if (b.dataset.acao === "expulsar") {
      if (!confirm(`Remover ${apelido} da equipe?`)) return;
      acao(b, () => rpc("expulsar_membro", { p_equipe: d.id, p_usuario: alvo }));
    }
  });
  el.querySelector(".membros")?.addEventListener("change", (ev) => {
    const s = ev.target.closest("select[data-acao=cargo]");
    if (!s) return;
    acao(s, () => rpc("definir_cargo", { p_equipe: d.id, p_usuario: s.closest(".membro").dataset.usuario, p_cargo: s.value }));
  });
  const fn = el.querySelector("#form-novo-convite");
  fn?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    acao(fn.querySelector("button"), () => rpc("criar_convite", { p_equipe: d.id, p_horas: fn.horas.value ? Number(fn.horas.value) : null, p_usos: fn.usos.value ? Number(fn.usos.value) : null }));
  });
  el.querySelector(".convites")?.addEventListener("click", async (ev) => {
    const li = ev.target.closest("li[data-codigo]");
    if (!li) return;
    if (ev.target.closest("[data-copiar]")) {
      const campo = li.querySelector("input");
      try { await navigator.clipboard.writeText(campo.value); mensagem(msg, "Link copiado ✓"); } catch (e) { campo.select(); mensagem(msg, "Selecionei o link: copie com Ctrl+C."); }
    } else if (ev.target.closest("[data-revogar]")) {
      if (!confirm("Cancelar este link? Quem ainda não entrou não vai conseguir usar.")) return;
      acao(ev.target.closest("[data-revogar]"), () => rpc("revogar_convite", { p_codigo: li.dataset.codigo }));
    }
  });
  const fa = el.querySelector("#form-ajustes");
  fa?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    acao(fa.querySelector("[type=submit]"), () => rpc("editar_equipe", { p_equipe: d.id, p_nome: fa.nome.value, p_visibilidade: fa.visibilidade.value, p_imagem_card: fa.imagem_card.value || null }));
  });
  el.querySelector("[data-sair-equipe]")?.addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    if (!confirm(d.membros.length === 1 ? "Encerrar a equipe? Isso não dá para desfazer." : "Sair da equipe?")) return;
    b.disabled = true;
    try { await rpc("sair_da_equipe", { p_equipe: d.id }); irPara("#/equipes"); } catch (e) { mensagem(msg, textoErro(e), true); b.disabled = false; }
  });
}

// ---------- Painel: equipes esperando aprovação ----------
export async function blocoAprovacoes() {
  let lista = [];
  try { lista = await rpc("admin_equipes_pendentes"); } catch (e) { return ""; }
  if (!lista.length) return `<section class="cartao secao"><div class="cartao__titulo"><h3>Equipes esperando aprovação</h3></div><p class="suave pequeno">Nenhuma agora.</p></section>`;
  return `<section class="cartao secao aprovacoes"><div class="cartao__titulo"><h3>Equipes esperando aprovação <span class="selo selo--alerta">${lista.length}</span></h3></div>
    <ul class="lista-limpa">${lista.map((e) => `<li class="aprovacao" data-equipe="${esc(e.id)}">
      ${imagemEquipe(e)}
      <div><strong><a href="#/time/${esc(e.slug)}">${esc(e.nome)}</a></strong> ${seloTipo(e)}
        <small class="suave" style="display:block">Criada por ${esc(e.criadora?.apelido || "?")} (${esc(e.criadora?.email || "")})${e.criadora?.riot_id ? ` · ${esc(e.criadora.riot_id)}` : ""} em ${esc(dataHora(e.criado_em))}</small></div>
      <div class="lp-acoes"><button class="botao-primario botao-mini" type="button" data-aprovar="sim">Aprovar</button>
        <button class="botao-perigo botao-mini" type="button" data-aprovar="nao">Recusar</button></div></li>`).join("")}</ul></section>`;
}
export function ligarAprovacoes(el) {
  el.querySelector(".aprovacoes")?.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-aprovar]");
    if (!b) return;
    const aprovar = b.dataset.aprovar === "sim";
    const motivo = aprovar ? null : prompt("Motivo da recusa (aparece para quem criou a equipe):", "");
    if (!aprovar && motivo === null) return;
    b.disabled = true;
    try { await rpc("admin_revisar_equipe", { p_equipe: b.closest("[data-equipe]").dataset.equipe, p_aprovar: aprovar, p_motivo: motivo }); recarregar(); }
    catch (e) { alert(textoErro(e)); b.disabled = false; }
  });
}
