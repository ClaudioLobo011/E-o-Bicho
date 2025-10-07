#!/usr/bin/env node

const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('../config/db');
const PdvState = require('../models/PdvState');
const Pdv = require('../models/Pdv');
const Store = require('../models/Store');
const { moveFileToFolder } = require('../utils/googleDrive');
const { buildFiscalDrivePath } = require('../utils/fiscalDrivePath');
const { buildFiscalXmlFileName, sanitizeFiscalXmlBaseName } = require('../utils/fiscalXmlFileName');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const isDryRun = process.argv.includes('--dry-run');

const DRIVE_ID_MIN_LENGTH = 15;
const DRIVE_ID_REGEX = new RegExp(`^[A-Za-z0-9_-]{${DRIVE_ID_MIN_LENGTH},}$`);
const DRIVE_PATH_REGEXES = [
  /\/d\/([A-Za-z0-9_-]{15,})/i,
  /\/file\/d\/([A-Za-z0-9_-]{15,})/i,
  /\/folders\/([A-Za-z0-9_-]{15,})/i,
];

const flatten = (values) => {
  const result = [];
  const queue = Array.isArray(values) ? [...values] : [values];
  while (queue.length) {
    const value = queue.shift();
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }
    if (value !== undefined && value !== null) {
      result.push(value);
    }
  }
  return result;
};

const looksLikeDriveId = (value) => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return DRIVE_ID_REGEX.test(trimmed);
};

const extractDriveFileId = (...candidates) => {
  const inputs = flatten(candidates);

  for (const raw of inputs) {
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      continue;
    }

    const candidate = String(raw).trim();
    if (!candidate) {
      continue;
    }

    if (looksLikeDriveId(candidate)) {
      return candidate;
    }

    let parsedUrl = null;
    try {
      parsedUrl = new URL(candidate);
    } catch (error) {
      parsedUrl = null;
    }

    if (parsedUrl) {
      const queryCandidates = ['id', 'fileId', 'fid'];
      for (const key of queryCandidates) {
        const value = parsedUrl.searchParams.get(key);
        if (typeof value === 'string' && looksLikeDriveId(value)) {
          return value.trim();
        }
      }

      const path = parsedUrl.pathname || '';
      for (const pattern of DRIVE_PATH_REGEXES) {
        const match = path.match(pattern);
        if (match && typeof match[1] === 'string' && looksLikeDriveId(match[1])) {
          return match[1].trim();
        }
      }

      const pathSegments = path.split('/').filter(Boolean);
      for (const segment of pathSegments) {
        if (typeof segment === 'string' && looksLikeDriveId(segment)) {
          return segment.trim();
        }
      }
    }

    const matches = candidate.match(/[A-Za-z0-9_-]{15,}/g) || [];
    for (const match of matches) {
      if (typeof match === 'string' && looksLikeDriveId(match)) {
        return match.trim();
      }
    }
  }

  return null;
};

const toMap = (items) => {
  const map = new Map();
  items.forEach((item) => {
    if (item && item._id) {
      map.set(String(item._id), item);
    }
  });
  return map;
};

