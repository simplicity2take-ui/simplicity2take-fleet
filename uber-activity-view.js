(() => {
  const SUPABASE_URL = "https://lmutpimlokagjwngqanx.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8NuXQQp9sef-eTwGMItD0Q_GyD1GBVS";
  const client = window.supabase?.createClient?.(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  if (!client) return;

  let period = "day";
  let lastRenderKey = "";

  const esc = value => String(value ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));

  const periodRange = key => {
    const now = new Date();
    const start = new Date(now);
    if (key === "day") start.setHours(0,0,0,0);
    if (key === "week") {
      const day = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - day);
      start.setHours(0,0,0,0);
    }
    if (key === "month") {
      start.setDate(1);
      start.setHours(0,0,0,0);
    }
    return { start, end: now };
  };

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
    const [drivers, vehicles, assignments] = await Promise.all([
      client.from("drivers").select("id,name,uber_driver_uuid,uber_realtime_status,uber_status"),
      client.from("vehicles").select("id,plate,brand,model"),
      client.from("vehicle_assignments").select("vehicle_id,driver_id,active_from,active_until")
    ]);
    const error = [drivers,vehicles,assignments].find(x => x.error)?.error;
    if (error) throw error;
    const snapshots = await client.from("cartrack_vehicle_snapshots")
      .select("*").order("observed_at", { ascending: true }).limit(10000);
    const snapshotRows = snapshots.error ? [] : (snapshots.data || []);

    const driverRows = drivers.data || [];
    const vehicleRows = vehicles.data || [];
    const assignmentRows = assignments.data || [];
    const today = new Date().toISOString().slice(0,10);

    const current = { service:0, online:0, offline:0, unknown:0 };
    for (const driver of driverRows) {
      const label = statusLabel(driver.uber_realtime_status || driver.uber_status);
      if (label === "Online com serviço") current.service++;
      else if (label === "Online sem serviço") current.online++;
      else if (label === "Fora de serviço") current.offline++;
      else current.unknown++;
    }

    const { start, end } = periodRange(period);
    const startMs = start.getTime(), endMs = end.getTime();
    const byVehicle = new Map();
    for (const row of snapshotRows) {
      const ts = new Date(row.observed_at).getTime();
      if (!Number.isFinite(ts) || ts < startMs || ts > endMs) continue;
      const key = row.vehicle_id || String(row.registration || "").toUpperCase();
      if (!byVehicle.has(key)) byVehicle.set(key, []);
      byVehicle.get(key).push(row);
    }

    let totalKm = 0;
    for (const rows of byVehicle.values()) {
      const values = rows.map(r => Number(r.odometer_km)).filter(Number.isFinite);
      if (values.length >= 2) totalKm += Math.max(values) - Math.min(values);
    }

    const driverById = new Map(driverRows.map(d => [d.id, d]));
    const activeAssignments = assignmentRows.filter(a => (!a.active_from || a.active_from <= today) && (!a.active_until || a.active_until >= today));
    const vehicleState = vehicleRows.map(v => {
      const assignment = activeAssignments.find(a => a.vehicle_id === v.id);
      const driver = assignment ? driverById.get(assignment.driver_id) : null;
      const label = driver ? statusLabel(driver.uber_realtime_status || driver.uber_status) : "Sem dados";
      return { v, driver, label };
    });

    const content = document.querySelector("#content");
    if (!content || document.querySelector("#s2tUberActivityPanel")) return;

    const panel = document.createElement("section");
    panel.id = "s2tUberActivityPanel";
    panel.className = "panel";
    panel.style.marginTop = "18px";
    panel.innerHTML = `
      <div class="panel-heading">
        <div>
          <h2>Atividade de serviço</h2>
          <p class="section-copy">Estado atual dos motoristas via Uber. Sem viagens, rendimentos, localização ou telemetria.</p>
        </div>
        <span class="tag active">Uber</span>
      </div>
      <div class="status-strip" style="margin:0 0 16px 0">
        <article class="metric-card"><span>Online sem serviço</span><strong id="s2tUberOnline">${current.online}</strong><small>Agora</small></article>
        <article class="metric-card"><span>Online com serviço</span><strong id="s2tUberService">${current.service}</strong><small>Agora</small></article>
        <article class="metric-card"><span>Fora de serviço</span><strong id="s2tUberOffline">${current.offline}</strong><small>Agora</small></article>
        <article class="metric-card"><span>Km Cartrack</span><strong id="s2tCartrackKm">${totalKm.toFixed(1)}</strong><small>${period === "day" ? "Hoje" : period === "week" ? "Esta semana" : "Este mês"}</small></article>
      </div>
      <div class="row-actions" style="margin-bottom:14px">
        <button class="mini-button" type="button" data-s2t-period="day">${period === "day" ? "✓ " : ""}Diário</button>
        <button class="mini-button" type="button" data-s2t-period="week">${period === "week" ? "✓ " : ""}Semanal</button>
        <button class="mini-button" type="button" data-s2t-period="month">${period === "month" ? "✓ " : ""}Mensal</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Viatura</th><th>Motorista</th><th>Estado de serviço</th></tr></thead>
          <tbody>
            ${vehicleState.map(row => `<tr>
              <td><strong>${esc(row.v.plate)}</strong><br><span class="section-copy">${esc(row.v.brand)} ${esc(row.v.model)}</span></td>
              <td>${esc(row.driver?.name || "Sem motorista")}</td>
              <td><span class="tag ${statusClass(row.label)}">${esc(row.label)}</span></td>
            </tr>`).join("") || "<tr><td colspan=\"3\">Sem viaturas.</td></tr>"}
          </tbody>
        </table>
      </div>
    `;

    content.appendChild(panel);
    panel.querySelectorAll("[data-s2t-period]").forEach(button => {
      button.addEventListener("click", async () => {
        period = button.dataset.s2tPeriod;
        panel.remove();
        await renderWhenReady(true);
      });
    });
  }

  async function renderWhenReady(force=false) {
    const title = document.querySelector("#pageTitle")?.textContent?.trim();
    if (title !== "Utilização da Frota") return;
    const key = title + "|" + period;
    if (!force && key === lastRenderKey && document.querySelector("#s2tUberActivityPanel")) return;
    try {
      await load();
      lastRenderKey = key;
    } catch (error) {
      console.error("S2T activity panel", error);
    }
  }

  const observer = new MutationObserver(() => renderWhenReady(false));
  window.addEventListener("load", () => {
    const target = document.querySelector("#content") || document.body;
    observer.observe(target, { childList:true, subtree:true });
    renderWhenReady(true);
  });
})();