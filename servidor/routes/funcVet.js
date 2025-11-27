const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');

const authMiddleware = require('../middlewares/authMiddleware');
const authorizeRoles = require('../middlewares/authorizeRoles');
const Pet = require('../models/Pet');
const User = require('../models/User');
const Service = require('../models/Service');
const Appointment = require('../models/Appointment');
const VetConsultation = require('../models/VetConsultation');
const VetAttachment = require('../models/VetAttachment');
const VetDocument = require('../models/VetDocument');
const VetDocumentRecord = require('../models/VetDocumentRecord');
const VetRecipe = require('../models/VetRecipe');
const VetRecipeRecord = require('../models/VetRecipeRecord');
const PetWeight = require('../models/PetWeight');
const VetClinicHistory = require('../models/VetClinicHistory');
const InternacaoRegistro = require('../models/InternacaoRegistro');
const {
  isDriveConfigured,
  getDriveFolderId,
  uploadBufferToDrive,
  deleteFile,
} = require('../utils/googleDrive');

const router = express.Router();
const requireStaff = authorizeRoles('funcionario', 'admin', 'admin_master');
const requireAdmin = authorizeRoles('admin', 'admin_master');

const ALLOWED_ANEXO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.pdf']);
const ALLOWED_ANEXO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf']);
const MAX_ANEXO_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_ANEXO_FILE_COUNT = 10;
const EXAME_ATTACHMENT_OBSERVACAO_PREFIX = '__vet_exame__:';
const ALLOWED_SIGNED_DOCUMENT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.pdf']);
const ALLOWED_SIGNED_DOCUMENT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'application/pdf']);
const MAX_SIGNED_DOCUMENT_FILE_SIZE = 20 * 1024 * 1024; // 20MB

const uploadAnexoMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_ANEXO_FILE_SIZE,
    files: MAX_ANEXO_FILE_COUNT,
  },
});

const uploadDocumentoAssinadoMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_SIGNED_DOCUMENT_FILE_SIZE,
    files: 1,
  },
});

const RECEITA_REGISTROS_BASE_PATHS = ['/vet/receitas-registros', '/receitas-registros'];
const RECEITA_REGISTROS_ID_PATHS = RECEITA_REGISTROS_BASE_PATHS.map((base) => `${base}/:id`);
const RECEITA_REGISTROS_SIGNATURE_PATHS = RECEITA_REGISTROS_ID_PATHS.map((base) => `${base}/assinatura`);

function handleAnexoUpload(req, res, next) {
  uploadAnexoMiddleware.array('arquivos', MAX_ANEXO_FILE_COUNT)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Cada arquivo deve ter no mÃ¡ximo 20MB.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ message: `Envie no mÃ¡ximo ${MAX_ANEXO_FILE_COUNT} arquivos por vez.` });
      }
      return res.status(400).json({ message: 'Falha ao processar os arquivos enviados.' });
    }
    if (err) {
      return res.status(400).json({ message: 'Falha ao processar os arquivos enviados.' });
    }
    return next();
  });
}

function handleDocumentoAssinadoUpload(req, res, next) {
  uploadDocumentoAssinadoMiddleware.single('arquivo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'O documento assinado deve ter no mÃ¡ximo 20MB.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ message: 'Envie apenas um documento assinado por vez.' });
      }
      return res.status(400).json({ message: 'Falha ao processar o documento enviado.' });
    }
    if (err) {
      return res.status(400).json({ message: 'Falha ao processar o documento enviado.' });
    }
    return next();
  });
}

function handleReceitaAssinadaUpload(req, res, next) {
  uploadDocumentoAssinadoMiddleware.single('arquivo')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'A receita assinada deve ter no mÃ¡ximo 20MB.' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ message: 'Envie apenas uma receita assinada por vez.' });
      }
      return res.status(400).json({ message: 'Falha ao processar a receita enviada.' });
    }
    if (err) {
      return res.status(400).json({ message: 'Falha ao processar a receita enviada.' });
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

async function registerInternacaoPesoUpdate({ internacaoId, pesoValue, author }) {
  const targetId = normalizeObjectId(internacaoId);
  if (!targetId) return null;

  const record = await InternacaoRegistro.findById(targetId);
  if (!record) return null;

  const now = new Date();
  const descricaoParts = [];
  const previousPeso = toStringSafe(record.petPeso);
  if (previousPeso) {
    descricaoParts.push(`Peso anterior: ${previousPeso} Kg.`);
  }
  descricaoParts.push(`Peso atualizado para ${pesoValue} Kg.`);

  record.petPeso = String(pesoValue);
  record.petPesoAtualizadoEm = now;
  record.historico = Array.isArray(record.historico) ? record.historico : [];
  record.historico.unshift({
    tipo: 'Peso',
    descricao: descricaoParts.join(' '),
    criadoPor: author || 'Sistema',
    criadoEm: now,
  });

  await record.save();
  return record;
}

function hasSignedFileData(file) {
  if (!file || typeof file !== 'object') return false;

  const stringFields = [
    'url',
    'driveFileId',
    'driveViewLink',
    'driveContentLink',
    'originalName',
    'mimeType',
    'extension',
  ];

  if (
    stringFields.some((field) => {
      const value = file[field];
      return typeof value === 'string' && value.trim().length > 0;
    })
  ) {
    return true;
  }

  if (Number(file.size || 0) > 0) return true;

  if (file.uploadedAt && toIsoDate(file.uploadedAt)) {
    return true;
  }

  return false;
}

function sanitizeFileName(name) {
  if (!name) return '';
  return String(name)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeFolderSegment(name, fallback = '') {
  const primary = sanitizeFileName(name).slice(0, 100);
  if (primary) return primary;
  const secondary = sanitizeFileName(fallback).slice(0, 100);
  return secondary || '';
}

function sanitizePetCode(value) {
  if (value === null || value === undefined) return '';
  const withoutPrefix = sanitizeFileName(value)
    .replace(/^pet[-_\s]*/i, '')
    .trim();
  if (!withoutPrefix) return '';
  return sanitizeFolderSegment(withoutPrefix);
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

function extractAllowedStaffTypes(serviceDoc) {
  if (!serviceDoc) return [];
  const raw = [];
  if (Array.isArray(serviceDoc.tiposPermitidos)) raw.push(...serviceDoc.tiposPermitidos);
  if (serviceDoc.grupo && Array.isArray(serviceDoc.grupo.tiposPermitidos)) {
    raw.push(...serviceDoc.grupo.tiposPermitidos);
  }
  return [...new Set(raw.map((value) => String(value || '').trim()).filter(Boolean))];
}

function formatWaitingAppointment(doc) {
  if (!doc || typeof doc !== 'object') return null;

  const appointmentId = normalizeObjectId(doc._id || doc.id || doc.appointmentId);
  if (!appointmentId) return null;

  const tutorId = normalizeObjectId(doc.cliente?._id || doc.cliente);
  const petId = normalizeObjectId(doc.pet?._id || doc.pet);
  const storeId = normalizeObjectId(doc.store?._id || doc.store);

  const itens = Array.isArray(doc.itens) ? doc.itens : [];
  const servicesSource = itens.length
    ? itens
    : (doc.servico
        ? [{ servico: doc.servico, valor: typeof doc.valor === 'number' ? doc.valor : null }]
        : []);

  const services = servicesSource.map((item) => {
    const serviceDoc = item && typeof item.servico === 'object' ? item.servico : null;
    const serviceId = normalizeObjectId(serviceDoc?._id || item?.servico);
    const valor = Number(
      item?.valor ||
        (serviceDoc && typeof serviceDoc.valor === 'number' ? serviceDoc.valor : 0),
    ) || 0;
    const categorias = Array.isArray(serviceDoc?.categorias)
      ? serviceDoc.categorias.filter(Boolean)
      : [];
    return {
      _id: serviceId || null,
      nome: serviceDoc && serviceDoc.nome ? String(serviceDoc.nome) : '—',
      valor,
      categorias,
      tiposPermitidos: extractAllowedStaffTypes(serviceDoc || {}),
    };
  });

  const total = services.reduce((sum, svc) => sum + Number(svc.valor || 0), 0) || Number(doc.valor || 0) || 0;

  const profissionalDoc = doc.profissional && typeof doc.profissional === 'object' ? doc.profissional : null;
  const profissionalId = normalizeObjectId(profissionalDoc?._id || doc.profissional);
  const profissionalNome = profissionalDoc
    ? (profissionalDoc.nomeCompleto || profissionalDoc.nomeContato || profissionalDoc.razaoSocial || '')
    : '';

  const clienteDoc = doc.cliente && typeof doc.cliente === 'object' ? doc.cliente : null;
  const tutorNome = clienteDoc
    ? (
        clienteDoc.nomeCompleto ||
        clienteDoc.nomeContato ||
        clienteDoc.razaoSocial ||
        clienteDoc.email ||
        ''
      )
    : '';

  const petDoc = doc.pet && typeof doc.pet === 'object' ? doc.pet : null;
  const petNome = petDoc && petDoc.nome ? String(petDoc.nome) : '';

  const storeIdCandidates = [];
  if (storeId) storeIdCandidates.push(storeId);
  if (Array.isArray(doc.storeIdCandidates)) {
    doc.storeIdCandidates.forEach((candidate) => {
      const normalized = normalizeObjectId(candidate);
      if (normalized && !storeIdCandidates.includes(normalized)) {
        storeIdCandidates.push(normalized);
      }
    });
  }

  return {
    _id: appointmentId,
    id: appointmentId,
    appointmentId,
    storeId: storeId || null,
    storeIdCandidates,
    clienteId: tutorId || null,
    tutorNome,
    petId: petId || null,
    petNome,
    status: doc.status || 'em_espera',
    scheduledAt: toIsoDate(doc.scheduledAt),
    valor: total,
    observacoes: typeof doc.observacoes === 'string' ? doc.observacoes.trim() : '',
    servicos: services,
    profissionalId: profissionalId || null,
    profissionalNome,
    codigoVenda: doc.codigoVenda ? String(doc.codigoVenda) : null,
  };
}

function parseStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => (item == null ? '' : String(item)))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (item == null ? '' : String(item)))
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch (_) {
      // ignore JSON parse error
    }
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function parseRenameMap(value) {
  if (!value) return {};
  let source = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      source = JSON.parse(trimmed);
    } catch (_) {
      return {};
    }
  }
  if (typeof source !== 'object' || Array.isArray(source)) return {};
  const result = {};
  for (const [key, label] of Object.entries(source)) {
    if (!key) continue;
    const normalizedKey = String(key).trim();
    if (!normalizedKey) continue;
    const normalizedLabel = label == null ? '' : String(label).trim();
    if (!normalizedLabel) continue;
    result[normalizedKey] = normalizedLabel;
  }
  return result;
}

function isVetService(serviceDoc = {}) {
  const raw = Array.isArray(serviceDoc.categorias)
    ? serviceDoc.categorias
    : (serviceDoc.categorias ? [serviceDoc.categorias] : []);
  return raw.some((cat) => String(cat || '').trim().toLowerCase() === 'veterinario');
}

async function ensurePetBelongsToCliente(petId, clienteId) {
  const pet = await Pet.findById(petId).select('owner nome').lean();
  if (!pet) {
    return { ok: false, status: 404, message: 'Pet nÃ£o encontrado.' };
  }
  if (clienteId && toStringSafe(pet.owner) !== clienteId) {
    return { ok: false, status: 400, message: 'Pet nÃ£o pertence ao tutor informado.' };
  }
  return { ok: true, pet };
}

async function fetchVetService(servicoId) {
  const service = await Service.findById(servicoId).select('categorias nome').lean();
  if (!service) {
    return { ok: false, status: 404, message: 'ServiÃ§o nÃ£o encontrado.' };
  }
  if (!isVetService(service)) {
    return { ok: false, status: 400, message: 'ServiÃ§o informado nÃ£o Ã© veterinÃ¡rio.' };
  }
  return { ok: true, service };
}

async function ensureAppointmentLink(appointmentId, clienteId, petId, servicoId) {
  if (!appointmentId) {
    return { ok: true, appointment: null };
  }
  const appointment = await Appointment.findById(appointmentId)
    .select('cliente pet servico itens codigoVenda createdAt')
    .lean();
  if (!appointment) {
    return { ok: false, status: 404, message: 'Agendamento nÃ£o encontrado.' };
  }
  if (clienteId && toStringSafe(appointment.cliente) !== clienteId) {
    return { ok: false, status: 400, message: 'Agendamento nÃ£o pertence ao tutor informado.' };
  }
  if (petId && toStringSafe(appointment.pet) !== petId) {
    return { ok: false, status: 400, message: 'Agendamento nÃ£o pertence ao pet informado.' };
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
      return { ok: false, status: 400, message: 'ServiÃ§o informado nÃ£o pertence ao agendamento selecionado.' };
    }
  }
  return { ok: true, appointment };
}

