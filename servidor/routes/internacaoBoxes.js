const express = require('express');
const InternacaoBox = require('../models/InternacaoBox');
const InternacaoRegistro = require('../models/InternacaoRegistro');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const router = express.Router();
const allowedRoles = ['funcionario', 'admin', 'admin_master'];

const sanitizeText = (value, { fallback = '' } = {}) => {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
};

const sanitizeArray = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeText(item))
      .filter((item, index, arr) => item && arr.indexOf(item) === index);
  }
  const text = sanitizeText(value);
  return text ? [text] : [];
};

const formatHistoricoItem = (entry) => {
  if (!entry) return null;
  const plain = typeof entry.toObject === 'function' ? entry.toObject() : entry;
  const identifier = plain._id || plain.id || plain.criadoEm || Date.now();
  return {
    id: String(identifier).trim(),
    tipo: sanitizeText(plain.tipo, { fallback: 'Atualização' }),
    descricao: sanitizeText(plain.descricao, { fallback: 'Atualização registrada.' }),
    criadoPor: sanitizeText(plain.criadoPor, { fallback: 'Sistema' }),
    criadoEm: plain.criadoEm || plain.createdAt || null,
  };
};

const buildRegistroPayload = (body = {}) => ({
  petId: sanitizeText(body.petId),
  petNome: sanitizeText(body.petNome),
  petEspecie: sanitizeText(body.petEspecie),
  petRaca: sanitizeText(body.petRaca),
  petPeso: sanitizeText(body.petPeso),
  petIdade: sanitizeText(body.petIdade),
  tutorNome: sanitizeText(body.tutorNome),
  tutorDocumento: sanitizeText(body.tutorDocumento),
  tutorContato: sanitizeText(body.tutorContato),
  situacao: sanitizeText(body.situacao),
  situacaoCodigo: sanitizeText(body.situacaoCodigo),
  risco: sanitizeText(body.risco),
  riscoCodigo: sanitizeText(body.riscoCodigo),
  veterinario: sanitizeText(body.veterinario),
  box: sanitizeText(body.box),
  altaPrevistaData: sanitizeText(body.altaPrevistaData),
  altaPrevistaHora: sanitizeText(body.altaPrevistaHora),
  queixa: sanitizeText(body.queixa),
  diagnostico: sanitizeText(body.diagnostico),
  prognostico: sanitizeText(body.prognostico),
  alergias: sanitizeArray(body.alergias),
  acessorios: sanitizeText(body.acessorios),
  observacoes: sanitizeText(body.observacoes),
});

const buildObitoPayload = (body = {}) => ({
  veterinario: sanitizeText(body.veterinario),
  data: sanitizeText(body.data),
  hora: sanitizeText(body.hora),
  causa: sanitizeText(body.causa),
  relatorio: sanitizeText(body.relatorio),
});

