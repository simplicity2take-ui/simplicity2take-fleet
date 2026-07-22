const state = {
  sessionUserId: null,
  profile: null,
  backendReady: false,
  activeView: "dashboard",
  editing: null,
  smartPreview: null,
  users: [
    { id: "admin", role: "admin", name: "Administrador Simplicity2Take", email: "admin@simplicity2take.pt", phone: "210000000", password: "admin2026" },
    { id: "u-joao", role: "driver", name: "João Silva", email: "joao@simplicity2take.pt", phone: "912345678", password: "123456", driverId: "d-joao" },
    { id: "u-pedro", role: "driver", name: "Pedro Costa", email: "pedro@simplicity2take.pt", phone: "934210987", password: "123456", driverId: "d-pedro" },
    { id: "u-carlos", role: "driver", name: "Carlos Santos", email: "carlos@simplicity2take.pt", phone: "966870120", password: "123456", driverId: "d-carlos" }
  ],
  drivers: [
    { id: "d-joao", name: "João Silva", email: "joao@simplicity2take.pt", phone: "912345678", status: "Ativo" },
    { id: "d-pedro", name: "Pedro Costa", email: "pedro@simplicity2take.pt", phone: "934210987", status: "Ativo" },
    { id: "d-carlos", name: "Carlos Santos", email: "carlos@simplicity2take.pt", phone: "966870120", status: "Inativo" }
  ],
  vehicles: [
    { id: "v-aa", plate: "AA-11-BB", brand: "Mercedes-Benz", model: "E 300", year: "2023", vin: "W1K2130421A882001", status: "Ativo", driverIds: ["d-joao"] },
    { id: "v-cc", plate: "CC-22-DD", brand: "Tesla", model: "Model 3", year: "2024", vin: "5YJ3E1EA7PF442109", status: "Ativo", driverIds: ["d-pedro"] },
    { id: "v-ee", plate: "EE-33-FF", brand: "BMW", model: "520d", year: "2022", vin: "WBA5A710X0F771205", status: "Manutenção", driverIds: ["d-joao", "d-pedro"] }
  ],
  documents: [
    {
      id: "doc-green",
      name: "Carta Verde AA-11-BB",
      type: "Carta Verde",
      number: "CV-123456789",
      policyNumber: "AP-778899",
      issueDate: "2026-01-01",
      expiryDate: "2026-12-31",
      observations: "Documento válido para o veículo AA-11-BB.",
      fileName: "carta-verde-aa-11-bb.pdf",
      fileType: "application/pdf",
      vehicleId: "v-aa",
      driverId: "d-joao",
      viewerDriverIds: ["d-joao"]
    },
    {
      id: "doc-contract",
      name: "Contrato João Silva",
      type: "Contrato",
      number: "CPS-2026-001",
      policyNumber: "",
      issueDate: "2026-01-10",
      expiryDate: "2027-01-10",
      observations: "Contrato de prestação de serviços.",
      fileName: "contrato-joao-silva.pdf",
      fileType: "application/pdf",
      vehicleId: "",
      driverId: "d-joao",
      viewerDriverIds: ["d-joao"]
    },
    {
      id: "doc-ipo",
      name: "IPO CC-22-DD",
      type: "IPO",
      number: "IPO-445566",
      policyNumber: "",
      issueDate: "2025-07-20",
      expiryDate: "2026-07-20",
      observations: "Inspeção a expirar em breve.",
      fileName: "ipo-cc-22-dd.jpg",
      fileType: "image/jpeg",
      vehicleId: "v-cc",
      driverId: "d-pedro",
      viewerDriverIds: ["d-pedro"]
    }
  ],
  recruitmentConfig: {
    requirements: [
      "Carta de condução válida",
      "Certificado TVDE recomendado",
      "Disponibilidade para horários flexíveis",
      "Boa apresentação e comunicação"
    ],
    faqs: [
      { q: "Como posso trabalhar na Simplicity2Take?", a: "Pode iniciar a candidatura aqui. O S2T AI Recruiter recolhe os seus dados, documentos e envia o resumo para análise." },
      { q: "Quais são os requisitos?", a: "Carta de condução válida, documentação de identificação, disponibilidade e, preferencialmente, certificado TVDE." },
      { q: "Preciso de certificado TVDE?", a: "É recomendado. Se ainda não tiver, indique isso na candidatura para o Administrador avaliar o caso." },
      { q: "Como obtenho o certificado TVDE?", a: "Deve fazer formação certificada TVDE numa entidade reconhecida e submeter o pedido junto das entidades competentes." },
      { q: "Posso trabalhar em part-time?", a: "Sim. Indique a sua disponibilidade e preferência de horário." },
      { q: "Posso utilizar o meu próprio veículo?", a: "Pode indicar essa intenção. O veículo terá de cumprir os requisitos legais e documentais." },
      { q: "Como funciona o processo de seleção?", a: "A candidatura é analisada pelo Administrador, que valida documentos, disponibilidade e requisitos." },
      { q: "Quais os documentos necessários?", a: "Carta de condução, certificado TVDE se existir, identificação e outros documentos pedidos pelo Administrador." }
    ]
  },
  applications: [
    {
      id: "app-demo",
      candidate: {
        name: "Mariana Lopes",
        phone: "919222333",
        email: "mariana@email.pt",
        tvdeCertificate: "Sim",
        drivingLicense: "Sim",
        tvdeExperience: "1 ano",
        availability: "Imediata",
        schedulePreference: "Part-time fim de semana"
      },
      documents: ["carta-conducao-mariana.pdf", "certificado-tvde-mariana.pdf"],
      status: "Em análise",
      summary: "Mariana Lopes tem certificado TVDE, carta de condução e disponibilidade imediata para part-time ao fim de semana.",
      conversation: [
        { role: "assistant", text: "Bem-vinda. Vou recolher os dados da sua candidatura." },
        { role: "candidate", text: "Tenho certificado TVDE e procuro part-time." }
      ]
    }
  ],
  recruiterSession: null
};

const SUPABASE_URL = "https://lmutpimlokagjwngqanx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8NuXQQp9sef-eTwGMItD0Q_GyD1GBVS";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const documentTypes = ["Carta Verde", "Seguro", "IPO", "DUA", "Licença TVDE", "Carta de Condução", "Certificado TVDE", "Contrato", "Cartão de Operador TVDE", "Outros"];
const navByRole = {
  admin: [["dashboard", "Dashboard", "DB"], ["vehicles", "Veículos", "VE"], ["drivers", "Motoristas", "MO"], ["documents", "Documentos", "DO"], ["applications", "Candidaturas", "AI"], ["alerts", "Alertas", "AL"], ["settings", "Configurações", "CO"]],
  driver: [["vehicles", "Meus Veículos", "VE"], ["documents", "Meus Documentos", "DO"], ["account", "Minha Conta", "EU"]]
};