function safeJsonClone(value) {
  if (value === null || value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return null;
  }
}

function cloneArray(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  value.forEach((item) => {
    const cloned = safeJsonClone(item);
    if (cloned !== null) {
      result.push(cloned);
    }
  });
  return result;
}

function formatHistoryEntry(doc) {
  if (!doc) return null;
  const raw = doc.toObject ? doc.toObject() : doc;
  const finalizadoEm = toIsoDate(raw.finalizadoEm) || toIsoDate(raw.createdAt);
  return {
    id: toStringSafe(raw._id),
    _id: toStringSafe(raw._id),
    clienteId: toStringSafe(raw.cliente),
    petId: toStringSafe(raw.pet),
    appointmentId: toStringSafe(raw.appointment),
    finalizadoEm,
    agenda: safeJsonClone(raw.agenda) || {},
    consultas: Array.isArray(raw.consultas) ? raw.consultas : [],
    vacinas: Array.isArray(raw.vacinas) ? raw.vacinas : [],
    anexos: Array.isArray(raw.anexos) ? raw.anexos : [],
    exames: Array.isArray(raw.exames) ? raw.exames : [],
    pesos: Array.isArray(raw.pesos) ? raw.pesos : [],
    observacoes: Array.isArray(raw.observacoes) ? raw.observacoes : [],
    documentos: Array.isArray(raw.documentos) ? raw.documentos : [],
    receitas: Array.isArray(raw.receitas) ? raw.receitas : [],
    finalizadoPor: toStringSafe(raw.finalizadoPor) || null,
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
  };
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

function formatDocumentRecord(doc) {
  if (!doc) return null;
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt || null;
  const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt || createdAt;
  let signedFile = null;

  if (doc.signedFile && typeof doc.signedFile === 'object' && hasSignedFileData(doc.signedFile)) {
    const file = doc.signedFile;
    const fileCreatedAt = toIsoDate(file.uploadedAt) || updatedAt || createdAt;
    const url = file.url || file.driveViewLink || file.driveContentLink || '';
    signedFile = {
      nome: file.nome || file.originalName || 'Documento assinado',
      originalName: file.originalName || '',
      mimeType: file.mimeType || '',
      size: Number(file.size || 0),
      extension: file.extension || '',
      url,
      driveFileId: file.driveFileId || '',
      driveViewLink: file.driveViewLink || '',
      driveContentLink: file.driveContentLink || '',
      uploadedAt: fileCreatedAt,
    };
  }

  return {
    _id: toStringSafe(doc._id),
    id: toStringSafe(doc._id),
    clienteId: toStringSafe(doc.cliente),
    petId: toStringSafe(doc.pet),
    documentoId: toStringSafe(doc.documento),
    appointmentId: toStringSafe(doc.appointment),
    descricao: doc.descricao || '',
    conteudo: doc.conteudo || '',
    conteudoOriginal: doc.conteudoOriginal || '',
    preview: doc.preview || '',
    createdAt,
    updatedAt,
    signedFile,
  };
}

function formatRecipeRecord(doc) {
  if (!doc) return null;
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt || null;
  const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt || createdAt;
  let signedFile = null;

  if (doc.signedFile && typeof doc.signedFile === 'object' && hasSignedFileData(doc.signedFile)) {
    const file = doc.signedFile;
    const fileCreatedAt = toIsoDate(file.uploadedAt) || updatedAt || createdAt;
    const url = file.url || file.driveViewLink || file.driveContentLink || '';
    signedFile = {
      nome: file.nome || file.originalName || 'Receita assinada',
      originalName: file.originalName || '',
      mimeType: file.mimeType || '',
      size: Number(file.size || 0),
      extension: file.extension || '',
      url,
      driveFileId: file.driveFileId || '',
      driveViewLink: file.driveViewLink || '',
      driveContentLink: file.driveContentLink || '',
      uploadedAt: fileCreatedAt,
    };
  }

  return {
    _id: toStringSafe(doc._id),
    id: toStringSafe(doc._id),
    clienteId: toStringSafe(doc.cliente),
    petId: toStringSafe(doc.pet),
    receitaId: toStringSafe(doc.receita),
    appointmentId: toStringSafe(doc.appointment),
    descricao: doc.descricao || '',
    conteudo: doc.conteudo || '',
    conteudoOriginal: doc.conteudoOriginal || '',
    preview: doc.preview || '',
    createdAt,
    updatedAt,
    signedFile,
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

function sanitizeDocumentContent(html) {
  if (typeof html !== 'string') return '';

  let safe = html;
  const blockedTagPatterns = [
    /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
    /<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi,
    /<object[\s\S]*?>[\s\S]*?<\/object>/gi,
    /<embed[\s\S]*?>[\s\S]*?<\/embed>/gi,
    /<link[^>]*?>/gi,
    /<meta[^>]*?>/gi,
    /<base[^>]*?>/gi,
  ];

  blockedTagPatterns.forEach((pattern) => {
    safe = safe.replace(pattern, '');
  });

  safe = safe
    .replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, '')
    .replace(/\s+(?:xlink:)?href\s*=\s*(['"])\s*(?:javascript|vbscript):[^'">]*\1/gi, ' href="#"')
    .replace(/\s+src\s*=\s*(['"])\s*(?:javascript|vbscript):[^'">]*\1/gi, ' src="#"')
    .replace(/url\((['"]?)\s*(?:javascript|vbscript):[^)]*?\1\)/gi, 'url()')
    .replace(/data:text\/html/gi, '');

  return safe.trim();
}

function extractPlainTextContent(html) {
  if (!html) return '';
  return String(html)
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatUserRef(user) {
  if (!user) return null;
  if (typeof user === 'string') {
    const id = toStringSafe(user);
    return id ? { id, nome: '', email: '' } : null;
  }
  const id = toStringSafe(user._id || user.id);
  if (!id) return null;
  return {
    id,
    nome: typeof user.nome === 'string' ? user.nome : '',
    email: typeof user.email === 'string' ? user.email : '',
  };
}

function formatDocument(doc) {
  if (!doc) return null;
  const createdAt = toIsoDate(doc.createdAt);
  const updatedAt = toIsoDate(doc.updatedAt) || createdAt;
  return {
    id: toStringSafe(doc._id),
    _id: toStringSafe(doc._id),
    descricao: typeof doc.descricao === 'string' ? doc.descricao : '',
    conteudo: typeof doc.conteudo === 'string' ? doc.conteudo : '',
    createdAt,
    updatedAt,
    createdBy: formatUserRef(doc.createdBy),
    updatedBy: formatUserRef(doc.updatedBy),
  };
}

function formatRecipe(doc) {
  if (!doc) return null;
  const createdAt = toIsoDate(doc.createdAt);
  const updatedAt = toIsoDate(doc.updatedAt) || createdAt;
  return {
    id: toStringSafe(doc._id),
    _id: toStringSafe(doc._id),
    descricao: typeof doc.descricao === 'string' ? doc.descricao : '',
    conteudo: typeof doc.conteudo === 'string' ? doc.conteudo : '',
    createdAt,
    updatedAt,
    createdBy: formatUserRef(doc.createdBy),
    updatedBy: formatUserRef(doc.updatedBy),
  };
}

function parseWeight(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 0 ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const sanitized = raw.replace(/[^0-9.,]+/g, '');
  if (!sanitized) return null;
  const hasComma = sanitized.includes(',');
  let normalized = sanitized;
  if (hasComma) {
    normalized = sanitized.replace(/\./g, '').replace(',', '.');
  } else {
    const firstDot = sanitized.indexOf('.');
    if (firstDot >= 0) {
      const before = sanitized.slice(0, firstDot + 1);
      const after = sanitized.slice(firstDot + 1).replace(/\./g, '');
      normalized = `${before}${after}`;
    }
  }
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function formatPetWeightEntry(doc) {
  if (!doc) return null;
  const weightValue = parseWeight(doc.peso);
  if (weightValue === null) return null;
  const createdAt = toIsoDate(doc.createdAt);
  const updatedAt = toIsoDate(doc.updatedAt) || createdAt;
  return {
    id: toStringSafe(doc._id),
    _id: toStringSafe(doc._id),
    clienteId: toStringSafe(doc.cliente),
    petId: toStringSafe(doc.pet),
    peso: weightValue,
    registradoPor: doc.registradoPor ? toStringSafe(doc.registradoPor) : null,
    internacaoId: doc.internacao ? toStringSafe(doc.internacao) : null,
    registradoNaInternacao: !!doc.registradoNaInternacao,
    createdAt,
    updatedAt,
    isInitial: !!doc.isInitial,
  };
}

router.get('/vet/pesos', authMiddleware, requireStaff, async (req, res) => {
  try {
    let clienteId = normalizeObjectId(req.query.clienteId);
    let petId = normalizeObjectId(req.query.petId);
    const internacaoId = normalizeObjectId(req.query.internacaoId);

    if (!(clienteId && petId) && !internacaoId) {
      return res.status(400).json({ message: 'clienteId e petId sÃ£o obrigatÃ³rios.' });
    }

    let internacaoRegistro = null;
    if (internacaoId) {
      internacaoRegistro = await InternacaoRegistro.findById(internacaoId);
      if (!internacaoRegistro) {
        return res.status(404).json({ message: 'Internação não encontrada.' });
      }
      if (!petId) {
        petId = normalizeObjectId(internacaoRegistro.petId);
      }
    }

    const petDoc = petId
      ? await Pet.findById(petId)
          .select('owner peso createdAt updatedAt')
          .lean()
      : null;

    if (!petDoc) {
      return res.status(404).json({ message: 'Pet nÃ£o encontrado.' });
    }

    if (!clienteId) {
      clienteId = normalizeObjectId(petDoc.owner);
    }

    if (clienteId && toStringSafe(petDoc.owner) !== clienteId) {
      return res.status(400).json({ message: 'Pet nÃ£o pertence ao tutor informado.' });
    }

    const query = { pet: petId };

    const docs = await PetWeight.find(query)
      .sort({ createdAt: -1 })
      .lean();

    const formatted = docs.map(formatPetWeightEntry).filter(Boolean);
    const hasInitial = formatted.some((entry) => entry && entry.isInitial);

    if (!hasInitial && formatted.length === 0) {
      const initialWeight = parseWeight(petDoc.peso);
      if (initialWeight !== null) {
        const initialEntry = formatPetWeightEntry({
          _id: `initial-${petId}`,
          cliente: petDoc.owner,
          pet: petId,
          peso: initialWeight,
          createdAt: petDoc.createdAt || petDoc.updatedAt || new Date(),
          updatedAt: petDoc.createdAt || petDoc.updatedAt || new Date(),
          isInitial: true,
        });
        if (initialEntry) {
          formatted.push(initialEntry);
        }
      }
    }

    formatted.sort((a, b) => {
      const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    return res.json(formatted);
  } catch (error) {
    console.error('GET /func/vet/pesos', error);
    return res.status(500).json({ message: 'Erro ao carregar pesos.' });
  }
});

router.post('/vet/pesos', authMiddleware, requireStaff, async (req, res) => {
  try {
    let clienteId = normalizeObjectId(req.body.clienteId);
    let petId = normalizeObjectId(req.body.petId);
    const internacaoId = normalizeObjectId(req.body.internacaoId);
    const pesoValue = parseWeight(req.body.peso);

    if (!(clienteId && petId) && !internacaoId) {
      return res.status(400).json({ message: 'clienteId e petId são obrigatórios.' });
    }

    if (pesoValue === null || pesoValue <= 0) {
      return res.status(400).json({ message: 'Informe um peso válido.' });
    }

    let internacaoRegistro = null;
    if (internacaoId) {
      internacaoRegistro = await InternacaoRegistro.findById(internacaoId);
      if (!internacaoRegistro) {
        return res.status(404).json({ message: 'Internação não encontrada para vincular o peso.' });
      }
      if (!petId) {
        petId = normalizeObjectId(internacaoRegistro.petId);
      }
    }

    const petDoc = petId ? await Pet.findById(petId).select('owner peso createdAt updatedAt') : null;
    if (!petDoc) {
      return res.status(404).json({ message: 'Pet não encontrado.' });
    }

    if (!clienteId) {
      clienteId = normalizeObjectId(petDoc.owner);
    }

    if (clienteId && toStringSafe(petDoc.owner) !== clienteId) {
      return res.status(400).json({ message: 'Pet não pertence ao tutor informado.' });
    }

    const payload = {
      cliente: clienteId,
      pet: petId,
      peso: pesoValue,
    };

    if (internacaoRegistro) {
      payload.internacao = internacaoRegistro._id;
      payload.registradoNaInternacao = true;
    }

    const registeredBy = normalizeObjectId(req.user?.id || req.user?._id);
    if (registeredBy) {
      payload.registradoPor = registeredBy;
    }

    const previousWeightValue = parseWeight(petDoc.peso);

    const existingInitial = await PetWeight.findOne({ pet: petId, isInitial: true });
    if (!existingInitial) {
      const earliestWeight = await PetWeight.findOne({ pet: petId }).sort({ createdAt: 1 });
      if (earliestWeight) {
        if (!earliestWeight.isInitial) {
          earliestWeight.isInitial = true;
          await earliestWeight.save();
        }
      } else if (previousWeightValue !== null) {
        let initialTimestamp = petDoc.createdAt instanceof Date ? petDoc.createdAt : null;
        if (!initialTimestamp && petDoc.createdAt) {
          const parsed = new Date(petDoc.createdAt);
          if (!Number.isNaN(parsed.getTime())) {
            initialTimestamp = parsed;
          }
        }
        if (!initialTimestamp && petDoc.updatedAt) {
          if (petDoc.updatedAt instanceof Date) {
            initialTimestamp = petDoc.updatedAt;
          } else {
            const parsed = new Date(petDoc.updatedAt);
            if (!Number.isNaN(parsed.getTime())) {
              initialTimestamp = parsed;
            }
          }
        }
        if (!initialTimestamp) {
          initialTimestamp = new Date();
        }

        const initialPayload = {
          cliente: clienteId,
          pet: petId,
          peso: previousWeightValue,
          isInitial: true,
          createdAt: initialTimestamp,
          updatedAt: initialTimestamp,
        };

        await PetWeight.create(initialPayload);
      }
    }

    const created = await PetWeight.create(payload);

    petDoc.peso = String(pesoValue);
    await petDoc.save();

    if (internacaoRegistro) {
      await registerInternacaoPesoUpdate({
        internacaoId: internacaoRegistro._id,
        pesoValue,
        author: req.user?.email,
      });
    }

    const formatted = formatPetWeightEntry(created.toObject());
    return res.status(201).json(formatted);
  } catch (error) {
    console.error('POST /func/vet/pesos', error);
    return res.status(500).json({ message: 'Erro ao registrar peso.' });
  }
});

router.put('/vet/pesos/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const weightId = normalizeObjectId(req.params.id);
    let clienteId = normalizeObjectId(req.body.clienteId);
    let petId = normalizeObjectId(req.body.petId);
    const internacaoId = normalizeObjectId(req.body.internacaoId);
    const pesoValue = parseWeight(req.body.peso);

    if (!weightId) {
      return res.status(400).json({ message: 'ID inválido.' });
    }
    if (!(clienteId && petId) && !internacaoId) {
      return res.status(400).json({ message: 'clienteId e petId são obrigatórios.' });
    }
    if (pesoValue === null || pesoValue <= 0) {
      return res.status(400).json({ message: 'Informe um peso válido.' });
    }

    const weightDoc = await PetWeight.findById(weightId);
    if (!weightDoc) {
      return res.status(404).json({ message: 'Registro de peso não encontrado.' });
    }

    let internacaoRegistro = null;
    if (internacaoId) {
      internacaoRegistro = await InternacaoRegistro.findById(internacaoId);
      if (!internacaoRegistro) {
        return res.status(404).json({ message: 'Internação não encontrada para vincular o peso.' });
      }
      if (!petId) {
        petId = normalizeObjectId(internacaoRegistro.petId);
      }
      if (!clienteId) {
        clienteId = normalizeObjectId(internacaoRegistro.tutorId);
      }
    }

    if (toStringSafe(weightDoc.cliente) !== clienteId || toStringSafe(weightDoc.pet) !== petId) {
      return res.status(400).json({ message: 'Registro de peso não pertence ao tutor/pet informado.' });
    }

    const userId = normalizeObjectId(req.user?.id || req.user?._id);
    const wantsInitialFlag = typeof req.body.isInitial === 'boolean' ? !!req.body.isInitial : weightDoc.isInitial;

    weightDoc.peso = pesoValue;
    weightDoc.isInitial = wantsInitialFlag;
    if (userId) {
      weightDoc.registradoPor = userId;
    }
    if (internacaoRegistro) {
      weightDoc.internacao = internacaoRegistro._id;
      weightDoc.registradoNaInternacao = true;
    }
    weightDoc.updatedAt = new Date();
    await weightDoc.save();

    if (wantsInitialFlag) {
      await PetWeight.updateMany({ pet: petId, _id: { $ne: weightDoc._id } }, { $set: { isInitial: false } });
    } else {
      const hasInitial = await PetWeight.exists({ pet: petId, isInitial: true });
      if (!hasInitial) {
        const earliest = await PetWeight.findOne({ pet: petId }).sort({ createdAt: 1 });
        if (earliest && String(earliest._id) !== String(weightDoc._id)) {
          await PetWeight.updateOne({ _id: earliest._id }, { $set: { isInitial: true } });
        } else {
          weightDoc.isInitial = true;
          await weightDoc.save();
        }
      }
    }

    const latest = await PetWeight.findOne({ pet: petId }).sort({ createdAt: -1 });
    const petDoc = await Pet.findById(petId).select('peso');
    if (petDoc) {
      const latestWeight = latest ? parseWeight(latest.peso) : null;
      petDoc.peso = latestWeight !== null ? String(latestWeight) : '';
      await petDoc.save();
    }

    if (internacaoRegistro) {
      await registerInternacaoPesoUpdate({
        internacaoId: internacaoRegistro._id,
        pesoValue,
        author: req.user?.email,
      });
    }

    const formatted = formatPetWeightEntry(weightDoc.toObject());
    return res.json(formatted);
  } catch (error) {
    console.error('PUT /func/vet/pesos/:id', error);
    return res.status(500).json({ message: 'Erro ao atualizar registro de peso.' });
  }
});
router.delete('/vet/pesos/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const weightId = normalizeObjectId(req.params.id);
    const clienteId = normalizeObjectId(req.query.clienteId || req.body?.clienteId);
    const petId = normalizeObjectId(req.query.petId || req.body?.petId);

    if (!weightId) {
      return res.status(400).json({ message: 'Registro de peso invÃ¡lido.' });
    }

    if (!(clienteId && petId)) {
      return res.status(400).json({ message: 'clienteId e petId sÃ£o obrigatÃ³rios.' });
    }

    const weightDoc = await PetWeight.findById(weightId);
    if (!weightDoc) {
      return res.status(404).json({ message: 'Registro de peso nÃ£o encontrado.' });
    }

    if (toStringSafe(weightDoc.cliente) !== clienteId || toStringSafe(weightDoc.pet) !== petId) {
      return res.status(400).json({ message: 'Registro de peso nÃ£o pertence ao pet informado.' });
    }

    const petDoc = await Pet.findById(petId).select('owner peso');
    if (!petDoc) {
      return res.status(404).json({ message: 'Pet nÃ£o encontrado.' });
    }

    if (clienteId && toStringSafe(petDoc.owner) !== clienteId) {
      return res.status(400).json({ message: 'Pet nÃ£o pertence ao tutor informado.' });
    }

    await weightDoc.deleteOne();

    const initialRemaining = await PetWeight.findOne({ pet: petId, isInitial: true }).sort({ createdAt: 1 });
    if (!initialRemaining) {
      const earliest = await PetWeight.findOne({ pet: petId }).sort({ createdAt: 1 });
      if (earliest) {
        if (!earliest.isInitial) {
          earliest.isInitial = true;
          await earliest.save();
        }
      }
    }

    const latest = await PetWeight.findOne({ pet: petId }).sort({ createdAt: -1 });
    const latestWeightValue = latest ? parseWeight(latest.peso) : null;

    if (latestWeightValue !== null) {
      petDoc.peso = String(latestWeightValue);
    } else {
      petDoc.peso = '';
    }
    await petDoc.save();

    return res.json({
      deletedId: weightId,
      latestWeight: latestWeightValue,
    });
  } catch (error) {
    console.error('DELETE /func/vet/pesos/:id', error);
    return res.status(500).json({ message: 'Erro ao remover registro de peso.' });
  }
});

router.get('/vet/documentos', authMiddleware, requireStaff, async (_req, res) => {
  try {
    const docs = await VetDocument.find({})
      .sort({ updatedAt: -1, createdAt: -1 })
      .populate('createdBy', 'nome email')
      .populate('updatedBy', 'nome email')
      .lean();

    const formatted = docs.map(formatDocument).filter(Boolean);
    return res.json(formatted);
  } catch (error) {
    console.error('GET /func/vet/documentos', error);
    return res.status(500).json({ message: 'Erro ao listar documentos.' });
  }
});

router.post('/vet/documentos', authMiddleware, requireStaff, async (req, res) => {
  try {
    const descricaoRaw = typeof req.body?.descricao === 'string' ? req.body.descricao : '';
    const conteudoRaw = typeof req.body?.conteudo === 'string' ? req.body.conteudo : '';
    const descricao = descricaoRaw.trim();

    if (!descricao) {
      return res.status(400).json({ message: 'DescriÃ§Ã£o Ã© obrigatÃ³ria.' });
    }
    if (descricao.length > 180) {
      return res.status(400).json({ message: 'A descriÃ§Ã£o deve ter no mÃ¡ximo 180 caracteres.' });
    }

    const conteudoSanitized = sanitizeDocumentContent(conteudoRaw);
    if (conteudoSanitized.length > 200000) {
      return res.status(400).json({ message: 'O documento deve ter no mÃ¡ximo 200.000 caracteres.' });
    }

    const plainText = extractPlainTextContent(conteudoSanitized);
    if (!plainText) {
      return res.status(400).json({ message: 'O conteÃºdo do documento Ã© obrigatÃ³rio.' });
    }

    const userId = normalizeObjectId(req.user?.id || req.user?._id);
    if (!userId) {
      return res.status(401).json({ message: 'UsuÃ¡rio nÃ£o autenticado.' });
    }

    const doc = await VetDocument.create({
      descricao,
      conteudo: conteudoSanitized,
      createdBy: userId,
      updatedBy: userId,
    });

    const full = await VetDocument.findById(doc._id)
      .populate('createdBy', 'nome email')
      .populate('updatedBy', 'nome email')
      .lean();

    return res.status(201).json(formatDocument(full));
  } catch (error) {
    console.error('POST /func/vet/documentos', error);
    return res.status(500).json({ message: 'Erro ao salvar documento.' });
  }
});

router.put('/vet/documentos/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const id = normalizeObjectId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'ID invÃ¡lido.' });
    }

    const existing = await VetDocument.findById(id);
    if (!existing) {
      return res.status(404).json({ message: 'Documento nÃ£o encontrado.' });
    }

    const descricaoRaw = typeof req.body?.descricao === 'string' ? req.body.descricao : '';
    const conteudoRaw = typeof req.body?.conteudo === 'string' ? req.body.conteudo : '';
    const descricao = descricaoRaw.trim();

    if (!descricao) {
      return res.status(400).json({ message: 'DescriÃ§Ã£o Ã© obrigatÃ³ria.' });
    }
    if (descricao.length > 180) {
      return res.status(400).json({ message: 'A descriÃ§Ã£o deve ter no mÃ¡ximo 180 caracteres.' });
    }

    const conteudoSanitized = sanitizeDocumentContent(conteudoRaw);
    if (conteudoSanitized.length > 200000) {
      return res.status(400).json({ message: 'O documento deve ter no mÃ¡ximo 200.000 caracteres.' });
    }

    const plainText = extractPlainTextContent(conteudoSanitized);
    if (!plainText) {
      return res.status(400).json({ message: 'O conteÃºdo do documento Ã© obrigatÃ³rio.' });
    }

    const userId = normalizeObjectId(req.user?.id || req.user?._id);
    if (!userId) {
      return res.status(401).json({ message: 'UsuÃ¡rio nÃ£o autenticado.' });
    }

    existing.descricao = descricao;
    existing.conteudo = conteudoSanitized;
    existing.updatedBy = userId;
    await existing.save();

    const full = await VetDocument.findById(id)
      .populate('createdBy', 'nome email')
      .populate('updatedBy', 'nome email')
      .lean();

    return res.json(formatDocument(full));
  } catch (error) {
    console.error('PUT /func/vet/documentos/:id', error);
    return res.status(500).json({ message: 'Erro ao atualizar documento.' });
  }
});

router.delete('/vet/documentos/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const id = normalizeObjectId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'ID invÃ¡lido.' });
    }

    const existing = await VetDocument.findById(id).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Documento nÃ£o encontrado.' });
    }

    await VetDocument.deleteOne({ _id: id });
    return res.status(204).send();
  } catch (error) {
    console.error('DELETE /func/vet/documentos/:id', error);
    return res.status(500).json({ message: 'Erro ao remover documento.' });
  }
});

router.get('/vet/receitas', authMiddleware, requireStaff, async (_req, res) => {
  try {
    const docs = await VetRecipe.find({})
      .sort({ updatedAt: -1, createdAt: -1 })
      .populate('createdBy', 'nome email')
      .populate('updatedBy', 'nome email')
      .lean();

    const formatted = docs.map(formatRecipe).filter(Boolean);
    return res.json(formatted);
  } catch (error) {
    console.error('GET /func/vet/receitas', error);
    return res.status(500).json({ message: 'Erro ao listar receitas.' });
  }
});

router.post('/vet/receitas', authMiddleware, requireStaff, async (req, res) => {
  try {
    const descricaoRaw = typeof req.body?.descricao === 'string' ? req.body.descricao : '';
    const conteudoRaw = typeof req.body?.conteudo === 'string' ? req.body.conteudo : '';
    const descricao = descricaoRaw.trim();

    if (!descricao) {
      return res.status(400).json({ message: 'DescriÃ§Ã£o Ã© obrigatÃ³ria.' });
    }
    if (descricao.length > 180) {
      return res.status(400).json({ message: 'A descriÃ§Ã£o deve ter no mÃ¡ximo 180 caracteres.' });
    }

    const conteudoSanitized = sanitizeDocumentContent(conteudoRaw);
    if (conteudoSanitized.length > 200000) {
      return res.status(400).json({ message: 'A receita deve ter no mÃ¡ximo 200.000 caracteres.' });
    }

    const plainText = extractPlainTextContent(conteudoSanitized);
    if (!plainText) {
      return res.status(400).json({ message: 'O conteÃºdo da receita Ã© obrigatÃ³rio.' });
    }

    const userId = normalizeObjectId(req.user?.id || req.user?._id);
    if (!userId) {
      return res.status(401).json({ message: 'UsuÃ¡rio nÃ£o autenticado.' });
    }

    const doc = await VetRecipe.create({
      descricao,
      conteudo: conteudoSanitized,
      createdBy: userId,
      updatedBy: userId,
    });

    const full = await VetRecipe.findById(doc._id)
      .populate('createdBy', 'nome email')
      .populate('updatedBy', 'nome email')
      .lean();

    return res.status(201).json(formatRecipe(full));
  } catch (error) {
    console.error('POST /func/vet/receitas', error);
    return res.status(500).json({ message: 'Erro ao salvar receita.' });
  }
});

router.put('/vet/receitas/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const id = normalizeObjectId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'ID invÃ¡lido.' });
    }

    const existing = await VetRecipe.findById(id);
    if (!existing) {
      return res.status(404).json({ message: 'Receita nÃ£o encontrada.' });
    }

    const descricaoRaw = typeof req.body?.descricao === 'string' ? req.body.descricao : '';
    const conteudoRaw = typeof req.body?.conteudo === 'string' ? req.body.conteudo : '';
    const descricao = descricaoRaw.trim();

    if (!descricao) {
      return res.status(400).json({ message: 'DescriÃ§Ã£o Ã© obrigatÃ³ria.' });
    }
    if (descricao.length > 180) {
      return res.status(400).json({ message: 'A descriÃ§Ã£o deve ter no mÃ¡ximo 180 caracteres.' });
    }

    const conteudoSanitized = sanitizeDocumentContent(conteudoRaw);
    if (conteudoSanitized.length > 200000) {
      return res.status(400).json({ message: 'A receita deve ter no mÃ¡ximo 200.000 caracteres.' });
    }

    const plainText = extractPlainTextContent(conteudoSanitized);
    if (!plainText) {
      return res.status(400).json({ message: 'O conteÃºdo da receita Ã© obrigatÃ³rio.' });
    }

    const userId = normalizeObjectId(req.user?.id || req.user?._id);
    if (!userId) {
      return res.status(401).json({ message: 'UsuÃ¡rio nÃ£o autenticado.' });
    }

    existing.descricao = descricao;
    existing.conteudo = conteudoSanitized;
    existing.updatedBy = userId;
    await existing.save();

    const full = await VetRecipe.findById(id)
      .populate('createdBy', 'nome email')
      .populate('updatedBy', 'nome email')
      .lean();

    return res.json(formatRecipe(full));
  } catch (error) {
    console.error('PUT /func/vet/receitas/:id', error);
    return res.status(500).json({ message: 'Erro ao atualizar receita.' });
  }
});

router.delete('/vet/receitas/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const id = normalizeObjectId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'ID invÃ¡lido.' });
    }

    const existing = await VetRecipe.findById(id).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Receita nÃ£o encontrada.' });
    }

    await VetRecipe.deleteOne({ _id: id });
    return res.status(204).send();
  } catch (error) {
    console.error('DELETE /func/vet/receitas/:id', error);
    return res.status(500).json({ message: 'Erro ao remover receita.' });
  }
});

