const express = require('express');
const { addClient } = require('../services/ifoodSse');

const router = express.Router();

router.get('/stream', (req, res) => {
  req.socket?.setTimeout?.(0);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  addClient(res);
});

module.exports = router;
