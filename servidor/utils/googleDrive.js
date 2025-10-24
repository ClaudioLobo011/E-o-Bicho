const https = require('https');
const { URL } = require('url');
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const UPLOAD_URI = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink';
const FILES_URI = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

const folderCache = new Map();

let cachedCredentials = null;
let cachedAccessToken = null;
let cachedAccessTokenExpiry = 0;
let pendingTokenPromise = null;

function looksLikeOAuthClientId(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /\.apps\.googleusercontent\.com$/i.test(trimmed);
}

function looksLikeServiceAccountEmail(value) {
  if (typeof value !== 'string') return false;
  return /@.*gserviceaccount\.com$/i.test(value.trim());
}

function looksLikePrivateKey(value) {
  if (typeof value !== 'string') return false;
  return /-----BEGIN [^-]*PRIVATE KEY-----/i.test(value);
}

function cleanEnvValue(value) {
  if (typeof value !== 'string') return '';
  let cleaned = value.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned.trim();
}

function sanitizeDriveFolderName(name) {
  if (name === null || name === undefined) return '';
  return String(name)
    .replace(/[\\/:*?"'<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
}

function sanitizeDriveFileName(name) {
  if (name === null || name === undefined) return '';
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/:*?"'<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 255);
}

function getFolderCacheKey(parentId, name) {
  const parentKey = parentId ? String(parentId) : 'root';
  return `${parentKey}::${name}`;
}

function escapeQueryValue(value) {
  return String(value).replace(/'/g, "\\'");
}

function getCredentials() {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  const clientId = cleanEnvValue(process.env.GOOGLE_DRIVE_CLIENT_ID || '');
  const clientSecret = cleanEnvValue(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '');
  const refreshToken = cleanEnvValue(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '');

  if (!(clientId && clientSecret && refreshToken)) {
    return null;
  }

  const folderId = cleanEnvValue(process.env.GOOGLE_DRIVE_FOLDER_ID || '') || null;

  cachedCredentials = { clientId, clientSecret, refreshToken, folderId };
  return cachedCredentials;
}

function validateOAuthCredentials(credentials) {
  if (!credentials) return;

  const issues = [];
  if (!looksLikeOAuthClientId(credentials.clientId || '')) {
    if (looksLikeServiceAccountEmail(credentials.clientId || '')) {
      issues.push(
        'GOOGLE_DRIVE_CLIENT_ID não deve usar o client_email da service account. Crie um cliente OAuth 2.0 (Aplicativo da Web) e copie o "ID do cliente" que termina com .apps.googleusercontent.com.',
      );
    } else {
      issues.push(
        'GOOGLE_DRIVE_CLIENT_ID deve ser o "ID do cliente" das credenciais OAuth 2.0 (geralmente termina com .apps.googleusercontent.com).',
      );
    }
  }

  if (looksLikePrivateKey(credentials.clientSecret || '')) {
    issues.push(
      'GOOGLE_DRIVE_CLIENT_SECRET não pode receber a chave privada da service account. Utilize o client secret mostrado junto do client ID nas credenciais OAuth 2.0.',
    );
  }

  if (issues.length) {
    const error = new Error(issues.join(' '));
    error.code = 'GOOGLE_DRIVE_INVALID_CREDENTIALS';
    throw error;
  }
}

function resetCredentialsCache() {
  cachedCredentials = null;
  cachedAccessToken = null;
  cachedAccessTokenExpiry = 0;
  pendingTokenPromise = null;
  folderCache.clear();
}

function isDriveConfigured() {
  return !!getCredentials();
}

function getDriveFolderId() {
  const creds = getCredentials();
  return creds?.folderId || null;
}

function requestGoogle({ url, method = 'GET', headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const options = {
        method,
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers,
      };

      const req = https.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, headers: res.headers, body: buffer });
            return;
          }
          const error = new Error(`Request failed with status ${res.statusCode}`);
          error.status = res.statusCode;
          error.headers = res.headers;
          error.body = buffer;
          reject(error);
        });
      });

      req.on('error', reject);

      if (body) {
        req.write(body);
      }

      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

