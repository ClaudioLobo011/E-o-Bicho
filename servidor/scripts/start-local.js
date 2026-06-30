const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
let activeReplSet = null;

async function seedLocalDatabase() {
  const Store = require('../models/Store');
  const Deposit = require('../models/Deposit');
  const Pdv = require('../models/Pdv');
  const Product = require('../models/Product');
  const User = require('../models/User');

  let store = await Store.findOne({ nome: 'Loja Local Codex' });
  if (!store) store = await Store.create({ nome: 'Loja Local Codex' });

  let deposit = await Deposit.findOne({ empresa: store._id });
  if (!deposit) {
    deposit = await Deposit.create({
      codigo: 'LOCAL-DEP-001',
      nome: 'Deposito Local',
      empresa: store._id,
    });
  }

  let pdv = await Pdv.findOne({ codigo: 'LOCAL-PDV-001' });
  if (!pdv) {
    pdv = await Pdv.create({
      codigo: 'LOCAL-PDV-001',
      nome: 'PDV Local',
      empresa: store._id,
      configuracoesEstoque: { depositoPadrao: deposit._id },
    });
  }

  const email = process.env.LOCAL_DEV_EMAIL || 'admin.local@eobicho.test';
  const password = process.env.LOCAL_DEV_PASSWORD || `Local-${crypto.randomBytes(6).toString('hex')}`;
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      tipoConta: 'pessoa_fisica',
      email,
      senha: await bcrypt.hash(password, 10),
      celular: `119${Date.now().toString().slice(-8)}`,
      nomeCompleto: 'Administrador Local',
      role: 'admin',
      empresaPrincipal: store._id,
      empresas: [store._id],
      emailVerified: true,
    });
  }

  if (!await Product.exists({ cod: 'LOCAL-001' })) {
    await Product.create({
      cod: 'LOCAL-001',
      codbarras: '7890000000001',
      nome: 'Produto de Teste Local',
      custo: 5,
      venda: 10,
      ativo: true,
      estoques: [{ deposito: deposit._id, quantidade: 100, unidade: 'UN' }],
    });
  }

  console.log('Ambiente local criado:');
  console.log(`  API: http://localhost:${process.env.PORT}/api`);
  console.log(`  Usuario: ${email}`);
  console.log(`  Senha: ${user ? password : '(use LOCAL_DEV_PASSWORD do primeiro start)'}`);
  console.log(`  Loja: ${store._id}`);
  console.log(`  PDV: ${pdv._id}`);
}

async function main() {
  process.env.NODE_ENV = 'development';
  process.env.PORT = process.env.PORT || '3100';
  process.env.JWT_SECRET = process.env.JWT_SECRET || `local-${crypto.randomBytes(24).toString('hex')}`;
  process.env.MONGO_TRANSACTIONS_ENABLED = 'true';
  process.env.ALLOW_LOCAL_TEST_PAYMENTS = 'true';
  process.env.DISABLE_EXTERNAL_WORKERS = 'true';
  process.env.SKIP_MAIL_VERIFY = 'true';

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  activeReplSet = replSet;
  process.env.MONGO_URI = replSet.getUri('eobicho_local');

  const { startServer, server } = require('../server');
  await startServer();
  await seedLocalDatabase();

  const shutdown = async () => {
    await new Promise((resolve) => server.close(resolve));
    await replSet.stop();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Falha ao iniciar ambiente local:', error);
  if (activeReplSet) {
    void activeReplSet.stop().catch(() => {});
  }
  process.exitCode = 1;
});