router.get('/vet/documentos-registros', authMiddleware, requireStaff, async (req, res) => {
  try {
    const clienteId = normalizeObjectId(req.query.clienteId);
    const petId = normalizeObjectId(req.query.petId);
    const appointmentId = normalizeObjectId(req.query.appointmentId);

    if (!(clienteId && petId)) {
      return res.status(400).json({ message: 'clienteId e petId sÃ£o obrigatÃ³rios.' });
    }

    const petCheck = await ensurePetBelongsToCliente(petId, clienteId);
    if (!petCheck.ok) {
      return res.status(petCheck.status).json({ message: petCheck.message });
    }

    const filter = { cliente: clienteId, pet: petId };
    if (appointmentId) {
      filter.$or = [
        { appointment: appointmentId },
        { appointment: { $exists: false } },
        { appointment: null },
      ];
    }

    const docs = await VetDocumentRecord.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    const formatted = docs.map(formatDocumentRecord).filter(Boolean);
    return res.json(formatted);
  } catch (error) {
    console.error('GET /func/vet/documentos-registros', error);
    return res.status(500).json({ message: 'Erro ao carregar documentos do atendimento.' });
  }
});

router.post('/vet/documentos-registros', authMiddleware, requireStaff, async (req, res) => {
  try {
    const clienteId = normalizeObjectId(req.body.clienteId);
    const petId = normalizeObjectId(req.body.petId);
    const documentoId = req.body.documentoId ? normalizeObjectId(req.body.documentoId) : null;
    const appointmentId = req.body.appointmentId ? normalizeObjectId(req.body.appointmentId) : null;

    if (!(clienteId && petId)) {
      return res.status(400).json({ message: 'clienteId e petId são obrigatórios.' });
    }

    if (req.body.documentoId && !documentoId) {
      return res.status(400).json({ message: 'documentoId inválido.' });
    }

    if (req.body.appointmentId && !appointmentId) {
      return res.status(400).json({ message: 'appointmentId inválido.' });
    }

    const conteudo = typeof req.body.conteudo === 'string' ? req.body.conteudo : '';
    if (!conteudo) {
      return res.status(400).json({ message: 'O conteúdo do documento é obrigatório.' });
    }
    if (conteudo.length > 200000) {
      return res.status(400).json({ message: 'O documento deve ter no máximo 200.000 caracteres.' });
    }

    const conteudoOriginal = typeof req.body.conteudoOriginal === 'string' ? req.body.conteudoOriginal : '';
    if (conteudoOriginal.length > 200000) {
      return res.status(400).json({ message: 'O documento original deve ter no máximo 200.000 caracteres.' });
    }

    const descricao = typeof req.body.descricao === 'string' ? req.body.descricao.trim() : '';
    if (descricao.length > 180) {
      return res.status(400).json({ message: 'A descrição do documento deve ter no máximo 180 caracteres.' });
    }

    const preview = typeof req.body.preview === 'string' ? req.body.preview.trim() : '';
    if (preview.length > 2000) {
      return res.status(400).json({ message: 'A prévia do documento deve ter no máximo 2.000 caracteres.' });
    }

    const petCheck = await ensurePetBelongsToCliente(petId, clienteId);
    if (!petCheck.ok) {
      return res.status(petCheck.status).json({ message: petCheck.message });
    }

    if (appointmentId) {
      const appointmentCheck = await ensureAppointmentLink(appointmentId, clienteId, petId, null);
      if (!appointmentCheck.ok) {
        return res.status(appointmentCheck.status).json({ message: appointmentCheck.message });
      }
    }

    let documentReference = null;
    if (documentoId) {
      const existingDocument = await VetDocument.findById(documentoId).select('_id descricao').lean();
      if (!existingDocument) {
        return res.status(404).json({ message: 'Documento salvo não encontrado.' });
      }
      documentReference = existingDocument;
    }

    const payload = {
      cliente: clienteId,
      pet: petId,
      documento: documentReference ? documentReference._id : undefined,
      appointment: appointmentId || undefined,
      descricao: descricao || documentReference?.descricao || 'Documento',
      conteudo,
      conteudoOriginal: conteudoOriginal || '',
      preview: preview || '',
    };

    const userId = normalizeObjectId(req.user?.id || req.user?._id);
    if (userId) {
      payload.createdBy = userId;
      payload.updatedBy = userId;
    }

    const created = await VetDocumentRecord.create(payload);
    const record = await VetDocumentRecord.findById(created._id).lean();
    return res.status(201).json(formatDocumentRecord(record));
  } catch (error) {
    console.error('POST /func/vet/documentos-registros', error);
    return res.status(500).json({ message: 'Erro ao salvar documento do atendimento.' });
  }
});

