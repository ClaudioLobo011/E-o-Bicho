const express = require('express');
const router = express.Router();
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const { verifyAndLinkProductImages } = require('../services/productImageVerification');

let lastResult = null;
let isProcessing = false;

router.get('/imagens/status', requireAuth, authorizeRoles('funcionario', 'admin', 'admin_master'), (req, res) => {
  if (!lastResult) {
    return res.status(404).json({ message: 'Nenhuma verificação anterior foi encontrada.' });
  }

  return res.json(lastResult);
});

router.post('/imagens/verificar', requireAuth, authorizeRoles('funcionario', 'admin', 'admin_master'), async (req, res) => {
  if (isProcessing) {
    return res.status(409).json({ message: 'Uma verificação já está em andamento. Aguarde a conclusão.' });
  }

  isProcessing = true;

  try {
    const result = await verifyAndLinkProductImages();
    lastResult = result;
    return res.json(result);
  } catch (error) {
    console.error('Erro ao verificar imagens de produtos:', error);
    const message = error?.message || 'Falha ao executar a verificação de imagens.';
    return res.status(500).json({ message });
  } finally {
    isProcessing = false;
  }
});

module.exports = router;
