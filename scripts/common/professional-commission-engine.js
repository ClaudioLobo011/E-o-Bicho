/* Shared by the API, browser preview and store-service. No I/O or system-clock rules. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProfessionalCommissionEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const id = (value) => String(value?._id || value?.id || value || '');
  const numeric = (value) => {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    const number = Number(String(value).replace(',', '.'));
    return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
  };
  const dateKey = (value) => {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const date = new Date(`${value}T12:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const buildProfessionalCommissionContext = (config) => config || {};
  function versionForDate(config, day) {
    if (!config?.effectiveFrom && !config?.history?.length) return config || {};
    const versions = [...(config.history || []), config].filter((v) => !v.effectiveFrom || (day && v.effectiveFrom <= day));
    // A later correction supersedes older revisions from its effective date onward.
    // Keeping superseded revisions still allows reconstructing dates before that correction.
    versions.sort((a, b) => Number(a.revision || 0) - Number(b.revision || 0) || String(a.effectiveFrom || '').localeCompare(String(b.effectiveFrom || '')));
    return versions.at(-1) || {};
  }
  const findPercent = (rules, key, reference) => {
    const rule = (rules || []).find((r) => id(r[key] || r[`${key}Id`]) === id(reference));
    return reference ? numeric(rule?.percent) : null;
  };
  function resolveServiceCommission(options = {}) {
    const { professionalCommission, serviceId, groupId, servicePercent, groupPercent, itemPercent, fallbackPercent = 0 } = options;
    const day = dateKey(options.serviceDate);
    const config = versionForDate(professionalCommission || {}, day);
    const weekday = day ? new Date(`${day}T12:00:00Z`).getUTCDay() : null;
    const weekly = (config.weekdayRules || []).find((rule) => rule.enabled !== false && day && (rule.weekdays || []).includes(weekday));
    const candidates = [];
    if (weekly) candidates.push(
      [findPercent(weekly.serviceRules, 'service', serviceId), 'weekday_service', 'Serviço específico do dia'],
      [findPercent(weekly.groupRules, 'group', groupId), 'weekday_group', 'Grupo de serviço do dia'],
      [numeric(weekly.defaultPercent), 'weekday_default', 'Padrão do dia'],
    );
    candidates.push(
      [findPercent(config.serviceRules, 'service', serviceId), 'professional_service', 'Serviço do profissional'],
      [findPercent(config.groupRules, 'group', groupId), 'professional_group', 'Grupo do profissional'],
      [numeric(servicePercent), 'service', 'Cadastro do serviço'],
      [numeric(groupPercent), 'group', 'Cadastro do grupo'],
      [numeric(itemPercent), 'item', 'Percentual do item'],
      [numeric(fallbackPercent) ?? 0, 'fallback', 'Padrão do profissional'],
    );
    const [percent, source, label] = candidates.find(([value]) => value !== null);
    return { percent, source, label, serviceDate: day, weekday, ruleId: source.startsWith('weekday_') ? weekly.id || '' : '', revision: Number(config.revision || 0), effectiveFrom: config.effectiveFrom || '' };
  }
  const resolveServiceCommissionPercent = (options) => resolveServiceCommission(options).percent;
  const commissionAmount = (value, percent) => Math.round((Number(value) * Number(percent) / 100 + Number.EPSILON) * 100) / 100;
  return { dateKey, versionForDate, numeric, buildProfessionalCommissionContext, resolveServiceCommission, resolveServiceCommissionPercent, commissionAmount };
});