router.post(
  '/vet/documentos-registros/:id/assinatura',
  authMiddleware,
  requireStaff,
  handleDocumentoAssinadoUpload,
  async (req, res) => {
    const uploadedDriveIds = [];
    try {
      if (!isDriveConfigured()) {
        return res.status(500).json({ message: 'Integração com o Google Drive não está configurada.' });
      }

      const recordId = normalizeObjectId(req.params.id);
      if (!recordId) {
        return res.status(400).json({ message: 'ID inválido.' });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: 'Envie o documento assinado.' });
      }

      const extension = inferExtensionFromFile(file).toLowerCase();
      const mimeType = String(file.mimetype || '').toLowerCase();
      if (
        !(
          (extension && ALLOWED_SIGNED_DOCUMENT_EXTENSIONS.has(extension))
          || ALLOWED_SIGNED_DOCUMENT_MIME_TYPES.has(mimeType)
        )
      ) {
        return res.status(400).json({
          message: 'Formato de arquivo não suportado. Permitido: PNG, JPG, JPEG ou PDF.',
        });
      }

      const existing = await VetDocumentRecord.findById(recordId);
      if (!existing) {
        return res.status(404).json({ message: 'Documento do atendimento não encontrado.' });
      }

      const clienteId = toStringSafe(existing.cliente);
      const petId = toStringSafe(existing.pet);

      if (!(clienteId && petId)) {
        return res.status(400).json({ message: 'Documento do atendimento está sem tutor ou pet vinculado.' });
      }

      const petCheck = await ensurePetBelongsToCliente(petId, clienteId);
      if (!petCheck.ok) {
        return res.status(petCheck.status).json({ message: petCheck.message });
      }

      let appointmentId = existing.appointment ? toStringSafe(existing.appointment) : null;
      if (Object.prototype.hasOwnProperty.call(req.body, 'appointmentId')) {
        appointmentId = req.body.appointmentId ? normalizeObjectId(req.body.appointmentId) : null;
        if (req.body.appointmentId && !appointmentId) {
          return res.status(400).json({ message: 'appointmentId inválido.' });
        }
      }

      const appointmentCheck = await ensureAppointmentLink(appointmentId, clienteId, petId, null);
      if (!appointmentCheck.ok) {
        return res.status(appointmentCheck.status).json({ message: appointmentCheck.message });
      }

      const clienteDoc = await User.findById(clienteId)
        .select('cpf nomeCompleto email celular telefone')
        .lean();
      if (!clienteDoc) {
        return res.status(404).json({ message: 'Tutor não encontrado.' });
      }

      const petDoc = petCheck.pet || null;
      const appointmentDoc = appointmentCheck.appointment || null;

      const tutorCpfDigits = clienteDoc.cpf ? String(clienteDoc.cpf).replace(/\D+/g, '') : '';
      const tutorFallbackId = clienteId ? String(clienteId).slice(-6) || String(clienteId) : 'tutor';
      let tutorFolderName = tutorCpfDigits;
      if (!tutorFolderName) {
        const fallbackTutorName = clienteDoc.nomeCompleto || clienteDoc.email || clienteDoc.celular || clienteDoc.telefone || '';
        tutorFolderName = sanitizeFolderSegment(
          fallbackTutorName,
          `sem-cpf-${tutorFallbackId}`,
        ) || `sem-cpf-${tutorFallbackId}`;
      }

      const rawAppointmentCode =
        typeof appointmentDoc?.codigoVenda === 'string' ? appointmentDoc.codigoVenda.trim() : '';
      const appointmentFallbackSegment = appointmentDoc?._id
        ? `codigo_${appointmentDoc._id}`
        : 'codigo_sem-atendimento';
      const appointmentFolderName =
        sanitizeFolderSegment(
          rawAppointmentCode ? `codigo_${rawAppointmentCode}` : '',
          appointmentFallbackSegment,
        ) || sanitizeFolderSegment(appointmentFallbackSegment) || appointmentFallbackSegment;

      const petFallbackId = petId ? String(petId).slice(-6) || String(petId) : 'pet';
      const candidatePetCodes = [
        petDoc?.codigoPet,
        petDoc?.codigo,
        petDoc?.codigo_pet,
        petDoc?.codigoDoPet,
        petDoc?.codigoInterno,
        petDoc?.identificador,
        appointmentDoc?.petCodigo,
        appointmentDoc?.codigoPet,
        appointmentDoc?.pet?.codigo,
        petDoc?.microchip,
      ];
      let sanitizedPetCode = '';
      for (const candidate of candidatePetCodes) {
        const sanitized = sanitizePetCode(candidate);
        if (sanitized) {
          sanitizedPetCode = sanitized;
          break;
        }
      }

      const petFallbackSegment = `pet_${petFallbackId}`;
      const petFolderName =
        sanitizeFolderSegment(
          sanitizedPetCode ? `pet_${sanitizedPetCode}` : '',
          petFallbackSegment,
        ) || sanitizeFolderSegment(petFallbackSegment) || petFallbackSegment;

      const typeFolderName = sanitizeFolderSegment('Documentos') || 'Documentos';
      const folderPath = [
        sanitizeFolderSegment('Ficha Clinica') || 'Ficha Clinica',
        tutorFolderName,
        petFolderName,
        appointmentFolderName,
        typeFolderName,
      ];

      const providedName = typeof req.body.nome === 'string' ? req.body.nome : '';
      const sanitizedProvided = sanitizeFileName(providedName);
      const fallbackName = sanitizeFileName(file.originalname) || 'Documento assinado';
      const displayName = sanitizedProvided || fallbackName || 'Documento assinado';

      let driveBaseName = sanitizeFileName(displayName) || `documento-assinado-${Date.now()}`;
      let driveFileName = ensureFileNameWithExtension(driveBaseName, extension || inferExtensionFromFile(file));
      driveFileName = sanitizeFileName(driveFileName);
      if (!driveFileName) {
        driveFileName = `documento-assinado-${Date.now()}${extension || ''}`;
      } else if (extension && !driveFileName.toLowerCase().endsWith(extension)) {
        driveFileName = `${driveFileName}${extension}`;
      }

      const folderId = getDriveFolderId();
      const uploadResult = await uploadBufferToDrive(file.buffer, {
        mimeType: file.mimetype || 'application/octet-stream',
        name: driveFileName,
        folderId,
        folderPath,
      });

      if (uploadResult?.id) {
        uploadedDriveIds.push(uploadResult.id);
      }

      const previousSignedFile = existing.signedFile && typeof existing.signedFile === 'object'
        ? (typeof existing.signedFile.toObject === 'function'
          ? existing.signedFile.toObject()
          : { ...existing.signedFile })
        : null;
      const previousDriveId = previousSignedFile?.driveFileId || '';

      const uploadedAt = new Date();
      existing.signedFile = {
        nome: displayName,
        originalName: file.originalname || '',
        mimeType: uploadResult?.mimeType || file.mimetype || '',
        size: Number(uploadResult?.size) || Number(file.size || 0),
        extension: extension || '',
        url: uploadResult?.webViewLink || uploadResult?.webContentLink || '',
        driveFileId: uploadResult?.id || '',
        driveViewLink: uploadResult?.webViewLink || '',
        driveContentLink: uploadResult?.webContentLink || '',
        uploadedAt,
      };
      existing.markModified('signedFile');

      const userId = normalizeObjectId(req.user?.id || req.user?._id);
      if (userId) {
        existing.updatedBy = userId;
      }
      existing.updatedAt = uploadedAt;

      await existing.save();
      uploadedDriveIds.length = 0;

      if (previousDriveId && previousDriveId !== existing.signedFile?.driveFileId) {
        deleteFile(previousDriveId).catch(() => {});
      }

      const formatted = formatDocumentRecord(existing.toObject());
      return res.json(formatted);
    } catch (error) {
      if (uploadedDriveIds.length) {
        await Promise.allSettled(uploadedDriveIds.map((id) => deleteFile(id)));
      }
      console.error('POST /func/vet/documentos-registros/:id/assinatura', error);
      let message = 'Erro ao salvar documento assinado.';
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
      if (message === 'Erro ao salvar documento assinado.' && error?.message) {
        message = error.message;
      }
      return res.status(500).json({ message });
    }
  },
);

