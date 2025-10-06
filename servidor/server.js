// servidor/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const { verifyMailer } = require('./utils/mailer');
const connectDB = require('./config/db');

dotenv.config();
connectDB();
verifyMailer();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const BODY_PARSER_LIMIT = '10mb';



// Middleware
app.set('socketio', io);
app.use(express.json({ limit: BODY_PARSER_LIMIT }));
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
  { path: '/api/deposits', file: './routes/deposits' },
  { path: '/api/payment-methods', file: './routes/paymentMethods' },
  { path: '/api/bank-accounts', file: './routes/bankAccounts' },
  { path: '/api/accounting-accounts', file: './routes/accountingAccounts' },
  { path: '/api/suppliers', file: './routes/suppliers' },
  { path: '/api/accounts-payable', file: './routes/accountsPayable' },
  { path: '/api/accounts-receivable', file: './routes/accountsReceivable' },
  { path: '/api/jobs', file: './routes/jobs' },
  { path: '/api/addresses', file: './routes/addresses' },
  { path: '/api/shipping', file: './routes/shipping' },
  { path: '/api/admin/users', file: './routes/adminUsers' },
  { path: '/api/admin/funcionarios', file: './routes/adminFuncionarios' },
  { path: '/api/admin/servicos/grupos', file: './routes/adminServicosGrupos' },
  { path: '/api/admin/servicos/precos', file: './routes/adminServicosPrecos' },
  { path: '/api/admin/servicos', file: './routes/adminServicos' },
  { path: '/api/fiscal/icms-simples', file: './routes/fiscalIcmsSimples' },
  { path: '/api/fiscal/rules', file: './routes/fiscalRules' },
  { path: '/api/profile', file: './routes/profile' },
  { path: '/api/email', file: './routes/email' },
  { path: '/api/search', file: './routes/search' },
];

// Registrar rotas adicionais (Agenda - funcionários)
routes.push({ path: '/api/func', file: './routes/funcAgenda' });
routes.push({ path: '/api/func', file: './routes/funcVet' });

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
