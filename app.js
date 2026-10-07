const documentBlobCache = new Map();

const state = {
  sessionUserId: null,
  profile: null,
  backendReady: false,
  activeView: "dashboard",
  editing: null,
  smartPreview: null,
  requestedVehicleId: null,
  documentContext: "company",
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
  recruiterSession: null,
  activityEvents: [],
  tripRecords: [],
  cartrackVehicles: [],
  cartrackSnapshots: []
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
  admin: [["dashboard", "Dashboard", "DB"], ["vehicles", "Veículos", "VE"], ["drivers", "Motoristas", "MO"], ["activity", "Utilização", "UT"], ["documents", "Documentos da Empresa", "DO"], ["applications", "Candidaturas", "AI"], ["alerts", "Alertas", "AL"], ["settings", "Configurações", "CO"]],
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
  const [driversResult, vehiclesResult, assignmentsResult, documentsResult, viewersResult, applicationsResult, activityResult, tripsResult, cartrackVehiclesResult, cartrackSnapshotsResult] = await Promise.all([
    supabaseClient.from("drivers").select("*"),
    supabaseClient.from("vehicles").select("*"),
    supabaseClient.from("vehicle_assignments").select("*"),
    supabaseClient.from("documents").select("*"),
    supabaseClient.from("document_viewers").select("*"),
    supabaseClient.from("applications").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("platform_activity_events").select("*").eq("platform", "bolt").order("observed_at", { ascending: false }).limit(5000),
    supabaseClient.from("platform_trip_records").select("*").eq("platform", "bolt").order("observed_at", { ascending: false }).limit(5000),
    supabaseClient.from("cartrack_vehicles").select("*").order("registration"),
    supabaseClient.from("cartrack_vehicle_snapshots").select("*").order("observed_at", { ascending: false }).limit(5000)
  ]);

  const firstError = [driversResult, vehiclesResult, assignmentsResult, documentsResult, viewersResult, activityResult, tripsResult, cartrackVehiclesResult, cartrackSnapshotsResult].find(result => result.error)?.error;
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
    boltDriverUuid: valueOf(row, "bolt_driver_uuid"),
    boltPartnerUuid: valueOf(row, "bolt_partner_uuid"),
    boltLastSyncedAt: valueOf(row, "bolt_last_synced_at"),
    uberDriverUuid: valueOf(row, "uber_driver_uuid"),
    uberLastSyncedAt: valueOf(row, "uber_last_synced_at"),
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
    boltVehicleUuid: valueOf(row, "bolt_vehicle_uuid"),
    boltLastSyncedAt: valueOf(row, "bolt_last_synced_at"),
    uberVehicleUuid: valueOf(row, "uber_vehicle_uuid"),
    uberVehicleEncryptedUuid: valueOf(row, "uber_vehicle_encrypted_uuid"),
    uberLastSyncedAt: valueOf(row, "uber_last_synced_at"),
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
  state.activityEvents = (activityResult.data || []).map(row => ({
    id: row.id, driverId: row.driver_id, vehicleId: row.vehicle_id,
    driverUuid: row.platform_driver_uuid, vehicleUuid: row.platform_vehicle_uuid,
    status: row.status, observedAt: row.observed_at, eventKey: row.event_key
  }));
  state.cartrackVehicles = (cartrackVehiclesResult.data || []).map(row => ({
    registration: row.registration,
    vehicleId: row.vehicle_id,
    odometerKm: row.odometer_km,
    speedKmh: row.speed_kmh,
    ignition: row.ignition,
    idling: row.idling,
    eventTs: row.event_ts,
    lastSyncedAt: row.last_synced_at
  }));
  state.cartrackSnapshots = (cartrackSnapshotsResult.data || []).map(row => ({
    registration: row.registration,
    vehicleId: row.vehicle_id,
    observedAt: row.observed_at,
    odometerKm: row.odometer_km,
    speedKmh: row.speed_kmh,
    ignition: row.ignition,
    idling: row.idling
  }));
  state.tripRecords = (tripsResult.data || []).map(row => ({
    id: row.id, sourceTripId: row.source_trip_id, driverId: row.driver_id, vehicleId: row.vehicle_id,
    driverUuid: row.platform_driver_uuid, vehicleUuid: row.platform_vehicle_uuid, plate: row.vehicle_plate,
    status: row.order_status, acceptedAt: row.accepted_at, pickupAt: row.pickup_at,
    dropoffAt: row.dropoff_at, finishedAt: row.finished_at, distance: row.ride_distance_km, observedAt: row.observed_at
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
  return `https://fleet.simplicity2take.com/?vehicle=${encodeURIComponent(token)}&mode=driver`;
}

function requestedVehicleToken() {
  return new URLSearchParams(window.location.search).get("vehicle")?.trim() || "";
}

function isVehicleQrMode() {
  return new URLSearchParams(window.location.search).get("mode") === "driver" && Boolean(requestedVehicleToken());
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

function companyDocuments() {
  return state.documents.filter(doc => !doc.driverId && !doc.vehicleId);
}

function driverDocuments() {
  const driverId = currentUser().driverId;
  return state.documents.filter(doc => doc.driverId === driverId);
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
  const user = currentUser();
  if (user.role === "admin") return state.documents;

  const assignedVehicleIds = new Set(driverVehicles().map(vehicle => vehicle.id));
  return state.documents.filter(doc =>
    doc.driverId === user.driverId ||
    (doc.vehicleId && assignedVehicleIds.has(doc.vehicleId))
  );
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
  if (isVehicleQrMode() && profile.role !== "driver") {
    await supabaseClient.auth.signOut();
    throw new Error("Este QR é exclusivo para acesso de motorista.");
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
    activity: renderActivity,
    account: renderAccount
  };
  views[state.activeView]();
}

function renderDashboard() {
  selectors.pageTitle.textContent = "Dashboard";

  const companyDocs = companyDocuments();
  const vehicleDocs = state.documents.filter(doc => Boolean(doc.vehicleId));
  const driverDocs = state.documents.filter(doc => Boolean(doc.driverId));

  const expiring = state.documents.filter(doc => ["30 dias", "15 dias", "7 dias", "3 dias"].includes(alertLevel(doc)));
  const expired = state.documents.filter(doc => alertLevel(doc) === "Expirado");
  const missingExpiry = state.documents.filter(doc => alertLevel(doc) === "Sem validade");

  const max = Math.max(
    state.drivers.length,
    state.vehicles.length,
    companyDocs.length,
    vehicleDocs.length,
    driverDocs.length,
    expiring.length,
    expired.length,
    missingExpiry.length,
    1
  );

  selectors.content.innerHTML = `
    <section class="status-strip">
      ${metric("Total de motoristas", state.drivers.length)}
      ${metric("Total de veículos", state.vehicles.length)}
      ${metric("Documentos da empresa", companyDocs.length)}
      ${metric("Documentos das viaturas", vehicleDocs.length)}
      ${metric("Documentos dos motoristas", driverDocs.length)}
      ${metric("A expirar", expiring.length)}
      ${metric("Expirados", expired.length)}
      ${metric("Sem validade", missingExpiry.length)}
    </section>

    <section class="content-grid">
      <article class="panel">
        <div class="panel-heading">
          <h2>Resumo documental</h2>
          <span class="tag active">Atualizado</span>
        </div>
        <div class="bar-chart">
          ${bar("Empresa", companyDocs.length, max)}
          ${bar("Viaturas", vehicleDocs.length, max)}
          ${bar("Motoristas", driverDocs.length, max)}
          ${bar("A expirar", expiring.length, max)}
          ${bar("Expirados", expired.length, max)}
          ${bar("Sem validade", missingExpiry.length, max)}
        </div>
      </article>

      <article class="panel">
        <div class="panel-heading">
          <h2>S2T SmartDocs</h2>
          <span class="tag">IA preparada</span>
        </div>
        <p class="section-copy">
          Carrega um PDF ou imagem e o sistema tenta identificar automaticamente
          o tipo e a validade. A informação é sempre confirmada pelo Administrador.
        </p>
        <div class="row-actions">
          <button class="primary-button" type="button" data-open="document">Carregar documento da empresa</button>
          <button class="secondary-button" type="button" data-view="alerts">Ver alertas</button>
        </div>
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

function vehicleDocumentSlot(vehicle, type, label) {
  const docs = state.documents.filter(doc => doc.vehicleId === vehicle.id);
  const doc = docs.find(item => item.type === type) || (type === "Seguro" ? docs.find(item => item.type === "Carta Verde") : null);
  if (!doc) {
    return `<div class="vehicle-document-slot missing">
      <div><strong>${escapeHtml(label)}</strong><small>Não carregado</small></div>
      ${currentUser().role === "admin" ? `<button class="mini-button" type="button" data-open-vehicle-doc="${vehicle.id}" data-doc-type="${escapeHtml(type)}">+ Documento</button>` : ""}
    </div>`;
  }
  const level = alertLevel(doc);
  const cls = level === "Expirado" ? "inactive" : level === "OK" ? "active" : level === "Sem validade" ? "" : "expiring";
  return `<div class="vehicle-document-slot">
    <div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(doc.name)}</small></div>
    <div class="vehicle-document-slot-actions">
      <span class="tag ${cls}">${escapeHtml(level)}</span>
      <button class="mini-button" type="button" data-open-doc="${doc.id}">Ver</button>
    </div>
  </div>`;
}

function vehicleDocumentsPanel(vehicle, compact = false) {
  const slots = [
    ["DUA", "DUA"],
    ["Seguro", "Seguro / Carta Verde"],
    ["IPO", "Inspeção (IPO)"],
    ["Licença TVDE", "Licença TVDE"],
    ["Outros", "Outros"]
  ];
  return `<div class="vehicle-documents-panel ${compact ? "compact" : ""}">
    <div class="panel-heading">
      <div><h3>Documentos da viatura</h3><p class="section-copy">Tudo fica associado a esta viatura.</p></div>
      ${currentUser().role === "admin" ? `<button class="mini-button" type="button" data-open-vehicle-doc="${vehicle.id}">+ Documento</button>` : ""}
    </div>
    <div class="vehicle-document-slots">
      ${slots.map(([type, label]) => vehicleDocumentSlot(vehicle, type, label)).join("")}
    </div>
  </div>`;
}

function renderVehicles() {
  const admin = currentUser().role === "admin";
  const vehicles = admin ? state.vehicles : driverVehicles();
  const requested = vehicles.find(vehicle => vehicle.id === state.requestedVehicleId);
  selectors.pageTitle.textContent = admin ? "Veículos" : "Meus Veículos";

  if (!admin) {
    selectors.content.innerHTML = `
      ${heading("Os meus veículos", "Aqui podes consultar os dados e todos os documentos das viaturas que te estão atribuídas.", "")}
      <section class="cards-grid">
        ${vehicles.map(vehicle => {
          return `
            <article class="data-card vehicle-driver-card">
              <div class="panel-heading">
                <div>
                  <span class="eyebrow">Viatura atribuída</span>
                  <h2>${escapeHtml(vehicle.plate)}</h2>
                  <p class="section-copy">${escapeHtml(vehicle.brand)} ${escapeHtml(vehicle.model)} · ${escapeHtml(vehicle.year || "—")}</p>
                </div>
                <span class="tag ${vehicle.status === "Ativo" ? "active" : "expiring"}">${escapeHtml(vehicle.status)}</span>
              </div>
              <div class="meta-line">
                <span>VIN: ${escapeHtml(vehicle.vin || "—")}</span>
              </div>
              ${vehicleDocumentsPanel(vehicle)}
            </article>
          `;
        }).join("") || emptyCard("Não tens nenhuma viatura atribuída.")}
      </section>
    `;
    return;
  }

  selectors.content.innerHTML = `
    ${heading("Gestão de veículos", "Criar, editar e eliminar veículos.", `<button class="primary-button" type="button" data-open="vehicle">Criar veículo</button>`)}
    ${requested ? vehicleAccessPanel(requested, admin) : ""}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Matrícula</th><th>Marca / Modelo</th><th>Ano</th><th>VIN</th><th>Estado</th><th>Motoristas</th><th>Documentos</th><th>Ações</th></tr></thead>
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
      ${vehicleDocumentsPanel(vehicle)}
    </article>
  `;
}

function vehicleRow(vehicle, admin) {
  const vehicleDocs = state.documents.filter(doc => doc.vehicleId === vehicle.id);
  const documentSummary = vehicleDocs.length
    ? vehicleDocs.map(doc => {
        const label = doc.type || "Documento";
        const level = alertLevel(doc);
        const cls = level === "Expirado" ? "inactive" : level === "OK" ? "active" : level === "Sem validade" ? "" : "expiring";
        return `
          <button class="document-mini-link" type="button" data-open-doc="${doc.id}" title="${escapeHtml(doc.name)} — validade: ${escapeHtml(doc.expiryDate || "sem validade")}">
            <span class="tag ${cls}">${escapeHtml(label)}</span>
          </button>
        `;
      }).join("")
    : '<span class="section-copy">Sem documentos</span>';

  return `
    <tr>
      <td><strong>${escapeHtml(vehicle.plate)}</strong></td>
      <td>${escapeHtml(vehicle.brand)} ${escapeHtml(vehicle.model)}</td>
      <td>${escapeHtml(vehicle.year)}</td>
      <td>${escapeHtml(vehicle.vin)}</td>
      <td><span class="tag ${vehicle.status === "Ativo" ? "active" : "expiring"}">${escapeHtml(vehicle.status)}</span></td>
      <td>${vehicle.driverIds.map(driverName).join(", ") || "Sem motorista"}</td>
      <td><div class="vehicle-document-links">${documentSummary}</div></td>
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
  const docs = state.documents.filter(doc => doc.driverId === driver.id);
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
  const documents = admin ? companyDocuments() : driverDocuments();
  selectors.pageTitle.textContent = admin ? "Documentos da Empresa" : "Meus Documentos";
  selectors.content.innerHTML = `
    ${heading(
      admin ? "Gestão documental da empresa" : "Os meus documentos",
      admin ? "Aqui ficam apenas os documentos da empresa. Documentos de viaturas e de motoristas são geridos nas respetivas áreas." : "Aqui ficam apenas os teus documentos pessoais/contratuais. Os documentos das viaturas estão em Meus Veículos.",
      admin ? `<button class="primary-button" type="button" data-open="document">Carregar documento da empresa</button>` : ""
    )}
    <section class="cards-grid">${documents.map(doc => documentCard(doc, admin)).join("") || emptyCard(admin ? "Ainda não existem documentos da empresa." : "Sem documentos para apresentar.")}</section>
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
        <span>${doc.driverId ? escapeHtml(driverName(doc.driverId)) : doc.vehicleId ? escapeHtml(vehicleName(doc.vehicleId)) : "Empresa"}</span>
      </div>
      <div class="row-actions">
        <button class="mini-button" type="button" data-open-doc="${doc.id}">Abrir Documento</button>
        <button class="mini-button" type="button" data-download-doc="${doc.id}">Download</button>
        ${admin ? `<button class="mini-button" type="button" data-edit-document="${doc.id}">Editar</button><button class="danger-button" type="button" data-delete-document="${doc.id}">Eliminar</button>` : ""}
      </div>
    </article>
  `;
}


function renderApplications() {
  selectors.pageTitle.textContent = "Candidaturas";
  const applications = state.applications || [];

  selectors.content.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Candidaturas</h2>
          <p>Pedidos recebidos pelo S2T AI Recruiter.</p>
        </div>
        <span class="tag">${applications.length} candidatura(s)</span>
      </div>
      <div class="application-list">
        ${applications.length ? applications.map(application => {
          const candidate = application.candidate || {};
          return `
            <article class="application-card">
              <div>
                <strong>${escapeHtml(candidate.name || "Candidato sem nome")}</strong>
                <div class="muted">${escapeHtml(candidate.email || "")} · ${escapeHtml(candidate.phone || "")}</div>
                <p>${escapeHtml(application.summary || "Candidatura recebida.")}</p>
              </div>
              <div class="application-meta">
                <span class="tag">${escapeHtml(application.status || "Nova")}</span>
                <small>${escapeHtml(candidate.availability || "Disponibilidade não indicada")}</small>
              </div>
            </article>
          `;
        }).join("") : `
          <div class="empty-state">
            <strong>Sem candidaturas</strong>
            <p>Ainda não existem candidaturas para análise.</p>
          </div>
        `}
      </div>
    </section>
  `;
}

function renderAlerts() {
  selectors.pageTitle.textContent = "Alertas";

  const alerts = visibleDocuments()
    .filter(doc => ["Expirado", "3 dias", "7 dias", "15 dias", "30 dias"].includes(alertLevel(doc)))
    .sort((a, b) => {
      const order = { Expirado: 0, "3 dias": 1, "7 dias": 2, "15 dias": 3, "30 dias": 4 };
      return (order[alertLevel(a)] ?? 9) - (order[alertLevel(b)] ?? 9);
    });

  const admin = currentUser().role === "admin";

  const contextLabel = doc =>
    doc.driverId
      ? `Motorista: ${driverName(doc.driverId)}`
      : doc.vehicleId
        ? `Viatura: ${vehicleName(doc.vehicleId)}`
        : "Empresa";

  selectors.content.innerHTML = `
    ${heading(
      "Alertas documentais",
      admin
        ? "Documentos expirados e documentos que entram nos períodos de 30, 15, 7 e 3 dias."
        : "Alertas apenas dos teus documentos e das viaturas que te estão atribuídas.",
      ""
    )}
    <section class="cards-grid">
      ${alerts.map(doc => {
        const level = alertLevel(doc);
        const severityClass = level === "Expirado" ? "inactive" : "expiring";
        return `
          <article class="data-card">
            <div class="panel-heading">
              <span class="tag ${severityClass}">${level}</span>
              <strong>${escapeHtml(contextLabel(doc))}</strong>
            </div>
            <h3>${escapeHtml(doc.name)}</h3>
            <p class="section-copy">${escapeHtml(doc.type)}</p>
            <div class="meta-line">
              <span><strong>Validade:</strong> ${escapeHtml(doc.expiryDate || "Sem validade")}</span>
              <span><strong>Área:</strong> ${doc.driverId ? "Motoristas" : doc.vehicleId ? "Veículos" : "Empresa"}</span>
            </div>
            <div class="row-actions">
              <button class="mini-button" type="button" data-open-document-id="${doc.id}">Abrir documento</button>
              ${admin ? `<button class="mini-button" type="button" data-edit-document-id="${doc.id}">Editar</button>` : ""}
            </div>
          </article>
        `;
      }).join("") || emptyCard(admin ? "Não existem documentos com alerta neste momento." : "Não existem alertas nos teus documentos ou nas tuas viaturas.")}
    </section>
  `;
}


function activityStateLabel(status) {
  const s = String(status || "").toLowerCase();
  if (/(trip|ride|busy|accepted|pickup|arrived|drop|passenger|serving)/.test(s)) return "Em serviço";
  if (/(online|available|idle|waiting|ready)/.test(s)) return "Online sem serviço";
  if (/(offline|inactive|logged.?out|suspended)/.test(s)) return "Fora de serviço";
  return status ? String(status) : "Sem dados";
}

function activityStateClass(status) {
  const label = activityStateLabel(status);
  if (label === "Em serviço") return "active";
  if (label === "Online sem serviço") return "expiring";
  return label === "Fora de serviço" ? "inactive" : "";
}

function localDay(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function boltActivitySummary(days = 7) {
  const cutoff = Date.now() - days * 86400000;
  const events = state.activityEvents.filter(e => e.observedAt && new Date(e.observedAt).getTime() >= cutoff).sort((a,b) => new Date(a.observedAt) - new Date(b.observedAt));
  const trips = state.tripRecords.filter(t => {
    const ts = t.finishedAt || t.acceptedAt || t.observedAt;
    return ts && new Date(ts).getTime() >= cutoff;
  });
  const latestByVehicle = new Map();
  for (const event of state.activityEvents.slice().sort((a,b) => new Date(b.observedAt) - new Date(a.observedAt))) {
    if (event.vehicleId && !latestByVehicle.has(event.vehicleId)) latestByVehicle.set(event.vehicleId, event);
  }
  let onlineMinutes = 0, serviceMinutes = 0;
  const grouped = new Map();
  const byKey = new Map();
  for (const event of events) {
    const key = event.vehicleId || event.driverId || event.vehicleUuid || event.driverUuid || "unknown";
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(event);
  }
  for (const list of byKey.values()) {
    for (let i = 0; i < list.length; i++) {
      const current = list[i], next = list[i + 1];
      const start = new Date(current.observedAt).getTime();
      const end = Math.min(next ? new Date(next.observedAt).getTime() : Date.now(), Date.now());
      const minutes = Math.max(0, Math.min((end - start) / 60000, 24 * 60));
      const label = activityStateLabel(current.status), day = localDay(current.observedAt);
      if (!grouped.has(day)) grouped.set(day, { onlineMinutes: 0, serviceMinutes: 0, trips: 0, distance: 0 });
      const bucket = grouped.get(day);
      if (label === "Em serviço") { serviceMinutes += minutes; bucket.serviceMinutes += minutes; }
      if (label === "Em serviço" || label === "Online sem serviço") { onlineMinutes += minutes; bucket.onlineMinutes += minutes; }
    }
  }
  for (const trip of trips) {
    const day = localDay(trip.finishedAt || trip.acceptedAt || trip.observedAt);
    if (!grouped.has(day)) grouped.set(day, { onlineMinutes: 0, serviceMinutes: 0, trips: 0, distance: 0 });
    const bucket = grouped.get(day), status = String(trip.status || "").toLowerCase();
    if (!status || /(complete|finished|success|done|completed|drop)/.test(status)) bucket.trips += 1;
    const distance = Number(trip.distance);
    if (Number.isFinite(distance)) bucket.distance += distance;
  }
  return { events, trips, latestByVehicle, onlineMinutes, serviceMinutes, grouped };
}

function renderActivity() {
  selectors.pageTitle.textContent = "Utilização da Frota";

  const summary = boltActivitySummary(7);
  const completed = trip => {
    const status = String(trip.status || "").toLowerCase();
    return !status || /(complete|finished|success|done|completed|drop)/.test(status);
  };
  const completedTrips = summary.trips.filter(completed).length;
  const totalDistance = summary.trips.filter(completed).reduce((sum, trip) => {
    const value = Number(trip.distance);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  const cartrackByPlate = new Map((state.cartrackVehicles || []).map(item => [
    String(item.registration || "").toUpperCase(),
    item
  ]));

  const rows = state.vehicles.map(vehicle => {
    const latest = summary.latestByVehicle.get(vehicle.id);
    const trips = summary.trips.filter(trip => trip.vehicleId === vehicle.id && completed(trip));
    const cartrack = cartrackByPlate.get(String(vehicle.plate || "").toUpperCase());
    const distance = trips.reduce((sum, trip) => {
      const value = Number(trip.distance);
      return Number.isFinite(value) ? sum + value : sum;
    }, 0);
    return { vehicle, latest, trips: trips.length, distance, cartrack };
  });

  const dayRows = [...summary.grouped.entries()]
    .sort((a,b) => b[0].localeCompare(a[0]))
    .slice(0, 7);

  const cartrackRows = rows.filter(row => row.cartrack);
  const statusLabel = item => item?.idling === true
    ? "Parado"
    : Number(item?.speedKmh) > 0
      ? "Em movimento"
      : item?.ignition === true
        ? "Ligado"
        : "Sem estado";

  selectors.content.innerHTML = `
    ${heading("Utilização da frota", "Cartrack: estado atual e quilometragem real. Bolt: atividade e viagens quando disponíveis.", '<button class="primary-button" type="button" data-bolt-activity-sync>Atualizar atividade Bolt</button>')}

    <section class="status-strip">
      ${metric("Viaturas Cartrack", cartrackRows.length)}
      ${metric("Eventos Bolt", summary.events.length)}
      ${metric("Viagens Bolt", completedTrips)}
      ${metric("Distância Bolt", totalDistance ? totalDistance.toFixed(1) : "0")}
    </section>

    <section class="content-grid">
      <article class="panel">
        <div class="panel-heading">
          <h2>Estado atual das viaturas</h2>
          <span class="tag active">Cartrack</span>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Viatura</th><th>Estado</th><th>Odómetro</th><th>Velocidade</th><th>Atualizado</th></tr></thead>
          <tbody>
            ${cartrackRows.map(row => {
              const item = row.cartrack;
              return `
                <tr>
                  <td><strong>${escapeHtml(row.vehicle.plate)}</strong><br><span class="section-copy">${escapeHtml(row.vehicle.brand)} ${escapeHtml(row.vehicle.model)}</span></td>
                  <td><span class="tag active">${escapeHtml(statusLabel(item))}</span></td>
                  <td>${item.odometerKm != null ? Number(item.odometerKm).toFixed(1) + " km" : "—"}</td>
                  <td>${item.speedKmh != null ? Number(item.speedKmh).toFixed(1) + " km/h" : "—"}</td>
                  <td>${item.eventTs ? new Date(item.eventTs).toLocaleString("pt-PT") : "—"}</td>
                </tr>`;
            }).join("") || emptyRow("Ainda não existem dados Cartrack.")}
          </tbody>
        </table></div>
        <p class="section-copy" style="margin-top:14px">O odómetro Cartrack é a quilometragem da telemática. A distância Bolt é apresentada separadamente e não é usada como quilometragem total.</p>
      </article>

      <article class="panel">
        <div class="panel-heading"><h2>Atividade Bolt</h2><span class="tag">Últimos 7 dias</span></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Dia</th><th>Online</th><th>Em serviço</th><th>Viagens</th><th>Distância</th></tr></thead>
          <tbody>
            ${dayRows.map(([day, value]) => `
              <tr><td><strong>${escapeHtml(day)}</strong></td><td>${(value.onlineMinutes / 60).toFixed(1)} h</td><td>${(value.serviceMinutes / 60).toFixed(1)} h</td><td>${value.trips}</td><td>${value.distance ? value.distance.toFixed(1) : "0"}</td></tr>
            `).join("") || emptyRow("Ainda não existem dados de atividade Bolt.")}
          </tbody>
        </table></div>
      </article>
    </section>
  `;
}

async function syncCartrack() {
  const button = document.querySelector("[data-cartrack-sync]");
  if (button) { button.disabled = true; button.textContent = "A sincronizar Cartrack…"; }
  try {
    const { data, error } = await supabaseClient.functions.invoke("cartrack-sync", { body: {} });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || "A sincronização Cartrack falhou.");
    await loadBackendData(); renderApp();
    showToast("Cartrack ligada: " + (data.vehiclesSaved ?? 0) + " viaturas e " + (data.snapshotsSaved ?? 0) + " estados recebidos.");
  } catch (error) {
    console.error("Cartrack sync error", error);
    showToast(error?.message || "Não foi possível ligar à Cartrack.");
  } finally {
    const currentButton = document.querySelector("[data-cartrack-sync]");
    if (currentButton) { currentButton.disabled = false; currentButton.textContent = "Sincronizar Cartrack"; }
  }
}

async function syncBoltActivity() {
  const button = document.querySelector("[data-bolt-activity-sync]");
  if (button) { button.disabled = true; button.textContent = "A recolher atividade Bolt…"; }
  try {
    const { data, error } = await supabaseClient.functions.invoke("bolt-activity-sync", { body: { days: 7 } });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "A sincronização da atividade Bolt falhou.");
    await loadBackendData(); renderApp();
    showToast(`Atividade Bolt atualizada: ${data.eventsPrepared ?? 0} estados e ${data.tripsPrepared ?? 0} viagens processados.`);
  } catch (error) {
    console.error("Bolt activity sync error", error);
    showToast(error?.message || "Não foi possível atualizar a atividade Bolt.");
  } finally {
    const currentButton = document.querySelector("[data-bolt-activity-sync]");
    if (currentButton) { currentButton.disabled = false; currentButton.textContent = "Atualizar atividade Bolt"; }
  }
}

async function syncBolt() {
  const button = document.querySelector("[data-bolt-sync]");
  if (button) { button.disabled = true; button.textContent = "A sincronizar Bolt…"; }
  try {
    const { data, error } = await supabaseClient.functions.invoke("bolt-sync", { body: {} });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "A sincronização Bolt falhou.");
    await loadBackendData();
    renderApp();
    const drivers = data.drivers || {};
    const vehicles = data.vehicles || {};
    const assignments = Number(data.assignmentsUpdated || 0);
    showToast(`Bolt sincronizada: ${drivers.active ?? drivers.received ?? 0} motoristas ativos, ${vehicles.active ?? vehicles.received ?? 0} viaturas ativas e ${assignments} associações.`);
  } catch (error) {
    console.error("Bolt sync error", error);
    showToast(error?.message || "Não foi possível sincronizar a Bolt.");
  } finally {
    const currentButton = document.querySelector("[data-bolt-sync]");
    if (currentButton) { currentButton.disabled = false; currentButton.textContent = "Sincronizar Bolt agora"; }
  }
}

async function syncUber() {
  const button = document.querySelector("[data-uber-sync]");
  if (button) { button.disabled = true; button.textContent = "A sincronizar Uber…"; }
  try {
    const { data, error } = await supabaseClient.functions.invoke("uber-sync", { body: {} });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "A sincronização Uber falhou.");
    await loadBackendData();
    renderApp();
    const drivers = data.drivers || {};
    const vehicles = data.vehicles || {};
    const assignments = Number(data.assignmentsUpdated || 0);
    showToast(`Uber sincronizada: ${drivers.active ?? drivers.received ?? 0} motoristas ativos, ${vehicles.active ?? vehicles.received ?? 0} viaturas ativas e ${assignments} associações.`);
  } catch (error) {
    console.error("Uber sync error", error);
    showToast(error?.message || "Não foi possível sincronizar a Uber.");
  } finally {
    const currentButton = document.querySelector("[data-uber-sync]");
    if (currentButton) { currentButton.disabled = false; currentButton.textContent = "Sincronizar Uber agora"; }
  }
}

function renderSettings() {
  selectors.pageTitle.textContent = "Configurações";
  const boltDrivers = state.drivers.filter(driver => driver.boltDriverUuid).length;
  const boltVehicles = state.vehicles.filter(vehicle => vehicle.boltVehicleUuid).length;
  const lastBoltSync = [...state.drivers, ...state.vehicles].map(item => item.boltLastSyncedAt).filter(Boolean).sort().pop();
  const uberDrivers = state.drivers.filter(driver => driver.uberDriverUuid).length;
  const uberVehicles = state.vehicles.filter(vehicle => vehicle.uberVehicleUuid).length;
  const lastUberSync = [...state.drivers, ...state.vehicles].map(item => item.uberLastSyncedAt).filter(Boolean).sort().pop();

  selectors.content.innerHTML = `
    ${heading("Configurações", "Segurança, palavras-passe e integrações.", "")}
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
        <div class="panel-heading"><h2>Integrações</h2><span class="tag active">Bolt preparada</span></div>
        <div class="integration-card">
          <div class="panel-heading">
            <div>
              <strong>🟢 Bolt Fleet</strong>
              <p class="section-copy">Sincronização de motoristas, viaturas e associação motorista ↔ viatura.</p>
            </div>
            <span class="tag active">API</span>
          </div>
          <div class="settings-list">
            <div class="settings-row"><strong>Motoristas Bolt no Portal</strong><span>${boltDrivers}</span></div>
            <div class="settings-row"><strong>Viaturas Bolt no Portal</strong><span>${boltVehicles}</span></div>
            <div class="settings-row"><strong>Última sincronização</strong><span>${lastBoltSync ? new Date(lastBoltSync).toLocaleString("pt-PT") : "Ainda não executada"}</span></div>
          </div>
          <div class="integration-note">
            <strong>Credenciais seguras no Supabase</strong>
            <p>O Portal usa a API Fleet Integration da Bolt com OAuth Client Credentials. O Client Secret nunca fica no navegador.</p>
          </div>
          <button class="primary-button" type="button" data-bolt-sync>Sincronizar Bolt agora</button>
        </div>
        <div class="settings-list">
          <div class="settings-row"><strong>Google Drive</strong><span class="tag active">Ligado</span></div>
          <div class="settings-row"><strong>S2T SmartDocs</strong><span class="tag active">Ativo no Portal</span></div>
          <div class="integration-card">
            <div class="panel-heading">
              <div>
                <strong>Cartrack</strong>
                <p class="section-copy">Sincronização segura da lista de viaturas, estado atual e odómetro da telemática.</p>
              </div>
              <span class="tag active">API</span>
            </div>
            <div class="settings-list">
              <div class="settings-row"><strong>Viaturas Cartrack no Portal</strong><span>${state.cartrackVehicles.length}</span></div>
              <div class="settings-row"><strong>Última sincronização</strong><span>${state.cartrackVehicles.length ? new Date(Math.max(...state.cartrackVehicles.map(item => new Date(item.lastSyncedAt || 0).getTime()))).toLocaleString("pt-PT") : "Ainda não executada"}</span></div>
            </div>
            <div class="integration-note">
              <strong>Dados utilizados</strong>
              <p>Apenas viaturas, odómetro atual e estado atual (movimento/parado). Não usamos localização, percursos ou telemetria histórica.</p>
            </div>
            <button class="secondary-button" type="button" data-cartrack-sync>Sincronizar Cartrack</button>
          </div>
          <div class="integration-card">
            <div class="panel-heading">
              <div>
                <strong>Uber Fleet</strong>
                <p class="section-copy">Importação de motoristas, viaturas e associação motorista ↔ viatura.</p>
              </div>
              <span class="tag expiring">Acesso pendente</span>
            </div>
            <div class="settings-list">
              <div class="settings-row"><strong>Motoristas Uber no Portal</strong><span>${uberDrivers}</span></div>
              <div class="settings-row"><strong>Viaturas Uber no Portal</strong><span>${uberVehicles}</span></div>
              <div class="settings-row"><strong>Última sincronização</strong><span>${lastUberSync ? new Date(lastUberSync).toLocaleString("pt-PT") : "Ainda não executada"}</span></div>
              <div class="settings-row"><strong>Backend de sincronização</strong><span class="tag active">Preparado</span></div>
            </div>
            <div class="integration-note">
              <strong>Aplicação Uber: Simplicity2Take Fleet</strong>
              <p>O backend seguro da Uber já está preparado no Supabase. A única dependência externa é a autorização dos scopes Fleet e a configuração segura do Client ID/Client Secret.</p>
              <p>Não vamos usar localização, viagens, ganhos, pagamentos ou telemetria.</p>
            </div>
            <button class="secondary-button" type="button" data-uber-sync title="Sincronizar a frota Uber agora">Sincronizar Uber agora</button>
          </div>
          <div class="settings-row"><strong>Gestão de Revisões</strong><span class="tag">Preparado</span></div>
          <div class="settings-row"><strong>Gestão de Inspeções</strong><span class="tag">Preparado</span></div>
        </div>
      </article>
      <article class="panel recruiter-config">
        <div class="panel-heading"><h2>S2T AI Recruiter</h2><span class="tag active">Editável</span></div>
        <form id="recruiterConfigForm" class="config-form">
          <label>Requisitos de recrutamento<textarea name="requirements" rows="5">${escapeHtml(state.recruitmentConfig.requirements.join("\n"))}</textarea></label>
          <label>Perguntas frequentes e respostas<textarea name="faqs" rows="8">${escapeHtml(state.recruitmentConfig.faqs.map(item => `${item.q} | ${item.a}`).join("\n"))}</textarea></label>
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
  return `<tr><td colspan="8">${message}</td></tr>`;
}

function emptyCard(message) {
  return `<article class="empty-state">${message}</article>`;
}

function openVehicleDocumentModal(vehicleId, docType = "") {
  openModal("document", "", { scope: "vehicle" });
  const vehicleSelect = selectors.modalFields.querySelector('[name="vehicleId"]');
  const typeSelect = selectors.modalFields.querySelector('[name="type"]');
  if (vehicleSelect) vehicleSelect.value = vehicleId;
  if (typeSelect && docType) typeSelect.value = docType;
  state.smartPreview = { vehicleId, driverId: "", scope: "vehicle" };
}

function openDriverDocumentModal(driverId, docType = "") {
  openModal("document", "", { scope: "driver" });
  const driverSelect = selectors.modalFields.querySelector('[name="driverId"]');
  const typeSelect = selectors.modalFields.querySelector('[name="type"]');
  if (driverSelect) driverSelect.value = driverId;
  if (typeSelect && docType) typeSelect.value = docType;
  state.smartPreview = { vehicleId: "", driverId, scope: "driver" };
}

function openModal(type, id = "", options = {}) {
  state.editing = { type, id };
  if (type === "document") {
    const existing = state.documents.find(item => item.id === id);
    state.documentContext = options.scope || (existing?.vehicleId ? "vehicle" : existing?.driverId ? "driver" : "company");
  }
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
      field("vin", "VIN", vehicle.vin, "text", false, "", false),
      selectField("status", "Estado", ["Ativo", "Manutenção", "Inativo"], vehicle.status || "Ativo"),
      checkList("driverIds", "Motoristas atribuídos", state.drivers, vehicle.driverIds || [])
    ].join("");
  }
  if (type === "password") {
    return [field("password", "Nova palavra-passe", "", "password", true)].join("");
  }

  const doc = state.documents.find(item => item.id === id) || {};
  const context = state.documentContext || "company";
  const selectedDriver = doc.driverId || "";
  const selectedVehicle = doc.vehicleId || "";
  const privateDriverDoc = Boolean(selectedDriver);

  if (context === "company") {
    const companyTypes = [
      "Certidão Permanente",
      "Licença / Alvará",
      "RNAVT",
      "Seguro da Empresa",
      "Contrato",
      "Documento Fiscal",
      "Fatura / Comprovativo",
      "Outros"
    ];
    return `
      <div class="smartdocs-box span-full">
        <strong>Gestão documental da empresa</strong>
        <p>Este documento fica exclusivamente na área da empresa. Não é associado a motorista nem a viatura.</p>
      </div>
      ${field("file", "Ficheiro original", "", "file", true, 'accept=".pdf,.jpg,.jpeg,.png"')}
      <div class="smart-preview span-full" id="smartPreview">Pré-visualização SmartDocs ainda sem ficheiro.</div>
      ${field("name", "Nome do documento", doc.name)}
      ${selectField("type", "Tipo", companyTypes, doc.type || "Outros")}
      ${field("expiryDate", "Data de validade", doc.expiryDate, "date", false)}
    `;
  }

  if (context === "driver") {
    return `
      <div class="smartdocs-box span-full">
        <strong>Documento do motorista</strong>
        <p>Este documento fica privado e associado exclusivamente ao motorista.</p>
      </div>
      ${field("file", "Ficheiro original", "", "file", true, 'accept=".pdf,.jpg,.jpeg,.png"')}
      <div class="smart-preview span-full" id="smartPreview">Pré-visualização SmartDocs ainda sem ficheiro.</div>
      ${field("name", "Nome do documento", doc.name)}
      ${selectField("type", "Tipo", documentTypes, doc.type || "Carta de Condução")}
      ${field("expiryDate", "Data de validade", doc.expiryDate, "date")}
      ${selectField("driverId", "Motorista associado (privado)", state.drivers.map(driver => [driver.id, driver.name]), selectedDriver)}
    `;
  }

  return `
    <div class="smartdocs-box span-full">
      <strong>Documento da viatura</strong>
      <p>Este documento fica associado exclusivamente à viatura e pode ser consultado pelos motoristas autorizados dessa viatura.</p>
    </div>
    ${field("file", "Ficheiro original", "", "file", true, 'accept=".pdf,.jpg,.jpeg,.png"')}
    <div class="smart-preview span-full" id="smartPreview">Pré-visualização SmartDocs ainda sem ficheiro.</div>
    ${field("name", "Nome do documento", doc.name)}
    ${selectField("type", "Tipo", documentTypes, doc.type || "Outros")}
    ${field("expiryDate", "Data de validade", doc.expiryDate, "date")}
    ${selectField("vehicleId", "Veículo associado", state.vehicles.map(vehicle => [vehicle.id, vehicle.plate + " — " + vehicle.brand + " " + vehicle.model]), selectedVehicle)}
    ${checkList("viewerDriverIds", "Visualização adicional (apenas documentos sem motorista)", state.drivers, doc.viewerDriverIds || [])}
  `;
}

function field(name, label, value = "", type = "text", span = false, extra = "", required = true) {
  const requiredAttr = type === "file" || !required ? "" : "required";
  return `<label class="${span ? "span-full" : ""}">${label}<input name="${name}" type="${type}" value="${type === "file" ? "" : escapeHtml(value)}" ${extra} ${requiredAttr}></label>`;
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
  const companyType =
    text.includes("certidao permanente") || text.includes("certidao-permanente") || text.includes("c. permanente") || text.includes("c permanente") ? "Certidão Permanente" :
    text.includes("rnavt") ? "RNAVT" :
    text.includes("seguro empresa") || text.includes("seguro da empresa") ? "Seguro da Empresa" :
    text.includes("licenca") || text.includes("alvara") ? "Licença / Alvará" :
    text.includes("fatura") || text.includes("factura") || text.includes("comprovativo") ? "Fatura / Comprovativo" :
    text.includes("fiscal") ? "Documento Fiscal" :
    null;
  const type = companyType || documentTypes.find(item => {
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
  const scope = companyType ? "unassigned" : smartDocumentScope(fileName, type, driver, vehicle);
  return {
    type,
    expiryDate,
    vehicleId: scope === "vehicle" ? vehicle?.id || "" : "",
    driverId: scope === "driver" ? driver?.id || "" : "",
    vehicle,
    driver,
    scope,
    name: fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim()
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
  if ((state.documentContext || "company") === "vehicle") setValue("vehicleId", preview.vehicleId);
  if ((state.documentContext || "company") === "driver") setValue("driverId", preview.driverId);
  const vehicleLabel = preview.vehicle ? preview.vehicle.plate : "não identificado";
  const driverLabel = preview.driver ? preview.driver.name : "não identificado";
  const scopeLabel = preview.scope === "driver" ? "Privado do motorista" : preview.scope === "vehicle" ? "Documento da viatura" : "Sem associação automática";
  $("#smartPreview").innerHTML = `
    <strong>S2T SmartDocs — classificação automática pelo nome do ficheiro</strong>
    <dl>
      <dt>Tipo:</dt><dd>${escapeHtml(preview.type)}</dd>
      <dt>Motorista:</dt><dd>${escapeHtml(driverLabel)}</dd>
      <dt>Viatura:</dt><dd>${escapeHtml(vehicleLabel)}</dd>
      <dt>Validade:</dt><dd>${escapeHtml(preview.expiryDate || "não encontrada")}</dd>
      <dt>Acesso:</dt><dd>${escapeHtml(scopeLabel)}</dd>
    </dl>
    <small>O sistema usa o nome do ficheiro para sugerir o tipo e a validade quando consegue identificar esses dados. Confirma sempre antes de guardar.</small>
  `;
}

async function analysePdfContent(file, preview) {
  if (file.type !== "application/pdf" || !window.pdfjsLib) return preview;

  try {
    const buffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
    let text = "";

    const pagesToRead = Math.min(pdf.numPages, 10);
    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      text += " " + content.items.map(item => item.str || "").join(" ");
    }

    const normalized = normalizeText(text);
    const dates = [
      ...[...text.matchAll(/(?:validade|válida até|valido ate|valid until|expiry|expires|expira)[^0-9]{0,40}(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})/gi)].map(m => [m[3], m[2], m[1]]),
      ...[...text.matchAll(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](20\d{2})/g)].map(m => [m[3], m[2], m[1]])
    ];

    if (!preview.expiryDate && dates.length) {
      const candidate = dates.find(parts => {
        const year = Number(parts[0]);
        const month = Number(parts[1]);
        const day = Number(parts[2]);
        return year >= new Date().getFullYear() && month >= 1 && month <= 12 && day >= 1 && day <= 31;
      });
      if (candidate) preview.expiryDate = candidate.join("-");
    }

    if (preview.type === "Outros" || preview.type === "Certidão Permanente") {
      if (normalized.includes("certidao permanente") || normalized.includes("certidao permanente")) {
        preview.type = "Certidão Permanente";
      } else if (normalized.includes("rnavt")) {
        preview.type = "RNAVT";
      } else if (normalized.includes("seguro da empresa") || normalized.includes("seguro")) {
        preview.type = "Seguro da Empresa";
      } else if (normalized.includes("licenca") || normalized.includes("alvara")) {
        preview.type = "Licença / Alvará";
      }
    }

    preview.contentRead = true;
    return preview;
  } catch (error) {
    console.warn("SmartDocs: não foi possível ler o conteúdo do PDF.", error);
    return preview;
  }
}

function wireSmartDocsUpload() {
  const fileInput = selectors.modalFields.querySelector('input[name="file"]');
  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    state.smartPreview = analyseFileName(file.name);
    applySmartPreview(state.smartPreview);

    if (file.type === "application/pdf") {
      const preview = await analysePdfContent(file, state.smartPreview);
      state.smartPreview = preview;
      applySmartPreview(preview);
    }
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
  const context = state.documentContext || "company";

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
    const folderType = context === "vehicle" ? "vehicles" : context === "driver" ? "drivers" : "documents";
    const folderName = context === "vehicle"
      ? (state.vehicles.find(vehicle => vehicle.id === values.vehicleId)?.plate || "Sem viatura")
      : context === "driver"
        ? (state.drivers.find(driver => driver.id === values.driverId)?.name || "Sem motorista")
        : "Empresa";

    const { data, error } = await supabaseClient.functions.invoke("drive-upload", {
      body: {
        fileName: file.name,
        mimeType: file.type,
        base64,
        folderType,
        folderName,
        documentType: values.type
      }
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "Falha ao guardar no Google Drive.");
    driveData = data;
  }

  if (!driveData) throw new Error("Selecione um ficheiro.");

  const finalVehicleId = context === "vehicle"
    ? (values.vehicleId || state.smartPreview?.vehicleId || null)
    : null;
  const finalDriverId = context === "driver"
    ? (values.driverId || state.smartPreview?.driverId || null)
    : null;

  if (context === "vehicle" && !finalVehicleId) {
    throw new Error("Selecione a viatura.");
  }
  if (context === "driver" && !finalDriverId) {
    throw new Error("Selecione o motorista.");
  }

  const payload = {
    name: values.name,
    document_type: values.type,
    document_number: null,
    policy_number: null,
    issue_date: null,
    expiry_date: values.expiryDate || null,
    observations: null,
    original_file_name: driveData.fileName,
    mime_type: driveData.mimeType,
    drive_file_id: driveData.fileId,
    drive_web_view_link: driveData.webViewLink,
    vehicle_id: finalVehicleId,
    driver_id: finalDriverId,
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

  if (context === "vehicle" && viewerDriverIds.length) {
    const { error: viewerError } = await supabaseClient.from("document_viewers").insert(
      viewerDriverIds.map(driverId => ({ document_id: documentId, driver_id: driverId }))
    );
    if (viewerError) throw viewerError;
  }

  state.activeView = context === "vehicle" ? "vehicles" : context === "driver" ? "drivers" : "documents";
  showToast(
    context === "vehicle"
      ? "Documento da viatura guardado no Google Drive."
      : context === "driver"
        ? "Documento do motorista guardado no Google Drive."
        : "Documento da empresa guardado no Google Drive."
  );
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
    if (!window.pdfjsLib) {
      URL.revokeObjectURL(url);
      throw new Error("Visualizador PDF ainda não está disponível. Atualiza a página e tenta novamente.");
    }

    const loading = document.createElement("div");
    loading.className = "document-viewer-loading";
    loading.textContent = "A preparar documento…";
    content.appendChild(loading);
    modal.showModal();

    const pdf = await window.pdfjsLib.getDocument({ data: await data.arrayBuffer() }).promise;
    content.replaceChildren();

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.35 });
      const canvas = document.createElement("canvas");
      canvas.className = "document-viewer-page";
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.setAttribute("aria-label", "Página " + pageNumber + " de " + pdf.numPages);
      content.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    }
  } else if (mimeType.startsWith("image/")) {
    const image = document.createElement("img");
    image.src = url;
    image.alt = doc.fileName || doc.name || "Documento";
    image.className = "document-viewer-image";
    content.appendChild(image);
    modal.showModal();
  } else {
    URL.revokeObjectURL(url);
    throw new Error("Este tipo de documento não pode ser visualizado diretamente.");
  }

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
  const driver = state.drivers.find(item => item.id === driverId);
  const { error } = await supabaseClient.functions.invoke("admin-reset-driver-password", {
    body: {
      driverId,
      password,
      email: driver?.email || "",
      phone: driver?.phone || ""
    }
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
      const driver = state.drivers.find(item => item.id === action.id);
      if (!driver) return;

      const driverDocs = state.documents.filter(doc => doc.driverId === action.id);

      if (driver.status === "Inativo" && driverDocs.length === 0) {
        if (!confirm("Eliminar definitivamente este motorista?")) return;

        const { error: assignmentError } = await supabaseClient
          .from("vehicle_assignments")
          .delete()
          .eq("driver_id", action.id);
        if (assignmentError) throw assignmentError;

        const { error: viewerError } = await supabaseClient
          .from("document_viewers")
          .delete()
          .eq("driver_id", action.id);
        if (viewerError) throw viewerError;

        const { error } = await supabaseClient
          .from("drivers")
          .delete()
          .eq("id", action.id);
        if (error) throw error;

        await loadBackendData();
        renderApp();
        showToast("Motorista eliminado definitivamente.");
        return;
      }

      if (!confirm("Desativar este motorista? O histórico documental será preservado.")) return;

      const { error } = await supabaseClient
        .from("drivers")
        .update({ status: "Inativo" })
        .eq("id", action.id);
      if (error) throw error;

      await loadBackendData();
      renderApp();
      showToast("Motorista desativado.");
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
    const target = event.target.closest("button,[data-view],[data-open],[data-qr-vehicle],[data-open-doc],[data-open-vehicle-doc],[data-doc-driver],[data-open-document-id],[data-edit-document-id],[data-download-doc],[data-edit-driver],[data-edit-vehicle],[data-edit-document],[data-reset-password],[data-delete-driver],[data-delete-vehicle],[data-delete-document],[data-request-password],[data-bolt-activity-sync]");
    if (!target) return;

    const view = target.dataset.view;
    if (view) return setView(view);
    if (target.dataset.open) return openModal(target.dataset.open);
    if (target.dataset.openVehicleDoc) return openVehicleDocumentModal(target.dataset.openVehicleDoc, target.dataset.docType || "");
    if (target.dataset.docDriver) return openDriverDocumentModal(target.dataset.docDriver);
    if (target.dataset.qrVehicle) return showVehicleQr(target.dataset.qrVehicle);
    if (target.dataset.openDocumentId) {
      try { await openDocument(target.dataset.openDocumentId); } catch (error) { console.error(error); showToast(error?.message || "Não foi possível abrir o documento."); }
      return;
    }
    if (target.dataset.editDocumentId) return openModal("document", target.dataset.editDocumentId);
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
    if (target.dataset.boltSync !== undefined) return syncBolt();
    if (target.dataset.boltActivitySync !== undefined) return syncBoltActivity();
    if (target.dataset.cartrackSync !== undefined) return syncCartrack();
    if (target.dataset.uberSync !== undefined) return syncUber();
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
    if (isVehicleQrMode()) {
      if (data.session?.user) await supabaseClient.auth.signOut();
      selectors.loginOptions.innerHTML = '<div class="smartdocs-box"><strong>Acesso de motorista</strong><p>Entre com a conta do motorista autorizado para esta viatura.</p></div>';
      selectors.loginIdentifier.placeholder = "Email ou telemóvel do motorista";
      return;
    }
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