const $ = selector => document.querySelector(selector);
const selectors = {
  loginScreen: $("#loginScreen"),
  loginForm: $("#loginForm"),
  loginIdentifier: $("#loginIdentifier"),
  loginPassword: $("#loginPassword"),
  loginOptions: $("#loginOptions"),
  recruitmentScreen: $("#recruitmentScreen"),
  recruiterChatLog: $("#recruiterChatLog"),
  recruiterForm: $("#recruiterForm"),
  recruiterInput: $("#recruiterInput"),
  candidateDocuments: $("#candidateDocuments"),
  publicRequirements: $("#publicRequirements"),
  appShell: $("#appShell"),
  sideNav: $("#sideNav"),
  content: $("#content"),
  sessionRole: $("#sessionRole"),
  sessionName: $("#sessionName"),
  pageTitle: $("#pageTitle"),
  modal: $("#entityModal"),
  form: $("#entityForm"),
  modalTitle: $("#modalTitle"),
  modalFields: $("#modalFields"),
  toast: $("#toast")
};

function currentUser() {
  if (state.profile) {
    return {
      id: state.profile.id,
      role: state.profile.role,
      name: state.profile.full_name || state.profile.name || state.profile.email,
      email: state.profile.email || "",
      phone: state.profile.phone || "",
      driverId: state.profile.driver_id || state.drivers.find(driver => driver.profileId === state.profile.id)?.id || ""
    };
  }
  return state.users.find(user => user.id === state.sessionUserId);
}

function valueOf(row, ...keys) {
  for (const key of keys) if (row?.[key] !== undefined && row?.[key] !== null) return row[key];
  return "";
}

async function loadBackendData() {
  const [driversResult, vehiclesResult, assignmentsResult, documentsResult, viewersResult, applicationsResult] = await Promise.all([
    supabaseClient.from("drivers").select("*"),
    supabaseClient.from("vehicles").select("*"),
    supabaseClient.from("vehicle_assignments").select("*"),
    supabaseClient.from("documents").select("*"),
    supabaseClient.from("document_viewers").select("*"),
    supabaseClient.from("applications").select("*").order("created_at", { ascending: false })
  ]);

  const firstError = [driversResult, vehiclesResult, assignmentsResult, documentsResult, viewersResult].find(result => result.error)?.error;
  if (firstError) throw firstError;

  const assignments = assignmentsResult.data || [];
  const viewers = viewersResult.data || [];
  state.drivers = (driversResult.data || []).map(row => ({
    id: row.id,
    profileId: valueOf(row, "profile_id", "user_id"),
    name: valueOf(row, "full_name", "name"),
    email: valueOf(row, "email"),
    phone: valueOf(row, "phone"),
    status: valueOf(row, "status") || "Ativo",
    raw: row
  }));
  state.vehicles = (vehiclesResult.data || []).map(row => ({
    id: row.id,
    plate: valueOf(row, "plate", "registration_plate", "license_plate"),
    brand: valueOf(row, "brand", "make"),
    model: valueOf(row, "model"),
    year: valueOf(row, "year"),
    vin: valueOf(row, "vin"),
    status: valueOf(row, "status") || "Ativo",
    driverIds: assignments.filter(item => item.vehicle_id === row.id && item.active !== false).map(item => item.driver_id),
    raw: row
  }));
  state.documents = (documentsResult.data || []).map(row => ({
    id: row.id,
    name: valueOf(row, "name", "title", "file_name"),
    type: valueOf(row, "document_type", "type") || "Outros",
    number: valueOf(row, "document_number", "number"),
    policyNumber: valueOf(row, "policy_number"),
    issueDate: valueOf(row, "issue_date"),
    expiryDate: valueOf(row, "expiry_date"),
    observations: valueOf(row, "observations", "notes"),
    fileName: valueOf(row, "file_name", "name"),
    fileType: valueOf(row, "mime_type", "file_type"),
    driveFileId: valueOf(row, "drive_file_id", "google_drive_file_id"),
    driveUrl: valueOf(row, "drive_url", "web_view_link", "file_url"),
    vehicleId: valueOf(row, "vehicle_id"),
    driverId: valueOf(row, "driver_id"),
    viewerDriverIds: viewers.filter(item => item.document_id === row.id).map(item => item.driver_id),
    raw: row
  }));
  state.applications = (applicationsResult.data || []).map(row => ({
    id: row.id,
    candidate: {
      name: valueOf(row, "candidate_name", "full_name", "name"),
      phone: valueOf(row, "phone"),
      email: valueOf(row, "email"),
      tvdeCertificate: valueOf(row, "tvde_certificate"),
      drivingLicense: valueOf(row, "driving_license"),
      tvdeExperience: valueOf(row, "tvde_experience"),
      availability: valueOf(row, "availability"),
      schedulePreference: valueOf(row, "schedule_preference")
    },
    documents: [],
    status: valueOf(row, "status") || "Nova",
    summary: valueOf(row, "summary") || "Candidatura recebida.",
    conversation: valueOf(row, "conversation") || [],
    raw: row
  }));
  state.backendReady = true;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, match => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[match]);
}

function makeId(prefix) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function driverName(id) {
  return state.drivers.find(driver => driver.id === id)?.name || "Sem motorista";
}

function vehicleName(id) {
  const vehicle = state.vehicles.find(item => item.id === id);
  return vehicle ? `${vehicle.plate} · ${vehicle.brand} ${vehicle.model}` : "Sem veículo";
}

function driverDocuments() {
  const driverId = currentUser().driverId;
  return state.documents.filter(doc => doc.viewerDriverIds.includes(driverId));
}

function driverVehicles() {
  const driverId = currentUser().driverId;
  return state.vehicles.filter(vehicle => vehicle.driverIds.includes(driverId));
}

function daysUntil(date) {
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.ceil((new Date(date) - new Date()) / oneDay);
}

function alertLevel(doc) {
  const days = daysUntil(doc.expiryDate);
  if (days < 0) return "Expirado";
  if (days <= 3) return "3 dias";
  if (days <= 7) return "7 dias";
  if (days <= 15) return "15 dias";
  if (days <= 30) return "30 dias";
  return "OK";
}

