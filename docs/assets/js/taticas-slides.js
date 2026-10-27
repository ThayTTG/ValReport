// Apresentações das Táticas: slides montados no site (título, texto e imagem) e PDF que vira slides.
// O PDF é convertido no navegador de quem envia (pdf.js, guardado no próprio site): cada página vira uma imagem
// WebP leve, então a apresentação abre rápido até no celular, sem baixar o PDF.

import { esc, icone } from "./util.js";
import { novoId, textoRico } from "./taticas.js";

const MAX_SLIDES = 40, MAX_PAGINAS = 60, MAX_PDF = 40 * 1024 * 1024;

export const novoBlocoSlides = (id) => ({ id, tipo: "slides", titulo: "", slides: [{ id: novoId(), titulo: "", texto: "", imagem: null }] });
export const novoBlocoPdf = (id) => ({ id, tipo: "pdf", titulo: "", nome: "", paginas: [] });

function htmlSlide(sl, i, total, E) {
  const url = sl.imagem && E.urls[sl.imagem];
  return `<li class="tat-eslide" data-slide-id="${esc(sl.id)}">
      <div class="tat-eslide__topo"><strong>Slide ${i + 1}</strong>
        <span class="tat-ebloco__acoes">
          <button class="botao-icone botao-mini" type="button" data-slides-acao="subir" aria-label="Subir o slide ${i + 1}"${i === 0 ? " disabled" : ""}>${icone("seta-cima")}</button>
          <button class="botao-icone botao-mini" type="button" data-slides-acao="descer" aria-label="Descer o slide ${i + 1}"${i === total - 1 ? " disabled" : ""}>${icone("seta-baixo")}</button>
          <button class="botao-perigo botao-mini" type="button" data-slides-acao="apagar"${total < 2 ? " disabled" : ""}>Apagar</button>
        </span></div>
      <div class="tat-eslide__corpo">
        <div class="tat-eslide__campos">
          <label class="campo"><span>Título</span><input data-slide-campo="titulo" value="${esc(sl.titulo || "")}" maxlength="120" placeholder="Ex.: Quando o A está pesado"></label>
          <label class="campo"><span>Texto <small class="suave">(listas com "- ", **negrito**)</small></span><textarea data-slide-campo="texto" rows="4" maxlength="2000">${esc(sl.texto || "")}</textarea></label>
        </div>
        <div class="tat-eslide__imagem">
          ${url ? `<img src="${esc(url)}" alt="Imagem do slide ${i + 1}" referrerpolicy="no-referrer">` : `<span class="suave pequeno">${icone("imagem")} Sem imagem</span>`}
          <label class="botao-secundario botao-mini botao-arquivo">${icone("enviar")} ${url ? "Trocar" : "Imagem"}<input type="file" accept="image/png,image/jpeg,image/webp" data-slide-imagem></label>
          ${sl.imagem ? `<button class="botao-secundario botao-mini" type="button" data-slides-acao="tirar-imagem">Tirar</button>` : ""}
        </div>
      </div>
    </li>`;
}

