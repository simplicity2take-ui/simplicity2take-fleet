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

const documentTypes = ["Carta de Condução", "Seguro", "IPO", "Licença TVDE", "Cartão de Cidadão"];
const navByRole = {
  admin: [["dashboard", "Dashboard", "DB"], ["vehicles", "Veículos", "VE"], ["drivers", "Motoristas", "MO"], ["documents", "Documentos", "DO"], ["applications", "Candidaturas", "AI"], ["alerts", "Alertas", "AL"], ["settings", "Configurações", "CO"]],
  driver: [["vehicles", "Meus Veículos", "VE"], ["documents", "Meus Documentos", "DO"], ["account", "Minha Conta", "EU"]]
};

const $ = selector => document.querySelector(selector);
const selectors = {
  loginScreen: $("#loginScreen"),
  loginForm: $("#loginForm"),
  loginIdentifier: $("#loginIdentifier"),