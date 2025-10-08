const BEARER_PREFIX = /^bearer\s+/i;
const NAMED_PREFIX = /^(token|jwt|auth[_-]?token|access[_-]?token|authorization)\s*[:=]\s*/i;

function coerceToString(rawValue) {
  if (typeof rawValue === 'string') {
    return rawValue;
  }
  if (rawValue == null) {
    return '';
  }
  if (typeof rawValue === 'number' || typeof rawValue === 'boolean' || typeof rawValue === 'bigint') {
    return String(rawValue);
  }
  return '';
}

function normalizeToken(rawToken) {
  if (!rawToken) {
    return '';
  }
  const coerced = coerceToString(rawToken);
  if (!coerced) {
    return '';
  }

  let normalized = coerced.trim();
  if (!normalized) {
    return '';
  }

  normalized = normalized.replace(/^"+|"+$/g, '');
  normalized = normalized.replace(/^'+|'+$/g, '');
  normalized = normalized.replace(BEARER_PREFIX, '');
  normalized = normalized.replace(NAMED_PREFIX, '');

  return normalized.trim();
}

function safeParseJson(value) {
  const source = coerceToString(value);
  if (!source) {
    return null;
  }
  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function extractTokenFromRecord(record, depth = 0) {
  if (!record || typeof record !== 'object' || depth > 3) {
    return '';
  }

  const directKeys = [
    'token',
    'authToken',
    'accessToken',
    'jwt',
    'sessionToken',
    'authorization',
    'bearerToken'
  ];

  for (const key of directKeys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const value = record[key];
      const normalized = normalizeToken(value);
      if (normalized) {
        return normalized;
      }
    }
  }

  const nestedKeys = [
    'user',
    'usuario',
    'session',
    'auth',
    'data',
    'payload',
    'value'
  ];

  for (const key of nestedKeys) {
    if (record[key] && typeof record[key] === 'object') {
      const nestedToken = extractTokenFromRecord(record[key], depth + 1);
      if (nestedToken) {
        return nestedToken;
      }
    }
  }

  return '';
}

function extractTokenFromValue(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    const normalized = normalizeToken(value);
    if (normalized) {
      return normalized;
    }
    const parsed = safeParseJson(value);
    if (parsed) {
      return extractTokenFromRecord(parsed);
    }
    return '';
  }

  if (typeof value === 'object') {
    return extractTokenFromRecord(value);
  }

  return normalizeToken(value);
}

function extractFromAuthorization(headerValue) {
  const coerced = coerceToString(headerValue);
  if (!coerced) {
    return '';
  }

  const normalized = coerced.trim();
  if (!normalized) {
    return '';
  }

  const spaceIndex = normalized.indexOf(' ');
  if (spaceIndex > -1) {
    const token = normalized.slice(spaceIndex + 1);
    const normalizedToken = normalizeToken(token);
    if (normalizedToken) {
      return normalizedToken;
    }
  }

  const separatorMatch = normalized.match(/^(bearer|token|jwt|auth[_-]?token|access[_-]?token)[=:]/i);
  if (separatorMatch) {
    const [, prefix] = separatorMatch;
    const token = normalized.slice(prefix.length + 1);
    const normalizedToken = normalizeToken(token);
    if (normalizedToken) {
      return normalizedToken;
    }
  }

  return normalizeToken(normalized);
}

function extractFromCookies(cookieHeader) {
  const source = coerceToString(cookieHeader);
  if (!source) {
    return '';
  }

  const entries = source.split(';');
  for (const entry of entries) {
    const [rawKey, ...rawValue] = entry.split('=');
    const key = rawKey?.trim().toLowerCase();
    if (!key || rawValue.length === 0) {
      continue;
    }
    const joined = rawValue.join('=').trim();
    if (!joined) {
      continue;
    }

    let decoded = joined;
    try {
      decoded = decodeURIComponent(joined);
    } catch (_) {
      decoded = joined;
    }

    if (['auth_token', 'token', 'jwt', 'pdv_token', 'access_token', 'session_token'].includes(key)) {
      const normalized = normalizeToken(decoded);
      if (normalized) {
        return normalized;
      }
    }

    if (['loggedinuser', 'usuario', 'session', 'auth'].includes(key)) {
      const extracted = extractTokenFromValue(decoded);
      if (extracted) {
        return extracted;
      }
    }
  }

  return '';
}

function extractFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return '';
  }

  const authorization = headers.authorization || headers.Authorization;
  const authorizationToken = extractFromAuthorization(authorization);
  if (authorizationToken) {
    return authorizationToken;
  }

  const headerKeys = [
    'x-access-token',
    'x-auth-token',
    'auth-token',
    'authorization-token',
    'pdv-token',
    'token',
    'jwt',
    'access-token'
  ];

  for (const key of headerKeys) {
    if (key in headers) {
      const candidate = normalizeToken(headers[key]);
      if (candidate) {
        return candidate;
      }
    }
  }

  return '';
}

function getRequestToken(req) {
  if (!req || typeof req !== 'object') {
    return '';
  }

  const headerToken = extractFromHeaders(req.headers);
  if (headerToken) {
    return headerToken;
  }

  const queryToken = extractTokenFromRecord(req.query);
  if (queryToken) {
    return queryToken;
  }

  if (req.query) {
    const queryStrings = [
      req.query.token,
      req.query.auth_token,
      req.query.jwt,
      req.query.access_token,
      req.query.authorization
    ];
    for (const candidate of queryStrings) {
      const normalized = normalizeToken(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  const bodyToken = extractTokenFromRecord(req.body);
  if (bodyToken) {
    return bodyToken;
  }

  if (req.body) {
    const bodyStrings = [
      req.body?.token,
      req.body?.auth_token,
      req.body?.jwt,
      req.body?.access_token,
      req.body?.authorization
    ];
    for (const candidate of bodyStrings) {
      const normalized = normalizeToken(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  if (req.cookies) {
    for (const key of [
      'auth_token',
      'token',
      'jwt',
      'pdv_token',
      'access_token',
      'session_token'
    ]) {
      if (key in req.cookies) {
        const normalized = normalizeToken(req.cookies[key]);
        if (normalized) {
          return normalized;
        }
      }
    }

    for (const key of ['loggedInUser', 'usuario', 'session', 'auth']) {
      if (key in req.cookies) {
        const extracted = extractTokenFromValue(req.cookies[key]);
        if (extracted) {
          return extracted;
        }
      }
    }
  }

  const cookieHeader = extractFromCookies(req.headers?.cookie);
  if (cookieHeader) {
    return cookieHeader;
  }

  return '';
}

module.exports = { getRequestToken };
