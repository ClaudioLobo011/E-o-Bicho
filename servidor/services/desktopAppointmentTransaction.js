const mongoose = require('mongoose');
const Event = require('../models/PdvDesktopEvent');

// The domain mutation and its receipt must commit together. A lost response or
// a process restart must replay the receipt, never apply the same edit twice.
async function processAppointmentEvent(event, host, materialize) {
  return mongoose.connection.transaction(async session => {
    let record = await Event.findOne({ pdv: host.pdv, eventId: event.eventId }).session(session);
    const replayed = Boolean(record);
    if (record?.status === 'processed') return { eventId: event.eventId, accepted: true, replayed, status: 'processed' };
    if (!record) record = new Event({ pdv: host.pdv, empresa: host.empresa, host: host._id, eventId: event.eventId });
    record.type = event.type;
    record.payload = event.payload || {};
    record.occurredAt = new Date(event.occurredAt);
    // Lock the idempotency key before mutating the appointment. Concurrent
    // deliveries serialize through this document/unique key and transaction.
    await record.save({ session });
    await materialize(record, host, session);
    record.status = 'processed'; record.error = '';
    await record.save({ session });
    return { eventId: event.eventId, accepted: true, replayed, status: 'processed' };
  });
}
module.exports = { processAppointmentEvent };