router.put('/vet/documentos-registros/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const recordId = normalizeObjectId(req.params.id);
    if (!recordId) {
      return res.status(400).json({ message: 'ID inválido.' });
    }

    const existing = await VetDocumentRecord.findById(recordId);
    if (!existing) {
      return res.status(404).json({ message: 'Documento do atendimento não encontrado.' });
    }

    const clienteId = normalizeObjectId(req.body.clienteId) || toStringSafe(existing.cliente);
    const petId = normalizeObjectId(req.body.petId) || toStringSafe(existing.pet);
    if (!(clienteId && petId)) {
      return res.status(400).json({ message: 'clienteId e petId são obrigatórios.' });
    }

    const petCheck = await ensurePetBelongsToCliente(petId, clienteId);
    if (!petCheck.ok) {
      return res.status(petCheck.status).json({ message: petCheck.message });
    }

    let appointmentId = existing.appointment ? toStringSafe(existing.appointment) : null;
    if (Object.prototype.hasOwnProperty.call(req.body, 'appointmentId')) {
      appointmentId = req.body.appointmentId ? normalizeObjectId(req.body.appointmentId) : null;
      if (req.body.appointmentId && !appointmentId) {
        return res.status(400).json({ message: 'appointmentId inválido.' });
      }
    }

    if (appointmentId) {
      const appointmentCheck = await ensureAppointmentLink(appointmentId, clienteId, petId, null);
      if (!appointmentCheck.ok) {
        return res.status(appointmentCheck.status).json({ message: appointmentCheck.message });
      }
    }

    let documentoId = existing.documento ? toStringSafe(existing.documento) : null;
    if (Object.prototype.hasOwnProperty.call(req.body, 'documentoId')) {
      documentoId = req.body.documentoId ? normalizeObjectId(req.body.documentoId) : null;
      if (req.body.documentoId && !documentoId) {
        return res.status(400).json({ message: 'documentoId inválido.' });
      }
    }

    let documentReference = null;
    if (documentoId) {
      const docRef = await VetDocument.findById(documentoId).select('_id descricao').lean();
      if (!docRef) {
        return res.status(404).json({ message: 'Documento salvo não encontrado.' });
      }
      documentReference = docRef;
    }

    const conteudoRaw = typeof req.body.conteudo === 'string' ? req.body.conteudo : null;
    const conteudoSanitized = conteudoRaw !== null ? sanitizeDocumentContent(conteudoRaw) : existing.conteudo;
    if (!conteudoSanitized) {
      return res.status(400).json({ message: 'O conteúdo do documento é obrigatório.' });
    }
    if (conteudoSanitized.length > 200000) {
      return res.status(400).json({ message: 'O documento deve ter no máximo 200.000 caracteres.' });
    }

    const conteudoOriginalRaw = typeof req.body.conteudoOriginal === 'string' ? req.body.conteudoOriginal : null;
    const conteudoOriginal = conteudoOriginalRaw !== null ? conteudoOriginalRaw : existing.conteudoOriginal || '';
    if (conteudoOriginal.length > 200000) {
      return res.status(400).json({ message: 'O documento original deve ter no máximo 200.000 caracteres.' });
    }

    const descricaoRaw = typeof req.body.descricao === 'string' ? req.body.descricao.trim() : null;
    let descricao = descricaoRaw !== null ? descricaoRaw : existing.descricao || '';
    if (!descricao && documentReference?.descricao) {
      descricao = documentReference.descricao;
    }
    if (descricao.length > 180) {
      return res.status(400).json({ message: 'A descrição do documento deve ter no máximo 180 caracteres.' });
    }

    const previewRaw = typeof req.body.preview === 'string' ? req.body.preview.trim() : null;
    const preview = previewRaw !== null ? previewRaw : existing.preview || '';
    if (preview.length > 2000) {
      return res.status(400).json({ message: 'A prévia do documento deve ter no máximo 2.000 caracteres.' });
    }

    existing.cliente = clienteId;
    existing.pet = petId;
    if (documentoId !== null) {
      existing.documento = documentReference ? documentReference._id : documentoId ? documentoId : null;
    }
    if (appointmentId !== undefined) {
      existing.appointment = appointmentId || null;
    }
    existing.descricao = descricao || 'Documento';
    existing.conteudo = conteudoSanitized;
    existing.conteudoOriginal = conteudoOriginal;
    existing.preview = preview;
    const userId = normalizeObjectId(req.user?.id || req.user?._id);
    if (userId) {
      existing.updatedBy = userId;
    }
    existing.updatedAt = new Date();

    await existing.save();

    const formatted = formatDocumentRecord(existing.toObject());
    return res.json(formatted);
  } catch (error) {
    console.error('PUT /func/vet/documentos-registros/:id', error);
    return res.status(500).json({ message: 'Erro ao atualizar documento do atendimento.' });
  }
});

router.delete('/vet/documentos-registros/:id/assinatura', authMiddleware, requireStaff, async (req, res) => {
  try {
    const recordId = normalizeObjectId(req.params.id);
    if (!recordId) {
      return res.status(400).json({ message: 'ID inválido.' });
    }

    const existing = await VetDocumentRecord.findById(recordId);
    if (!existing) {
      return res.status(404).json({ message: 'Documento do atendimento não encontrado.' });
    }

    const previousSignedFile = existing.signedFile && typeof existing.signedFile === 'object'
      ? (typeof existing.signedFile.toObject === 'function'
        ? existing.signedFile.toObject()
        : { ...existing.signedFile })
      : null;
    const previousDriveId = previousSignedFile?.driveFileId || '';

    existing.signedFile = undefined;
    existing.markModified('signedFile');

    const userId = normalizeObjectId(req.user?.id || req.user?._id);
    if (userId) {
      existing.updatedBy = userId;
    }
    existing.updatedAt = new Date();

    await existing.save();

    if (previousDriveId) {
      deleteFile(previousDriveId).catch(() => {});
    }

    const formatted = formatDocumentRecord(existing.toObject());
    return res.json(formatted);
  } catch (error) {
    console.error('DELETE /func/vet/documentos-registros/:id/assinatura', error);
    return res.status(500).json({ message: 'Erro ao remover documento assinado.' });
  }
});
router.delete('/vet/documentos-registros/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const id = normalizeObjectId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'ID invÃ¡lido.' });
    }

    const existing = await VetDocumentRecord.findById(id).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Documento do atendimento nÃ£o encontrado.' });
    }

    await VetDocumentRecord.deleteOne({ _id: id });
    const driveId = existing?.signedFile?.driveFileId;
    if (driveId) {
      deleteFile(driveId).catch(() => {});
    }
    return res.status(204).send();
  } catch (error) {
    console.error('DELETE /func/vet/documentos-registros/:id', error);
    return res.status(500).json({ message: 'Erro ao remover documento do atendimento.' });
  }
});