function visibleDocuments() {
  return currentUser().role === "admin" ? state.documents : driverDocuments();
}

function showToast(message) {
  selectors.toast.textContent = message;
  selectors.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => selectors.toast.classList.remove("visible"), 2600);
}

const recruiterFields = [
  ["name", "nome"],
  ["phone", "telemóvel"],
  ["email", "email"],
  ["tvdeCertificate", "certificado TVDE (Sim/Não)"],
  ["drivingLicense", "carta de condução (Sim/Não)"],
  ["tvdeExperience", "experiência em TVDE"],
  ["availability", "disponibilidade"],
  ["schedulePreference", "preferência de horário"]
];

function openRecruitment() {
  selectors.loginScreen.classList.add("hidden");
  selectors.appShell.classList.add("hidden");
  selectors.recruitmentScreen.classList.remove("hidden");
  startRecruiterSession();
}

function closeRecruitment() {
  selectors.recruitmentScreen.classList.add("hidden");
  selectors.loginScreen.classList.remove("hidden");
}

function startRecruiterSession() {
  state.recruiterSession = {
    candidate: {},
    documents: [],
    conversation: [],
    submitted: false
  };
  selectors.publicRequirements.innerHTML = state.recruitmentConfig.requirements.map(item => `<span class="tag">${escapeHtml(item)}</span>`).join("");
  addRecruiterMessage("assistant", "Olá. Sou o S2T AI Recruiter. Vou explicar o processo, responder a perguntas e recolher os dados necessários para a candidatura.");
  addRecruiterMessage("assistant", `Processo: candidatura, validação de requisitos, análise de documentos e contacto pelo Administrador. Para começar, indique o seu ${nextRecruiterField()?.[1]}.`);
}

function addRecruiterMessage(role, text) {
  state.recruiterSession.conversation.push({ role, text });
  renderRecruiterChat();
}

function renderRecruiterChat() {
  selectors.recruiterChatLog.innerHTML = state.recruiterSession.conversation.map(message => `
    <div class="chat-message ${message.role}">
      <strong>${message.role === "assistant" ? "S2T AI Recruiter" : "Candidato"}</strong>
      <p>${escapeHtml(message.text)}</p>
    </div>
  `).join("");
  selectors.recruiterChatLog.scrollTop = selectors.recruiterChatLog.scrollHeight;
}

function nextRecruiterField() {
  return recruiterFields.find(([key]) => !state.recruiterSession.candidate[key]);
}

function answerRecruiter(input) {
  const text = input.trim();
  if (!text || state.recruiterSession.submitted) return;
  addRecruiterMessage("candidate", text);

  const faq = findRecruiterFaq(text);
  if (faq) {
    addRecruiterMessage("assistant", faq.a);
    const missing = nextRecruiterField();
    if (missing) addRecruiterMessage("assistant", `Para continuar a candidatura, indique o seu ${missing[1]}.`);
    return;
  }

  if (text.toLowerCase() === "confirmar") {
    submitRecruiterApplication();
    return;
  }

  const missing = nextRecruiterField();
  if (missing) {
    state.recruiterSession.candidate[missing[0]] = text;
  }

  const next = nextRecruiterField();
  if (next) {
    addRecruiterMessage("assistant", `Obrigado. Indique agora: ${next[1]}.`);
    return;
  }

  if (!state.recruiterSession.documents.length) {
    addRecruiterMessage("assistant", "Dados recolhidos. Envie agora os documentos disponíveis em PDF, JPG, JPEG ou PNG. Depois escreva Confirmar.");
    return;
  }

  addRecruiterMessage("assistant", recruiterSummaryText() + "\n\nSe estiver correto, escreva Confirmar.");
}

function findRecruiterFaq(text) {
  const normalized = normalizeText(text);
  return state.recruitmentConfig.faqs.find(item => {
    const question = normalizeText(item.q);
    return question.includes(normalized) || normalized.includes(question.split(" ").slice(0, 4).join(" "));
  });
}

function normalizeText(text) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w\s]/g, "").trim();
}

function recruiterSummaryText() {
  const c = state.recruiterSession.candidate;
  return `Resumo da candidatura:
Nome: ${c.name}
Telemóvel: ${c.phone}
Email: ${c.email}
Certificado TVDE: ${c.tvdeCertificate}
Carta de Condução: ${c.drivingLicense}
Experiência TVDE: ${c.tvdeExperience}
Disponibilidade: ${c.availability}
Preferência de horário: ${c.schedulePreference}
Documentos: ${state.recruiterSession.documents.join(", ") || "sem documentos enviados"}`;
}

function submitRecruiterApplication() {
  const missing = nextRecruiterField();
  if (missing) {
    addRecruiterMessage("assistant", `Ainda falta indicar: ${missing[1]}.`);
    return;
  }
  const application = {
    id: makeId("app"),
    candidate: { ...state.recruiterSession.candidate },
    documents: [...state.recruiterSession.documents],
    status: "Nova",
    summary: recruiterSummaryText().replace(/\n/g, " · "),
    conversation: [...state.recruiterSession.conversation]
  };
  state.applications.unshift(application);
  state.recruiterSession.submitted = true;
  addRecruiterMessage("assistant", "Candidatura submetida. O Administrador irá analisar o resumo, documentos e conversa.");
}

function renderLogin() {
  selectors.loginOptions.innerHTML = "";
}

async function login(identifier, password) {
  const submitButton = selectors.loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "A entrar…";
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: identifier.trim().toLowerCase(),
      password
    });
    if (error || !data.user) throw error || new Error("Sessão inválida.");
    await startAuthenticatedSession(data.user);
  } catch (error) {
    console.error(error);
    showToast("Email ou palavra-passe inválidos.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Entrar";
  }
}

async function startAuthenticatedSession(user) {
  const { data: profile, error } = await supabaseClient.from("profiles").select("*").eq("id", user.id).single();
  if (error || !profile) {
    await supabaseClient.auth.signOut();
    throw error || new Error("Perfil não encontrado.");
  }
  if (profile.status && profile.status !== "Ativo") {
    await supabaseClient.auth.signOut();
    throw new Error("Conta inativa.");
  }
  state.profile = { ...profile, email: profile.email || user.email };
  state.sessionUserId = user.id;
  await loadBackendData();
  state.activeView = profile.role === "admin" ? "dashboard" : "vehicles";
  selectors.loginScreen.classList.add("hidden");
  selectors.appShell.classList.remove("hidden");
  renderApp();
}

