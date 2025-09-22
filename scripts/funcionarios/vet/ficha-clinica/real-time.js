// Real-time synchronization helpers for the Vet ficha clínica
import { state, normalizeId, getCurrentUserId } from './core.js';

let socket = null;
let socketPromise = null;
let scriptPromise = null;
let targetRoomKey = null;
let targetSelection = null;
let currentRoomKey = null;
const updateHandlers = new Set();

function getServerBaseUrl() {
  let base = '';
  try {
    if (typeof API_CONFIG !== 'undefined' && API_CONFIG && typeof API_CONFIG.SERVER_URL === 'string') {
      base = API_CONFIG.SERVER_URL;
    }
  } catch (_) {
    // ignore reference errors when API_CONFIG is not defined
  }

  if (!base && typeof window !== 'undefined') {
    const cfg = window.API_CONFIG;
    if (cfg && typeof cfg.SERVER_URL === 'string') {
      base = cfg.SERVER_URL;
    }
  }

  if (!base && typeof window !== 'undefined' && window.location) {
    base = window.location.origin;
  }

  if (!base) return '';
  return String(base).replace(/\/+$/, '');
}

function ensureSocketIoScript() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (typeof window.io === 'function') return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  const baseUrl = getServerBaseUrl() || '';
  const src = baseUrl ? `${baseUrl}/socket.io/socket.io.js` : '/socket.io/socket.io.js';

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve();
    script.onerror = (event) => {
      console.error('Não foi possível carregar o cliente Socket.IO.', event);
      scriptPromise = null;
      reject(new Error('socket.io-load-failed'));
    };
    document.head.appendChild(script);
  });

  return scriptPromise;
}

function computeRoomKey(clienteId, petId, appointmentId) {
  const tutor = normalizeId(clienteId);
  const pet = normalizeId(petId);
  if (!(tutor && pet)) return '';
  const appointment = normalizeId(appointmentId);
  if (appointment) {
    return `vet:ficha:${tutor}:${pet}:appt:${appointment}`;
  }
  return `vet:ficha:${tutor}:${pet}`;
}

function getSelectionSnapshot() {
  const clienteId = normalizeId(state.selectedCliente?._id);
  const petId = normalizeId(state.selectedPetId);
  if (!(clienteId && petId)) return null;
  const appointmentId = normalizeId(state.agendaContext?.appointmentId);
  return {
    clienteId,
    petId,
    appointmentId,
    roomKey: computeRoomKey(clienteId, petId, appointmentId),
  };
}

function cloneEventPayload(event) {
  if (!event || typeof event !== 'object') return {};
  try {
    return JSON.parse(JSON.stringify(event));
  } catch {
    if (Array.isArray(event)) {
      return event.map((item) => (item && typeof item === 'object' ? cloneEventPayload(item) : item));
    }
    const result = {};
    Object.keys(event).forEach((key) => {
      const value = event[key];
      if (value && typeof value === 'object') {
        result[key] = cloneEventPayload(value);
      } else {
        result[key] = value;
      }
    });
    return result;
  }
}

function setupSocketListeners() {
  if (!socket) return;

  socket.on('connect', () => {
    currentRoomKey = null;
    syncRoomWithServer();
  });

  socket.on('reconnect', () => {
    currentRoomKey = null;
    syncRoomWithServer();
  });

  socket.on('vet:ficha:update', (message) => {
    if (!message || typeof message !== 'object') return;

    const localSelection = getSelectionSnapshot();
    if (!localSelection) return;

    const remoteSelection = (() => {
      const rawSelection = message.selection || {};
      const clienteId = normalizeId(
        rawSelection.clienteId
          || rawSelection.tutorId
          || rawSelection.cliente
          || rawSelection.tutor,
      );
      const petId = normalizeId(rawSelection.petId || rawSelection.pet);
      if (!(clienteId && petId)) return null;
      const appointmentId = normalizeId(
        rawSelection.appointmentId
          || rawSelection.appointment
          || rawSelection.agendamentoId,
      );
      return { clienteId, petId, appointmentId };
    })();

    if (!remoteSelection) return;

    if (remoteSelection.clienteId !== localSelection.clienteId) return;
    if (remoteSelection.petId !== localSelection.petId) return;

    const localAppointment = normalizeId(localSelection.appointmentId);
    const remoteAppointment = normalizeId(remoteSelection.appointmentId);
    if (localAppointment && remoteAppointment && localAppointment !== remoteAppointment) {
      return;
    }

    updateHandlers.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error('Erro ao processar atualização em tempo real da ficha clínica.', error);
      }
    });
  });
}

function syncRoomWithServer() {
  if (!socket || !socket.connected) return;

  if (currentRoomKey && currentRoomKey !== targetRoomKey) {
    socket.emit('vet:ficha:leave', { room: currentRoomKey });
    currentRoomKey = null;
  }

  if (targetRoomKey && currentRoomKey !== targetRoomKey) {
    socket.emit('vet:ficha:join', {
      room: targetRoomKey,
      selection: targetSelection,
      userId: getCurrentUserId() || null,
      timestamp: Date.now(),
    });
    currentRoomKey = targetRoomKey;
  }

  if (!targetRoomKey && currentRoomKey) {
    socket.emit('vet:ficha:leave', { room: currentRoomKey });
    currentRoomKey = null;
  }
}

async function ensureSocket() {
  if (socket) return socket;

  if (!socketPromise) {
    socketPromise = ensureSocketIoScript()
      .then(() => {
        if (typeof window === 'undefined' || typeof window.io !== 'function') {
          throw new Error('Socket.IO client indisponível.');
        }
        const baseUrl = getServerBaseUrl();
        socket = window.io(baseUrl || undefined, {
          transports: ['websocket', 'polling'],
          autoConnect: true,
          reconnection: true,
        });
        setupSocketListeners();
        return socket;
      })
      .catch((error) => {
        console.error('Falha ao inicializar a conexão em tempo real da ficha clínica.', error);
        socketPromise = null;
        socket = null;
        return null;
      });
  }

  return socketPromise;
}

export async function initFichaRealTime() {
  await ensureSocket();
  if (socket && socket.connected) {
    syncRoomWithServer();
  }
}

export function registerFichaUpdateHandler(handler) {
  if (typeof handler === 'function') {
    updateHandlers.add(handler);
  }
}

export function unregisterFichaUpdateHandler(handler) {
  if (typeof handler === 'function') {
    updateHandlers.delete(handler);
  }
}

export async function updateFichaRealTimeSelection() {
  const selection = getSelectionSnapshot();
  if (!selection || !selection.roomKey) {
    targetRoomKey = null;
    targetSelection = null;
  } else {
    targetRoomKey = selection.roomKey;
    targetSelection = {
      clienteId: selection.clienteId,
      petId: selection.petId,
      appointmentId: selection.appointmentId || null,
    };
  }

  await ensureSocket();
  syncRoomWithServer();
}

export async function emitFichaClinicaUpdate(event = {}) {
  await ensureSocket();
  if (!socket || !targetRoomKey) return;
  const selection = getSelectionSnapshot();
  if (!selection || selection.roomKey !== targetRoomKey) return;

  socket.emit('vet:ficha:update', {
    room: targetRoomKey,
    selection: targetSelection || {
      clienteId: selection.clienteId,
      petId: selection.petId,
      appointmentId: selection.appointmentId || null,
    },
    event: cloneEventPayload(event),
    userId: getCurrentUserId() || null,
    timestamp: Date.now(),
  });
}

