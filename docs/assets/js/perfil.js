// Perfil: "Meu perfil" (editar + verificar o Riot ID pelo desafio do card), perfil público e busca por nick#tag

import { esc, icone, imagem, imgCard } from "./util.js";
import { B } from "./dados.js";
import { rpc, atualizar, funcao, usuario } from "./nuvem.js";

export const FUNCOES = ["Duelista", "Iniciador", "Controlador", "Sentinela", "Flex"];
export const CORES = [["#ff4655", "Vermelho"], ["#f2994a", "Laranja"], ["#e5b93c", "Dourado"], ["#2fbf71", "Verde"],
  ["#1fb5c9", "Ciano"], ["#4a7dff", "Azul"], ["#9b6bff", "Roxo"], ["#ff5fa2", "Rosa"]];
const CDN = "https://media.valorant-api.com";

// Agentes de reserva (se o valorant-api.com não responder): nome → [uuid, função]
const AGENTES_RESERVA = {
  Astra: ["41fb69c1-4189-7b37-f117-bcaf1e96f1bf", "Controlador"], Breach: ["5f8d3a7f-467b-97f3-062c-13acf203c006", "Iniciador"],
  Brimstone: ["9f0d8ba9-4140-b941-57d3-a7ad57c6b417", "Controlador"], Chamber: ["22697a3d-45bf-8dd7-4fec-84a9e28c69d7", "Sentinela"],
  Clove: ["1dbf2edd-4729-0984-3115-daa5eed44993", "Controlador"], Cypher: ["117ed9e3-49f3-6512-3ccf-0cada7e3823b", "Sentinela"],
  Deadlock: ["cc8b64c8-4b25-4ff9-6e7f-37b4da43d235", "Sentinela"], Fade: ["dade69b4-4f5a-8528-247b-219e5a1facd6", "Iniciador"],
  Gekko: ["e370fa57-4757-3604-3648-499e1f642d3f", "Iniciador"], Harbor: ["95b78ed7-4637-86d9-7e41-71ba8c293152", "Controlador"],
  Iso: ["0e38b510-41a8-5780-5e8f-568b2a4f2d6c", "Duelista"], Jett: ["add6443a-41bd-e414-f6ad-e58d267f4e95", "Duelista"],
  "KAY/O": ["601dbbe7-43ce-be57-2a40-4abd24953621", "Iniciador"], Killjoy: ["1e58de9c-4950-5125-93e9-a0aee9f98746", "Sentinela"],
  Miks: ["7c8a4701-4de6-9355-b254-e09bc2a34b72", ""], Neon: ["bb2a4828-46eb-8cd1-e765-15848195d751", "Duelista"],
  Omen: ["8e253930-4c05-31dd-1b6c-968525494517", "Controlador"], Phoenix: ["eb93336a-449b-9c1b-0a54-a891f7921d69", "Duelista"],
  Raze: ["f94c3b30-42be-e959-889c-5aa313dba261", "Duelista"], Reyna: ["a3bfb853-43b2-7238-a4f1-ad90e9e46bcc", "Duelista"],
  Sage: ["569fdd95-4d10-43ab-ca70-79becc718b46", "Sentinela"], Skye: ["6f2a04ca-43e0-be17-7f36-b3908627744d", "Iniciador"],
  Sova: ["320b2a48-4d9b-a075-30f1-1f93a9b638fa", "Iniciador"], Tejo: ["b444168c-4e35-8076-db47-ef9bf368f384", "Iniciador"],
  Veto: ["92eeef5d-43b5-1d4a-8d03-b3927a09034b", "Sentinela"], Viper: ["707eab51-4836-f488-046a-cda6bf494859", "Controlador"],
  Vyse: ["efba5359-4016-a1e5-7626-b1ae76895940", "Sentinela"], Waylay: ["df1cb487-4902-002e-5c17-d28e83e78588", "Duelista"],
  Yoru: ["7f94d92c-4234-0a36-9646-3a87eb8b5c89", "Duelista"],
};