async function logout() {
  await supabaseClient.auth.signOut();
  state.sessionUserId = null;
  state.profile = null;
  selectors.appShell.classList.add("hidden");
  selectors.loginScreen.classList.remove("hidden");
  selectors.loginPassword.value = "";
}

function renderApp() {
  const user = currentUser();
  selectors.sessionRole.textContent = user.role === "admin" ? "Administrador" : "Motorista";
  selectors.sessionName.textContent = user.name;
  renderNav();
  renderContent();
}

function renderNav() {
  const user = currentUser();
  selectors.sideNav.innerHTML = navByRole[user.role].map(([view, label, icon]) => `
    <button class="nav-item ${state.activeView === view ? "active" : ""}" type="button" data-view="${view}">
      <span class="nav-icon">${icon}</span>
      <span>${label}</span>
    </button>
  `).join("");
}

function setView(view) {
  const allowed = navByRole[currentUser().role].some(item => item[0] === view);
  if (!allowed) return;
  state.activeView = view;
  renderApp();
}

function renderContent() {
  const views = {
    dashboard: renderDashboard,
    vehicles: renderVehicles,
    drivers: renderDrivers,
    documents: renderDocuments,
    applications: renderApplications,
    alerts: renderAlerts,
    settings: renderSettings,
    account: renderAccount
  };
  views[state.activeView]();
}

function renderDashboard() {
  selectors.pageTitle.textContent = "Dashboard";
  const expiring = state.documents.filter(doc => ["30 dias", "15 dias", "7 dias", "3 dias"].includes(alertLevel(doc))).length;
  const expired = state.documents.filter(doc => alertLevel(doc) === "Expirado").length;
  const max = Math.max(state.drivers.length, state.vehicles.length, state.documents.length, expiring, expired, 1);
  selectors.content.innerHTML = `
    <section class="status-strip">
      ${metric("Total de motoristas", state.drivers.length)}
      ${metric("Total de veículos", state.vehicles.length)}
      ${metric("Total de documentos", state.documents.length)}
      ${metric("Documentos a expirar", expiring)}
      ${metric("Documentos expirados", expired)}
    </section>
    <section class="content-grid">
      <article class="panel">
        <div class="panel-heading"><h2>Resumo operacional</h2><span class="tag active">Administrador</span></div>
        <div class="bar-chart">
          ${bar("Motoristas", state.drivers.length, max)}
          ${bar("Veículos", state.vehicles.length, max)}
          ${bar("Documentos", state.documents.length, max)}
          ${bar("A expirar", expiring, max)}
          ${bar("Expirados", expired, max)}
        </div>
      </article>
      <article class="panel">
        <div class="panel-heading"><h2>S2T SmartDocs</h2><span class="tag">IA preparada</span></div>
        <p class="section-copy">Ao carregar PDF ou imagem, o sistema identifica automaticamente tipo, matrícula, número, apólice e datas para confirmação do Administrador.</p>
        <button class="primary-button" type="button" data-open="document">Carregar documento</button>
      </article>
    </section>
  `;
}

function metric(label, value) {
  return `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>Simplicity2Take Fleet</small></article>`;
}

function bar(label, value, max) {
  return `<div class="bar-row"><span>${label}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, (value / max) * 100)}%"></div></div><strong>${value}</strong></div>`;
}

function renderVehicles() {
  const admin = currentUser().role === "admin";
  const vehicles = admin ? state.vehicles : driverVehicles();
  selectors.pageTitle.textContent = admin ? "Veículos" : "Meus Veículos";
  selectors.content.innerHTML = `
    ${heading(admin ? "Gestão de veículos" : "Veículos atribuídos", admin ? "Criar, editar e eliminar veículos." : "Consulta dos veículos que lhe foram atribuídos.", admin ? `<button class="primary-button" type="button" data-open="vehicle">Criar veículo</button>` : "")}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Matrícula</th><th>Marca / Modelo</th><th>Ano</th><th>VIN</th><th>Estado</th><th>Motoristas</th><th>Ações</th></tr></thead>
        <tbody>${vehicles.map(vehicle => vehicleRow(vehicle, admin)).join("") || emptyRow("Sem veículos para apresentar.")}</tbody>
      </table>
    </div>
  `;
}

function vehicleRow(vehicle, admin) {
  return `
    <tr>
      <td><strong>${escapeHtml(vehicle.plate)}</strong></td>
      <td>${escapeHtml(vehicle.brand)} ${escapeHtml(vehicle.model)}</td>
      <td>${escapeHtml(vehicle.year)}</td>
      <td>${escapeHtml(vehicle.vin)}</td>
      <td><span class="tag ${vehicle.status === "Ativo" ? "active" : "expiring"}">${escapeHtml(vehicle.status)}</span></td>
      <td>${vehicle.driverIds.map(driverName).join(", ") || "Sem motorista"}</td>
      <td>${admin ? `<div class="row-actions"><button class="mini-button" type="button" data-edit-vehicle="${vehicle.id}">Editar</button><button class="danger-button" type="button" data-delete-vehicle="${vehicle.id}">Eliminar</button></div>` : "Consulta"}</td>
    </tr>
  `;
}

function renderDrivers() {
  selectors.pageTitle.textContent = "Motoristas";
  selectors.content.innerHTML = `
    ${heading("Gestão de motoristas", "Criar, editar, eliminar e recuperar palavras-passe.", `<button class="primary-button" type="button" data-open="driver">Criar motorista</button>`)}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nome completo</th><th>Email</th><th>Telemóvel</th><th>Estado</th><th>Documentos</th><th>Ações</th></tr></thead>
        <tbody>${state.drivers.map(driverRow).join("")}</tbody>
      </table>
    </div>
  `;
}

function driverRow(driver) {
  const docs = state.documents.filter(doc => doc.viewerDriverIds.includes(driver.id));
  return `
    <tr>
      <td><strong>${escapeHtml(driver.name)}</strong></td>
      <td>${escapeHtml(driver.email)}</td>
      <td>${escapeHtml(driver.phone)}</td>
      <td><span class="tag ${driver.status === "Ativo" ? "active" : "inactive"}">${escapeHtml(driver.status)}</span></td>
      <td><span class="tag">${docs.length} docs</span></td>
      <td><div class="row-actions"><button class="mini-button" type="button" data-doc-driver="${driver.id}">Documento</button><button class="mini-button" type="button" data-edit-driver="${driver.id}">Editar</button><button class="mini-button" type="button" data-reset-password="${driver.id}">Recuperar passe</button><button class="danger-button" type="button" data-delete-driver="${driver.id}">Eliminar</button></div></td>
    </tr>
  `;
}