const resolveEmissionDate = (sale = {}) => {
  const candidates = [sale.fiscalEmittedAt, sale.createdAt];
  for (const candidate of candidates) {
    const date = candidate instanceof Date ? candidate : candidate ? new Date(candidate) : null;
    if (date instanceof Date && !Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return new Date();
};

async function run() {
  await connectDB();

  const states = await PdvState.find(
    {
      completedSales: {
        $elemMatch: {
          $or: [
            { fiscalDriveFileId: { $exists: true } },
            { fiscalXmlUrl: { $exists: true } },
          ],
        },
      },
    },
    { pdv: 1, empresa: 1, completedSales: 1 }
  ).lean();

  if (!states.length) {
    const statesWithSales = await PdvState.countDocuments({ 'completedSales.0': { $exists: true } });
    if (statesWithSales > 0) {
      console.log(
        'Nenhuma venda fiscal com referência ao Google Drive foi localizada. Verifique se os registros possuem o campo fiscalDriveFileId ou fiscalXmlUrl preenchido.',
      );
    } else {
      console.log('Nenhuma venda fiscal com arquivo no Drive foi encontrada.');
    }
    process.exit(0);
  }

  const pdvIds = new Set();
  const storeIds = new Set();
  states.forEach((state) => {
    if (state?.pdv) {
      pdvIds.add(String(state.pdv));
    }
    if (state?.empresa) {
      storeIds.add(String(state.empresa));
    }
  });

  const pdvs = await Pdv.find(
    { _id: { $in: Array.from(pdvIds) } },
    { codigo: 1, nome: 1 }
  ).lean();
  const stores = await Store.find(
    { _id: { $in: Array.from(storeIds) } },
    { nomeFantasia: 1, nome: 1, razaoSocial: 1, cnpj: 1 }
  ).lean();

  const pdvMap = toMap(pdvs);
  const storeMap = toMap(stores);

  let processed = 0;
  let moved = 0;
  let skipped = 0;
  let errors = 0;
  let skippedMissingContext = 0;
  let skippedMissingId = 0;
  let renameCandidates = 0;
  let renamed = 0;

  for (const state of states) {
    const store = storeMap.get(String(state?.empresa || '')) || null;
    const pdv = pdvMap.get(String(state?.pdv || '')) || null;

    for (const sale of state.completedSales || []) {
      const hasDriveReference = [sale?.fiscalDriveFileId, sale?.fiscalXmlUrl].some((value) => {
        if (typeof value !== 'string') {
          return false;
        }
        return value.trim().length > 0;
      });

      if (!hasDriveReference) {
        continue;
      }

      processed += 1;

      if (!pdv) {
        skipped += 1;
        skippedMissingContext += 1;
        if (processed <= 10 || isDryRun) {
          const stateId = state?._id ? String(state._id) : 'desconhecido';
          console.warn(
            `PDV não encontrado para o estado ${stateId}. Venda ${sale?.id || 'sem-id'} ignorada.`,
          );
        }
        continue;
      }

      const driveFileId = extractDriveFileId(sale?.fiscalDriveFileId, sale?.fiscalXmlUrl);
      if (!driveFileId) {
        skipped += 1;
        skippedMissingId += 1;
        if (processed <= 10 || isDryRun) {
          console.warn(
            `ID do arquivo do Drive não encontrado para a venda ${sale?.id || 'sem-id'} (PDV ${
              pdv?.codigo || pdv?._id || 'desconhecido'
            }).`,
          );
        }
        continue;
      }

      const emissionDate = resolveEmissionDate(sale);
      const folderPath = buildFiscalDrivePath({ store, pdv, emissionDate });
      const accessKeyBase = sanitizeFiscalXmlBaseName(sale?.fiscalAccessKey || '', '');
      const renameTargetName = accessKeyBase
        ? buildFiscalXmlFileName({
            accessKey: sale.fiscalAccessKey,
            saleCode: sale.saleCode || sale.saleCodeLabel || sale.id || '',
            emissionDate,
          })
        : null;

      if (renameTargetName) {
        renameCandidates += 1;
      }

      const targetLabel = folderPath.join(' / ');
      const idSourceLabel = sale?.fiscalDriveFileId?.trim() ? 'id informado' : 'id extraído do link';
      const renameLabel = renameTargetName ? `, renomear para ${renameTargetName}` : '';

      if (isDryRun) {
        moved += 1;
        console.log(`[DRY-RUN] ${driveFileId} -> ${targetLabel}${renameLabel} (${idSourceLabel})`);
        continue;
      }

      try {
        const result = await moveFileToFolder(driveFileId, {
          folderPath,
          newName: renameTargetName || undefined,
        });
        moved += 1;
        if (renameTargetName) {
          if (result?.name === renameTargetName) {
            renamed += 1;
          } else {
            console.warn(
              `Arquivo ${driveFileId} movido, mas o nome retornado foi ${result?.name || 'desconhecido'} (esperado ${renameTargetName}).`,
            );
          }
        }
        console.log(`Movido ${driveFileId} -> ${targetLabel}${renameLabel} (${idSourceLabel})`);
      } catch (error) {
        errors += 1;
        console.error(`Erro ao mover arquivo ${driveFileId}:`, error?.message || error);
      }
    }
  }

  console.log('Resumo da reorganização:');
  console.log(`- Arquivos analisados: ${processed}`);
  console.log(`- Arquivos movidos${isDryRun ? ' (simulados)' : ''}: ${moved}`);
  console.log(`- Registros ignorados: ${skipped}`);
  if (skippedMissingContext) {
    console.log(`  - Sem PDV associado: ${skippedMissingContext}`);
  }
  if (skippedMissingId) {
    console.log(`  - Sem ID no Drive: ${skippedMissingId}`);
  }
  console.log(`- Falhas: ${errors}`);
  if (renameCandidates) {
    if (isDryRun) {
      console.log(`- Arquivos que seriam renomeados para a chave de acesso: ${renameCandidates}`);
    } else {
      console.log(`- Arquivos com chave de acesso identificada: ${renameCandidates}`);
      console.log(`  - Renomeados com sucesso: ${renamed}`);
    }
  }

  process.exit(errors ? 1 : 0);
}

run().catch((error) => {
  console.error('Erro ao reorganizar pastas fiscais:', error);
  process.exit(1);
});