function lerCache(k, maxHoras) {
  try {
    const c = JSON.parse(localStorage.getItem(k));
    return c && Date.now() - c.t < maxHoras * 3600e3 ? c.v : null;
  } catch (e) { return null; }
}
function gravarCache(k, v) { try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch (e) { /* sem armazenamento */ } }

/** Lista de agentes jogáveis {nome, uuid, funcao}, em ordem alfabética (valorant-api.com, guardada por 7 dias) */
let agentesPromessa = null;
export function listaAgentes() {
  if (agentesPromessa) return agentesPromessa;
  const reserva = () => {
    const base = { ...AGENTES_RESERVA };
    for (const [n, a] of Object.entries(B.meta?.agentes || {})) base[n] = [a.uuid, a.fn === "Outra" ? "" : a.fn];
    return Object.entries(base).map(([nome, [uuid, fn]]) => ({ nome, uuid, funcao: fn }));
  };
  agentesPromessa = (async () => {
    let lista = lerCache("valreport.agentes", 24 * 7);
    if (!lista) {
      try {
        const r = await fetch("https://valorant-api.com/v1/agents?isPlayableCharacter=true&language=pt-BR");
        const j = await r.json();
        lista = (j.data || []).map((a) => ({ nome: a.displayName, uuid: a.uuid, funcao: a.role?.displayName || "" }));
        if (lista.length > 10) gravarCache("valreport.agentes", lista); else lista = null;
      } catch (e) { lista = null; }
    }
    return (lista || reserva()).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  })();
  return agentesPromessa;
}
const imgAgenteUuid = (uuid) => (uuid ? `${CDN}/agents/${uuid}/displayicon.png` : null);

/** Título do jogador: a API manda um código; o texto vem do valorant-api.com (guardado por 30 dias) */
async function textoTitulo(titulo) {
  if (!titulo) return "";
  if (!/^[0-9a-f-]{36}$/i.test(titulo)) return titulo;
  const k = `valreport.titulo.${titulo}`;
  const c = lerCache(k, 24 * 30);
  if (c != null) return c;
  try {
    const j = await (await fetch(`https://valorant-api.com/v1/playertitles/${titulo}?language=pt-BR`)).json();
    const t = j.data?.titleText || "";
    gravarCache(k, t);
    return t;
  } catch (e) { return ""; }
}
function preencherTitulos(el) {
  el.querySelectorAll("[data-titulo]").forEach(async (s) => {
    const t = await textoTitulo(s.dataset.titulo);
    if (t) { s.textContent = t; s.hidden = false; }
  });
}

const urlPerfil = (riot) => `#/u/${encodeURIComponent(riot)}`;
const corValida = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : null);
const seloVerificado = `<span class="selo selo--verificado" title="Riot ID verificado pelo desafio do card">${icone("verificado")} verificado</span>`;

/** Capa do perfil: card largo do jogo, avatar, nome, Riot ID, título e nível */
const estiloCor = (p) => (corValida(p.cor) ? ` style="--cor-perfil:${corValida(p.cor)}"` : "");
function capa(p, { extra = "" } = {}) {
  return `<section class="perfil-capa">
    <div class="perfil-capa__fundo">${p.riot_card ? imagem(imgCard(p.riot_card, "wideart"), "", "", "") : ""}</div>
    <div class="perfil-capa__conteudo">
      <span class="perfil-capa__avatar">${imagem(imgCard(p.riot_card), "", "", p.apelido)}</span>
      <div class="perfil-capa__texto">
        <h1>${esc(p.apelido)}</h1>
        <p>${p.riot_id ? `<strong>${esc(p.riot_id)}</strong> ${p.verificado ? seloVerificado : ""}` : `<span class="suave">Riot ID ainda não verificado</span>`}</p>
        <p class="perfil-capa__sub"><span data-titulo="${esc(p.riot_titulo || "")}" hidden></span>${p.riot_nivel ? `<span>Nível ${esc(p.riot_nivel)}</span>` : ""}</p>
      </div>
      ${extra ? `<div class="perfil-capa__acoes">${extra}</div>` : ""}
    </div></section>`;
}