router.post(
  RECEITA_REGISTROS_SIGNATURE_PATHS,
  authMiddleware,
  requireStaff,
  handleReceitaAssinadaUpload,
  async (req, res) => {
    const uploadedDriveIds = [];
    try {
      if (!isDriveConfigured()) {
        return res.status(500).json({ message: 'IntegraÃ§Ã£o com o Google Drive nÃ£o estÃ¡ configurada.' });
      }

      const recordId = normalizeObjectId(req.params.id);
      if (!recordId) {
        return res.status(400).json({ message: 'ID invÃ¡lido.' });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: 'Envie a receita assinada.' });
      }

      const extension = inferExtensionFromFile(file).toLowerCase();
      const mimeType = String(file.mimetype || '').toLowerCase();
      if (
        !(
          (extension && ALLOWED_SIGNED_DOCUMENT_EXTENSIONS.has(extension))
          || ALLOWED_SIGNED_DOCUMENT_MIME_TYPES.has(mimeType)
        )
      ) {
        return res.status(400).json({
          message: 'Formato de arquivo nÃ£o suportado. Permitido: PNG, JPG, JPEG ou PDF.',
        });
      }

      const existing = await VetRecipeRecord.findById(recordId);
      if (!existing) {
        return res.status(404).json({ message: 'Receita do atendimento nÃ£o encontrada.' });
      }

      const clienteId = toStringSafe(existing.cliente);
      const petId = toStringSafe(existing.pet);

      if (!(clienteId && petId)) {
        return res.status(400).json({ message: 'Receita do atendimento estÃ¡ sem tutor ou pet vinculado.' });
      }

      const petCheck = await ensurePetBelongsToCliente(petId, clienteId);
      if (!petCheck.ok) {
        return res.status(petCheck.status).json({ message: petCheck.message });
      }

      let appointmentId = existing.appointment ? toStringSafe(existing.appointment) : null;
      if (Object.prototype.hasOwnProperty.call(req.body, 'appointmentId')) {
        appointmentId = req.body.appointmentId ? normalizeObjectId(req.body.appointmentId) : null;
        if (req.body.appointmentId && !appointmentId) {
          return res.status(400).json({ message: 'appointmentId invÃ¡lido.' });
        }
      }

      const appointmentCheck = await ensureAppointmentLink(appointmentId, clienteId, petId, null);
      if (!appointmentCheck.ok) {
        return res.status(appointmentCheck.status).json({ message: appointmentCheck.message });
      }

      const clienteDoc = await User.findById(clienteId)
        .select('cpf nomeCompleto email celular telefone')
        .lean();
      if (!clienteDoc) {
        return res.status(404).json({ message: 'Tutor nÃ£o encontrado.' });
      }

      const petDoc = petCheck.pet || null;
      const appointmentDoc = appointmentCheck.appointment || null;

      const tutorCpfDigits = clienteDoc.cpf ? String(clienteDoc.cpf).replace(/\D+/g, '') : '';
      const tutorFallbackId = clienteId ? String(clienteId).slice(-6) || String(clienteId) : 'tutor';
      let tutorFolderName = tutorCpfDigits;
      if (!tutorFolderName) {
        const fallbackTutorName = clienteDoc.nomeCompleto || clienteDoc.email || clienteDoc.celular || clienteDoc.telefone || '';
        tutorFolderName = sanitizeFolderSegment(
          fallbackTutorName,
          `sem-cpf-${tutorFallbackId}`,
        ) || `sem-cpf-${tutorFallbackId}`;
      }

      const rawAppointmentCode =
        typeof appointmentDoc?.codigoVenda === 'string' ? appointmentDoc.codigoVenda.trim() : '';
      const appointmentFallbackSegment = appointmentDoc?._id
        ? `codigo_${appointmentDoc._id}`
        : 'codigo_sem-atendimento';
      const appointmentFolderName =
        sanitizeFolderSegment(
          rawAppointmentCode ? `codigo_${rawAppointmentCode}` : '',
          appointmentFallbackSegment,
        ) || sanitizeFolderSegment(appointmentFallbackSegment) || appointmentFallbackSegment;

      const petFallbackId = petId ? String(petId).slice(-6) || String(petId) : 'pet';
      const candidatePetCodes = [
        petDoc?.codigoPet,
        petDoc?.codigo,
        petDoc?.codigo_pet,
        petDoc?.codigoDoPet,
        petDoc?.codigoInterno,
        petDoc?.identificador,
        appointmentDoc?.petCodigo,
        appointmentDoc?.codigoPet,
        appointmentDoc?.pet?.codigo,
        petDoc?.microchip,
      ];
      let sanitizedPetCode = '';
      for (const candidate of candidatePetCodes) {
        const sanitized = sanitizePetCode(candidate);
        if (sanitized) {
          sanitizedPetCode = sanitized;
          break;
        }
      }

      const petFallbackSegment = `pet_${petFallbackId}`;
      const petFolderName =
        sanitizeFolderSegment(
          sanitizedPetCode ? `pet_${sanitizedPetCode}` : '',
          petFallbackSegment,
        ) || sanitizeFolderSegment(petFallbackSegment) || petFallbackSegment;

      const typeFolderName = sanitizeFolderSegment('Receitas') || 'Receitas';
      const folderPath = [
        sanitizeFolderSegment('Ficha Clinica') || 'Ficha Clinica',
        tutorFolderName,
        petFolderName,
        appointmentFolderName,
        typeFolderName,
      ];

      const providedName = typeof req.body.nome === 'string' ? req.body.nome : '';
      const sanitizedProvided = sanitizeFileName(providedName);
      const fallbackName = sanitizeFileName(file.originalname) || 'Receita assinada';
      const displayName = sanitizedProvided || fallbackName || 'Receita assinada';

      let driveBaseName = sanitizeFileName(displayName) || `receita-assinada-${Date.now()}`;
      let driveFileName = ensureFileNameWithExtension(driveBaseName, extension || inferExtensionFromFile(file));
      driveFileName = sanitizeFileName(driveFileName);
      if (!driveFileName) {
        driveFileName = `receita-assinada-${Date.now()}${extension || ''}`;
      } else if (extension && !driveFileName.toLowerCase().endsWith(extension)) {
        driveFileName = `${driveFileName}${extension}`;
      }

      const folderId = getDriveFolderId();
      const uploadResult = await uploadBufferToDrive(file.buffer, {
        mimeType: file.mimetype || 'application/octet-stream',
        name: driveFileName,
        folderId,
        folderPath,
      });

      if (uploadResult?.id) {
        uploadedDriveIds.push(uploadResult.id);
      }

      const previousSignedFile = existing.signedFile && typeof existing.signedFile === 'object'
        ? (typeof existing.signedFile.toObject === 'function'
          ? existing.signedFile.toObject()
          : { ...existing.signedFile })
        : null;
      const previousDriveId = previousSignedFile?.driveFileId || '';

      const uploadedAt = new Date();
      existing.signedFile = {
        nome: displayName,
        originalName: file.originalname || '',
        mimeType: uploadResult?.mimeType || file.mimetype || '',
        size: Number(uploadResult?.size) || Number(file.size || 0),
        extension: extension || '',
        url: uploadResult?.webViewLink || uploadResult?.webContentLink || '',
        driveFileId: uploadResult?.id || '',
        driveViewLink: uploadResult?.webViewLink || '',
        driveContentLink: uploadResult?.webContentLink || '',
        uploadedAt,
      };
      existing.markModified('signedFile');

      const userId = normalizeObjectId(req.user?.id || req.user?._id);
      if (userId) {
        existing.updatedBy = userId;
      }
      existing.updatedAt = uploadedAt;

      await existing.save();
      uploadedDriveIds.length = 0;

      if (previousDriveId && previousDriveId !== existing.signedFile?.driveFileId) {
        deleteFile(previousDriveId).catch(() => {});
      }

      const formatted = formatRecipeRecord(existing.toObject());
      return res.json(formatted);
    } catch (error) {
      if (uploadedDriveIds.length) {
        await Promise.allSettled(uploadedDriveIds.map((id) => deleteFile(id)));
      }
      console.error('POST /func/vet/receitas-registros/:id/assinatura', error);
      let message = 'Erro ao salvar receita assinada.';
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
      if (message === 'Erro ao salvar receita assinada.' && error?.message) {
        message = error.message;
      }
      return res.status(500).json({ message });
    }
  },
);

router.delete(RECEITA_REGISTROS_SIGNATURE_PATHS, authMiddleware, requireStaff, async (req, res) => {
  try {
    const recordId = normalizeObjectId(req.params.id);
    if (!recordId) {
      return res.status(400).json({ message: 'ID invÃ¡lido.' });
    }

    const existing = await VetRecipeRecord.findById(recordId);
    if (!existing) {
      return res.status(404).json({ message: 'Receita do atendimento nÃ£o encontrada.' });
    }

    const previousSignedFile = existing.signedFile && typeof existing.signedFile === 'object'
      ? (typeof existing.signedFile.toObject === 'function'
        ? existing.signedFile.toObject()
        : { ...existing.signedFile })
      : null;
    const previousDriveId = previousSignedFile?.driveFileId || '';

    existing.signedFile = undefined;
    existing.markModified('signedFile');

    const userId = normalizeObjectId(req.user?.id || req.user?._id);
    if (userId) {
      existing.updatedBy = userId;
    }
    existing.updatedAt = new Date();

    await existing.save();

    if (previousDriveId) {
      deleteFile(previousDriveId).catch(() => {});
    }

    const formatted = formatRecipeRecord(existing.toObject());
    return res.json(formatted);
  } catch (error) {
    console.error('DELETE /func/vet/receitas-registros/:id/assinatura', error);
    return res.status(500).json({ message: 'Erro ao remover receita assinada.' });
  }
});

router.get(RECEITA_REGISTROS_BASE_PATHS, authMiddleware, requireStaff, async (req, res) => {
  try {
    const clienteId = normalizeObjectId(req.query.clienteId);
    const petId = normalizeObjectId(req.query.petId);
    const appointmentId = normalizeObjectId(req.query.appointmentId);

    if (!(clienteId && petId)) {
      return res.status(400).json({ message: 'clienteId e petId sÃ£o obrigatÃ³rios.' });
    }

    const petCheck = await ensurePetBelongsToCliente(petId, clienteId);
    if (!petCheck.ok) {
      return res.status(petCheck.status).json({ message: petCheck.message });
    }

    const filter = { cliente: clienteId, pet: petId };
    if (appointmentId) {
      filter.$or = [
        { appointment: appointmentId },
        { appointment: { $exists: false } },
        { appointment: null },
      ];
    }

    const docs = await VetRecipeRecord.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    const formatted = docs.map(formatRecipeRecord).filter(Boolean);
    return res.json(formatted);
  } catch (error) {
    console.error('GET /func/vet/receitas-registros', error);
    return res.status(500).json({ message: 'Erro ao carregar receitas do atendimento.' });
  }
});

router.post(RECEITA_REGISTROS_BASE_PATHS, authMiddleware, requireStaff, async (req, res) => {
  try {
    const clienteId = normalizeObjectId(req.body.clienteId);
    const petId = normalizeObjectId(req.body.petId);
    const receitaId = req.body.receitaId ? normalizeObjectId(req.body.receitaId) : null;
    const appointmentId = req.body.appointmentId ? normalizeObjectId(req.body.appointmentId) : null;

    if (!(clienteId && petId)) {
      return res.status(400).json({ message: 'clienteId e petId são obrigatórios.' });
    }

    if (req.body.receitaId && !receitaId) {
      return res.status(400).json({ message: 'receitaId inválido.' });
    }

    if (req.body.appointmentId && !appointmentId) {
      return res.status(400).json({ message: 'appointmentId inválido.' });
    }

    const conteudo = typeof req.body.conteudo === 'string' ? req.body.conteudo : '';
    if (!conteudo) {
      return res.status(400).json({ message: 'O conteúdo da receita é obrigatório.' });
    }
    if (conteudo.length > 200000) {
      return res.status(400).json({ message: 'A receita deve ter no máximo 200.000 caracteres.' });
    }

    const conteudoOriginal = typeof req.body.conteudoOriginal === 'string' ? req.body.conteudoOriginal : '';
    if (conteudoOriginal.length > 200000) {
      return res.status(400).json({ message: 'A receita original deve ter no máximo 200.000 caracteres.' });
    }

    const descricao = typeof req.body.descricao === 'string' ? req.body.descricao.trim() : '';
    if (descricao.length > 180) {
      return res.status(400).json({ message: 'A descrição da receita deve ter no máximo 180 caracteres.' });
    }

    const preview = typeof req.body.preview === 'string' ? req.body.preview.trim() : '';
    if (preview.length > 2000) {
      return res.status(400).json({ message: 'A prévia da receita deve ter no máximo 2.000 caracteres.' });
    }

    const petCheck = await ensurePetBelongsToCliente(petId, clienteId);
    if (!petCheck.ok) {
      return res.status(petCheck.status).json({ message: petCheck.message });
    }

    if (appointmentId) {
      const appointmentCheck = await ensureAppointmentLink(appointmentId, clienteId, petId, null);
      if (!appointmentCheck.ok) {
        return res.status(appointmentCheck.status).json({ message: appointmentCheck.message });
      }
    }

    let recipeReference = null;
    if (receitaId) {
      const existingRecipe = await VetRecipe.findById(receitaId).select('_id descricao').lean();
      if (!existingRecipe) {
        return res.status(404).json({ message: 'Receita salva não encontrada.' });
      }
      recipeReference = existingRecipe;
    }

    const payload = {
      cliente: clienteId,
      pet: petId,
      receita: recipeReference ? recipeReference._id : undefined,
      appointment: appointmentId || undefined,
      descricao: descricao || recipeReference?.descricao || 'Receita',
      conteudo,
      conteudoOriginal: conteudoOriginal || '',
      preview: preview || '',
    };

    const userId = normalizeObjectId(req.user?.id || req.user?._id);
    if (userId) {
      payload.createdBy = userId;
      payload.updatedBy = userId;
    }

    const created = await VetRecipeRecord.create(payload);
    const record = await VetRecipeRecord.findById(created._id).lean();
    return res.status(201).json(formatRecipeRecord(record));
  } catch (error) {
    console.error('POST /func/vet/receitas-registros', error);
    return res.status(500).json({ message: 'Erro ao salvar receita do atendimento.' });
  }
});

