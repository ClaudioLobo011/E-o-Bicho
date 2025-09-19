const express = require('express');
const router = express.Router();

const mongoose = require('mongoose');
const authMiddleware = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/authorizeRoles');

const User = require('../models/User');
const Pet = require('../models/Pet');
const Service = require('../models/Service');
const Appointment = require('../models/Appointment');

const requireStaff = authorizeRoles('funcionario', 'admin', 'admin_master');

function escapeRegex(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function userDisplayName(u) { return u?.nomeCompleto || u?.nomeContato || u?.razaoSocial || u?.email; }

function extractAllowedStaffTypes(serviceDoc) {
  if (!serviceDoc) return [];
  const raw = [];
  if (Array.isArray(serviceDoc.tiposPermitidos)) raw.push(...serviceDoc.tiposPermitidos);
  if (serviceDoc.grupo && Array.isArray(serviceDoc.grupo.tiposPermitidos)) {
    raw.push(...serviceDoc.grupo.tiposPermitidos);
  }
  return [...new Set(raw.map(v => String(v || '').trim()).filter(Boolean))];
}

router.put('/agendamentos/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }

    const {
      storeId, clienteId, petId, servicoId,
      profissionalId, scheduledAt, valor, pago, status, servicos, observacoes, codigoVenda
    } = req.body || {};

    const set = {};
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) set.store = storeId;
    if (clienteId && mongoose.Types.ObjectId.isValid(clienteId)) set.cliente = clienteId;
    if (servicoId && mongoose.Types.ObjectId.isValid(servicoId)) set.servico = servicoId; // compat
    if (profissionalId && mongoose.Types.ObjectId.isValid(profissionalId)) set.profissional = profissionalId;
    if (typeof valor !== 'undefined') set.valor = Number(valor);
    if (typeof pago !== 'undefined') set.pago = !!pago;
    if (typeof codigoVenda !== 'undefined') {
      set.codigoVenda = String(codigoVenda || '').trim();
      if (set.codigoVenda) set.pago = true; // ao registrar código, marca como pago
    }

    if (scheduledAt) {
      const d = new Date(scheduledAt);
      if (isNaN(d.getTime())) return res.status(400).json({ message: 'scheduledAt inválido.' });
      set.scheduledAt = d;
    }

    // STATUS
    if (typeof status !== 'undefined') {
      const allowed = new Set(['agendado', 'em_espera', 'em_atendimento', 'finalizado']);
      const s = String(status);
      if (!allowed.has(s)) return res.status(400).json({ message: 'Status inválido.' });
      set.status = s;
    }
    // Observações
    if (typeof observacoes !== 'undefined') set.observacoes = String(observacoes);

    // Pet do cliente (se informado)
    if (petId) {
      if (!mongoose.Types.ObjectId.isValid(petId)) return res.status(400).json({ message: 'petId inválido.' });
      let clienteTarget = null;
      if (clienteId) {
        clienteTarget = clienteId;
      } else {
        const current = await Appointment.findById(id).select('cliente').lean();
        clienteTarget = current?.cliente ? String(current.cliente) : null;
      }
      if (!clienteTarget) return res.status(400).json({ message: 'clienteId é obrigatório para trocar o pet.' });

      const pet = await Pet.findById(petId).select('owner').lean();
      if (!pet) return res.status(404).json({ message: 'Pet não encontrado.' });
      if (String(pet.owner) !== String(clienteTarget)) {
        return res.status(400).json({ message: 'Este pet não pertence ao cliente selecionado.' });
      }
      set.pet = petId;
    }

    // Atualiza lista de serviços (se enviada)
    if (Array.isArray(servicos)) {
      const itens = [];
      for (const it of servicos) {
        const sid = it?.servicoId;
        if (!sid || !mongoose.Types.ObjectId.isValid(sid)) continue;
        let v = typeof it?.valor === 'number' ? it.valor : null;
        if (v == null) {
          const s = await Service.findById(sid).select('valor').lean();
          v = s?.valor || 0;
        }
        itens.push({ servico: sid, valor: Number(v || 0) });
      }
      set.itens = itens;
      if (itens.length) {
        set.servico = itens[0].servico; // compat
        set.valor = itens.reduce((s, x) => s + Number(x.valor || 0), 0);
      } else {
        set.itens = [];
        set.valor = 0;
      }
    }

    // Se já faturado e não é admin/admin_master, bloquear mudanças em serviços e data/hora
    try {
      const current = await Appointment.findById(id).select('codigoVenda pago').lean();
      const locked = !!(current?.codigoVenda || current?.pago);
      const role = req.user?.role || 'cliente';
      const privileged = (role === 'admin' || role === 'admin_master');

      // Intenções do request
      const wantsServiceChange = Array.isArray(servicos) || typeof valor !== 'undefined' || !!servicoId;
      const wantsScheduleChange = !!scheduledAt;

      if (locked && !privileged && (wantsServiceChange || wantsScheduleChange)) {
        return res.status(403).json({ message: 'Agendamento já faturado. Apenas Admin/Admin Master podem alterar serviços ou data/hora.' });
      }
    } catch (_) {}

    const full = await Appointment.findByIdAndUpdate(id, { $set: set }, { new: true })
      .select('_id store cliente pet servico itens profissional scheduledAt valor pago codigoVenda status observacoes')
      .populate('pet', 'nome')
      .populate({
        path: 'servico',
        select: 'nome categorias grupo',
        populate: { path: 'grupo', select: 'nome tiposPermitidos' }
      })
      .populate({
        path: 'itens.servico',
        select: 'nome categorias grupo',
        populate: { path: 'grupo', select: 'nome tiposPermitidos' }
      })
      .populate('profissional', 'nomeCompleto nomeContato razaoSocial')
      .lean();

    if (!full) {
      return res.status(404).json({ message: 'Agendamento não encontrado.' });
    }

    const servicosList = (full.itens || []).map(it => ({
      _id: it.servico?._id || it.servico,
      nome: it.servico?.nome || '—',
      valor: Number(it.valor || 0),
      categorias: Array.isArray(it.servico?.categorias)
        ? it.servico.categorias.filter(Boolean)
        : [],
      tiposPermitidos: extractAllowedStaffTypes(it.servico || {})
    }));
    if (!servicosList.length && full.servico) {
      servicosList.push({
        _id: full.servico?._id || full.servico,
        nome: full.servico?.nome || '—',
        valor: Number(full.valor || 0),
        categorias: Array.isArray(full.servico?.categorias)
          ? full.servico.categorias.filter(Boolean)
          : [],
        tiposPermitidos: extractAllowedStaffTypes(full.servico || {})
      });
    }
    const servicosStr = servicosList.map(s => s.nome).join(', ');

    return res.json({
      _id: full._id,
      h: new Date(full.scheduledAt).toISOString(),
      valor: Number(full.valor || 0),
      pago: !!full.pago,
      status: full.status || 'agendado',
      pet: full.pet ? full.pet.nome : '—',
      servico: servicosStr,
      servicos: servicosList,
      profissional: full.profissional
        ? (full.profissional.nomeCompleto || full.profissional.nomeContato || full.profissional.razaoSocial)
        : '—',
      profissionalId: full.profissional?._id || null
    });
  } catch (e) {
    console.error('PUT /func/agendamentos/:id', e);
    res.status(500).json({ message: 'Erro ao atualizar agendamento' });
  }
});