function blocoSobre(p, agentes) {
  const porNome = new Map(agentes.map((a) => [a.nome, a]));
  const ags = (p.agentes || []).map((n) => {
    const a = porNome.get(n);
    return `<li class="perfil-agente">${imagem(imgAgenteUuid(a?.uuid), "", "", n)}<span>${esc(n)}</span></li>`;
  }).join("");
  const fns = (p.funcoes || []).map((f, i) => `<li class="chip-funcao"><b>${i + 1}</b>${esc(f)}</li>`).join("");
  return `<div class="grade-2 secao">
      <section class="cartao"><div class="cartao__titulo"><h3>Sobre</h3></div>
        ${p.bio ? `<p class="perfil-bio">${esc(p.bio)}</p>` : `<p class="suave pequeno">Sem bio por enquanto.</p>`}
        ${fns ? `<h4 class="perfil-sub">Funções preferidas</h4><ol class="lista-funcoes">${fns}</ol>` : ""}</section>
      <section class="cartao"><div class="cartao__titulo"><h3>Agentes favoritos</h3></div>
        ${ags ? `<ol class="lista-agentes">${ags}</ol>` : `<p class="suave pequeno">Nenhum agente escolhido.</p>`}</section>
    </div>`;
}

// ---------- Perfil público ----------
export async function viewPerfilPublico(riot) {
  let p = null;
  try { p = await rpc("perfil_publico", { p_riot_id: riot }); } catch (e) { p = null; }
  if (!p) {
    return { titulo: "Perfil", html: `<div class="vazio"><strong>Perfil não encontrado</strong>
      <p>Esse Riot ID não está verificado no ValReport, ou o perfil é visível só para a equipe da pessoa.</p>
      <p><a class="botao-secundario" href="#/perfil">Meu perfil</a></p></div>` };
  }
  const agentes = await listaAgentes();
  p.verificado = Boolean(p.verificado_em);
  const equipes = (p.equipes || []).map((e) => `<li><strong>${esc(e.nome)}</strong>${e.cargo ? ` <span class="selo">${esc(e.cargo)}</span>` : ""}</li>`).join("");
  return {
    titulo: p.apelido,
    html: `<div class="perfil"${estiloCor(p)}>${capa(p, { extra: p.eh_voce ? `<a class="botao-secundario" href="#/perfil">${icone("nota")} Editar perfil</a>` : "" })}
      ${p.protegido && p.eh_voce ? `<p class="aviso secao">${icone("escudo")}<span>Modo protegido: o seu perfil só aparece para quem é da sua equipe.</span></p>` : ""}
      ${blocoSobre(p, agentes)}
      <div class="grade-2 secao">
        <section class="cartao"><div class="cartao__titulo"><h3>Equipes</h3></div>
          ${equipes ? `<ul class="lista-limpa">${equipes}</ul>` : `<p class="suave pequeno">Nenhuma equipe pública.</p>`}</section>
        <section class="cartao"><div class="cartao__titulo"><h3>Partidas</h3></div>
          <p class="suave pequeno">${p.historico_publico ? "O histórico de partidas chega ao perfil público na próxima atualização do ValReport." : "Esta pessoa preferiu não mostrar o histórico de partidas."}</p></section>
      </div></div>`,
    depois: preencherTitulos,
  };
}

// ---------- Meu perfil ----------
const K_DESAFIO = "valreport.desafio";
const lerDesafio = () => { try { const d = JSON.parse(sessionStorage.getItem(K_DESAFIO)); return d && new Date(d.expira_em) > new Date() ? d : null; } catch (e) { return null; } };
const gravarDesafio = (d) => { try { if (d) sessionStorage.setItem(K_DESAFIO, JSON.stringify(d)); else sessionStorage.removeItem(K_DESAFIO); } catch (e) { /* sem armazenamento */ } };

