const express = require('express');
const mongoose = require('mongoose');
const InternacaoBox = require('../models/InternacaoBox');
const InternacaoRegistro = require('../models/InternacaoRegistro');
const Pet = require('../models/Pet');
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

const formatEmpresa = (data = {}, fallback = {}) => {
  const plain = typeof data?.toObject === 'function' ? data.toObject() : data || {};
  const id = sanitizeText(plain.id || plain._id || plain.value || fallback.empresaId || fallback.empresa);
  const nomeFantasia = sanitizeText(
    plain.nomeFantasia || plain.label || fallback.empresaNomeFantasia || fallback.empresaNome,
  );
  const razaoSocial = sanitizeText(plain.razaoSocial || plain.nome || fallback.empresaRazaoSocial);
  const nome = sanitizeText(plain.nome || nomeFantasia || razaoSocial || fallback.empresaNome);
  const label = sanitizeText(plain.label || nomeFantasia || nome || razaoSocial);
  const value = sanitizeText(plain.value || id);

  if (!(id || nome || nomeFantasia || razaoSocial || label)) {
    return null;
  }

  const effectiveId = id || value || label;
  const effectiveFantasia = nomeFantasia || nome || razaoSocial || label || effectiveId;
  const effectiveRazao = razaoSocial || nome || effectiveFantasia || effectiveId;
  const effectiveNome = nome || effectiveFantasia || effectiveRazao || effectiveId;

  return {
    id: effectiveId,
    value: value || effectiveId,
    nome: effectiveNome,
    nomeFantasia: effectiveFantasia,
    razaoSocial: effectiveRazao,
    label: label || effectiveFantasia,
  };
};

const normalizeKey = (value) =>
  sanitizeText(value)
    .normalize('NFD')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();

const toIsoStringSafe = (value) => {
  if (!value) return null;
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (error) {
    console.warn('internacao: falha ao normalizar data', value, error);
    return null;
  }
};

const hasNecessarioFlag = (value) => {
  if (value === undefined || value === null) return false;
  const normalized = sanitizeText(value)
    .normalize('NFD')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .toLowerCase();
  return normalized.includes('necess');
};

const isExecucaoConcluida = (status) => {
  const key = normalizeKey(status);
  if (!key) return false;
  const finishedStatuses = [
    'executado',
    'executada',
    'realizado',
    'realizada',
    'concluido',
    'concluida',
    'finalizado',
    'finalizada',
    'aplicado',
    'aplicada',
    'administrado',
    'administrada',
    'feito',
    'feita',
  ];
  return finishedStatuses.includes(key);
};

const isExecucaoAgendada = (execucao) => {
  const statusTexto =
    execucao?.status?.descricao ||
    execucao?.status?.label ||
    execucao?.status ||
    execucao?.situacao ||
    execucao?.situacaoCodigo ||
    execucao?.statusCodigo;
  const statusKey = normalizeKey(statusTexto);
  if (!statusKey) return false;
  return statusKey.includes('agend');
};

const isExecucaoPendente = (execucao) => {
  const statusTexto =
    execucao?.status?.descricao ||
    execucao?.status?.label ||
    execucao?.status ||
    execucao?.situacao ||
    execucao?.situacaoCodigo ||
    execucao?.statusCodigo;
  const statusKey = normalizeKey(statusTexto);
  if (!statusKey) return true;
  if (isExecucaoConcluida(statusKey)) return false;
  if (isExecucaoAgendada(execucao)) return true;
  if (statusKey.includes('pend') || statusKey.includes('program') || statusKey.includes('demanda')) {
    return true;
  }
  return !isExecucaoConcluida(statusTexto);
};

const buildPrescricaoMatcher = (prescricaoId, prescricao) => ({
  targetId: sanitizeText(prescricaoId),
  prescricaoKey: normalizeKey(prescricao?.descricao || prescricao?.resumo),
});

const execucaoMatchesPrescricao = (execucao, matcher) => {
  const targetId = matcher?.targetId;
  const prescricaoKey = matcher?.prescricaoKey;
  if (!targetId && !prescricaoKey) return false;
  const execucaoId = sanitizeText(execucao?.prescricaoId);
  const execucaoDescricaoKey = normalizeKey(execucao?.descricao);
  const descricaoCombina = Boolean(
    prescricaoKey &&
      execucaoDescricaoKey &&
      (execucaoDescricaoKey === prescricaoKey ||
        execucaoDescricaoKey.includes(prescricaoKey) ||
        prescricaoKey.includes(execucaoDescricaoKey)),
  );
  return (
    (targetId && execucaoId && execucaoId === targetId) ||
    (!execucaoId && descricaoCombina) ||
    (!execucaoId && execucaoDescricaoKey && prescricaoKey && execucaoDescricaoKey === prescricaoKey)
  );
};

const removeExecucoesFromPrescricao = (
  record,
  prescricaoId,
  { pendingOnly = false, prescricao = null, matcher = null, agendadaOnly = false } = {},
) => {
  if (!record || !Array.isArray(record.execucoes) || !record.execucoes.length) {
    record.execucoes = [];
    return 0;
  }
  const { targetId, prescricaoKey } = matcher || buildPrescricaoMatcher(prescricaoId, prescricao);
  if (!targetId && !prescricaoKey) return 0;
  let removed = 0;
  record.execucoes = record.execucoes.filter((execucao) => {
    const samePrescricao = execucaoMatchesPrescricao(execucao, { targetId, prescricaoKey });
    if (!samePrescricao) return true;
    if (agendadaOnly && !isExecucaoAgendada(execucao)) {
      return true;
    }
    if (!pendingOnly) {
      removed += 1;
      return false;
    }
    const pendente = isExecucaoPendente(execucao);
    if (pendente) {
      removed += 1;
      return false;
    }
    return true;
  });
  return removed;
};

const countExecucoesFromPrescricao = (record, { matcher = null, prescricaoId, prescricao } = {}) => {
  if (!record || !Array.isArray(record.execucoes) || !record.execucoes.length) return 0;
  const { targetId, prescricaoKey } = matcher || buildPrescricaoMatcher(prescricaoId, prescricao);
  if (!targetId && !prescricaoKey) return 0;
  return record.execucoes.filter((execucao) => execucaoMatchesPrescricao(execucao, { targetId, prescricaoKey })).length;
};

const findPrescricaoById = (record, prescricaoId) => {
  if (!record || !Array.isArray(record.prescricoes)) return null;
  const targetId = sanitizeText(prescricaoId);
  if (!targetId) return null;
  if (typeof record.prescricoes.id === 'function') {
    const doc = record.prescricoes.id(targetId);
    if (doc) return doc;
  }
  return record.prescricoes.find((item) => sanitizeText(item?._id || item?.id) === targetId) || null;
};

const findExecucaoById = (record, execucaoId) => {
  if (!record || !Array.isArray(record.execucoes)) return null;
  const targetId = sanitizeText(execucaoId);
  if (!targetId) return null;
  if (typeof record.execucoes.id === 'function') {
    const doc = record.execucoes.id(targetId);
    if (doc) return doc;
  }
  return record.execucoes.find((item) => sanitizeText(item?._id || item?.id) === targetId) || null;
};

const removeExecucoesPendentes = (record) => {
  if (!record || !Array.isArray(record.execucoes)) {
    record.execucoes = [];
    return 0;
  }
  let removidas = 0;
  record.execucoes = record.execucoes.filter((execucao) => {
    const pendente = isExecucaoPendente(execucao);
    if (pendente) {
      removidas += 1;
      return false;
    }
    return true;
  });
  return removidas;
};

