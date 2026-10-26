// Telas de conta: boas-vindas (sem login), cadastro (16+), sem equipe, minha conta e o painel da administradora

import { esc, icone, dataHora } from "./util.js";
import { B } from "./dados.js";
import { entrar, sair, usuario, rpc, inserir, atualizar, funcao, ErroNuvem } from "./nuvem.js";
import { EQUIPE_PADRAO, VERSAO_TERMOS } from "./config.js";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const CARGOS = [["lider", "Líder"], ["colider", "Co-líder"], ["treinador", "Treinador"], ["jogador", "Jogador"], ["convidado", "Convidado"]];
export const nomeCargo = (c) => CARGOS.find(([k]) => k === c)?.[1] || c;

/** Idade em anos assumindo o último dia do mês (igual ao banco: nunca deixa passar quem ainda não fez 16) */
export function idadeAprox(ano, mes) {
  const fim = new Date(ano, mes, 0);           // último dia do mês de nascimento
  const hoje = new Date();
  let idade = hoje.getFullYear() - fim.getFullYear();
  if (hoje.getMonth() < fim.getMonth() || (hoje.getMonth() === fim.getMonth() && hoje.getDate() < fim.getDate())) idade--;
  return idade;
}

function mensagemErro(e) {
  const m = String(e?.message || e);
  if (m.includes("idade_minima")) return "O ValReport é para quem tem 16 anos ou mais. Se você ainda não tem, poderá criar a conta quando completar 16.";
  if (m.includes("responsavel")) return "Para 16 e 17 anos, informe um e-mail válido de um responsável.";
  if (e instanceof ErroNuvem && e.status === 401) return "Sua sessão terminou. Entre de novo.";
  return m;
}

const botaoGoogle = (texto, classe = "botao-primario") => `<button class="${classe} botao-google" type="button" data-entrar>
  <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.9-5.4 3.9-3.3 0-5.9-2.7-5.9-6s2.6-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.1-1.1-.2-1.6H12z"/></svg>${texto}</button>`;

function ligarEntrar(el) {
  el.querySelectorAll("[data-entrar]").forEach((b) => b.addEventListener("click", () => { b.disabled = true; entrar(); }));
}
function ligarSair(el) {
  el.querySelectorAll("[data-sair]").forEach((b) => b.addEventListener("click", async () => { await sair(); location.hash = "#/"; location.reload(); }));
}

// ---------- Visitante sem login ----------
export function viewBoasVindas(erro) {
  const recurso = (ic, t, d) => `<div class="lp-recurso">${icone(ic)}<strong>${t}</strong><p>${d}</p></div>`;
  return {
    titulo: "Bem-vindo",
    html: `<section class="lp-hero">
        <span class="lp-selo">${icone("estrela")} Estatísticas e leitura tática para equipes de VALORANT</span>
        <h1>Entenda cada round da sua equipe.</h1>
        <p>O ValReport junta as partidas do time, mostra quem decidiu cada round, guarda as notas da IGL e coroa o MVP da semana. Tudo privado, só para quem é da equipe.</p>
        ${erro ? `<p class="aviso aviso--erro" role="alert">${icone("info")}<span>${esc(erro)}</span></p>` : ""}
        <div class="lp-acoes">${botaoGoogle("Entrar com Google")}${botaoGoogle("Cadastrar-se", "botao-secundario")}</div>
        <p class="pequeno suave">O cadastro também começa pela sua conta Google. É preciso ter 16 anos ou mais.</p>
      </section>
      <section class="secao lp-recursos">
        ${recurso("alvo", "Cada round explicado", "Impacto por round, trades, posicionamento e mapa de calor, com a leitura do que aconteceu.")}
        ${recurso("equipe", "Só para a sua equipe", "As partidas ficam visíveis apenas para os membros. Convidados veem as partidas, sem as estratégias.")}
        ${recurso("nota", "Notas da IGL", "Planos de mapa e anotações em cada round, no mesmo lugar das estatísticas.")}
        ${recurso("coroa", "Coroa do MVP", "Toda semana fecha no domingo às 21h, e o MVP leva a coroa até alguém tomar.")}
      </section>
      <section class="secao lp-passos">
        <h2>Como funciona</h2>
        <ol><li><strong>Entre com Google.</strong> Nenhuma senha nova para guardar.</li>
          <li><strong>Complete o perfil.</strong> Apelido e mês e ano de nascimento.</li>
          <li><strong>Receba o convite da sua equipe.</strong> A líder ou o líder libera o seu acesso.</li></ol>
      </section>`,
    depois: ligarEntrar,
  };
}