router.put(RECEITA_REGISTROS_ID_PATHS, authMiddleware, requireStaff, async (req, res) => {
  try {
    const recordId = normalizeObjectId(req.params.id);
    if (!recordId) {
      return res.status(400).json({ message: 'ID inválido.' });
    }

    const existing = await VetRecipeRecord.findById(recordId);
    if (!existing) {
      return res.status(404).json({ message: 'Receita do atendimento não encontrada.' });
    }

    const clienteId = normalizeObjectId(req.body.clienteId) || toStringSafe(existing.cliente);
    const petId = normalizeObjectId(req.body.petId) || toStringSafe(existing.pet);
    if (!(clienteId && petId)) {
      return res.status(400).json({ message: 'clienteId e petId são obrigatórios.' });
    }

    const petCheck = await ensurePetBelongsToCliente(petId, clienteId);
    if (!petCheck.ok) {
      return res.status(petCheck.status).json({ message: petCheck.message });
    }

    let appointmentId = existing.appointment ? toStringSafe(existing.appointment) : null;
    if (Object.prototype.hasOwnProperty.call(req.body, 'appointmentId')) {
      appointmentId = req.body.appointmentId ? normalizeObjectId(req.body.appointmentId) : null;
      if (req.body.appointmentId && !appointmentId) {
        return res.status(400).json({ message: 'appointmentId inválido.' });
      }
    }

    if (appointmentId) {
      const appointmentCheck = await ensureAppointmentLink(appointmentId, clienteId, petId, null);
      if (!appointmentCheck.ok) {
        return res.status(appointmentCheck.status).json({ message: appointmentCheck.message });
      }
    }

    let receitaId = existing.receita ? toStringSafe(existing.receita) : null;
    if (Object.prototype.hasOwnProperty.call(req.body, 'receitaId')) {
      receitaId = req.body.receitaId ? normalizeObjectId(req.body.receitaId) : null;
      if (req.body.receitaId && !receitaId) {
        return res.status(400).json({ message: 'receitaId inválido.' });
      }
    }

    let recipeReference = null;
    if (receitaId) {
      const recipeDoc = await VetRecipe.findById(receitaId).select('_id descricao').lean();
      if (!recipeDoc) {
        return res.status(404).json({ message: 'Receita salva não encontrada.' });
      }
      recipeReference = recipeDoc;
    }

    const conteudoRaw = typeof req.body.conteudo === 'string' ? req.body.conteudo : null;
    const conteudoSanitized = conteudoRaw !== null ? sanitizeDocumentContent(conteudoRaw) : existing.conteudo;
    if (!conteudoSanitized) {
      return res.status(400).json({ message: 'O conteúdo da receita é obrigatório.' });
    }
    if (conteudoSanitized.length > 200000) {
      return res.status(400).json({ message: 'A receita deve ter no máximo 200.000 caracteres.' });
    }

    const conteudoOriginalRaw = typeof req.body.conteudoOriginal === 'string' ? req.body.conteudoOriginal : null;
    const conteudoOriginal = conteudoOriginalRaw !== null ? conteudoOriginalRaw : existing.conteudoOriginal || '';
    if (conteudoOriginal.length > 200000) {
      return res.status(400).json({ message: 'A receita original deve ter no máximo 200.000 caracteres.' });
    }

    const descricaoRaw = typeof req.body.descricao === 'string' ? req.body.descricao.trim() : null;
    let descricao = descricaoRaw !== null ? descricaoRaw : existing.descricao || '';
    if (!descricao && recipeReference?.descricao) {
      descricao = recipeReference.descricao;
    }
    if (descricao.length > 180) {
      return res.status(400).json({ message: 'A descrição da receita deve ter no máximo 180 caracteres.' });
    }

    const previewRaw = typeof req.body.preview === 'string' ? req.body.preview.trim() : null;
    const preview = previewRaw !== null ? previewRaw : existing.preview || '';
    if (preview.length > 2000) {
      return res.status(400).json({ message: 'A prévia da receita deve ter no máximo 2.000 caracteres.' });
    }

    existing.cliente = clienteId;
    existing.pet = petId;
    if (receitaId !== null) {
      existing.receita = recipeReference ? recipeReference._id : receitaId ? receitaId : null;
    }
    if (appointmentId !== undefined) {
      existing.appointment = appointmentId || null;
    }
    existing.descricao = descricao || 'Receita';
    existing.conteudo = conteudoSanitized;
    existing.conteudoOriginal = conteudoOriginal;
    existing.preview = preview;
    const userId = normalizeObjectId(req.user?.id || req.user?._id);
    if (userId) {
      existing.updatedBy = userId;
    }
    existing.updatedAt = new Date();

    await existing.save();

    const formatted = formatRecipeRecord(existing.toObject());
    return res.json(formatted);
  } catch (error) {
    console.error('PUT /func/vet/receitas-registros/:id', error);
    return res.status(500).json({ message: 'Erro ao atualizar receita do atendimento.' });
  }
});
router.delete(RECEITA_REGISTROS_ID_PATHS, authMiddleware, requireStaff, async (req, res) => {
  try {
    const id = normalizeObjectId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'ID invÃ¡lido.' });
    }

    const existing = await VetRecipeRecord.findById(id).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Receita do atendimento nÃ£o encontrada.' });
    }

    await VetRecipeRecord.deleteOne({ _id: id });
    const driveId = existing?.signedFile?.driveFileId;
    if (driveId) {
      deleteFile(driveId).catch(() => {});
    }
    return res.status(204).send();
  } catch (error) {
    console.error('DELETE /func/vet/receitas-registros/:id', error);
    return res.status(500).json({ message: 'Erro ao remover receita do atendimento.' });
  }
});

router.get('/vet/historicos', authMiddleware, requireStaff, async (req, res) => {
  try {
    const clienteId = normalizeObjectId(req.query.clienteId);
    const petId = normalizeObjectId(req.query.petId);

    if (!(clienteId && petId)) {
      return res.status(400).json({ message: 'clienteId e petId são obrigatórios.' });
    }

    const petCheck = await ensurePetBelongsToCliente(petId, clienteId);
    if (!petCheck.ok) {
      return res.status(petCheck.status).json({ message: petCheck.message });
    }

    const list = await VetClinicHistory.find({ cliente: clienteId, pet: petId })
      .sort({ finalizadoEm: -1, createdAt: -1 })
      .lean();

    const formatted = list.map(formatHistoryEntry).filter(Boolean);
    return res.json(formatted);
  } catch (error) {
    console.error('GET /func/vet/historicos', error);
    return res.status(500).json({ message: 'Erro ao carregar histórico do atendimento.' });
  }
});

router.post('/vet/historicos', authMiddleware, requireStaff, async (req, res) => {
  try {
    const clienteId = normalizeObjectId(req.body.clienteId || req.body.cliente);
    const petId = normalizeObjectId(req.body.petId || req.body.pet);
    const appointmentId = normalizeObjectId(req.body.appointmentId || req.body.appointment);

    if (!(clienteId && petId && appointmentId)) {
      return res.status(400).json({ message: 'clienteId, petId e appointmentId são obrigatórios.' });
    }

    const petCheck = await ensurePetBelongsToCliente(petId, clienteId);
    if (!petCheck.ok) {
      return res.status(petCheck.status).json({ message: petCheck.message });
    }

    const finalizadoEmInput = req.body.finalizadoEm ? new Date(req.body.finalizadoEm) : new Date();
    const finalizadoEm = Number.isNaN(finalizadoEmInput.getTime()) ? new Date() : finalizadoEmInput;

    const payload = {
      cliente: clienteId,
      pet: petId,
      appointment: appointmentId,
      finalizadoEm,
      agenda: safeJsonClone(req.body.agenda) || {},
      consultas: cloneArray(req.body.consultas),
      vacinas: cloneArray(req.body.vacinas),
      anexos: cloneArray(req.body.anexos),
      exames: cloneArray(req.body.exames),
      pesos: cloneArray(req.body.pesos),
      observacoes: cloneArray(req.body.observacoes),
      documentos: cloneArray(req.body.documentos),
      receitas: cloneArray(req.body.receitas),
    };

    const finalizadoPor = normalizeObjectId(req.user?.id || req.user?._id);
    if (finalizadoPor) {
      payload.finalizadoPor = finalizadoPor;
    }

    let history = await VetClinicHistory.findOne({ appointment: appointmentId });
    if (history) {
      history.cliente = clienteId;
      history.pet = petId;
      history.finalizadoEm = payload.finalizadoEm;
      history.agenda = payload.agenda;
      history.consultas = payload.consultas;
      history.vacinas = payload.vacinas;
      history.anexos = payload.anexos;
      history.exames = payload.exames;
      history.pesos = payload.pesos;
      history.observacoes = payload.observacoes;
      history.documentos = payload.documentos;
      history.receitas = payload.receitas;
      if (finalizadoPor) {
        history.finalizadoPor = finalizadoPor;
      }
      await history.save();
      return res.json(formatHistoryEntry(history));
    }

    history = await VetClinicHistory.create(payload);
    return res.status(201).json(formatHistoryEntry(history));
  } catch (error) {
    console.error('POST /func/vet/historicos', error);
    return res.status(500).json({ message: 'Erro ao salvar histórico do atendimento.' });
  }
});