const pullPrescricaoById = (record, prescricaoId) => {
  if (!record || !Array.isArray(record.prescricoes)) return null;
  const targetId = sanitizeText(prescricaoId);
  if (!targetId) return null;
  let removed = null;
  if (typeof record.prescricoes.id === 'function') {
    const doc = record.prescricoes.id(targetId);
    if (doc) {
      removed = typeof doc.toObject === 'function' ? doc.toObject() : doc;
      if (typeof doc.remove === 'function') {
        doc.remove();
      } else if (typeof doc.deleteOne === 'function') {
        doc.deleteOne();
      } else if (typeof record.prescricoes.pull === 'function') {
        record.prescricoes.pull(doc._id || doc.id || targetId);
      } else {
        record.prescricoes = record.prescricoes.filter(
          (item) => sanitizeText(item?._id || item?.id) !== targetId,
        );
      }
      return removed;
    }
  }
  record.prescricoes = record.prescricoes.filter((item) => {
    const same = sanitizeText(item?._id || item?.id) === targetId;
    if (same && !removed) {
      removed = typeof item.toObject === 'function' ? item.toObject() : item;
      return false;
    }
    return true;
  });
  return removed;
};

const formatExecucaoItem = (entry) => {
  if (!entry) return null;
  const plain = typeof entry.toObject === 'function' ? entry.toObject() : entry;
  const horario = sanitizeText(plain.horario);
  if (!horario) return null;
  const programadoData = sanitizeText(plain.programadoData);
  const programadoHora = sanitizeText(plain.programadoHora, { fallback: horario });
  const programadoEm = sanitizeText(plain.programadoEm) || combineDateAndTimeParts(programadoData, programadoHora);
  const realizadoData = sanitizeText(plain.realizadoData);
  const realizadoHora = sanitizeText(plain.realizadoHora);
  const realizadoEm = sanitizeText(plain.realizadoEm) || combineDateAndTimeParts(realizadoData, realizadoHora);
  return {
    id: String(plain._id || plain.id || `${horario}-${plain.prescricaoId || Date.now()}`).trim(),
    horario,
    descricao: sanitizeText(plain.descricao),
    responsavel: sanitizeText(plain.responsavel),
    status: sanitizeText(plain.status, { fallback: 'Agendado' }),
    prescricaoId: sanitizeText(plain.prescricaoId),
    programadoData,
    programadoHora,
    programadoEm,
    realizadoData,
    realizadoHora,
    realizadoEm,
    realizadoPor: sanitizeText(plain.realizadoPor),
    observacoes: sanitizeText(plain.observacoes),
  };
};

const formatPrescricaoItem = (entry) => {
  if (!entry) return null;
  const plain = typeof entry.toObject === 'function' ? entry.toObject() : entry;
  const descricao = sanitizeText(plain.descricao) || sanitizeText(plain.fluidFluido);
  const tipo = sanitizeText(plain.tipo, { fallback: 'procedimento' });
  const frequencia = sanitizeText(plain.frequencia, { fallback: 'recorrente' });
  return {
    id: String(plain._id || plain.id || plain.criadoEm || Date.now()).trim(),
    tipo,
    frequencia,
    descricao,
    resumo: sanitizeText(plain.resumo, { fallback: 'Prescrição registrada.' }),
    aCadaValor: sanitizeText(plain.aCadaValor),
    aCadaUnidade: sanitizeText(plain.aCadaUnidade),
    porValor: sanitizeText(plain.porValor),
    porUnidade: sanitizeText(plain.porUnidade),
    dataInicio: sanitizeText(plain.dataInicio),
    horaInicio: sanitizeText(plain.horaInicio),
    medUnidade: sanitizeText(plain.medUnidade),
    medDose: sanitizeText(plain.medDose),
    medVia: sanitizeText(plain.medVia),
    medPeso: sanitizeText(plain.medPeso),
    medPesoAtualizadoEm: sanitizeText(plain.medPesoAtualizadoEm),
    fluidFluido: sanitizeText(plain.fluidFluido),
    fluidEquipo: sanitizeText(plain.fluidEquipo),
    fluidUnidade: sanitizeText(plain.fluidUnidade),
    fluidDose: sanitizeText(plain.fluidDose),
    fluidVia: sanitizeText(plain.fluidVia),
    fluidVelocidadeValor: sanitizeText(plain.fluidVelocidadeValor),
    fluidVelocidadeUnidade: sanitizeText(plain.fluidVelocidadeUnidade),
    fluidSuplemento: sanitizeText(plain.fluidSuplemento, { fallback: 'Sem suplemento' }),
    criadoPor: sanitizeText(plain.criadoPor, { fallback: 'Sistema' }),
    criadoEm: plain.criadoEm || plain.createdAt || null,
  };
};

const sanitizeParametrosResposta = (input) => {
  const list = Array.isArray(input) ? input : [];
  return list
    .map((item) => ({
      id: sanitizeText(item?.parametroId || item?.id),
      nome: sanitizeText(item?.parametroNome || item?.nome || item?.label || 'Parâmetro clínico'),
      resposta: sanitizeText(item?.resposta),
      observacao: sanitizeText(item?.observacao),
    }))
    .filter((item) => item.resposta || item.observacao || item.nome || item.id);
};

const parseNumberValue = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(',', '.').trim();
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
};

