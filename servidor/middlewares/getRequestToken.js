const BEARER_PREFIX = /^bearer\s+/i;

function normalizeToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') {
    return '';
  }
  const trimmed = rawToken.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(BEARER_PREFIX, '');
}

function extractFromAuthorization(headerValue) {
  if (!headerValue) {
    return '';
  }
  const normalized = headerValue.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.includes(' ')) {
    const [, token] = normalized.split(' ');
    return normalizeToken(token || '');
  }
  return normalizeToken(normalized);
}

function extractFromCookies(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return '';
  }
  const entries = cookieHeader.split(';');
  for (const entry of entries) {
    const [rawKey, ...rawValue] = entry.split('=');
    const key = rawKey?.trim().toLowerCase();
    if (!key || rawValue.length === 0) {
      continue;
    }
    if (!['auth_token', 'token', 'jwt'].includes(key)) {
      continue;
    }
    const joined = rawValue.join('=').trim();
    if (!joined) {
      continue;
    }
    try {
      return normalizeToken(decodeURIComponent(joined));
    } catch (_) {
      return normalizeToken(joined);
    }
  }
  return '';
}

function getRequestToken(req) {
  if (!req || typeof req !== 'object') {
    return '';
  }

  const headerToken =
    extractFromAuthorization(req.headers?.authorization) ||
    normalizeToken(req.headers?.['x-access-token']) ||
    normalizeToken(req.headers?.token);
  if (headerToken) {
    return headerToken;
  }

  if (req.query && typeof req.query.token === 'string') {
    const queryToken = normalizeToken(req.query.token);
    if (queryToken) {
      return queryToken;
    }
  }

  if (req.cookies) {
    for (const key of ['auth_token', 'token', 'jwt']) {
      const value = req.cookies[key];
      const normalized = normalizeToken(value);
      if (normalized) {
        return normalized;
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
