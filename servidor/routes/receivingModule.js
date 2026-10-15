const express = require('express');
const receiving = require('./receiving');
const createDocuments = require('./receivingDocuments');
const { ensureReceivingIndexes } = require('../services/receivingIndexes');
const router = express.Router();
router.use((_req, res, next) => {
  ensureReceivingIndexes().then(() => next()).catch(() => res.status(503).json({ message: 'O recebimento está preparando o banco de dados. Tente novamente.' }));
});
router.use(createDocuments({ authenticateReceiving: receiving.authenticateReceiving, findReceipt: receiving.findReceipt }));
router.use(receiving);
module.exports = router;