async function findFolderByName(name, parentId, token) {
  const sanitized = sanitizeDriveFolderName(name);
  if (!sanitized) return null;

  const parentQuery = parentId ? `'${escapeQueryValue(parentId)}' in parents` : "'root' in parents";
  const query = `name = '${escapeQueryValue(sanitized)}' and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false and ${parentQuery}`;
  const params = new URLSearchParams({
    q: query,
    spaces: 'drive',
    fields: 'files(id,name),nextPageToken',
    pageSize: '10',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const headers = { Authorization: `Bearer ${token}` };
  const response = await requestGoogle({
    url: `${FILES_URI}?${params.toString()}`,
    method: 'GET',
    headers,
  });

  try {
    const data = JSON.parse(response.body.toString('utf8'));
    if (Array.isArray(data?.files) && data.files.length > 0) {
      return data.files[0]?.id || null;
    }
  } catch (error) {
    console.error('googleDrive.findFolderByName parse error', error);
  }
  return null;
}

async function findFileByName(name, parentId, token) {
  const sanitized = sanitizeDriveFileName(name);
  if (!sanitized) return null;

  const parentQuery = parentId ? `'${escapeQueryValue(parentId)}' in parents` : "'root' in parents";
  const query = `name = '${escapeQueryValue(sanitized)}' and trashed = false and ${parentQuery}`;
  const params = new URLSearchParams({
    q: query,
    spaces: 'drive',
    fields: 'files(id,name,mimeType,size,parents,webViewLink,webContentLink),nextPageToken',
    pageSize: '10',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  });

  const headers = { Authorization: `Bearer ${token}` };
  const response = await requestGoogle({
    url: `${FILES_URI}?${params.toString()}`,
    method: 'GET',
    headers,
  });

  try {
    const data = JSON.parse(response.body.toString('utf8'));
    if (Array.isArray(data?.files) && data.files.length > 0) {
      return data.files[0] || null;
    }
  } catch (error) {
    console.error('googleDrive.findFileByName parse error', error);
  }
  return null;
}

async function createFolder(name, parentId, token) {
  const sanitized = sanitizeDriveFolderName(name);
  if (!sanitized) return null;

  const bodyPayload = {
    name: sanitized,
    mimeType: DRIVE_FOLDER_MIME,
  };
  if (parentId) {
    bodyPayload.parents = [parentId];
  }

  const bodyString = JSON.stringify(bodyPayload);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyString),
  };

  const response = await requestGoogle({
    url: `${FILES_URI}?supportsAllDrives=true&fields=id,name,parents`,
    method: 'POST',
    headers,
    body: Buffer.from(bodyString, 'utf8'),
  });

  try {
    const data = JSON.parse(response.body.toString('utf8'));
    return data?.id || null;
  } catch (error) {
    console.error('googleDrive.createFolder parse error', error);
    return null;
  }
}

async function ensureDriveFolder(name, parentId, token) {
  const sanitized = sanitizeDriveFolderName(name);
  if (!sanitized) return null;

  const cacheKey = getFolderCacheKey(parentId, sanitized);
  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }

  let folderId = await findFolderByName(sanitized, parentId, token);
  if (!folderId) {
    folderId = await createFolder(sanitized, parentId, token);
  }

  if (folderId) {
    folderCache.set(cacheKey, folderId);
  }

  return folderId;
}