// ---------- BUSCA CLIENTES ----------
router.get('/clientes/buscar', authMiddleware, requireStaff, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '8', 10), 20);
    if (!q) return res.json([]);
    const regex = new RegExp(escapeRegex(q), 'i');
    const onlyDigits = q.replace(/\D/g, '');

    const or = [{ nomeCompleto: regex }, { nomeContato: regex }, { razaoSocial: regex }, { email: regex }];
    if (onlyDigits.length >= 4) {
      or.push({ cpf: new RegExp(onlyDigits) });
      or.push({ cnpj: new RegExp(onlyDigits) });
      or.push({ celular: new RegExp(onlyDigits) });
    }

    const users = await User.find({ $or: or })
      .select('_id nomeCompleto nomeContato razaoSocial email cpf cnpj inscricaoEstadual celular tipoConta')
      .limit(limit)
      .lean();

    res.json(users.map(u => ({
      _id: u._id,
      nome: userDisplayName(u),
      email: u.email,
      celular: u.celular || '',
      doc: u.cpf || u.cnpj || u.inscricaoEstadual || '',
      cpf: u.cpf || '',
      cnpj: u.cnpj || '',
      inscricaoEstadual: u.inscricaoEstadual || '',
      tipoConta: u.tipoConta
    })));
  } catch (e) {
    console.error('GET /func/clientes/buscar', e);
    res.status(500).json({ message: 'Erro ao buscar clientes' });
  }
});