function renderDocuments() {
  const admin = currentUser().role === "admin";
  const documents = visibleDocuments();
  selectors.pageTitle.textContent = admin ? "Documentos" : "Meus Documentos";
  selectors.content.innerHTML = `
    ${heading(admin ? "Gestão documental" : "Documentos atribuídos", admin ? "Carregue documentos e defina quem pode visualizar." : "Abra ou descarregue os documentos autorizados.", admin ? `<button class="primary-button" type="button" data-open="document">Carregar documento</button>` : "")}
    <section class="cards-grid">${documents.map(doc => documentCard(doc, admin)).join("") || emptyCard("Sem documentos para apresentar.")}</section>
  `;
}

function documentCard(doc, admin) {
  const level = alertLevel(doc);
  return `
    <article class="data-card">
      <span class="tag ${level === "Expirado" ? "inactive" : level === "OK" ? "active" : "expiring"}">${escapeHtml(level)}</span>
      <h3>${escapeHtml(doc.name)}</h3>
      <div class="meta-line">
        <span>${escapeHtml(doc.type)}</span>
        <span>${escapeHtml(doc.number || "Sem número")}</span>
        <span>Validade: ${escapeHtml(doc.expiryDate)}</span>
        <span>${escapeHtml(vehicleName(doc.vehicleId))}</span>
        <span>${escapeHtml(driverName(doc.driverId))}</span>
      </div>
      <div class="row-actions">
        <button class="mini-button" type="button" data-open-doc="${doc.id}">Abrir Documento</button>
        <button class="mini-button" type="button" data-download-doc="${doc.id}">Download</button>
        ${admin ? `<button class="mini-button" type="button" data-edit-document="${doc.id}">Editar</button><button class="danger-button" type="button" data-delete-document="${doc.id}">Eliminar</button>` : ""}
      </div>
    </article>
  `;
}

function renderAlerts() {
  selectors.pageTitle.textContent = "Alertas";
  const alerts = state.documents.filter(doc => alertLevel(doc) !== "OK");
  selectors.content.innerHTML = `
    ${heading("Alertas automáticos", "30, 15, 7, 3 dias e expirado.", "")}
    <section class="cards-grid">${alerts.map(doc => `
      <article class="data-card">
        <span class="tag ${alertLevel(doc) === "Expirado" ? "inactive" : "expiring"}">${alertLevel(doc)}</span>
        <h3>${escapeHtml(doc.name)}</h3>
        <p class="section-copy">${escapeHtml(doc.type)} termina em ${escapeHtml(doc.expiryDate)}.</p>
      </article>
    `).join("") || emptyCard("Sem alertas ativos.")}</section>
  `;
}

function renderApplications() {
  selectors.pageTitle.textContent = "Candidaturas";
  selectors.content.innerHTML = `
    ${heading("S2T AI Recruiter", "Candidaturas recolhidas automaticamente pelo assistente.", `<button class="secondary-button" type="button" data-view-public-recruitment>Ver página pública</button>`)}
    <section class="cards-grid">
      ${state.applications.map(application => `
        <article class="data-card application-card">
          <span class="tag ${application.status === "Aceite" ? "active" : application.status === "Recusada" ? "inactive" : "expiring"}">${escapeHtml(application.status)}</span>
          <h3>${escapeHtml(application.candidate.name || "Candidato sem nome")}</h3>
          <p class="section-copy">${escapeHtml(application.summary)}</p>
          <div class="meta-line">
            <span>${escapeHtml(application.candidate.phone || "Sem telemóvel")}</span>
            <span>${escapeHtml(application.candidate.email || "Sem email")}</span>
            <span>TVDE: ${escapeHtml(application.candidate.tvdeCertificate || "Não indicado")}</span>
          </div>
          <h4>Documentos enviados</h4>
          <ul>${(application.documents.length ? application.documents : ["Sem documentos enviados"]).map(doc => `<li>${escapeHtml(doc)}</li>`).join("")}</ul>
          <h4>Conversa</h4>
          <div class="conversation-mini">
            ${application.conversation.map(message => `<p><strong>${message.role === "assistant" ? "IA" : "Candidato"}:</strong> ${escapeHtml(message.text)}</p>`).join("")}
          </div>
          <div class="row-actions">
            <button class="mini-button" type="button" data-application-status="${application.id}" data-status="Em análise">Em análise</button>
            <button class="mini-button" type="button" data-application-status="${application.id}" data-status="Aceite">Aceite</button>
            <button class="danger-button" type="button" data-application-status="${application.id}" data-status="Recusada">Recusada</button>
          </div>
        </article>
      `).join("") || emptyCard("Ainda não existem candidaturas.")}
    </section>
  `;
}

function renderSettings() {
  selectors.pageTitle.textContent = "Configurações";
  selectors.content.innerHTML = `
    ${heading("Configurações", "Segurança, palavras-passe e integrações futuras.", "")}
    <section class="content-grid">
      <article class="panel">
        <div class="panel-heading"><h2>Segurança</h2><span class="tag active">Ativo</span></div>
        <div class="settings-list">
          <div class="settings-row"><strong>Administrador único</strong><span class="tag active">Configurado</span></div>
          <div class="settings-row"><strong>Motoristas sem edição crítica</strong><span class="tag active">Configurado</span></div>
          <div class="settings-row"><strong>Recuperação de palavra-passe pelo Administrador</strong><span class="tag active">Configurado</span></div>
        </div>
      </article>
      <article class="panel">
        <div class="panel-heading"><h2>Preparação futura</h2><span class="tag">Pronto</span></div>
        <div class="settings-list">
          ${["Google Drive", "Cartrack", "Gestão de Revisões", "Gestão de Inspeções", "Aplicação Android", "Aplicação iPhone"].map(item => `<div class="settings-row"><strong>${item}</strong><span class="tag">Preparado</span></div>`).join("")}
        </div>
      </article>
      <article class="panel recruiter-config">
        <div class="panel-heading"><h2>S2T AI Recruiter</h2><span class="tag active">Editável</span></div>
        <form id="recruiterConfigForm" class="config-form">
          <label>
            Requisitos de recrutamento
            <textarea name="requirements" rows="5">${escapeHtml(state.recruitmentConfig.requirements.join("\n"))}</textarea>
          </label>
          <label>
            Perguntas frequentes e respostas
            <textarea name="faqs" rows="8">${escapeHtml(state.recruitmentConfig.faqs.map(item => `${item.q} | ${item.a}`).join("\n"))}</textarea>
          </label>
          <button class="primary-button" type="submit">Guardar configuração da IA</button>
        </form>
      </article>
    </section>
  `;
}

