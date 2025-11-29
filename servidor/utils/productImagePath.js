const fs = require('fs');
const path = require('path');

const DEFAULT_IMAGE_ROOT = path.join(__dirname, '..', 'public', 'uploads', 'Imagens');
const DEFAULT_DRIVE_PATH = '/Compras/C_Produto/Imagens';
const DEFAULT_URL_PREFIX = '/product-images';
const DEFAULT_R2_BASE_PATH = 'produtos';
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

const decodeDriveSegment = (segment) => {
  if (typeof segment !== 'string') return '';
  const trimmed = segment.trim();
  if (!trimmed) return '';
  try {
    return decodeURIComponent(trimmed);
  } catch (error) {
    return trimmed;
  }
};

const DRIVE_ID_PATTERN = /[A-Za-z0-9_-]{16,}/;

const extractDriveFolderId = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const queryMatch = trimmed.match(/[?&]id=([A-Za-z0-9_-]{16,})/i);
  if (queryMatch) {
    return queryMatch[1];
  }

  const folderMatch = trimmed.match(/\/folders\/([A-Za-z0-9_-]{16,})/i);
  if (folderMatch) {
    return folderMatch[1];
  }

  if (DRIVE_ID_PATTERN.test(trimmed) && /^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
};

const parseDrivePathConfig = (rawValue) => {
  if (typeof rawValue !== 'string') {
    return { segments: [], folderId: null };
  }

  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { segments: [], folderId: null };
  }

  const folderId = extractDriveFolderId(trimmed);

  let remainder = trimmed;
  if (folderId) {
    const marker = trimmed.indexOf(folderId);
    if (marker >= 0) {
      remainder = trimmed.slice(marker + folderId.length);
    }
  }

  const withoutQuery = remainder.split('?')[0].split('#')[0];
  const segments = splitPathSegments(withoutQuery).map(decodeDriveSegment).filter(Boolean);

  return { segments, folderId };
};

let cachedDriveBaseConfig = null;

const getProductImagesDriveBaseConfig = () => {
  if (cachedDriveBaseConfig) {
    return cachedDriveBaseConfig;
  }

  const primary = parseDrivePathConfig(process.env.PRODUCT_IMAGE_DRIVE_PATH || '');
  if (primary.folderId || primary.segments.length) {
    cachedDriveBaseConfig = primary;
    return cachedDriveBaseConfig;
  }

  const secondary = parseDrivePathConfig(process.env.PRODUCT_IMAGE_ROOT || '');
  if (secondary.folderId || secondary.segments.length) {
    cachedDriveBaseConfig = secondary;
    return cachedDriveBaseConfig;
  }

  const fallback = parseDrivePathConfig(DEFAULT_DRIVE_PATH);
  if (fallback.segments.length) {
    cachedDriveBaseConfig = fallback;
  } else {
    cachedDriveBaseConfig = { segments: splitPathSegments(DEFAULT_DRIVE_PATH), folderId: null };
  }

  return cachedDriveBaseConfig;
};

function getProductImagesRoot() {
  const envPath = cleanEnvPath(process.env.PRODUCT_IMAGE_ROOT || '');
  return envPath || DEFAULT_IMAGE_ROOT;
}

function getProductImagesUrlPrefix() {
  const envPrefix = cleanEnvPrefix(process.env.PRODUCT_IMAGE_URL_PREFIX || '');
  return envPrefix || DEFAULT_URL_PREFIX;
}

function getProductImagesR2BasePath() {
  const envValue = typeof process.env.PRODUCT_IMAGE_R2_BASE_PATH === 'string'
    ? process.env.PRODUCT_IMAGE_R2_BASE_PATH.trim()
    : '';
  const segments = splitPathSegments(envValue);
  if (segments.length) {
    return segments.join('/');
  }
  return DEFAULT_R2_BASE_PATH;
}

function getProductImagesDriveBaseSegments() {
  return getProductImagesDriveBaseConfig().segments;
}

function getProductImagesDriveFolderPath(barcode) {
  const baseSegments = getProductImagesDriveBaseSegments();
  const folderSegment = sanitizeBarcodeSegment(barcode);
  return [...baseSegments, folderSegment];
}

function getProductImagesDriveFolderIdHint() {
  const { folderId } = getProductImagesDriveBaseConfig();
  return folderId || null;
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

function buildProductImageR2Key(barcode, fileName) {
  const folderSegment = sanitizeBarcodeSegment(barcode);
  const basePath = getProductImagesR2BasePath();
  const baseSegments = splitPathSegments(basePath);
  return [...baseSegments, folderSegment, fileName].join('/');
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
  buildProductImageR2Key,
  ensureProductImageFolder,
  getLegacyUploadsDir,
  getLegacyUrlPrefix,
  getProductImageFolderPath,
  getProductImagesDriveBaseSegments,
  getProductImagesDriveFolderIdHint,
  getProductImagesDriveFolderPath,
  getProductImagesRoot,
  getProductImagesR2BasePath,
  getProductImagesUrlPrefix,
  listProductImageFiles,
  listProductImagePublicPaths,
  moveFile,
  parseProductImagePublicPath,
  resolveDiskPathFromPublicPath,
  sanitizeBarcodeSegment,
};