// ---------- PETS DO CLIENTE ----------
router.get('/clientes/:id/pets', authMiddleware, requireStaff, async (req, res) => {
  try {
    const ownerId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(ownerId)) return res.json([]);
    const pets = await Pet.find({ owner: ownerId })
      .select('_id nome tipo raca porte sexo dataNascimento peso microchip pelagemCor rga')
      .sort({ nome: 1 })
      .lean();
    res.json(pets);
  } catch (e) {
    console.error('GET /func/clientes/:id/pets', e);
    res.status(500).json({ message: 'Erro ao buscar pets' });
  }
});

// ---------- BUSCA SERVIÇOS ----------
router.get('/servicos/buscar', authMiddleware, requireStaff, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '8', 10), 30);
    const filter = q ? { nome: new RegExp(escapeRegex(q), 'i') } : {};
    const normalizeTipo = (s) => String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase();
    const profTipo = normalizeTipo(req.query.profTipo || req.query.staffType || '');

    const items = await Service.find(filter)
      .select('_id nome valor porte grupo categorias')
      .populate({ path: 'grupo', select: 'nome tiposPermitidos' })
      .limit(limit)
      .sort({ nome: 1 })
      .lean();

    const filtered = profTipo
      ? items.filter(s => {
        const tipos = Array.isArray(s?.grupo?.tiposPermitidos) ? s.grupo.tiposPermitidos : [];
        if (!tipos.length) return true;
        return tipos.some(t => normalizeTipo(t) === profTipo);
      })
      : items;

    res.json(filtered.map(s => ({
      _id: s._id,
      nome: s.nome,
      valor: s.valor || 0,
      porte: s.porte || [],
      categorias: Array.isArray(s.categorias) ? s.categorias : [],
      grupo: s.grupo ? {
        _id: s.grupo._id,
        nome: s.grupo.nome,
        tiposPermitidos: Array.isArray(s.grupo.tiposPermitidos) ? s.grupo.tiposPermitidos : []
      } : null
    })));
  } catch (e) {
    console.error('GET /func/servicos/buscar', e);
    res.status(500).json({ message: 'Erro ao buscar serviços' });
  }
});

// Preço por raça de um serviço para uso na agenda
// GET /api/func/servicos/preco?serviceId=&storeId=&petId=  (ou &tipo=&raca=)
router.get('/servicos/preco', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { serviceId, storeId, petId } = req.query || {};
    if (!serviceId || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ message: 'serviceId obrigatório' });
    }
    if (!storeId || !mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'storeId obrigatório' });
    }

    let tipo = (req.query.tipo || '').trim();
    let raca = (req.query.raca || '').trim();

    if ((!tipo || !raca) && petId && mongoose.Types.ObjectId.isValid(petId)) {
      const pet = await Pet.findById(petId).select('tipo raca').lean();
      if (pet) {
        const norm = (s) => String(s || '')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .trim().toLowerCase();
        const mapTipo = (t) => {
          const n = norm(t);
          if (/cachorr|cao|c.o/.test(n)) return 'cachorro';
          if (/gat/.test(n)) return 'gato';
          if (/passar|ave/.test(n)) return 'passaro';
          if (/peix/.test(n)) return 'peixe';
          if (/roedor|hamster|coelho|porquinho/.test(n)) return 'roedor';
          if (/lagart/.test(n)) return 'lagarto';
          if (/tartarug/.test(n)) return 'tartaruga';
          if (/exot/.test(n)) return 'exotico';
          return n || 'cachorro';
        };
        tipo = tipo || mapTipo(pet.tipo);
        raca = raca || String(pet.raca || '').trim();
      }
    }

    const ServiceBreedPrice = require('../models/ServiceBreedPrice');
    let preco = null;
    if (tipo && raca) {
      const ov = await ServiceBreedPrice.findOne({
        service: serviceId,
        store: storeId,
        tipo: String(tipo).trim(),
        raca: new RegExp('^' + escapeRegex(raca) + '$', 'i')
      }).select('valor custo').lean();
      if (ov) {
        preco = { valor: Number(ov.valor || 0), custo: Number(ov.custo || 0), source: 'breed' };
      }
    }

    if (!preco || !(preco.valor > 0)) {
      const s = await Service.findById(serviceId).select('valor').lean();
      preco = { valor: Number((s && s.valor) || 0), custo: 0, source: 'service' };
    }
    res.json(preco);
  } catch (e) {
    console.error('GET /func/servicos/preco', e);
    res.status(500).json({ message: 'Erro ao obter preço do serviço' });
  }
});