async function ensureFolderPath({ segments = [], baseFolderId = null, token }) {
  if (!token) {
    throw new Error('Token do Google Drive é obrigatório para garantir pastas.');
  }

  const list = Array.isArray(segments) ? segments : [];
  const sanitizedSegments = list
    .map((segment) => sanitizeDriveFolderName(segment))
    .filter(Boolean);

  if (!sanitizedSegments.length) {
    return baseFolderId || null;
  }

  let currentParent = baseFolderId || null;
  for (const segment of sanitizedSegments) {
    const ensuredId = await ensureDriveFolder(segment, currentParent, token);
    if (!ensuredId) {
      throw new Error(`Falha ao garantir a pasta "${segment}" no Google Drive.`);
    }
    currentParent = ensuredId;
  }

  return currentParent;
}

async function resolveFolderPath({ segments = [], baseFolderId = null, token }) {
  if (!token) {
    throw new Error('Token do Google Drive é obrigatório para localizar pastas.');
  }

  const list = Array.isArray(segments) ? segments : [];
  const sanitizedSegments = list
    .map((segment) => sanitizeDriveFolderName(segment))
    .filter(Boolean);

  if (!sanitizedSegments.length) {
    return baseFolderId || null;
  }

  let currentParent = baseFolderId || null;
  for (const segment of sanitizedSegments) {
    const folderId = await findFolderByName(segment, currentParent, token);
    if (!folderId) {
      return null;
    }
    currentParent = folderId;
  }

  return currentParent;
}

async function fetchAccessToken() {
  const credentials = getCredentials();
  if (!credentials) {
    throw new Error('Credenciais do Google Drive não configuradas.');
  }

  validateOAuthCredentials(credentials);

  if (cachedAccessToken && cachedAccessTokenExpiry > Date.now() + 60000) {
    return cachedAccessToken;
  }

  if (pendingTokenPromise) {
    return pendingTokenPromise;
  }

  pendingTokenPromise = (async () => {
    const params = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    });
    const bodyString = params.toString();
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(bodyString),
    };

    let response;
    try {
      response = await requestGoogle({
        url: TOKEN_URI,
        method: 'POST',
        headers,
        body: Buffer.from(bodyString, 'utf8'),
      });
    } catch (err) {
      let errorToThrow = err;
      if (err?.body) {
        try {
          const parsed = JSON.parse(err.body.toString('utf8'));
          const message = parsed?.error_description || parsed?.error || null;
          if (message) {
            errorToThrow = new Error(`Google OAuth: ${message}`);
          }
        } catch (_) {
          // ignore parsing failures
        }
      }
      throw errorToThrow;
    }

    let data;
    try {
      data = JSON.parse(response.body.toString('utf8'));
    } catch (error) {
      throw new Error('Resposta inválida ao obter token do Google Drive.');
    }

    if (data?.error) {
      const message = data.error_description || data.error || 'Erro ao obter token do Google Drive.';
      const error = new Error(`Google OAuth: ${message}`);
      error.data = data;
      throw error;
    }

    const accessToken = data?.access_token;
    if (!accessToken) {
      throw new Error('Token de acesso não recebido do Google Drive.');
    }

    const expiresIn = Number(data.expires_in) || 3600;
    const safetyWindowSeconds = Math.max(expiresIn - 120, 60);
    cachedAccessToken = accessToken;
    cachedAccessTokenExpiry = Date.now() + safetyWindowSeconds * 1000;

    return accessToken;
  })();

  try {
    const token = await pendingTokenPromise;
    pendingTokenPromise = null;
    return token;
  } catch (error) {
    pendingTokenPromise = null;
    cachedAccessToken = null;
    cachedAccessTokenExpiry = 0;
    throw error;
  }
}

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, Math.max(0, ms));
});

async function ensureFileIsPublic(fileId, token) {
  if (!fileId) return;
  const body = JSON.stringify({ role: 'reader', type: 'anyone' });
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };

  const payload = {
    url: `${FILES_URI}/${fileId}/permissions?supportsAllDrives=true`,
    method: 'POST',
    headers,
    body: Buffer.from(body, 'utf8'),
  };

  const maxAttempts = 3;
  const baseDelayMs = 500;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await requestGoogle(payload);
      return;
    } catch (error) {
      const status = error?.status || error?.statusCode;
      const errorBody = error?.body?.toString('utf8') || error?.message;
      const isRetryable = !status || status === 429 || status >= 500;

      if (!isRetryable || attempt === maxAttempts) {
        // Apenas registra o erro e segue.
        console.error('googleDrive.ensureFileIsPublic', status || '', errorBody);
        return;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }
}

