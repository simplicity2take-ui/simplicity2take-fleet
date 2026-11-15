const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function modalHarness(portal, options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', portal), 'utf8');
  const start = source.indexOf('async function submitModal(event) {');
  const end = source.indexOf('\n}\n', start) + 3;
  assert(start >= 0 && end > start, 'Modal submit handler must remain available');
  const button = { disabled: false, textContent: 'Guardar' };
  const events = { submits: 0, saves: 0, closes: 0, opens: 0, loads: 0, renders: 0, toasts: [] };
  let unblock;
  const blocked = new Promise(resolve => { unblock = resolve; });
  const state = { editing: { type: 'document', id: '' } };
  class FormDataStub {
    constructor(form) {
      assert.equal(form, selectors.form);
      if (options.formThrows) throw new Error('form unavailable');
    }
    *entries() {
      yield ['name', 'Seguro'];
      yield ['type', 'Carta Verde'];
    }
    getAll(field) {
      assert.equal(field, 'viewerDriverIds');
      return ['driver-1'];
    }
  }
  const selectors = {
    form: { querySelector(selector) {
      assert.equal(selector, 'button[type="submit"]');
      return options.buttonMissing ? null : button;
    } },
    modal: { close() { events.closes++; }, showModal() { events.opens++; } },
    modalTitle: { textContent: '' },
    modalFields: { innerHTML: '' }
  };
  const context = {
    state, selectors, FormData: FormDataStub,
    modalFields: (type) => 'form-' + type,
    async saveDocument(values, viewers, id) {
      events.saves++;
      assert.equal(values.name, 'Seguro');
      assert.deepEqual(Array.from(viewers), ['driver-1']);
      assert.equal(id, '');
      if (options.failFirst && events.saves === 1) throw new Error('upload failed');
      if (options.block) await blocked;
    },
    async loadBackendData() {
      events.loads++;
      if (options.loadThrows) throw new Error('backend refresh failed');
    },
    renderApp() {
      events.renders++;
      if (options.renderThrows) throw new Error('render failed');
    },
    showToast(message) { events.toasts.push(message); },
    console: { error() {} }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const guardStart = source.indexOf('function allowAdminModalClose(');
  const guardEnd = source.indexOf('function modalFields(', guardStart);
  assert(guardStart >= 0 && guardEnd > guardStart);
  vm.runInContext(source.slice(guardStart, guardEnd), context);
  const submit = () => {
    events.submits++;
    return context.submitModal({ preventDefault() {} });
  };
  return { submit, unblock, button, events, state, context, source };
}

for (const portal of ['app.js', 'teste/app.js']) {
  test(portal + ': overlapping submit events share one document write', async () => {
    const h = modalHarness(portal, { block: true });
    const first = h.submit();
    const second = h.submit();
    await second;
    assert.equal(h.events.saves, 1, 'Only one upload is in flight');
    assert.equal(h.events.closes, 0);
    assert.equal(h.button.disabled, true);
    assert.equal(h.state.modalSaveInFlight, true);

    h.unblock();
    await first;
    assert.equal(h.events.closes, 1);
    assert.equal(h.events.loads, 1);
    assert.equal(h.events.renders, 1);
    assert.equal(h.state.modalSaveInFlight, false);
    assert.equal(h.button.disabled, false);
    assert.equal(h.button.textContent, 'Guardar');
  });

  test(portal + ': Escape and close buttons cannot dismiss an unresolved save', async () => {
    const h = modalHarness(portal, { block: true });
    const saving = h.submit();
    let cancelled = false;
    assert.equal(h.context.allowAdminModalClose({
      preventDefault() { cancelled = true; }
    }), false);
    assert.equal(cancelled, true, 'Escape must be prevented during upload');
    assert.match(h.source, /selectors\.modal\?\.addEventListener\("cancel", allowAdminModalClose\)/);
    assert.match(h.source, /if \(allowAdminModalClose\(\)\) selectors\.modal\?\.close\(\)/);
    assert.equal(h.events.closes, 0);
    h.unblock();
    await saving;
    let preventedAfter = false;
    assert.equal(h.context.allowAdminModalClose({
      preventDefault() { preventedAfter = true; }
    }), true);
    assert.equal(preventedAfter, false);
  });

  test(portal + ': a different modal cannot replace a pending document save', async () => {
    const h = modalHarness(portal, { block: true });
    const originalEditing = h.state.editing;
    const saving = h.submit();
    h.context.openModal('vehicle');
    assert.strictEqual(h.state.editing, originalEditing);
    assert.equal(h.events.opens, 0);
    assert.equal(h.events.saves, 1);
    h.unblock();
    await saving;
    h.context.openModal('vehicle');
    assert.equal(h.events.opens, 1);
    assert.equal(h.state.editing.type, 'vehicle');
    assert.equal(h.context.allowAdminModalClose(), true);
  });

  test(portal + ': document save failure releases the submit lock for retry', async () => {
    const h = modalHarness(portal, { failFirst: true });
    await h.submit();
    assert.equal(h.events.saves, 1);
    assert.equal(h.events.closes, 0);
    assert.equal(h.state.modalSaveInFlight, false);
    assert.equal(h.button.disabled, false);
    assert.equal(h.events.toasts[0], 'upload failed');
    await h.submit();
    assert.equal(h.events.saves, 2);
    assert.equal(h.events.closes, 1);
    assert.equal(h.events.toasts.length, 1);
  });

  test(portal + ': successful save followed by failed data refresh reports saved changes', async () => {
    const h = modalHarness(portal, { loadThrows: true });
    await h.submit();
    assert.equal(h.events.saves, 1);
    assert.equal(h.events.closes, 1);
    assert.equal(h.events.loads, 1);
    assert.equal(h.events.renders, 0);
    assert.equal(h.events.toasts.length, 1);
    assert.match(h.events.toasts[0], /^Alterações guardadas, mas não foi possível atualizar a lista/);
    assert.equal(h.state.modalSaveInFlight, false);
    assert.equal(h.button.disabled, false);
  });

  test(portal + ': rendering failure after save does not report a failed write', async () => {
    const h = modalHarness(portal, { renderThrows: true });
    await h.submit();
    assert.equal(h.events.saves, 1);
    assert.equal(h.events.closes, 1);
    assert.equal(h.events.loads, 1);
    assert.equal(h.events.renders, 1);
    assert.equal(h.events.toasts.length, 1);
    assert.match(h.events.toasts[0], /^Alterações guardadas, mas não foi possível atualizar a lista/);
    assert.equal(h.state.modalSaveInFlight, false);
  });

  test(portal + ': missing submit control does not permanently lock document saving', async () => {
    const h = modalHarness(portal, { buttonMissing: true });
    await h.submit();
    assert.equal(h.events.saves, 0);
    assert.equal(h.events.closes, 0);
    assert.equal(h.state.modalSaveInFlight, false);
    assert.equal(h.events.toasts[0], 'Formulário indisponível. Abra-o novamente.');
    assert.equal(h.context.allowAdminModalClose(), true);
  });

  test(portal + ': errors while reading form also release the submit lock', async () => {
    const h = modalHarness(portal, { formThrows: true });
    await h.submit();
    assert.equal(h.events.saves, 0);
    assert.equal(h.state.modalSaveInFlight, false);
    assert.equal(h.button.disabled, false);
    assert.equal(h.events.toasts[0], 'form unavailable');
  });
}