// ---------- PROFISSIONAIS (esteticistas) ----------
router.get('/profissionais/esteticistas', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { storeId } = req.query;
    const filter = {
      role: { $in: ['funcionario', 'admin', 'admin_master'] },
      grupos: 'esteticista'
    };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      // Usuários que pertencem à empresa informada
      filter.empresas = storeId;
    }

    const users = await User.find(filter)
      .select('_id nomeCompleto nomeContato razaoSocial email empresas grupos')
      .sort({ nomeCompleto: 1 })
      .lean();

    res.json(users.map(u => ({ _id: u._id, nome: userDisplayName(u) })));
  } catch (e) {
    console.error('GET /func/profissionais/esteticistas', e);
    res.status(500).json({ message: 'Erro ao carregar profissionais' });
  }
});

// PROFISSIONAIS: esteticistas e veterinários
router.get('/profissionais', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { storeId } = req.query;
    let tipos = String(req.query.tipos || '').trim();
    const ALLOWED = ['esteticista','veterinario'];
    const tiposArr = tipos ? tipos.split(',').map(s => s.trim().toLowerCase()).filter(s => ALLOWED.includes(s)) : ALLOWED;
    const filter = { role: { $in: ['funcionario','admin','admin_master'] }, grupos: { $in: tiposArr } };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.empresas = storeId;
    const users = await User.find(filter)
      .select('_id nomeCompleto nomeContato razaoSocial email grupos')
      .sort({ nomeCompleto: 1 })
      .lean();
    const out = users.map(u => ({
      _id: u._id,
      nome: userDisplayName(u),
      tipo: (Array.isArray(u.grupos) && u.grupos.includes('veterinario')) ? 'veterinario' : 'esteticista'
    }));
    res.json(out);
  } catch (e) {
    console.error('GET /func/profissionais', e);
    res.status(500).json({ message: 'Erro ao carregar profissionais' });
  }
});

// ---------- AGENDAMENTOS ----------
function getDayRange(dateStr) {
  // dateStr: YYYY-MM-DD (sem timezone). Considera dia local.
  const [y, m, d] = dateStr.split('-').map(n => parseInt(n, 10));
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { start, end };
}