function normalizeReason(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function extractDriveErrorDetails(error) {
  const details = {
    status: error?.status || error?.statusCode || null,
    message: '',
    reasons: [],
    rawBody: '',
    retryable: false,
    shouldResetAuth: false,
    primaryReason: null,
  };

  if (typeof error?.message === 'string' && error.message.trim()) {
    details.message = error.message.trim();
  }

  const bodyBuffer = error?.body;
  if (bodyBuffer) {
    try {
      details.rawBody = bodyBuffer.toString('utf8');
    } catch (bufferError) {
      details.rawBody = '';
    }
  }

  if (details.rawBody) {
    try {
      const parsed = JSON.parse(details.rawBody);
      const driveError = parsed?.error || parsed;
      if (driveError) {
        if (typeof driveError.message === 'string' && driveError.message.trim()) {
          details.message = driveError.message.trim();
        }
        if (Array.isArray(driveError.errors)) {
          details.reasons = driveError.errors
            .map((item) => (typeof item?.reason === 'string' ? item.reason : ''))
            .filter(Boolean);
        } else if (typeof driveError.reason === 'string' && driveError.reason.trim()) {
          details.reasons = [driveError.reason.trim()];
        }
        if (!details.status && typeof driveError.code === 'number') {
          details.status = driveError.code;
        }
      }
    } catch (parseError) {
      // Mantém os detalhes brutos apenas para depuração.
    }
  }

  if (!details.message) {
    details.message = 'Não foi possível concluir o upload para o Google Drive.';
  }

  const normalizedReasons = details.reasons.map(normalizeReason).filter(Boolean);
  details.primaryReason = normalizedReasons.length ? normalizedReasons[0] : null;

  const retryableReasons = new Set([
    'ratelimitexceeded',
    'userratelimitexceeded',
    'backenderror',
    'internalerror',
    'transienterror',
  ]);

  if (!details.status) {
    details.retryable = true;
  } else if (details.status >= 500) {
    details.retryable = true;
  } else if (details.status === 429 || details.status === 408) {
    details.retryable = true;
  } else if (details.status === 401) {
    details.retryable = true;
    details.shouldResetAuth = true;
  } else if (details.status === 403 || details.status === 400) {
    for (const reason of normalizedReasons) {
      if (retryableReasons.has(reason)) {
        details.retryable = true;
        break;
      }
    }
  }

  if (!details.retryable && details.rawBody) {
    const bodyLower = details.rawBody.toLowerCase();
    if (bodyLower.includes('ratelimit')) {
      details.retryable = true;
    }
    if (bodyLower.includes('user rate limit')) {
      details.retryable = true;
    }
    if (bodyLower.includes('backenderror') || bodyLower.includes('internal error') || bodyLower.includes('transient')) {
      details.retryable = true;
    }
    if (bodyLower.includes('invalid_grant')) {
      details.shouldResetAuth = true;
      details.retryable = true;
    }
  }

  return details;
}

async function getFileMetadata(fileId, token, fields = 'id,name,mimeType,size,webViewLink,webContentLink,parents') {
  const headers = {
    Authorization: `Bearer ${token}`,
  };
  const response = await requestGoogle({
    url: `${FILES_URI}/${fileId}?supportsAllDrives=true&fields=${encodeURIComponent(fields)}`,
    method: 'GET',
    headers,
  });
  try {
    return JSON.parse(response.body.toString('utf8'));
  } catch (error) {
    return null;
  }
}

async function uploadBufferToDrive(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Buffer inválido para upload.');
  }

  const credentials = getCredentials();
  if (!credentials) {
    throw new Error('Credenciais do Google Drive não configuradas.');
  }

  const mimeType = options.mimeType || 'application/octet-stream';
  const parentsRaw = Array.isArray(options.parents) ? options.parents : [];
  const parentCandidates = parentsRaw
    .filter((value) => value !== null && value !== undefined)
    .map((value) => cleanEnvValue(typeof value === 'string' ? value : String(value)))
    .filter(Boolean);
  const folderSource = typeof options.folderId !== 'undefined' ? options.folderId : credentials.folderId;
  const baseFolderId = cleanEnvValue(
    folderSource === null || folderSource === undefined
      ? ''
      : (typeof folderSource === 'string' ? folderSource : String(folderSource)),
  );

  const pathSegments = Array.isArray(options.folderPath) ? options.folderPath : [];
  const maxAttempts = Math.max(1, Number.parseInt(options.retryAttempts ?? 3, 10));
  const baseDelayMs = Math.max(100, Number.parseInt(options.retryDelayMs ?? 500, 10));

  let lastError = null;
  let lastErrorDetails = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const token = await fetchAccessToken();

      let finalFolderId = null;
      if (pathSegments.length) {
        finalFolderId = await ensureFolderPath({
          segments: pathSegments,
          baseFolderId: baseFolderId || null,
          token,
        });
      } else if (baseFolderId) {
        finalFolderId = baseFolderId;
      }

      const combinedParents = parentCandidates.slice();
      if (finalFolderId) {
        combinedParents.push(finalFolderId);
      }
      const uniqueParents = Array.from(new Set(combinedParents)).filter(Boolean);

      const metadata = {
        name: options.name || `arquivo-${Date.now()}`,
      };
      if (uniqueParents.length) {
        metadata.parents = uniqueParents;
      }

      const boundary = `gc_boundary_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const metaString = JSON.stringify(metadata);
      const preamble = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaString}\r\n`);
      const header = Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
      const closing = Buffer.from(`\r\n--${boundary}--\r\n`);
      const multipartBody = Buffer.concat([preamble, header, buffer, closing]);

      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': multipartBody.length,
      };

      const response = await requestGoogle({
        url: UPLOAD_URI,
        method: 'POST',
        headers,
        body: multipartBody,
      });

      let fileData = {};
      try {
        fileData = JSON.parse(response.body.toString('utf8'));
      } catch (parseError) {
        fileData = {};
      }

      const fileId = fileData?.id;
      if (!fileId) {
        throw new Error('Falha ao criar arquivo no Google Drive.');
      }

      await ensureFileIsPublic(fileId, token);
      const metadataResponse = await getFileMetadata(fileId, token);
      if (metadataResponse) {
        return metadataResponse;
      }

      return fileData;
    } catch (error) {
      lastError = error;
      lastErrorDetails = extractDriveErrorDetails(error);

      if (lastErrorDetails.shouldResetAuth) {
        resetCredentialsCache();
      }

      if (attempt >= maxAttempts || !lastErrorDetails.retryable) {
        if (lastErrorDetails) {
          const statusInfo = lastErrorDetails.status ? `código ${lastErrorDetails.status}` : '';
          const reasonInfo = lastErrorDetails.primaryReason || '';
          const suffixParts = [statusInfo, reasonInfo].filter(Boolean).join(' - ');
          const messageParts = [lastErrorDetails.message];
          if (suffixParts) {
            messageParts.push(`(${suffixParts})`);
          }
          const finalMessage = messageParts.filter(Boolean).join(' ').trim() || 'Não foi possível concluir o upload para o Google Drive.';
          const wrappedError = new Error(finalMessage);
          wrappedError.status = lastErrorDetails.status ?? error?.status ?? error?.statusCode ?? null;
          wrappedError.reason = lastErrorDetails.primaryReason || null;
          wrappedError.driveError = lastErrorDetails;
          wrappedError.originalError = error;
          throw wrappedError;
        }

        throw error;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }

  if (lastErrorDetails) {
    const fallbackMessage = lastErrorDetails.message || 'Não foi possível concluir o upload para o Google Drive.';
    const errorWithContext = new Error(fallbackMessage);
    errorWithContext.status = lastErrorDetails.status ?? lastError?.status ?? lastError?.statusCode ?? null;
    errorWithContext.reason = lastErrorDetails.primaryReason || null;
    errorWithContext.driveError = lastErrorDetails;
    errorWithContext.originalError = lastError || null;
    throw errorWithContext;
  }

  throw lastError || new Error('Falha desconhecida ao enviar arquivo para o Google Drive.');
}

