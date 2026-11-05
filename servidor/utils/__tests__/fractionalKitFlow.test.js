const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Product = require('../../models/Product');
const { adjustProductStockForDeposit } = require('../inventoryStock');
test('kit receipt adds one of each size; loose sale only removes selected size', async () => {
    const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    try {
        await mongoose.connect(mongo.getUri());
        const depositId = new mongoose.Types.ObjectId();
        const kids = await Product.create(['P','M','G'].map(cod => ({ cod, codbarras: cod, nome: cod, custo: 119/3, venda: 50, unidade: 'UN' })));
        const parent = await Product.create({ cod: 'KIT', codbarras: 'KIT', nome: 'Kit', custo: 119, venda: 150, unidade: 'UN', fracionado: { ativo: true, itens: kids.map(p => ({ produto: p._id, quantidadeOrigem: 1, quantidadeFracionada: 1 })) } });
        await adjustProductStockForDeposit({ productId: parent._id, depositId, quantity: 2 });
        assert.equal((await Product.findById(parent._id)).stock, 2);
        for (const kid of kids) assert.equal((await Product.findById(kid._id)).stock, 2);
        await adjustProductStockForDeposit({ productId: kids[0]._id, depositId, quantity: -1 });
        assert.equal((await Product.findById(parent._id)).stock, 1);
        assert.equal((await Product.findById(kids[0]._id)).stock, 1);
        assert.equal((await Product.findById(kids[1]._id)).stock, 2);
        await adjustProductStockForDeposit({ productId: parent._id, depositId, quantity: -1 });
        assert.equal((await Product.findById(parent._id)).stock, 0);
        assert.equal((await Product.findById(kids[0]._id)).stock, 0);
        assert.equal((await Product.findById(kids[1]._id)).stock, 1);
    } finally { await mongoose.disconnect(); await mongo.stop(); }
});