// Listar do dia por empresa
// GET /api/func/agendamentos?date=YYYY-MM-DD&storeId=<id>
router.get('/agendamentos', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { date, storeId } = req.query;
    if (!date) return res.status(400).json({ message: 'Parâmetro "date" é obrigatório (YYYY-MM-DD).' });

    const [y, m, d] = date.split('-').map(n => parseInt(n, 10));
    const start = new Date(y, m - 1, d, 0, 0, 0, 0);
    const end   = new Date(y, m - 1, d + 1, 0, 0, 0, 0);

    const filter = { scheduledAt: { $gte: start, $lt: end } };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.store = storeId;

    const list = await Appointment.find(filter)
      .select('_id store cliente pet servico itens profissional scheduledAt valor pago codigoVenda status observacoes')
      .populate('cliente', 'nomeCompleto nomeContato razaoSocial email')
      .populate('pet', 'nome')
      .populate({
        path: 'servico',
        select: 'nome categorias grupo',
        populate: { path: 'grupo', select: 'nome tiposPermitidos' }
      })
      .populate({
        path: 'itens.servico',
        select: 'nome categorias grupo',
        populate: { path: 'grupo', select: 'nome tiposPermitidos' }
      })
      .populate('profissional', 'nomeCompleto nomeContato razaoSocial')
      .sort({ scheduledAt: 1 })
      .lean();

    const map = (list || []).map(a => {
      const clienteNome = a.cliente ? (a.cliente.nomeCompleto || a.cliente.nomeContato || a.cliente.razaoSocial || a.cliente.email || null) : null;

      const itens = Array.isArray(a.itens) ? a.itens : [];
      const servicosList = itens.length
        ? itens.map(it => ({
          _id: it.servico?._id || it.servico || null,
          nome: it.servico?.nome || '—',
          valor: Number(it.valor || 0),
          categorias: Array.isArray(it.servico?.categorias)
            ? it.servico.categorias.filter(Boolean)
            : [],
          tiposPermitidos: extractAllowedStaffTypes(it.servico || {})
        }))
        : (a.servico ? [{
          _id: a.servico?._id || a.servico,
          nome: a.servico?.nome || '—',
          valor: Number(a.valor || 0),
          categorias: Array.isArray(a.servico?.categorias)
            ? a.servico.categorias.filter(Boolean)
            : [],
          tiposPermitidos: extractAllowedStaffTypes(a.servico || {})
        }] : []);
      const servicosStr = servicosList.map(s => s.nome).join(', ');
      const valorTotal = (servicosList.reduce((s, x) => s + Number(x.valor || 0), 0)) || Number(a.valor || 0) || 0;

      return {
        _id: a._id,
        storeId: a.store?._id || a.store || null,
        clienteId: a.cliente?._id || null,
        clienteNome,
        pet: a.pet ? a.pet.nome : '—',
        petId: a.pet?._id || null,
        servico: servicosStr,             // compat: texto p/ exibição
        servicos: servicosList,           // novo: array de serviços do agendamento
        profissionalId: a.profissional?._id || null,
        profissional: a.profissional ? (a.profissional.nomeCompleto || a.profissional.nomeContato || a.profissional.razaoSocial) : null,
        h: new Date(a.scheduledAt).toISOString(),
        valor: valorTotal,                // total do agendamento
        pago: !!a.pago,
        codigoVenda: a.codigoVenda || null,
        observacoes: a.observacoes || '',
        status: a.status || 'agendado'
      };
    });

    res.json(map);
  } catch (e) {
    console.error('GET /func/agendamentos', e);
    res.status(500).json({ message: 'Erro ao listar agendamentos' });
  }
});

