const express = require('express');
const router = express.Router();
const { importProducts } = require('../utils/productImporter');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

// ROTA: POST /api/jobs/import-products
// DESCRIÇÃO: Inicia o processo de importação de produtos da planilha.
router.post(
  '/import-products',
  requireAuth,
  authorizeRoles('admin', 'admin_master'),
  (req, res) => {
    const io = req.app.get('socketio');

    res
      .status(202)
      .json({ message: 'Processo de importação iniciado. Acompanhe o progresso em tempo real.' });

    // Inicia a importação em segundo plano, passando o socket para feedback
    importProducts(io);
  }
);

module.exports = router;
