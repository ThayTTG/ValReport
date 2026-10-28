// Guarda os erros desta sessão do navegador (JavaScript, promessas e bloqueios da CSP) para a página Diagnóstico.
// É o primeiro módulo carregado pelo app.js, para pegar também os erros do começo. Fica só neste navegador.

const CHAVE = "valreport.erros";
const MAXIMO = 30;
let erros = [];
try { erros = JSON.parse(sessionStorage.getItem(CHAVE) || "[]"); } catch (e) { erros = []; }

const limparTexto = (t) => String(t || "").replace(/(access_token|refresh_token|apikey|token|code)=[^&\s"']+/gi, "$1=…").slice(0, 300);

function anotar(tipo, mensagem, onde = "") {
  erros.push({ t: new Date().toISOString(), tipo, msg: limparTexto(mensagem), onde: limparTexto(onde), rota: location.hash.slice(0, 80) });
  erros = erros.slice(-MAXIMO);
  try { sessionStorage.setItem(CHAVE, JSON.stringify(erros)); } catch (e) { /* armazenamento bloqueado: fica só na memória */ }
}

addEventListener("error", (ev) => {
  if (ev.target && ev.target !== window && ev.target.tagName) return;   // imagem quebrada não é erro do site
  anotar("JavaScript", ev.message, ev.filename ? `${ev.filename.replace(location.origin, "")}:${ev.lineno}` : "");
}, true);
addEventListener("unhandledrejection", (ev) => anotar("Promessa", ev.reason?.message || ev.reason));
document.addEventListener("securitypolicyviolation", (ev) => anotar("CSP", `bloqueado: ${ev.violatedDirective}`, ev.blockedURI));

export const errosDaSessao = () => [...erros];
export function limparErros() {
  erros = [];
  try { sessionStorage.removeItem(CHAVE); } catch (e) { /* nada */ }
}
