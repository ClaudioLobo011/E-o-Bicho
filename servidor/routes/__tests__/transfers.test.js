const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const router = require('../../routes/transfers');
const Transfer = require('../../models/Transfer');

const sampleObjectId = () => new mongoose.Types.ObjectId();

test('toISODateString returns ISO string for Date inputs and strings', () => {
    const date = new Date(Date.UTC(2024, 4, 9));
    assert.equal(router.toISODateString(date), '2024-05-09');
    assert.equal(router.toISODateString('2024-12-25T15:30:00Z'), '2024-12-25');
    assert.equal(router.toISODateString(null), '');
});

test('formatTransferDetails maps items and totals while respecting edit permissions', () => {
    const productId = sampleObjectId();
    const originDepositId = sampleObjectId();
    const destinationDepositId = sampleObjectId();
    const originCompanyId = sampleObjectId();
    const destinationCompanyId = sampleObjectId();
    const responsibleId = sampleObjectId();

    const transfer = {
        _id: sampleObjectId(),
        number: 42,
        requestDate: new Date(Date.UTC(2024, 6, 1)),
        status: 'aprovada',
        originDeposit: { _id: originDepositId, nome: 'Origem', codigo: 'OR1' },
        destinationDeposit: { _id: destinationDepositId, nome: 'Destino', codigo: 'DE1' },
        originCompany: { _id: originCompanyId, nome: 'Empresa Origem', nomeFantasia: 'Origem SA', cnpj: '123' },
        destinationCompany: {
            _id: destinationCompanyId,
            nome: 'Empresa Destino',
            nomeFantasia: 'Destino LTDA',
            cnpj: '456',
        },
        responsible: {
            _id: responsibleId,
            nomeCompleto: 'Usuário Teste',
            apelido: 'Teste',
            email: 'teste@example.com',
            role: 'admin',
        },
        referenceDocument: 'DOC-99',
        observations: 'Observação',
        transport: { mode: 'Rodoviário', vehicle: 'AAA-1234', driver: 'Fulano' },
        items: [
            {
                product: {
                    _id: productId,
                    nome: 'Produto Um',
                    cod: 'SKU-1',
                    codbarras: '0001',
                    unidade: 'CX',
                    venda: 29.9,
                    custo: 10.5,
                    peso: 1.25,
                },
                quantity: 3,
                unit: 'UN',
                lot: 'L001',
                validity: new Date(Date.UTC(2024, 7, 15)),
                unitWeight: 1.25,
                unitCost: 11,
                unitSale: 30,
            },
            {
                product: {
                    _id: sampleObjectId(),
                    nome: 'Produto Dois',
                    cod: 'SKU-2',
                    codbarras: '0002',
                    unidade: 'KG',
                    venda: 10,
                    custo: 4,
                    peso: 0.5,
                },
                quantity: 2,
                unit: 'KG',
                lot: '',
                validity: null,
                unitWeight: null,
                unitCost: null,
                unitSale: null,
                totalSale: 25,
            },
        ],
    };

    const formatted = router.formatTransferDetails(transfer);

    assert.equal(formatted.number, 42);
    assert.equal(formatted.canEdit, false, 'Approved transfers should not be editable');
    assert.equal(formatted.requestDate, '2024-07-01');
    assert.equal(formatted.items.length, 2);
    assert.equal(formatted.items[0].sku, 'SKU-1');
    assert.equal(formatted.items[0].validity, '2024-08-15');
    assert.equal(formatted.items[1].validity, '');
    assert.equal(formatted.items[1].totalSale, 25);
    assert.equal(formatted.totals.totalVolume, 5);
    assert.equal(formatted.totals.totalWeight, 4.75);
    assert.equal(formatted.totals.totalCost, 41);
    assert.equal(formatted.totals.totalSale, 115);
});

test('getNextTransferNumber increments from the latest stored transfer', async (t) => {
    t.mock.method(Transfer, 'findOne', () => ({
        sort() {
            return {
                lean: async () => ({ number: 7 }),
            };
        },
    }));
    const next = await router.getNextTransferNumber();
    assert.equal(next, 8);
});

test('loadTransferWithDetails returns formatted data when transfer exists', async (t) => {
    const sampleTransfer = {
        _id: sampleObjectId(),
        number: 12,
        requestDate: new Date(Date.UTC(2024, 0, 10)),
        status: 'solicitada',
        originDeposit: { _id: sampleObjectId(), nome: 'Orig', codigo: 'O1' },
        destinationDeposit: { _id: sampleObjectId(), nome: 'Dest', codigo: 'D1' },
        originCompany: { _id: sampleObjectId(), nome: 'Empresa O', cnpj: '789' },
        destinationCompany: { _id: sampleObjectId(), nome: 'Empresa D', cnpj: '012' },
        responsible: { _id: sampleObjectId(), nomeCompleto: 'Resp', email: 'resp@example.com', role: 'admin' },
        referenceDocument: '',
        observations: '',
        transport: { mode: '', vehicle: '', driver: '' },
        items: [],
    };

    t.mock.method(Transfer, 'findOne', () => ({
        populate() {
            return this;
        },
        lean: async () => sampleTransfer,
    }));

    const result = await router.loadTransferWithDetails({ number: 12 });
    assert.ok(result);
    assert.equal(result.number, 12);
    assert.equal(result.status, 'solicitada');
    assert.equal(result.canEdit, true);
});
