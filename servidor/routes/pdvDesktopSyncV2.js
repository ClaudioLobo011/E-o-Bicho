const express = require('express');
const mongoose = require('mongoose');
const Pdv = require('../models/Pdv');
const PdvState = require('../models/PdvState');
const PdvStateSale = require('../models/PdvStateSale');
const PdvStateDeliveryOrder = require('../models/PdvStateDeliveryOrder');
const PaymentMethod = require('../models/PaymentMethod');
const Product = require('../models/Product');
const User = require('../models/User');
const Pet = require('../models/Pet');
const UserAddress = require('../models/UserAddress');
const Appointment = require('../models/Appointment');
const Transfer = require('../models/Transfer');
const Service = require('../models/Service');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const ProfessionalCommissionConfig = require('../models/ProfessionalCommissionConfig');
const PdvDesktopSyncTombstone = require('../models/PdvDesktopSyncTombstone');

const router = express.Router();
const clean = (value) => String(value || '').trim();
const staffRoles = new Set(['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master']);
let mapAppointmentOccurrences = null;

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursorPart(value) {
  if (!value || typeof value !== 'object') return null;
  const updatedAt = new Date(value.updatedAt);
  if (!mongoose.Types.ObjectId.isValid(value.id) || Number.isNaN(updatedAt.getTime())) return null;
  return { id: new mongoose.Types.ObjectId(value.id), updatedAt };
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    return decodeCursorPart(parsed);
  } catch {
    return null;
  }
}

function decodeCompositeCursor(value) {
  if (!value) return { upserts: null, deletions: null };
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    return {
      upserts: decodeCursorPart(parsed.upserts),
      deletions: decodeCursorPart(parsed.deletions),
    };
  } catch {
    return null;
  }
}

function cursorQuery(cursor) {
  if (!cursor) return {};
  return {
    $or: [
      { updatedAt: { $gt: cursor.updatedAt } },
      { updatedAt: cursor.updatedAt, _id: { $gt: cursor.id } },
    ],
  };
}

function cursorFor(document, fallback = null) {
  if (!document) return fallback;
  return {
    id: String(document._id),
    updatedAt: new Date(document.updatedAt || document.createdAt || document._id.getTimestamp()).toISOString(),
  };
}

function pageLimit(req, fallback = 500) {
  return Math.min(Math.max(Number(req.query.limit || fallback), 25), 1000);
}

function userName(user) {
  return clean(user?.nomeCompleto || user?.nomeContato || user?.razaoSocial || user?.email);
}

function userCompanies(user) {
  return [...new Set([
    user?.empresaPrincipal,
    user?.empresaContratual,
    ...(Array.isArray(user?.empresas) ? user.empresas : []),
  ].filter(Boolean).map(String))];
}

function customerForDesktop(user) {
  return {
    id: String(user._id),
    code: user.codigoCliente ? String(user.codigoCliente) : '',
    name: userName(user),
    document: user.cpf || user.cnpj || user.inscricaoEstadual || '',
    email: user.email || '',
    phone: user.celular || user.telefone || '',
    secondaryPhone: user.celularSecundario || user.telefoneSecundario || '',
    phones: [user.telefone, user.telefoneSecundario, user.celular, user.celularSecundario].map(clean).filter(Boolean),
    telephone: user.telefone || '',
    secondaryTelephone: user.telefoneSecundario || '',
    mobile: user.celular || '',
    secondaryMobile: user.celularSecundario || '',
    accountType: user.tipoConta || '',
    gender: user.genero || '',
    birthDate: user.dataNascimento || null,
    customerSince: user.criadoEm || user.createdAt || null,
    notes: user.observacao || user.observacoes || '',
    creditLimit: Number(user.limiteCredito || 0),
    pendingAmount: Number(user.valorPendente || 0),
    updatedAt: user.updatedAt || null,
  };
}

function petForDesktop(pet) {
  return {
    id: String(pet._id), ownerId: String(pet.owner), code: pet.codigoPet ? String(pet.codigoPet) : '',
    oldCode: pet.codAntigoPet || '', legacyCode: pet.codAntigoPet || '', name: pet.nome || '',
    type: pet.tipo || '', species: pet.tipo || '', breed: pet.raca || '', size: pet.porte || '',
    sex: pet.sexo || '', birthDate: pet.dataNascimento || null, microchip: pet.microchip || '',
    coatColor: pet.pelagemCor || '', color: pet.pelagemCor || '', rga: pet.rga || '', weight: pet.peso || '',
    neutered: Boolean(pet.castrado), deceased: Boolean(pet.obito), updatedAt: pet.updatedAt || null,
  };
}

