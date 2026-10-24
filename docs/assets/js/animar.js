// Animações da interface (a "pimentinha"): entrada em sequência, números contando e troca de tema suave.
// Tudo respeita "reduzir movimento" do sistema: nesse caso nada se mexe.

const reduzir = matchMedia("(prefers-reduced-motion: reduce)");
export const semMovimento = () => reduzir.matches;

// Blocos que entram em sequência (só o mais externo de cada grupo recebe o atraso)
const BLOCOS = [".hoje-topo", ".hoje-nav", ".hoje-vazio", ".hoje-meio", ".atalhos", ".podio-armas", ".estilo", ".resumo-mapa", ".cabecalho", ".abas", ".filtros", ".semana-topo", ".destaque", ".membro-cartao", ".cartao", ".mapa-cartao",
  ".hall-topo", ".dia", ".partida", ".recorde", ".nota", ".aviso", ".vazio", ".forma", ".chips", ".secao__titulo", ".rolagem"].join(",");
const MAX_ESCALONADOS = 16;

/**
 * modo: "pagina" (mudou de página), "aba" (mesma página, outra aba), "suave" (filtro/parâmetro) ou "nada".
 * Chamado logo depois de trocar o conteúdo do <main>.
 */
export function animar(main, modo) {
  main.dataset.anim = semMovimento() ? "nada" : modo;
  particulas(main);
  if (semMovimento() || modo === "nada" || modo === "suave") return;
  // Na troca de aba, o cabeçalho e as abas ficam parados; só o conteúdo entra
  const raiz = modo === "aba" ? [...main.children].filter((el) => !el.matches(".cabecalho, .abas, .voltar")) : [main];
  let i = 0;
  for (const r of raiz) {
    const lista = r === main ? main.querySelectorAll(BLOCOS) : [r, ...r.querySelectorAll(BLOCOS)];
    for (const el of lista) {
      if (!el.matches(BLOCOS) || el.parentElement.closest(BLOCOS)) continue;
      el.classList.add("entra");
      el.style.setProperty("--i", Math.min(i++, MAX_ESCALONADOS));
    }
  }
  contarNumeros(main);
}

// ---------- Números contando ----------
const ALVOS = ".destaque__valor, .tile__valor, .indice__valor, .placar-grande .nosso, .placar-grande .deles, .recorde__valor, .membro-cartao__indice strong, .vs-elo__topo strong, .dono__qtd b, .hoje-placar strong, .lados__num strong";
const NUMERO = /^([^\d−-]*)([+−-]?)(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d+))?(.*)$/s;

function contarNumeros(raiz) {
  const els = [...raiz.querySelectorAll(ALVOS)].slice(0, 40);
  const itens = [];
  for (const el of els) {
    // só mexe no primeiro texto do elemento (o resto, como <small>, fica igual)
    const no = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!no) continue;
    const m = no.textContent.match(NUMERO);
    if (!m) continue;
    const [, antes, sinalTxt, inteiro, frac = "", depois] = m;
    if (/[\dA-Za-zÀ-ÿ]/.test(antes) || /\d/.test(depois)) continue;  // horas, frações, "1v3", "Platina 2"...
    const casas = frac.length;
    const valor = Number(`${inteiro.replace(/\./g, "")}.${frac || 0}`) * (sinalTxt === "-" || sinalTxt === "−" ? -1 : 1);
    if (!Number.isFinite(valor) || valor === 0) continue;
    itens.push({ no, antes, depois, casas, valor, mais: sinalTxt === "+", menos: sinalTxt === "−" ? "−" : "-", original: no.textContent });
  }
  if (!itens.length) return;
  const fmt = new Map();
  const formatar = (v, casas) => {
    if (!fmt.has(casas)) fmt.set(casas, new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));
    return fmt.get(casas).format(v);
  };
  const dur = 750, ini = performance.now();
  const passo = (agora) => {
    const t = Math.min(1, (agora - ini) / dur);
    const f = 1 - Math.pow(1 - t, 3);
    for (const x of itens) {
      if (!x.no.isConnected) continue;
      if (t >= 1) { x.no.textContent = x.original; continue; }
      const v = x.valor * f;
      const s = v < 0 ? x.menos : x.mais ? "+" : "";
      x.no.textContent = `${x.antes}${s}${formatar(Math.abs(v), x.casas)}${x.depois}`;
    }
    if (t < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

// ---------- Troca de tema com um círculo que se abre a partir do botão ----------
export async function trocarTema(botao, aplicar) {
  if (semMovimento() || !document.startViewTransition) {
    document.documentElement.classList.add("trocando-tema");
    await aplicar();
    setTimeout(() => document.documentElement.classList.remove("trocando-tema"), 400);
    return;
  }
  const r = botao.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const raio = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = document.startViewTransition(aplicar);
  await vt.ready;
  document.documentElement.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${raio}px at ${x}px ${y}px)`] },
    { duration: 520, easing: "cubic-bezier(.2,.7,.2,1)", pseudoElement: "::view-transition-new(root)" },
  );
}

// ---------- Brilho que segue o dedo/mouse nos cartões clicáveis ----------
export function ligarBrilho(raiz) {
  if (!matchMedia("(hover: hover)").matches) return;
  raiz.addEventListener("pointermove", (ev) => {
    const el = ev.target.closest(".recorde, .membro-cartao, .mvp, .dono, .atalho, .hoje-jog, .arma-top");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${ev.clientX - r.left}px`);
    el.style.setProperty("--my", `${ev.clientY - r.top}px`);
  });
}

// ---------- Partículas (faíscas subindo do Destaque do dia e do MVP) ----------
export function particulas(raiz) {
  if (semMovimento()) return;
  for (const alvo of raiz.querySelectorAll(".com-particulas")) {
    if (alvo.querySelector(":scope > .particulas")) continue;
    const n = alvo.classList.contains("revela__alvo") ? 34 : 22;
    const itens = Array.from({ length: n }, (_, i) => {
      const dur = 2.6 + Math.random() * 2.4;
      return `<i class="${i % 3 === 0 ? "p-ouro" : i % 3 === 1 ? "p-tema" : "p-claro"}" style="left:${(4 + Math.random() * 92).toFixed(1)}%;top:${(45 + Math.random() * 55).toFixed(1)}%;--t:${(3 + Math.random() * 4).toFixed(1)}px;--d:${dur.toFixed(2)}s;--a:-${(Math.random() * dur).toFixed(2)}s;--dx:${(Math.random() * 40 - 20).toFixed(0)}px;--sobe:${(90 + Math.random() * 90).toFixed(0)}px"></i>`;
    }).join("");
    alvo.insertAdjacentHTML("beforeend", `<span class="particulas" aria-hidden="true">${itens}</span>`);
  }
}
