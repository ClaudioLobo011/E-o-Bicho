const express = require('express');
const mongoose = require('mongoose');

const authMiddleware = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/authorizeRoles');
const Pet = require('../models/Pet');
const Service = require('../models/Service');
const Appointment = require('../models/Appointment');
const VetConsultation = require('../models/VetConsultation');

const router = express.Router();
const requireStaff = authorizeRoles('funcionario', 'admin', 'admin_master');

function normalizeObjectId(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (!mongoose.Types.ObjectId.isValid(str)) return null;
  return str;
}

function toStringSafe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && typeof value.toString === 'function') {
    return value.toString();
  }
  try {
    return String(value);
  } catch (_) {
    return null;
  }
}

function isVetService(serviceDoc = {}) {
  const raw = Array.isArray(serviceDoc.categorias)
    ? serviceDoc.categorias
    : (serviceDoc.categorias ? [serviceDoc.categorias] : []);
  return raw.some((cat) => String(cat || '').trim().toLowerCase() === 'veterinario');
}

async function ensurePetBelongsToCliente(petId, clienteId) {
  const pet = await Pet.findById(petId).select('owner').lean();
  if (!pet) {
    return { ok: false, status: 404, message: 'Pet não encontrado.' };
  }
  if (clienteId && toStringSafe(pet.owner) !== clienteId) {
    return { ok: false, status: 400, message: 'Pet não pertence ao tutor informado.' };
  }
  return { ok: true };
}

async function fetchVetService(servicoId) {
  const service = await Service.findById(servicoId).select('categorias nome').lean();
  if (!service) {
    return { ok: false, status: 404, message: 'Serviço não encontrado.' };
  }
  if (!isVetService(service)) {
    return { ok: false, status: 400, message: 'Serviço informado não é veterinário.' };
  }
  return { ok: true, service };
}

async function ensureAppointmentLink(appointmentId, clienteId, petId, servicoId) {
  if (!appointmentId) {
    return { ok: true, appointment: null };
  }
  const appointment = await Appointment.findById(appointmentId)
    .select('cliente pet servico itens')
    .lean();
  if (!appointment) {
    return { ok: false, status: 404, message: 'Agendamento não encontrado.' };
  }
  if (clienteId && toStringSafe(appointment.cliente) !== clienteId) {
    return { ok: false, status: 400, message: 'Agendamento não pertence ao tutor informado.' };
  }
  if (petId && toStringSafe(appointment.pet) !== petId) {
    return { ok: false, status: 400, message: 'Agendamento não pertence ao pet informado.' };
  }
  if (servicoId) {
    const allowed = new Set();
    if (appointment.servico) {
      allowed.add(toStringSafe(appointment.servico));
    }
    if (Array.isArray(appointment.itens)) {
      appointment.itens.forEach((item) => {
        if (item && item.servico) {
          allowed.add(toStringSafe(item.servico));
        }
      });
    }
    if (allowed.size && !allowed.has(servicoId)) {
      return { ok: false, status: 400, message: 'Serviço informado não pertence ao agendamento selecionado.' };
    }
  }
  return { ok: true, appointment };
}

function formatConsultation(doc) {
  if (!doc) return null;
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt || null;
  const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt || createdAt;
  return {
    _id: toStringSafe(doc._id),
    clienteId: toStringSafe(doc.cliente),
    petId: toStringSafe(doc.pet),
    servicoId: toStringSafe(doc.servico?._id || doc.servico),
    servicoNome: doc.servico?.nome || null,
    appointmentId: toStringSafe(doc.appointment),
    anamnese: doc.anamnese || '',
    exameFisico: doc.exameFisico || '',
    diagnostico: doc.diagnostico || '',
    createdAt,
    updatedAt,
  };
}

router.get('/vet/consultas', authMiddleware, requireStaff, async (req, res) => {
  try {
    const clienteId = normalizeObjectId(req.query.clienteId);
    const petId = normalizeObjectId(req.query.petId);
    const appointmentId = normalizeObjectId(req.query.appointmentId);

    if (!clienteId || !petId) {
      return res.status(400).json({ message: 'clienteId e petId são obrigatórios.' });
    }

    const filter = { cliente: clienteId, pet: petId };
    if (appointmentId) {
      filter.appointment = appointmentId;
    }

    const docs = await VetConsultation.find(filter)
      .sort({ createdAt: -1 })
      .populate('servico', 'nome categorias')
      .lean();

    return res.json(docs.map(formatConsultation));
  } catch (error) {
    console.error('GET /func/vet/consultas', error);
    res.status(500).json({ message: 'Erro ao listar consultas.' });
  }
});

router.get('/vet/consultas/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const id = normalizeObjectId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    const doc = await VetConsultation.findById(id)
      .populate('servico', 'nome categorias')
      .lean();
    if (!doc) {
      return res.status(404).json({ message: 'Consulta não encontrada.' });
    }
    return res.json(formatConsultation(doc));
  } catch (error) {
    console.error('GET /func/vet/consultas/:id', error);
    res.status(500).json({ message: 'Erro ao buscar consulta.' });
  }
});

