const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const { hasAdminMasterGlobalAccess } = require('../utils/adminMasterMode');
const NfseDocument = require('../models/NfseDocument');
const { publicDocument, consultDocument, cancelDocument } = require('../services/nfseService');

router.use(requireAuth, authorizeRoles('admin'));
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
const canAccess = (req, storeId) => hasAdminMasterGlobalAccess(req, req.user) || (req.user?.storeIds || []).includes(String(storeId));
const handleError = (res, error) => res.status(error.status || error.statusCode || 502).json({ message: error.message || 'Não foi possível consultar o Emissor Nacional.', code: error.code, issues: error.issues });

router.get('/', async (req, res) => {
  try {
    const filter = { status: { $ne: 'superseded' } };
    const storeId = String(req.query.storeId || req.query.empresa || '').trim();
    if (storeId) {
      if (!mongoose.isValidObjectId(storeId)) return res.status(400).json({ message: 'Empresa inválida.' });
      if (!canAccess(req, storeId)) return res.status(403).json({ message: 'Acesso à empresa não autorizado.' });
      filter.store = storeId;
    } else if (!hasAdminMasterGlobalAccess(req, req.user)) filter.store = { $in: req.user.storeIds || [] };
    const status = String(req.query.status || '');
    if (status && ['pending', 'processing', 'authorized', 'rejected', 'unknown', 'cancelled'].includes(status)) filter.status = status;
    if (['homologacao', 'producao'].includes(req.query.environment)) filter.environment = req.query.environment;
    const limit = Math.min(250, Math.max(1, Number.parseInt(req.query.limit, 10) || 100));
    const docs = await NfseDocument.find(filter).select('pdv saleId saleCode store status number accessKey issuerName issuerCnpj verificationCode consultationUrl total environment issuedAt error dpsId dpsNumber dpsSerie cancellationReason cancelledAt snapshot.issuer.name snapshot.issuer.cnpj snapshot.group.rule.totalTributosModo snapshot.group.rule.pTotTribFed snapshot.group.rule.pTotTribEst snapshot.group.rule.pTotTribMun snapshot.group.rule.pTotTribSN snapshot.group.rule.tributosFonte snapshot.group.rule.tributosVersao snapshot.group.rule.tributosCodigoReferencia snapshot.group.rule.tributosVigenciaInicio snapshot.group.rule.tributosVigenciaFim').sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ documents: docs.map(publicDocument) });
  } catch (error) { handleError(res, error); }
});

router.param('id', async (req, res, next, value) => {
  try {
    if (!mongoose.isValidObjectId(value)) return res.status(400).json({ message: 'Documento inválido.' });
    const document = await NfseDocument.findById(value).select('+xmlContent').lean();
    if (!document) return res.status(404).json({ message: 'NFS-e não encontrada.' });
    if (!canAccess(req, document.store)) return res.status(403).json({ message: 'Acesso à empresa não autorizado.' });
    req.nfseDocument = document;
    next();
  } catch (error) { handleError(res, error); }
});

router.get('/:id', (req, res) => res.json({ document: publicDocument(req.nfseDocument) }));
router.get('/:id/xml', (req, res) => {
  if (!req.nfseDocument.xmlContent) return res.status(409).json({ message: 'A NFS-e ainda não possui XML autorizado.' });
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="NFSe-${req.nfseDocument.accessKey}.xml"`);
  res.send(req.nfseDocument.xmlContent);
});
router.post('/:id/refresh', async (req, res) => {
  try { res.json({ document: await consultDocument(req.params.id) }); } catch (error) { handleError(res, error); }
});
router.post('/:id/cancel', async (req, res) => {
  if (!['admin', 'admin_master', 'franqueado', 'franqueador'].includes(req.user.role)) return res.status(403).json({ message: 'Seu perfil não tem permissão para cancelar NFS-e.' });
  try { res.json({ document: await cancelDocument({ documentId: req.params.id, reason: req.body?.reason, reasonCode: req.body?.reasonCode }) }); } catch (error) { handleError(res, error); }
});

module.exports = router;
