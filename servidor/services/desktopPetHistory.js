const mongoose = require('mongoose');
const Appointment = require('../models/Appointment');
const Pet = require('../models/Pet');

// A history row is one completed service, not one appointment. The network
// shares its customer/pet directory; this read-only history spans all stores.
function historyPipeline(petIds, { perPet = false, offset = 0, limit = 50 } = {}) {
  const pipeline = [
    { $match: { pet: { $in: petIds }, deletedAt: null } },
    { $project: { pet: 1, cliente: 1, store: 1, profissional: 1, scheduledAt: 1, pago: 1, codigoVenda: 1, status: 1,
      itens: { $cond: [{ $gt: [{ $size: { $ifNull: ['$itens', []] } }, 0] }, '$itens', [{ servico: '$servico', valor: '$valor', status: '$status' }]] } } },
    { $unwind: { path: '$itens', includeArrayIndex: 'serviceIndex' } },
    { $match: { $expr: { $eq: [{ $ifNull: ['$itens.status', '$status'] }, 'finalizado'] } } },
    { $set: { historyDate: { $convert: { input: { $concat: ['$itens.data', 'T', { $ifNull: ['$itens.hora', '00:00'] }, ':00-03:00'] }, to: 'date', onError: '$scheduledAt', onNull: '$scheduledAt' } } } },
    { $sort: { historyDate: -1, _id: -1, serviceIndex: -1 } },
  ];
  if (perPet) pipeline.push(
    { $group: { _id: '$pet', rows: { $push: '$$ROOT' } } },
    { $project: { rows: { $slice: ['$rows', 4] } } },
    { $unwind: '$rows' }, { $replaceRoot: { newRoot: '$rows' } },
  );
  else pipeline.push({ $skip: offset }, { $limit: limit + 1 });
  return pipeline;
}

async function readHistory(petIds, options) {
  const rows = await Appointment.aggregate(historyPipeline(petIds, options)).allowDiskUse(true);
  await Appointment.populate(rows, [
    { path: 'itens.servico', select: 'nome valor' },
    { path: 'itens.profissional', select: 'nomeCompleto nomeContato razaoSocial' },
    { path: 'profissional', select: 'nomeCompleto nomeContato razaoSocial' },
    { path: 'store', select: 'nomeFantasia nome' },
  ]);
  return rows.map(row => {
    const item = row.itens;
    const professional = item.profissional || row.profissional;
    return {
      id: `${row._id}:${item._id || row.serviceIndex}`,
      appointmentId: String(row._id), petId: String(row.pet), customerId: String(row.cliente),
      date: row.historyDate, name: item.servico?.nome || 'Serviço não informado',
      professional: professional?.nomeCompleto || professional?.nomeContato || professional?.razaoSocial || 'Sem preferência',
      storeId: String(row.store?._id || row.store || ''), storeName: row.store?.nomeFantasia || row.store?.nome || '',
      value: Number(item.valor ?? item.servico?.valor ?? 0), status: 'finalizado', paid: Boolean(row.pago || row.codigoVenda),
    };
  });
}

function registerPetHistory(router, authenticateHost) {
  router.get('/pet-history/snapshot', authenticateHost, async (req, res, next) => {
    try {
      const after = String(req.query.after || '');
      if (after && !mongoose.isValidObjectId(after)) return res.status(400).json({ message: 'Cursor de pets inválido.' });
      const since = req.query.since ? new Date(req.query.since) : null;
      if (since && !Number.isFinite(since.getTime())) return res.status(400).json({ message: 'Data de sincronização inválida.' });
      let filter = after ? { _id: { $gt: after } } : {};
      let changedIds = null;
      if (since) {
        // Include deleted appointments so removals also refresh the offline four.
        const changed = await Appointment.aggregate([
          { $match: { updatedAt: { $gte: since }, pet: { $type: 'objectId', ...(after ? { $gt: new mongoose.Types.ObjectId(after) } : {}) } } },
          { $group: { _id: '$pet' } }, { $sort: { _id: 1 } }, { $limit: 51 },
        ]);
        changedIds = changed.map(row => row._id);
        filter = { _id: { $in: changedIds.slice(0, 50) } };
      }
      const pets = await Pet.find(filter).select('_id owner').sort({ _id: 1 }).limit(51).lean();
      const page = pets.slice(0, 50);
      const services = page.length ? await readHistory(page.map(pet => pet._id), { perPet: true }) : [];
      const cursorIds = changedIds || pets.map(pet => pet._id);
      return res.json({ pets: page.map(pet => ({ petId: String(pet._id), customerId: String(pet.owner), services: services.filter(row => row.petId === String(pet._id)) })), hasMore: cursorIds.length > 50, nextCursor: cursorIds.length ? String(cursorIds[Math.min(50, cursorIds.length) - 1]) : '' });
    } catch (error) { next(error); }
  });
  router.get('/pet-history', authenticateHost, async (req, res, next) => {
    try {
      const { petId, customerId } = req.query;
      if (!mongoose.isValidObjectId(petId) || !mongoose.isValidObjectId(customerId)) return res.status(400).json({ message: 'Cliente ou pet inválido.' });
      const pet = await Pet.findOne({ _id: petId, owner: customerId }).select('_id').lean();
      if (!pet) return res.status(404).json({ message: 'Pet não encontrado para este cliente.' });
      const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
      if (!Number.isSafeInteger(offset)) return res.status(400).json({ message: 'Página inválida.' });
      const rows = await readHistory([pet._id], { offset, limit: 50 });
      return res.json({ services: rows.slice(0, 50), hasMore: rows.length > 50, nextOffset: offset + 50, allStores: true });
    } catch (error) { next(error); }
  });
}

module.exports = { registerPetHistory, historyPipeline, readHistory };