router.post('/vet/consultas', authMiddleware, requireStaff, async (req, res) => {
  try {
    const {
      clienteId,
      petId,
      servicoId,
      appointmentId,
      anamnese,
      exameFisico,
      diagnostico,
    } = req.body || {};

    const cliente = normalizeObjectId(clienteId);
    const pet = normalizeObjectId(petId);
    const servico = normalizeObjectId(servicoId);
    const appointment = normalizeObjectId(appointmentId);

    if (!cliente || !pet || !servico) {
      return res.status(400).json({ message: 'clienteId, petId e servicoId são obrigatórios.' });
    }

    const petCheck = await ensurePetBelongsToCliente(pet, cliente);
    if (!petCheck.ok) {
      return res.status(petCheck.status).json({ message: petCheck.message });
    }

    const serviceCheck = await fetchVetService(servico);
    if (!serviceCheck.ok) {
      return res.status(serviceCheck.status).json({ message: serviceCheck.message });
    }

    const appointmentCheck = await ensureAppointmentLink(appointment, cliente, pet, servico);
    if (!appointmentCheck.ok) {
      return res.status(appointmentCheck.status).json({ message: appointmentCheck.message });
    }

    const nowUserId = normalizeObjectId(req.user?.id);

    const doc = await VetConsultation.create({
      cliente,
      pet,
      servico,
      appointment: appointment || undefined,
      anamnese: typeof anamnese === 'string' ? anamnese : '',
      exameFisico: typeof exameFisico === 'string' ? exameFisico : '',
      diagnostico: typeof diagnostico === 'string' ? diagnostico : '',
      createdBy: nowUserId || undefined,
      updatedBy: nowUserId || undefined,
    });

    const full = await VetConsultation.findById(doc._id)
      .populate('servico', 'nome categorias')
      .lean();

    return res.status(201).json(formatConsultation(full));
  } catch (error) {
    console.error('POST /func/vet/consultas', error);
    res.status(500).json({ message: 'Erro ao salvar consulta.' });
  }
});

router.put('/vet/consultas/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const id = normalizeObjectId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'ID inválido.' });
    }

    const existing = await VetConsultation.findById(id).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Consulta não encontrada.' });
    }

    const cliente = toStringSafe(existing.cliente);
    const pet = toStringSafe(existing.pet);

    const {
      anamnese,
      exameFisico,
      diagnostico,
      servicoId,
      appointmentId,
      clienteId,
      petId,
    } = req.body || {};

    const bodyClienteId = normalizeObjectId(clienteId);
    if (bodyClienteId && bodyClienteId !== cliente) {
      return res.status(400).json({ message: 'Consulta pertence a outro tutor.' });
    }
    const bodyPetId = normalizeObjectId(petId);
    if (bodyPetId && bodyPetId !== pet) {
      return res.status(400).json({ message: 'Consulta pertence a outro pet.' });
    }

    const updates = {};
    if (typeof anamnese !== 'undefined') updates.anamnese = String(anamnese || '');
    if (typeof exameFisico !== 'undefined') updates.exameFisico = String(exameFisico || '');
    if (typeof diagnostico !== 'undefined') updates.diagnostico = String(diagnostico || '');

    const nextServicoId = normalizeObjectId(servicoId) || toStringSafe(existing.servico);
    if (!nextServicoId) {
      return res.status(400).json({ message: 'Serviço inválido.' });
    }
    const serviceCheck = await fetchVetService(nextServicoId);
    if (!serviceCheck.ok) {
      return res.status(serviceCheck.status).json({ message: serviceCheck.message });
    }
    if (normalizeObjectId(servicoId)) {
      updates.servico = nextServicoId;
    }

    const nextAppointmentId = typeof appointmentId !== 'undefined'
      ? normalizeObjectId(appointmentId)
      : toStringSafe(existing.appointment);

    const appointmentCheck = await ensureAppointmentLink(nextAppointmentId, cliente, pet, nextServicoId);
    if (!appointmentCheck.ok) {
      return res.status(appointmentCheck.status).json({ message: appointmentCheck.message });
    }

    if (typeof appointmentId !== 'undefined') {
      updates.appointment = nextAppointmentId || undefined;
    }

    const updater = normalizeObjectId(req.user?.id);
    if (updater) {
      updates.updatedBy = updater;
    }
    updates.updatedAt = new Date();

    const full = await VetConsultation.findByIdAndUpdate(id, { $set: updates }, { new: true })
      .populate('servico', 'nome categorias')
      .lean();

    if (!full) {
      return res.status(404).json({ message: 'Consulta não encontrada.' });
    }

    return res.json(formatConsultation(full));
  } catch (error) {
    console.error('PUT /func/vet/consultas/:id', error);
    res.status(500).json({ message: 'Erro ao atualizar consulta.' });
  }
});

module.exports = router;