// ---------- Cadastro (primeiro acesso) ----------
export function viewCadastro() {
  const u = usuario() || {};
  const nome = (u.user_metadata?.full_name || u.user_metadata?.name || "").split(" ")[0] || "";
  const anoAtual = new Date().getFullYear();
  const anos = Array.from({ length: 70 }, (_, i) => anoAtual - 10 - i);
  return {
    titulo: "Complete seu cadastro",
    html: `<section class="cadastro cartao">
      <h1>Falta pouco${nome ? `, ${esc(nome)}` : ""}!</h1>
      <p class="suave">Conta Google: <strong>${esc(u.email || "")}</strong></p>
      <form id="form-cadastro" novalidate>
        <label class="campo"><span>Apelido</span>
          <input name="apelido" required minlength="2" maxlength="24" autocomplete="nickname" placeholder="Como a equipe te chama (ex.: seu nick)">
          <small>De 2 a 24 caracteres. Dá para mudar depois.</small></label>
        <fieldset class="campo campo--linha"><legend>Mês e ano de nascimento</legend>
          <select name="mes" required aria-label="Mês"><option value="">Mês</option>${MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select>
          <select name="ano" required aria-label="Ano"><option value="">Ano</option>${anos.map((a) => `<option>${a}</option>`).join("")}</select>
          <small>Guardamos só o mês e o ano, para conferir a idade mínima (16 anos) e ligar o modo protegido de 16 e 17 anos.</small></fieldset>
        <div class="campo campo--responsavel" hidden>
          <div class="aviso">${icone("escudo")}<span><strong>Modo protegido.</strong> Para 16 e 17 anos, o perfil fica fora da busca de quem não é da sua equipe, e só a equipe comenta nele. Informe o e-mail de um responsável: ele poderá pedir a exclusão da conta a qualquer momento.</span></div>
          <label><span>E-mail do responsável</span><input name="responsavel" type="email" autocomplete="off" placeholder="responsavel@email.com"></label></div>
        <p class="aviso aviso--erro campo--menor" hidden role="alert">${icone("info")}<span>O ValReport é para quem tem 16 anos ou mais. Você poderá criar a conta quando completar 16.</span></p>
        <label class="campo--check"><input type="checkbox" name="aceite" required>
          <span>Li e aceito os <a href="termos.html" target="_blank" rel="noopener">Termos de Uso</a> e a <a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a>.</span></label>
        <p class="aviso aviso--erro form-erro" hidden role="alert"></p>
        <div class="lp-acoes"><button class="botao-primario" type="submit">Concluir cadastro</button>
          <button class="botao-secundario" type="button" data-sair>Sair</button></div>
      </form></section>`,
    depois: (el) => {
      ligarSair(el);
      const f = el.querySelector("#form-cadastro");
      const resp = f.querySelector(".campo--responsavel"), menor = f.querySelector(".campo--menor"), erro = f.querySelector(".form-erro");
      const enviar = f.querySelector("[type=submit]");
      const conferir = () => {
        const ano = Number(f.ano.value), mes = Number(f.mes.value);
        const idade = ano && mes ? idadeAprox(ano, mes) : null;
        resp.hidden = !(idade != null && idade >= 16 && idade < 18);
        menor.hidden = !(idade != null && idade < 16);
        enviar.disabled = idade != null && idade < 16;
        return idade;
      };
      f.mes.addEventListener("change", conferir);
      f.ano.addEventListener("change", conferir);
      f.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        erro.hidden = true;
        const idade = conferir();
        const falta = !f.apelido.value.trim() || f.apelido.value.trim().length < 2 ? "Escolha um apelido (2 a 24 caracteres)."
          : idade == null ? "Informe o mês e o ano de nascimento."
            : idade < 18 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.responsavel.value.trim()) ? "Informe o e-mail de um responsável."
              : !f.aceite.checked ? "Para continuar, aceite os Termos de Uso e a Política de Privacidade." : null;
        if (falta) { erro.textContent = falta; erro.hidden = false; return; }
        enviar.disabled = true;
        enviar.textContent = "Salvando…";
        try {
          await inserir("perfis", { id: usuario()?.id, apelido: f.apelido.value.trim(), nascimento_ano: Number(f.ano.value),
            nascimento_mes: Number(f.mes.value), responsavel_email: idade < 18 ? f.responsavel.value.trim() : null, versao_termos: VERSAO_TERMOS });
          location.hash = "#/";
          location.reload();
        } catch (e) {
          erro.textContent = mensagemErro(e);
          erro.hidden = false;
          enviar.disabled = false;
          enviar.textContent = "Concluir cadastro";
        }
      });
    },
  };
}