function blocoRiot(p) {
  if (p.riot_verificado_em) {
    return `<section class="cartao secao" id="bloco-riot"><div class="cartao__titulo"><h3>${icone("verificado")} Riot ID verificado</h3></div>
      <p><strong>${esc(p.riot_id)}</strong> · verificado em ${esc(new Date(p.riot_verificado_em).toLocaleDateString("pt-BR"))}</p>
      <p class="suave pequeno">Mudou de card, de nome ou subiu de nível? Atualize aqui (uma vez a cada 10 minutos).</p>
      <p class="riot-msg pequeno" role="status" hidden></p>
      <div class="lp-acoes"><button class="botao-secundario" type="button" data-riot="atualizar">${icone("atualizar")} Atualizar card e nível</button>
        <a class="botao-secundario" href="${urlPerfil(p.riot_id)}">Ver meu perfil público</a>
        <button class="botao-perigo botao-mini" type="button" data-riot="desvincular">Trocar de Riot ID</button></div></section>`;
  }
  return `<section class="cartao secao" id="bloco-riot"><div class="cartao__titulo"><h3>${icone("verificado")} Verifique o seu Riot ID</h3></div>
    <p>Para provar que a conta é sua, o ValReport pede uma troca rápida de card no VALORANT. Pode ser <strong>qualquer card que você tenha</strong>, inclusive o padrão.</p>
    <div class="desafio" data-desafio></div></section>`;
}

function passoHtml(d) {
  if (!d) {
    return `<form class="desafio__inicio" data-riot-form>
      <label class="campo"><span>Seu Riot ID</span><input name="riot" placeholder="Nome#TAG" autocomplete="off" required maxlength="22"></label>
      <p class="riot-msg aviso aviso--erro" role="alert" hidden></p>
      <div class="lp-acoes"><button class="botao-primario" type="submit">Começar a verificação</button></div></form>`;
  }
  const passo1 = d.passo === 1;
  return `<ol class="desafio__passos">
      <li class="${passo1 ? "atual" : "feito"}"><b>1</b>Troque para <strong>outro card</strong></li>
      <li class="${passo1 ? "" : "atual"}"><b>2</b>Volte para o card de antes</li></ol>
    <div class="desafio__cartao">
      <div class="desafio__card">${imagem(imgCard(d.card_inicial, "largeart"), "Card de antes", "", "")}<small>${passo1 ? "Seu card agora" : "Volte para este card"}</small></div>
      <div class="desafio__texto">
        <p><strong>${esc(d.riot_id)}</strong></p>
        ${passo1
          ? `<p>No VALORANT, abra <strong>Coleção → Cards</strong> e equipe <strong>qualquer outro card</strong>. Depois toque em Conferir.</p>`
          : `<p>Boa, a troca chegou! Agora equipe de novo <strong>este card</strong> (o de antes) e toque em Conferir.</p>`}
        <p class="suave pequeno">O jogo pode levar alguns segundos para avisar a troca. Se não reconhecer, espere um pouco e confira de novo. O desafio vale até <span data-expira>${esc(new Date(d.expira_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }))}</span>.</p>
        <p class="riot-msg pequeno" role="status" hidden></p>
        <div class="lp-acoes"><button class="botao-primario" type="button" data-riot="conferir">Conferir</button>
          <button class="botao-secundario" type="button" data-riot="cancelar">Cancelar</button></div>
      </div></div>`;
}