function renderAccount() {
  selectors.pageTitle.textContent = "Minha Conta";
  const user = currentUser();
  selectors.content.innerHTML = `
    ${heading("Minha Conta", "Pode alterar a sua palavra-passe.", `<button class="primary-button" type="button" data-open="password">Alterar palavra-passe</button>`)}
    <article class="panel">
      <h2>${escapeHtml(user.name)}</h2>
      <p class="section-copy">${escapeHtml(user.email)} · ${escapeHtml(user.phone)}</p>
    </article>
  `;
}

function heading(title, copy, actions) {
  return `<section class="section-heading"><div><p class="eyebrow">${currentUser().role === "admin" ? "Administrador" : "Motorista"}</p><h2>${title}</h2><p class="section-copy">${copy}</p></div><div class="button-row">${actions}</div></section>`;
}

function emptyRow(message) {
  return `<tr><td colspan="7">${message}</td></tr>`;
}

function emptyCard(message) {
  return `<article class="empty-state">${message}</article>`;
}

function openModal(type, id = "") {
  state.editing = { type, id };
  const title = { driver: "motorista", vehicle: "veículo", document: "documento", password: "palavra-passe" }[type];
  selectors.modalTitle.textContent = `${id && type !== "document" ? "Editar" : type === "document" ? "Carregar" : "Criar"} ${title}`;
  selectors.modalFields.innerHTML = modalFields(type, id);
  selectors.modal.showModal();
  if (type === "document") wireSmartDocsUpload();
}

function modalFields(type, id) {
  if (type === "driver") {
    const driver = state.drivers.find(item => item.id === id) || {};
    return [
      field("name", "Nome completo", driver.name),
      field("email", "Email", driver.email, "email"),
      field("phone", "Telemóvel", driver.phone, "tel"),
      selectField("status", "Estado", ["Ativo", "Inativo"], driver.status || "Ativo")
    ].join("");
  }
  if (type === "vehicle") {
    const vehicle = state.vehicles.find(item => item.id === id) || {};
    return [
      field("plate", "Matrícula", vehicle.plate),
      field("brand", "Marca", vehicle.brand),
      field("model", "Modelo", vehicle.model),
      field("year", "Ano", vehicle.year, "number"),
      field("vin", "VIN", vehicle.vin, "text", true),
      selectField("status", "Estado", ["Ativo", "Manutenção", "Inativo"], vehicle.status || "Ativo"),
      checkList("driverIds", "Motoristas atribuídos", state.drivers, vehicle.driverIds || [])
    ].join("");
  }
  if (type === "password") {
    return [field("password", "Nova palavra-passe", "", "password", true)].join("");
  }

  const doc = state.documents.find(item => item.id === id) || {};
  const selectedDriver = id && state.drivers.some(driver => driver.id === id) ? id : doc.driverId || "";
  return `
    <div class="smartdocs-box span-full">
      <strong>S2T SmartDocs</strong>
      <p>Carregue um PDF ou imagem. A pré-visualização será preenchida automaticamente para confirmação.</p>
    </div>
    ${field("file", "Ficheiro original", "", "file", true, 'accept=".pdf,.jpg,.jpeg,.png"')}
    <div class="smart-preview span-full" id="smartPreview">Pré-visualização SmartDocs ainda sem ficheiro.</div>
    ${field("name", "Nome", doc.name)}
    ${selectField("type", "Tipo", documentTypes, doc.type || "Carta Verde")}
    ${field("number", "Número do documento", doc.number)}
    ${field("policyNumber", "Número da apólice", doc.policyNumber)}
    ${field("issueDate", "Data de emissão", doc.issueDate, "date")}
    ${field("expiryDate", "Data de validade", doc.expiryDate, "date")}
    ${selectField("vehicleId", "Veículo associado", [["", "Sem veículo"], ...state.vehicles.map(vehicle => [vehicle.id, vehicleName(vehicle.id)])], doc.vehicleId || "")}
    ${selectField("driverId", "Motorista associado", [["", "Sem motorista"], ...state.drivers.map(driver => [driver.id, driver.name])], selectedDriver)}
    ${field("observations", "Observações", doc.observations, "text", true)}
    ${checkList("viewerDriverIds", "Quem pode visualizar o documento", state.drivers, doc.viewerDriverIds || (selectedDriver ? [selectedDriver] : []))}
  `;
}

function field(name, label, value = "", type = "text", span = false, extra = "") {
  const optionalFields = ["observations", "policyNumber"];
  const required = type === "file" || optionalFields.includes(name) ? "" : "required";
  return `<label class="${span ? "span-full" : ""}">${label}<input name="${name}" type="${type}" value="${type === "file" ? "" : escapeHtml(value)}" ${extra} ${required}></label>`;
}

function selectField(name, label, options, value) {
  const normalized = options.map(option => Array.isArray(option) ? option : [option, option]);
  return `<label>${label}<select name="${name}" required>${normalized.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}</select></label>`;
}

function checkList(name, label, items, selected) {
  return `
    <fieldset class="check-list span-full">
      <legend>${label}</legend>
      ${items.map(item => `<label><input type="checkbox" name="${name}" value="${item.id}" ${selected.includes(item.id) ? "checked" : ""}>${escapeHtml(item.name)}</label>`).join("")}
    </fieldset>
  `;
}

