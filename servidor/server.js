// servidor/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');

// Carrega variÃ¡veis de ambiente antes de importar mÃ³dulos que dependem delas
dotenv.config();

const { verifyMailer } = require('./utils/mailer');
const connectDB = require('./config/db');
const { startIfoodStatusPoller } = require('./services/ifoodStatusPoller');
const { startIfoodMenuScheduler } = require('./services/ifoodMenuScheduler');
const {
  startWhatsappAutomationWorker,
} = require('./services/whatsappAutomationWorker');
const User = require('./models/User');
const WhatsappIntegration = require('./models/WhatsappIntegration');
const {
  canAccessStore,
  normalizePhoneNumberId,
} = require('./services/whatsappAccessService');

const app = express();
const server = http.createServer(app);
let whatsappAutomationWorker = null;
const buildPdvRoomKey = (pdvId) => {
  const id = typeof pdvId === 'string' ? pdvId.trim() : '';
  if (!/^[a-fA-F0-9]{24}$/.test(id)) return null;
  return `pdv:${id}`;
};

const BODY_PARSER_LIMIT = '10mb';
const WHATSAPP_WEBHOOK_BODY_LIMIT = '25mb';
const DEFAULT_CORS_ALLOWED_ORIGINS = [
  'https://www.peteobicho.com.br',
  'https://peteobicho.com.br',
  'https://e-o-bicho.com.br',
  'https://www.e-o-bicho.com.br',
  'https://e-o-bicho.onrender.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function buildAllowedOrigins() {
  const fromEnv = String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const merged = [...DEFAULT_CORS_ALLOWED_ORIGINS, ...fromEnv];
  return Array.from(new Set(merged));
}

function isOriginAllowed(origin, allowedOrigins = []) {
  if (!origin) return true; // requests sem Origin (server-to-server / desktop) passam
  if (allowedOrigins.includes(origin)) return true;
  return /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
}


