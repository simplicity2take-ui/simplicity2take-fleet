// Run with Playwright and Chromium. All portal assets and responses come from local fixtures.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.FLEET_PLAYWRIGHT_MODULE || 'playwright');

function installFixture() {
  const profile = { id: 'admin', role: 'admin', status: 'Ativo', full_name: 'Administrador de teste' };
  const vehicle = { id: 'vehicle', plate: 'AA-00-AA' };
  const driver = { id: 'driver', full_name: 'Motorista de teste' };
  const vehicleEvent = { vehicle_id: vehicle.id, driver_id: driver.id, vehicle_plate: vehicle.plate };
  const tables = {
    profiles: [profile], drivers: [driver], vehicles: [vehicle],
    platform_trip_records: [{
      ...vehicleEvent, id: 'trip', source_trip_id: 'source', platform: 'bolt', order_status: 'completed',
      finished_at: '2026-11-10T10:30:00Z'
    }],
    vehicle_shift_events: [
      { ...vehicleEvent, id: 'entry', event_kind: 'entry', registered_at: '2026-11-10T09:00:00Z' },
      { ...vehicleEvent, id: 'exit', event_kind: 'exit', registered_at: '2026-11-10T11:00:00Z' }
    ]
  };
  window.fixture = { partial: false, reads: 0 };
  window.supabase = { createClient: () => ({
    auth: {
      onAuthStateChange() {},
      async getSession() { return { data: { session: { user: { id: profile.id } } } }; }
    },
    from(table) {
      let rows = tables[table] || [];
      let count = rows.length;
      let single = false;
      return {
        select() { return this; },
        eq(key, value) { rows = rows.filter(row => row[key] === value); count = rows.length; return this; },
        in() { return this; }, order() { return this; }, limit() { return this; },
        or() { return this; }, gte() { return this; }, lt() { return this; },
        single() { single = true; return this; },
        range(start, end) { rows = rows.slice(start, end + 1); return this; },
        then(resolve) {
          window.fixture.reads++;
          return resolve({ data: single ? rows[0] : rows, count: window.fixture.partial && table === 'vehicles' ? null : count });
        }
      };
    }
  }) };
}

async function checkMobile(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const origin = 'http://fleet.test';
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && /^\/(?:[\w.-]+)?$/.test(url.pathname)) {
      return route.fulfill({ path: path.join(__dirname, '..', url.pathname.slice(1) || 'index.html') });
    }
    if (url.href === 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2') {
      return route.fulfill({ contentType: 'application/javascript', body: '(' + installFixture.toString() + ')()' });
    }
    return route.abort();
  });
  try {
    await page.clock.setFixedTime(new Date('2026-11-10T12:00:00Z'));
    await page.goto(origin);
    await page.locator('[data-view="activity"]').click();
    await page.locator('a[href="#activity-conference"]').tap();
    const panel = page.locator('#activity-conference');
    const status = panel.getByRole('status');
    await status.filter({ hasText: 'Todas as páginas' }).waitFor();
    assert.equal(await panel.locator('tbody tr').count(), 1);
    const reads = await page.evaluate(() => window.fixture.reads);
    await panel.locator('summary').click();
    const detail = panel.locator('details[open]');
    assert.match(await detail.innerText(), /Recolha: Sem registo/);
    assert.match(await detail.innerText(), /Entrada declarada:/);
    assert.equal(await page.evaluate(() => window.fixture.reads), reads);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'Page overflows the mobile viewport');
    assert.ok(await panel.locator('.table-wrap').evaluate(element =>
      element.scrollWidth > element.clientWidth && getComputedStyle(element).overflowX === 'auto'
    ), 'The wide table must scroll within the panel');
    const search = panel.getByLabel('Motorista ou matrícula');
    const submit = panel.getByRole('button', { name: 'Conferir viagens e turnos' });
    await search.fill('ZZ99ZZ');
    await submit.click();
    await status.filter({ hasText: '0 combinações apresentadas' }).waitFor();
    await page.evaluate(() => { window.fixture.partial = true; });
    await search.fill('AA00AA');
    await submit.click();
    await status.filter({ hasText: 'Consulta parcial' }).waitFor();
    await panel.locator('summary').click();
    assert.match(await detail.innerText(), /Consulta parcial: declaração por confirmar/);
    assert.doesNotMatch(await detail.innerText(), /Entrada declarada:/);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.FLEET_CHROMIUM_PATH });
  try {
    await checkMobile(browser);
    console.log('PASS mobile conference: navigation, details, filtering, partial results and viewport');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