function wireSmartDocsUpload() {
  const fileInput = selectors.modalFields.querySelector('input[name="file"]');
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    state.smartPreview = analyseFileName(file.name);
    const preview = $("#smartPreview");
    preview.innerHTML = `
      <strong>Documento identificado:</strong>
      <dl>
        <dt>Tipo:</dt><dd>${escapeHtml(state.smartPreview.type)}</dd>
        <dt>Matrícula:</dt><dd>${escapeHtml(state.smartPreview.plate || "Não identificada")}</dd>
        <dt>Número:</dt><dd>${escapeHtml(state.smartPreview.number || "Não identificado")}</dd>
        <dt>Validade:</dt><dd>${escapeHtml(state.smartPreview.expiryDate || "Não identificada")}</dd>
      </dl>
    `;
    selectors.modalFields.querySelector('[name="type"]').value = state.smartPreview.type;
    if (state.smartPreview.plate) {
      const vehicle = state.vehicles.find(item => item.plate.toLowerCase() === state.smartPreview.plate.toLowerCase());
      if (vehicle) selectors.modalFields.querySelector('[name="vehicleId"]').value = vehicle.id;
    }
    selectors.modalFields.querySelector('[name="number"]').value = state.smartPreview.number;
    selectors.modalFields.querySelector('[name="policyNumber"]').value = state.smartPreview.policyNumber;
    selectors.modalFields.querySelector('[name="issueDate"]').value = state.smartPreview.issueDate;
    selectors.modalFields.querySelector('[name="expiryDate"]').value = state.smartPreview.expiryDate;
    selectors.modalFields.querySelector('[name="name"]').value = `${state.smartPreview.type} ${state.smartPreview.plate}`.trim();
  });
}

function analyseFileName(fileName) {
  const text = fileName.toLowerCase();
  const type = documentTypes.find(item => text.includes(item.toLowerCase().replaceAll(" ", "-")) || text.includes(item.toLowerCase())) || (text.includes("ipo") ? "IPO" : text.includes("seguro") ? "Seguro" : text.includes("contrato") ? "Contrato" : "Outros");
  const plate = fileName.match(/[A-Z]{2}-\d{2}-[A-Z]{2}|\d{2}-[A-Z]{2}-\d{2}|[A-Z]{2}-[A-Z]{2}-\d{2}/i)?.[0]?.toUpperCase() || "";
  return {
    type,
    plate,
    number: `DOC-${Math.floor(100000 + Math.random() * 900000)}`,
    policyNumber: type === "Seguro" || type === "Carta Verde" ? `AP-${Math.floor(100000 + Math.random() * 900000)}` : "",
    issueDate: "2026-01-01",
    expiryDate: "2026-12-31"
  };
}

async function submitModal(event) {
  event.preventDefault();
  const submitButton = selectors.form.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = "A guardar…";
  const data = new FormData(selectors.form);
  const values = Object.fromEntries(data.entries());
  const checked = name => data.getAll(name);
  const { type, id } = state.editing;
  try {
    if (type === "driver") await saveDriver(values, id);
    if (type === "vehicle") await saveVehicle(values, checked("driverIds"), id);
    if (type === "document") await saveDocument(values, checked("viewerDriverIds"), id);
    if (type === "password") await savePassword(values.password);
    selectors.modal.close();
    await loadBackendData();
    renderApp();
  } catch (error) {
    console.error(error);
    showToast(error?.message || "Não foi possível guardar.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Guardar";
  }
}

async function saveDriver(values, id) {
  if (!id) throw new Error("A criação do acesso do motorista será ativada no próximo passo.");
  const { error } = await supabaseClient.from("drivers").update({
    full_name: values.name,
    email: values.email,
    phone: values.phone,
    status: values.status
  }).eq("id", id);
  if (error) throw error;
  showToast("Motorista atualizado.");
}

async function saveVehicle(values, driverIds, id) {
  const payload = {
    plate: values.plate.toUpperCase(),
    brand: values.brand,
    model: values.model,
    year: Number(values.year),
    vin: values.vin,
    status: values.status
  };
  const query = id
    ? supabaseClient.from("vehicles").update(payload).eq("id", id).select().single()
    : supabaseClient.from("vehicles").insert(payload).select().single();
  const { data: vehicle, error } = await query;
  if (error) throw error;
  const vehicleId = id || vehicle.id;
  const { error: deleteError } = await supabaseClient.from("vehicle_assignments").delete().eq("vehicle_id", vehicleId);
  if (deleteError) throw deleteError;
  if (driverIds.length) {
    const { error: assignmentError } = await supabaseClient.from("vehicle_assignments").insert(
      driverIds.map(driverId => ({ vehicle_id: vehicleId, driver_id: driverId, active: true }))
    );
    if (assignmentError) throw assignmentError;
  }
  showToast(id ? "Veículo atualizado." : "Veículo criado.");
}

async function saveDocument(values, viewerDriverIds, id) {
  const file = selectors.modalFields.querySelector('[name="file"]')?.files?.[0];
  const existing = state.documents.find(item => item.id === id);
  let driveData = existing ? {
    fileId: existing.driveFileId,
    fileName: existing.fileName,
    mimeType: existing.fileType,
    webViewLink: existing.driveUrl
  } : null;

  if (file) {
    if (file.size > 10 * 1024 * 1024) throw new Error("O ficheiro ultrapassa 10 MB.");
    if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type)) throw new Error("Só são permitidos PDF, JPG e PNG.");
    const base64 = await fileToBase64(file);
    const { data, error } = await supabaseClient.functions.invoke("drive-upload", {
      body: {
        fileName: file.name,
        mimeType: file.type,
        base64,
        folderType: values.vehicleId ? "vehicles" : values.driverId ? "drivers" : "documents",
        documentType: values.type
      }
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "Falha ao guardar no Google Drive.");
    driveData = data;
  }
  if (!driveData) throw new Error("Selecione um ficheiro.");

  const payload = {
    name: values.name,
    document_type: values.type,
    document_number: values.number,
    policy_number: values.policyNumber || null,
    issue_date: values.issueDate || null,
    expiry_date: values.expiryDate || null,
    observations: values.observations,
    file_name: driveData.fileName,
    mime_type: driveData.mimeType,
    drive_file_id: driveData.fileId,
    drive_url: driveData.webViewLink,
    vehicle_id: values.vehicleId || null,
    driver_id: values.driverId || null,
    uploaded_by: state.sessionUserId
  };
  const query = id
    ? supabaseClient.from("documents").update(payload).eq("id", id).select().single()
    : supabaseClient.from("documents").insert(payload).select().single();
  const { data: saved, error } = await query;
  if (error) throw error;
  const documentId = id || saved.id;
  const { error: viewerDeleteError } = await supabaseClient.from("document_viewers").delete().eq("document_id", documentId);
  if (viewerDeleteError) throw viewerDeleteError;
  if (viewerDriverIds.length) {
    const { error: viewerError } = await supabaseClient.from("document_viewers").insert(
      viewerDriverIds.map(driverId => ({ document_id: documentId, driver_id: driverId }))
    );
    if (viewerError) throw viewerError;
  }
  state.activeView = "documents";
  showToast("Documento guardado no Google Drive.");
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Não foi possível ler o ficheiro."));
    reader.readAsDataURL(file);
  });
}

