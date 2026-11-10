(() => {
  const SUPABASE_URL = "https://lmutpimlokagjwngqanx.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8NuXQQp9sef-eTwGMItD0Q_GyD1GBVS";
  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  if (!client) return;

  let loading = false;
  let authEpoch = 0;
  client.auth.onAuthStateChange(event => {
    if (event === "SIGNED_OUT" || event === "SIGNED_IN") {
      authEpoch++;
      document.querySelector("#s2tUberActivityPanel")?.remove();
    }
  });
  const canRender = () => document.querySelector("#pageTitle")?.textContent?.trim() === "Utilização da Frota"
    && document.querySelector("#sessionRole")?.textContent?.trim() === "Administrador"
    && !document.querySelector("#appShell")?.classList.contains("hidden");
  const oldStatus = (driver, now=Date.now()) => {
    const time = driver?.uber_status_at ? Date.parse(driver.uber_status_at) : NaN;
    return !Number.isFinite(time) || time > now || now-time > 30*60000;
  };
  const statusDate = driver => {
    const time = driver?.uber_status_at ? Date.parse(driver.uber_status_at) : NaN;
    return Number.isFinite(time) ? new Date(time).toLocaleString("pt-PT",{timeZone:"Europe/Lisbon"}) : "Sem data do estado";
  };

  const esc = value => String(value ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));

  const statusLabel = status => {
    const value = String(status || "").toUpperCase();
    if (value === "ONTRIP") return "Online com serviço";
    if (value === "ONLINE") return "Online sem serviço";
    if (value === "OFFLINE") return "Fora de serviço";
    return "Sem dados";
  };

  const statusClass = label => label === "Online com serviço" ? "active"
    : label === "Online sem serviço" ? "expiring"
    : label === "Fora de serviço" ? "inactive" : "";

  async function load() {
    const epoch = authEpoch;
    if (!canRender()) return;
    const [drivers, vehicles, assignments] = await Promise.all([
      client.from("drivers").select("*"),
      client.from("vehicles").select("*"),
      client.from("vehicle_assignments").select("*")
    ]);
    if (drivers.error || vehicles.error || assignments.error) throw new Error("Não foi possível carregar os estados Uber guardados.");
    const driverRows = drivers.data || [], vehicleRows = vehicles.data || [], assignmentRows = assignments.data || [];
    const today = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Lisbon",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

    const current = { service:0, online:0, offline:0, unknown:0 };
    for (const driver of driverRows) {
      const label = statusLabel(driver.uber_realtime_status || driver.uber_status);
      if (label === "Online com serviço") current.service++;
      else if (label === "Online sem serviço") current.online++;
      else if (label === "Fora de serviço") current.offline++;
      else current.unknown++;
    }

    const outdated = driverRows.filter(driver => statusLabel(driver.uber_realtime_status || driver.uber_status) !== "Sem dados" && oldStatus(driver)).length;

    const driverById = new Map(driverRows.map(d => [d.id, d]));
    const activeAssignments = assignmentRows.filter(a => (!a.active_from || a.active_from <= today) && (!a.active_until || a.active_until >= today));
    const vehicleState = vehicleRows.map(v => {
      const assignment = activeAssignments.find(a => a.vehicle_id === v.id);
      const driver = assignment ? driverById.get(assignment.driver_id) : null;
      const label = driver ? statusLabel(driver.uber_realtime_status || driver.uber_status) : "Sem dados";
      return { v, driver, label };
    });

    const content = document.querySelector("#content");
    if (!content || !canRender() || epoch !== authEpoch || document.querySelector("#s2tUberActivityPanel")) return;

    const panel = document.createElement("section");
    panel.id = "s2tUberActivityPanel";
    panel.className = "panel";
    panel.style.marginTop = "18px";
    panel.innerHTML = `
      <div class="panel-heading">
        <div>
          <h2>Últimos estados Uber registados</h2>
          <p class="section-copy">Estados guardados no Fleet, com a data do último registo em cada linha. Os registos antigos não indicam o estado atual. A quilometragem está no resumo Cartrack acima.</p>
        </div>
        <span class="tag ${outdated ? "expiring" : ""}">${outdated ? `${outdated} estados antigos ou sem data` : "Estados guardados"}</span>
      </div>
      <div class="status-strip" style="margin:0 0 16px 0">
        <article class="metric-card"><span>Online sem serviço</span><strong id="s2tUberOnline">${current.online}</strong><small>Último estado guardado</small></article>
        <article class="metric-card"><span>Online com serviço</span><strong id="s2tUberService">${current.service}</strong><small>Último estado guardado</small></article>
        <article class="metric-card"><span>Fora de serviço</span><strong id="s2tUberOffline">${current.offline}</strong><small>Último estado guardado</small></article>
        <article class="metric-card"><span>Sem estado Uber</span><strong>${current.unknown}</strong><small>Sem dados</small></article>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Viatura</th><th>Motorista</th><th>Estado de serviço registado</th><th>Data do estado (Lisboa)</th></tr></thead>
          <tbody>
            ${vehicleState.map(row => `<tr>
              <td><strong>${esc(row.v.plate)}</strong><br><span class="section-copy">${esc(row.v.brand)} ${esc(row.v.model)}</span></td>
              <td>${esc(row.driver?.full_name || row.driver?.name || "Sem motorista")}</td>
              <td><span class="tag ${row.driver && oldStatus(row.driver) ? "expiring" : statusClass(row.label)}">${esc(row.label)}</span>${row.driver && row.label !== "Sem dados" && oldStatus(row.driver) ? '<br><span class="section-copy">Estado antigo ou sem data</span>' : ""}</td>
              <td>${esc(statusDate(row.driver))}</td>
            </tr>`).join("") || "<tr><td colspan=\"4\">Sem viaturas.</td></tr>"}
          </tbody>
        </table>
      </div>
    `;

    content.appendChild(panel);
  }

  async function renderWhenReady() {
    if (!canRender() || loading || document.querySelector("#s2tUberActivityPanel")) return;
    const epoch = authEpoch;
    loading = true;
    try { await load(); }
    catch (error) {
      console.error("S2T activity panel", error);
      if (epoch === authEpoch && canRender() && !document.querySelector("#s2tUberActivityPanel")) {
        const panel = document.createElement("section");
        panel.id = "s2tUberActivityPanel"; panel.className = "panel";
        panel.textContent = "Não foi possível carregar os estados Uber guardados. Atualiza a página para tentar novamente.";
        document.querySelector("#content")?.appendChild(panel);
      }
    } finally {
      loading = false;
      if (epoch !== authEpoch && canRender()) renderWhenReady();
    }
  }

  const observer = new MutationObserver(() => renderWhenReady());
  window.addEventListener("load", () => {
    // Observe the whole app: the page title changes outside #content during navigation.
    observer.observe(document.body, { childList:true, subtree:true, characterData:true });
    renderWhenReady();
  });
})();