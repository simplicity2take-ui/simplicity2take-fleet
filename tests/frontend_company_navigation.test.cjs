const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createApp() {
  const elements = new Map();
  let controls = [];
  function element(selector) {
    if (elements.has(selector)) return elements.get(selector);
    const node = {
      listeners: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, handler) { this.listeners[type] = handler; },
      disabled: false,
      inert: false,
      textContent: "",
      value: ""
    };
    let html = "";
    Object.defineProperty(node, "innerHTML", {
      get() { return html; },
      set(value) {
        html = String(value);
        if (selector === "#content") {
          controls = html.includes("data-bolt-sync")
            ? [{ disabled: false, title: "", matches() { return false; } }]
            : [];
        }
      }
    });
    elements.set(selector, node);
    return node;
  }
  const document = {
    querySelector: element,
    querySelectorAll() { return controls; },
    addEventListener() {}
  };
  const auth = {
    onAuthStateChange() {},
    getSession() { return Promise.resolve({ data: { session: null } }); }
  };
  const context = vm.createContext({
    document,
    window: { location: { search: "" }, supabase: { createClient() { return { auth }; } } },
    URL,
    URLSearchParams,
    console: { error() {} },
    setTimeout() { return 1; },
    clearTimeout() {}
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  vm.runInContext(source, context, { filename: "app.js" });
  return { context, elements, controls: () => controls };
}

test("switching from company administrator to member leaves only an allowed view", () => {
  const app = createApp();
  vm.runInContext(
    "state.profile={id:'user',role:'user',full_name:'Pessoa'};" +
    "state.sessionUserId='user'; state.currentCompanyRole='member';" +
    "state.currentCompanyId='b'; state.companies=[{id:'b',slug:'empresa-b',status:'Ativa'}];" +
    "state.activeView='drivers'; state.documents=[]; state.drivers=[]; renderApp();",
    app.context
  );
  assert.equal(vm.runInContext("state.activeView", app.context), "documents");
  assert.doesNotMatch(app.elements.get("#content").innerHTML, /Criar motorista/);
  assert.match(app.elements.get("#sideNav").innerHTML, /Documentos da Empresa/);
});

test("newly rendered Bolt control reflects the selected company", () => {
  const app = createApp();
  vm.runInContext(
    "state.profile={id:'admin',role:'admin',full_name:'Admin'};" +
    "state.sessionUserId='admin'; state.currentCompanyId='b';" +
    "state.companies=[{id:'b',slug:'empresa-b',status:'Ativa'}];" +
    "state.activeView='settings';" +
    "renderContent=()=>{selectors.content.innerHTML='<button data-bolt-sync>Sincronizar</button>';}; renderApp();",
    app.context
  );
  assert.equal(app.controls()[0].disabled, true);
  vm.runInContext("state.companies[0].slug='simplicity2take'; renderApp();", app.context);
  assert.equal(app.controls()[0].disabled, false);
});

test("failed company switch restores role and visible fleet data", async () => {
  const app = createApp();
  vm.runInContext(
    "state.profile={id:'user',role:'user',full_name:'Pessoa'};" +
    "state.sessionUserId='user'; state.currentCompanyRole='company_admin';" +
    "state.currentCompanyId='a'; state.companies=[{id:'a',slug:'a',status:'Ativa'},{id:'b',slug:'b',status:'Ativa'}];" +
    "state.activeView='drivers'; state.drivers=[{id:'original',name:'Original',email:'a@example.test',phone:'1',status:'Ativo'}]; state.documents=[];" +
    "loadBackendData=()=>new Promise((resolve,reject)=>{state.currentCompanyRole='member';state.companies=[];state.drivers=[];globalThis.rejectLoad=reject;});" +
    "bindPortalEvents();",
    app.context
  );
  const switcher = app.elements.get("#companySwitcher");
  const pending = switcher.listeners.change({ target: { value: "b" } });
  assert.equal(app.elements.get("#appShell").inert, true);
  app.context.rejectLoad(new Error("offline"));
  await pending;
  assert.equal(vm.runInContext("state.currentCompanyId", app.context), "a");
  assert.equal(vm.runInContext("state.currentCompanyRole", app.context), "company_admin");
  assert.equal(vm.runInContext("state.companies.length", app.context), 2);
  assert.match(app.elements.get("#content").innerHTML, /Original/);
  assert.equal(app.elements.get("#appShell").inert, false);
  assert.equal(switcher.disabled, false);
});


test("global administrator can open dashboard and company management settings", () => {
  const app = createApp();
  vm.runInContext(
    "state.profile={id:'admin',role:'admin',full_name:'Admin'};" +
    "state.sessionUserId='admin'; state.currentCompanyId='a';" +
    "state.companies=[{id:'a',slug:'simplicity2take',legal_name:'Empresa A',display_name:'Empresa A',status:'Ativa'}];" +
    "state.drivers=[]; state.vehicles=[]; state.documents=[]; state.tripRecords=[];" +
    "state.companyMemberships=[]; state.companyProfiles=[]; state.companyMembershipLoadError='';" +
    "state.activeView='dashboard'; renderApp();",
    app.context
  );
  assert.match(app.elements.get("#content").innerHTML, /Resumo documental/);
  vm.runInContext("state.activeView='settings'; renderApp();", app.context);
  assert.match(app.elements.get("#content").innerHTML, /Acessos à empresa/);
  assert.match(app.elements.get("#content").innerHTML, /Adicionar empresa/);
});


test("global administrator sees vehicle and driver expiry alerts", () => {
  const app = createApp();
  vm.runInContext(
    "state.profile={id:'admin',role:'admin',full_name:'Admin'};" +
    "state.sessionUserId='admin'; state.currentCompanyId='a'; state.currentCompanyRole=null;" +
    "state.companies=[{id:'a',slug:'a',status:'Ativa'}]; state.activeView='alerts';" +
    "state.drivers=[{id:'d-a',name:'Motorista A'}]; state.vehicles=[{id:'v-a',plate:'AA-00-AA',driverIds:[]}];" +
    "state.documents=[" +
      "{id:'company-a',companyId:'a',name:'Documento da empresa',type:'Outros',expiryDate:'2000-01-01'}," +
      "{id:'vehicle-a',companyId:'a',vehicleId:'v-a',name:'Seguro expirado',type:'Seguro',expiryDate:'2000-01-01'}," +
      "{id:'driver-a',companyId:'a',driverId:'d-a',name:'Carta expirada',type:'Carta de Condução',expiryDate:'2000-01-01'}" +
    "]; renderApp();",
    app.context
  );
  const html = app.elements.get("#content").innerHTML;
  assert.match(html, /Documento da empresa/);
  assert.match(html, /Seguro expirado/);
  assert.match(html, /Carta expirada/);
  assert.match(html, /data-edit-document-id/);
});

test("company administrator sees alerts only for the selected company without global edit actions", () => {
  const app = createApp();
  vm.runInContext(
    "state.profile={id:'manager',role:'user',full_name:'Gestor'};" +
    "state.sessionUserId='manager'; state.currentCompanyId='a'; state.currentCompanyRole='company_admin';" +
    "state.companies=[{id:'a',slug:'a',status:'Ativa'}]; state.activeView='alerts';" +
    "state.drivers=[{id:'d-a',name:'Motorista A'}]; state.vehicles=[{id:'v-a',plate:'AA-00-AA',driverIds:[]}];" +
    "state.documents=[" +
      "{id:'vehicle-a',companyId:'a',vehicleId:'v-a',name:'IPO empresa A',type:'IPO',expiryDate:'2000-01-01'}," +
      "{id:'driver-a',companyId:'a',driverId:'d-a',name:'Carta empresa A',type:'Carta de Condução',expiryDate:'2000-01-01'}," +
      "{id:'foreign',companyId:'b',vehicleId:'v-b',name:'Seguro empresa B',type:'Seguro',expiryDate:'2000-01-01'}" +
    "]; renderApp();",
    app.context
  );
  const html = app.elements.get("#content").innerHTML;
  assert.equal(vm.runInContext("state.activeView", app.context), "alerts");
  assert.match(app.elements.get("#sideNav").innerHTML, /Alertas/);
  assert.match(html, /IPO empresa A/);
  assert.match(html, /Carta empresa A/);
  assert.doesNotMatch(html, /Seguro empresa B/);
  assert.doesNotMatch(html, /data-edit-document-id/);
});

test("driver document visibility stays limited to their own and assigned vehicle", () => {
  const app = createApp();
  vm.runInContext(
    "state.profile={id:'driver-user',role:'driver',full_name:'Motorista',driver_id:'d-a'};" +
    "state.sessionUserId='driver-user'; state.currentCompanyRole=null; state.currentCompanyId=null;" +
    "state.vehicles=[{id:'v-a',driverIds:['d-a']},{id:'v-b',driverIds:['d-b']}];" +
    "state.documents=[" +
      "{id:'own',driverId:'d-a'}," +
      "{id:'assigned',vehicleId:'v-a'}," +
      "{id:'shared',viewerDriverIds:['d-a']}," +
      "{id:'other-driver',driverId:'d-b'}," +
      "{id:'other-vehicle',vehicleId:'v-b'}" +
    "];",
    app.context
  );
  assert.equal(vm.runInContext("visibleDocuments().map(doc=>doc.id).sort().join(',')", app.context), "assigned,own,shared");
});


function prepareDriverUpdate(app, result) {
  app.context.driverUpdateResult = result;
  app.context.driverUpdateCalls = [];
  app.context.driverUpdateToasts = [];
  vm.runInContext(
    "supabaseClient.from = table => {" +
      "driverUpdateCalls.push(['from', table]);" +
      "return {" +
        "update(payload) { driverUpdateCalls.push(['update', payload]); return this; }," +
        "eq(column, value) { driverUpdateCalls.push(['eq', column, value]); return this; }," +
        "select(columns) { driverUpdateCalls.push(['select', columns]); return this; }," +
        "async maybeSingle() { return driverUpdateResult; }" +
      "};" +
    "};" +
    "showToast = message => driverUpdateToasts.push(message);",
    app.context
  );
}

test("driver update rejects a missing or another company's driver before sending a request", async () => {
  const app = createApp();
  prepareDriverUpdate(app, { data: { id: "d1" }, error: null });
  vm.runInContext("state.currentCompanyId='a'; state.drivers=[];", app.context);
  const update = () => vm.runInContext(
    "saveDriver({name:'Ana',email:'ana@example.test',phone:'1',status:'Ativo'},'d1')", app.context
  );
  await assert.rejects(update(), /não pertence à empresa selecionada/);
  vm.runInContext("state.drivers=[{id:'d1',status:'Ativo',raw:{company_id:'b'}}];", app.context);
  await assert.rejects(update(), /não pertence à empresa selecionada/);
  assert.equal(app.context.driverUpdateCalls.length, 0);
  assert.equal(app.context.driverUpdateToasts.length, 0);
});

test("driver update reports success only if the selected company row was updated", async () => {
  const app = createApp();
  prepareDriverUpdate(app, { data: null, error: null });
  vm.runInContext(
    "state.currentCompanyId='a'; state.drivers=[{id:'d1',status:'Ativo',raw:{company_id:'a'}}];",
    app.context
  );
  const update = () => vm.runInContext(
    "saveDriver({name:'Ana',email:'ana@example.test',phone:'1',status:'Ativo'},'d1')", app.context
  );
  await assert.rejects(update(), /não foi atualizado/);
  assert.equal(app.context.driverUpdateToasts.length, 0);
  assert.ok(app.context.driverUpdateCalls.some(call => call[0] === "eq" && call[1] === "company_id" && call[2] === "a"));
  app.context.driverUpdateResult = { data: { id: "d1" }, error: null };
  await update();
  assert.equal(app.context.driverUpdateToasts[0], "Motorista atualizado.");
});
