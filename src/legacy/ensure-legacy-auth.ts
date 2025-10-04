const TOKEN_PREFIX_PATTERN = /^bearer\s+/i;

type UnknownRecord = Record<string, unknown>;

function safeParseJson(value: string | null | undefined): UnknownRecord | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as UnknownRecord) : null;
  } catch (error) {
    console.warn("Não foi possível interpretar dados de sessão legada:", error);
    return null;
  }
}

function normalizeToken(token: string | null | undefined): string {
  if (!token || typeof token !== "string") {
    return "";
  }
  const trimmed = token.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(TOKEN_PREFIX_PATTERN, "");
}

function extractTokenFromRecord(record: UnknownRecord | null, depth = 0): string {
  if (!record || depth > 3) {
    return "";
  }
  const directCandidates = [
    record.token,
    record.authToken,
    record.accessToken,
    record.jwt,
    record.sessionToken
  ];
  for (const candidate of directCandidates) {
    const normalized = normalizeToken(typeof candidate === "string" ? candidate : "");
    if (normalized) {
      return normalized;
    }
  }

  const nestedCandidates = [
    record.user,
    record.usuario,
    record.session,
    record.auth,
    record.data,
    record.payload
  ];

  for (const nested of nestedCandidates) {
    if (nested && typeof nested === "object") {
      const nestedToken = extractTokenFromRecord(nested as UnknownRecord, depth + 1);
      if (nestedToken) {
        return nestedToken;
      }
    }
  }

  return "";
}

function readCookieToken(): string {
  if (typeof document === "undefined") {
    return "";
  }
  try {
    const cookieSource = document.cookie || "";
    if (!cookieSource) {
      return "";
    }
    const pairs = cookieSource.split(";");
    for (const pair of pairs) {
      const [rawName, rawValue] = pair.split("=");
      const name = rawName?.trim().toLowerCase();
      if (!name || !rawValue) {
        continue;
      }
      if (["auth_token", "token", "jwt"].includes(name)) {
        const decoded = decodeURIComponent(rawValue.trim());
        const normalized = normalizeToken(decoded);
        if (normalized) {
          return normalized;
        }
      }
    }
  } catch (error) {
    console.warn("Não foi possível ler cookies para sincronizar sessão legada:", error);
  }
  return "";
}

function mergeUserRecords(...records: Array<UnknownRecord | null | undefined>): UnknownRecord {
  const result: UnknownRecord = {};
  for (const record of records) {
    if (!record || typeof record !== "object") {
      continue;
    }
    for (const [key, value] of Object.entries(record)) {
      if (value === undefined) {
        continue;
      }
      if (!(key in result)) {
        result[key] = value;
      }
    }
  }
  return result;
}

function ensureUserId(record: UnknownRecord): void {
  if (typeof record.id === "string" && record.id.trim()) {
    return;
  }
  const candidates = [record._id, record.usuarioId, record.userId, record.usuario?._id, record.user?._id];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      record.id = candidate.trim();
      return;
    }
  }
}

export function ensureLegacyAuthSession(): void {
  if (typeof window === "undefined") {
    return;
  }

  let localStorageRef: Storage | null = null;
  let sessionStorageRef: Storage | null = null;

  try {
    localStorageRef = window.localStorage;
  } catch (error) {
    console.warn("localStorage indisponível para sessão legada:", error);
  }

  try {
    sessionStorageRef = window.sessionStorage;
  } catch (error) {
    console.warn("sessionStorage indisponível para sessão legada:", error);
  }

  if (!localStorageRef) {
    return;
  }

  const storedLegacy = safeParseJson(localStorageRef.getItem("loggedInUser"));
  const storedToken = extractTokenFromRecord(storedLegacy);
  if (storedToken) {
    const normalized = normalizeToken(storedToken);
    if (storedLegacy && storedLegacy.token !== normalized) {
      const merged = { ...storedLegacy, token: normalized };
      localStorageRef.setItem("loggedInUser", JSON.stringify(merged));
    }
    return;
  }

  const fallbackRecords: UnknownRecord[] = [];
  const maybeUserRecord = safeParseJson(localStorageRef.getItem("user"));
  if (maybeUserRecord) {
    fallbackRecords.push(maybeUserRecord);
  }
  const sessionLogged = safeParseJson(sessionStorageRef?.getItem("loggedInUser"));
  if (sessionLogged) {
    fallbackRecords.push(sessionLogged);
  }
  const sessionUser = safeParseJson(sessionStorageRef?.getItem("user"));
  if (sessionUser) {
    fallbackRecords.push(sessionUser);
  }

  let token = "";
  let source: UnknownRecord | null = null;
  for (const record of fallbackRecords) {
    const candidate = extractTokenFromRecord(record);
    if (candidate) {
      token = candidate;
      source = record;
      break;
    }
  }

  if (!token) {
    const authToken = localStorageRef.getItem("auth_token");
    token = normalizeToken(authToken);
  }

  if (!token) {
    token = readCookieToken();
  }

  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) {
    return;
  }

  const mergedRecord = mergeUserRecords(storedLegacy ?? undefined, source ?? undefined);
  mergedRecord.token = normalizedToken;
  ensureUserId(mergedRecord);

  try {
    localStorageRef.setItem("loggedInUser", JSON.stringify(mergedRecord));
  } catch (error) {
    console.warn("Não foi possível persistir sessão legada normalizada:", error);
  }
}
