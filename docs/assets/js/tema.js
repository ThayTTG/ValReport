// Aplica o tema salvo (claro/escuro) antes de desenhar a página, para não piscar.
// Fica num arquivo próprio para a política de segurança (CSP) não precisar liberar scripts escritos dentro do HTML.
try {
  var t = localStorage.getItem("valreport.tema");
  if (t === "claro" || t === "escuro") document.documentElement.dataset.tema = t;
} catch (e) { /* sem armazenamento */ }