async function findDriveFileByPath(options = {}) {
  const credentials = getCredentials();
  if (!credentials) {
    return null;
  }

  const token = await fetchAccessToken();

  const folderSource =
    typeof options.folderId !== 'undefined' ? options.folderId : credentials.folderId;
  const baseFolderId = cleanEnvValue(
    folderSource === null || folderSource === undefined
      ? ''
      : typeof folderSource === 'string'
        ? folderSource
        : String(folderSource),
  );

  const pathSegments = Array.isArray(options.folderPath) ? options.folderPath : [];
  const fileName = typeof options.fileName === 'string' ? options.fileName : '';

  const folderId = await resolveFolderPath({
    segments: pathSegments,
    baseFolderId: baseFolderId || null,
    token,
  });

  if (!folderId) {
    return null;
  }

  return findFileByName(fileName, folderId, token);
}

async function moveFileToFolder(fileId, options = {}) {
  if (!fileId) {
    throw new Error('ID do arquivo inválido para mover no Google Drive.');
  }

  const credentials = getCredentials();
  if (!credentials) {
    throw new Error('Credenciais do Google Drive não configuradas.');
  }

  const token = await fetchAccessToken();

  const folderSource =
    typeof options.folderId !== 'undefined' ? options.folderId : credentials.folderId;
  const baseFolderId = cleanEnvValue(
    folderSource === null || folderSource === undefined
      ? ''
      : typeof folderSource === 'string'
        ? folderSource
        : String(folderSource),
  );

  const pathSegments = Array.isArray(options.folderPath) ? options.folderPath : [];

  let destinationFolderId = baseFolderId || null;
  if (pathSegments.length) {
    destinationFolderId = await ensureFolderPath({
      segments: pathSegments,
      baseFolderId: destinationFolderId,
      token,
    });
  }

  if (!destinationFolderId) {
    throw new Error('Não foi possível determinar a pasta destino no Google Drive.');
  }

  const metadata = await getFileMetadata(fileId, token, 'id,name,parents,webViewLink,webContentLink');
  const newNameRaw = typeof options.newName === 'string' ? options.newName : null;
  const sanitizedNewName = newNameRaw ? sanitizeDriveFileName(newNameRaw) : '';
  const shouldRename = Boolean(sanitizedNewName && metadata?.name !== sanitizedNewName);
  const existingParents = Array.isArray(metadata?.parents)
    ? metadata.parents.filter((parent) => typeof parent === 'string' && parent)
    : [];
  const parentsToRemove = existingParents.filter((parent) => parent !== destinationFolderId);
  const needsAddParent = !existingParents.includes(destinationFolderId);

  if (!needsAddParent && parentsToRemove.length === 0 && !shouldRename) {
    return metadata;
  }

  const queryParams = new URLSearchParams({
    supportsAllDrives: 'true',
    fields: 'id,name,parents,webViewLink,webContentLink',
  });

  if (needsAddParent) {
    queryParams.set('addParents', destinationFolderId);
  }

  if (parentsToRemove.length) {
    queryParams.set('removeParents', parentsToRemove.join(','));
  }

  const bodyPayload = {};
  if (shouldRename) {
    bodyPayload.name = sanitizedNewName;
  }

  const bodyString = JSON.stringify(bodyPayload);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyString),
  };

  const response = await requestGoogle({
    url: `${FILES_URI}/${fileId}?${queryParams.toString()}`,
    method: 'PATCH',
    headers,
    body: Buffer.from(bodyString, 'utf8'),
  });

  try {
    return JSON.parse(response.body.toString('utf8'));
  } catch (error) {
    return metadata;
  }
}

