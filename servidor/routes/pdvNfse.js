const mongoose = require('mongoose');
const { hasAdminMasterGlobalAccess } = require('../utils/adminMasterMode');
const { getPdvNfseConfiguration } = require('../utils/nfseEnvironment');

const idOf = (value) => String(value?._id || value || '').trim();
const staffRoles = new Set(['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master']);

function canAccessPdv(req, pdv) {
  if (req.desktopHost) {
    return idOf(req.desktopHost.pdv) === idOf(pdv)
      && idOf(req.desktopHost.empresa) === idOf(pdv.empresa)
      && pdv.desktop?.status !== 'suspenso';
  }
  if (!staffRoles.has(req.user?.role)) return false;
  if (hasAdminMasterGlobalAccess(req, req.user)) return true;
  return (req.user.storeIds || []).map(idOf).includes(idOf(pdv.empresa));
}

// The fiscal document is persisted independently of the mutable sale snapshot.
// These handlers never create a payment, inventory movement or another sale.
function createPdvNfseHandlers(overrides = {}) {
  const Pdv = overrides.Pdv || require('../models/Pdv');
  const Store = overrides.Store || require('../models/Store');
  const Sale = overrides.Sale || require('../models/PdvStateSale');
  const State = overrides.State || require('../models/PdvStateNormalized');
  const service = () => overrides.service || require('../services/nfseService');

  async function context(req, { certificate = false } = {}) {
    const pdvId = idOf(req.params.id || req.desktopHost?.pdv);
    const saleId = idOf(req.params.saleId);
    if (!mongoose.isValidObjectId(pdvId) || !saleId) {
      throw Object.assign(new Error('Informe um PDV e uma venda válidos.'), { statusCode: 400 });
    }
    const pdv = await Pdv.findById(pdvId).lean();
    if (!pdv) throw Object.assign(new Error('PDV não encontrado.'), { statusCode: 404 });
    if (!canAccessPdv(req, pdv)) throw Object.assign(new Error('Sem acesso à empresa deste PDV.'), { statusCode: 403 });
    let record = await Sale.findOne({ pdv: pdvId, saleId }).lean();
    const saleCode = String(req.body?.saleCode || req.query?.saleCode || '').trim();
    if (!record && req.desktopHost && saleCode) record = await Sale.findOne({ pdv: pdvId, saleCode }).lean();
    let sale = record?.payload;
    if (!sale) {
      const state = await State.findOne({ pdv: pdvId }).lean();
      sale = state?.completedSales?.find((entry) => idOf(entry.id || entry._id) === saleId
        || (req.desktopHost && saleCode && String(entry.saleCode || '') === saleCode));
    }
    if (!sale) throw Object.assign(new Error('Venda ainda não encontrada no servidor. Aguarde a sincronização.'), { statusCode: 404 });
    sale = { ...sale, id: idOf(sale.id || sale._id || record?.saleId || saleId) };
    let query = Store.findById(pdv.empresaEmitenteFiscal || pdv.empresa);
    if (certificate) query = query.select('+certificadoArquivoCriptografado +certificadoSenhaCriptografada');
    const store = await query.lean();
    if (!store) throw Object.assign(new Error('Empresa emitente não encontrada.'), { statusCode: 422 });
    return { pdv, store, sale };
  }

  const handler = (operation) => async (req, res) => {
    try {
      const ctx = await context(req, { certificate: operation !== 'list' });
      if (operation !== 'list' && ['cancelled', 'cancelado'].includes(ctx.sale.status)) {
        return res.status(409).json({ message: 'Não é possível emitir NFS-e para uma venda cancelada.' });
      }
      const requested = req.body?.environment;
      const pdvEnvironment = getPdvNfseConfiguration(ctx.pdv, ctx.store).environment;
      if (operation !== 'list' && requested && (!['homologacao', 'producao'].includes(requested)
        || (requested === 'producao' && pdvEnvironment !== 'producao'))) {
        return res.status(422).json({ message: 'O ambiente solicitado não está habilitado para NFS-e neste PDV.' });
      }
      const fn = { list: 'listSaleNfse', preview: 'previewSaleNfse', emit: 'emitSaleNfse' }[operation];
      // O serviço resolve o ambiente pela venda/documento; o cadastro atual não
      // pode esconder o histórico nem promover uma venda de teste para produção.
      const result = await service()[fn]({ ...ctx, ...(operation !== 'list' && requested ? { environment: requested } : {}) });
      for (const document of result.documents || []) {
        if (document.status === 'authorized' && /^https:\/\//.test(document.consultationUrl || '')) {
          document.qrCodeImage = await require('qrcode').toDataURL(document.consultationUrl, { width: 240, margin: 2, errorCorrectionLevel: 'M' });
        }
      }
      return res.json(result);
    } catch (error) {
      const status = Number(error.statusCode || error.status);
      return res.status(status >= 400 && status < 600 ? status : 422).json({
        message: error.message || 'Não foi possível processar a NFS-e.',
        code: error.code || 'NFSE_ERROR',
        ...(Array.isArray(error.issues) ? { issues: error.issues } : {}),
        ...(error.progress ? { progress: error.progress } : {}),
      });
    }
  };
  return { emit: handler('emit'), preview: handler('preview'), list: handler('list') };
}

module.exports = { createPdvNfseHandlers, canAccessPdv };