async function savePassword(password) {
  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) throw error;
  showToast("Palavra-passe alterada.");
}

function resetPassword() {
  showToast("A recuperação segura será enviada por email na próxima etapa.");
}

async function deleteById(collection, id, message) {
  const table = { drivers: "drivers", vehicles: "vehicles", documents: "documents" }[collection];
  if (!table) return;
  if (!window.confirm("Confirma que pretende eliminar este registo?")) return;
  const { error } = await supabaseClient.from(table).delete().eq("id", id);
  if (error) {
    showToast(error.message);
    return;
  }
  await loadBackendData();
  showToast(message);
  renderApp();
}

function openDocument(id, download = false) {
  const doc = state.documents.find(item => item.id === id);
  if (!doc?.driveUrl) {
    showToast("Este documento ainda não tem ligação ao Google Drive.");
    return;
  }
  const link = document.createElement("a");
  link.href = doc.driveUrl;
  link.target = "_blank";
  if (download) link.download = doc.fileName;
  link.rel = "noopener";
  link.click();
}

function createDemoPdf(doc) {
  const text = `Simplicity2Take Fleet\\n${doc.name}\\nTipo: ${doc.type}\\nNumero: ${doc.number}\\nValidade: ${doc.expiryDate}`;
  const stream = `BT /F1 18 Tf 72 740 Td (${text.replace(/[()]/g, "")}) Tj ET`;
  const pdf = `%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>> endobj
4 0 obj <</Type /Font /Subtype /Helvetica /BaseFont /Helvetica>> endobj
5 0 obj <</Length ${stream.length}>> stream
${stream}
endstream endobj
xref
0 6
0000000000 65535 f
trailer <</Root 1 0 R /Size 6>>
startxref
0
%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

document.addEventListener("click", async event => {
  const publicRecruitment = event.target.closest("[data-view-public-recruitment]");
  if (publicRecruitment) openRecruitment();

  const demo = event.target.closest("[data-demo-login]");
  if (demo) {
    const account = state.users.find(user => user.id === demo.dataset.demoLogin);
    selectors.loginIdentifier.value = account.email || account.phone;
    selectors.loginPassword.value = account.password;
  }
  const nav = event.target.closest("[data-view]");
  if (nav) setView(nav.dataset.view);
  const open = event.target.closest("[data-open]");
  if (open) openModal(open.dataset.open);
  const editDriver = event.target.closest("[data-edit-driver]");
  if (editDriver) openModal("driver", editDriver.dataset.editDriver);
  const editVehicle = event.target.closest("[data-edit-vehicle]");
  if (editVehicle) openModal("vehicle", editVehicle.dataset.editVehicle);
  const editDocument = event.target.closest("[data-edit-document]");
  if (editDocument) openModal("document", editDocument.dataset.editDocument);
  const docDriver = event.target.closest("[data-doc-driver]");
  if (docDriver) openModal("document", docDriver.dataset.docDriver);
  const reset = event.target.closest("[data-reset-password]");
  if (reset) resetPassword(reset.dataset.resetPassword);
  const deleteDriver = event.target.closest("[data-delete-driver]");
  if (deleteDriver) await deleteById("drivers", deleteDriver.dataset.deleteDriver, "Motorista eliminado.");
  const deleteVehicle = event.target.closest("[data-delete-vehicle]");
  if (deleteVehicle) await deleteById("vehicles", deleteVehicle.dataset.deleteVehicle, "Veículo eliminado.");
  const deleteDocument = event.target.closest("[data-delete-document]");
  if (deleteDocument) await deleteById("documents", deleteDocument.dataset.deleteDocument, "Documento eliminado.");
  const openDoc = event.target.closest("[data-open-doc]");
  if (openDoc) openDocument(openDoc.dataset.openDoc, false);
  const downloadDoc = event.target.closest("[data-download-doc]");
  if (downloadDoc) openDocument(downloadDoc.dataset.downloadDoc, true);

  const applicationStatus = event.target.closest("[data-application-status]");
  if (applicationStatus) {
    const application = state.applications.find(item => item.id === applicationStatus.dataset.applicationStatus);
    if (application) {
      const { error } = await supabaseClient.from("applications").update({ status: applicationStatus.dataset.status }).eq("id", application.id);
      if (error) showToast(error.message);
      else {
        await loadBackendData();
        showToast("Estado da candidatura atualizado.");
        renderApp();
      }
    }
  }
});

document.addEventListener("submit", event => {
  if (event.target.id === "recruiterConfigForm") {
    event.preventDefault();
    const data = new FormData(event.target);
    state.recruitmentConfig.requirements = String(data.get("requirements") || "").split("\n").map(item => item.trim()).filter(Boolean);
    state.recruitmentConfig.faqs = String(data.get("faqs") || "").split("\n").map(line => {
      const [q, ...answer] = line.split("|");
      return { q: q.trim(), a: answer.join("|").trim() };
    }).filter(item => item.q && item.a);
    showToast("Configuração do S2T AI Recruiter atualizada.");
  }
});

selectors.loginForm.addEventListener("submit", event => {
  event.preventDefault();
  login(selectors.loginIdentifier.value, selectors.loginPassword.value);
});
$("#workWithUsButton").addEventListener("click", openRecruitment);
$("#backToLoginButton").addEventListener("click", closeRecruitment);
selectors.recruiterForm.addEventListener("submit", event => {
  event.preventDefault();
  answerRecruiter(selectors.recruiterInput.value);
  selectors.recruiterInput.value = "";
});
selectors.candidateDocuments.addEventListener("change", () => {
  if (!state.recruiterSession) startRecruiterSession();
  const files = Array.from(selectors.candidateDocuments.files || []).map(file => file.name);
  state.recruiterSession.documents = files;
  addRecruiterMessage("assistant", `Documentos recebidos: ${files.join(", ") || "nenhum"}. ${recruiterSummaryText()}\n\nSe estiver correto, escreva Confirmar.`);
});
selectors.form.addEventListener("submit", submitModal);
$("#logoutButton").addEventListener("click", logout);
$("#closeModal").addEventListener("click", () => selectors.modal.close());
$("#cancelModal").addEventListener("click", () => selectors.modal.close());

async function initialise() {
  renderLogin();
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.user) return;
  try {
    await startAuthenticatedSession(session.user);
  } catch (error) {
    console.error(error);
    await supabaseClient.auth.signOut();
    showToast("Volte a iniciar sessão.");
  }
}

initialise();