function addressForDesktop(address) {
  return {
    id: String(address._id), ownerId: String(address.user), label: address.apelido || '',
    zipCode: address.cep || '', street: address.logradouro || '', number: address.numero || '',
    complement: address.complemento || '', district: address.bairro || '', city: address.cidade || '',
    state: address.uf || '', principal: Boolean(address.isDefault), isDefault: Boolean(address.isDefault),
    updatedAt: address.updatedAt || null,
  };
}

function transferForDesktop(entry) {
  return {
    id: String(entry._id), desktopTransferId: entry.desktopTransferId || '', number: Number(entry.number),
    requestDate: entry.requestDate, status: entry.status, pdvId: clean(entry.desktopPdv),
    originCompanyId: clean(entry.originCompany?._id || entry.originCompany),
    originCompanyName: entry.originCompany?.nomeFantasia || entry.originCompany?.nome || '',
    originDepositId: clean(entry.originDeposit?._id || entry.originDeposit), originDepositName: entry.originDeposit?.nome || '',
    destinationCompanyId: clean(entry.destinationCompany?._id || entry.destinationCompany),
    destinationCompanyName: entry.destinationCompany?.nomeFantasia || entry.destinationCompany?.nome || '',
    destinationDepositId: clean(entry.destinationDeposit?._id || entry.destinationDeposit), destinationDepositName: entry.destinationDeposit?.nome || '',
    responsibleId: clean(entry.responsible?._id || entry.responsible), responsibleName: userName(entry.responsible),
    referenceDocument: entry.referenceDocument || '', observations: entry.observations || '',
    items: (entry.items || []).map((item) => ({
      productId: clean(item.product), code: item.sku || '', barcode: item.barcode || '',
      name: item.description || '', quantity: Number(item.quantity || 0), unit: item.unit || 'UN',
    })),
    createdAt: entry.createdAt, updatedAt: entry.updatedAt,
  };
}

async function latestUpdatedAt(Model, query = {}, options = {}) {
  const finder = Model.findOne(query).sort({ updatedAt: -1, _id: -1 }).select('updatedAt');
  if (options.includeDeleted) finder.setOptions({ includeDeleted: true });
  const latest = await finder.lean();
  return latest?.updatedAt || null;
}

function latestVersion(values = []) {
  return values.reduce((latest, value) => {
    const parsed = value ? new Date(value) : null;
    return parsed && !Number.isNaN(parsed.getTime()) && (!latest || parsed > latest) ? parsed : latest;
  }, null);
}

