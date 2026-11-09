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
    if (type === "Carta Verde") {
      const table = t.match(/\bvalid[oa]\b([\s\S]{0,450})/);
      if (table) {
        const cells = /\b(\d{1,2})[\s|/.-]+(\d{1,2})[\s|/.-]+((?:19|20)\d{2})[\s|/.-]+(\d{1,2})[\s|/.-]+(\d{1,2})[\s|/.-]+((?:19|20)\d{2})\b/g;
        for (const m of table[1].matchAll(cells)) {
          const start = validDate(m[1], m[2], m[3]);
          const end = validDate(m[4], m[5], m[6]);
          if (start && end && start <= end) dates.push(end);
        }
      }
    }
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
  async function readGreenCardCells(image, data, worker) {
    if (!/carta verde|international motor insurance|certificado internacional de seguro/.test(normalize(data.text))) return "";
    const words = data.words || [];
    const anchors = words.filter(word => /^val[i1l]?d[oa][.:]?$/i.test(normalize(word.text)));
    for (const anchor of anchors) {
      const height = Math.max(8, anchor.bbox.y1 - anchor.bbox.y0);
      const years = words.filter(word => /^(?:19|20)\d{2}[.,|]?$/.test(word.text) && word.bbox.y0 > anchor.bbox.y1 && word.bbox.y0 < anchor.bbox.y1 + height * 9);
      for (let i = 0; i < years.length; i++) for (let j = i + 1; j < years.length; j++) {
        const pair = [years[i], years[j]].sort((a, b) => a.bbox.x0 - b.bbox.x0);
        const [first, last] = pair;
        const firstX = (first.bbox.x0 + first.bbox.x1) / 2;
        const lastX = (last.bbox.x0 + last.bbox.x1) / 2;
        const cellWidth = (lastX - firstX) / 3;
        if (cellWidth < height * 2 || cellWidth > height * 10 || Math.abs(first.bbox.y0 - last.bbox.y0) > height) continue;
        if (firstX > anchor.bbox.x1 || lastX < anchor.bbox.x0) continue;
        const digitHeight = Math.max(first.bbox.y1 - first.bbox.y0, last.bbox.y1 - last.bbox.y0);
        const top = Math.max(0, Math.min(first.bbox.y0, last.bbox.y0) - digitHeight * 0.1);
        const bottom = Math.max(first.bbox.y1, last.bbox.y1) + digitHeight * 0.1;
        const source = await createImageBitmap(image);
        try {
          await worker.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: "7" });
          const originalCell = center => words.find(word => /^\d{1,4}$/.test(word.text) && Math.abs((word.bbox.x0 + word.bbox.x1) / 2 - center) < cellWidth * 0.3 && Math.abs(word.bbox.y0 - first.bbox.y0) < digitHeight * 0.5)?.text || "";
          const values = [originalCell(firstX - 2 * cellWidth), originalCell(firstX - cellWidth), String(parseInt(first.text))];
          if (!validDate(values[0], values[1], values[2])) continue;
          for (const center of [lastX - 2 * cellWidth, lastX - cellWidth, lastX]) {
            const left = Math.max(0, Math.round(center - cellWidth * 0.35));
            const width = Math.round(cellWidth * 0.7);
            const cropHeight = Math.ceil(bottom - top);
            const canvas = document.createElement("canvas");
            canvas.width = width * 4 + 24; canvas.height = cropHeight * 4 + 24;
            const context = canvas.getContext("2d");
            context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(source, left, Math.floor(top), width, cropHeight, 12, 12, width * 4, cropHeight * 4);
            let result;
            try { result = await worker.recognize(canvas); }
            finally { canvas.width = 0; canvas.height = 0; }
            const value = result.data.text.trim();
            if (!/^\d{1,4}$/.test(value) || result.data.confidence < 50) { values.length = 0; break; }
            values.push(value);
          }
          if (values.length === 6) {
            const start = validDate(values[0], values[1], values[2]);
            const end = validDate(values[3], values[4], values[5]);
            if (start && end && start <= end && +values[2] === parseInt(first.text) && +values[5] === parseInt(last.text)) {
              return `\nValidade até ${values[3]}/${values[4]}/${values[5]}`;
            }
          }
        } finally {
          source.close();
          await worker.setParameters({ tessedit_char_whitelist: "", tessedit_pageseg_mode: "3" });
        }
      }
    }
    return "";
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
      let cells = "";
      try { cells = await readGreenCardCells(image, result.data, worker); }
      catch (error) { console.warn("SmartDocs: quadro de validade requer confirmação manual.", error); }
      return (result.data.text || "") + cells;
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
