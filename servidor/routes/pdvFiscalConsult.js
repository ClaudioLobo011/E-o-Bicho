const mongoose = require('mongoose');
const { canAccessPdv } = require('./pdvNfse');
const { isValidNfeAccessKey } = require('../utils/purchaseNfeValidation');

const idOf = (value) => String(value?._id || value || '').trim();
const fail = (message, statusCode = 422) => Object.assign(new Error(message), { statusCode });

// This operation only asks SEFAZ about an existing key. It never emits a note,
// allocates a number, or changes the sale/NFS-e/payment records.
function createPdvFiscalConsultHandler(overrides = {}) {
  const Pdv = overrides.Pdv || require('../models/Pdv');
  const Store = overrides.Store || require('../models/Store');
  const Sale = overrides.Sale || require('../models/PdvStateSale');
  const State = overrides.State || require('../models/PdvStateNormalized');
  const consult = overrides.consult || require('../services/sefazTransmitter').consultNfceProtocolOnSefaz;
  const certificatePair = overrides.certificatePair || ((store) => {
    const { decryptBuffer, decryptText } = require('../utils/certificates');
    const { extractCertificatePair } = require('../services/nfceEmitter');
    if (!store.certificadoArquivoCriptografado || !store.certificadoSenhaCriptografada) {
      throw fail('Certificado do emitente não configurado para consultar a SEFAZ.');
    }
    return extractCertificatePair(decryptBuffer(store.certificadoArquivoCriptografado), decryptText(store.certificadoSenhaCriptografada));
  });

  return async (req, res) => {
    try {
      const pdvId = idOf(req.desktopHost?.pdv || req.params.id);
      const saleId = idOf(req.params.saleId);
      const accessKey = String(req.body?.accessKey || '').trim();
      const environment = req.body?.environment;
      if (!mongoose.isValidObjectId(pdvId) || !saleId || !/^\d{44}$/.test(accessKey) || !isValidNfeAccessKey(accessKey)
        || !['homologacao', 'producao'].includes(environment)) {
        throw fail('Informe a venda, a chave e o ambiente original da NFC-e para consultar.', 400);
      }
      const pdv = await Pdv.findById(pdvId).lean();
      if (!pdv) throw fail('PDV não encontrado.', 404);
      if (!canAccessPdv(req, pdv)) throw fail('Sem acesso à empresa deste PDV.', 403);
      const saleCode = String(req.body?.saleCode || '').trim();
      let record = await Sale.findOne({ pdv: pdvId, saleId }).lean();
      if (!record && req.desktopHost && saleCode) record = await Sale.findOne({ pdv: pdvId, saleCode }).lean();
      let sale = record?.payload;
      if (!sale) {
        const state = await State.findOne({ pdv: pdvId }).lean();
        sale = state?.completedSales?.find((entry) => idOf(entry.id || entry._id) === saleId
          || (req.desktopHost && saleCode && String(entry.saleCode || '') === saleCode));
      }
      if (!sale) throw fail('Venda ainda não encontrada no servidor. Aguarde a sincronização.', 404);
      const store = await Store.findById(pdv.empresaEmitenteFiscal || pdv.empresa)
        .select('+certificadoArquivoCriptografado +certificadoSenhaCriptografada').lean();
      if (!store) throw fail('Empresa emitente não encontrada.');
      const cnpj = String(store.cnpj || '').replace(/\D/g, '');
      if (cnpj.length !== 14 || accessKey.slice(6, 20) !== cnpj || accessKey.slice(20, 22) !== '65'
        || Number(accessKey.slice(22, 25)) !== Number(pdv.serieNfce || pdv.serieNfe)) {
        throw fail('A chave não pertence ao emitente e à série de NFC-e deste PDV.', 409);
      }
      const enabled = pdv.ambientesHabilitados || [];
      if (!enabled.includes(environment) || (sale.fiscalEnvironment && sale.fiscalEnvironment !== environment)) {
        throw fail('O ambiente da consulta não corresponde ao ambiente fiscal da venda/PDV.', 409);
      }
      if (sale.fiscalAccessKey && sale.fiscalAccessKey !== accessKey) {
        throw fail('A venda já possui outra chave fiscal. Consulte o documento registrado antes de retransmitir.', 409);
      }
      const uf = String(store.uf || '').trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(uf)) throw fail('UF do emitente não configurada.');
      const pair = certificatePair(store);
      const result = await consult({ accessKey, environment, uf, certificate: pair.certificatePem,
        certificateChain: pair.certificateChain, privateKey: pair.privateKeyPem });
      const cStat = String(result.consultaStatus || result.status || '');
      const protocol = String(result.protocol || '');
      const authorized = ['100', '150'].includes(cStat) || ['100', '150'].includes(String(result.authorizationStatus || ''))
        || Boolean(sale.fiscalProtocol) || sale.fiscalStatus === 'emitted';
      // An outage, denial, cancellation or contradictory protocol is never proof
      // that a document can be changed and resubmitted.
      const notFound = cStat === '217' && !authorized && !protocol && !result.authorizationStatus;
      return res.json({ accessKey, environment, cStat, authorized, notFound, protocol,
        message: result.message || result.consultaMessage || '', consultedAt: new Date().toISOString() });
    } catch (error) {
      return res.status(error.statusCode || 503).json({
        message: error.statusCode ? error.message : 'Não foi possível confirmar a situação da NFC-e na SEFAZ. Nenhum XML foi alterado. Tente consultar novamente.',
        code: 'NFCE_CONSULT_FAILED',
      });
    }
  };
}

module.exports = { createPdvFiscalConsultHandler };
