// servidor/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');

// Carrega variáveis de ambiente antes de importar módulos que dependem delas
dotenv.config();

const { verifyMailer } = require('./utils/mailer');
const connectDB = require('./config/db');
const { startIfoodStatusPoller } = require('./services/ifoodStatusPoller');

connectDB();
verifyMailer();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const BODY_PARSER_LIMIT = '10mb';


// Middleware
app.set('socketio', io);
app.use(express.json({
  limit: BODY_PARSER_LIMIT,
  verify: (req, _res, buf) => {
    // guarda o raw para validação de assinatura (webhooks)
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: BODY_PARSER_LIMIT }));
app.use(cors());
app.use(express.static('public'));
app.use('/api/funcionarios', require('./routes/adminFuncionarios'));


// Rotas da API (mapeadas dinamicamente)
const routes = [
  { path: '/api/products', file: './routes/products' },
  { path: '/api/categories', file: './routes/categories' },
  { path: '/api/auth', file: './routes/auth' },
  { path: '/api/users', file: './routes/users' },
  { path: '/api/cart', file: './routes/cart' },
  { path: '/api/favorites', file: './routes/favorites' },
  { path: '/api/stores', file: './routes/stores' },
  { path: '/api/vehicles', file: './routes/vehicles' },
  { path: '/api/delivery-zones', file: './routes/deliveryZones' },
  { path: '/api/promocoes', file: './routes/promocoes' },
  { path: '/api/banners', file: './routes/banners' },
  { path: '/api/pets', file: './routes/pets' },
  { path: '/api/pdvs', file: './routes/pdvs' },
  { path: '/api/reports', file: './routes/reports' },
  { path: '/api/deposits', file: './routes/deposits' },
  { path: '/api/transfers', file: './routes/transfers' },
  { path: '/api/inventory-adjustments', file: './routes/inventoryAdjustments' },
  { path: '/api/payment-methods', file: './routes/paymentMethods' },
  { path: '/api/bank-accounts', file: './routes/bankAccounts' },
  { path: '/api/accounting-accounts', file: './routes/accountingAccounts' },
  { path: '/api/suppliers', file: './routes/suppliers' },
  { path: '/api/internacao', file: './routes/internacaoBoxes' },
  { path: '/api/internacao/parametros', file: './routes/internacaoParametros' },
  { path: '/api/purchase/nfe/drafts', file: './routes/purchaseNfeDrafts' },
  { path: '/api/accounts-payable', file: './routes/accountsPayable' },
  { path: '/api/accounts-receivable', file: './routes/accountsReceivable' },
  { path: '/api/jobs', file: './routes/jobs' },
  { path: '/api/addresses', file: './routes/addresses' },
  { path: '/api/shipping', file: './routes/shipping' },
  { path: '/api/admin/users', file: './routes/adminUsers' },
  { path: '/api/admin/funcionarios', file: './routes/adminFuncionarios' },
  { path: '/api/admin/grupos-usuarios', file: './routes/adminUserGroups' },
  { path: '/api/admin/servicos/grupos', file: './routes/adminServicosGrupos' },
  { path: '/api/admin/servicos/precos', file: './routes/adminServicosPrecos' },
  { path: '/api/admin/servicos', file: './routes/adminServicos' },
  { path: '/api/admin/produtos', file: './routes/adminProductImages' },
  { path: '/api/admin/products/bulk', file: './routes/adminProductsBulk' },
  { path: '/api/fiscal/icms-simples', file: './routes/fiscalIcmsSimples' },
  { path: '/api/fiscal/rules', file: './routes/fiscalRules' },
  { path: '/api/profile', file: './routes/profile' },
  { path: '/api/email', file: './routes/email' },
  { path: '/api/search', file: './routes/search' },
  { path: '/api/integrations/external', file: './routes/integrationsExternal' },
  { path: '/webhooks', file: './routes/webhooks' },
  { path: '/', file: './routes/webhooks' }, // expõe /webhook e /webhooks/marketplaces na raiz para validação iFood
];

// Registrar rotas adicionais (Agenda - funcionários)
routes.push({ path: '/api/func', file: './routes/funcAgenda' });
routes.push({ path: '/api/func', file: './routes/funcVet' });
routes.push({ path: '/api/func', file: './routes/funcComissoes' });
routes.push({ path: '/api', file: './routes/adminComissoesFechamentos' });

// Carrega cada rota
routes.forEach(r => app.use(r.path, require(r.file)));

// WebSockets
function sanitizeRoomKey(room) {
  if (typeof room !== 'string') return null;
  const trimmed = room.trim();
  if (!trimmed.startsWith('vet:ficha:')) return null;
  if (trimmed.length > 200) return null;
  if (!/^[-a-zA-Z0-9:_]+$/.test(trimmed)) return null;
  return trimmed;
}

io.on('connection', (socket) => {
  console.log('Um utilizador conectou-se via WebSocket');
  const joinedRooms = new Set();

  socket.on('vet:ficha:join', (payload = {}) => {
    const room = sanitizeRoomKey(payload.room);
    if (!room) return;
    socket.join(room);
    joinedRooms.add(room);
  });

  socket.on('vet:ficha:leave', (payload = {}) => {
    const room = sanitizeRoomKey(payload.room);
    if (!room) return;
    socket.leave(room);
    joinedRooms.delete(room);
  });

  socket.on('vet:ficha:update', (payload = {}) => {
    const room = sanitizeRoomKey(payload.room);
    if (!room) return;
    const message = {
      ...payload,
      room,
      timestamp: typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
    };
    socket.to(room).emit('vet:ficha:update', message);
  });

  socket.on('disconnect', () => {
    joinedRooms.clear();
    console.log('Utilizador desconectou-se');
  });
});

// Inicialização do servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
startIfoodStatusPoller();
