(() => {
  let active = null;
  const pending = new Map();

  function clear() {
    active = null;
    const dialog = document.getElementById('manualOdometerDialog');
    if (!dialog) return;
    if (dialog.open) dialog.close();
    dialog.querySelector('form').reset();
    for (const node of dialog.querySelectorAll('[data-value]')) node.textContent = '';
  }

  function comparisonNote(manualKm, manualTime, automatic) {
    if (!automatic || !Number.isSafeInteger(manualKm) || manualKm < 0 ||
        !Number.isFinite(manualTime) || manualTime > Date.now()) return '';
    // The dashboard reading is entered in whole km. A fractional difference
    // below one km can result from the two displays' precision.
    const difference = manualKm - automatic.km;
    if (Math.abs(difference) < 1) return '';
    if (manualTime === automatic.at) return ' · Confirmar: valores diferentes no mesmo instante.';
    if (manualTime > automatic.at && difference < 0) return ' · Confirmar: inferior ao CarTrack anterior.';
    if (manualTime < automatic.at && difference > 0) return ' · Confirmar: superior ao CarTrack posterior.';
    return '';
  }

  async function open({vehicle, client, getUser, cartrack}) {
    const user = getUser();
    if (user?.role !== 'admin' || !user.id || !vehicle?.id) return;
    clear();
    const dialog = document.getElementById('manualOdometerDialog');
    const form = dialog.querySelector('form');
    const input = form.elements.km;
    const submit = form.querySelector('[type=submit]');
    const status = dialog.querySelector('[data-status]');
    const list = dialog.querySelector('ol');
    const context = {userId:user.id, vehicleId:vehicle.id};
    active = context;
    const current = () => active === context && dialog.open && getUser()?.id === user.id && getUser()?.role === 'admin';
    let ready = false;
    dialog.querySelector('h2').textContent = 'Leituras manuais · ' + vehicle.plate;
    dialog.querySelector('[data-cartrack]').textContent = cartrack.label;
    dialog.querySelector('[data-close]').onclick = clear;
    dialog.onclose = () => { if (!dialog.open) clear(); };
    dialog.showModal();

    async function refresh(saved = false) {
      ready = false;
      submit.disabled = true;
      status.textContent = saved ? 'Leitura registada. A atualizar histórico…' : 'A consultar histórico…';
      try {
        const {data, error} = await client.from('fleet_manual_odometer')
          .select('recorded_at,km,recorded_by,request_id').eq('vehicle_id', vehicle.id)
          .order('recorded_at', {ascending:false}).order('recorded_by').order('request_id').limit(10);
        if (!current()) return;
        if (error || !Array.isArray(data)) throw Error('read');
        list.replaceChildren(...data.map(row => {
          const li = document.createElement('li');
          const date = new Date(row.recorded_at);
          const km = typeof row.km === 'string' && /^\d+(?:\.0+)?$/.test(row.km) ? Number(row.km) : row.km;
          const at = date.toLocaleString('pt-PT', {timeZone:'Europe/Lisbon'});
          li.textContent = `${Number(row.km).toLocaleString('pt-PT')} km · ${at} (Lisboa) · ${row.recorded_by === user.id ? 'Registada por si' : 'Outro administrador'}`;
          li.textContent += comparisonNote(km, date.getTime(), cartrack.reading);
          return li;
        }));
        status.textContent = saved ? 'Leitura registada.' : data.length ? '' : 'Sem leituras manuais.';
        ready = true;
        submit.disabled = false;
      } catch {
        if (current()) status.textContent = (saved ? 'Leitura registada. ' : '') + 'Histórico indisponível. Fecha e volta a abrir para atualizar.';
      }
    }

    form.onsubmit = async event => {
      event.preventDefault();
      if (!ready || !current()) return;
      const km = input.valueAsNumber;
      if (!Number.isSafeInteger(km) || km < 0 || !form.reportValidity()) return;
      ready = false;
      submit.disabled = true;
      input.disabled = true;
      status.textContent = 'A registar…';
      // Recover the same command on a transport failure, including a page reload.
      const key = 'fleet.manual-odometer.' + user.id + '.' + vehicle.id;
      try {
        let request = pending.get(key);
        try { request ??= JSON.parse(sessionStorage.getItem(key)); } catch {}
        if (!request || request.km !== km || !request.id) request = {km, id:crypto.randomUUID()};
        pending.set(key, request);
        try { sessionStorage.setItem(key, JSON.stringify(request)); } catch {}
        const {data, error} = await client.rpc('fleet_record_manual_odometer', {
          p_vehicle_id:vehicle.id, p_request_id:request.id, p_km:km
        });
        if (!current()) return;
        if (error || !data) throw Error('unconfirmed');
        pending.delete(key);
        try { sessionStorage.removeItem(key); } catch {}
        form.reset();
        await refresh(true);
      } catch {
        if (current()) {
          status.textContent = 'Registo por confirmar. Podes repetir o mesmo valor para confirmar o pedido.';
          ready = true;
          submit.disabled = false;
        }
      } finally {
        if (current()) input.disabled = false;
      }
    };
    input.disabled = false;
    await refresh();
  }
  window.FleetManualOdometer = {open, clear};
})();