// GET /api/func/agendamentos/range?start=YYYY-MM-DD&end=YYYY-MM-DD&storeId=<id>
router.get('/agendamentos/range', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { start: startStr, end: endStr, storeId } = req.query;
    if (!startStr || !endStr) {
      return res.status(400).json({ message: 'Parâmetros "start" e "end" são obrigatórios (YYYY-MM-DD).' });
    }
    const [ys, ms, ds] = startStr.split('-').map(n => parseInt(n, 10));
    const [ye, me, de] = endStr.split('-').map(n => parseInt(n, 10));
    const start = new Date(ys, ms - 1, ds, 0, 0, 0, 0);
    const end   = new Date(ye, me - 1, de, 0, 0, 0, 0); // exclusivo

    const filter = { scheduledAt: { $gte: start, $lt: end } };
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) filter.store = storeId;

    const list = await Appointment.find(filter)
      .select('_id store cliente pet servico itens profissional scheduledAt valor pago codigoVenda status observacoes')
      .populate('cliente', 'nomeCompleto nomeContato razaoSocial email')
      .populate('pet', 'nome')
      .populate({
        path: 'servico',
        select: 'nome categorias grupo',
        populate: { path: 'grupo', select: 'nome tiposPermitidos' }
      })
      .populate({
        path: 'itens.servico',
        select: 'nome categorias grupo',
        populate: { path: 'grupo', select: 'nome tiposPermitidos' }
      })
      .populate('profissional', 'nomeCompleto nomeContato razaoSocial')
      .sort({ scheduledAt: 1 })
      .lean();

    const map = (list || []).map(a => {
      const servicosList = (a.itens || []).map(it => ({
        _id: it.servico?._id,
        nome: it.servico?.nome || '—',
        valor: Number(it.valor || 0),
        categorias: Array.isArray(it.servico?.categorias)
          ? it.servico.categorias.filter(Boolean)
          : [],
        tiposPermitidos: extractAllowedStaffTypes(it.servico || {})
      }));
      if (!servicosList.length && a.servico) {
        servicosList.push({
          _id: a.servico?._id || a.servico,
          nome: a.servico?.nome || '—',
          valor: Number(a.valor || 0),
          categorias: Array.isArray(a.servico?.categorias)
            ? a.servico.categorias.filter(Boolean)
            : [],
          tiposPermitidos: extractAllowedStaffTypes(a.servico || {})
        });
      }
      const valorTotal = servicosList.reduce((acc, s) => acc + Number(s.valor || 0), 0) || Number(a.valor || 0) || 0;
      const tutorNome = a.cliente
        ? (a.cliente.nomeCompleto || a.cliente.nomeContato || a.cliente.razaoSocial || '')
        : '';
      return {
        _id: a._id,
        pet: a.pet ? a.pet.nome : null,
        servico: servicosList.map(s => s.nome).join(', '),
        servicos: servicosList,
        profissionalId: a.profissional?._id || null,
        profissional: a.profissional ? (a.profissional.nomeCompleto || a.profissional.nomeContato || a.profissional.razaoSocial) : null,
        tutor: tutorNome,
        h: new Date(a.scheduledAt).toISOString(),
        valor: valorTotal,
        pago: !!a.pago,
        codigoVenda: a.codigoVenda || null,
        observacoes: a.observacoes || '',
        status: a.status || 'agendado'
      };
    });

    res.json(map);
  } catch (e) {
    console.error('GET /func/agendamentos/range', e);
    res.status(500).json({ message: 'Erro ao listar agendamentos por intervalo' });
  }
});

// Criar agendamento
// body: { storeId, clienteId, petId, servicoId, profissionalId, scheduledAt, valor, pago }
router.post('/agendamentos', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { storeId, clienteId, petId, servicoId, profissionalId, scheduledAt, valor, pago, status, servicos, observacoes } = req.body || {};
    if (!storeId || !clienteId || !petId || !profissionalId || !scheduledAt) {
      return res.status(400).json({ message: 'Campos obrigatórios ausentes.' });
    }
    if (!mongoose.Types.ObjectId.isValid(storeId)
      || !mongoose.Types.ObjectId.isValid(clienteId)
      || !mongoose.Types.ObjectId.isValid(petId)
      || !mongoose.Types.ObjectId.isValid(profissionalId)) {
      return res.status(400).json({ message: 'IDs inválidos.' });
    }

    const allowed = new Set(['agendado', 'em_espera', 'em_atendimento', 'finalizado']);
    const statusFinal = allowed.has(status) ? status : 'agendado';

    let itens = [];
    if (Array.isArray(servicos) && servicos.length) {
      for (const it of servicos) {
        const sid = it?.servicoId;
        if (!sid || !mongoose.Types.ObjectId.isValid(sid)) continue;
        let v = typeof it?.valor === 'number' ? it.valor : null;
        if (v == null) {
          const s = await Service.findById(sid).select('valor').lean();
          v = s?.valor || 0;
        }
        itens.push({ servico: sid, valor: Number(v || 0) });
      }
      if (!itens.length) return res.status(400).json({ message: 'Lista de serviços inválida.' });
    } else {
      if (!servicoId || !mongoose.Types.ObjectId.isValid(servicoId)) {
        return res.status(400).json({ message: 'servicoId inválido.' });
      }
      let valorFinal = typeof valor === 'number' ? valor : null;
      if (valorFinal == null) {
        const serv = await Service.findById(servicoId).select('valor').lean();
        valorFinal = serv?.valor || 0;
      }
      itens = [{ servico: servicoId, valor: Number(valorFinal || 0) }];
    }

    const total = itens.reduce((s, x) => s + Number(x.valor || 0), 0);

    const appt = await Appointment.create({
      store: storeId,
      cliente: clienteId,
      pet: petId,
      servico: itens[0]?.servico || null, // compat
      itens,
      profissional: profissionalId,
      scheduledAt: new Date(scheduledAt),
      valor: total,
      pago: !!pago,
      status: statusFinal,
      observacoes: (typeof observacoes === 'string' ? observacoes : ''),
      createdBy: req.user?._id
    });

    const full = await Appointment.findById(appt._id)
      .select('_id store cliente pet servico itens profissional scheduledAt valor pago status observacoes')
      .populate('pet', 'nome')
      .populate('servico', 'nome')
      .populate('itens.servico', 'nome')
      .populate('profissional', 'nomeCompleto nomeContato razaoSocial')
      .lean();

    const servicosList = (full.itens || []).map(it => ({ _id: it.servico?._id || it.servico, nome: it.servico?.nome || '—', valor: Number(it.valor || 0) }));
    const servicosStr = servicosList.map(s => s.nome).join(', ');

    res.status(201).json({
      _id: full._id,
      h: new Date(full.scheduledAt).toISOString(),
      valor: Number(full.valor || 0),
      pago: !!full.pago,
      status: full.status || 'agendado',
      pet: full.pet ? full.pet.nome : '—',
      servico: servicosStr,
      servicos: servicosList,
      observacoes: full.observacoes || '',
      profissional: full.profissional
        ? (full.profissional.nomeCompleto || full.profissional.nomeContato || full.profissional.razaoSocial)
        : '—',
      profissionalId: full.profissional?._id || null
    });
  } catch (e) {
    console.error('POST /func/agendamentos', e);
    res.status(500).json({ message: 'Erro ao salvar' });
  }
});

