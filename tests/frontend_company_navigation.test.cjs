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
