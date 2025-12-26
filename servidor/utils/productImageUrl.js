const { buildPublicUrl: buildR2PublicUrl, parseKeyFromPublicUrl } = require('./cloudflareR2');
const { buildProductImageR2Key, parseProductImagePublicPath } = require('./productImagePath');

const PLACEHOLDER_IMAGE = '/image/placeholder.svg';

const extractPathname = (value) => {
    if (!/^https?:\/\//i.test(value)) {
        return value;
    }
    try {
        const url = new URL(value);
        return url.pathname || '';
    } catch (error) {
        return '';
    }
};

const mapLegacyProductImageUrl = (value) => {
    const pathValue = extractPathname(value);
    if (!pathValue) return '';

    const normalizedPath = pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
    const parsed = parseProductImagePublicPath(normalizedPath);
    if (!parsed) return '';

    const key = buildProductImageR2Key(parsed.barcodeSegment, parsed.fileName);
    return buildR2PublicUrl(key);
};

const normalizeProductImageUrl = (rawValue) => {
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value) return '';

    const lower = value.toLowerCase();
    if (lower.includes('placeholder')) return PLACEHOLDER_IMAGE;

    const mappedLegacy = mapLegacyProductImageUrl(value);
    if (mappedLegacy) {
        return mappedLegacy;
    }

    const parsedKey = parseKeyFromPublicUrl(value);
    if (parsedKey) {
        return buildR2PublicUrl(parsedKey);
    }

    if (/^https?:\/\//i.test(value)) {
        return value;
    }

    const cleanedKey = value.replace(/^\/+/, '');
    if (!cleanedKey) return '';

    return buildR2PublicUrl(cleanedKey);
};

const applyProductImageUrls = (product) => {
    if (!product) return product;

    const normalizedImages = Array.isArray(product.imagens)
        ? product.imagens.map(normalizeProductImageUrl).filter(Boolean)
        : [];

    const normalizedMain = normalizeProductImageUrl(product.imagemPrincipal);

    product.imagens = normalizedImages;

    if (normalizedMain) {
        product.imagemPrincipal = normalizedMain;
    } else if (normalizedImages.length > 0) {
        product.imagemPrincipal = normalizedImages[0];
    } else {
        product.imagemPrincipal = PLACEHOLDER_IMAGE;
    }

    return product;
};

module.exports = {
    PLACEHOLDER_IMAGE,
    normalizeProductImageUrl,
    applyProductImageUrls,
};