const timeStringToMinutes = (value) => {
  const text = sanitizeText(value);
  if (!text) return null;
  const [hourPart = '0', minutePart = '0'] = text.split(':');
  const hours = Number(hourPart);
  const minutes = Number(minutePart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

const MINUTES_IN_DAY = 24 * 60;

const minutesToTimeString = (totalMinutes) => {
  if (!Number.isFinite(totalMinutes)) return '00:00';
  const normalized = ((Math.floor(totalMinutes) % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const combineDateAndTimeParts = (dateStr, timeStr) => {
  const datePart = sanitizeText(dateStr);
  if (!datePart) return '';
  const timePart = sanitizeText(timeStr) || '00:00';
  const isoCandidate = `${datePart}T${timePart.length === 5 ? timePart : `${timePart}:00`}`;
  const parsed = new Date(isoCandidate);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString();
};

const getIntervalInMinutes = (value, unidade) => {
  const amount = parseNumberValue(value);
  if (!amount || amount <= 0) return null;
  const key = normalizeKey(unidade);
  if (key === 'horas') return amount * 60;
  if (key === 'dias') return amount * 60 * 24;
  return null;
};

const buildExecucaoEntriesFromPrescricao = (payload, autor, resumo, status, prescricaoId) => {
  const startMinutes = timeStringToMinutes(payload.horaInicio);
  if (startMinutes === null) return [];
  const freqKey = normalizeKey(payload.frequencia);
  const vinculoId = sanitizeText(prescricaoId);
  const baseDateOnly = sanitizeText(payload.dataInicio);
  const baseDate = baseDateOnly ? new Date(`${baseDateOnly}T00:00:00`) : null;
  const baseDateMs = baseDate && !Number.isNaN(baseDate.getTime()) ? baseDate.getTime() : null;
  const pushDateByDays = (days) => {
    if (baseDateMs === null) return baseDateOnly;
    const scheduled = new Date(baseDateMs + days * MINUTES_IN_DAY * 60000);
    if (Number.isNaN(scheduled.getTime())) return baseDateOnly;
    return scheduled.toISOString().slice(0, 10);
  };
  const baseEntry = (horario) => ({
    horario,
    descricao: resumo,
    responsavel: autor,
    status,
    prescricaoId: vinculoId,
  });

  const buildEntryWithSchedule = (horario, offsetMinutes = 0) => {
    const totalMinutes = startMinutes + offsetMinutes;
    const dayOffset = Math.floor(totalMinutes / MINUTES_IN_DAY);
    const programadoData = pushDateByDays(dayOffset);
    const programadoHora = horario;
    const programadoEm = combineDateAndTimeParts(programadoData, programadoHora);
    return {
      ...baseEntry(horario),
      programadoData,
      programadoHora,
      programadoEm,
    };
  };

  if (freqKey !== 'recorrente') {
    return [buildEntryWithSchedule(minutesToTimeString(startMinutes), 0)];
  }

  const intervalo = getIntervalInMinutes(payload.aCadaValor, payload.aCadaUnidade);
  if (!intervalo) {
    return [buildEntryWithSchedule(minutesToTimeString(startMinutes), 0)];
  }

  const porKey = normalizeKey(payload.porUnidade);
  const porValue = parseNumberValue(payload.porValor);
  const horarios = [];
  const MAX_OCCURRENCES = 48;

  const pushHorario = (minutes, offsetMinutes = 0) => {
    horarios.push({
      horario: minutesToTimeString(minutes),
      offsetMinutes,
    });
  };

  if (porKey === 'vezes' && porValue) {
    const total = Math.max(1, Math.round(porValue));
    for (let index = 0; index < total && index < MAX_OCCURRENCES; index += 1) {
      pushHorario(startMinutes + intervalo * index, intervalo * index);
    }
  } else if ((porKey === 'horas' || porKey === 'dias') && porValue) {
    const limite = getIntervalInMinutes(porValue, porKey) || intervalo;
    let occurrence = 0;
    while (occurrence < MAX_OCCURRENCES) {
      const currentMinutes = startMinutes + intervalo * occurrence;
      if (occurrence > 0 && currentMinutes - startMinutes > limite) break;
      pushHorario(currentMinutes, intervalo * occurrence);
      occurrence += 1;
    }
  } else {
    pushHorario(startMinutes, 0);
  }

  if (!horarios.length) {
    pushHorario(startMinutes, 0);
  }

  return horarios.map(({ horario, offsetMinutes = 0 }) => buildEntryWithSchedule(horario, offsetMinutes));
};

const buildPrescricaoPayload = (body = {}) => ({
  tipo: sanitizeText(body.tipo, { fallback: 'procedimento' }),
  frequencia: sanitizeText(body.frequencia, { fallback: 'recorrente' }),
  descricao: sanitizeText(body.descricao),
  resumo: sanitizeText(body.resumo),
  aCadaValor: sanitizeText(body.aCadaValor),
  aCadaUnidade: sanitizeText(body.aCadaUnidade),
  porValor: sanitizeText(body.porValor),
  porUnidade: sanitizeText(body.porUnidade),
  dataInicio: sanitizeText(body.dataInicio),
  horaInicio: sanitizeText(body.horaInicio),
  medUnidade: sanitizeText(body.medUnidade),
  medDose: sanitizeText(body.medDose),
  medVia: sanitizeText(body.medVia),
  medPeso: sanitizeText(body.medPeso),
  medPesoAtualizadoEm: sanitizeText(body.medPesoAtualizadoEm),
  fluidFluido: sanitizeText(body.fluidFluido),
  fluidEquipo: sanitizeText(body.fluidEquipo),
  fluidUnidade: sanitizeText(body.fluidUnidade),
  fluidDose: sanitizeText(body.fluidDose),
  fluidVia: sanitizeText(body.fluidVia),
  fluidVelocidadeValor: sanitizeText(body.fluidVelocidadeValor),
  fluidVelocidadeUnidade: sanitizeText(body.fluidVelocidadeUnidade),
  fluidSuplemento: sanitizeText(body.fluidSuplemento),
});

const ensurePrescricaoPayload = (payload = {}) => {
  if (!payload.tipo) {
    throw new Error('Selecione o tipo da prescrição.');
  }
  if (!payload.frequencia) {
    throw new Error('Informe a frequência da aplicação.');
  }
  const freqKey = normalizeKey(payload.frequencia);
  if (freqKey === 'recorrente') {
    if (!payload.aCadaValor || !payload.aCadaUnidade) {
      throw new Error('Preencha o intervalo "A cada" e sua unidade.');
    }
    if (!payload.porValor || !payload.porUnidade) {
      throw new Error('Informe o campo "Por" e sua unidade.');
    }
    if (!payload.dataInicio || !payload.horaInicio) {
      throw new Error('Defina data e hora de início para prescrições recorrentes.');
    }
  } else if (freqKey === 'unica') {
    if (!payload.dataInicio || !payload.horaInicio) {
      throw new Error('Defina data e hora para aplicação única.');
    }
  }
  if (!payload.descricao && !payload.fluidFluido) {
    throw new Error('Descreva o procedimento ou medicamento.');
  }
  const tipoKey = normalizeKey(payload.tipo);
  if (tipoKey === 'medicamento') {
    if (!payload.medUnidade) {
      throw new Error('Selecione a unidade do medicamento.');
    }
    if (!payload.medDose) {
      throw new Error('Informe a dose do medicamento.');
    }
    if (!payload.medVia) {
      throw new Error('Selecione a via do medicamento.');
    }
  }
  if (tipoKey === 'fluidoterapia') {
    if (!payload.fluidFluido) {
      throw new Error('Informe o fluído da prescrição.');
    }
    if (!payload.fluidEquipo) {
      throw new Error('Informe o equipo da fluidoterapia.');
    }
    if (!payload.fluidUnidade) {
      throw new Error('Informe a unidade do fluído.');
    }
    if (!payload.fluidDose) {
      throw new Error('Informe a dose do fluído.');
    }
    if (!payload.fluidVia) {
      throw new Error('Informe a via de administração do fluído.');
    }
    if (!payload.fluidVelocidadeValor || !payload.fluidVelocidadeUnidade) {
      throw new Error('Informe a velocidade da fluidoterapia.');
    }
  }
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

const formatRelatorioMedicoItem = (entry) => {
  if (!entry) return null;
  const plain = typeof entry.toObject === 'function' ? entry.toObject() : entry;
  const identifier = plain._id || plain.id || plain.criadoEm || Date.now();
  return {
    id: String(identifier).trim(),
    resumo: sanitizeText(plain.resumo),
    descricao: sanitizeText(plain.descricao),
    criadoPor: sanitizeText(plain.criadoPor, { fallback: 'Sistema' }),
    criadoEm: plain.criadoEm || plain.createdAt || null,
  };
};

const buildRegistroPayload = (body = {}) => {
  const empresa = formatEmpresa(body.empresa, {
    empresaId: body.empresaId,
    empresaNome: body.empresaNome,
    empresaNomeFantasia: body.empresaNomeFantasia,
    empresaRazaoSocial: body.empresaRazaoSocial,
  });

  const payload = {
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
  };

  if (empresa) {
    payload.empresaId = empresa.id;
    payload.empresaNome = empresa.nomeFantasia || empresa.nome;
    payload.empresaNomeFantasia = empresa.nomeFantasia;
    payload.empresaRazaoSocial = empresa.razaoSocial;
    payload.empresa = empresa;
  }

  return payload;
};

const buildObitoPayload = (body = {}) => ({
  veterinario: sanitizeText(body.veterinario),
  data: sanitizeText(body.data),
  hora: sanitizeText(body.hora),
  causa: sanitizeText(body.causa),
  relatorio: sanitizeText(body.relatorio),
});

const buildAltaPayload = (body = {}) => ({
  veterinario: sanitizeText(body.veterinario),
  data: sanitizeText(body.data),
  hora: sanitizeText(body.hora),
  relatorio: sanitizeText(body.relatorio),
});

const buildCancelamentoPayload = (body = {}) => ({
  responsavel: sanitizeText(body.responsavel),
  data: sanitizeText(body.data),
  hora: sanitizeText(body.hora),
  justificativa: sanitizeText(body.justificativa),
  observacoes: sanitizeText(body.observacoes),
});

const buildBoxTransferPayload = (body = {}) => ({
  box: sanitizeText(body.box),
});

const buildExecucaoConclusaoPayload = (body = {}) => ({
  status: sanitizeText(body.status, { fallback: 'Concluída' }),
  realizadoData: sanitizeText(body.realizadoData),
  realizadoHora: sanitizeText(body.realizadoHora),
  observacoes: sanitizeText(body.observacoes),
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

  const beforeEmpresa = formatEmpresa(before.empresa, before);
  const afterEmpresa = formatEmpresa(after.empresa, after);
  const beforeEmpresaLabel = sanitizeText(
    beforeEmpresa?.nomeFantasia ||
      beforeEmpresa?.nome ||
      beforeEmpresa?.label ||
      beforeEmpresa?.razaoSocial ||
      beforeEmpresa?.id,
  );
  const afterEmpresaLabel = sanitizeText(
    afterEmpresa?.nomeFantasia ||
      afterEmpresa?.nome ||
      afterEmpresa?.label ||
      afterEmpresa?.razaoSocial ||
      afterEmpresa?.id,
  );
  if (beforeEmpresaLabel !== afterEmpresaLabel) {
    if (!beforeEmpresaLabel && afterEmpresaLabel) {
      changes.push(`Empresa definida como "${afterEmpresaLabel}".`);
    } else if (beforeEmpresaLabel && !afterEmpresaLabel) {
      changes.push('Empresa removida.');
    } else {
      changes.push(`Empresa alterada de "${beforeEmpresaLabel}" para "${afterEmpresaLabel}".`);
    }
  }

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
  const empresa = formatEmpresa(plain.empresa, {
    empresaId: plain.empresaId,
    empresaNome: plain.empresaNome,
    empresaNomeFantasia: plain.empresaNomeFantasia,
    empresaRazaoSocial: plain.empresaRazaoSocial,
  });
  return {
    id: String(plain._id || plain.id || plain.box || '').trim(),
    box: sanitizeText(plain.box),
    ocupante,
    status: sanitizeText(plain.status, { fallback: ocupante === 'Livre' ? 'Disponível' : 'Em uso' }),
    especialidade: sanitizeText(plain.especialidade),
    higienizacao: sanitizeText(plain.higienizacao, { fallback: '—' }),
    observacao: sanitizeText(plain.observacao),
    empresaId: sanitizeText(empresa?.id),
    empresaNome: sanitizeText(
      empresa?.nomeFantasia || empresa?.nome || plain.empresaNome || plain.empresaNomeFantasia || plain.empresaRazaoSocial,
    ),
    empresaNomeFantasia: sanitizeText(
      empresa?.nomeFantasia || plain.empresaNomeFantasia || plain.empresaNome || plain.empresaRazaoSocial,
    ),
    empresaRazaoSocial: sanitizeText(
      empresa?.razaoSocial || plain.empresaRazaoSocial || plain.empresaNome || plain.empresaNomeFantasia,
    ),
    empresa: empresa || null,
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
  const relatoriosMedicos = Array.isArray(plain.relatoriosMedicos)
    ? plain.relatoriosMedicos
        .map(formatRelatorioMedicoItem)
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = new Date(a.criadoEm || 0).getTime();
          const bTime = new Date(b.criadoEm || 0).getTime();
          return bTime - aTime;
        })
    : [];
  const empresa = formatEmpresa(plain.empresa, {
    empresaId: plain.empresaId,
    empresaNome: plain.empresaNome,
    empresaNomeFantasia: plain.empresaNomeFantasia,
    empresaRazaoSocial: plain.empresaRazaoSocial,
  });
  const petPesoAtualizadoEm = toIsoStringSafe(plain.petPesoAtualizadoEm);
  const execucoes = Array.isArray(plain.execucoes)
    ? plain.execucoes.map(formatExecucaoItem).filter(Boolean)
    : [];
  const prescricoes = Array.isArray(plain.prescricoes)
    ? plain.prescricoes
        .map(formatPrescricaoItem)
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
    petPesoAtualizadoEm,
    petIdade: sanitizeText(plain.petIdade),
    tutorNome: sanitizeText(plain.tutorNome),
    tutorDocumento: sanitizeText(plain.tutorDocumento),
    tutorContato: sanitizeText(plain.tutorContato),
    empresaId: sanitizeText(empresa?.id),
    empresaNome: sanitizeText(
      empresa?.nomeFantasia ||
        empresa?.nome ||
        plain.empresaNome ||
        plain.empresaNomeFantasia ||
        plain.empresaRazaoSocial,
    ),
    empresaNomeFantasia: sanitizeText(empresa?.nomeFantasia || plain.empresaNomeFantasia),
    empresaRazaoSocial: sanitizeText(empresa?.razaoSocial || plain.empresaRazaoSocial),
    empresa: empresa || null,
    situacao: sanitizeText(plain.situacao),
    situacaoCodigo: sanitizeText(plain.situacaoCodigo),
    risco: sanitizeText(plain.risco),
    riscoCodigo: sanitizeText(plain.riscoCodigo),
    veterinario: sanitizeText(plain.veterinario),
    box: sanitizeText(plain.box),
    altaPrevistaData: sanitizeText(plain.altaPrevistaData),
    altaPrevistaHora: sanitizeText(plain.altaPrevistaHora),
    altaRegistrada: Boolean(plain.altaRegistrada),
    altaVeterinario: sanitizeText(plain.altaVeterinario),
    altaData: sanitizeText(plain.altaData),
    altaHora: sanitizeText(plain.altaHora),
    altaRelatorio: sanitizeText(plain.altaRelatorio),
    altaConfirmadaEm: plain.altaConfirmadaEm || null,
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
    cancelado: Boolean(plain.cancelado),
    canceladoResponsavel: sanitizeText(plain.canceladoResponsavel),
    canceladoData: sanitizeText(plain.canceladoData),
    canceladoHora: sanitizeText(plain.canceladoHora),
    canceladoJustificativa: sanitizeText(plain.canceladoJustificativa),
    canceladoObservacoes: sanitizeText(plain.canceladoObservacoes),
    canceladoRegistradoEm: plain.canceladoRegistradoEm || null,
    admissao: plain.createdAt || null,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
    historico,
    relatoriosMedicos,
    execucoes,
    prescricoes,
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

    const empresa = formatEmpresa(req.body?.empresa, {
      empresaId: req.body?.empresaId,
      empresaNome: req.body?.empresaNome,
      empresaNomeFantasia: req.body?.empresaNomeFantasia,
      empresaRazaoSocial: req.body?.empresaRazaoSocial,
    });

    if (!payload.box) {
      return res.status(400).json({ message: 'Informe o identificador do box.' });
    }

    if (!empresa) {
      return res.status(400).json({ message: 'Selecione a empresa do box.' });
    }

    if (!payload.status) {
      payload.status = payload.ocupante === 'Livre' ? 'Disponível' : 'Em uso';
    }

    payload.empresa = empresa;
    payload.empresaId = sanitizeText(empresa.id);
    payload.empresaNome = sanitizeText(empresa.nome || empresa.nomeFantasia || empresa.razaoSocial);
    payload.empresaNomeFantasia = sanitizeText(empresa.nomeFantasia || payload.empresaNome);
    payload.empresaRazaoSocial = sanitizeText(empresa.razaoSocial || payload.empresaNome);

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

router.delete('/boxes/:id', async (req, res) => {
  try {
    const targetId = sanitizeText(req.params?.id);
    if (!targetId) {
      return res.status(400).json({ message: 'Informe o box que deseja excluir.' });
    }

    let record = null;
    if (mongoose.isValidObjectId(targetId)) {
      record = await InternacaoBox.findById(targetId);
    }
    if (!record) {
      record = await InternacaoBox.findOne({ box: targetId });
    }

    if (!record) {
      return res.status(404).json({ message: 'Box não encontrado.' });
    }

    const ocupante = sanitizeText(record.ocupante, { fallback: 'Livre' });
    const status = sanitizeText(record.status);
    const ocupado = normalizeKey(ocupante) !== 'livre' || normalizeKey(status).includes('ocup');
    if (ocupado) {
      return res
        .status(409)
        .json({ message: 'Libere o box antes de excluí-lo para evitar inconsistências nas internações.' });
    }

    await record.deleteOne();
    return res.json({ message: 'Box excluído com sucesso.' });
  } catch (error) {
    console.error('internacao: falha ao excluir box', error);
    return res.status(500).json({ message: 'Não foi possível excluir o box.' });
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

router.post('/registros/:id/ocorrencias', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Informe o registro que deseja atualizar.' });
    }

    const record = await InternacaoRegistro.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Internação não encontrada.' });
    }

    const now = new Date();
    const payload = {
      data: sanitizeText(req.body?.data) || now.toISOString().slice(0, 10),
      hora: sanitizeText(req.body?.hora) || now.toISOString().slice(11, 16),
      resumo: sanitizeText(req.body?.resumo),
      descricao: sanitizeText(req.body?.descricao),
    };

    if (!payload.resumo) {
      return res.status(400).json({ message: 'Informe um resumo da ocorrência.' });
    }
    if (!payload.descricao) {
      return res.status(400).json({ message: 'Descreva os detalhes da ocorrência.' });
    }

    const autor = req.user?.email || 'Sistema';
    const criadoEmISO = combineDateAndTimeParts(payload.data, payload.hora);
    const criadoEm = criadoEmISO ? new Date(criadoEmISO) : now;
    const descricaoHistorico = payload.descricao ? `${payload.resumo} — ${payload.descricao}` : payload.resumo;

    record.historico = Array.isArray(record.historico) ? record.historico : [];
    record.historico.unshift({
      tipo: 'Ocorrência',
      descricao: descricaoHistorico,
      criadoPor: autor,
      criadoEm,
    });

    await record.save();

    const updated = await InternacaoRegistro.findById(record._id).lean();
    const formatted = formatRegistro(updated);
    if (!formatted) {
      return res.status(500).json({ message: 'Não foi possível registrar a ocorrência.' });
    }

    return res.status(201).json(formatted);
  } catch (error) {
    console.error('internacao: falha ao registrar ocorrência', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Revise as informações preenchidas antes de salvar a ocorrência.' });
    }
    return res.status(500).json({ message: 'Não foi possível salvar a ocorrência.' });
  }
});

router.post('/registros/:id/parametros', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Informe o registro que deseja atualizar.' });
    }

    const record = await InternacaoRegistro.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Internação não encontrada.' });
    }

    if (record.obitoRegistrado || normalizeKey(record.situacaoCodigo) === 'obito') {
      return res.status(409).json({ message: 'Não é possível registrar parâmetros após o óbito.' });
    }

    if (record.cancelado || normalizeKey(record.situacaoCodigo) === 'cancelado') {
      return res.status(409).json({ message: 'Essa internação está cancelada e não permite novos registros.' });
    }

    const payload = {
      data: sanitizeText(req.body?.data),
      hora: sanitizeText(req.body?.hora),
      respostas: sanitizeParametrosResposta(req.body?.respostas),
    };

    if (!payload.data) {
      return res.status(400).json({ message: 'Informe a data da coleta dos parâmetros clínicos.' });
    }

    if (!payload.hora) {
      return res.status(400).json({ message: 'Informe a hora da coleta dos parâmetros clínicos.' });
    }

    if (!payload.respostas.length) {
      return res.status(400).json({ message: 'Adicione pelo menos uma resposta ou observação para salvar.' });
    }

    const autor = req.user?.email || 'Sistema';
    const programadoEm = combineDateAndTimeParts(payload.data, payload.hora);
    const resumoRespostas = payload.respostas
      .map((item) => {
        const label = item.nome || item.id || 'Parâmetro';
        const resposta = item.resposta || '—';
        const obs = item.observacao ? ` (${item.observacao})` : '';
        return `${label}: ${resposta}${obs}`;
      })
      .join(' | ');

    record.execucoes = Array.isArray(record.execucoes) ? record.execucoes : [];
    record.execucoes.unshift({
      programadoData: payload.data,
      programadoHora: payload.hora,
      programadoEm,
      horario: payload.hora,
      descricao: 'Parâmetros clínicos',
      responsavel: autor,
      status: 'Concluída',
      realizadoData: payload.data,
      realizadoHora: payload.hora,
      realizadoEm: programadoEm,
      realizadoPor: autor,
      observacoes: resumoRespostas,
    });

    record.historico = Array.isArray(record.historico) ? record.historico : [];
    record.historico.unshift({
      tipo: 'Parâmetros clínicos',
      descricao: `Coleta registrada em ${payload.data} ${payload.hora}. ${resumoRespostas || 'Sem respostas registradas.'}`.trim(),
      criadoPor: autor,
      criadoEm: new Date(),
    });

    await record.save();

    const updated = await InternacaoRegistro.findById(record._id).lean();
    const formatted = formatRegistro(updated);
    if (!formatted) {
      return res.status(500).json({ message: 'Não foi possível atualizar o mapa de execução com os parâmetros clínicos.' });
    }

    return res.status(201).json(formatted);
  } catch (error) {
    console.error('internacao: falha ao registrar parâmetros clínicos', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Revise as informações preenchidas antes de salvar a coleta.' });
    }
    return res.status(500).json({ message: 'Não foi possível salvar os parâmetros clínicos.' });
  }
});

router.post('/registros/:id/relatorios-medicos', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Informe o registro que deseja atualizar.' });
    }

    const record = await InternacaoRegistro.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Internação não encontrada.' });
    }

    const payload = {
      resumo: sanitizeText(req.body?.resumo),
      descricao: sanitizeText(req.body?.descricao),
    };

    if (!payload.resumo) {
      return res.status(400).json({ message: 'Informe um resumo para o relatório.' });
    }

    if (!payload.descricao) {
      return res.status(400).json({ message: 'Descreva o relatório médico antes de salvar.' });
    }

    const autor = req.user?.email || 'Sistema';
    const criadoEm = new Date();
    const historicoDescricao = `${payload.resumo}${payload.descricao ? ` — ${payload.descricao}` : ''}`;

    record.historico = Array.isArray(record.historico) ? record.historico : [];
    record.historico.unshift({
      tipo: 'Relatório médico',
      descricao: historicoDescricao,
      criadoPor: autor,
      criadoEm,
    });

    record.relatoriosMedicos = Array.isArray(record.relatoriosMedicos) ? record.relatoriosMedicos : [];
    record.relatoriosMedicos.unshift({
      resumo: payload.resumo,
      descricao: payload.descricao,
      criadoPor: autor,
      criadoEm,
    });

    await record.save();

    const updated = await InternacaoRegistro.findById(record._id).lean();
    const formatted = formatRegistro(updated);
    if (!formatted) {
      return res.status(500).json({ message: 'Não foi possível salvar o relatório médico.' });
    }

    return res.status(201).json(formatted);
  } catch (error) {
    console.error('internacao: falha ao salvar relatório médico', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Revise as informações preenchidas antes de salvar o relatório.' });
    }
    return res.status(500).json({ message: 'Não foi possível registrar o relatório médico.' });
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

    const petId = sanitizeText(record.petId);
    if (petId && mongoose.isValidObjectId(petId)) {
      try {
        await Pet.findByIdAndUpdate(petId, { obito: true });
      } catch (petUpdateError) {
        console.warn('internacao: falha ao atualizar status de óbito do pet', petUpdateError);
      }
    }

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

router.post('/registros/:id/alta', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Informe o registro que deseja atualizar.' });
    }

    const record = await InternacaoRegistro.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Internação não encontrada.' });
    }

    if (record.cancelado || normalizeKey(record.situacaoCodigo) === 'cancelado') {
      return res.status(409).json({ message: 'Não é possível registrar alta para internações canceladas.' });
    }

    if (record.obitoRegistrado || normalizeKey(record.situacaoCodigo) === 'obito') {
      return res.status(409).json({ message: 'Não é possível registrar alta após o óbito.' });
    }

    if (record.altaRegistrada || normalizeKey(record.situacaoCodigo) === 'alta') {
      return res.status(409).json({ message: 'A alta desse paciente já está registrada.' });
    }

    const payload = buildAltaPayload(req.body);
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

    if (!payload.veterinario || !payload.data || !payload.hora || !payload.relatorio) {
      return res.status(400).json({ message: 'Preencha os campos obrigatórios antes de registrar a alta.' });
    }

    record.altaRegistrada = true;
    record.altaVeterinario = payload.veterinario;
    record.altaData = payload.data;
    record.altaHora = payload.hora;
    record.altaRelatorio = payload.relatorio;
    record.altaConfirmadaEm = now;
    record.situacao = 'Alta';
    record.situacaoCodigo = 'alta';

    const execucoesInterrompidas = removeExecucoesPendentes(record);
    const autor = req.user?.email || payload.veterinario || 'Sistema';
    const detalhes = [
      `Data: ${payload.data}${payload.hora ? ` às ${payload.hora}` : ''}.`,
      payload.relatorio ? `Relatório: ${payload.relatorio}.` : '',
      execucoesInterrompidas
        ? `${execucoesInterrompidas} procedimento(s) pendente(s) interrompido(s).`
        : 'Nenhum procedimento pendente encontrado.',
    ]
      .filter(Boolean)
      .join(' ');

    record.historico = Array.isArray(record.historico) ? record.historico : [];
    record.historico.push({
      tipo: 'Alta',
      descricao: `Alta registrada. ${detalhes}`,
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
        console.warn('internacao: falha ao liberar box após alta', boxReleaseError);
      }
    }

    const updated = await InternacaoRegistro.findById(record._id).lean();
    return res.json(formatRegistro(updated));
  } catch (error) {
    console.error('internacao: falha ao registrar alta', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Revise os dados informados antes de registrar a alta.' });
    }
    return res.status(500).json({ message: 'Não foi possível registrar a alta do paciente.' });
  }
});

