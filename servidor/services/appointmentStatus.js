const VALID_STATUSES = new Set(['agendado', 'em_espera', 'em_atendimento', 'finalizado']);

function normalizeAppointmentStatus(value, fallback = 'agendado') {
  const status = String(value || '').trim().toLowerCase();
  return VALID_STATUSES.has(status) ? status : fallback;
}

function deriveAppointmentStatus(appointment = {}) {
  const parentStatus = normalizeAppointmentStatus(appointment.status);
  const itemStatuses = (Array.isArray(appointment.itens) ? appointment.itens : [])
    .map((item) => normalizeAppointmentStatus(item?.status, ''))
    .filter(Boolean);
  if (!itemStatuses.length) return parentStatus;
  if (itemStatuses.every((status) => status === 'finalizado')) return 'finalizado';
  if (itemStatuses.every((status) => status === 'agendado')) return 'agendado';
  if (itemStatuses.includes('em_atendimento')) return 'em_atendimento';
  if (itemStatuses.includes('em_espera')) return 'em_espera';
  if (itemStatuses.includes('finalizado')) return 'em_atendimento';
  return parentStatus;
}

module.exports = { deriveAppointmentStatus, normalizeAppointmentStatus };
