const { createHash } = require('node:crypto');
const { normalizeProductImageUrl } = require('../utils/productImageUrl');
const sharp = require('sharp');

const maxSource = 8 * 1024 * 1024;
function photoDescriptor(product) {
  if (!product || product.inativo) return null;
  const raw = product.imagens?.[0] || product.imagemPrincipal;
  if (typeof raw !== 'string' || !raw) return null;
  let url;
  try { url = new URL(normalizeProductImageUrl(raw)); } catch { return null; }
  const origin = new URL(process.env.R2_PUBLIC_BASE_URL || 'https://cdn.peteobicho.com.br').origin;
  if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password || /placeholder/i.test(url.pathname)) return null;
  url.hash = '';
  return { url: url.href, revision: createHash('sha256').update('pdv-webp-v1:' + url.href).digest('hex') };
}

// Shared across store hosts, bounded independently of the source catalogue.
const variants = new Map();
let active = 0;
async function compactPhoto(photo) {
  if (variants.has(photo.revision)) return variants.get(photo.revision);
  if (active >= 3) throw Object.assign(new Error('Fila de imagens ocupada.'), { status: 503 });
  active++;
  const task = (async () => {
    const response = await fetch(photo.url, { redirect: 'error', signal: AbortSignal.timeout(9000) });
    if (!response.ok || !/^image\/(jpeg|png|webp|gif|avif)$/i.test(response.headers.get('content-type') || '')
      || Number(response.headers.get('content-length')) > maxSource) {
      await response.body?.cancel();
      throw Object.assign(new Error('Foto indisponível ou inválida.'), { status: 422 });
    }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > maxSource) throw Object.assign(new Error('Foto excede o limite.'), { status: 422 });
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks, size);
    const image = sharp(input, { limitInputPixels: 16000000 });
    if (!['jpeg','png','webp','gif','heif'].includes((await image.metadata()).format)) {
      throw Object.assign(new Error('Formato de foto não aceito.'), { status: 422 });
    }
    const output = await image.rotate().resize(360, 360, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 76 }).toBuffer();
    if (output.length > 128 * 1024) throw Object.assign(new Error('Miniatura excede o limite.'), { status: 422 });
    return output;
  })().finally(() => { active--; });
  variants.set(photo.revision, task);
  if (variants.size > 256) variants.delete(variants.keys().next().value);
  try { return await task; }
  catch (error) { variants.delete(photo.revision); throw error; }
}
module.exports = { photoDescriptor, compactPhoto };