router.post('/registros/:id/cancelar', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Informe o registro que deseja atualizar.' });
    }

    const record = await InternacaoRegistro.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Internação não encontrada.' });
    }

    if (record.cancelado || sanitizeText(record.situacaoCodigo).toLowerCase() === 'cancelado') {
      return res.status(409).json({ message: 'Essa internação já foi cancelada anteriormente.' });
    }

    if (record.obitoRegistrado) {
      return res.status(409).json({ message: 'Não é possível cancelar uma internação com óbito registrado.' });
    }

    const payload = buildCancelamentoPayload(req.body);
    const now = new Date();
    if (!payload.data) {
      payload.data = now.toISOString().slice(0, 10);
    }
    if (!payload.hora) {
      payload.hora = now.toISOString().slice(11, 16);
    }

    if (!payload.responsavel || !payload.data || !payload.hora || !payload.justificativa) {
      return res.status(400).json({ message: 'Preencha os campos obrigatórios antes de cancelar a internação.' });
    }

    record.cancelado = true;
    record.canceladoResponsavel = payload.responsavel;
    record.canceladoData = payload.data;
    record.canceladoHora = payload.hora;
    record.canceladoJustificativa = payload.justificativa;
    record.canceladoObservacoes = payload.observacoes;
    record.canceladoRegistradoEm = now;
    record.situacao = 'Cancelado';
    record.situacaoCodigo = 'cancelado';

    const autor = req.user?.email || payload.responsavel || 'Sistema';
    const detalhes = [
      `Responsável: ${payload.responsavel}.`,
      `Cancelado em ${payload.data}${payload.hora ? ` às ${payload.hora}` : ''}.`,
      payload.justificativa ? `Justificativa: ${payload.justificativa}.` : '',
      payload.observacoes ? `Observações: ${payload.observacoes}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    record.historico = Array.isArray(record.historico) ? record.historico : [];
    record.historico.push({
      tipo: 'Cancelamento',
      descricao: `Internação cancelada. ${detalhes}`,
      criadoPor: autor,
      criadoEm: now,
    });

    const previousBox = sanitizeText(record.box);
    record.box = '';

    await record.save();

    if (previousBox) {
      try {
        await InternacaoBox.findOneAndUpdate(
          { box: previousBox },
          { ocupante: 'Livre', status: 'Disponível' },
        );
      } catch (boxReleaseError) {
        console.warn('internacao: falha ao liberar box após cancelamento', boxReleaseError);
      }
    }

    const updated = await InternacaoRegistro.findById(record._id).lean();
    return res.json(formatRegistro(updated));
  } catch (error) {
    console.error('internacao: falha ao cancelar internação', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Revise os dados informados antes de cancelar.' });
    }
    return res.status(500).json({ message: 'Não foi possível cancelar essa internação.' });
  }
});

router.post('/registros/:id/box', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Informe o registro que deseja atualizar.' });
    }

    const record = await InternacaoRegistro.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Internação não encontrada.' });
    }

    if (record.cancelado || record.situacaoCodigo === 'cancelado') {
      return res.status(400).json({ message: 'Essa internação está cancelada e não pode ser alterada.' });
    }

    if (record.obitoRegistrado || record.situacaoCodigo === 'obito') {
      return res.status(400).json({ message: 'Não é possível alterar o box após o registro de óbito.' });
    }

    const payload = buildBoxTransferPayload(req.body);
    const previousBox = sanitizeText(record.box);
    const nextBox = payload.box;

    if (!previousBox && !nextBox) {
      return res.status(400).json({ message: 'Nenhuma alteração foi identificada para salvar.' });
    }

    if (previousBox && nextBox && previousBox === nextBox) {
      return res.status(400).json({ message: 'Selecione um box diferente antes de salvar.' });
    }

    record.box = nextBox;

    const autor = req.user?.email || 'Sistema';
    const descricao = !previousBox && nextBox
      ? `Box atribuído (${nextBox}).`
      : previousBox && !nextBox
        ? `Box removido (anterior: ${previousBox}).`
        : `Box alterado de ${previousBox} para ${nextBox}.`;

    record.historico = Array.isArray(record.historico) ? record.historico : [];
    record.historico.push({
      tipo: 'Box',
      descricao,
      criadoPor: autor,
      criadoEm: new Date(),
    });

    await record.save();

    if (previousBox && previousBox !== nextBox) {
      try {
        await InternacaoBox.findOneAndUpdate(
          { box: previousBox },
          { ocupante: 'Livre', status: 'Disponível' },
        );
      } catch (boxReleaseError) {
        console.warn('internacao: falha ao liberar box durante movimentação', boxReleaseError);
      }
    }

    if (nextBox) {
      try {
        await InternacaoBox.findOneAndUpdate(
          { box: nextBox },
          { ocupante: record.petNome || 'Ocupado', status: 'Ocupado' },
        );
      } catch (boxAssignError) {
        console.warn('internacao: falha ao atribuir box durante movimentação', boxAssignError);
      }
    }

    const updated = await InternacaoRegistro.findById(record._id).lean();
    return res.json(formatRegistro(updated));
  } catch (error) {
    console.error('internacao: falha ao atualizar box da internação', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Revise as informações preenchidas antes de salvar.' });
    }
    return res.status(500).json({ message: 'Não foi possível atualizar o box do paciente.' });
  }
});

router.post('/registros/:id/prescricoes', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: 'Informe a internação que deseja atualizar.' });
    }

    const record = await InternacaoRegistro.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Internação não encontrada.' });
    }

    if (record.obitoRegistrado || normalizeKey(record.situacaoCodigo) === 'obito') {
      return res.status(409).json({ message: 'Não é possível registrar prescrições após o óbito.' });
    }

    if (record.cancelado || normalizeKey(record.situacaoCodigo) === 'cancelado') {
      return res.status(409).json({ message: 'Essa internação está cancelada e não permite novas prescrições.' });
    }

    const payload = buildPrescricaoPayload(req.body);
    try {
      ensurePrescricaoPayload(payload);
    } catch (validationError) {
      return res.status(400).json({ message: validationError.message || 'Revise os dados informados.' });
    }

    const autor = req.user?.email || 'Sistema';
    const now = new Date();
    const resumo = payload.resumo || payload.descricao || payload.fluidFluido || 'Prescrição registrada.';

    const storedPrescricao = {
      ...payload,
      resumo,
      criadoPor: autor,
      criadoEm: now,
    };

    record.prescricoes = Array.isArray(record.prescricoes) ? record.prescricoes : [];
    record.prescricoes.unshift(storedPrescricao);
    const prescricaoDoc = record.prescricoes[0];
    const prescricaoId = prescricaoDoc?._id ? String(prescricaoDoc._id).trim() : '';

    const hasHorario = Boolean(payload.horaInicio);
    if (hasHorario) {
      record.execucoes = Array.isArray(record.execucoes) ? record.execucoes : [];
      const status = normalizeKey(payload.frequencia) === 'necessario' ? 'Sob demanda' : 'Agendado';
      const novasExecucoes = buildExecucaoEntriesFromPrescricao(payload, autor, resumo, status, prescricaoId);
      if (novasExecucoes.length) {
        record.execucoes.unshift(...novasExecucoes);
      }
    }

    record.historico = Array.isArray(record.historico) ? record.historico : [];
    const historicoDescricao = [
      payload.descricao ? `Prescrição: ${payload.descricao}.` : '',
      payload.dataInicio ? `Início previsto: ${payload.dataInicio}${payload.horaInicio ? ` às ${payload.horaInicio}` : ''}.` : '',
      resumo ? `Resumo: ${resumo}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    record.historico.unshift({
      tipo: 'Prescrição',
      descricao: historicoDescricao || 'Nova prescrição registrada.',
      criadoPor: autor,
      criadoEm: now,
    });

    await record.save();

    const updated = await InternacaoRegistro.findById(record._id).lean();
    const formatted = formatRegistro(updated);
    if (!formatted) {
      return res.status(500).json({ message: 'Não foi possível atualizar a ficha com a nova prescrição.' });
    }

    const io = req.app?.get('socketio');
    if (io && formatted.id) {
      const room = `vet:ficha:${formatted.id}`;
      io.to(room).emit('vet:ficha:update', {
        room,
        timestamp: Date.now(),
        payload: { registro: formatted },
      });
    }

    return res.status(201).json(formatted);
  } catch (error) {
    console.error('internacao: falha ao registrar prescricao', error);
    if (error?.name === 'ValidationError') {
      return res.status(400).json({ message: 'Revise as informações preenchidas antes de salvar.' });
    }
    return res.status(500).json({ message: 'Não foi possível registrar a prescrição.' });
  }
});