function formPerfil(p, agentes, protegido) {
  const escolhidos = p.agentes || [];
  const botoesAgentes = agentes.map((a) => {
    const i = escolhidos.indexOf(a.nome);
    return `<button type="button" class="agente-op${i >= 0 ? " escolhido" : ""}" data-agente="${esc(a.nome)}" aria-pressed="${i >= 0}" title="${esc(a.nome)}${a.funcao ? ` · ${esc(a.funcao)}` : ""}">
      ${imagem(imgAgenteUuid(a.uuid), "", "", a.nome)}<span>${esc(a.nome)}</span><b class="agente-op__ordem">${i >= 0 ? i + 1 : ""}</b></button>`;
  }).join("");
  const fn = (n) => `<label class="campo"><span>${n + 1}ª função</span><select name="funcao${n}">
      <option value="">—</option>${FUNCOES.map((f) => `<option${(p.funcoes || [])[n] === f ? " selected" : ""}>${f}</option>`).join("")}</select></label>`;
  const cor = corValida(p.cor);
  const cores = [["", "Sem cor (padrão)"], ...CORES].map(([c, nome]) => `<label class="cor-op" title="${nome}">
      <input type="radio" name="cor" value="${c}"${(cor || "") === c ? " checked" : ""}><span${c ? ` style="--c:${c}"` : ` class="cor-op--padrao"`} aria-label="${nome}"></span></label>`).join("");
  return `<form id="form-perfil" class="cartao secao pilha-form" novalidate>
    <div class="cartao__titulo"><h3>Seu perfil</h3></div>
    <label class="campo"><span>Apelido</span><input name="apelido" value="${esc(p.apelido)}" minlength="2" maxlength="24" required></label>
    <label class="campo"><span>Bio</span><textarea name="bio" maxlength="200" rows="3" placeholder="Conte um pouco do seu jeito de jogar">${esc(p.bio || "")}</textarea>
      <small><span data-contador>${(p.bio || "").length}</span>/200</small></label>
    <fieldset class="campo"><legend>Agentes favoritos <small class="suave">(até 5, na ordem que você tocar)</small></legend>
      <div class="seletor-agentes" data-agentes='${esc(JSON.stringify(escolhidos))}'>${botoesAgentes}</div></fieldset>
    <fieldset class="campo"><legend>Funções em ordem de preferência</legend><div class="grade-3 funcoes-campos">${fn(0)}${fn(1)}${fn(2)}</div></fieldset>
    <fieldset class="campo"><legend>Cor de destaque</legend><div class="cores">${cores}</div></fieldset>
    <label class="campo--check"><input type="checkbox" name="historico"${p.historico_publico !== false ? " checked" : ""}>
      <span>Mostrar o meu histórico de partidas no perfil público${protegido ? " (no modo protegido, só a sua equipe vê o perfil)" : ""}</span></label>
    <p class="form-msg aviso" role="status" hidden></p>
    <div class="lp-acoes"><button class="botao-primario" type="submit">Salvar perfil</button></div>
  </form>`;
}

export async function viewMeuPerfil() {
  const c = B.conta, p = c.perfil;
  const agentes = await listaAgentes();
  const vp = { ...p, verificado: Boolean(p.riot_verificado_em) };
  return {
    titulo: "Meu perfil",
    html: `<div class="perfil"${estiloCor(p)}>${capa(vp, { extra: `<a class="botao-secundario" href="#/conta">${icone("escudo")} Conta e privacidade</a>` })}
      ${c.protegido ? `<p class="aviso secao">${icone("escudo")}<span><strong>Modo protegido.</strong> O seu perfil só aparece para quem é da sua equipe.</span></p>` : ""}
      ${blocoRiot(p)}
      ${formPerfil(p, agentes, c.protegido)}</div>`,
    depois: (el) => { preencherTitulos(el); ligarRiot(el); ligarFormPerfil(el); },
  };
}

function mensagem(el, texto, tipo = "") {
  el.textContent = texto;
  el.className = `${el.className.split(" ")[0]} ${tipo === "erro" ? "aviso aviso--erro" : "aviso"}`;
  el.hidden = !texto;
}

