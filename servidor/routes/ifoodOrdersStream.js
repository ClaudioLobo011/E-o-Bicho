const express = require('express');
const { addClient } = require('../services/ifoodSse');

const router = express.Router();

router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  addClient(res);
});

module.exports = router;
