const ledger = require('./customerCreditLedger');
function register(router, authenticateHost) {
  const handle = operation => async (req, res) => {
    try { return res.json(await operation(req)); }
    catch (error) { return res.status(error.status || 503).json({ message: error.message, code: error.code || 'CUSTOMER_CREDIT_UNAVAILABLE' }); }
  };
  router.get('/customer-credit/:customerId', authenticateHost, handle(req => ledger.balance(req.params.customerId)));
  for (const action of ['use', 'reverse']) router.post(`/customer-credit/${action}`, authenticateHost, handle(req => ledger[action]({
    scope: `pdv:${req.desktopHost.pdv}`, eventId: String(req.body?.eventId || ''),
    customerId: String(req.body?.customerId || ''), amount: req.body?.amount,
  })));
}
module.exports = { register };