const describeRegistroChanges = (before, after) => {
  const changes = [];
  const compareTextField = (field, label) => {
    const previous = sanitizeText(before[field]);
    const next = sanitizeText(after[field]);
    if (previous === next) return;
    if (!previous && next) {
      changes.push(`${label} definido como "${next}".`);
      return;
    }
    if (previous && !next) {
      changes.push(`${label} removido (antes: "${previous}").`);
      return;
    }
    changes.push(`${label} alterado de "${previous}" para "${next}".`);
  };

  compareTextField('situacao', 'Situação');
  compareTextField('risco', 'Risco');
  compareTextField('veterinario', 'Veterinário responsável');
  compareTextField('box', 'Box');
  compareTextField('queixa', 'Queixa');
  compareTextField('diagnostico', 'Diagnóstico');
  compareTextField('prognostico', 'Prognóstico');
  compareTextField('acessorios', 'Acessórios');
  compareTextField('observacoes', 'Observações');

  const beforeAlta = [sanitizeText(before.altaPrevistaData), sanitizeText(before.altaPrevistaHora)]
    .filter(Boolean)
    .join(' ')
    .trim();
  const afterAlta = [sanitizeText(after.altaPrevistaData), sanitizeText(after.altaPrevistaHora)]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (beforeAlta !== afterAlta) {
    if (!beforeAlta && afterAlta) {
      changes.push(`Alta prevista definida para ${afterAlta}.`);
    } else if (beforeAlta && !afterAlta) {
      changes.push('Alta prevista removida.');
    } else {
      changes.push(`Alta prevista alterada de ${beforeAlta} para ${afterAlta}.`);
    }
  }

  const beforeTags = sanitizeArray(before.alergias).sort();
  const afterTags = Array.isArray(after.alergias) ? [...after.alergias].sort() : [];
  if (beforeTags.join('|') !== afterTags.join('|')) {
    if (!beforeTags.length && afterTags.length) {
      changes.push(`Alergias e marcações adicionadas (${afterTags.join(', ')}).`);
    } else if (beforeTags.length && !afterTags.length) {
      changes.push('Alergias e marcações removidas.');
    } else {
      changes.push(
        `Alergias e marcações ajustadas (${beforeTags.join(', ')} → ${afterTags.join(', ')}).`,
      );
    }
  }

  return changes;
};

const formatBox = (doc) => {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const ocupante = sanitizeText(plain.ocupante, { fallback: 'Livre' });
  return {
    id: String(plain._id || plain.id || plain.box || '').trim(),
    box: sanitizeText(plain.box),
    ocupante,
    status: sanitizeText(plain.status, { fallback: ocupante === 'Livre' ? 'Disponível' : 'Em uso' }),
    especialidade: sanitizeText(plain.especialidade),
    higienizacao: sanitizeText(plain.higienizacao, { fallback: '—' }),
    observacao: sanitizeText(plain.observacao),
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
  };
};

const formatRegistro = (doc) => {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const historico = Array.isArray(plain.historico)
    ? plain.historico
        .map(formatHistoricoItem)
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = new Date(a.criadoEm || 0).getTime();
          const bTime = new Date(b.criadoEm || 0).getTime();
          return bTime - aTime;
        })
    : [];
  return {
    id: String(plain._id || plain.id || '').trim(),
    codigo: plain.codigo || null,
    petId: sanitizeText(plain.petId),
    petNome: sanitizeText(plain.petNome),
    petEspecie: sanitizeText(plain.petEspecie),
    petRaca: sanitizeText(plain.petRaca),
    petPeso: sanitizeText(plain.petPeso),
    petIdade: sanitizeText(plain.petIdade),
    tutorNome: sanitizeText(plain.tutorNome),
    tutorDocumento: sanitizeText(plain.tutorDocumento),
    tutorContato: sanitizeText(plain.tutorContato),
    situacao: sanitizeText(plain.situacao),
    situacaoCodigo: sanitizeText(plain.situacaoCodigo),
    risco: sanitizeText(plain.risco),
    riscoCodigo: sanitizeText(plain.riscoCodigo),
    veterinario: sanitizeText(plain.veterinario),
    box: sanitizeText(plain.box),
    altaPrevistaData: sanitizeText(plain.altaPrevistaData),
    altaPrevistaHora: sanitizeText(plain.altaPrevistaHora),
    queixa: sanitizeText(plain.queixa),
    diagnostico: sanitizeText(plain.diagnostico),
    prognostico: sanitizeText(plain.prognostico),
    alergias: sanitizeArray(plain.alergias),
    acessorios: sanitizeText(plain.acessorios),
    observacoes: sanitizeText(plain.observacoes),
    obitoRegistrado: Boolean(plain.obitoRegistrado),
    obitoVeterinario: sanitizeText(plain.obitoVeterinario),
    obitoData: sanitizeText(plain.obitoData),
    obitoHora: sanitizeText(plain.obitoHora),
    obitoCausa: sanitizeText(plain.obitoCausa),
    obitoRelatorio: sanitizeText(plain.obitoRelatorio),
    obitoConfirmadoEm: plain.obitoConfirmadoEm || null,
    admissao: plain.createdAt || null,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
    historico,
  };
};

