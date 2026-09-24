// Read-only: does not create notes, sequences, indexes, sales or fiscal rules.
const path = require('node:path');
const crypto = require('node:crypto');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const mongoose = require('mongoose');
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);
const { decryptBuffer, decryptText } = require('../utils/certificates');
const { extractCertificatePair } = require('../services/nfceEmitter');
const { createTransport } = require('../services/nfseTransport');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000, autoCreate: false, autoIndex: false });
    const stores = await mongoose.connection.collection('stores').find({}).toArray();
    const services = await mongoose.connection.collection('services').find({ ativo: { $ne: false } }, { projection: { fiscalPorEmpresa: 1 } }).toArray();
    const rules = await mongoose.connection.collection('fiscaldefaultrules').find({ tipo: 'servico' }, { projection: { empresa: 1 } }).toArray();
    const pdvs = await mongoose.connection.collection('pdvs').find({}, { projection: { nome: 1, codigo: 1, empresa: 1, empresaEmitenteFiscal: 1, ativo: 1 } }).toArray();
    const output = [];
    for (const store of stores) {
      const item = { company: store.nome, municipality: store.municipio, enabled: store.nfse?.enabled === true, hasMunicipalRegistration: Boolean(store.inscricaoMunicipal), serviceRules: rules.filter(rule => String(rule.empresa) === String(store._id)).length, activeServices: services.length, linkedServices: services.filter(service => service.fiscalPorEmpresa?.[String(store._id)]?.fiscalRuleCode).length, certificateReadable: false, certificateValid: false, probe: 'not_requested' };
      try {
        const pair = extractCertificatePair(decryptBuffer(store.certificadoArquivoCriptografado), decryptText(store.certificadoSenhaCriptografada));
        const cert = new crypto.X509Certificate(pair.certificatePem);
        item.certificateReadable = true; item.certificateExpiry = new Date(cert.validTo).toISOString();
        item.certificateValid = Date.now() >= new Date(cert.validFrom).getTime() && Date.now() < new Date(cert.validTo).getTime();
        if (process.argv.includes('--probe') && item.certificateValid) {
          // A read-only lookup of an unused DPS identifier verifies TLS and API reachability.
          const dpsId = `DPS${store.codigoIbgeMunicipio}2${String(store.cnpj).replace(/\D/g, '')}49999000000000000001`;
          try { await createTransport(pair, { timeoutMs: 15000 }).queryDps('homologacao', dpsId); item.probe = 'connected_document_found'; }
          catch (error) { item.probe = error.statusCode ? `http_${error.statusCode}` : 'connection_failed'; item.probeCodes = error.codes || []; }
        }
      } catch (error) { item.certificateIssue = error.code || error.name || 'CERTIFICATE_UNAVAILABLE'; }
      output.push(item);
    }
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'read-only', companies: output,
      pointsOfSale: pdvs.map(pdv => ({ code: pdv.codigo, name: pdv.nome, active: pdv.ativo,
        company: stores.find(store => String(store._id) === String(pdv.empresa))?.nome || 'Não localizada',
        fiscalIssuer: stores.find(store => String(store._id) === String(pdv.empresaEmitenteFiscal || pdv.empresa))?.nome || 'Não localizado' }))
    }, null, 2));
  } catch (error) { console.error(JSON.stringify({ error: error.name, code: error.code || 'READINESS_FAILED' })); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
})();
