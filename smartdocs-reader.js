/* Local document reading: files are processed in this browser. */
(function (root) {
  const normalize = text => String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const scripts = new Map();
  function loadScript(url, ready) {
    if (ready()) return Promise.resolve();
    if (!scripts.has(url)) scripts.set(url, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => ready() ? resolve() : reject(new Error("Biblioteca indisponível."));
      script.onerror = () => { scripts.delete(url); reject(new Error("Não foi possível carregar o leitor.")); };
      document.head.appendChild(script);
    }));
    return scripts.get(url);
  }
  function validDate(day, month, year) {
    const date = new Date(Date.UTC(+year, +month - 1, +day));
    if (date.getUTCFullYear() !== +year || date.getUTCMonth() !== +month - 1 || date.getUTCDate() !== +day) return "";
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  function extract(text, scope) {
    const t = normalize(text);
    let type = "";
    if (scope === "vehicle") {
      if (/carta verde|certificado internacional de seguro|international motor insurance/.test(t)) type = "Carta Verde";
      else if (/condicoes particulares|apolice|seguro automovel/.test(t)) type = "Seguro";
      else if (/inspecao|proxima inspec|\bipo\b/.test(t)) type = "IPO";
      else if (/licenca.{0,30}tvde|tvde.{0,30}licenca/.test(t)) type = "Licença TVDE";
      else if (/certificado de matricula|documento unico automovel|\bdua\b/.test(t)) type = "DUA";
    } else if (scope === "driver") {
      if (/carta de conducao|driving licen/.test(t)) type = "Carta de Condução";
      else if (/cartao de cidadao|citizen card/.test(t)) type = "Cartão de Cidadão";
      else if (/contrato/.test(t)) type = "Contrato";
    } else {
      if (/certidao permanente/.test(t)) type = "Certidão Permanente";
      else if (/rnavt/.test(t)) type = "RNAVT";
      else if (/seguro|apolice/.test(t)) type = "Seguro da Empresa";
      else if (/licenca|alvara/.test(t)) type = "Licença / Alvará";
      else if (/fatura|factura|comprovativo/.test(t)) type = "Fatura / Comprovativo";
      else if (/contrato/.test(t)) type = "Contrato";
    }
    // Only dates next to an explicit expiry/end label qualify. Conflicts stay manual.
    const dates = [];
    const rangePattern = /(?:validade|vigencia)[^\d]{0,30}(\d{1,2})[\/.\-](\d{1,2})[\/.\-]((?:19|20)\d{2})\s*(?:a|ate|[-–])\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-]((?:19|20)\d{2})/g;
    const dateText = t.replace(rangePattern, (...m) => {
      const end = validDate(m[4], m[5], m[6]);
      if (end) dates.push(end);
      return " ";
    });
    const pattern = /(?:proxima inspecao(?: periodica)?|valid[ao] ate|validade(?: ate)?|data (?:de )?(?:validade|termo|fim)|fim (?:da vigencia|do periodo)|termo|valid until|expiry(?: date)?|expires)[^\d]{0,45}(\d{1,2})[\/.\-](\d{1,2})[\/.\-]((?:19|20)\d{2})/g;
    for (const match of dateText.matchAll(pattern)) {
      const date = validDate(match[1], match[2], match[3]);
      if (date) dates.push(date);
    }
    const unique = [...new Set(dates)];
    return { type, expiryDate: unique.length === 1 ? unique[0] : "", dateReview: unique.length > 1 ? "Foram encontradas validades diferentes. Confirme a data no documento." : unique.length ? "Confirme a validade proposta antes de guardar." : "Não foi encontrada uma validade inequívoca. Preencha-a após consultar o documento." };
  }
  async function read(file, scope, progress = () => {}) {
    let worker;
    let pdf;
    let task;
    const recognize = async image => {
      if (!worker) {
        progress("A preparar leitura da imagem…");
        await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js", () => root.Tesseract);
        worker = await root.Tesseract.createWorker("por+eng", 1, {
          workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
          corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1"
        });
      }
      const result = await worker.recognize(image);
      return result.data.text || "";
    };
    try {
      let text = "";
      let pagesRead = 1;
      let totalPages = 1;
      if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", () => root.pdfjsLib);
        root.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        task = root.pdfjsLib.getDocument({ data: await file.arrayBuffer() });
        pdf = await task.promise;
        totalPages = pdf.numPages;
        pagesRead = Math.min(totalPages, 10);
        for (let n = 1; n <= pagesRead; n++) {
          progress(`A ler página ${n} de ${totalPages}…`);
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          let pageText = content.items.map(item => item.str || "").join(" ");
          if (pageText.replace(/\s/g, "").length < 40) {
            const viewport = page.getViewport({ scale: 1 });
            const scale = Math.min(2, 2000 / Math.max(viewport.width, viewport.height));
            const view = page.getViewport({ scale });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
            try {
              await page.render({ canvasContext: canvas.getContext("2d"), viewport: view }).promise;
              pageText = await recognize(canvas);
            } finally { canvas.width = 0; canvas.height = 0; }
          }
          text += "\n" + pageText;
          page.cleanup();
        }
      } else if (/^image\//.test(file.type) || /\.(?:png|jpe?g)$/i.test(file.name)) {
        progress("A ler o conteúdo da fotografia…");
        text = await recognize(file);
      } else throw new Error("Use PDF, JPG ou PNG para leitura automática.");
      return { ...extract(text, scope), contentRead: Boolean(text.trim()), pagesRead, totalPages };
    } finally {
      if (worker) await worker.terminate();
      if (pdf) await pdf.destroy();
      else if (task) await task.destroy();
    }
  }
  root.FleetDocumentReader = { extract, read };
})(typeof window === "undefined" ? globalThis : window);
