const TOKEN_PREFIX_PATTERN = /^bearer\s+/i;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeParseJsonValue(value: string | null | undefined): unknown {
  if (!value || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    console.warn("Não foi possível interpretar dados legados como JSON:", error);
    return null;
  }
}

function safeParseJson(value: string | null | undefined): UnknownRecord | null {
  const parsed = safeParseJsonValue(value);
  return isRecord(parsed) ? parsed : null;
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

function extractTokenFromUnknown(value: unknown, depth = 0): string {
  if (!value || depth > 5) {
    return "";
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    const startsWithQuote = trimmed.startsWith("\"") || trimmed.startsWith("'");
    const endsWithQuote = trimmed.endsWith("\"") || trimmed.endsWith("'");
    if (startsWithQuote && endsWithQuote && trimmed.length > 1) {
      return extractTokenFromUnknown(trimmed.slice(1, -1), depth + 1);
    }

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const parsed = safeParseJsonValue(trimmed);
      if (parsed !== null && parsed !== undefined) {
        const nested = extractTokenFromUnknown(parsed, depth + 1);
        if (nested) {
          return nested;
        }
      }
    }

    return normalizeToken(trimmed);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = extractTokenFromUnknown(entry, depth + 1);
      if (nested) {
        return nested;
      }
    }
    return "";
  }

  if (!isRecord(value)) {
    return "";
  }

  const directCandidates = [
    value.token,
    value.authToken,
    value.accessToken,
    value.access_token,
    value.jwt,
    value.sessionToken,
    value.session_token
  ];
  for (const candidate of directCandidates) {
    const nested = extractTokenFromUnknown(candidate, depth + 1);
    if (nested) {
      return nested;
    }
  }

  const nestedCandidates = [
    value.user,
    value.usuario,
    value.session,
    value.auth,
    value.data,
    value.payload,
    value.perfil,
    value.profile
  ];

  for (const nested of nestedCandidates) {
    const nestedToken = extractTokenFromUnknown(nested, depth + 1);
    if (nestedToken) {
      return nestedToken;
    }
  }

  for (const entry of Object.values(value)) {
    const nested = extractTokenFromUnknown(entry, depth + 1);
    if (nested) {
      return nested;
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
  const candidateRecords: UnknownRecord[] = [];
  if (storedLegacy) {
    candidateRecords.push(storedLegacy);
  }

  const storageRecordKeys = ["user", "authToken", "perfil", "session", "sessionUser", "session_user"];
  for (const key of storageRecordKeys) {
    const localRecord = safeParseJson(localStorageRef.getItem(key));
    if (localRecord) {
      candidateRecords.push(localRecord);
    }
    const sessionRecord = safeParseJson(sessionStorageRef?.getItem(key));
    if (sessionRecord) {
      candidateRecords.push(sessionRecord);
    }
  }

  let normalizedToken = "";
  let tokenSource: UnknownRecord | null = null;

  for (const record of candidateRecords) {
    const candidate = extractTokenFromUnknown(record);
    if (candidate) {
      normalizedToken = normalizeToken(candidate);
      if (normalizedToken) {
        tokenSource = record;
        break;
      }
    }
  }

  if (!normalizedToken) {
    const directValueKeys = [
      "auth_token",
      "token",
      "jwt",
      "pdv_token",
      "access_token",
      "session_token",
      "authToken"
    ];
    for (const key of directValueKeys) {
      const directValues = [
        localStorageRef.getItem(key),
        sessionStorageRef?.getItem(key)
      ];
      for (const value of directValues) {
        const candidate = extractTokenFromUnknown(value);
        if (candidate) {
          normalizedToken = normalizeToken(candidate);
          if (normalizedToken) {
            break;
          }
        }
      }
      if (normalizedToken) {
        break;
      }
    }
  }

  if (!normalizedToken) {
    normalizedToken = readCookieToken();
  }

  if (!normalizedToken) {
    return;
  }

  const mergedRecord = mergeUserRecords(storedLegacy ?? undefined, tokenSource ?? undefined, ...candidateRecords);
  mergedRecord.token = normalizedToken;
  ensureUserId(mergedRecord);

  const persistSafely = (storage: Storage | null, key: string, value: string) => {
    if (!storage) {
      return;
    }
    try {
      if (storage.getItem(key) !== value) {
        storage.setItem(key, value);
      }
    } catch (error) {
      console.warn(`Não foi possível atualizar a chave "${key}" no storage legado:`, error);
    }
  };

  const stringifiedLogged = JSON.stringify(mergedRecord);
  persistSafely(localStorageRef, "loggedInUser", stringifiedLogged);

  const userCandidates: Array<UnknownRecord | null | undefined> = [
    mergedRecord.user as UnknownRecord,
    mergedRecord.usuario as UnknownRecord,
    tokenSource?.user as UnknownRecord,
    tokenSource?.usuario as UnknownRecord
  ];
  let userPayload: UnknownRecord | null = null;
  for (const candidate of userCandidates) {
    if (isRecord(candidate)) {
      userPayload = candidate;
      break;
    }
  }
  if (!userPayload) {
    const fallbackUser: UnknownRecord = { ...mergedRecord };
    delete fallbackUser.token;
    if (Object.keys(fallbackUser).length > 0) {
      userPayload = fallbackUser;
    }
  }

  if (userPayload) {
    persistSafely(localStorageRef, "user", JSON.stringify(userPayload));
  }

  persistSafely(localStorageRef, "auth_token", normalizedToken);
  persistSafely(localStorageRef, "token", normalizedToken);

  if (userPayload) {
    const authTokenPayload: UnknownRecord = {
      token: normalizedToken,
      user: userPayload
    };
    if (isRecord(mergedRecord.perfil)) {
      authTokenPayload.perfil = mergedRecord.perfil;
    } else if (isRecord(tokenSource?.perfil)) {
      authTokenPayload.perfil = tokenSource?.perfil;
    }
    persistSafely(localStorageRef, "authToken", JSON.stringify(authTokenPayload));
  }
}
