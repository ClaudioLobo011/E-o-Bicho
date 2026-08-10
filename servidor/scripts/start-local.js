const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
let activeReplSet = null;

async function seedLocalDatabase() {
  const Store = require('../models/Store');
  const Deposit = require('../models/Deposit');
  const Pdv = require('../models/Pdv');
  const Product = require('../models/Product');
  const User = require('../models/User');
  const Pet = require('../models/Pet');
  const UserAddress = require('../models/UserAddress');
  const PaymentMethod = require('../models/PaymentMethod');
  const BankAccount = require('../models/BankAccount');
  const AccountingAccount = require('../models/AccountingAccount');

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
  let bankAccount = await BankAccount.findOne({ company: store._id, alias: 'Conta Local PDV' });
  if (!bankAccount) bankAccount = await BankAccount.create({ company: store._id, bankCode: '001', bankName: 'Banco Local', agency: '0001', accountNumber: 'LOCAL-PDV-001', accountType: 'corrente', documentNumber: '00000000000100', alias: 'Conta Local PDV' });
  let accountingAccount = await AccountingAccount.findOne({ companies: store._id, code: 'LOCAL-CR-001' });
  if (!accountingAccount) accountingAccount = await AccountingAccount.create({ companies: [store._id], name: 'Contas a Receber Local', code: 'LOCAL-CR-001', type: 'analitica', paymentNature: 'contas_receber' });

  let pdv = await Pdv.findOne({ codigo: 'LOCAL-PDV-001' });
  if (!pdv) {
    pdv = await Pdv.create({
      codigo: 'LOCAL-PDV-001',
      nome: 'PDV Local',
      empresa: store._id,
      configuracoesEstoque: { depositoPadrao: deposit._id },
    });
  }
  pdv.tipoUso = 'executavel';
  pdv.modoTerminais = 'espelhado';
  pdv.configuracoesFiscal.tipoEmissaoPadrao = 'matricial';
  pdv.configuracoesEstoque.depositoPadrao = deposit._id;
  pdv.configuracoesFinanceiro.contaCorrente = bankAccount._id;
  pdv.configuracoesFinanceiro.contaContabilReceber = accountingAccount._id;
  pdv.desktop.status = 'ativo';
  await pdv.save();

  const email = process.env.LOCAL_DEV_EMAIL || 'admin.local@eobicho.test';
  const password = process.env.LOCAL_DEV_PASSWORD || 'TestePDV123!';
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
  } else if (!(await bcrypt.compare(password, user.senha))) {
    user.senha = await bcrypt.hash(password, 10);
    await user.save();
  }

  const customerEmail = 'cliente.local@eobicho.test';
  let customer = await User.findOne({ email: customerEmail });
  if (!customer) {
    customer = await User.create({
      tipoConta: 'pessoa_fisica',
      email: customerEmail,
      senha: await bcrypt.hash('ClienteTeste123!', 10),
      celular: '21900000001',
      nomeCompleto: 'Cliente Local',
      role: 'cliente',
      empresaPrincipal: store._id,
      empresas: [store._id],
      codigoCliente: 1001,
      emailVerified: true,
    });
  }
  if (!await UserAddress.exists({ user: customer._id })) {
    await UserAddress.create({ user: customer._id, cep: '20000000', logradouro: 'Rua de Teste', numero: '100', bairro: 'Centro', cidade: 'Rio de Janeiro', uf: 'RJ', isDefault: true });
  }
  if (!await Pet.exists({ owner: customer._id })) {
    await Pet.create({ owner: customer._id, codigoPet: 1001, nome: 'Bidu', tipo: 'cachorro', raca: 'vira-lata', sexo: 'macho', dataNascimento: new Date('2022-01-01T00:00:00Z') });
  }

  const sellerEmail = 'vendedor.local@eobicho.test';
  if (!await User.exists({ email: sellerEmail })) {
    await User.create({
      tipoConta: 'pessoa_fisica',
      email: sellerEmail,
      senha: await bcrypt.hash('VendedorTeste123!', 10),
      celular: '21900000002',
      nomeCompleto: 'Vendedor Local',
      role: 'funcionario',
      grupos: ['vendedor'],
      empresaPrincipal: store._id,
      empresas: [store._id],
      codigoCliente: 2001,
      emailVerified: true,
    });
  }

  const courierEmail = 'entregador.local@eobicho.test';
  if (!await User.exists({ email: courierEmail })) {
    await User.create({
      tipoConta: 'pessoa_fisica',
      email: courierEmail,
      senha: await bcrypt.hash('EntregadorTeste123!', 10),
      celular: '21900000003',
      nomeCompleto: 'Entregador Local',
      role: 'funcionario',
      grupos: ['entregador'],
      empresaPrincipal: store._id,
      empresas: [store._id],
      codigoCliente: 3001,
      emailVerified: true,
    });
  }

  const paymentMethods = [
    { code: 'DINHEIRO', name: 'Dinheiro', type: 'avista' },
    { code: 'PIX', name: 'Pix', type: 'avista' },
    { code: 'DEBITO', name: 'Debito', type: 'debito' },
    { code: 'CREDITO', name: 'Credito', type: 'credito' },
    { code: 'CREDIARIO', name: 'Crediario', type: 'crediario' },
  ];
  for (const paymentMethod of paymentMethods) {
    await PaymentMethod.updateOne(
      { company: store._id, code: paymentMethod.code },
      { $set: { ...paymentMethod, company: store._id } },
      { upsert: true, setDefaultsOnInsert: true }
    );
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
  console.log(`  Login de teste: ${email}`);
  console.log(`  Senha de teste: ${password}`);
  console.log(`  Loja: ${store._id}`);
  console.log(`  PDV: ${pdv._id}`);
}

