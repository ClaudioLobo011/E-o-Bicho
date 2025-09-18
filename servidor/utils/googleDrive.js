const https = require('https');
const { URL } = require('url');
const jwt = require('jsonwebtoken');

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const UPLOAD_URI = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,webContentLink';
const FILES_URI = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

let cachedCredentials = null;
let cachedAccessToken = null;
let cachedAccessTokenExpiry = 0;
let pendingTokenPromise = null;

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

  const clientEmail = cleanEnvValue(process.env.GOOGLE_DRIVE_CLIENT_EMAIL || '');
  let privateKey = cleanEnvValue(process.env.GOOGLE_DRIVE_PRIVATE_KEY || '');
  if (privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  if (privateKey.includes('\\r')) {
    privateKey = privateKey.replace(/\\r/g, '\r');
  }

  if (!(clientEmail && privateKey)) {
    return null;
  }

  const folderId = cleanEnvValue(process.env.GOOGLE_DRIVE_FOLDER_ID || '') || null;

  cachedCredentials = { clientEmail, privateKey, folderId };
  return cachedCredentials;
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

  if (cachedAccessToken && cachedAccessTokenExpiry > Date.now() + 60000) {
    return cachedAccessToken;
  }

  if (pendingTokenPromise) {
    return pendingTokenPromise;
  }

  pendingTokenPromise = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credentials.clientEmail,
      scope: DRIVE_SCOPE,
      aud: TOKEN_URI,
      iat: now,
      exp: now + 3600,
    };

    const assertion = jwt.sign(payload, credentials.privateKey, { algorithm: 'RS256' });
    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });
    const bodyString = params.toString();
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(bodyString),
    };

    const response = await requestGoogle({
      url: TOKEN_URI,
      method: 'POST',
      headers,
      body: Buffer.from(bodyString, 'utf8'),
    });

    let data;
    try {
      data = JSON.parse(response.body.toString('utf8'));
    } catch (error) {
      throw new Error('Resposta inválida ao obter token do Google Drive.');
    }

    const accessToken = data?.access_token;
    if (!accessToken) {
      throw new Error('Token de acesso não recebido do Google Drive.');
    }

    const expiresIn = Number(data.expires_in) || 3600;
    cachedAccessToken = accessToken;
    cachedAccessTokenExpiry = Date.now() + (expiresIn - 120) * 1000;
    pendingTokenPromise = null;

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
  const parents = Array.isArray(options.parents) ? options.parents.filter(Boolean) : [];
  const folderId = options.folderId || credentials.folderId;
  if (folderId) {
    parents.push(folderId);
  }

  const metadata = {
    name: options.name || `arquivo-${Date.now()}`,
  };
  if (parents.length) {
    metadata.parents = parents;
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
