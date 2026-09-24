const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../pdvDesktop.js'), 'utf8');

test('sincronização desktop preserva escolha explícita do tomador e cliente comercial nas vendas e deliveries', async () => {
  const start = source.indexOf("  if (event.type === 'cash.opened')", source.indexOf('async function materializeDesktopEvent('));
  const end = source.indexOf('  await pdvDomain.enqueuePdvStateWrite(', start);
  for (const type of ['sale.completed', 'delivery.registered', 'delivery.finalized']) {
    for (const flag of ['not_informed', 'identified', 'automatic', undefined]) {
      const payload = { customerId: 'commercial', customerName: 'Cliente comercial', customerDocument: '52998224725', ...(flag === undefined ? {} : { nfseCustomerIdentification: flag }) };
      const context = vm.createContext({ source: payload, event: { type }, clean: value => String(value || '').trim(), hydrateSaleItems: async items => items, hydratePayments: async payments => payments });
      const result = await vm.runInContext(`(async () => { let action, payload; ${source.slice(start, end)} return { action, payload }; })()`, context);
      const expected = type === 'delivery.finalized' && flag === undefined ? undefined : flag === 'not_informed' ? flag : 'identified';
      assert.equal(result.payload.nfseCustomerIdentification, expected, `${type}/${flag}`);
      assert.equal(result.payload.customerName, 'Cliente comercial'); assert.equal(result.payload.customerDocument, '52998224725');
      if (type === 'sale.completed') assert.equal(result.payload.customerId, 'commercial'); else assert.equal(result.payload.customer.id, 'commercial');
    }
  }
});

function dateContext() {
  const context = vm.createContext({ clean: (value) => String(value ?? '').trim(), Intl, Date, userName: () => 'Cliente teste', deriveAppointmentStatus: () => 'finalizado' });
  const start = source.indexOf('function desktopServiceDate(');
  const end = source.indexOf('function appointmentOccurrencesForDesktop(', start);
  vm.runInContext(source.slice(start, end), context);
  return context;
}

test('competência desktop usa data individual e fallback em São Paulo na virada do mês', () => {
  const { desktopServiceDate } = dateContext();
  const fallback = '2026-09-01T01:30:00.000Z';
  assert.equal(desktopServiceDate({}, fallback), '2026-08-31');
  for (const field of ['serviceDate', 'dataPrestacao', 'appointmentDate', 'date', 'data']) {
    assert.equal(desktopServiceDate({ [field]: '2026-07-12' }, fallback), '2026-07-12', field);
  }
  assert.equal(desktopServiceDate({ serviceDate: '2026-09-01T01:30:00.000Z' }), '2026-08-31');
});

test('serviços de ocorrências Clubinho preservam datas próprias ao sincronizar para o desktop', () => {
  const { appointmentForDesktop } = dateContext();
  const result = appointmentForDesktop({ _id: 'a', scheduledAt: '2026-09-23T12:00:00Z', itens: [
    { servico: { _id: 's1', nome: 'Banho' }, data: '2026-08-12', valor: 40 },
    { servico: { _id: 's2', nome: 'Tosa' }, data: '2026-09-03', valor: 50 },
  ] });
  assert.equal(result.services[0].serviceDate, '2026-08-12');
  assert.equal(result.services[1].serviceDate, '2026-09-03');
  assert.equal(result.services[0].serviceId, 's1');
});

test('hidratação de venda não substitui serviço pelo produto de mesmo nome e preserva competência', async () => {
  const serviceId = '111111111111111111111111'; const productId = '222222222222222222222222';
  let query;
  const context = vm.createContext({ clean: (value) => String(value ?? '').trim(), mongoose: { Types: { ObjectId: { isValid: (value) => /^[a-f\d]{24}$/.test(String(value)) } } },
    Product: { find: (filter) => { query = filter; return { select: () => ({ lean: async () => [{ _id: productId, cod: 'p1', nome: 'Nome compartilhado', custo: 9 }] }) }; } } });
  const start = source.indexOf('  const hydrateSaleItems = async (');
  const end = source.indexOf("  if (event.type === 'cash.opened')", start);
  vm.runInContext(`${source.slice(start, end)};this.hydrate = hydrateSaleItems;`, context);
  const result = await context.hydrate([
    { productId: serviceId, serviceId, itemType: 'service', name: 'Nome compartilhado', serviceDate: '2026-08-12', appointmentId: 'a', quantity: 1, unitPrice: 80 },
    { productId, itemType: 'product', name: 'Nome compartilhado', quantity: 1, unitPrice: 100 },
    { productId: serviceId, name: 'Nome compartilhado', quantity: 2, unitPrice: 80, payload: { serviceId, itemType: 'service', serviceDate: '2026-07-11', appointmentId: 'b', quantity: 1 } },
  ]);
  assert.equal(result[0].productId, serviceId); assert.equal(result[0].serviceId, serviceId);
  assert.equal(result[0].serviceDate, '2026-08-12'); assert.equal(result[0].appointmentId, 'a');
  assert.equal(result[0].unitCost, undefined); assert.equal(result[1].unitCost, 9);
  assert.equal(result[2].productId, serviceId); assert.equal(result[2].serviceId, serviceId);
  assert.equal(result[2].serviceDate, '2026-07-11'); assert.equal(result[2].appointmentId, 'b');
  assert.equal(result[2].itemType, 'service'); assert.equal(result[2].unitCost, undefined);
  assert.equal(result[2].quantidade, 2);
  assert.ok(query); assert.ok(!JSON.stringify(query).includes(serviceId));
});
