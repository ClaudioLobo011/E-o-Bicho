const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Product = require('../../models/Product');
const Store = require('../../models/Store');
const Deposit = require('../../models/Deposit');
const User = require('../../models/User');
const InventoryAdjustment = require('../../models/InventoryAdjustment');
const { adjustProductStockForDeposit } = require('../../utils/inventoryStock');

let mongo;

test.describe('Movimentação com produtos fracionados', () => {
  test.before(async () => {
    mongo = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(mongo.getUri(), { dbName: 'test-db' });
  });

  test.after(async () => {
    await mongoose.disconnect();
    if (mongo) {
      await mongo.stop();
    }
  });

  test.beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();
  });

  async function setupBaseDocuments() {
    const company = await Store.create({
      nome: 'Empresa Teste',
      nomeFantasia: 'Empresa Teste',
      cnpj: '12345678000199',
    });

    const deposit = await Deposit.create({
      codigo: 'D1',
      nome: 'Depósito Principal',
      empresa: company._id,
    });

    const user = await User.create({
      tipoConta: 'pessoa_fisica',
      email: 'admin@example.com',
      senha: 'hash',
      celular: '11999999999',
      nomeCompleto: 'Admin Teste',
      role: 'admin',
    });

    const child = await Product.create({
      cod: 'CHD1',
      codbarras: '0000000000010',
      nome: 'Produto Filho',
      custo: 10,
      venda: 15,
      unidade: 'UN',
      estoques: [
        { deposito: deposit._id, quantidade: 0, unidade: 'UN' },
      ],
    });

    const parent = await Product.create({
      cod: 'PAR1',
      codbarras: '0000000000001',
      nome: 'Produto Pai',
      custo: 30,
      venda: 45,
      unidade: 'CX',
      fracionado: {
        ativo: true,
        itens: [
          {
            produto: child._id,
            quantidadeOrigem: 1,
            quantidadeFracionada: 3,
          },
        ],
      },
      estoques: [
        { deposito: deposit._id, quantidade: 0, unidade: 'CX' },
      ],
    });

    return { company, deposit, user, parent, child };
  }

  async function performMovement(items, context) {
    const session = await mongoose.startSession();
    let record;
    await session.withTransaction(async () => {
      const factor = context.operation === 'saida' ? -1 : 1;
      const preparedItems = [];
      let totalQuantity = 0;
      let totalValue = 0;

      for (const item of items) {
        const delta = item.quantity * factor;
        await adjustProductStockForDeposit({
          productId: item.productId,
          depositId: context.depositId,
          quantity: delta,
          session,
          cascadeFractional: true,
        });

        preparedItems.push({
          product: item.productId,
          quantity: item.quantity,
          unitValue: item.unitValue ?? null,
        });

        totalQuantity += delta;
        if (item.unitValue) {
          totalValue += item.unitValue * item.quantity * factor;
        }
      }

      record = await InventoryAdjustment.create([
        {
          operation: context.operation,
          reason: context.reason,
          company: context.companyId,
          deposit: context.depositId,
          movementDate: new Date(),
          responsible: context.responsibleId,
          createdBy: context.creatorId || context.responsibleId,
          items: preparedItems,
          totalQuantity,
          totalValue,
        },
      ], { session });
    });
    await session.endSession();
    return record;
  }

  test('entrada com pai e filho soma quantidades fracionadas e soltas', async () => {
    const { company, deposit, user, parent, child } = await setupBaseDocuments();

    await performMovement([
      { productId: parent._id, quantity: 1 },
      { productId: child._id, quantity: 1 },
    ], {
      operation: 'entrada',
      reason: 'ajuste_inventario',
      companyId: company._id,
      depositId: deposit._id,
      responsibleId: user._id,
      creatorId: user._id,
    });

    const updatedChild = await Product.findById(child._id).lean();
    const updatedParent = await Product.findById(parent._id).lean();

    const childStock = updatedChild.estoques.find((entry) => entry.deposito.toString() === deposit._id.toString());
    const parentStock = updatedParent.estoques.find((entry) => entry.deposito.toString() === deposit._id.toString());

    assert.equal(childStock.quantidade, 4, 'filho deve receber 4 unidades (3 do pai + 1 solta)');
    assert.equal(parentStock.quantidade, 1, 'pai deve permanecer com 1 caixa');
  });

  test('ordem inversa (filho antes do pai) mantém resultado correto', async () => {
    const { company, deposit, user, parent, child } = await setupBaseDocuments();

    await performMovement([
      { productId: child._id, quantity: 1 },
      { productId: parent._id, quantity: 1 },
    ], {
      operation: 'entrada',
      reason: 'ajuste_inventario',
      companyId: company._id,
      depositId: deposit._id,
      responsibleId: user._id,
      creatorId: user._id,
    });

    const updatedChild = await Product.findById(child._id).lean();
    const childStock = updatedChild.estoques.find((entry) => entry.deposito.toString() === deposit._id.toString());

    assert.equal(childStock.quantidade, 4, 'filho deve receber 4 unidades independentemente da ordem');
  });
});