router.use(requireAuth);
router.use(authorizeRoles(...allowedRoles));

router.get('/boxes', async (req, res) => {
  try {
    const boxes = await InternacaoBox.find().sort({ createdAt: -1 }).lean();
    return res.json(boxes.map(formatBox).filter(Boolean));
  } catch (error) {
    console.error('internacao: falha ao listar boxes', error);
    return res.status(500).json({ message: 'Não foi possível carregar os boxes.' });
  }
});

router.post('/boxes', async (req, res) => {
  try {
    const payload = {
      box: sanitizeText(req.body?.box),
      ocupante: sanitizeText(req.body?.ocupante, { fallback: 'Livre' }),
      status: sanitizeText(req.body?.status),
      especialidade: sanitizeText(req.body?.especialidade),
      higienizacao: sanitizeText(req.body?.higienizacao, { fallback: '—' }),
      observacao: sanitizeText(req.body?.observacao),
    };

    if (!payload.box) {
      return res.status(400).json({ message: 'Informe o identificador do box.' });
    }

    if (!payload.status) {
      payload.status = payload.ocupante === 'Livre' ? 'Disponível' : 'Em uso';
    }

    const record = await InternacaoBox.create(payload);
    return res.status(201).json(formatBox(record));
  } catch (error) {
    console.error('internacao: falha ao criar box', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Verifique os dados informados para o box.' });
    }
    return res.status(500).json({ message: 'Não foi possível salvar o box.' });
  }
});

router.get('/registros', async (req, res) => {
  try {
    const registros = await InternacaoRegistro.find().sort({ createdAt: -1 }).lean();
    return res.json(registros.map(formatRegistro).filter(Boolean));
  } catch (error) {
    console.error('internacao: falha ao listar internações', error);
    return res.status(500).json({ message: 'Não foi possível carregar as internações.' });
  }
});

router.post('/registros', async (req, res) => {
  try {
    const payload = buildRegistroPayload(req.body);

    if (!payload.petNome) {
      return res.status(400).json({ message: 'Selecione um paciente válido antes de salvar.' });
    }

    const lastRegistro = await InternacaoRegistro.findOne().sort({ codigo: -1 }).lean();
    const nextCodigo = (lastRegistro?.codigo || 0) + 1;

    const record = await InternacaoRegistro.create({ ...payload, codigo: nextCodigo });
    if (payload.box) {
      try {
        await InternacaoBox.findOneAndUpdate(
          { box: payload.box },
          { ocupante: payload.petNome || 'Ocupado', status: 'Ocupado' },
        );
      } catch (boxUpdateError) {
        console.warn('internacao: falha ao atualizar box vinculado', boxUpdateError);
      }
    }
    return res.status(201).json(formatRegistro(record));
  } catch (error) {
    console.error('internacao: falha ao salvar internação', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Revise as informações preenchidas antes de salvar.' });
    }
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Não foi possível gerar o código interno da internação. Tente novamente.' });
    }
    return res.status(500).json({ message: 'Não foi possível registrar a internação.' });
  }
});

