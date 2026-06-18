#!/usr/bin/env node

require('dotenv').config();

const mongoose = require('mongoose');
const Product = require('../models/Product');
const Pdv = require('../models/Pdv');
const Store = require('../models/Store');
const { emitPdvSaleFiscal } = require('../services/nfceEmitter');

const CST_CASES = ['00', '10', '20', '30', '40', '41', '50', '51', '60', '70', '90'];
const STORE_NAME_PATTERN = /vila\s+isabel/i;
const PDV_CODE = process.env.NFCE_CST_TEST_PDV || 'PDV-001';
const PRODUCT_CODE_PREFIX = 'HOM-CST-';
const UNIT_PRICE = 0.5;

const baseFiscal = (cst) => ({
  origem: '0',
  cest: '',
  csosn: '',
  cst,
  cfop: {
    nfe: { dentroEstado: '5102', foraEstado: '6102' },
    nfce: { dentroEstado: '5102', foraEstado: '6102' },
  },
  pis: {
    codigo: '01',
    cst: '07',
    aliquota: 0,
    tipoCalculo: 'percentual',
  },
  cofins: {
    codigo: '01',
    cst: '07',
    aliquota: 0,
    tipoCalculo: 'percentual',
  },
  ipi: {
    cst: '99',
    codigoEnquadramento: '999',
    aliquota: 0,
    tipoCalculo: 'percentual',
  },
  status: {
    nfe: 'aprovado',
    nfce: 'aprovado',
  },
});

const buildSale = ({ product, cst }) => ({
  id: `hom-cst-${cst}-${Date.now()}`,
  saleCode: `HOM-CST-${cst}-${Date.now()}`,
  receiptSnapshot: {
    meta: {
      operador: 'Teste homologacao CST',
    },
    totais: {
      total: UNIT_PRICE,
      totalLiquido: UNIT_PRICE,
      desconto: 0,
      acrescimo: 0,
      troco: 0,
    },
    pagamentos: {
      items: [
        {
          forma: 'dinheiro',
          valor: UNIT_PRICE,
        },
      ],
    },
  },
  items: [
    {
      productId: String(product._id),
      productSnapshot: {
        _id: String(product._id),
        nome: product.nome,
        ncm: product.ncm,
        unidade: product.unidade,
      },
      internalCode: product.cod,
      name: product.nome,
      quantity: 1,
      unitPrice: UNIT_PRICE,
      totalPrice: UNIT_PRICE,
      unit: product.unidade,
    },
  ],
});

const ensureProductForCst = async ({ cst, store }) => {
  const cod = `${PRODUCT_CODE_PREFIX}${cst}`;
  const fiscal = baseFiscal(cst);
  const product = await Product.findOneAndUpdate(
    { cod },
    {
      $set: {
        cod,
        codbarras: cod,
        nome: `HOMOLOGACAO NFC-E CST ${cst}`,
        descricao: 'Produto temporario para teste de schema CST em homologacao',
        custo: UNIT_PRICE,
        venda: UNIT_PRICE,
        unidade: 'UN',
        ncm: '23099010',
        stock: 999,
        inativo: false,
        naoMostrarNoSite: true,
        fiscal,
        [`fiscalPorEmpresa.${String(store._id)}`]: fiscal,
      },
    },
    { upsert: true, new: true, runValidators: true }
  );
  return product;
};

const cleanupProducts = async () => {
  await Product.deleteMany({ cod: { $in: CST_CASES.map((cst) => `${PRODUCT_CODE_PREFIX}${cst}`) } });
};

const main = async () => {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI/MONGO_URI nao configurado.');
  }

  await mongoose.connect(mongoUri);

  const store = await Store.findOne({ nome: STORE_NAME_PATTERN }).select(
    '+certificadoArquivoCriptografado +certificadoSenhaCriptografada +cscTokenHomologacaoCriptografado +cscTokenProducaoCriptografado'
  );
  if (!store) {
    throw new Error('Empresa Vila Isabel nao encontrada.');
  }
  if (!store.certificadoArquivoCriptografado || !store.certificadoSenhaCriptografada) {
    throw new Error('Empresa Vila Isabel sem certificado configurado.');
  }
  if (!store.cscIdHomologacao || !store.cscTokenHomologacaoCriptografado) {
    throw new Error('Empresa Vila Isabel sem CSC de homologacao configurado.');
  }

  const pdv = await Pdv.findOne({ codigo: PDV_CODE, empresa: store._id });
  if (!pdv) {
    throw new Error(`PDV ${PDV_CODE} nao encontrado para Vila Isabel.`);
  }
  if (!Array.isArray(pdv.ambientesHabilitados) || !pdv.ambientesHabilitados.includes('homologacao')) {
    throw new Error(`PDV ${PDV_CODE} nao esta habilitado para homologacao.`);
  }
  const serie = String(pdv.serieNfce || pdv.serieNfe || '').trim();
  if (!serie) {
    throw new Error(`PDV ${PDV_CODE} sem serie NFC-e configurada.`);
  }

  const startNumber = Number.isInteger(pdv.numeroNfceAtual)
    ? pdv.numeroNfceAtual
    : Number.isInteger(pdv.numeroNfceInicial)
      ? pdv.numeroNfceInicial - 1
      : 0;

  const results = [];
  let currentNumber = startNumber;

  try {
    for (const cst of CST_CASES) {
      const numero = currentNumber + 1;
      const product = await ensureProductForCst({ cst, store });
      const sale = buildSale({ product, cst });

      process.stdout.write(`Emitindo CST ${cst} numero ${numero}... `);
      try {
        const emission = await emitPdvSaleFiscal({
          sale,
          pdv,
          store,
          emissionDate: new Date(),
          environment: 'homologacao',
          serie,
          numero,
        });

        const transmission = emission.transmission || {};
        const authorized = String(transmission.status || '') === '100';
        results.push({
          cst,
          numero,
          ok: authorized,
          status: transmission.status || '',
          message: transmission.message || '',
          protocol: transmission.protocol || '',
          accessKey: emission.accessKey || '',
        });
        console.log(`${transmission.status || 'sem status'} - ${transmission.message || 'sem mensagem'}`);

        if (authorized) {
          currentNumber = numero;
          await Pdv.updateOne({ _id: pdv._id }, { $set: { numeroNfceAtual: currentNumber } });
        }
      } catch (error) {
        results.push({
          cst,
          numero,
          ok: false,
          status: error?.cause?.details?.loteStatus || error?.details?.loteStatus || '',
          message:
            error?.cause?.details?.loteMessage ||
            error?.details?.loteMessage ||
            error?.message ||
            'erro desconhecido',
          accessKey: error?.xmlAccessKey || '',
        });
        console.log(`ERRO - ${error?.message || error}`);
      }
    }
  } finally {
    await cleanupProducts();
  }

  console.log(JSON.stringify({ pdv: PDV_CODE, serie, startNumber, finalNumber: currentNumber, results }, null, 2));
  const failed = results.filter((item) => !item.ok);
  if (failed.length) {
    process.exitCode = 1;
  }
};

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await mongoose.disconnect();
      } catch (_) {
        // ignore disconnect errors
      }
    });
}
