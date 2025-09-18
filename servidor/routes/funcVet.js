const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');

const authMiddleware = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/authorizeRoles');
const Pet = require('../models/Pet');
const Service = require('../models/Service');
const Appointment = require('../models/Appointment');
const VetConsultation = require('../models/VetConsultation');
const VetAttachment = require('../models/VetAttachment');
const {
  isDriveConfigured,
  getDriveFolderId,
  uploadBufferToDrive,
  deleteFile,
} = require('../utils/googleDrive');

const router = express.Router();
const requireStaff = authorizeRoles('funcionario', 'admin', 'admin_master');

const ALLOWED_ANEXO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.pdf']);
const ALLOWED_ANEXO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf']);
const MAX_ANEXO_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_ANEXO_FILE_COUNT = 10;

const uploadAnexoMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ANEXO_FILE_SIZE,
    files: MAX_ANEXO_FILE_COUNT,
  },
});

function handleAnexoUpload(req, res, next) {
  uploadAnexoMiddleware.array('arquivos', MAX_ANEXO_FILE_COUNT)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Cada arquivo deve ter no máximo 20MB.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ message: `Envie no máximo ${MAX_ANEXO_FILE_COUNT} arquivos por vez.` });
      }
      return res.status(400).json({ message: 'Falha ao processar os arquivos enviados.' });
    }
    if (err) {
      return res.status(400).json({ message: 'Falha ao processar os arquivos enviados.' });
    }
    return next();
  });
}

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

function toIsoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sanitizeFileName(name) {
  if (!name) return '';
  return String(name)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureFileNameWithExtension(name, extension) {
  if (!extension) return name || '';
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  const lower = (name || '').toLowerCase();
  if (lower.endsWith(ext.toLowerCase())) {
    return name || '';
  }
  return `${name || ''}${ext}`;
}

function inferExtensionFromFile(file) {
  const original = path.extname(file?.originalname || '').toLowerCase();
  if (original) return original;
  const mime = String(file?.mimetype || '').toLowerCase();
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'application/pdf') return '.pdf';
  return '';
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

function formatAttachment(doc) {
  if (!doc) return null;
  const createdAt = toIsoDate(doc.createdAt);
  const updatedAt = toIsoDate(doc.updatedAt) || createdAt;
  const arquivosRaw = Array.isArray(doc.arquivos) ? doc.arquivos : [];
  const arquivos = arquivosRaw
    .map((file) => {
      if (!file) return null;
      const fileId = toStringSafe(file._id || file.id);
      const extension = typeof file.extension === 'string' ? file.extension : '';
      return {
        id: fileId || undefined,
        _id: fileId || undefined,
        nome: file.nome || file.originalName || 'Arquivo',
        originalName: file.originalName || '',
        mimeType: file.mimeType || '',
        size: Number(file.size || 0),
        extension: extension || '',
        url: file.url || file.driveViewLink || file.driveContentLink || '',
        driveFileId: file.driveFileId || '',
        createdAt: toIsoDate(file.createdAt) || createdAt,
      };
    })
    .filter(Boolean);

  arquivos.sort((a, b) => {
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });

  return {
    id: toStringSafe(doc._id),
    _id: toStringSafe(doc._id),
    clienteId: toStringSafe(doc.cliente),
    petId: toStringSafe(doc.pet),
    appointmentId: toStringSafe(doc.appointment),
    observacao: typeof doc.observacao === 'string' ? doc.observacao : '',
    createdAt,
    updatedAt,
    arquivos,
  };
}

router.get('/vet/anexos', authMiddleware, requireStaff, async (req, res) => {
  try {
    const clienteId = normalizeObjectId(req.query.clienteId);
    const petId = normalizeObjectId(req.query.petId);
    const appointmentId = normalizeObjectId(req.query.appointmentId);

    if (!(clienteId && petId)) {
      return res.status(400).json({ message: 'clienteId e petId são obrigatórios.' });
    }

    const petCheck = await ensurePetBelongsToCliente(petId, clienteId);
    if (!petCheck.ok) {
      return res.status(petCheck.status).json({ message: petCheck.message });
    }

    const query = {
      cliente: clienteId,
      pet: petId,
    };

    if (appointmentId) {
      query.$or = [
        { appointment: appointmentId },
        { appointment: { $exists: false } },
        { appointment: null },
      ];
    }

    const docs = await VetAttachment.find(query)
      .sort({ createdAt: -1 })
      .lean();

    const formatted = docs.map(formatAttachment).filter(Boolean);
    return res.json(formatted);
  } catch (error) {
    console.error('GET /func/vet/anexos', error);
    return res.status(500).json({ message: 'Erro ao carregar anexos.' });
  }
});

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

router.post('/vet/anexos', authMiddleware, requireStaff, handleAnexoUpload, async (req, res) => {
  const uploadedDriveIds = [];
  try {
    if (!isDriveConfigured()) {
      return res.status(500).json({ message: 'Integração com o Google Drive não está configurada.' });
    }

    const cliente = normalizeObjectId(req.body.clienteId);
    const pet = normalizeObjectId(req.body.petId);
    const appointment = normalizeObjectId(req.body.appointmentId);

    if (!(cliente && pet)) {
      return res.status(400).json({ message: 'clienteId e petId são obrigatórios.' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return res.status(400).json({ message: 'Envie ao menos um arquivo.' });
    }

    const invalidFile = files.find((file) => {
      const extension = inferExtensionFromFile(file).toLowerCase();
      const mime = String(file?.mimetype || '').toLowerCase();
      return !(
        (extension && ALLOWED_ANEXO_EXTENSIONS.has(extension)) ||
        ALLOWED_ANEXO_MIME_TYPES.has(mime)
      );
    });

    if (invalidFile) {
      return res.status(400).json({
        message: `Formato de arquivo não suportado: ${invalidFile.originalname || 'arquivo'}. Permitido: PNG, JPG, JPEG ou PDF.`,
      });
    }

    const petCheck = await ensurePetBelongsToCliente(pet, cliente);
    if (!petCheck.ok) {
      return res.status(petCheck.status).json({ message: petCheck.message });
    }

    const appointmentCheck = await ensureAppointmentLink(appointment, cliente, pet, null);
    if (!appointmentCheck.ok) {
      return res.status(appointmentCheck.status).json({ message: appointmentCheck.message });
    }

    const rawNames = req.body['nomes[]'];
    const providedNames = Array.isArray(rawNames)
      ? rawNames
      : (typeof rawNames === 'string' ? [rawNames] : []);

    const folderId = getDriveFolderId();
    const uploadedFiles = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const providedName = typeof providedNames[index] === 'string' ? providedNames[index] : '';
      const sanitizedProvided = sanitizeFileName(providedName);
      const fallbackName = sanitizeFileName(file.originalname) || `Arquivo ${index + 1}`;
      const displayName = sanitizedProvided || fallbackName || `Arquivo ${index + 1}`;
      const extension = inferExtensionFromFile(file).toLowerCase();

      let driveBaseName = sanitizeFileName(displayName) || `arquivo-${Date.now()}-${index + 1}`;
      let driveFileName = ensureFileNameWithExtension(driveBaseName, extension || inferExtensionFromFile(file));
      driveFileName = sanitizeFileName(driveFileName);
      if (!driveFileName) {
        driveFileName = `arquivo-${Date.now()}-${index + 1}${extension || ''}`;
      } else if (extension && !driveFileName.toLowerCase().endsWith(extension)) {
        driveFileName = `${driveFileName}${extension}`;
      }

      const uploadResult = await uploadBufferToDrive(file.buffer, {
        mimeType: file.mimetype || 'application/octet-stream',
        name: driveFileName,
        folderId,
      });

      if (uploadResult?.id) {
        uploadedDriveIds.push(uploadResult.id);
      }

      uploadedFiles.push({
        nome: displayName,
        originalName: file.originalname || '',
        mimeType: uploadResult?.mimeType || file.mimetype || '',
        size: Number(uploadResult?.size) || Number(file.size || 0),
        extension: extension || '',
        url: uploadResult?.webViewLink || uploadResult?.webContentLink || '',
        driveFileId: uploadResult?.id || '',
        driveViewLink: uploadResult?.webViewLink || '',
        driveContentLink: uploadResult?.webContentLink || '',
        createdAt: new Date(),
      });
    }

    const nowUserId = normalizeObjectId(req.user?.id);
    const doc = await VetAttachment.create({
      cliente,
      pet,
      appointment: appointment || undefined,
      observacao: typeof req.body.observacao === 'string' ? req.body.observacao.trim() : '',
      arquivos: uploadedFiles,
      createdBy: nowUserId || undefined,
      updatedBy: nowUserId || undefined,
    });

    const full = await VetAttachment.findById(doc._id).lean();
    return res.status(201).json(formatAttachment(full));
  } catch (error) {
    if (uploadedDriveIds.length) {
      await Promise.allSettled(uploadedDriveIds.map((id) => deleteFile(id)));
    }
    console.error('POST /func/vet/anexos', error);
    let message = 'Erro ao salvar anexos.';
    if (error?.body) {
      try {
        const parsed = JSON.parse(error.body.toString('utf8'));
        if (parsed?.error?.message) {
          message = `Google Drive: ${parsed.error.message}`;
        } else if (parsed?.error_description) {
          message = `Google Drive: ${parsed.error_description}`;
        }
      } catch (_) {
        // ignore parsing issues
      }
    }
    if (message === 'Erro ao salvar anexos.' && error?.message) {
      message = error.message;
    }
    return res.status(500).json({ message });
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
