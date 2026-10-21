"use strict";
const form = document.querySelector("#application-form");
const result = document.querySelector("#preview-result");
const modalityLabels = { company: "Viatura da empresa", own: "Viatura própria" };

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const values = {
    "Nome": data.get("name"),
    "Telemóvel": data.get("phone"),
    "Email": data.get("email"),
    "Modalidade": modalityLabels[data.get("modality")] || "Não selecionada",
    "Certificado TVDE": data.get("certificate"),
    "Carta de condução": data.get("license"),
    "Experiência": data.get("experience"),
    "Disponibilidade": data.get("availability"),
    "Horário": data.get("schedule")
  };
  result.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = "Pré-visualização da candidatura";
  result.appendChild(title);
  const note = document.createElement("p");
  note.textContent = "Demonstração apenas: estes dados existem só nesta página e não foram enviados nem guardados.";
  result.appendChild(note);
  const dl = document.createElement("dl");
  for (const [label, value] of Object.entries(values)) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = String(value || "—");
    dl.append(dt, dd);
  }
  result.appendChild(dl);
  result.hidden = false;
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
});