// ---------- Logado, sem equipe ----------
export function viewSemEquipe() {
  const c = B.conta;
  return {
    titulo: "Sua conta",
    html: `<section class="lp-hero lp-hero--menor">
        <span class="lp-selo">${icone("equipe")} Quase lá</span>
        <h1>Olá, ${esc(c.perfil.apelido)}!</h1>
        <p>Você ainda não está em uma equipe. Quando a líder ou o líder liberar o seu acesso, as partidas aparecem aqui.</p>
        <div class="lp-acoes"><a class="botao-primario" href="#/perfil">${icone("verificado")} ${c.perfil.riot_verificado_em ? "Meu perfil" : "Monte seu perfil e verifique seu Riot ID"}</a>
          <a class="botao-secundario" href="#/conta">Minha conta</a>
          ${c.admin ? `<a class="botao-secundario" href="#/painel">${icone("escudo")} Painel da administradora</a>` : ""}</div>
      </section>`,
  };
}

// ---------- Minha conta ----------
export function viewConta() {
  const c = B.conta, u = usuario() || {};
  const p = c.perfil;
  return {
    titulo: "Minha conta",
    html: `<section class="secao conta">
      <h1>Minha conta</h1>
      <div class="grade-2 secao">
        <section class="cartao"><div class="cartao__titulo"><h3>Perfil</h3></div>
          <form id="form-apelido" class="pilha-form">
            <label class="campo"><span>Apelido</span><input name="apelido" value="${esc(p.apelido)}" minlength="2" maxlength="24" required></label>
            <p class="pequeno suave">Conta Google: ${esc(u.email || "")} · ${c.protegido ? `<span class="selo selo--alerta">${icone("escudo")} Modo protegido (16–17)</span>` : "18 anos ou mais"}</p>
            <p class="pequeno suave">Cadastro em ${esc(dataHora(p.criado_em))} · Termos aceitos: versão ${esc(p.versao_termos)}</p>
            <p class="form-ok pequeno" hidden role="status"></p>
            <div class="lp-acoes"><button class="botao-primario" type="submit">Salvar apelido</button>
              <a class="botao-secundario" href="#/perfil">Editar perfil completo</a></div>
          </form></section>
        <section class="cartao"><div class="cartao__titulo"><h3>Equipes</h3></div>
          ${c.equipes.length ? `<ul class="lista-limpa">${c.equipes.map((e) => `<li><strong>${esc(e.nome)}</strong> <span class="selo">${esc(nomeCargo(e.cargo))}</span>${e.riot_id ? ` <span class="suave pequeno">${esc(e.riot_id)}</span>` : ""}</li>`).join("")}</ul>`
            : `<p class="suave pequeno">Nenhuma equipe ainda.</p>`}
          ${c.admin ? `<p style="margin-top:12px"><a class="botao-secundario" href="#/painel">${icone("escudo")} Painel da administradora</a></p>` : ""}</section>
      </div>
      <section class="cartao secao"><div class="cartao__titulo"><h3>Privacidade</h3></div>
        <p class="pequeno">Leia a <a href="privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a> e os <a href="termos.html" target="_blank" rel="noopener">Termos de Uso</a>.</p>
        <div class="lp-acoes"><button class="botao-secundario" type="button" data-sair>Sair</button>
          <button class="botao-perigo" type="button" data-apagar>Apagar minha conta e meus dados</button></div>
        <div class="apagar-confirma" hidden>
          <p class="aviso aviso--erro">${icone("info")}<span>Isso apaga o seu login, o seu perfil e o seu vínculo com as equipes. Não dá para desfazer. Para confirmar, digite <strong>APAGAR</strong>.</span></p>
          <div class="lp-acoes"><input name="confirma" autocomplete="off" aria-label="Digite APAGAR para confirmar">
            <button class="botao-perigo" type="button" data-apagar-ok disabled>Apagar definitivamente</button></div></div>
      </section></section>`,
    depois: (el) => {
      ligarSair(el);
      const f = el.querySelector("#form-apelido"), ok = f.querySelector(".form-ok");
      f.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        ok.hidden = false;
        try {
          await atualizar("perfis", `id=eq.${encodeURIComponent(usuario().id)}`, { apelido: f.apelido.value.trim() });
          B.conta.perfil.apelido = f.apelido.value.trim();
          ok.textContent = "Apelido salvo ✓";
        } catch (e) { ok.textContent = mensagemErro(e); }
      });
      const caixa = el.querySelector(".apagar-confirma"), campo = caixa.querySelector("input"), botao = caixa.querySelector("[data-apagar-ok]");
      el.querySelector("[data-apagar]").addEventListener("click", () => { caixa.hidden = false; campo.focus(); });
      campo.addEventListener("input", () => { botao.disabled = campo.value.trim().toUpperCase() !== "APAGAR"; });
      botao.addEventListener("click", async () => {
        botao.disabled = true;
        try {
          const r = await rpc("apagar_minha_conta");
          await sair();
          alert(r === "apagada" ? "Sua conta e seus dados foram apagados." : "Pedido de exclusão registrado. A administradora conclui em até 7 dias.");
          location.hash = "#/";
          location.reload();
        } catch (e) { botao.disabled = false; caixa.querySelector("span").textContent = mensagemErro(e); }
      });
    },
  };
}

