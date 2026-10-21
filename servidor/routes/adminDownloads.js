const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const authMiddleware = require('../middlewares/authMiddleware');

const router = express.Router();
router.get('/aspia', authMiddleware, (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  if (!['admin', 'admin_master'].includes(req.user?.role)) {
    return res.status(403).json({ message: 'O download do suporte remoto é restrito a administradores.' });
  }
  const file = process.env.ASPIA_HOST_PACKAGE_PATH ||
    path.join(__dirname, '..', 'private-downloads', 'Aspia-EoBicho-Host-Setup-2026.10.21.5.zip');
  if (!path.isAbsolute(file) || !fs.existsSync(file)) {
    return res.status(503).json({ message: 'O instalador do Aspia ainda não está disponível no servidor.' });
  }
  res.type('application/zip');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.download(file, 'Aspia-EoBicho-Host-Setup-2026.10.21.5.zip', (error) => {
    if (error && !res.headersSent) {
      res.status(503).json({ message: 'Não foi possível enviar o instalador do Aspia.' });
    }
  });
});
module.exports = router;
