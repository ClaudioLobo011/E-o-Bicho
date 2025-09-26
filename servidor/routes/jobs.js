const express = require('express');
const router = express.Router();
const multer = require('multer');
const { importProducts, parseProductsFromBuffer } = require('../utils/productImporter');
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
  (req, res) => {
    const io = req.app.get('socketio');

    if (!req.file) {
      return res.status(400).json({ message: 'Nenhum arquivo foi enviado.' });
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
    importProducts(io, productsFromExcel);
  }
);

module.exports = router;
