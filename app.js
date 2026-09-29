const documentBlobCache = new Map();

const state = {
  sessionUserId: null,
  profile: null,
  backendReady: false,
  activeView: "dashboard",
  editing: null,
  smartPreview: null,
  requestedVehicleId: null,
  users: [
    { id: "admin", role: "admin", name: "Administrador Simplicity2Take", email: "admin@simplicity2take.pt", phone: "210000000" },
    { id: "u-joao", role: "driver", name: "João Silva", email: "joao@simplicity2take.pt", phone: "912345678", driverId: "d-joao" },
    { id: "u-pedro", role: "driver", name: "Pedro Costa", email: "pedro@simplicity2take.pt", phone: "934210987", driverId: "d-pedro" },
    { id: "u-carlos", role: "driver", name: "Carlos Santos", email: "carlos@simplicity2take.pt", phone: "966870120", driverId: "d-carlos" }
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

const documentTypes = [
  "DUA",
  "Seguro",
  "Carta Verde",
  "IPO",
  "Licença TVDE",
  "Carta de Condução",
  "Cartão de Cidadão",
  "Contrato",
  "Outros"
];
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
    year: valueOf(row, "vehicle_year", "year"),
    vin: valueOf(row, "vin"),
    qrToken: valueOf(row, "qr_token", "qrToken"),
    status: valueOf(row, "status") || "Ativo",
    driverIds: assignments.filter(item => item.vehicle_id === row.id && assignmentIsActive(item)).map(item => item.driver_id),
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
    fileName: valueOf(row, "original_file_name", "file_name", "name"),
    fileType: valueOf(row, "mime_type", "file_type"),
    driveFileId: valueOf(row, "drive_file_id", "google_drive_file_id"),
    driveUrl: valueOf(row, "drive_web_view_link", "drive_url", "web_view_link", "file_url"),
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

function assignmentIsActive(assignment) {
  const today = new Date().toISOString().slice(0, 10);
  const starts = assignment.active_from || "";
  const ends = assignment.active_until || "";
  return (!starts || starts <= today) && (!ends || ends >= today);
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

function vehicleQrUrl(vehicle) {
  const token = valueOf(vehicle, "qrToken", "qr_token") || vehicle.id;
  return `https://fleet.simplicity2take.com/?vehicle=${encodeURIComponent(token)}`;
}

function requestedVehicleToken() {
  return new URLSearchParams(window.location.search).get("vehicle")?.trim() || "";
}

async function openRequestedVehicle() {
  const token = requestedVehicleToken();
  if (!token) return;
  const vehicle = state.vehicles.find(item =>
    String(item.qrToken || "").toLowerCase() === token.toLowerCase() ||
    String(item.id) === token
  );
  if (!vehicle) { showToast("QR de viatura não reconhecido."); return; }
  const user = currentUser();
  if (user.role === "driver" && !vehicle.driverIds.includes(user.driverId)) {
    showToast("Esta viatura não está atribuída à sua conta.");
    return;
  }
  state.requestedVehicleId = vehicle.id;
  state.activeView = "vehicles";
  showToast(`Viatura ${vehicle.plate} reconhecida. A carregar os dados autorizados.`);
}

function showVehicleQr(vehicleId) {
  const vehicle = state.vehicles.find(item => item.id === vehicleId);
  if (!vehicle) return;
  const modal = $("#qrModal");
  const target = $("#qrCode");
  target.innerHTML = "";
  $("#qrTitle").textContent = `QR · ${vehicle.plate}`;
  $("#qrCaption").textContent = `QR permanente de ${vehicle.plate}. O endereço fica associado à viatura, independentemente do motorista.`;
  new QRCode(target, { text: vehicleQrUrl(vehicle), width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
  modal.showModal();
}

function driverDocuments() {
  const driverId = currentUser().driverId;
  const assignedVehicleIds = new Set(driverVehicles().map(vehicle => vehicle.id));
  return state.documents.filter(doc =>
    (doc.driverId === driverId) ||
    (doc.vehicleId && assignedVehicleIds.has(doc.vehicleId)) ||
    (!doc.driverId && doc.viewerDriverIds.includes(driverId))
  );
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
  if (!doc.expiryDate) return "Sem validade";
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
    const value = identifier.trim();
    let data;
    let error;

    if (value.includes("@")) {
      ({ data, error } = await supabaseClient.auth.signInWithPassword({
        email: value.toLowerCase(),
        password
      }));
    } else {
      const response = await supabaseClient.functions.invoke("driver-login", {
        body: { phone: value, password }
      });
      if (response.error) throw response.error;
      const result = response.data;
      if (!result?.access_token || !result?.refresh_token) {
        throw new Error(result?.error || "Sessão inválida.");
      }
      const sessionResult = await supabaseClient.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token
      });
      data = sessionResult.data;
      error = sessionResult.error;
    }

    if (error || !data?.user) throw error || new Error("Sessão inválida.");
    await startAuthenticatedSession(data.user);
  } catch (error) {
    console.error(error);
    showToast("Email/telemóvel ou palavra-passe inválidos.");
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
  await openRequestedVehicle();
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
  const missingExpiry = state.documents.filter(doc => alertLevel(doc) === "Sem validade").length;
  const max = Math.max(state.drivers.length, state.vehicles.length, state.documents.length, expiring, expired, missingExpiry, 1);
  selectors.content.innerHTML = `
    <section class="status-strip">
      ${metric("Total de motoristas", state.drivers.length)}
      ${metric("Total de veículos", state.vehicles.length)}
      ${metric("Total de documentos", state.documents.length)}
      ${metric("Documentos a expirar", expiring)}
      ${metric("Documentos expirados", expired)}
      ${metric("Sem validade", missingExpiry)}
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
          ${bar("Sem validade", missingExpiry, max)}
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
  const requested = vehicles.find(vehicle => vehicle.id === state.requestedVehicleId);
  selectors.pageTitle.textContent = admin ? "Veículos" : "Meus Veículos";
  selectors.content.innerHTML = `
    ${heading(admin ? "Gestão de veículos" : "Veículos atribuídos", admin ? "Criar, editar e eliminar veículos." : "Consulta dos veículos que lhe foram atribuídos.", admin ? `<button class="primary-button" type="button" data-open="vehicle">Criar veículo</button>` : "")}
    ${requested ? vehicleAccessPanel(requested, admin) : ""}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Matrícula</th><th>Marca / Modelo</th><th>Ano</th><th>VIN</th><th>Estado</th><th>Motoristas</th><th>Ações</th></tr></thead>
        <tbody>${vehicles.map(vehicle => vehicleRow(vehicle, admin)).join("") || emptyRow("Sem veículos para apresentar.")}</tbody>
      </table>
    </div>
  `;
}
function vehicleAccessPanel(vehicle, admin) {
  const docs = state.documents.filter(doc => doc.vehicleId === vehicle.id && (admin || driverDocuments().some(item => item.id === doc.id)));
  return `
    <article class="panel vehicle-access-panel">
      <div class="panel-heading"><div><span class="eyebrow">QR da viatura</span><h2>${escapeHtml(vehicle.plate)}</h2><p class="section-copy">${escapeHtml(vehicle.brand)} ${escapeHtml(vehicle.model)} · VIN ${escapeHtml(vehicle.vin || "—")}</p></div><span class="tag ${vehicle.status === "Ativo" ? "active" : "expiring"}">${escapeHtml(vehicle.status)}</span></div>
      <h3>Documentos autorizados</h3>
      <div class="cards-grid">${docs.map(doc => documentCard(doc, admin)).join("") || emptyCard("Não existem documentos autorizados para esta viatura.")}</div>
    </article>
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
      <td>${admin ? `<div class="row-actions"><button class="mini-button" type="button" data-qr-vehicle="${vehicle.id}">QR</button><button class="mini-button" type="button" data-edit-vehicle="${vehicle.id}">Editar</button><button class="danger-button" type="button" data-delete-vehicle="${vehicle.id}">Eliminar</button></div>` : "Consulta"}</td>
    </tr>
  `;
}

function renderDrivers() {
  selectors.pageTitle.textContent = "Motoristas";
  selectors.content.innerHTML = `
    ${heading("Gestão de motoristas", "Criar, editar, eliminar e definir palavras-passe. O administrador entrega a palavra-passe diretamente ao motorista.", `<button class="primary-button" type="button" data-open="driver">Criar motorista</button>`)}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nome completo</th><th>Email</th><th>Telemóvel</th><th>Estado</th><th>Documentos</th><th>Ações</th></tr></thead>
        <tbody>${state.drivers.map(driverRow).join("")}</tbody>
      </table>
    </div>
  `;
}

function driverRow(driver) {
  const assignedVehicleIds = new Set(state.vehicles.filter(vehicle => vehicle.driverIds.includes(driver.id)).map(vehicle => vehicle.id));
  const docs = state.documents.filter(doc => doc.driverId === driver.id || (doc.vehicleId && assignedVehicleIds.has(doc.vehicleId)) || (!doc.driverId && doc.viewerDriverIds.includes(driver.id)));
  return `
    <tr>
      <td><strong>${escapeHtml(driver.name)}</strong></td>
      <td>${escapeHtml(driver.email)}</td>
      <td>${escapeHtml(driver.phone)}</td>
      <td><span class="tag ${driver.status === "Ativo" ? "active" : "inactive"}">${escapeHtml(driver.status)}</span></td>
      <td><span class="tag">${docs.length} docs</span></td>
      <td><div class="row-actions"><button class="mini-button" type="button" data-doc-driver="${driver.id}">Documento</button><button class="mini-button" type="button" data-edit-driver="${driver.id}">Editar</button><button class="mini-button" type="button" data-reset-password="${driver.id}">Definir passe</button><button class="danger-button" type="button" data-delete-driver="${driver.id}">Eliminar</button></div></td>
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
      <span class="tag ${level === "Expirado" ? "inactive" : level === "OK" ? "active" : level === "Sem validade" ? "" : "expiring"}">${escapeHtml(level)}</span>
      <h3>${escapeHtml(doc.name)}</h3>
      <div class="meta-line">
        <span>${escapeHtml(doc.type)}</span>
        <span>${escapeHtml(doc.number || "Sem número")}</span>
        <span>Validade: ${escapeHtml(doc.expiryDate)}</span>
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
  const alerts = state.documents.filter(doc => ["Expirado", "3 dias", "7 dias", "15 dias", "30 dias"].includes(alertLevel(doc)));
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
        <div class="panel-heading"><h2>Integrações</h2><span class="tag">Preparado</span></div>
        <div class="settings-list">
          <div class="settings-row"><strong>Google Drive</strong><span class="tag expiring">Configuração pendente</span></div>
          <div class="settings-row"><strong>S2T SmartDocs</strong><span class="tag active">Ativo no Portal</span></div>
          <div class="settings-row"><strong>Cartrack</strong><span class="tag">Preparado</span></div>
          <div class="settings-row"><strong>Gestão de Revisões</strong><span class="tag">Preparado</span></div>
          <div class="settings-row"><strong>Gestão de Inspeções</strong><span class="tag">Preparado</span></div>
          <div class="settings-row"><strong>Aplicação Android</strong><span class="tag">Preparado</span></div>
          <div class="settings-row"><strong>Aplicação iPhone</strong><span class="tag">Preparado</span></div>
        </div>
        <div class="integration-note">
          <strong>Estrutura preparada</strong>
          <p>O Portal já sabe classificar documentos e separar Motoristas e Veículos. A ligação efetiva ao Google Drive será ativada depois de configurar as credenciais no servidor.</p>
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
    ${heading("Minha Conta", user.role === "admin" ? "Pode alterar a sua palavra-passe." : "Se se esquecer da palavra-passe, peça uma nova ao administrador.", user.role === "admin" ? `<button class="primary-button" type="button" data-open="password">Alterar palavra-passe</button>` : `<button class="secondary-button" type="button" data-request-password>Copiar mensagem ao administrador</button>`)}
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
  const title = { driver: "motorista", vehicle: "veículo", document: "documento", "admin-password": "palavra-passe do motorista" }[type];
  const action = type === "admin-password" ? "Definir" : id && type !== "document" ? "Editar" : type === "document" ? "Carregar" : "Criar";
  selectors.modalTitle.textContent = `${action} ${title}`;
  selectors.modalFields.innerHTML = modalFields(type, id);
  selectors.modal.showModal();
  if (type === "document") wireSmartDocsUpload();
}

function modalFields(type, id) {
  if (type === "driver") {
    const driver = state.drivers.find(item => item.id === id) || {};
    const setupPassword = !id ? `<div class="smartdocs-box span-full"><strong>Acesso do motorista</strong><p>Defina a palavra-passe e entregue-a diretamente ao motorista.</p></div>${field("password", "Palavra-passe inicial", "", "password", true)}${field("passwordConfirm", "Confirmar palavra-passe", "", "password", true)}` : "";
    return [
      field("name", "Nome completo", driver.name),
      field("email", "Email", driver.email, "email"),
      field("phone", "Telemóvel", driver.phone, "tel"),
      selectField("status", "Estado", ["Ativo", "Inativo"], driver.status || "Ativo"), setupPassword
    ].join("");
  }

  if (type === "admin-password") {
    const driver = state.drivers.find(item => item.id === id) || {};
    return [`<div class="smartdocs-box span-full"><strong>Administrador</strong><p>Defina uma nova palavra-passe para ${escapeHtml(driver.name || "o motorista")}. Entregue-a diretamente ao motorista.</p></div>`, field("password", "Nova palavra-passe", "", "password", true), field("passwordConfirm", "Confirmar palavra-passe", "", "password", true)].join("");
  }
  if (type === "vehicle") {
    const vehicle = state.vehicles.find(item => item.id === id) || {};
    return [
      field("plate", "Matrícula", vehicle.plate),
      field("brand", "Marca", vehicle.brand),
      field("model", "Modelo", vehicle.model),
      field("year", "Ano", vehicle.year, "number"),
      field("vin", "VIN", vehicle.vin, "text", false),
      selectField("status", "Estado", ["Ativo", "Manutenção", "Inativo"], vehicle.status || "Ativo"),
      checkList("driverIds", "Motoristas atribuídos", state.drivers, vehicle.driverIds || [])
    ].join("");
  }
  if (type === "password") {
    return [field("password", "Nova palavra-passe", "", "password", true)].join("");
  }

  const doc = state.documents.find(item => item.id === id) || {};
  const selectedDriver = doc.driverId || "";
  const selectedVehicle = doc.vehicleId || "";
  const privateDriverDoc = Boolean(selectedDriver);
  return `
    <div class="smartdocs-box span-full">
      <strong>S2T SmartDocs</strong>
      <p>Carregue um PDF ou imagem. O documento pode ficar associado a um motorista (privado) ou a um veículo (partilhável com os motoristas autorizados desse veículo).</p>
    </div>
    ${field("file", "Ficheiro original", "", "file", true, 'accept=".pdf,.jpg,.jpeg,.png"')}
    <div class="smart-preview span-full" id="smartPreview">Pré-visualização SmartDocs ainda sem ficheiro.</div>
    ${field("name", "Nome do documento", doc.name)}
    ${selectField("type", "Tipo", documentTypes, doc.type || "Carta de Condução")}
    ${field("number", "Número do documento", doc.number)}
    ${field("expiryDate", "Data de validade", doc.expiryDate, "date")}
    ${selectField("driverId", "Motorista associado (privado)", [["", "Sem motorista"], ...state.drivers.map(driver => [driver.id, driver.name])], selectedDriver, false)}
    ${selectField("vehicleId", "Veículo associado", [["", "Sem veículo"], ...state.vehicles.map(vehicle => [vehicle.id, vehicle.plate + " — " + vehicle.brand + " " + vehicle.model])], selectedVehicle, false)}
    ${checkList("viewerDriverIds", "Visualização adicional (apenas documentos sem motorista)", state.drivers, privateDriverDoc ? [] : (doc.viewerDriverIds || []))}
  `;
}

function field(name, label, value = "", type = "text", span = false, extra = "") {
  const required = type === "file" ? "" : "required";
  return `<label class="${span ? "span-full" : ""}">${label}<input name="${name}" type="${type}" value="${type === "file" ? "" : escapeHtml(value)}" ${extra} ${required}></label>`;
}

function selectField(name, label, options, value, required = true) {
  const normalized = options.map(option => Array.isArray(option) ? option : [option, option]);
  return `<label>${label}<select name="${name}" ${required ? "required" : ""}>${normalized.map(([optionValue, optionLabel]) => `<option value="${escapeHtml(optionValue)}" ${optionValue === value ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`).join("")}</select></label>`;
}

function checkList(name, label, items, selected) {
  return `
    <fieldset class="check-list span-full">
      <legend>${label}</legend>
      ${items.map(item => `<label><input type="checkbox" name="${name}" value="${item.id}" ${selected.includes(item.id) ? "checked" : ""}>${escapeHtml(item.name)}</label>`).join("")}
    </fieldset>
  `;
}

function smartDateFromFilename(fileName) {
  const matches = [
    fileName.match(/(?:^|[^0-9])(20\\d{2})[-_](0[1-9]|1[0-2])[-_](0[1-9]|[12]\\d|3[01])(?:[^0-9]|$)/),
    fileName.match(/(?:^|[^0-9])(0[1-9]|[12]\\d|3[01])[-_](0[1-9]|1[0-2])[-_](20\\d{2})(?:[^0-9]|$)/)
  ];
  if (matches[0]) return `${matches[0][1]}-${matches[0][2]}-${matches[0][3]}`;
  if (matches[1]) return `${matches[1][3]}-${matches[1][2]}-${matches[1][1]}`;
  return "";
}

function normalizePlate(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function findVehicleFromFilename(fileName) {
  const normalized = normalizePlate(fileName);
  return state.vehicles.find(vehicle => {
    const plate = normalizePlate(vehicle.plate);
    return plate && normalized.includes(plate);
  }) || null;
}

function findDriverFromFilename(fileName) {
  const normalized = normalizeText(fileName);
  return state.drivers
    .filter(driver => driver.name)
    .sort((a, b) => b.name.length - a.name.length)
    .find(driver => normalized.includes(normalizeText(driver.name))) || null;
}

function smartDocumentScope(fileName, type, driver, vehicle) {
  const text = normalizeText(fileName);
  const privateKeywords = ["contrato", "contratacao", "prestacao", "cartao cidadao", "carta conducao"];
  if (driver && (type === "Contrato" || privateKeywords.some(keyword => text.includes(keyword)))) return "driver";
  if (vehicle) return "vehicle";
  if (driver) return "driver";
  return "unassigned";
}

function analyseFileName(fileName) {
  const text = normalizeText(fileName);
  const type = documentTypes.find(item => {
    const normalizedType = normalizeText(item);
    return text.includes(normalizedType) || text.includes(normalizedType.replaceAll(" ", ""));
  }) || (
    text.includes("ipo") ? "IPO" :
    text.includes("seguro") || text.includes("apolice") ? "Seguro" :
    text.includes("carta verde") || text.includes("carta-verde") ? "Carta Verde" :
    text.includes("licenca") || text.includes("tvde") ? "Licença TVDE" :
    text.includes("cartao cidadao") || text.includes("cartao-cidadao") ? "Cartão de Cidadão" :
    text.includes("carta conducao") || text.includes("carta") ? "Carta de Condução" :
    text.includes("dua") || text.includes("livrete") ? "DUA" :
    "Outros"
  );
  const vehicle = findVehicleFromFilename(fileName);
  const driver = findDriverFromFilename(fileName);
  const expiryDate = smartDateFromFilename(fileName);
  const scope = smartDocumentScope(fileName, type, driver, vehicle);
  return {
    type,
    expiryDate,
    vehicleId: scope === "vehicle" ? vehicle?.id || "" : "",
    driverId: scope === "driver" ? driver?.id || "" : "",
    vehicle,
    driver,
    scope,
    name: fileName.replace(/\\.[^.]+$/, "").replace(/[_-]+/g, " ").trim()
  };
}

function applySmartPreview(preview) {
  const setValue = (name, value) => {
    const input = selectors.modalFields.querySelector(`[name="${name}"]`);
    if (input && value) input.value = value;
  };
  setValue("type", preview.type);
  setValue("name", preview.name);
  setValue("expiryDate", preview.expiryDate);
  setValue("vehicleId", preview.vehicleId);
  setValue("driverId", preview.driverId);
  const vehicleLabel = preview.vehicle ? preview.vehicle.plate : "não identificado";
  const driverLabel = preview.driver ? preview.driver.name : "não identificado";
  const scopeLabel = preview.scope === "driver" ? "Privado do motorista" : preview.scope === "vehicle" ? "Documento da viatura" : "Sem associação automática";
  $("#smartPreview").innerHTML = `
    <strong>S2T SmartDocs — classificação automática</strong>
    <dl>
      <dt>Tipo:</dt><dd>${escapeHtml(preview.type)}</dd>
      <dt>Motorista:</dt><dd>${escapeHtml(driverLabel)}</dd>
      <dt>Viatura:</dt><dd>${escapeHtml(vehicleLabel)}</dd>
      <dt>Validade:</dt><dd>${escapeHtml(preview.expiryDate || "não encontrada")}</dd>
      <dt>Acesso:</dt><dd>${escapeHtml(scopeLabel)}</dd>
    </dl>
    <small>Confirma sempre os campos antes de guardar. Um contrato/documento de motorista nunca é associado automaticamente à viatura.</small>
  `;
}

function wireSmartDocsUpload() {
  const fileInput = selectors.modalFields.querySelector('input[name="file"]');
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    state.smartPreview = analyseFileName(file.name);
    applySmartPreview(state.smartPreview);
  });
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
    if (type === "admin-password") await saveAdminPassword(id, values.password, values.passwordConfirm);
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
  const payload = {
    full_name: values.name,
    email: values.email,
    phone: values.phone,
    status: values.status
  };

  if (!id) {
    if (!values.password || values.password.length < 8) throw new Error("Use pelo menos 8 caracteres na palavra-passe inicial.");
    if (values.password !== values.passwordConfirm) throw new Error("As palavras-passe não coincidem.");
    const { data, error } = await supabaseClient.functions.invoke("admin-create-driver", { body: { fullName: values.name, email: values.email, phone: values.phone, status: values.status, password: values.password } });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "Não foi possível criar o motorista.");
    showToast("Motorista criado. Entregue a palavra-passe diretamente.");
    return;
  }
  const { error } = await supabaseClient.from("drivers").update(payload).eq("id", id);

  if (error) throw error;
  showToast("Motorista atualizado.");
}

async function saveVehicle(values, driverIds, id) {
  const payload = {
    plate: values.plate.toUpperCase(),
    brand: values.brand,
    model: values.model,
    vehicle_year: Number(values.year),
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
      driverIds.map(driverId => ({ vehicle_id: vehicleId, driver_id: driverId, active_from: new Date().toISOString().slice(0, 10), active_until: null }))
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
        folderType: values.driverId ? "drivers" : "documents",
        folderName: values.driverId
          ? (state.drivers.find(driver => driver.id === values.driverId)?.name || "Sem nome")
          : (state.vehicles.find(vehicle => vehicle.id === values.vehicleId)?.plate || "Sem viatura"),
        documentType: values.type
      }
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "Falha ao guardar no Google Drive.");
    driveData = data;
  }
  if (!driveData) throw new Error("Selecione um ficheiro.");

  if (values.driverId && values.vehicleId) {
    throw new Error("Um documento privado de motorista não pode estar simultaneamente associado a um veículo.");
  }

  const payload = {
    name: values.name,
    document_type: values.type,
    document_number: values.number,
    policy_number: null,
    issue_date: null,
    expiry_date: values.expiryDate || null,
    observations: null,
    original_file_name: driveData.fileName,
    mime_type: driveData.mimeType,
    drive_file_id: driveData.fileId,
    drive_web_view_link: driveData.webViewLink,
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

async function fetchDocumentBlob(documentId) {
  const doc = state.documents.find(item => item.id === documentId);
  if (!doc) throw new Error("Documento não encontrado.");

  const cached = documentBlobCache.get(documentId);
  if (cached) return { doc, data: cached };

  const { data, error } = await supabaseClient.functions.invoke("document-access", {
    body: { document_id: documentId }
  });

  if (error) throw error;
  if (!(data instanceof Blob)) throw new Error("Não foi possível obter o documento.");

  documentBlobCache.set(documentId, data);
  return { doc, data };
}

async function openDocument(documentId) {
  const modal = document.querySelector("#documentViewerModal");
  const title = document.querySelector("#documentViewerTitle");
  const content = document.querySelector("#documentViewerContent");

  if (!modal || !title || !content) {
    throw new Error("Visualizador de documentos indisponível.");
  }

  const doc = state.documents.find(item => item.id === documentId);
  title.textContent = doc?.fileName || doc?.name || "Documento";
  content.innerHTML = '<div class="document-viewer-loading">A abrir documento…</div>';
  modal.showModal();

  try {
    const result = await fetchDocumentBlob(documentId);
    const data = result.data;
    title.textContent = result.doc.fileName || result.doc.name || "Documento";
    content.replaceChildren();

    const url = URL.createObjectURL(data);
    const mimeType = data.type || result.doc.fileType || "";

  if (mimeType === "application/pdf") {
    const frame = document.createElement("iframe");
    frame.src = url + "#toolbar=1&navpanes=0&scrollbar=1";
    frame.title = doc.fileName || doc.name || "Documento PDF";
    frame.className = "document-viewer-frame";
    frame.setAttribute("allow", "fullscreen");
    content.appendChild(frame);
  } else if (mimeType.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = doc.fileName || doc.name || "Documento";
    image.className = "document-viewer-image";
    content.appendChild(image);
  } else {
    URL.revokeObjectURL(url);
    throw new Error("Este tipo de documento não pode ser visualizado diretamente.");
  }

  modal.showModal();
    modal.addEventListener("close", () => URL.revokeObjectURL(url), { once: true });
  } catch (error) {
    if (modal.open) modal.close();
    throw error;
  }
}

async function downloadDocument(documentId) {
  const { doc, data } = await fetchDocumentBlob(documentId);
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");

  link.href = url;
  link.download = doc.fileName || doc.name || "documento";
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function savePassword(password) {
  const { error } = await supabaseClient.auth.updateUser({ password });
  if (error) throw error;
  showToast("Palavra-passe alterada.");
}

async function copyPasswordRequest() {
  const message = "Olá. Esqueci-me da minha palavra-passe da Simplicity2Take Fleet. Pode definir uma nova, por favor?";
  try { await navigator.clipboard.writeText(message); showToast("Mensagem copiada. Envie-a ao administrador."); } catch { showToast(message); }
}

async function saveAdminPassword(driverId, password, confirmation) {
  if (currentUser().role !== "admin") throw new Error("Só o administrador pode definir palavras-passe.");
  if (!password || password.length < 8) throw new Error("Use pelo menos 8 caracteres na palavra-passe.");
  if (password !== confirmation) throw new Error("As palavras-passe não coincidem.");
  const { error } = await supabaseClient.functions.invoke("admin-reset-driver-password", {
    body: { driverId, password }
  });
  if (error) throw error;
  showToast("Palavra-passe do motorista alterada.");
}
async function handleAdminAction(action) {
  try {
    if (action.type === "delete-document") {
      if (!confirm("Eliminar este documento do portal?")) return;
      const { error } = await supabaseClient.from("documents").delete().eq("id", action.id);
      if (error) throw error;
      await loadBackendData(); renderApp(); showToast("Documento eliminado.");
    }
    if (action.type === "delete-vehicle") {
      if (!confirm("Eliminar esta viatura do portal?")) return;
      await supabaseClient.from("vehicle_assignments").delete().eq("vehicle_id", action.id);
      const { error } = await supabaseClient.from("vehicles").delete().eq("id", action.id);
      if (error) throw error;
      await loadBackendData(); renderApp(); showToast("Viatura eliminada.");
    }
    if (action.type === "delete-driver") {
      if (!confirm("Desativar este motorista? O histórico documental será preservado.")) return;
      const { error } = await supabaseClient.from("drivers").update({ status: "Inativo" }).eq("id", action.id);
      if (error) throw error;
      await loadBackendData(); renderApp(); showToast("Motorista desativado.");
    }
  } catch (error) {
    console.error(error);
    showToast(error?.message || "Não foi possível concluir a operação.");
  }
}

function printQr() {
  const title = document.querySelector("#qrTitle")?.textContent || "QR da viatura";
  const qr = document.querySelector("#qrCode")?.innerHTML || "";
  const win = window.open("", "_blank", "width=500,height=700");
  if (!win) { showToast("Permita janelas pop-up para imprimir o QR."); return; }
  win.document.write("<!doctype html><html><head><title>"+escapeHtml(title)+"</title><style>body{font-family:Arial;text-align:center;padding:40px}img{width:280px;height:280px}</style></head><body><h1>"+escapeHtml(title)+"</h1>"+qr+"<p>Simplicity2Take Portal</p><script>window.onload=()=>window.print()<\\/script></body></html>");
  win.document.close();
}

function bindPortalEvents() {
  selectors.loginForm?.addEventListener("submit", event => {
    event.preventDefault();
    login(selectors.loginIdentifier.value, selectors.loginPassword.value);
  });

  document.addEventListener("click", async event => {
    const target = event.target.closest("button,[data-view],[data-open],[data-qr-vehicle],[data-open-doc],[data-download-doc],[data-edit-driver],[data-edit-vehicle],[data-edit-document],[data-reset-password],[data-delete-driver],[data-delete-vehicle],[data-delete-document],[data-request-password]");
    if (!target) return;

    const view = target.dataset.view;
    if (view) return setView(view);
    if (target.dataset.open) return openModal(target.dataset.open);
    if (target.dataset.qrVehicle) return showVehicleQr(target.dataset.qrVehicle);
    if (target.dataset.openDoc) {
      try { await openDocument(target.dataset.openDoc); } catch (error) { console.error(error); showToast(error?.message || "Não foi possível abrir o documento."); }
      return;
    }
    if (target.dataset.downloadDoc) {
      try { await downloadDocument(target.dataset.downloadDoc); } catch (error) { console.error(error); showToast(error?.message || "Não foi possível descarregar o documento."); }
      return;
    }
    if (target.id === "closeDocumentViewer") {
      return document.querySelector("#documentViewerModal")?.close();
    }
    if (target.dataset.editDriver) return openModal("driver", target.dataset.editDriver);
    if (target.dataset.editVehicle) return openModal("vehicle", target.dataset.editVehicle);
    if (target.dataset.editDocument) return openModal("document", target.dataset.editDocument);
    if (target.dataset.resetPassword) return openModal("admin-password", target.dataset.resetPassword);
    if (target.dataset.deleteDriver) return handleAdminAction({type:"delete-driver",id:target.dataset.deleteDriver});
    if (target.dataset.deleteVehicle) return handleAdminAction({type:"delete-vehicle",id:target.dataset.deleteVehicle});
    if (target.dataset.deleteDocument) return handleAdminAction({type:"delete-document",id:target.dataset.deleteDocument});
    if (target.dataset.requestPassword) return copyPasswordRequest();
    if (target.id === "logoutButton") return logout();
    if (target.id === "workWithUsButton") return openRecruitment();
    if (target.id === "backToLoginButton") return closeRecruitment();
    if (target.id === "closeModal" || target.id === "cancelModal") return selectors.modal?.close();
    if (target.id === "closeQrModal") return document.querySelector("#qrModal")?.close();
    if (target.id === "printQrButton") return printQr();
  });

  selectors.form?.addEventListener("submit", submitModal);
  selectors.recruiterForm?.addEventListener("submit", event => {
    event.preventDefault();
    answerRecruiter(selectors.recruiterInput.value);
    selectors.recruiterInput.value = "";
    selectors.recruiterInput.focus();
  });
  selectors.candidateDocuments?.addEventListener("change", event => {
    const files = [...(event.target.files || [])];
    state.recruiterSession.documents = files.map(file => file.name);
    if (files.length) addRecruiterMessage("assistant", `${files.length} documento(s) recebido(s): ${files.map(file => file.name).join(", ")}. Quando estiver pronto, escreva Confirmar.`);
  });

  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      state.sessionUserId = null;
      state.profile = null;
      selectors.appShell.classList.add("hidden");
      selectors.loginScreen.classList.remove("hidden");
    }
  });

  supabaseClient.auth.getSession().then(async ({ data }) => {
    if (data.session?.user) {
      try { await startAuthenticatedSession(data.session.user); }
      catch (error) { console.error(error); showToast(error?.message || "Não foi possível restaurar a sessão."); }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderLogin();
  bindPortalEvents();
});
