const fs = require('fs');
const path = require('path');

const DEFAULT_IMAGE_ROOT = '/Compras/C_Produto/Imagens';
const DEFAULT_DRIVE_PATH = '/Compras/C_Produto/Imagens';
const DEFAULT_URL_PREFIX = '/product-images';
const LEGACY_URL_PREFIX = '/uploads/products';
const LEGACY_UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'products');
const FALLBACK_BARCODE_SEGMENT = 'sem-codbarras';
const FALLBACK_EXTENSION = '.jpg';

const ensureLeadingSlash = (value) => {
  if (typeof value !== 'string' || !value) return '/';
  return value.startsWith('/') ? value : `/${value}`;
};

const cleanEnvPath = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed ? path.resolve(trimmed) : '';
};

const cleanEnvPrefix = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return ensureLeadingSlash(trimmed);
};

const splitPathSegments = (value) => {
  if (typeof value !== 'string') return [];
  return value
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
};

function getProductImagesRoot() {
  const envPath = cleanEnvPath(process.env.PRODUCT_IMAGE_ROOT || '');
  return envPath || DEFAULT_IMAGE_ROOT;
}

function getProductImagesUrlPrefix() {
  const envPrefix = cleanEnvPrefix(process.env.PRODUCT_IMAGE_URL_PREFIX || '');
  return envPrefix || DEFAULT_URL_PREFIX;
}

function getProductImagesDriveBaseSegments() {
  const rawValue =
    typeof process.env.PRODUCT_IMAGE_DRIVE_PATH === 'string' && process.env.PRODUCT_IMAGE_DRIVE_PATH.trim()
      ? process.env.PRODUCT_IMAGE_DRIVE_PATH
      : process.env.PRODUCT_IMAGE_ROOT || '';
  const envSegments = splitPathSegments(rawValue);
  if (envSegments.length > 0) {
    return envSegments;
  }
  return splitPathSegments(DEFAULT_DRIVE_PATH);
}

function getProductImagesDriveFolderPath(barcode) {
  const baseSegments = getProductImagesDriveBaseSegments();
  const folderSegment = sanitizeBarcodeSegment(barcode);
  return [...baseSegments, folderSegment];
}

function getLegacyUploadsDir() {
  return LEGACY_UPLOADS_DIR;
}

function getLegacyUrlPrefix() {
  return LEGACY_URL_PREFIX;
}

function sanitizeBarcodeSegment(barcode) {
  if (barcode === undefined || barcode === null) return FALLBACK_BARCODE_SEGMENT;
  const normalized = String(barcode)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9A-Za-z_-]+/g, '')
    .trim();
  return normalized || FALLBACK_BARCODE_SEGMENT;
}

function sanitizeExtension(ext) {
  if (typeof ext !== 'string') return FALLBACK_EXTENSION;
  const trimmed = ext.trim();
  if (!trimmed) return FALLBACK_EXTENSION;
  const normalized = trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
  const safe = normalized.replace(/[^0-9A-Za-z.]+/g, '').slice(0, 10);
  return safe || FALLBACK_EXTENSION;
}

function getProductImageFolderPath(barcode) {
  const folderSegment = sanitizeBarcodeSegment(barcode);
  return path.join(getProductImagesRoot(), folderSegment);
}

async function ensureProductImageFolder(barcode) {
  const folderPath = getProductImageFolderPath(barcode);
  await fs.promises.mkdir(folderPath, { recursive: true });
  return folderPath;
}

function buildProductImageFileName({ barcode, sequence, originalName }) {
  const folderSegment = sanitizeBarcodeSegment(barcode);
  const safeSequence = Number.isInteger(sequence) && sequence > 0 ? sequence : Date.now();
  const extension = sanitizeExtension(path.extname(originalName || ''));
  return `${folderSegment}-${safeSequence}${extension}`;
}

function buildProductImageStoragePath(barcode, fileName) {
  return path.join(getProductImagesRoot(), sanitizeBarcodeSegment(barcode), fileName);
}

function buildProductImagePublicPath(barcode, fileName) {
  const prefix = ensureLeadingSlash(getProductImagesUrlPrefix()).replace(/\/+$/, '');
  const folderSegment = sanitizeBarcodeSegment(barcode);
  const encodedFolder = encodeURIComponent(folderSegment);
  const encodedFile = encodeURIComponent(fileName);
  return `${prefix}/${encodedFolder}/${encodedFile}`;
}

function resolveDiskPathFromPublicPath(imagePath) {
  if (typeof imagePath !== 'string' || !imagePath.trim()) return null;
  const trimmed = imagePath.trim();

  const prefixes = [
    { prefix: getProductImagesUrlPrefix(), baseDir: getProductImagesRoot() },
    { prefix: LEGACY_URL_PREFIX, baseDir: LEGACY_UPLOADS_DIR },
  ];

  for (const { prefix, baseDir } of prefixes) {
    const normalizedPrefix = ensureLeadingSlash(prefix).replace(/\/+$/, '');
    let relative = '';

    if (normalizedPrefix === '/') {
      relative = trimmed.replace(/^\/+/, '');
    } else {
      if (!trimmed.startsWith(normalizedPrefix)) {
        continue;
      }
      relative = trimmed.slice(normalizedPrefix.length);
    }

    const segments = relative
      .split('/')
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch (error) {
          return segment;
        }
      });
    return path.join(baseDir, ...segments);
  }

  return null;
}

function parseProductImagePublicPath(imagePath) {
  if (typeof imagePath !== 'string') return null;
  const trimmed = imagePath.trim();
  if (!trimmed) return null;

  const prefix = ensureLeadingSlash(getProductImagesUrlPrefix()).replace(/\/+$/, '');
  let relative = '';

  if (prefix === '/') {
    relative = trimmed.replace(/^\/+/, '');
  } else {
    if (!trimmed.startsWith(prefix)) {
      return null;
    }
    relative = trimmed.slice(prefix.length);
  }

  relative = relative.replace(/^\/+/, '');
  if (!relative) return null;

  const segments = relative
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch (error) {
        return segment;
      }
    });

  if (segments.length < 2) {
    return null;
  }

  const [folderSegment, ...fileSegments] = segments;
  const fileName = fileSegments.join('/');
  if (!fileName) {
    return null;
  }

  return {
    barcodeSegment: folderSegment,
    fileName,
  };
}

function listProductImageFiles(barcode) {
  const folderPath = getProductImageFolderPath(barcode);
  if (!fs.existsSync(folderPath)) {
    return [];
  }
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

function listProductImagePublicPaths(barcode) {
  return listProductImageFiles(barcode).map((file) => buildProductImagePublicPath(barcode, file));
}

async function moveFile(source, destination) {
  if (!source || !destination) return;
  try {
    await fs.promises.rename(source, destination);
  } catch (error) {
    if (error?.code === 'EXDEV') {
      const data = await fs.promises.readFile(source);
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      await fs.promises.writeFile(destination, data);
      await fs.promises.unlink(source);
      return;
    }
    throw error;
  }
}

module.exports = {
  buildProductImageFileName,
  buildProductImagePublicPath,
  buildProductImageStoragePath,
  ensureProductImageFolder,
  getLegacyUploadsDir,
  getLegacyUrlPrefix,
  getProductImageFolderPath,
  getProductImagesDriveBaseSegments,
  getProductImagesDriveFolderPath,
  getProductImagesRoot,
  getProductImagesUrlPrefix,
  listProductImageFiles,
  listProductImagePublicPaths,
  moveFile,
  parseProductImagePublicPath,
  resolveDiskPathFromPublicPath,
  sanitizeBarcodeSegment,
};