router.put('/registros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Informe o registro que deseja atualizar.' });
    }

    const record = await InternacaoRegistro.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Internação não encontrada.' });
    }

    const payload = buildRegistroPayload(req.body);
    if (!payload.petNome) {
      return res.status(400).json({ message: 'Selecione um paciente válido antes de salvar.' });
    }

    const changes = describeRegistroChanges(record, payload);
    if (!changes.length) {
      return res.status(400).json({ message: 'Nenhuma alteração foi identificada para salvar.' });
    }

    const previousBox = record.box;
    Object.assign(record, payload);
    const autor = req.user?.email || 'Sistema';
    const descricao = `Atualização realizada: ${changes.join(' ')}`;
    record.historico = Array.isArray(record.historico) ? record.historico : [];
    record.historico.push({
      tipo: 'Atualização',
      descricao,
      criadoPor: autor,
      criadoEm: new Date(),
    });

    await record.save();

    if (previousBox && previousBox !== record.box) {
      try {
        await InternacaoBox.findOneAndUpdate(
          { box: previousBox },
          { ocupante: 'Livre', status: 'Disponível' },
        );
      } catch (boxReleaseError) {
        console.warn('internacao: falha ao liberar box anterior', boxReleaseError);
      }
    }

    if (record.box) {
      try {
        await InternacaoBox.findOneAndUpdate(
          { box: record.box },
          { ocupante: record.petNome || 'Ocupado', status: 'Ocupado' },
        );
      } catch (boxAssignError) {
        console.warn('internacao: falha ao atualizar box atual', boxAssignError);
      }
    }

    const updated = await InternacaoRegistro.findById(record._id).lean();
    return res.json(formatRegistro(updated));
  } catch (error) {
    console.error('internacao: falha ao atualizar internação', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Revise as informações preenchidas antes de salvar.' });
    }
    return res.status(500).json({ message: 'Não foi possível atualizar a internação.' });
  }
});

router.post('/registros/:id/obito', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Informe o registro que deseja atualizar.' });
    }

    const record = await InternacaoRegistro.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Internação não encontrada.' });
    }

    if (record.obitoRegistrado) {
      return res.status(409).json({ message: 'O óbito desse paciente já foi registrado.' });
    }

    const payload = buildObitoPayload(req.body);
    if (!payload.veterinario) {
      payload.veterinario = sanitizeText(record.veterinario);
    }
    const now = new Date();
    if (!payload.data) {
      payload.data = now.toISOString().slice(0, 10);
    }
    if (!payload.hora) {
      payload.hora = now.toISOString().slice(11, 16);
    }

    if (!payload.veterinario || !payload.data || !payload.hora || !payload.causa || !payload.relatorio) {
      return res.status(400).json({ message: 'Preencha todos os campos obrigatórios antes de confirmar o óbito.' });
    }

    record.obitoRegistrado = true;
    record.obitoVeterinario = payload.veterinario;
    record.obitoData = payload.data;
    record.obitoHora = payload.hora;
    record.obitoCausa = payload.causa;
    record.obitoRelatorio = payload.relatorio;
    record.obitoConfirmadoEm = now;
    record.situacao = 'Óbito';
    record.situacaoCodigo = 'obito';

    const autor = req.user?.email || payload.veterinario || 'Sistema';
    const horarioTexto = payload.hora ? ` às ${payload.hora}` : '';
    const detalhes = [`Data: ${payload.data}${horarioTexto}.`, `Causa: ${payload.causa}.`, `Relatório: ${payload.relatorio}`]
      .filter(Boolean)
      .join(' ');

    record.historico = Array.isArray(record.historico) ? record.historico : [];
    record.historico.push({
      tipo: 'Óbito',
      descricao: `Óbito registrado. ${detalhes}`,
      criadoPor: autor,
      criadoEm: now,
    });

    await record.save();

    if (record.box) {
      try {
        await InternacaoBox.findOneAndUpdate(
          { box: record.box },
          { ocupante: 'Livre', status: 'Disponível' },
        );
      } catch (boxReleaseError) {
        console.warn('internacao: falha ao liberar box após óbito', boxReleaseError);
      }
    }

    const updated = await InternacaoRegistro.findById(record._id).lean();
    return res.json(formatRegistro(updated));
  } catch (error) {
    console.error('internacao: falha ao registrar óbito', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Revise os dados informados antes de confirmar o óbito.' });
    }
    return res.status(500).json({ message: 'Não foi possível registrar o óbito do paciente.' });
  }
});

module.exports = router;