router.get('/clientes/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const u = await User.findById(id)
      .select('_id nomeCompleto nomeContato razaoSocial email celular telefone cpf cnpj inscricaoEstadual')
      .lean();
    if (!u) {
      return res.status(404).json({ message: 'Cliente não encontrado.' });
    }
    const nome = u.nomeCompleto || u.nomeContato || u.razaoSocial || u.email || '';
    const celular = u.celular || u.telefone || '';
    const telefone = u.telefone || '';
    const cpf = typeof u.cpf === 'string' ? u.cpf : '';
    const cnpj = typeof u.cnpj === 'string' ? u.cnpj : '';
    const inscricaoEstadual = typeof u.inscricaoEstadual === 'string' ? u.inscricaoEstadual : '';
    const documentoPrincipal = cpf || cnpj || inscricaoEstadual || '';
    const cpfCnpj = cpf || cnpj || '';
    res.json({
      _id: u._id,
      nome,
      email: u.email || '',
      celular,
      telefone,
      cpf,
      cnpj,
      cpfCnpj,
      inscricaoEstadual,
      documento: documentoPrincipal,
      documentoPrincipal,
      doc: documentoPrincipal,
    });
  } catch (e) {
    console.error('GET /func/clientes/:id', e);
    res.status(500).json({ message: 'Erro ao buscar cliente.' });
  }
});

router.get('/pets/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const p = await Pet.findById(id)
      .select('_id nome owner')
      .populate('owner', 'nomeCompleto nomeContato razaoSocial email')
      .lean();
    if (!p) {
      return res.status(404).json({ message: 'Pet não encontrado.' });
    }
    const clienteNome = p.owner
      ? (p.owner.nomeCompleto || p.owner.nomeContato || p.owner.razaoSocial || p.owner.email || '')
      : '';
    res.json({
      _id: p._id,
      nome: p.nome,
      clienteId: p.owner?._id || null,
      clienteNome
    });
  } catch (e) {
    console.error('GET /func/pets/:id', e);
    res.status(500).json({ message: 'Erro ao buscar pet.' });
  }
});

router.delete('/agendamentos/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID inválido.' });

    const del = await Appointment.findByIdAndDelete(id).lean();
    if (!del) return res.status(404).json({ message: 'Agendamento não encontrado.' });

    return res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /func/agendamentos/:id', e);
    res.status(500).json({ message: 'Erro ao excluir agendamento' });
  }
});

module.exports = router;