router.get('/bootstrap', async (req, res) => {
  const host = req.desktopHost;
  const [pdv, state, paymentMethods, versions] = await Promise.all([
    Pdv.findById(host.pdv)
      .select('codigo nome apelido ativo tipoUso modoTerminais empresa empresaEmitenteFiscal serieNfe serieNfce numeroNfeInicial numeroNfceInicial numeroNfeAtual numeroNfceAtual ambientesHabilitados ambientePadrao sincronizacaoAutomatica permitirModoOffline mostrarParaFuncionarios limiteOffline configuracoesImpressao configuracoesVenda configuracoesFiscal configuracoesEstoque configuracoesFinanceiro desktop updatedAt')
      .populate('empresa', '_id codigo nome nomeFantasia razaoSocial cnpj inscricaoEstadual telefone whatsapp imagem endereco cep municipio uf logradouro bairro numero complemento codigoIbgeMunicipio codigoUf updatedAt')
      .populate('empresaEmitenteFiscal', '_id codigo nome nomeFantasia razaoSocial cnpj inscricaoEstadual telefone whatsapp imagem endereco cep municipio uf logradouro bairro numero complemento codigoIbgeMunicipio codigoUf updatedAt')
      .lean(),
    PdvState.findOne({ pdv: host.pdv })
      // Somente o estado corrente indispensável. Históricos, vendas, deliveries,
      // inventário e demais coleções são obtidos pelas rotas incrementais.
      .select('caixaAberto summary caixaInfo pagamentos saleCodeIdentifier saleCodeSequence budgetSequence printPreferences updatedAt')
      .lean(),
    PaymentMethod.find({ company: host.empresa }).sort({ name: 1 }).lean(),
    Promise.all([
      latestUpdatedAt(Product), latestUpdatedAt(PdvStateSale, { pdv: host.pdv }), latestUpdatedAt(User),
      latestUpdatedAt(Pet), latestUpdatedAt(UserAddress), latestUpdatedAt(Appointment, { store: host.empresa }, { includeDeleted: true }),
      latestUpdatedAt(PdvStateDeliveryOrder, { pdv: host.pdv }),
      latestUpdatedAt(Transfer, { $or: [{ originCompany: host.empresa }, { destinationCompany: host.empresa }] }),
    ]),
  ]);
  if (!pdv || !['web', 'executavel'].includes(pdv.tipoUso) || pdv.desktop?.status === 'suspenso') {
    return res.status(409).json({ message: 'PDV não está disponível para preparação do Executável.' });
  }
  const configurationVersion = latestVersion([
    pdv.updatedAt,
    pdv.empresa?.updatedAt,
    pdv.empresaEmitenteFiscal?.updatedAt,
    ...paymentMethods.map((method) => method.updatedAt),
  ]);
  const versionNames = ['products', 'sales', 'directory', 'pets', 'addresses', 'appointments', 'deliveries', 'transfers'];
  return res.json({
    version: 2,
    protocol: { version: 2, legacyCompatible: true, cursorFormat: 'updatedAt+_id' },
    generatedAt: new Date().toISOString(),
    pdv,
    state: state || null,
    paymentMethods,
    versions: {
      configuration: configurationVersion,
      ...Object.fromEntries(versionNames.map((name, index) => [name, versions[index] || null])),
    },
    updateFeedUrl: 'https://raw.githubusercontent.com/ClaudioLobo011/E-o-Bicho/main/public/updates/pdv',
  });
});

router.get('/sales', async (req, res) => {
  const cursor = decodeCursor(req.query.cursor);
  if (req.query.cursor && !cursor) return res.status(400).json({ message: 'Cursor de vendas inválido.' });
  const limit = pageLimit(req);
  const documents = await PdvStateSale.find({ pdv: req.desktopHost.pdv, ...cursorQuery(cursor) })
    .sort({ updatedAt: 1, _id: 1 }).select('payload updatedAt').limit(limit + 1).lean();
  const hasMore = documents.length > limit;
  const page = hasMore ? documents.slice(0, limit) : documents;
  const last = page[page.length - 1];
  const next = cursorFor(last, cursor && { id: String(cursor.id), updatedAt: cursor.updatedAt.toISOString() });
  return res.json({
    sales: page.map((entry) => ({ ...(entry.payload || {}), cloudUpdatedAt: entry.updatedAt })),
    nextCursor: next ? encodeCursor(next) : '', hasMore,
  });
});

