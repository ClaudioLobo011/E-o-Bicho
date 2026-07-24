const WEEKDAY_KEYS = Object.freeze({
  sun: 'domingo',
  mon: 'segunda',
  tue: 'terca',
  wed: 'quarta',
  thu: 'quinta',
  fri: 'sexta',
  sat: 'sabado',
});

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeTimezone = (value) => {
  const timezone = clean(value) || 'America/Sao_Paulo';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch (_) {
    return 'America/Sao_Paulo';
  }
};

const parseMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clean(value));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return (hours * 60) + minutes;
};

const zonedParts = (date, timezone) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    weekday: WEEKDAY_KEYS[String(parts.weekday || '').toLowerCase()] || '',
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour) * 60) + Number(parts.minute),
  };
};

const hasConfiguredSchedule = (schedule = {}) => Object.values(schedule || {}).some((day) => {
  if (!day || typeof day !== 'object') return false;
  return Boolean(day.fechada || clean(day.abre) || clean(day.fecha));
});

const isOpenForRange = ({ currentMinutes, open, close }) => {
  const openMinutes = parseMinutes(open);
  const closeMinutes = parseMinutes(close);
  if (openMinutes === null || closeMinutes === null) return false;
  if (openMinutes === closeMinutes) return true;
  if (closeMinutes > openMinutes) {
    return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  }
  return currentMinutes >= openMinutes || currentMinutes < closeMinutes;
};

const getPreviousWeekday = (weekday) => {
  const order = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const index = order.indexOf(weekday);
  return index < 0 ? '' : order[(index + 6) % 7];
};

const resolveOperatingHours = ({
  store,
  config,
  at = new Date(),
} = {}) => {
  const timezone = normalizeTimezone(config?.timezone);
  const parts = zonedParts(at, timezone);
  const schedule = store?.horario || {};
  const special = Array.isArray(config?.specialHours)
    ? config.specialHours.find((entry) => clean(entry?.date) === parts.dateKey)
    : null;

  if (special) {
    const isOpen = !special.closed && isOpenForRange({
      currentMinutes: parts.minutes,
      open: special.open,
      close: special.close,
    });
    return {
      isOpen,
      timezone,
      date: parts.dateKey,
      weekday: parts.weekday,
      source: 'special',
      open: clean(special.open),
      close: clean(special.close),
      label: clean(special.label),
      scheduleConfigured: true,
    };
  }

  if (!hasConfiguredSchedule(schedule)) {
    return {
      isOpen: true,
      timezone,
      date: parts.dateKey,
      weekday: parts.weekday,
      source: 'unconfigured',
      open: '',
      close: '',
      label: 'Horário da loja ainda não configurado',
      scheduleConfigured: false,
    };
  }

  const today = schedule[parts.weekday] || {};
  let isOpen = !today.fechada && isOpenForRange({
    currentMinutes: parts.minutes,
    open: today.abre,
    close: today.fecha,
  });

  // Considera o trecho após a meia-noite de um expediente iniciado no dia anterior.
  if (!isOpen) {
    const previous = schedule[getPreviousWeekday(parts.weekday)] || {};
    const previousOpen = parseMinutes(previous.abre);
    const previousClose = parseMinutes(previous.fecha);
    if (
      !previous.fechada
      && previousOpen !== null
      && previousClose !== null
      && previousClose < previousOpen
      && parts.minutes < previousClose
    ) {
      isOpen = true;
    }
  }

  return {
    isOpen,
    timezone,
    date: parts.dateKey,
    weekday: parts.weekday,
    source: 'store',
    open: clean(today.abre),
    close: clean(today.fecha),
    label: today.fechada ? 'Loja fechada neste dia' : '',
    scheduleConfigured: true,
  };
};

module.exports = {
  normalizeTimezone,
  parseMinutes,
  resolveOperatingHours,
};
