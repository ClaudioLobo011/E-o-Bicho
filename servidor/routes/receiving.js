const express = require('express');
const crypto = require('crypto');
const requireAuth = require('../middlewares/requireAuth');
const Device = require('../models/ReceivingDevice');
const Receipt = require('../models/ReceivingReceipt');
const User = require('../models/User');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const Supplier = require('../models/Supplier');
const Product = require('../models/Product');
const service = require('../services/receivingService');

const router = express.Router();
const staffRoles = new Set(['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master']);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const normalizeStores = user => Array.from(new Set([user.empresaPrincipal, user.empresaContratual, ...(user.empresas || [])].filter(Boolean).map(String)));
async function attachActiveOwner(req, id) {
  const owner = await User.findById(id).select('role email dataDemissao empresaPrincipal empresaContratual empresas').lean();
  if (!owner || !staffRoles.has(owner.role) || (owner.dataDemissao && new Date(owner.dataDemissao) <= new Date())) {
    service.fail(401, 'Autorização de funcionário indisponível.', 'EMPLOYEE_UNAVAILABLE');
  }
  req.user = { ...(req.user || {}), id: String(owner._id), email: owner.email, role: owner.role, originalRole: owner.role, storeIds: normalizeStores(owner) };
}
const staffJwt = (req, res, next) => {
  if (/^Bearer (?:rc1_|sc1_)/.test(req.get('Authorization') || '')) return res.status(401).json({ message: 'Entre no site para gerenciar os coletores.' });
  requireAuth(req, res, error => {
    if (error) return next(error);
    Promise.resolve(attachActiveOwner(req, req.user.id)).then(() => next()).catch(next);
  });
};
const authenticateReceiving = (req, res, next) => {
  const authorization = req.get('Authorization') || '';
  if (!authorization.startsWith('Bearer rc1_')) return staffJwt(req, res, next);
  wrap(async () => {
    const token = /^Bearer (rc1_[a-f\d]{64})$/.exec(authorization)?.[1];
    if (!token) service.fail(401, 'Autorização de coletor inválida.');
    const device = await Device.findOne({ tokenHash: service.hash(token), revokedAt: null, scope: 'receiving:write' }).lean();
    if (!device) service.fail(401, 'Autorização revogada. Entre novamente.', 'DEVICE_REVOKED');
    await attachActiveOwner(req, device.owner);
    req.collector = device; next();
  })(req, res, next);
};
const deviceOwnership = req => service.isElevated(req) ? {} : { owner: req.user.id };

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.post('/devices', staffJwt, wrap(async (req, res) => {
  const { installationId, name } = req.body || {};
  if (typeof installationId !== 'string' || !service.UUID.test(installationId) || typeof name !== 'string' || !name.trim() || name.length > 120) {
    service.fail(400, 'Identificação do coletor inválida.');
  }
  const token = `rc1_${crypto.randomBytes(32).toString('hex')}`;
  const device = await Device.findOneAndUpdate({ owner: req.user.id, installationId }, {
    $set: { name: name.trim(), tokenHash: service.hash(token), scope: 'receiving:write', revokedAt: null },
  }, { upsert: true, new: true, runValidators: true });
  res.json({ token, deviceId: String(device._id), scope: 'receiving:write' });
}));
router.get('/devices', staffJwt, wrap(async (req, res) => {
  const devices = await Device.find(deviceOwnership(req)).select('_id name owner scope revokedAt createdAt updatedAt').sort({ createdAt: -1 }).lean();
  res.json({ devices });
}));
router.delete('/devices/:id', staffJwt, wrap(async (req, res) => {
  service.objectId(req.params.id);
  const device = await Device.findOneAndUpdate({ _id: req.params.id, ...deviceOwnership(req) }, { $set: { revokedAt: new Date() } }, { new: true });
  if (!device) service.fail(404, 'Coletor não encontrado.');
  res.json({ success: true });
}));

