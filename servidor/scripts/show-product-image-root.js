#!/usr/bin/env node

const {
  getProductImagesDriveBaseSegments,
  getProductImagesRoot,
  getProductImagesUrlPrefix,
} = require('../utils/productImagePath');

function normalizeHost(rawHost) {
  const host = (rawHost || 'http://localhost:3000').trim();
  if (!host) {
    return 'http://localhost:3000';
  }
  return host.replace(/\/?$/, '');
}

function normalizePrefix(prefix) {
  if (!prefix) {
    return '/';
  }
  return `/${prefix.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

try {
  const resolvedRoot = getProductImagesRoot();
  const urlPrefix = getProductImagesUrlPrefix();
  const driveSegments = getProductImagesDriveBaseSegments();

  const explicitRootEnv = process.env.PRODUCT_IMAGE_ROOT || '';
  const explicitUrlEnv = process.env.PRODUCT_IMAGE_URL_PREFIX || '';
  const explicitDriveEnv = process.env.PRODUCT_IMAGE_DRIVE_PATH || '';

  const host = normalizeHost(process.env.APP_URL);
  const normalizedPrefix = normalizePrefix(urlPrefix);
  const httpLink = `${host}${normalizedPrefix}/`;

  console.log('Diretório local atual das imagens:', resolvedRoot);
  if (explicitRootEnv) {
    console.log('Valor da variável PRODUCT_IMAGE_ROOT:', explicitRootEnv);
  }
  console.log('Prefixo de URL configurado:', `${normalizedPrefix}/`);
  if (explicitUrlEnv) {
    console.log('Valor da variável PRODUCT_IMAGE_URL_PREFIX:', explicitUrlEnv);
  }
  console.log('Link HTTP completo (ajuste APP_URL se necessário):', httpLink);
  if (driveSegments.length > 0) {
    console.log('Estrutura base para pastas no Drive:', `/${driveSegments.join('/')}`);
  }
  if (explicitDriveEnv) {
    console.log('Valor da variável PRODUCT_IMAGE_DRIVE_PATH:', explicitDriveEnv);
  }
} catch (error) {
  console.error('Não foi possível determinar o diretório das imagens. Motivo:', error.message);
  process.exitCode = 1;
}
