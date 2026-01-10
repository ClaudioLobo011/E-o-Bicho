const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Readable } = require('stream');
const path = require('path');

const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
const accountId = (process.env.R2_ACCOUNT_ID || '').trim();
const bucket = (process.env.R2_BUCKET || '').trim();
const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || '').trim();
const region = (process.env.R2_REGION || 'auto').trim();

let cachedClient = null;

function isR2Configured() {
    return !!(accessKeyId && secretAccessKey && accountId && bucket);
}

function getClient() {
    if (!isR2Configured()) return null;
    if (cachedClient) return cachedClient;

    cachedClient = new S3Client({
        region,
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
        forcePathStyle: false,
    });
    return cachedClient;
}

function normalizeKey(key) {
    if (!key) return '';
    return String(key).replace(/\\+/g, '/').replace(/^\//, '').trim();
}

function buildPublicUrl(key) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey || !isR2Configured()) return '';
    if (publicBaseUrl) {
        const base = publicBaseUrl.replace(/\/$/, '');
        return `${base}/${encodeURI(normalizedKey)}`;
    }
    // O domínio r2.cloudflarestorage.com funciona melhor usando o estilo de caminho
    // (<account>/<bucket>/chave) para acesso público, evitando problemas de
    // resolução em alguns navegadores e CDNs ao usar o bucket como subdomínio.
    return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${encodeURI(normalizedKey)}`;
}

function parseKeyFromPublicUrl(url) {
    if (typeof url !== 'string') return null;

    const trimmed = url.trim();
    if (!trimmed) return null;

    if (publicBaseUrl) {
        const base = publicBaseUrl.replace(/\/$/, '');
        if (trimmed.startsWith(base)) {
            const remainder = trimmed.slice(base.length).replace(/^\/+/, '');
            try {
                return decodeURIComponent(remainder);
            } catch (error) {
                return remainder;
            }
        }
    }

    if (accountId && bucket) {
        const base = `https://${accountId}.r2.cloudflarestorage.com`;
        if (trimmed.startsWith(base)) {
            const remainder = trimmed.slice(base.length).replace(/^\/+/, '');
            if (remainder.startsWith(`${bucket}/`)) {
                const keyPart = remainder.slice(bucket.length + 1);
                try {
                    return decodeURIComponent(keyPart);
                } catch (error) {
                    return keyPart;
                }
            }
        }
    }

    return null;
}

async function uploadBufferToR2(buffer, { key, contentType }) {
    const client = getClient();
    if (!client) throw new Error('Cloudflare R2 não está configurado.');

    const normalizedKey = normalizeKey(key) || path.join('banners', `${Date.now()}`);

    const command = new PutObjectCommand({
        Bucket: bucket,
        Key: normalizedKey,
        Body: buffer,
        ContentType: contentType || 'application/octet-stream',
    });

    await client.send(command);

    return {
        key: normalizedKey,
        url: buildPublicUrl(normalizedKey),
    };
}

async function streamToBuffer(stream) {
    if (!stream) return Buffer.alloc(0);
    if (Buffer.isBuffer(stream)) return stream;
    if (stream instanceof Uint8Array) return Buffer.from(stream);
    return new Promise((resolve, reject) => {
        const chunks = [];
        const readable = stream instanceof Readable ? stream : Readable.from(stream);
        readable.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        readable.on('error', reject);
        readable.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

async function getObjectFromR2(key) {
    const client = getClient();
    if (!client) throw new Error('Cloudflare R2 não está configurado.');

    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) return null;

    const command = new GetObjectCommand({ Bucket: bucket, Key: normalizedKey });
    const response = await client.send(command);
    const buffer = await streamToBuffer(response.Body);

    return {
        key: normalizedKey,
        buffer,
        contentType: response.ContentType || 'application/octet-stream',
        contentLength: response.ContentLength || buffer.length,
    };
}

async function deleteObjectFromR2(key) {
    const client = getClient();
    if (!client) return;

    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) return;

    const command = new DeleteObjectCommand({ Bucket: bucket, Key: normalizedKey });
    await client.send(command);
}

module.exports = {
    isR2Configured,
    uploadBufferToR2,
    getObjectFromR2,
    deleteObjectFromR2,
    buildPublicUrl,
    parseKeyFromPublicUrl,
};