async function listFilesInFolderByPath(options = {}) {
  const credentials = getCredentials();
  if (!credentials) {
    return { files: [], folderId: null };
  }

  const token = await fetchAccessToken();

  const folderSource =
    typeof options.folderId !== 'undefined' ? options.folderId : credentials.folderId;
  const baseFolderId = cleanEnvValue(
    folderSource === null || folderSource === undefined
      ? ''
      : typeof folderSource === 'string'
        ? folderSource
        : String(folderSource),
  );

  const pathSegments = Array.isArray(options.folderPath) ? options.folderPath : [];
  const includeFiles = options.includeFiles !== false;
  const includeFolders = options.includeFolders === true;
  const orderBy = typeof options.orderBy === 'string' ? options.orderBy : 'name_natural';
  const fields =
    typeof options.fields === 'string' && options.fields.trim()
      ? options.fields.trim()
      : 'files(id,name,mimeType,size,modifiedTime,parents,webViewLink,webContentLink),nextPageToken';
  const pageSize = Math.min(1000, Math.max(1, Number.parseInt(options.pageSize || 1000, 10)));

  const folderId = await resolveFolderPath({
    segments: pathSegments,
    baseFolderId: baseFolderId || null,
    token,
  });

  if (!folderId) {
    return { files: [], folderId: null };
  }

  const files = [];
  let nextPageToken = null;

  do {
    const queryParts = [`'${escapeQueryValue(folderId)}' in parents`, 'trashed = false'];

    if (!includeFolders && includeFiles) {
      queryParts.push(`mimeType != '${DRIVE_FOLDER_MIME}'`);
    } else if (!includeFiles && includeFolders) {
      queryParts.push(`mimeType = '${DRIVE_FOLDER_MIME}'`);
    }

    const params = new URLSearchParams({
      q: queryParts.join(' and '),
      spaces: 'drive',
      fields,
      pageSize: String(pageSize),
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });

    if (orderBy) {
      params.set('orderBy', orderBy);
    }

    if (nextPageToken) {
      params.set('pageToken', nextPageToken);
    }

    const headers = { Authorization: `Bearer ${token}` };
    const response = await requestGoogle({
      url: `${FILES_URI}?${params.toString()}`,
      method: 'GET',
      headers,
    });

    let data = null;
    try {
      data = JSON.parse(response.body.toString('utf8'));
    } catch (error) {
      data = null;
    }

    if (Array.isArray(data?.files) && data.files.length) {
      for (const item of data.files) {
        if (!includeFiles && item?.mimeType !== DRIVE_FOLDER_MIME) {
          continue;
        }
        if (!includeFolders && item?.mimeType === DRIVE_FOLDER_MIME) {
          continue;
        }
        files.push(item);
      }
    }

    nextPageToken = typeof data?.nextPageToken === 'string' && data.nextPageToken.trim()
      ? data.nextPageToken.trim()
      : null;
  } while (nextPageToken);

  return { files, folderId };
}

async function deleteFile(fileId) {
  if (!fileId) return;
  try {
    const token = await fetchAccessToken();
    await requestGoogle({
      url: `${FILES_URI}/${fileId}?supportsAllDrives=true`,
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    console.error('googleDrive.deleteFile', error?.status || '', error?.body?.toString('utf8') || error?.message);
  }
}

module.exports = {
  isDriveConfigured,
  getDriveFolderId,
  uploadBufferToDrive,
  deleteFile,
  resetCredentialsCache,
  moveFileToFolder,
  findDriveFileByPath,
  listFilesInFolderByPath,
};