router.post('/registros/:id/prescricoes/:prescricaoId/interromper', async (req, res) => {
  try {
    const { id, prescricaoId } = req.params;
    if (!id || !prescricaoId) {
      return res.status(400).json({ message: 'Informe a prescrição que deseja interromper.' });
    }

    const record = await InternacaoRegistro.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Internação não encontrada.' });
    }

    if (record.obitoRegistrado || normalizeKey(record.situacaoCodigo) === 'obito') {
      return res.status(409).json({ message: 'Não é possível alterar prescrições após o óbito.' });
    }

    if (record.cancelado || normalizeKey(record.situacaoCodigo) === 'cancelado') {
      return res.status(409).json({ message: 'Essa internação está cancelada e não permite alterações.' });
    }

    const prescricao = findPrescricaoById(record, prescricaoId);
    if (!prescricao) {
      return res.status(404).json({ message: 'Prescrição não encontrada para interrupção.' });
    }

    record.execucoes = Array.isArray(record.execucoes) ? record.execucoes : [];
    const matcher = buildPrescricaoMatcher(prescricaoId, prescricao);
    const interrupcaoSobDemanda = normalizeKey(prescricao?.frequencia) === 'necessario';
    const removidos = removeExecucoesFromPrescricao(record, prescricaoId, {
      pendingOnly: true,
      agendadaOnly: !interrupcaoSobDemanda,
      prescricao,
      matcher,
    });
    const execucoesRestantes = countExecucoesFromPrescricao(record, { matcher });

    record.prescricoes = Array.isArray(record.prescricoes) ? record.prescricoes : [];
    pullPrescricaoById(record, prescricaoId);

    record.historico = Array.isArray(record.historico) ? record.historico : [];
    const resumoPrescricao = sanitizeText(prescricao.descricao) || sanitizeText(prescricao.resumo) || 'Prescrição';
    const detalhes = removidos
      ? `${removidos} execução(ões) pendente(s) removida(s).`
      : 'Nenhuma execução pendente foi encontrada.';
    const detalhesPrescricao = 'Prescrição removida da aba de Prescrição Médica.';
    const detalhesExecucoesConcluidas = execucoesRestantes
      ? `${execucoesRestantes} execução(ões) concluída(s) permanecem no mapa de execução.`
      : '';
    record.historico.unshift({
      tipo: 'Prescrição',
      descricao: [
        `Execuções da prescrição "${resumoPrescricao}" interrompidas.`,
        detalhes,
        detalhesPrescricao,
        detalhesExecucoesConcluidas,
      ]
        .filter(Boolean)
        .join(' '),
      criadoPor: req.user?.email || 'Sistema',
      criadoEm: new Date(),
    });

    await record.save();

    const updated = await InternacaoRegistro.findById(record._id).lean();
    const formatted = formatRegistro(updated);
    if (!formatted) {
      return res.status(500).json({ message: 'Não foi possível atualizar a ficha após a interrupção.' });
    }

    const io = req.app?.get('socketio');
    if (io && formatted.id) {
      const room = `vet:ficha:${formatted.id}`;
      io.to(room).emit('vet:ficha:update', {
        room,
        timestamp: Date.now(),
        payload: { registro: formatted },
      });
    }

    return res.json(formatted);
  } catch (error) {
    console.error('internacao: falha ao interromper prescricao', error);
    return res.status(500).json({ message: 'Não foi possível interromper os procedimentos dessa prescrição.' });
  }
});

