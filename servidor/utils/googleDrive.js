const https = require('https');
const { URL } = require('url');
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const UPLOAD_URI = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink';
const FILES_URI = 'https://www.googleapis.com/drive/v3/files';

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

async function ensureFileIsPublic(fileId, token) {
  if (!fileId) return;
  const body = JSON.stringify({ role: 'reader', type: 'anyone' });
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };

  try {
    await requestGoogle({
      url: `${FILES_URI}/${fileId}/permissions?supportsAllDrives=true`,
      method: 'POST',
      headers,
      body: Buffer.from(body, 'utf8'),
    });
  } catch (error) {
    // Apenas registra o erro e segue.
    console.error('googleDrive.ensureFileIsPublic', error?.status || '', error?.body?.toString('utf8') || error?.message);
  }
}

async function getFileMetadata(fileId, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
  };
  const response = await requestGoogle({
    url: `${FILES_URI}/${fileId}?supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink`,
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

  const token = await fetchAccessToken();
  const boundary = `gc_boundary_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const mimeType = options.mimeType || 'application/octet-stream';
  const parentsRaw = Array.isArray(options.parents) ? options.parents : [];
  const parents = parentsRaw
    .filter((value) => value !== null && value !== undefined)
    .map((value) => cleanEnvValue(typeof value === 'string' ? value : String(value)))
    .filter(Boolean);
  const folderSource = typeof options.folderId !== 'undefined' ? options.folderId : credentials.folderId;
  const folderId = cleanEnvValue(
    folderSource === null || folderSource === undefined
      ? ''
      : (typeof folderSource === 'string' ? folderSource : String(folderSource)),
  );
  if (folderId) {
    parents.push(folderId);
  }
  const uniqueParents = Array.from(new Set(parents)).filter(Boolean);

  const metadata = {
    name: options.name || `arquivo-${Date.now()}`,
  };
  if (uniqueParents.length) {
    metadata.parents = uniqueParents;
  }

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
  } catch (error) {
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
};