function ligarFormPerfil(el) {
  const f = el.querySelector("#form-perfil");
  const grade = f.querySelector(".seletor-agentes");
  let escolhidos = JSON.parse(grade.dataset.agentes || "[]");
  const msg = f.querySelector(".form-msg");
  const desenhar = () => grade.querySelectorAll("[data-agente]").forEach((b) => {
    const i = escolhidos.indexOf(b.dataset.agente);
    b.classList.toggle("escolhido", i >= 0);
    b.setAttribute("aria-pressed", String(i >= 0));
    b.querySelector(".agente-op__ordem").textContent = i >= 0 ? i + 1 : "";
  });
  grade.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-agente]");
    if (!b) return;
    const n = b.dataset.agente;
    if (escolhidos.includes(n)) escolhidos = escolhidos.filter((x) => x !== n);
    else if (escolhidos.length >= 5) { mensagem(msg, "Dá para escolher até 5 agentes. Toque num escolhido para tirar.", "erro"); return; }
    else escolhidos.push(n);
    mensagem(msg, "");
    desenhar();
  });
  f.bio.addEventListener("input", () => { f.querySelector("[data-contador]").textContent = f.bio.value.length; });
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const funcoes = [f.funcao0.value, f.funcao1.value, f.funcao2.value].filter(Boolean);
    if (new Set(funcoes).size !== funcoes.length) { mensagem(msg, "Escolha funções diferentes em cada posição.", "erro"); return; }
    const apelido = f.apelido.value.trim();
    if (apelido.length < 2) { mensagem(msg, "O apelido precisa ter de 2 a 24 caracteres.", "erro"); return; }
    const mudancas = { apelido, bio: f.bio.value.trim(), agentes: escolhidos, funcoes, cor: f.cor.value || null, historico_publico: f.historico.checked };
    const botao = f.querySelector("[type=submit]");
    botao.disabled = true;
    try {
      await atualizar("perfis", `id=eq.${encodeURIComponent(usuario().id)}`, mudancas);
      Object.assign(B.conta.perfil, mudancas);
      mensagem(msg, "Perfil salvo ✓");
      window.dispatchEvent(new CustomEvent("valreport:perfil"));
      const perfilEl = el.querySelector(".perfil");
      if (mudancas.cor) perfilEl.style.setProperty("--cor-perfil", mudancas.cor); else perfilEl.style.removeProperty("--cor-perfil");
      perfilEl.querySelector(".perfil-capa h1").textContent = apelido;
    } catch (e) {
      const m = String(e.message || e);
      mensagem(msg, m.replace(/^(bio|agentes|funcoes|cor): /, ""), "erro");
    } finally { botao.disabled = false; }
  });
}

function ligarRiot(el) {
  const bloco = el.querySelector("#bloco-riot");
  const area = bloco.querySelector("[data-desafio]");
  let relogio = null;
  const pararRelogio = () => { clearInterval(relogio); relogio = null; };

  const desenhar = (d) => {
    area.innerHTML = passoHtml(d);
    pararRelogio();
    const form = area.querySelector("[data-riot-form]");
    if (form) {
      form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const msg = form.querySelector(".riot-msg"), b = form.querySelector("button");
        b.disabled = true;
        b.textContent = "Procurando a conta…";
        try {
          const r = await funcao("riot", { acao: "iniciar", riot_id: form.riot.value.trim() });
          gravarDesafio(r);
          desenhar(r);
        } catch (e) {
          mensagem(msg, e.message, "erro");
          b.disabled = false;
          b.textContent = "Começar a verificação";
        }
      });
    }
  };

  const esperar = (botao, s, depois = null) => {
    botao.disabled = true;
    let falta = s;
    const passo = () => {
      if (!botao.isConnected) { pararRelogio(); return; }
      if (falta <= 0) { pararRelogio(); botao.disabled = false; botao.textContent = "Conferir"; if (depois) depois(); return; }
      botao.textContent = `Conferir (${falta}s)`;
      falta--;
    };
    pararRelogio();
    passo();
    relogio = setInterval(passo, 1000);
  };

  bloco.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-riot]");
    if (!b) return;
    const acao = b.dataset.riot;
    const msg = bloco.querySelector(".riot-msg");
    if (acao === "desvincular" && !confirm("Desligar este Riot ID da sua conta? Você poderá verificar outro (ou o mesmo) depois.")) return;
    b.disabled = true;
    try {
      const r = await funcao("riot", { acao });
      if (acao === "cancelar") { gravarDesafio(null); desenhar(null); return; }
      if (acao === "conferir") {
        if (r.verificado) {
          gravarDesafio(null);
          Object.assign(B.conta.perfil, { riot_id: r.riot_id, riot_card: r.riot_card, riot_titulo: r.riot_titulo, riot_nivel: r.riot_nivel, riot_verificado_em: new Date().toISOString() });
          area.innerHTML = `<div class="desafio__ok">${icone("verificado")}<div><strong>Pronto, ${esc(r.riot_id)} verificado!</strong><p class="suave pequeno">O selo já aparece no seu perfil.</p></div></div>`;
          window.dispatchEvent(new CustomEvent("valreport:perfil"));
          setTimeout(() => window.dispatchEvent(new CustomEvent("valreport:recarregar")), 1800);
          return;
        }
        gravarDesafio(r);
        if (r.passo === 2 && r.mudou) { desenhar(r); return; }
        if (r.espere_s) { esperar(b, r.espere_s, () => b.click()); mensagem(msg, "Só um instante: confiro sozinho em seguida.", ""); return; }
        mensagem(msg, r.passo === 1 ? "Ainda aparece o mesmo card. Troque de card no jogo e confira de novo." : "Ainda aparece o outro card. Volte para o card de antes e confira de novo.", "erro");
        esperar(b, 6);
        return;
      }
      if (acao === "atualizar") {
        Object.assign(B.conta.perfil, { riot_id: r.riot_id, riot_card: r.riot_card, riot_titulo: r.riot_titulo, riot_nivel: r.riot_nivel });
        window.dispatchEvent(new CustomEvent("valreport:recarregar"));
        return;
      }
      if (acao === "desvincular") { window.dispatchEvent(new CustomEvent("valreport:recarregar")); return; }
    } catch (e) {
      if (["expirou", "sem_desafio"].includes(e.codigo)) { gravarDesafio(null); desenhar(null); mensagem(area.querySelector(".riot-msg"), e.message, "erro"); return; }
      if (msg) mensagem(msg, e.message, "erro");
      b.disabled = false;
    }
    if (b.isConnected && !relogio) b.disabled = false;
  });

  if (area) desenhar(lerDesafio());
}