router.post('/registros/:id/prescricoes/:prescricaoId/excluir', async (req, res) => {
  try {
    const { id, prescricaoId } = req.params;
    if (!id || !prescricaoId) {
      return res.status(400).json({ message: 'Informe a prescrição que deseja excluir.' });
    }

    const record = await InternacaoRegistro.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Internação não encontrada.' });
    }

    if (record.obitoRegistrado || normalizeKey(record.situacaoCodigo) === 'obito') {
      return res.status(409).json({ message: 'Não é possível excluir prescrições após o óbito.' });
    }

    if (record.cancelado || normalizeKey(record.situacaoCodigo) === 'cancelado') {
      return res.status(409).json({ message: 'Essa internação está cancelada e não permite alterações.' });
    }

    record.prescricoes = Array.isArray(record.prescricoes) ? record.prescricoes : [];
    const removida = pullPrescricaoById(record, prescricaoId);
    if (!removida) {
      return res.status(404).json({ message: 'Prescrição não encontrada para exclusão.' });
    }

    record.execucoes = Array.isArray(record.execucoes) ? record.execucoes : [];
    const execucoesRemovidas = removeExecucoesFromPrescricao(record, prescricaoId, {
      pendingOnly: false,
      prescricao: removida,
    });

    record.historico = Array.isArray(record.historico) ? record.historico : [];
    const resumoPrescricao = sanitizeText(removida.descricao) || sanitizeText(removida.resumo) || 'Prescrição';
    const execucaoDetalhe = execucoesRemovidas
      ? `${execucoesRemovidas} execução(ões) removida(s) do mapa de execução.`
      : 'Nenhuma execução estava vinculada no mapa de execução.';
    record.historico.unshift({
      tipo: 'Prescrição',
      descricao: `Prescrição "${resumoPrescricao}" excluída. ${execucaoDetalhe}`,
      criadoPor: req.user?.email || 'Sistema',
      criadoEm: new Date(),
    });

    await record.save();

    const updated = await InternacaoRegistro.findById(record._id).lean();
    const formatted = formatRegistro(updated);
    if (!formatted) {
      return res.status(500).json({ message: 'Não foi possível atualizar a ficha após a exclusão.' });
    }

    const io = req.app?.get('socketio');
    if (io && formatted.id) {
      const room = `vet:ficha:${formatted.id}`;
      io.to(room).emit('vet:ficha:update', {
        room,
        timestamp: Date.now(),
        payload: { registro: formatted },
      });
    }

    return res.json(formatted);
  } catch (error) {
    console.error('internacao: falha ao excluir prescricao', error);
    return res.status(500).json({ message: 'Não foi possível excluir essa prescrição.' });
  }
});

