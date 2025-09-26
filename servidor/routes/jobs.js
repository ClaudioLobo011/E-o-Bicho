const express = require('express');
const router = express.Router();
const multer = require('multer');
const { importProducts, parseProductsFromBuffer } = require('../utils/productImporter');
const Deposit = require('../models/Deposit');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

router.post(
  '/import-products/preview',
  requireAuth,
  authorizeRoles('admin', 'admin_master'),
  upload.single('file'),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo foi enviado.' });
      }

      const { products, warnings } = parseProductsFromBuffer(req.file.buffer);

      return res.status(200).json({
        products,
        warnings,
        total: products.length
      });
    } catch (error) {
      return res.status(400).json({ message: `Falha ao ler o arquivo: ${error.message}` });
    }
  }
);

// ROTA: POST /api/jobs/import-products
// DESCRIÇÃO: Inicia o processo de importação de produtos da planilha.
router.post(
  '/import-products',
  requireAuth,
  authorizeRoles('admin', 'admin_master'),
  upload.single('file'),
  async (req, res) => {
    const io = req.app.get('socketio');

    if (!req.file) {
      return res.status(400).json({ message: 'Nenhum arquivo foi enviado.' });
    }

    const { depositId, storeId } = req.body || {};

    if (!depositId) {
      return res.status(400).json({ message: 'Selecione um depósito válido para iniciar a importação.' });
    }

    let deposit;
    try {
      deposit = await Deposit.findById(depositId).populate('empresa').lean();
    } catch (error) {
      return res.status(400).json({ message: 'Depósito selecionado é inválido.' });
    }

    if (!deposit) {
      return res.status(404).json({ message: 'Depósito selecionado não foi encontrado.' });
    }

    if (storeId && deposit?.empresa?._id && deposit.empresa._id.toString() !== storeId.toString()) {
      return res.status(400).json({ message: 'O depósito selecionado não pertence à empresa informada.' });
    }

    let productsFromExcel;

    try {
      const parsedResult = parseProductsFromBuffer(req.file.buffer);
      productsFromExcel = parsedResult.products;

      if (productsFromExcel.length === 0) {
        return res.status(400).json({ message: 'Nenhum produto válido foi encontrado na planilha.' });
      }
    } catch (error) {
      return res.status(400).json({ message: `Falha ao processar o arquivo: ${error.message}` });
    }

    res
      .status(202)
      .json({ message: 'Processo de importação iniciado. Acompanhe o progresso em tempo real.' });

    // Inicia a importação em segundo plano, passando o socket para feedback
    importProducts(io, productsFromExcel, { deposit });
  }
);

module.exports = router;