router.use(authenticateReceiving);
router.get('/meta', wrap(async (req, res) => {
  const companyIds = service.isElevated(req) ? null : req.user.storeIds;
  const [companies, deposits, suppliers] = await Promise.all([
    Store.find(companyIds ? { _id: { $in: companyIds } } : {}).select('_id codigo nome nomeFantasia').sort({ nome: 1 }).lean(),
    Deposit.find(companyIds ? { empresa: { $in: companyIds } } : {}).select('_id codigo nome empresa').sort({ nome: 1 }).lean(),
    Supplier.find({ 'flags.inactive': { $ne: true }, ...(companyIds ? { $or: [{ companies: { $in: companyIds } }, { companies: { $size: 0 } }, { companies: { $exists: false } }] } : {}) })
      .select('_id code legalName fantasyName cnpj companies').sort({ legalName: 1 }).limit(20000).lean(),
  ]);
  res.json({ companies, deposits, suppliers, canApproveStock: service.canApproveStock(req), limits: { maxLines: service.MAX_LINES, maxEvents: service.MAX_EVENTS, maxBatch: 200 } });
}));
router.get('/catalog', wrap(async (req, res) => {
  const products = await Product.find({}).select(service.productFields).sort({ _id: 1 }).limit(200001).lean();
  if (products.length > 200000) service.fail(413, 'Catálogo excede o limite de sincronização.');
  if (req.collector && !await Device.exists({ _id: req.collector._id, revokedAt: null })) service.fail(401, 'Autorização revogada.', 'DEVICE_REVOKED');
  res.json({ products: await service.appendReceivingBarcodes(products), total: products.length, generatedAt: new Date().toISOString() });
}));
router.get('/receipts', wrap(async (req, res) => {
  const filter = service.companyFilter(req);
  if (req.query.status) {
    if (!['draft', 'approved', 'test_approved', 'cancelled'].includes(req.query.status)) service.fail(400, 'Situação inválida.');
    filter.status = req.query.status;
  }
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const receipts = await Receipt.find(filter).select('-events').sort({ updatedAt: -1 }).limit(limit).lean();
  res.json({ receipts: receipts.map(receipt => service.receiptResponse(receipt, { summary: true })) });
}));
router.post('/receipts', wrap(async (req, res) => {
  res.status(201).json({ receipt: service.receiptResponse(await service.createReceipt(req, req.body)) });
}));
router.get('/receipts/:id', wrap(async (req, res) => {
  res.json({ receipt: service.receiptResponse(await service.findReceipt(req, req.params.id)) });
}));
router.patch('/receipts/:id', wrap(async (req, res) => {
  res.json({ receipt: service.receiptResponse(await service.patchReceipt(req, req.params.id, req.body)) });
}));
router.post('/receipts/:id/events', wrap(async (req, res) => {
  const result = await service.addEvents(req, req.params.id, req.body);
  res.json({ ...result, receipt: service.receiptResponse(result.receipt) });
}));
router.post('/receipts/:id/approve', wrap(async (req, res) => {
  res.json({ receipt: service.receiptResponse(await service.approveReceipt(req, req.params.id, req.body)) });
}));
router.post('/receipts/:id/cancel', wrap(async (req, res) => {
  const receipt = await service.findReceipt(req, req.params.id);
  service.requireDraft(receipt); service.requireVersion(receipt, req.body?.version);
  const cancelled = await Receipt.findOneAndUpdate({ _id: receipt._id, version: receipt.version, status: 'draft' },
    { $set: { status: 'cancelled', updatedBy: req.user.id }, $inc: { version: 1 } }, { new: true }).lean();
  if (!cancelled) service.fail(409, 'O recebimento mudou. Atualize antes de cancelar.', 'VERSION_CONFLICT');
  res.json({ receipt: service.receiptResponse(cancelled) });
}));
router.use((error, _req, res, _next) => {
  const safe = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599;
  if (!safe) console.error('[receiving]', error.name, error.code || '', error.message?.slice(0, 250));
  res.status(safe ? error.status : 500).json({ message: safe ? error.message : 'Não foi possível salvar o recebimento. Tente novamente.',
    code: safe ? error.code : 'RECEIVING_FAILED', ...(safe && error.details ? { details: error.details } : {}) });
});

module.exports = router;
module.exports.authenticateReceiving = authenticateReceiving;
module.exports.findReceipt = service.findReceipt;
module.exports.assertCompanyAccess = service.assertCompanyAccess;