router.delete('/vet/historicos/:id', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const historyId = normalizeObjectId(req.params.id);
    if (!historyId) {
      return res.status(400).json({ message: 'ID do histórico inválido.' });
    }

    const deleted = await VetClinicHistory.findByIdAndDelete(historyId);
    if (!deleted) {
      return res.status(404).json({ message: 'Histórico não encontrado.' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('DELETE /func/vet/historicos/:id', error);
    return res.status(500).json({ message: 'Erro ao remover histórico do atendimento.' });
  }
});

router.get('/vet/anexos', authMiddleware, requireStaff, async (req, res) => {
  try {
    const clienteId = normalizeObjectId(req.query.clienteId);
    const petId = normalizeObjectId(req.query.petId);
    const appointmentId = normalizeObjectId(req.query.appointmentId);

    if (!(clienteId && petId)) {
      return res.status(400).json({ message: 'clienteId e petId sÃ£o obrigatÃ³rios.' });
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

router.get('/vet/agendamentos/em-espera', authMiddleware, requireStaff, async (req, res) => {
  try {
    const clienteId = normalizeObjectId(req.query.clienteId);
    const petId = normalizeObjectId(req.query.petId);

    if (!(clienteId && petId)) {
      return res.status(400).json({ message: 'clienteId e petId são obrigatórios.' });
    }

    const role = String(req.user?.role || '').toLowerCase();
    const isAdminMaster = role === 'admin_master';

    let profissionalId = null;
    if (isAdminMaster) {
      profissionalId = normalizeObjectId(req.query.profissionalId);
    } else {
      profissionalId = normalizeObjectId(req.user?.id || req.user?._id || req.query.profissionalId);
    }

    const filter = {
      cliente: clienteId,
      pet: petId,
      status: 'em_espera',
    };

    if (profissionalId) {
      filter.profissional = profissionalId;
    } else if (!isAdminMaster) {
      return res.json([]);
    }

    const docs = await Appointment.find(filter)
      .select('_id store cliente pet itens servico profissional scheduledAt valor status observacoes codigoVenda')
      .populate('cliente', 'nomeCompleto nomeContato razaoSocial email')
      .populate('pet', 'nome')
      .populate({ path: 'profissional', select: 'nomeCompleto nomeContato razaoSocial' })
      .populate({
        path: 'servico',
        select: 'nome categorias grupo tiposPermitidos valor',
        populate: { path: 'grupo', select: 'tiposPermitidos' },
      })
      .populate({
        path: 'itens.servico',
        select: 'nome categorias grupo tiposPermitidos valor',
        populate: { path: 'grupo', select: 'tiposPermitidos' },
      })
      .sort({ scheduledAt: 1 })
      .lean();

    const payload = Array.isArray(docs) ? docs.map(formatWaitingAppointment).filter(Boolean) : [];
    return res.json(payload);
  } catch (error) {
    console.error('GET /func/vet/agendamentos/em-espera', error);
    return res.status(500).json({ message: 'Erro ao listar agendamentos em espera.' });
  }
});

router.get('/vet/consultas', authMiddleware, requireStaff, async (req, res) => {
  try {
    const clienteId = normalizeObjectId(req.query.clienteId);
    const petId = normalizeObjectId(req.query.petId);
    const appointmentId = normalizeObjectId(req.query.appointmentId);

    if (!clienteId || !petId) {
      return res.status(400).json({ message: 'clienteId e petId sÃ£o obrigatÃ³rios.' });
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
      return res.status(400).json({ message: 'ID invÃ¡lido.' });
    }
    const doc = await VetConsultation.findById(id)
      .populate('servico', 'nome categorias')
      .lean();
    if (!doc) {
      return res.status(404).json({ message: 'Consulta nÃ£o encontrada.' });
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

    const observacaoRaw = typeof req.body.observacao === 'string' ? req.body.observacao.trim() : '';
    const isExameAttachment = observacaoRaw.startsWith(EXAME_ATTACHMENT_OBSERVACAO_PREFIX);

    const clienteDoc = await User.findById(cliente)
      .select('cpf nomeCompleto email celular telefone')
      .lean();
    if (!clienteDoc) {
      return res.status(404).json({ message: 'Tutor não encontrado.' });
    }

    const petDoc = petCheck.pet || null;
    const tutorCpfDigits = clienteDoc.cpf ? String(clienteDoc.cpf).replace(/\D+/g, '') : '';
    const tutorFallbackId = cliente ? String(cliente).slice(-6) || String(cliente) : 'tutor';
    let tutorFolderName = tutorCpfDigits;
    if (!tutorFolderName) {
      const fallbackTutorName = clienteDoc.nomeCompleto || clienteDoc.email || clienteDoc.celular || clienteDoc.telefone || '';
      tutorFolderName = sanitizeFolderSegment(
        fallbackTutorName,
        `sem-cpf-${tutorFallbackId}`,
      ) || `sem-cpf-${tutorFallbackId}`;
    }

    const appointmentDoc = appointmentCheck.appointment || null;
    const rawAppointmentCode =
      typeof appointmentDoc?.codigoVenda === 'string' ? appointmentDoc.codigoVenda.trim() : '';
    const appointmentFallbackSegment = appointmentDoc?._id
      ? `codigo_${appointmentDoc._id}`
      : 'codigo_sem-atendimento';
    const appointmentFolderName =
      sanitizeFolderSegment(
        rawAppointmentCode ? `codigo_${rawAppointmentCode}` : '',
        appointmentFallbackSegment,
      ) || sanitizeFolderSegment(appointmentFallbackSegment) || appointmentFallbackSegment;

    const petFallbackId = pet ? String(pet).slice(-6) || String(pet) : 'pet';
    const candidatePetCodes = [
      petDoc?.codigoPet,
      petDoc?.codigo,
      petDoc?.codigo_pet,
      petDoc?.codigoDoPet,
      petDoc?.codigoInterno,
      petDoc?.identificador,
      appointmentDoc?.petCodigo,
      appointmentDoc?.codigoPet,
      appointmentDoc?.pet?.codigo,
      petDoc?.microchip,
    ];
    let sanitizedPetCode = '';
    for (const candidate of candidatePetCodes) {
      const sanitized = sanitizePetCode(candidate);
      if (sanitized) {
        sanitizedPetCode = sanitized;
        break;
      }
    }
    const petFallbackSegment = `pet_${petFallbackId}`;
    const petFolderName =
      sanitizeFolderSegment(
        sanitizedPetCode ? `pet_${sanitizedPetCode}` : '',
        petFallbackSegment,
      ) || sanitizeFolderSegment(petFallbackSegment) || petFallbackSegment;

    const typeFolderName = sanitizeFolderSegment(isExameAttachment ? 'Exame' : 'Anexo')
      || (isExameAttachment ? 'Exame' : 'Anexo');
    const folderPath = [
      sanitizeFolderSegment('Ficha Clinica') || 'Ficha Clinica',
      tutorFolderName,
      petFolderName,
      appointmentFolderName,
      typeFolderName,
    ];

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
        folderPath,
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
      observacao: observacaoRaw,
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

router.put('/vet/anexos/:id', authMiddleware, requireStaff, handleAnexoUpload, async (req, res) => {
  const uploadedDriveIds = [];
  const removedDriveIds = [];
  try {
    if (!isDriveConfigured()) {
      return res.status(500).json({ message: 'Integração com o Google Drive não está configurada.' });
    }

    const anexoId = normalizeObjectId(req.params.id);
    if (!anexoId) {
      return res.status(400).json({ message: 'ID inválido.' });
    }

    const existing = await VetAttachment.findById(anexoId);
    if (!existing) {
      return res.status(404).json({ message: 'Anexo não encontrado.' });
    }

    const clienteId = normalizeObjectId(req.body.clienteId) || toStringSafe(existing.cliente);
    const petId = normalizeObjectId(req.body.petId) || toStringSafe(existing.pet);
    if (!(clienteId && petId)) {
      return res.status(400).json({ message: 'clienteId e petId são obrigatórios.' });
    }

    const rawAppointment = Object.prototype.hasOwnProperty.call(req.body, 'appointmentId')
      ? (req.body.appointmentId ? normalizeObjectId(req.body.appointmentId) : null)
      : (existing.appointment ? toStringSafe(existing.appointment) : null);

    const removals = parseStringArray(req.body.removeFileIds || req.body['removeFileIds[]']);
    const renameMap = parseRenameMap(req.body.renameFiles || req.body.renameMap);
    const observacaoRaw = typeof req.body.observacao === 'string'
      ? req.body.observacao.trim()
      : existing.observacao || '';

    const files = Array.isArray(req.files) ? req.files : [];
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

    const petCheck = await ensurePetBelongsToCliente(petId, clienteId);
    if (!petCheck.ok) {
      return res.status(petCheck.status).json({ message: petCheck.message });
    }

    if (rawAppointment !== null) {
      const appointmentCheck = await ensureAppointmentLink(rawAppointment, clienteId, petId, null);
      if (!appointmentCheck.ok) {
        return res.status(appointmentCheck.status).json({ message: appointmentCheck.message });
      }
    }

    const existingObj = existing.toObject();
    const currentFiles = Array.isArray(existingObj.arquivos) ? existingObj.arquivos.map((item) => ({ ...item })) : [];
    const removeSet = new Set(removals.map((id) => normalizeObjectId(id) || String(id || '').trim()).filter(Boolean));

    const keptFiles = [];
    currentFiles.forEach((file) => {
      const fileId = toStringSafe(file._id || file.id);
      if (fileId && removeSet.has(fileId)) {
        if (file.driveFileId) {
          removedDriveIds.push(file.driveFileId);
        }
        return;
      }
      const renameLabel = fileId ? renameMap[fileId] : null;
      if (renameLabel) {
        const cleaned = sanitizeFileName(renameLabel) || renameLabel;
        file.nome = cleaned;
      }
      keptFiles.push(file);
    });

    const clienteDoc = await User.findById(clienteId)
      .select('cpf nomeCompleto email celular telefone')
      .lean();
    if (!clienteDoc) {
      return res.status(404).json({ message: 'Tutor não encontrado.' });
    }

    const appointmentDoc = rawAppointment ? await Appointment.findById(rawAppointment).select('codigoVenda pet').lean() : null;
    const petDoc = petCheck.pet || null;

    const tutorCpfDigits = clienteDoc.cpf ? String(clienteDoc.cpf).replace(/\D+/g, '') : '';
    const tutorFallbackId = clienteId ? String(clienteId).slice(-6) || String(clienteId) : 'tutor';
    let tutorFolderName = tutorCpfDigits;
    if (!tutorFolderName) {
      const fallbackTutorName = clienteDoc.nomeCompleto || clienteDoc.email || clienteDoc.celular || clienteDoc.telefone || '';
      tutorFolderName = sanitizeFolderSegment(fallbackTutorName, `sem-cpf-${tutorFallbackId}`) || `sem-cpf-${tutorFallbackId}`;
    }

    const rawAppointmentCode =
      typeof appointmentDoc?.codigoVenda === 'string' ? appointmentDoc.codigoVenda.trim() : '';
    const appointmentFallbackSegment = appointmentDoc?._id
      ? `codigo_${appointmentDoc._id}`
      : 'codigo_sem-atendimento';
    const appointmentFolderName =
      sanitizeFolderSegment(rawAppointmentCode ? `codigo_${rawAppointmentCode}` : '', appointmentFallbackSegment)
      || sanitizeFolderSegment(appointmentFallbackSegment)
      || appointmentFallbackSegment;

    const petFallbackId = petId ? String(petId).slice(-6) || String(petId) : 'pet';
    const candidatePetCodes = [
      petDoc?.codigoPet,
      petDoc?.codigo,
      petDoc?.codigo_pet,
      petDoc?.codigoDoPet,
      petDoc?.codigoInterno,
      petDoc?.identificador,
      appointmentDoc?.petCodigo,
      appointmentDoc?.codigoPet,
      appointmentDoc?.pet?.codigo,
      petDoc?.microchip,
    ];
    let sanitizedPetCode = '';
    for (const candidate of candidatePetCodes) {
      const sanitized = sanitizePetCode(candidate);
      if (sanitized) {
        sanitizedPetCode = sanitized;
        break;
      }
    }
    const petFallbackSegment = `pet_${petFallbackId}`;
    const petFolderName =
      sanitizeFolderSegment(sanitizedPetCode ? `pet_${sanitizedPetCode}` : '', petFallbackSegment)
      || sanitizeFolderSegment(petFallbackSegment)
      || petFallbackSegment;

    const isExameAttachment = observacaoRaw.startsWith(EXAME_ATTACHMENT_OBSERVACAO_PREFIX);
    const typeFolderName = sanitizeFolderSegment(isExameAttachment ? 'Exame' : 'Anexo')
      || (isExameAttachment ? 'Exame' : 'Anexo');
    const folderPath = [
      sanitizeFolderSegment('Ficha Clinica') || 'Ficha Clinica',
      tutorFolderName,
      petFolderName,
      appointmentFolderName,
      typeFolderName,
    ];

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
        folderPath,
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

    const combinedFiles = [...keptFiles, ...uploadedFiles];
    if (!combinedFiles.length) {
      return res.status(400).json({ message: 'Informe ao menos um arquivo.' });
    }

    existing.cliente = clienteId;
    existing.pet = petId;
    if (Object.prototype.hasOwnProperty.call(req.body, 'appointmentId')) {
      existing.appointment = rawAppointment || null;
    }
    existing.observacao = observacaoRaw;
    existing.arquivos = combinedFiles;
    const userId = normalizeObjectId(req.user?.id || req.user?._id);
    if (userId) {
      existing.updatedBy = userId;
    }
    existing.updatedAt = new Date();
    await existing.save();

    if (removedDriveIds.length && isDriveConfigured()) {
      await Promise.allSettled(removedDriveIds.map((driveId) => deleteFile(driveId)));
    }

    const formatted = formatAttachment(existing.toObject());
    return res.json(formatted);
  } catch (error) {
    if (uploadedDriveIds.length) {
      await Promise.allSettled(uploadedDriveIds.map((id) => deleteFile(id)));
    }
    console.error('PUT /func/vet/anexos/:id', error);
    return res.status(500).json({ message: 'Erro ao atualizar anexos.' });
  }
});
router.delete('/vet/anexos/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const id = normalizeObjectId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'ID invÃ¡lido.' });
    }

    const existing = await VetAttachment.findById(id).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Anexo nÃ£o encontrado.' });
    }

    const clienteId = normalizeObjectId(req.query.clienteId || req.body?.clienteId);
    if (clienteId && toStringSafe(existing.cliente) !== clienteId) {
      return res.status(400).json({ message: 'Anexo pertence a outro tutor.' });
    }

    const petId = normalizeObjectId(req.query.petId || req.body?.petId);
    if (petId && toStringSafe(existing.pet) !== petId) {
      return res.status(400).json({ message: 'Anexo pertence a outro pet.' });
    }

    const appointmentId = normalizeObjectId(req.query.appointmentId || req.body?.appointmentId);
    const existingAppointmentId = toStringSafe(existing.appointment);
    if (appointmentId && existingAppointmentId && existingAppointmentId !== appointmentId) {
      return res.status(400).json({ message: 'Anexo pertence a outro agendamento.' });
    }

    const driveIds = Array.isArray(existing.arquivos)
      ? existing.arquivos.map((file) => toStringSafe(file?.driveFileId)).filter(Boolean)
      : [];

    await VetAttachment.deleteOne({ _id: id });

    if (driveIds.length && isDriveConfigured()) {
      await Promise.allSettled(driveIds.map((driveId) => deleteFile(driveId)));
    }

    return res.status(204).send();
  } catch (error) {
    console.error('DELETE /func/vet/anexos/:id', error);
    return res.status(500).json({ message: 'Erro ao remover anexo.' });
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
      return res.status(400).json({ message: 'clienteId, petId e servicoId sÃ£o obrigatÃ³rios.' });
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
      return res.status(400).json({ message: 'ID invÃ¡lido.' });
    }

    const existing = await VetConsultation.findById(id).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Consulta nÃ£o encontrada.' });
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
      return res.status(400).json({ message: 'ServiÃ§o invÃ¡lido.' });
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
      return res.status(404).json({ message: 'Consulta nÃ£o encontrada.' });
    }

    return res.json(formatConsultation(full));
  } catch (error) {
    console.error('PUT /func/vet/consultas/:id', error);
    res.status(500).json({ message: 'Erro ao atualizar consulta.' });
  }
});

router.delete('/vet/consultas/:id', authMiddleware, requireStaff, async (req, res) => {
  try {
    const id = normalizeObjectId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'ID invÃ¡lido.' });
    }

    const existing = await VetConsultation.findById(id).lean();
    if (!existing) {
      return res.status(404).json({ message: 'Consulta nÃ£o encontrada.' });
    }

    await VetConsultation.deleteOne({ _id: id });
    return res.status(204).send();
  } catch (error) {
    console.error('DELETE /func/vet/consultas/:id', error);
    return res.status(500).json({ message: 'Erro ao remover consulta.' });
  }
});

module.exports = router;