async function main() {
  process.env.NODE_ENV = 'development';
  // O banco isolado de desenvolvimento nunca deve ocupar a porta do backend
  // conectado ao banco original. Use LOCAL_API_PORT para alterá-la de propósito.
  process.env.PORT = process.env.LOCAL_API_PORT || '3100';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'local-eobicho-test-only-secret';
  process.env.MONGO_TRANSACTIONS_ENABLED = 'true';
  process.env.ALLOW_LOCAL_TEST_PAYMENTS = 'true';
  process.env.DISABLE_EXTERNAL_WORKERS = 'true';
  process.env.SKIP_MAIL_VERIFY = 'true';
  process.env.LOCAL_DEV_EMAIL = process.env.LOCAL_DEV_EMAIL || 'admin.local@eobicho.test';
  process.env.LOCAL_DEV_PASSWORD = process.env.LOCAL_DEV_PASSWORD || 'TestePDV123!';

  console.log('============================================================');
  console.log(' ACESSO DO AMBIENTE LOCAL DE TESTES');
  console.log(` Login: ${process.env.LOCAL_DEV_EMAIL}`);
  console.log(` Senha: ${process.env.LOCAL_DEV_PASSWORD}`);
  console.log('============================================================');

  const mongoDataDir = path.resolve(
    process.env.LOCAL_MONGO_DATA_DIR || path.join(__dirname, '..', '..', '.codex-work', 'mongo-local')
  );
  const mongoPort = Number(process.env.LOCAL_MONGO_PORT || 61374);
  fs.mkdirSync(mongoDataDir, { recursive: true });
  console.log(` Banco local persistente: ${mongoDataDir}`);
  console.log(` Porta interna persistente: ${mongoPort}`);

  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ dbPath: mongoDataDir, port: mongoPort }],
  });
  activeReplSet = replSet;
  process.env.MONGO_URI = replSet.getUri('eobicho_local');

  const { startServer, server } = require('../server');
  await startServer();
  await seedLocalDatabase();

  const shutdown = async () => {
    await new Promise((resolve) => server.close(resolve));
    await replSet.stop({ doCleanup: false });
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Falha ao iniciar ambiente local:', error);
  if (activeReplSet) {
    void activeReplSet.stop({ doCleanup: false }).catch(() => {});
  }
  process.exitCode = 1;
});