export function htmlSlidesEditor(b, E) {
  if (b.tipo === "pdf") {
    const n = (b.paginas || []).length;
    const miniaturas = (b.paginas || []).slice(0, 8).map((p, i) => (E.urls[p] ? `<img src="${esc(E.urls[p])}" alt="Página ${i + 1}" referrerpolicy="no-referrer">` : "")).join("");
    return `<div class="tat-eslides" data-slides-editor="${esc(b.id)}">
        <label class="campo"><span>Título <small class="suave">(opcional)</small></span><input data-slides-campo="titulo" value="${esc(b.titulo || "")}" maxlength="120" placeholder="Ex.: Aula de retake"></label>
        ${n ? `<div class="tat-epdf__paginas">${miniaturas}${n > 8 ? `<span class="tat-epdf__mais">+${n - 8}</span>` : ""}</div>
          <p class="suave pequeno">${icone("nota")} ${esc(b.nome || "PDF")} · ${n} página${n === 1 ? "" : "s"}. A equipe vê como slides, página por página.</p>` : ""}
        <div class="tat-epdf__envio">
          <label class="botao-${n ? "secundario" : "primario"} botao-mini botao-arquivo">${icone("enviar")} ${n ? "Trocar o PDF" : "Escolher o PDF"}<input type="file" accept="application/pdf" data-pdf></label>
          <span class="suave pequeno" data-pdf-status>Exportado do PowerPoint, Canva ou Google Slides. Até ${MAX_PAGINAS} páginas e 40 MB.</span>
        </div>
        <progress max="1" value="0" hidden data-pdf-progresso></progress>
      </div>`;
  }
  const slides = b.slides || [];
  return `<div class="tat-eslides" data-slides-editor="${esc(b.id)}">
      <label class="campo"><span>Título da apresentação <small class="suave">(opcional)</small></span><input data-slides-campo="titulo" value="${esc(b.titulo || "")}" maxlength="120" placeholder="Ex.: Leitura do round"></label>
      <ol class="tat-eslides__lista">${slides.map((sl, i) => htmlSlide(sl, i, slides.length, E)).join("")}</ol>
      <button class="botao-secundario botao-mini" type="button" data-slides-acao="novo"${slides.length >= MAX_SLIDES ? " disabled" : ""}>${icone("mais")} Slide</button>
      <details class="tat-dicas"><summary>Prévia do slide 1</summary><div class="tat-slide tat-slide--previa"><div class="tat-slide__texto">
        ${slides[0]?.titulo ? `<strong class="tat-slide__titulo">${esc(slides[0].titulo)}</strong>` : ""}<div class="tat-slide__corpo">${textoRico(slides[0]?.texto || "")}</div></div></div></details>
    </div>`;
}

// ---------- PDF → imagens ----------
let pdfjs = null;
async function carregarPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("../vendor/pdfjs/pdf.js");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.js", import.meta.url).href;
  }
  return pdfjs;
}
async function converterPdf(arq, aoProgresso) {
  const lib = await carregarPdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await arq.arrayBuffer()), isEvalSupported: false, disableAutoFetch: true, enableXfa: false }).promise;
  if (doc.numPages > MAX_PAGINAS) throw new Error(`O PDF tem ${doc.numPages} páginas. O limite é ${MAX_PAGINAS}: divida em mais de um.`);
  const paginas = [];
  for (let i = 1; i <= doc.numPages; i++) {
    aoProgresso(i, doc.numPages);
    const pagina = await doc.getPage(i);
    const base = pagina.getViewport({ scale: 1 });
    const escala = Math.min(1600 / base.width, 1600 / base.height, 4);
    const vp = pagina.getViewport({ scale: escala });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pagina.render({ canvasContext: ctx, viewport: vp }).promise;
    paginas.push(canvas);
    pagina.cleanup();
  }
  await doc.destroy();
  return paginas;
}

