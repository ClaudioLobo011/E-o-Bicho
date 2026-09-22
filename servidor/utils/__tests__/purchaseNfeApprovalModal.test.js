const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../../../pages/admin/admin-compras-fornecedor-entrada-nfe.html'), 'utf8');
const start = html.indexOf('const closeApprovalReview =');
const end = html.indexOf('approvalCancelButtons.forEach', start);

function setup() {
  function element(hidden = false) {
    const classes = new Set(hidden ? ['hidden'] : []);
    return { checked: false, disabled: false, textContent: '', focus() {}, setAttribute() {},
      classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c),
        toggle(c, force) { if (force) classes.add(c); else classes.delete(c); } } };
  }
  const modal = element(true), warning = element(true), consent = element(), button = element(), details = element();
  warning.querySelector = () => details;
  modal.querySelector = (s) => s.includes('warning') ? warning : consent;
  const context = vm.createContext({
    approvalReviewModal: modal, approvalConfirmButton: button,
    approvalReviewResolver: null, approvalReviewPreviousFocus: null,
    companySelect: { value: 'company-1', selectedOptions: [{ textContent: 'Empresa teste' }] },
    supplierSelect: null, lastNfeData: { dest: { name: 'Destinatário teste' } },
    approvalCompany: element(), approvalSupplier: element(), approvalDocument: element(),
    approvalTotal: element(), approvalStock: element(), approvalDuplicates: element(),
    nfeNumberInput: { value: '123' }, nfeSeriesInput: null, nfeTypeSelect: { value: 'NF' },
    formatWorkspaceCurrency: String, document: { body: element(), activeElement: null },
    HTMLElement: class {}, requestAnimationFrame: (fn) => fn(),
  });
  vm.runInContext(html.slice(start, end) + '\nthis.openReview = requestApprovalReview; this.closeReview = closeApprovalReview;', context);
  return { context, modal, warning, consent, button, details };
}
const readiness = { noteTotal: 10, items: [{}], duplicates: [], duplicatesTotal: 0,
  recipientMismatch: { confirmed: true, companyId: 'company-1', companyDocument: '111', destinationDocument: '222', accessKey: 'key' } };

test('modal exige consentimento, permite cancelar e reinicia confirmação a cada abertura', async () => {
  const { context, modal, warning, consent, button, details } = setup();
  const first = context.openReview(readiness);
  assert.equal(warning.classList.contains('hidden'), false);
  assert.equal(button.disabled, true);
  assert.match(details.textContent, /Empresa teste.*111.*Destinatário teste.*222/);
  context.closeReview(true);
  assert.equal(modal.classList.contains('hidden'), false);
  context.closeReview(false);
  assert.equal(await first, false);
  const second = context.openReview(readiness);
  consent.checked = true; consent.onchange();
  assert.equal(button.disabled, false);
  context.closeReview(true);
  assert.equal(await second, true);
  const third = context.openReview(readiness);
  assert.equal(consent.checked, false);
  assert.equal(button.disabled, true);
  context.closeReview(false);
  assert.equal(await third, false);
});

test('destinatário compatível mantém aprovação normal sem consentimento extra', async () => {
  const { context, warning, button } = setup();
  const result = context.openReview({ ...readiness, recipientMismatch: null });
  assert.equal(warning.classList.contains('hidden'), true);
  assert.equal(button.disabled, false);
  context.closeReview(true);
  assert.equal(await result, true);
});

test('scripts inline da página são sintaticamente válidos', () => {
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new vm.Script(match[1]);
  }
});