async function loadDirectoryUpserts(entity, host, cursor, limit) {
  const userFields = '_id codigoCliente nomeCompleto nomeContato razaoSocial email cpf cnpj inscricaoEstadual celular telefone celularSecundario telefoneSecundario tipoConta genero dataNascimento criadoEm observacao observacoes role grupos userGroup empresas empresaPrincipal empresaContratual limiteCredito valorPendente dataDemissao situacao createdAt updatedAt';
  let query = {};
  let documents = [];
  if (entity === 'customers') {
    query = { $and: [{ $or: [{ role: 'cliente' }, { codigoCliente: { $exists: true, $ne: null } }] }, cursorQuery(cursor)] };
    documents = await User.find(query).select(userFields).sort({ updatedAt: 1, _id: 1 }).limit(limit + 1).lean();
    return { documents, map: (page) => page.map(customerForDesktop) };
  }
  if (entity === 'pets') {
    query = { ...cursorQuery(cursor) };
    documents = await Pet.find(query).select('_id owner codigoPet codAntigoPet nome tipo raca porte sexo dataNascimento microchip pelagemCor rga peso castrado obito updatedAt')
      .sort({ updatedAt: 1, _id: 1 }).limit(limit + 1).lean();
    return { documents, map: (page) => page.map(petForDesktop) };
  }
  if (entity === 'addresses') {
    documents = await UserAddress.find(cursorQuery(cursor)).select('_id user apelido cep logradouro numero complemento bairro cidade uf isDefault updatedAt')
      .sort({ updatedAt: 1, _id: 1 }).limit(limit + 1).lean();
    return { documents, map: (page) => page.map(addressForDesktop) };
  }
  if (entity === 'employees') {
    query = {
      $and: [
        { $or: [{ empresaPrincipal: host.empresa }, { empresaContratual: host.empresa }, { empresas: host.empresa }] },
        cursorQuery(cursor),
      ],
    };
    documents = await User.find(query).select(userFields).populate('userGroup', 'comissaoServicoPercent')
      .sort({ updatedAt: 1, _id: 1 }).limit(limit + 1).lean();
    return { documents, map: async (page) => {
      const professionalIds = page.filter((user) => Array.isArray(user.grupos) && user.grupos.some((group) => ['esteticista', 'veterinario'].includes(group))).map((user) => user._id);
      const configs = professionalIds.length
        ? await ProfessionalCommissionConfig.find({ user: { $in: professionalIds } }).select('user groupRules serviceRules').lean()
        : [];
      const byUser = new Map(configs.map((config) => [String(config.user), config]));
      return page.map((user) => {
        const groups = Array.isArray(user.grupos) ? user.grupos : [];
        const config = byUser.get(String(user._id));
        return {
          id: String(user._id), code: user.codigoCliente ? String(user.codigoCliente) : '', name: userName(user),
          document: user.cpf || user.cnpj || '', role: user.role || '', groups, companies: userCompanies(user),
          active: staffRoles.has(String(user.role || '').toLowerCase()) && !user.dataDemissao && !['inativo', 'bloqueado', 'demitido', 'desligado'].includes(clean(user.situacao).toLowerCase()),
          seller: groups.includes('vendedor'), courier: groups.some((group) => ['entregador', 'gerente'].includes(group)),
          responsible: true,
          professionalType: groups.includes('veterinario') ? 'veterinario' : groups.includes('esteticista') ? 'esteticista' : '',
          commission: groups.some((group) => ['esteticista', 'veterinario'].includes(group)) ? {
            fallbackPercent: Number(user.userGroup?.comissaoServicoPercent || 0),
            groupRules: (config?.groupRules || []).map((rule) => ({ groupId: String(rule.group || ''), percent: Number(rule.percent || 0) })),
            serviceRules: (config?.serviceRules || []).map((rule) => ({ serviceId: String(rule.service || ''), percent: Number(rule.percent || 0) })),
          } : null,
          updatedAt: user.updatedAt || null,
        };
      });
    } };
  }
  if (entity === 'services') {
    documents = await Service.find(cursorQuery(cursor)).select('_id nome valor duracaoMinutos grupo categorias porte ativo updatedAt')
      .populate({ path: 'grupo', select: 'nome tiposPermitidos comissaoPercent' })
      .sort({ updatedAt: 1, _id: 1 }).limit(limit + 1).lean();
    return { documents, map: (page) => page.map((service) => ({
      id: String(service._id), name: service.nome || '', price: Number(service.valor || 0), durationMinutes: Number(service.duracaoMinutos || 0),
      active: service.ativo !== false, groupId: String(service.grupo?._id || service.grupo || ''),
      groupCommissionPercent: Number(service.grupo?.comissaoPercent || 0), allowedStaffTypes: service.grupo?.tiposPermitidos || [],
      categories: service.categorias || [], sizes: service.porte || [], updatedAt: service.updatedAt || null,
    })) };
  }
  if (entity === 'stores') {
    documents = await Store.find(cursorQuery(cursor)).select('_id codigo nome nomeFantasia uf updatedAt')
      .sort({ updatedAt: 1, _id: 1 }).limit(limit + 1).lean();
    return { documents, map: (page) => page.map((store) => ({ id: String(store._id), code: store.codigo || '', name: store.nomeFantasia || store.nome || '', state: store.uf || '', updatedAt: store.updatedAt || null })) };
  }
  if (entity === 'deposits') {
    documents = await Deposit.find(cursorQuery(cursor)).select('_id codigo nome empresa updatedAt')
      .sort({ updatedAt: 1, _id: 1 }).limit(limit + 1).lean();
    return { documents, map: (page) => page.map((deposit) => ({ id: String(deposit._id), code: deposit.codigo || '', name: deposit.nome || '', companyId: String(deposit.empresa), updatedAt: deposit.updatedAt || null })) };
  }
  return null;
}