// ---------- Busca por nick#tag (no topo) ----------
export function ligarBusca() {
  const botao = document.getElementById("buscar-topo"), painel = document.getElementById("busca");
  if (!botao || !painel) return;
  const campo = painel.querySelector("input"), lista = painel.querySelector("[data-resultados]");
  let espera = null, ultima = "";
  const abrir = (sim) => {
    painel.hidden = !sim;
    botao.setAttribute("aria-expanded", String(sim));
    if (sim) { campo.focus(); campo.select(); }
  };
  botao.addEventListener("click", () => abrir(painel.hidden));
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && !painel.hidden) abrir(false); });
  document.addEventListener("click", (ev) => { if (!painel.hidden && !painel.contains(ev.target) && !botao.contains(ev.target)) abrir(false); });
  window.addEventListener("hashchange", () => abrir(false));
  const procurar = async () => {
    const termo = campo.value.trim();
    ultima = termo;
    if (termo.length < 2) { lista.innerHTML = `<p class="suave pequeno">Digite pelo menos 2 letras do nick#tag.</p>`; return; }
    lista.innerHTML = `<p class="suave pequeno">Procurando…</p>`;
    try {
      const r = await rpc("buscar_jogadores", { p_termo: termo });
      if (termo !== ultima) return;
      lista.innerHTML = r.length ? `<ul>${r.map((j) => `<li><a href="${urlPerfil(j.riot_id)}"${corValida(j.cor) ? ` style="--cor-perfil:${j.cor}"` : ""}>
          ${imagem(imgCard(j.riot_card), "", "busca__avatar", j.apelido)}<span><strong>${esc(j.riot_id)}</strong><small>${esc(j.apelido)}${j.mesma_equipe ? " · da sua equipe" : ""}</small></span></a></li>`).join("")}</ul>`
        : `<p class="suave pequeno">Ninguém verificado com esse nick#tag.</p>`;
    } catch (e) { lista.innerHTML = `<p class="suave pequeno">Não foi possível procurar agora.</p>`; }
  };
  campo.addEventListener("input", () => { clearTimeout(espera); espera = setTimeout(procurar, 250); });
  campo.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); lista.querySelector("a")?.click(); }
  });
}