router.post('/registros/:id/execucoes/:execucaoId/concluir', async (req, res) => {
  try {
    const { id, execucaoId } = req.params;
    if (!id || !execucaoId) {
      return res.status(400).json({ message: 'Informe o procedimento que deseja atualizar.' });
    }

    const record = await InternacaoRegistro.findById(id);
    if (!record) {
      return res.status(404).json({ message: 'Internação não encontrada.' });
    }

    if (record.obitoRegistrado || normalizeKey(record.situacaoCodigo) === 'obito') {
      return res.status(409).json({ message: 'Não é possível concluir procedimentos após o óbito.' });
    }

    if (record.cancelado || normalizeKey(record.situacaoCodigo) === 'cancelado') {
      return res.status(409).json({ message: 'Essa internação está cancelada e não permite atualizações.' });
    }

    record.execucoes = Array.isArray(record.execucoes) ? record.execucoes : [];
    const execucao = findExecucaoById(record, execucaoId);
    if (!execucao) {
      return res.status(404).json({ message: 'Procedimento não encontrado para atualização.' });
    }

    const payload = buildExecucaoConclusaoPayload(req.body);
    const originalStatusKey = normalizeKey(execucao.status);
    const execucaoSobDemanda =
      originalStatusKey.includes('sobdemanda') ||
      originalStatusKey.includes('necess') ||
      execucao.sobDemanda === true ||
      String(execucao.sobDemanda).toLowerCase() === 'true' ||
      hasNecessarioFlag(execucao.frequencia) ||
      hasNecessarioFlag(execucao.freq) ||
      hasNecessarioFlag(execucao.tipoFrequencia) ||
      hasNecessarioFlag(execucao.prescricaoFrequencia) ||
      hasNecessarioFlag(execucao.prescricaoTipo) ||
      hasNecessarioFlag(execucao.programadoLabel) ||
      hasNecessarioFlag(execucao.resumo) ||
      hasNecessarioFlag(execucao.tipo);
    if (!payload.realizadoData || !payload.realizadoHora) {
      return res.status(400).json({ message: 'Informe data e hora de realização do procedimento.' });
    }

    const statusKey = normalizeKey(payload.status);
    const finalStatus = statusKey && statusKey.includes('agend') ? 'Agendada' : payload.status || 'Concluída';

    let statusHistorico = execucao.status;

    if (execucaoSobDemanda) {
      const execucaoSnapshot =
        typeof execucao.toObject === 'function' ? execucao.toObject() : { ...execucao };

      const programadoData = execucaoSnapshot.programadoData || payload.realizadoData;
      const programadoHora = execucaoSnapshot.programadoHora || payload.realizadoHora;
      const programadoEm =
        execucaoSnapshot.programadoEm || combineDateAndTimeParts(programadoData, programadoHora);

      const novaExecucao = {
        ...execucaoSnapshot,
        _id: undefined,
        id: undefined,
        status: finalStatus || 'Concluída',
        horario: payload.realizadoHora || execucaoSnapshot.horario,
        programadoData,
        programadoHora,
        programadoEm,
        realizadoData: payload.realizadoData,
        realizadoHora: payload.realizadoHora,
        realizadoEm: combineDateAndTimeParts(payload.realizadoData, payload.realizadoHora),
        realizadoPor: req.user?.email || 'Sistema',
        observacoes: payload.observacoes,
      };

      record.execucoes.unshift(novaExecucao);
      statusHistorico = novaExecucao.status;
    } else {
      execucao.status = finalStatus || 'Concluída';
      if (payload.realizadoHora) {
        execucao.horario = payload.realizadoHora;
      }
      execucao.realizadoData = payload.realizadoData;
      execucao.realizadoHora = payload.realizadoHora;
      execucao.realizadoEm = combineDateAndTimeParts(payload.realizadoData, payload.realizadoHora);
      execucao.realizadoPor = req.user?.email || 'Sistema';
      execucao.observacoes = payload.observacoes;
      if (!execucao.programadoData && payload.realizadoData) {
        execucao.programadoData = payload.realizadoData;
      }
      if (!execucao.programadoHora && payload.realizadoHora) {
        execucao.programadoHora = payload.realizadoHora;
      }
      if (!execucao.programadoEm) {
        execucao.programadoEm = combineDateAndTimeParts(execucao.programadoData, execucao.programadoHora);
      }
      statusHistorico = execucao.status;
    }

    record.historico = Array.isArray(record.historico) ? record.historico : [];
    const descricaoProcedimento = sanitizeText(execucao.descricao) || 'Procedimento';
    const realizadoLabel = `${payload.realizadoData} ${payload.realizadoHora}`.trim();
    record.historico.unshift({
      tipo: 'Execução',
      descricao: `Procedimento "${descricaoProcedimento}" marcado como ${statusHistorico || 'Concluído'} (${realizadoLabel}).`,
      criadoPor: req.user?.email || 'Sistema',
      criadoEm: new Date(),
    });

    await record.save();

    const updated = await InternacaoRegistro.findById(record._id).lean();
    const formatted = formatRegistro(updated);
    if (!formatted) {
      return res.status(500).json({ message: 'Não foi possível atualizar o mapa de execução.' });
    }

    const io = req.app?.get('socketio');
    if (io && formatted.id) {
      const room = `vet:ficha:${formatted.id}`;
      io.to(room).emit('vet:ficha:update', {
        room,
        timestamp: Date.now(),
        payload: { registro: formatted },
      });
    }

    return res.json(formatted);
  } catch (error) {
    console.error('internacao: falha ao concluir execucao', error);
    return res.status(500).json({ message: 'Não foi possível atualizar o procedimento selecionado.' });
  }
});

module.exports = router;