router.get('/directory/:entity', async (req, res) => {
  const entity = clean(req.params.entity).toLowerCase();
  const supported = new Set(['customers', 'pets', 'addresses', 'employees', 'services', 'stores', 'deposits']);
  if (!supported.has(entity)) return res.status(404).json({ message: 'Tipo de cadastro incremental não encontrado.' });
  const composite = decodeCompositeCursor(req.query.cursor);
  if (req.query.cursor && !composite) return res.status(400).json({ message: 'Cursor de cadastros inválido.' });
  const limit = pageLimit(req);
  const loaded = await loadDirectoryUpserts(entity, req.desktopHost, composite.upserts, limit);
  const hasMoreUpserts = loaded.documents.length > limit;
  const upsertPage = hasMoreUpserts ? loaded.documents.slice(0, limit) : loaded.documents;
  const tombstoneEntities = {
    customers: 'customer', pets: 'pet', addresses: 'address', employees: 'employee',
    services: 'service', stores: 'store', deposits: 'deposit',
  };
  const tombstoneEntity = tombstoneEntities[entity];
  const deletionFilter = { entity: tombstoneEntity, ...cursorQuery(composite.deletions) };
  if (entity === 'employees') {
    deletionFilter.companies = req.desktopHost.empresa;
  }
  const deletionDocuments = await PdvDesktopSyncTombstone.find(deletionFilter)
    .sort({ updatedAt: 1, _id: 1 }).select('entityId ownerId updatedAt').limit(limit + 1).lean();
  const hasMoreDeletions = deletionDocuments.length > limit;
  const deletionPage = hasMoreDeletions ? deletionDocuments.slice(0, limit) : deletionDocuments;
  const upserts = await loaded.map(upsertPage);
  const nextState = {
    upserts: cursorFor(upsertPage[upsertPage.length - 1], composite.upserts && { id: String(composite.upserts.id), updatedAt: composite.upserts.updatedAt.toISOString() }),
    deletions: cursorFor(deletionPage[deletionPage.length - 1], composite.deletions && { id: String(composite.deletions.id), updatedAt: composite.deletions.updatedAt.toISOString() }),
  };
  return res.json({
    entity, upserts, deletedIds: deletionPage.map((entry) => String(entry.entityId)),
    nextCursor: encodeCursor(nextState), hasMore: hasMoreUpserts || hasMoreDeletions,
  });
});

router.get('/appointments', async (req, res) => {
    if (typeof mapAppointmentOccurrences !== 'function') {
      return res.status(503).json({ message: 'Sincronização da agenda ainda não foi inicializada.' });
    }
    const cursor = decodeCursor(req.query.cursor);
    if (req.query.cursor && !cursor) return res.status(400).json({ message: 'Cursor da agenda inválido.' });
    const start = new Date(req.query.start || Date.now() - 30 * 86400000);
    const end = new Date(req.query.end || Date.now() + 180 * 86400000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start || end.getTime() - start.getTime() > 370 * 86400000) {
      return res.status(400).json({ message: 'Período da agenda inválido.' });
    }
    const limit = pageLimit(req, 250);
    const startDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(start);
    const endDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(end.getTime() - 1));
    const base = cursor
      // Depois do primeiro cursor, qualquer alteração precisa chegar, inclusive
      // exclusões e itens que saíram da janela local.
      ? { store: req.desktopHost.empresa, ...cursorQuery(cursor) }
      // Na carga inicial, exclusões antigas fora da janela não têm utilidade e
      // só aumentavam o snapshot.
      : {
          store: req.desktopHost.empresa,
          $or: [
            { scheduledAt: { $gte: start, $lt: end } },
            { 'itens.data': { $gte: startDate, $lte: endDate } },
          ],
        };
    const documents = await Appointment.find(base).setOptions({ includeDeleted: true })
      .sort({ updatedAt: 1, _id: 1 }).limit(limit + 1)
      .populate('cliente', 'nomeCompleto nomeContato razaoSocial email cpf cnpj celular telefone')
      .populate('pet', 'nome codigoPet').populate('profissional', 'nomeCompleto nomeContato razaoSocial email')
      .populate('itens.servico', 'nome valor duracaoMinutos').populate('itens.profissional', 'nomeCompleto nomeContato razaoSocial email')
      .populate('clinicalProducts.product', 'nome cod codbarras venda').lean();
    const hasMore = documents.length > limit;
    const page = hasMore ? documents.slice(0, limit) : documents;
    const upserts = [];
    const deletedSourceIds = [];
    page.forEach((appointment) => {
      const sourceId = String(appointment._id);
      if (appointment.deletedAt) { deletedSourceIds.push(sourceId); return; }
      const occurrences = mapAppointmentOccurrences(appointment, start, end);
      if (occurrences.length) upserts.push(...occurrences);
      else deletedSourceIds.push(sourceId);
    });
    const next = cursorFor(page[page.length - 1], cursor && { id: String(cursor.id), updatedAt: cursor.updatedAt.toISOString() });
    return res.json({ appointments: upserts, deletedSourceIds, nextCursor: next ? encodeCursor(next) : '', hasMore });
});