// ---------- Painel da administradora ----------
export async function viewPainel() {
  if (!B.conta?.admin) return { titulo: "Painel", html: `<div class="vazio"><strong>Somente a administradora acessa o painel.</strong></div>` };
  let lista = [];
  try { lista = await rpc("admin_listar_usuarios"); } catch (e) {
    return { titulo: "Painel", html: `<div class="vazio"><strong>Não foi possível abrir o painel</strong><p>${esc(mensagemErro(e))}</p></div>` };
  }
  const linha = (u) => {
    const naEquipe = u.equipes.find((e) => e.slug === EQUIPE_PADRAO);
    const opcoes = CARGOS.map(([k, t]) => `<option value="${k}"${(naEquipe?.cargo || "jogador") === k ? " selected" : ""}>${t}</option>`).join("");
    const pode = u.idade_faixa !== "sem cadastro";
    return `<tr data-usuario="${esc(u.id)}">
      <td><strong>${esc(u.apelido || "—")}</strong><small class="suave" style="display:block">${esc(u.email || "")}</small>
        ${u.exclusao_solicitada_em ? `<span class="selo selo--derrota">pediu exclusão</span>` : ""}</td>
      <td>${u.idade_faixa === "16-17" ? `<span class="selo selo--alerta">16–17</span>` : u.idade_faixa === "18+" ? "18+" : `<span class="suave">sem cadastro</span>`}</td>
      <td>${naEquipe ? `<span class="selo selo--vitoria">${esc(nomeCargo(naEquipe.cargo))}</span>` : `<span class="suave">fora</span>`}</td>
      <td><select data-campo="cargo" aria-label="Cargo"${pode ? "" : " disabled"}>${opcoes}</select></td>
      <td><input data-campo="riot" value="${esc(naEquipe?.riot_id || "")}" placeholder="Nick#TAG" aria-label="Riot ID"${pode ? "" : " disabled"}></td>
      <td class="painel-acoes"><button class="botao-primario botao-mini" type="button" data-acao="salvar"${pode ? "" : " disabled"}>${naEquipe ? "Atualizar" : "Adicionar"}</button>
        ${naEquipe ? `<button class="botao-perigo botao-mini" type="button" data-acao="remover">Remover</button>` : ""}
        ${pode ? `<button class="botao-secundario botao-mini" type="button" data-acao="verificar" title="Confirma o Riot ID desta pessoa sem o desafio do card">Verificar Riot ID</button>` : ""}</td></tr>`;
  };
  return {
    titulo: "Painel",
    html: `<section class="secao">
      <h1>Painel da administradora</h1>
      <p class="suave">Quem já entrou com Google aparece aqui. Adicione as pessoas à <strong>Juventus Academy</strong> com o cargo certo e o Riot ID confirmado. Convidados veem as partidas, mas não as notas da IGL.</p>
      <p class="aviso aviso--erro painel-erro" hidden role="alert"></p>
      <div class="cartao rolagem secao"><table class="tabela painel"><thead><tr><th>Pessoa</th><th>Idade</th><th>Juventus</th><th>Cargo</th><th>Riot ID</th><th></th></tr></thead>
        <tbody>${lista.map(linha).join("")}</tbody></table></div>
      <p class="pequeno suave">Novas pessoas aparecem depois que entram no site pela primeira vez. Recarregue a página para ver a lista atualizada.</p></section>`,
    depois: (el) => {
      const erro = el.querySelector(".painel-erro");
      el.querySelector("tbody").addEventListener("click", async (ev) => {
        const b = ev.target.closest("[data-acao]");
        if (!b) return;
        const tr = b.closest("tr");
        erro.hidden = true;
        b.disabled = true;
        try {
          if (b.dataset.acao === "verificar") {
            const riot = tr.querySelector("[data-campo=riot]").value.trim();
            if (!riot) throw new Error("Escreva o Riot ID (Nome#TAG) na linha da pessoa antes de verificar.");
            if (!confirm(`Confirmar ${riot} como o Riot ID desta pessoa?`)) { b.disabled = false; return; }
            const r = await funcao("riot", { acao: "admin_verificar", usuario_id: tr.dataset.usuario, riot_id: riot });
            erro.textContent = `${r.riot_id} verificado ✓`;
            erro.className = "aviso painel-erro";
            erro.hidden = false;
            b.disabled = false;
            return;
          }
          if (b.dataset.acao === "salvar") {
            await rpc("admin_definir_membro", { p_usuario: tr.dataset.usuario, p_equipe: EQUIPE_PADRAO,
              p_cargo: tr.querySelector("[data-campo=cargo]").value, p_riot_id: tr.querySelector("[data-campo=riot]").value.trim() || null });
          } else if (confirm("Remover esta pessoa da Juventus Academy?")) {
            await rpc("admin_remover_membro", { p_usuario: tr.dataset.usuario, p_equipe: EQUIPE_PADRAO });
          }
          window.dispatchEvent(new CustomEvent("valreport:recarregar"));
        } catch (e) { erro.textContent = mensagemErro(e); erro.hidden = false; b.disabled = false; }
      });
    },
  };
}
