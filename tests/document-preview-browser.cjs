// Run with Playwright, Chromium and the PDF.js build referenced by the portal.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.FLEET_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const pdfBuild = process.env.FLEET_PDFJS_BUILD || path.dirname(require.resolve('pdfjs-dist/build/pdf.min.js'));

function blankPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>',
    ...Array(2).fill('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << >> >>'),
  ];
  let file = '%PDF-1.4\n';
  const offsets = objects.map((value, i) => {
    const offset = file.length;
    file += (i + 1) + ' 0 obj\n' + value + '\nendobj\n';
    return offset;
  });
  const start = file.length;
  file += 'xref\n0 5\n0000000000 65535 f \n' + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('');
  return file + 'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n' + start + '\n%%EOF\n';
}

function fixture({ role, pdf }) {
  const profile = { id: 'user', role, status: 'Ativo', full_name: 'Teste', email: 'user@example.invalid' };
  const driver = { id: 'driver', profile_id: profile.id, status: 'Ativo' };
  const docs = ['pdf', 'png'].map(ext => ({
    id: ext, name: 'Teste.' + ext, driver_id: role === 'driver' ? driver.id : null,
    original_file_name: 'Teste.' + ext, mime_type: ext === 'png' ? 'image/png' : 'application/pdf',
    drive_file_id: ext,
  }));
  let onAuthChange, signedIn = true;
  window.endFixtureSession = () => { signedIn = false; onAuthChange('SIGNED_OUT'); };
  window.supabase = { createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: signedIn ? { user: profile, access_token: 'fixture-token' } : null } }),
      onAuthStateChange(fn) { onAuthChange = fn; },
    },
    from(table) {
      const data = { profiles: profile, drivers: [driver], documents: docs }[table] || [];
      const q = {
        select: () => q, in: () => q, eq: () => q, order: () => q, range: () => q, single: () => q, limit: () => q,
        then(resolve) { resolve({ data, error: null, count: 0 }); },
      };
      return q;
    },
    rpc: async () => ({ data: null }),
  }) };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, options) => {
    if (!String(url).endsWith('/functions/v1/document-access')) return realFetch(url, options);
    if (window.holdDocument) await new Promise(resolve => { window.releaseDocument = resolve; });
    const png = JSON.parse(options.body).document_id === 'png';
    const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    return new Response(png ? Uint8Array.from(atob(image), c => c.charCodeAt(0)) : pdf, {
      headers: { 'content-type': png ? 'image/png' : 'application/pdf' },
    });
  };
}

async function check(browser, entry, role) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    await context.addInitScript(fixture, { role, pdf: blankPdf() });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://fleet.invalid') {
        const pathname = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
        const file = path.resolve(root, '.' + pathname);
        if (file.startsWith(root + path.sep)) return route.fulfill({ path: file });
      }
      if (url.origin === 'https://cdnjs.cloudflare.com' && ['/ajax/libs/pdf.js/3.11.174/pdf.min.js', '/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'].includes(url.pathname)) {
        return route.fulfill({ path: path.join(pdfBuild, path.basename(url.pathname)), headers: { 'access-control-allow-origin': '*', 'content-type': 'text/javascript' } });
      }
      if (url.origin === 'https://cdn.jsdelivr.net') return route.fulfill({ body: '', contentType: 'text/javascript' });
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('https://fleet.invalid' + entry);
    await page.locator('[data-view="documents"]').click();
    if (role === 'admin') {
      // Keep a fetch pending across the auth callback, then wait for the actual consumer.
      const result = page.evaluate(async () => {
        window.holdDocument = true;
        try { await downloadDocument('pdf'); return 'completed'; } catch { return 'cancelled'; }
      });
      await page.waitForFunction(() => typeof window.releaseDocument === 'function');
      await page.evaluate(() => { window.endFixtureSession(); window.releaseDocument(); });
      assert.equal(await result, 'cancelled');
      assert.equal(await page.evaluate(() => documentBlobCache.size), 0);
    } else {
      await page.locator('[data-open-doc="pdf"]').click();
      await page.locator('canvas[aria-label="Página 2 de 2"]').waitFor();
      await page.getByRole('button', { name: 'Fechar', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('#documentViewerContent').childElementCount);
      await page.locator('[data-open-doc="png"]').click();
      await page.waitForFunction(() => document.querySelector('#documentViewerContent img')?.naturalWidth === 1);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#documentViewerContent').childElementCount);
      for (const action of ['close', 'logout']) {
        const pending = page.evaluate(async () => {
          window.holdDocument = true; window.releaseDocument = null; await openDocument('pdf');
        });
        await page.waitForFunction(() => typeof window.releaseDocument === 'function');
        if (action === 'close') await page.locator('#closeDocumentViewer').click();
        else await page.evaluate(() => window.endFixtureSession());
        await page.evaluate(() => window.releaseDocument());
        await pending;
        await page.waitForFunction(() => !document.querySelector('#documentViewerModal').open &&
          !document.querySelector('#documentViewerContent').childElementCount);
      }
    }
    assert.deepEqual(errors, []);
    console.log('PASS', entry, role);
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.FLEET_CHROMIUM_PATH, headless: true,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
  try {
    await check(browser, '/', 'driver');
    await check(browser, '/teste/', 'driver');
    await check(browser, '/', 'admin');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