router.get('/deliveries', async (req, res) => {
  const cursor = decodeCursor(req.query.cursor);
  if (req.query.cursor && !cursor) return res.status(400).json({ message: 'Cursor de deliveries inválido.' });
  const limit = pageLimit(req);
  const documents = await PdvStateDeliveryOrder.find({ pdv: req.desktopHost.pdv, ...cursorQuery(cursor) })
    .sort({ updatedAt: 1, _id: 1 }).select('deliveryId payload updatedAt').limit(limit + 1).lean();
  const hasMore = documents.length > limit;
  const rawPage = hasMore ? documents.slice(0, limit) : documents;
  const canonicalByIdentity = new Map();
  rawPage.forEach((entry) => {
    const saleCode = String(entry?.payload?.saleCode || '').trim();
    const identity = saleCode ? `sale:${saleCode}` : `id:${entry.deliveryId}`;
    canonicalByIdentity.set(identity, entry);
  });
  const page = [...canonicalByIdentity.values()];
  // O cursor acompanha a página bruta, inclusive quando algum legado duplicado
  // foi ignorado. Assim o cliente nunca solicita a mesma página novamente.
  const next = cursorFor(rawPage[rawPage.length - 1], cursor && { id: String(cursor.id), updatedAt: cursor.updatedAt.toISOString() });
  const ignoredDuplicates = rawPage.length - page.length;
  return res.json({
    deliveries: page.map((entry) => ({ ...(entry.payload || {}), cloudUpdatedAt: entry.updatedAt })),
    nextCursor: next ? encodeCursor(next) : '', hasMore, ignoredDuplicates,
  });
});

router.get('/transfers', async (req, res) => {
  const cursor = decodeCursor(req.query.cursor);
  if (req.query.cursor && !cursor) return res.status(400).json({ message: 'Cursor de transferências inválido.' });
  const limit = pageLimit(req);
  const documents = await Transfer.find({
    $and: [
      { $or: [{ originCompany: req.desktopHost.empresa }, { destinationCompany: req.desktopHost.empresa }] },
      cursorQuery(cursor),
    ],
  }).sort({ updatedAt: 1, _id: 1 }).limit(limit + 1)
    .populate('originCompany', 'nome nomeFantasia').populate('destinationCompany', 'nome nomeFantasia')
    .populate('originDeposit', 'nome codigo').populate('destinationDeposit', 'nome codigo')
    .populate('responsible', 'nomeCompleto nomeContato razaoSocial email').lean();
  const hasMore = documents.length > limit;
  const page = hasMore ? documents.slice(0, limit) : documents;
  const next = cursorFor(page[page.length - 1], cursor && { id: String(cursor.id), updatedAt: cursor.updatedAt.toISOString() });
  return res.json({ transfers: page.map(transferForDesktop), nextCursor: next ? encodeCursor(next) : '', hasMore });
});

module.exports = function createDesktopSyncV2Router({ appointmentOccurrencesForDesktop }) {
  mapAppointmentOccurrences = appointmentOccurrencesForDesktop;
  return router;
};