export function ligarSlidesEditor(blocoEl, b, E) {
  const caixa = blocoEl.querySelector(".tat-eslides");
  if (!caixa) return;
  // O editor pode ter sido redesenhado no meio de um envio: sempre procura o bloco que está na tela agora
  const atual = () => document.getElementById(`bloco-${b.id}`)?.querySelector(".tat-eslides") || caixa;
  const redesenhar = () => {
    const el = document.getElementById(`bloco-${b.id}`), agora = el?.querySelector(".tat-eslides");
    if (!agora) return;
    agora.outerHTML = htmlSlidesEditor(b, E);
    ligarSlidesEditor(el, b, E);
  };
  const slideDe = (el) => (b.slides || []).find((s) => s.id === el.closest("[data-slide-id]")?.dataset.slideId);

  caixa.addEventListener("input", (ev) => {
    const el = ev.target;
    if (el.matches("[data-slides-campo=titulo]")) { b.titulo = el.value.slice(0, 120); E.api.mudou(); return; }
    const sl = el.matches("[data-slide-campo]") ? slideDe(el) : null;
    if (!sl) return;
    sl[el.dataset.slideCampo] = el.value.slice(0, el.dataset.slideCampo === "titulo" ? 120 : 2000);
    E.api.mudou();
  });
  caixa.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-slides-acao]");
    if (!btn) return;
    const a = btn.dataset.slidesAcao, lista = b.slides || (b.slides = []);
    if (a === "novo") {
      if (lista.length >= MAX_SLIDES) return;
      lista.push({ id: novoId(), titulo: "", texto: "", imagem: null });
      E.api.mudou();
      redesenhar();
      blocoEl.querySelector(".tat-eslide:last-child [data-slide-campo=titulo]")?.focus();
      return;
    }
    const sl = slideDe(btn), i = lista.indexOf(sl);
    if (!sl) return;
    if (a === "apagar") { if (lista.length < 2 || !confirm(`Apagar o slide ${i + 1}?`)) return; lista.splice(i, 1); }
    else if (a === "subir" && i > 0) [lista[i - 1], lista[i]] = [lista[i], lista[i - 1]];
    else if (a === "descer" && i < lista.length - 1) [lista[i + 1], lista[i]] = [lista[i], lista[i + 1]];
    else if (a === "tirar-imagem") sl.imagem = null;
    else return;
    E.api.mudou();
    redesenhar();
  });
  caixa.addEventListener("change", async (ev) => {
    const el = ev.target;
    if (el.matches("[data-slide-imagem]")) {
      const sl = slideDe(el), arq = el.files?.[0];
      if (!sl || !arq) return;
      el.disabled = true;
      try {
        E.api.status("Preparando a imagem…");
        const blob = await E.api.prepararImagem(arq, { max: 1600 });
        E.api.status("Enviando a imagem…");
        sl.imagem = await E.api.enviarParaTatica(blob, blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg");
        E.api.mudou();
        redesenhar();
      } catch (e) { el.disabled = false; el.value = ""; E.api.aviso(e.message); E.api.status("Envio não concluído.", "erro"); }
      return;
    }
    if (el.matches("[data-pdf]")) {
      const arq = el.files?.[0];
      if (!arq) return;
      const st = { set textContent(t) { const x = atual().querySelector("[data-pdf-status]"); if (x) x.textContent = t; } };
      const barra = { set value(v) { const x = atual().querySelector("[data-pdf-progresso]"); if (x) { x.hidden = false; x.value = v; } } };
      el.disabled = true;
      try {
        if (arq.type !== "application/pdf" && !/\.pdf$/i.test(arq.name)) throw new Error("Escolha um arquivo PDF.");
        if (arq.size > MAX_PDF) throw new Error("O PDF passou de 40 MB. Exporte com imagens menores ou divida em partes.");
        st.textContent = "Abrindo o PDF…";
        barra.value = 0;
        const telas = await converterPdf(arq, (i, n) => { st.textContent = `Convertendo a página ${i} de ${n}…`; barra.value = (i - 1) / n / 2; });
        const caminhos = [];
        for (let i = 0; i < telas.length; i++) {
          st.textContent = `Enviando a página ${i + 1} de ${telas.length}…`;
          barra.value = 0.5 + (i / telas.length) / 2;
          const blob = await E.api.regravar(telas[i], telas[i].width, telas[i].height, { max: 1600 });
          caminhos.push(await E.api.enviarParaTatica(blob, blob.type === "image/webp" ? "webp" : "jpg"));
        }
        b.paginas = caminhos;
        b.nome = arq.name.slice(0, 160);
        if (!b.titulo) b.titulo = arq.name.replace(/\.pdf$/i, "").slice(0, 120);
        E.api.mudou();
        redesenhar();
      } catch (e) {
        el.disabled = false;
        el.value = "";
        const caixaAgora = atual(), x = caixaAgora.querySelector("[data-pdf-status]"), pr = caixaAgora.querySelector("[data-pdf-progresso]");
        if (pr) pr.hidden = true;
        if (x) {
          x.textContent = e?.name === "PasswordException" || /password/i.test(e?.message || "") ? "Esse PDF tem senha. Exporte sem senha e tente de novo."
            : e?.name === "InvalidPDFException" ? "Esse arquivo não parece um PDF válido." : `Não deu para usar esse PDF: ${e?.message || e}`;
          x.classList.add("ruim");
        }
        E.api.status("Envio do PDF não concluído.", "erro");
      }
    }
  });
}
