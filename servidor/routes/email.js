const express = require('express');
const router = express.Router();

const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const { sendMail } = require('../utils/mailer');

/**
 * POST /api/email/test
 * Body: { to, subject, text?, html? }
 */
router.post('/test', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { to, subject, text, html } = req.body || {};
    if (!to || !subject) {
      return res.status(400).json({ message: 'Parâmetros inválidos: "to" e "subject" são obrigatórios.' });
    }

    const result = await sendMail({
      to,
      subject,
      text: text || undefined,
      html: html || `<p>Teste de envio via Zoho SMTP – <b>${new Date().toLocaleString('pt-BR')}</b></p>`,
    });

    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[email:test] erro:', err);
    return res.status(500).json({ message: 'Erro ao enviar e-mail', detail: err.message });
  }
});

module.exports = router;