const allowedOrigins = buildAllowedOrigins();
const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin, allowedOrigins)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS bloqueado para origem: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposedHeaders: ['Content-Disposition', 'X-Auth-Reason'],
};
const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    credentials: true,
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.set('socketio', io);
app.set('emitPdvStateUpdate', ({ pdvId, payload = {} } = {}) => {
  const room = buildPdvRoomKey(pdvId);
  if (!room) return;
  io.to(room).emit('pdv:state-updated', {
    pdvId,
    timestamp: Date.now(),
    ...payload,
  });
});
// O histórico inicial da coexistência pode ultrapassar o limite comum da API.
// A assinatura continua sendo validada sobre os bytes originais em whatsappWebhooks.
app.use(['/webhooks/whatsapp', '/webhook/whatsapp'], express.json({
  limit: WHATSAPP_WEBHOOK_BODY_LIMIT,
  verify: (req, _res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.json({
  limit: BODY_PARSER_LIMIT,
  verify: (req, _res, buf) => {
    // guarda o raw para validaÃ§Ã£o de assinatura (webhooks)
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: BODY_PARSER_LIMIT }));
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
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
  { path: '/api/inventory-movement-logs', file: './routes/inventoryMovementLogs' },
  { path: '/api/exchanges', file: './routes/exchanges' },
  { path: '/api/payment-methods', file: './routes/paymentMethods' },
  { path: '/api/bank-accounts', file: './routes/bankAccounts' },
  { path: '/api/accounting-accounts', file: './routes/accountingAccounts' },
  { path: '/api/suppliers', file: './routes/suppliers' },
  { path: '/api/internacao', file: './routes/internacaoBoxes' },
  { path: '/api/internacao/parametros', file: './routes/internacaoParametros' },
  { path: '/api/nfe/drafts', file: './routes/nfeDrafts' },
  { path: '/api/purchase/nfe/drafts', file: './routes/purchaseNfeDrafts' },
  { path: '/api/accounts-payable', file: './routes/accountsPayable' },
  { path: '/api/accounts-receivable', file: './routes/accountsReceivable' },
  { path: '/api/jobs', file: './routes/jobs' },
  { path: '/api/addresses', file: './routes/addresses' },
  { path: '/api/shipping', file: './routes/shipping' },
  { path: '/api/admin/users', file: './routes/adminUsers' },
  { path: '/api/admin/funcionarios', file: './routes/adminFuncionarios' },
  { path: '/api/admin/grupos-usuarios', file: './routes/adminUserGroups' },
  { path: '/api/admin/comissoes-profissionais', file: './routes/adminProfessionalCommissions' },
  { path: '/api/admin/screen-security', file: './routes/adminScreenSecurity' },
  { path: '/api/admin/servicos/grupos', file: './routes/adminServicosGrupos' },
  { path: '/api/admin/servicos/precos', file: './routes/adminServicosPrecos' },
  { path: '/api/admin/servicos', file: './routes/adminServicos' },
  { path: '/api/admin/produtos', file: './routes/adminProductImages' },
  { path: '/api/admin/products/bulk', file: './routes/adminProductsBulk' },
  { path: '/api/fiscal/icms-simples', file: './routes/fiscalIcmsSimples' },
  { path: '/api/fiscal/rules', file: './routes/fiscalRules' },
  { path: '/api/fiscal/default-rules', file: './routes/fiscalDefaultRules' },
  { path: '/api/fiscal/series', file: './routes/fiscalSeries' },
  { path: '/api/fiscal/cfop', file: './routes/fiscalCfop' },
  { path: '/api/profile', file: './routes/profile' },
  { path: '/api/email', file: './routes/email' },
  { path: '/api/search', file: './routes/search' },
  { path: '/api/integrations/external', file: './routes/integrationsExternal' },
  { path: '/api/mercadopago', file: './routes/mercadoPago' },
  { path: '/api/orders', file: './routes/webOrders' },
  { path: '/api/integrations/whatsapp', file: './routes/integrationsWhatsapp' },
  { path: '/webhooks/whatsapp', file: './routes/whatsappWebhooks' },
  { path: '/webhook/whatsapp', file: './routes/whatsappWebhooks' },
  { path: '/webhooks/mercadopago', file: './routes/mercadoPagoWebhooks' },
  { path: '/webhooks', file: './routes/webhooks' },
  { path: '/', file: './routes/webhooks' }, // expÃµe /webhook e /webhooks/marketplaces na raiz para validaÃ§Ã£o iFood
];

// Registrar rotas adicionais (Agenda - funcionÃ¡rios)
routes.push({ path: '/api/func', file: './routes/funcAgenda' });
routes.push({ path: '/api/func', file: './routes/funcVet' });
routes.push({ path: '/api/func', file: './routes/funcComissoes' });
routes.push({ path: '/api', file: './routes/adminComissoesFechamentos' });
routes.push({ path: '/api/ifood', file: './routes/ifoodOrders' });

// Carrega cada rota
routes.forEach(r => app.use(r.path, require(r.file)));
try {
  const ifoodStream = require('./routes/ifoodOrdersStream');
  app.use('/api/ifood', ifoodStream);
} catch (_) {
  console.error('NÃ£o foi possÃ­vel registrar stream do iFood');
}

app.use((err, req, res, next) => {
  if (!err) {
    return next();
  }
  const aborted =
    err?.type === 'request.aborted' ||
    err?.name === 'BadRequestError' ||
    /request aborted/i.test(String(err?.message || ''));
  if (aborted) {
    if (!res.headersSent) {
      res.status(499).json({ message: 'RequisiÃ§Ã£o cancelada pelo cliente.' });
    }
    return;
  }
  return next(err);
});

// WebSockets
function sanitizeRoomKey(room) {
  if (typeof room !== 'string') return null;
  const trimmed = room.trim();
  if (!trimmed.startsWith('vet:ficha:')) return null;
  if (trimmed.length > 200) return null;
  if (!/^[-a-zA-Z0-9:_]+$/.test(trimmed)) return null;
  return trimmed;
}

function buildWhatsappRoomKey(storeId, phoneNumberId) {
  const store = typeof storeId === 'string' ? storeId.trim() : '';
  const phone = typeof phoneNumberId === 'string' ? phoneNumberId.trim() : '';
  if (!/^[a-fA-F0-9]{24}$/.test(store)) return null;
  if (!/^\d{6,}$/.test(phone)) return null;
  return `whatsapp:store:${store}:number:${phone}`;
}

function extractWhatsappSocketToken(socket) {
  const handshakeToken = String(socket.handshake?.auth?.token || '').trim();
  if (handshakeToken) return handshakeToken.replace(/^Bearer\s+/i, '');
  const authorization = String(socket.handshake?.headers?.authorization || '').trim();
  return authorization.replace(/^Bearer\s+/i, '');
}

function isSocketAdminMasterModeActive(socket) {
  const value = socket.handshake?.auth?.adminMasterModeActive;
  if (value === false) return false;
  const normalized = String(value ?? 'true').trim().toLowerCase();
  return !['0', 'false', 'off', 'no', 'nao', 'não'].includes(normalized);
}

async function authenticateWhatsappSocket(socket) {
  if (socket.data?.whatsappUser) return socket.data.whatsappUser;
  const token = extractWhatsappSocketToken(socket);
  if (!token) {
    const error = new Error('Token não fornecido.');
    error.code = 'WHATSAPP_SOCKET_UNAUTHORIZED';
    throw error;
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id)
    .select('_id email role empresaPrincipal empresaContratual empresas')
    .lean();
  if (!user) {
    const error = new Error('Usuário não encontrado.');
    error.code = 'WHATSAPP_SOCKET_UNAUTHORIZED';
    throw error;
  }

  const adminMasterModeActive = isSocketAdminMasterModeActive(socket);
  const originalRole = String(user.role || '');
  const whatsappUser = {
    id: String(user._id),
    email: user.email || '',
    originalRole,
    role:
      originalRole === 'admin_master' && !adminMasterModeActive
        ? 'admin'
        : originalRole,
    adminMasterModeActive,
    storeIds: Array.from(new Set([
      user.empresaPrincipal,
      user.empresaContratual,
      ...(Array.isArray(user.empresas) ? user.empresas : []),
    ].filter(Boolean).map((value) => String(value)))),
  };
  socket.data.whatsappUser = whatsappUser;
  return whatsappUser;
}

async function authorizeWhatsappSocketRoom(socket, payload = {}) {
  const storeId = String(payload.storeId || '').trim();
  const phoneNumberId = normalizePhoneNumberId(payload.phoneNumberId);
  const room = buildWhatsappRoomKey(storeId, phoneNumberId);
  if (!room) {
    const error = new Error('Ambiente do WhatsApp inválido.');
    error.code = 'WHATSAPP_SOCKET_INVALID_ROOM';
    throw error;
  }

  const user = await authenticateWhatsappSocket(socket);
  if (!canAccessStore(user, storeId)) {
    const error = new Error('Você não possui acesso ao WhatsApp desta loja.');
    error.code = 'WHATSAPP_SOCKET_FORBIDDEN';
    throw error;
  }

  const numberExists = await WhatsappIntegration.exists({
    store: storeId,
    phoneNumbers: { $elemMatch: { phoneNumberId } },
  });
  if (!numberExists) {
    const error = new Error('O número não pertence ao ambiente desta loja.');
    error.code = 'WHATSAPP_SOCKET_FORBIDDEN';
    throw error;
  }

  return { room, storeId, phoneNumberId, user };
}

function respondToSocketEvent(socket, callback, payload) {
  if (typeof callback === 'function') {
    callback(payload);
    return;
  }
  if (payload?.ok === false) {
    socket.emit('whatsapp:access-denied', payload);
  }
}

io.on('connection', (socket) => {
  const joinedRooms = new Set();
  const joinedWhatsappRooms = new Set();
  const joinedPdvRooms = new Set();

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

  socket.on('whatsapp:join', async (payload = {}, callback) => {
    try {
      const context = await authorizeWhatsappSocketRoom(socket, payload);
      await Promise.all(
        Array.from(joinedWhatsappRooms).map(async (joinedRoom) => {
          await socket.leave(joinedRoom);
          joinedWhatsappRooms.delete(joinedRoom);
        })
      );
      await socket.join(context.room);
      joinedWhatsappRooms.add(context.room);
      respondToSocketEvent(socket, callback, {
        ok: true,
        storeId: context.storeId,
        phoneNumberId: context.phoneNumberId,
      });
    } catch (error) {
      respondToSocketEvent(socket, callback, {
        ok: false,
        code: error?.code || 'WHATSAPP_SOCKET_UNAUTHORIZED',
        message: 'Não foi possível entrar neste ambiente do WhatsApp.',
      });
    }
  });

  socket.on('whatsapp:leave', async (payload = {}, callback) => {
    const room = buildWhatsappRoomKey(payload.storeId, payload.phoneNumberId);
    if (!room || !joinedWhatsappRooms.has(room)) {
      respondToSocketEvent(socket, callback, { ok: false, code: 'WHATSAPP_SOCKET_INVALID_ROOM' });
      return;
    }
    await socket.leave(room);
    joinedWhatsappRooms.delete(room);
    respondToSocketEvent(socket, callback, { ok: true });
  });

  socket.on('pdv:join', (payload = {}) => {
    const room = buildPdvRoomKey(payload.pdvId);
    if (!room) return;
    socket.join(room);
    joinedPdvRooms.add(room);
  });

  socket.on('pdv:leave', (payload = {}) => {
    const room = buildPdvRoomKey(payload.pdvId);
    if (!room) return;
    socket.leave(room);
    joinedPdvRooms.delete(room);
  });

  socket.on('disconnect', () => {
    joinedRooms.clear();
    joinedWhatsappRooms.clear();
    joinedPdvRooms.clear();
  });
});

async function startServer() {
  await connectDB();
  if (String(process.env.SKIP_MAIL_VERIFY || '').toLowerCase() !== 'true') {
    void verifyMailer();
  }
  const port = Number(process.env.PORT || 3000);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      console.log(`Servidor rodando em http://localhost:${port}`);
      resolve();
    });
  });
  if (String(process.env.DISABLE_EXTERNAL_WORKERS || '').toLowerCase() !== 'true') {
    startIfoodStatusPoller();
    startIfoodMenuScheduler();
  }
  if (!whatsappAutomationWorker) {
    whatsappAutomationWorker = startWhatsappAutomationWorker({ io });
  }
  return { app, server, port };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Falha ao iniciar servidor:', error);
    process.exitCode = 1;
  });
}

module.exports = { app, server, startServer };


