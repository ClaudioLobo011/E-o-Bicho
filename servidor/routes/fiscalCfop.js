const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const FiscalCfop = require('../models/FiscalCfop');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const normalizeString = (value) => String(value || '').trim();

const normalizeHeader = (value) =>
  normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const normalizeCfop = (value) => normalizeString(value).replace(/\D/g, '');

const parseDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    }
  }
  const raw = normalizeString(value);
  if (!raw) return null;
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    return new Date(Date.UTC(year, month, day));
  }
  const isoDate = new Date(raw);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate;
  }
  return null;
};

const normalizeTipo = (value) => {
  const normalized = normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const hasEntrada = normalized.includes('entrada');
  const hasSaida = normalized.includes('saida');
  if (hasEntrada && hasSaida) return 'ambos';
  if (hasEntrada) return 'entrada';
  if (hasSaida) return 'saida';
  return 'ambos';
};

const resolveHeaderIndex = (headerRow = []) => {
  const index = {
    cfop: -1,
    descricao: -1,
    inicioVigencia: -1,
    tipo: -1,
    grupoCfop: -1,
  };

  headerRow.forEach((cell, position) => {
    const key = normalizeHeader(cell);
    if (!key) return;
    if (index.descricao === -1 && key.includes('descricao')) {
      index.descricao = position;
      return;
    }
    if (index.cfop === -1 && (key === 'cfop' || key.endsWith('cfop'))) {
      index.cfop = position;
      return;
    }
    if (index.inicioVigencia === -1 && (key.includes('vigencia') || key.includes('inicio'))) {
      index.inicioVigencia = position;
      return;
    }
    if (index.tipo === -1 && key === 'tipo') {
      index.tipo = position;
      return;
    }
    if (index.grupoCfop === -1 && key.includes('grupo') && key.includes('cfop')) {
      index.grupoCfop = position;
    }
  });

  return index;
};

const findHeaderRow = (rows = []) => {
  const maxScan = Math.min(rows.length, 6);
  for (let i = 0; i < maxScan; i += 1) {
    const index = resolveHeaderIndex(rows[i]);
    if (index.cfop !== -1 && index.descricao !== -1 && index.grupoCfop !== -1) {
      return { headerIndex: index, headerRowIndex: i };
    }
  }
  return { headerIndex: null, headerRowIndex: -1 };
};

router.get('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const tipoRaw = normalizeString(req.query?.tipo || '');
    const normalizedTipo = ['entrada', 'saida'].includes(tipoRaw) ? tipoRaw : '';
    const query = {};

    if (normalizedTipo) {
      query.tipo = { $in: [normalizedTipo, 'ambos'] };
    }

    const items = await FiscalCfop.find(query)
      .sort({ descricao: 1, cfop: 1 })
      .lean();

    res.json({ items });
  } catch (error) {
    console.error('Erro ao listar CFOPs:', error);
    res.status(500).json({ message: 'Erro ao listar CFOPs.' });
  }
});

router.post(
  '/import',
  requireAuth,
  authorizeRoles('admin', 'admin_master'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Nenhum arquivo foi enviado.' });
      }

      const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return res.status(400).json({ message: 'Planilha invalida ou vazia.' });
      }

      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!rows.length) {
        return res.status(400).json({ message: 'Planilha vazia.' });
      }

      const { headerIndex, headerRowIndex } = findHeaderRow(rows);
      if (!headerIndex) {
        return res.status(400).json({
          message: 'Colunas obrigatorias nao encontradas. Use CFOP, GRUPO CFOP e DESCRICAO_CFOP.',
        });
      }

      const operations = [];
      const errors = [];
      let processed = 0;

      rows.slice(headerRowIndex + 1).forEach((row, idx) => {
        const lineNumber = headerRowIndex + 2 + idx;
        const cfop = normalizeCfop(row[headerIndex.cfop]);
        const descricao = normalizeString(row[headerIndex.descricao]);
        const inicioVigencia = parseDateValue(row[headerIndex.inicioVigencia]);
        const tipo = normalizeTipo(row[headerIndex.tipo]);
        const grupoCfop = normalizeString(row[headerIndex.grupoCfop]);

        if (!cfop || !descricao) {
          errors.push({ line: lineNumber, reason: 'CFOP ou descricao invalida.' });
          return;
        }

        processed += 1;
        operations.push({
          updateOne: {
            filter: { cfop, tipo },
            update: {
              $set: {
                cfop,
                descricao,
                inicioVigencia,
                tipo,
                grupoCfop,
              },
              $setOnInsert: {
                ativo: false,
                bonificacao: false,
                tipoMovimentacao: 'normal',
                precoUtilizar: 'venda',
              },
            },
            upsert: true,
          },
        });
      });

      if (!operations.length) {
        return res.status(400).json({
          message: 'Nenhuma linha valida foi encontrada na planilha.',
          summary: { totalRows: 0, imported: 0, updated: 0, skippedInvalid: errors.length },
          errors,
        });
      }

      const result = await FiscalCfop.bulkWrite(operations, { ordered: false });

      res.json({
        summary: {
          totalRows: processed,
          imported: result.upsertedCount || 0,
          updated: result.modifiedCount || 0,
          skippedInvalid: errors.length,
        },
        errors,
      });
    } catch (error) {
      console.error('Erro ao importar CFOPs:', error);
      res.status(500).json({ message: 'Erro ao importar CFOPs.' });
    }
  }
);

router.patch('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};
    const update = {};

    if (typeof payload.ativo === 'boolean') update.ativo = payload.ativo;
    if (typeof payload.bonificacao === 'boolean') update.bonificacao = payload.bonificacao;
    if (typeof payload.tipoMovimentacao === 'string') update.tipoMovimentacao = payload.tipoMovimentacao;
    if (typeof payload.precoUtilizar === 'string') update.precoUtilizar = payload.precoUtilizar;

    const allowedMovements = new Set([
      'normal',
      'transferencia',
      'devolucao',
      'compra',
      'perda',
      'transformacao-cupom',
    ]);
    const allowedPrices = new Set(['venda', 'custo', 'medio']);

    if (update.tipoMovimentacao && !allowedMovements.has(update.tipoMovimentacao)) {
      return res.status(400).json({ message: 'Tipo de movimentacao invalido.' });
    }
    if (update.precoUtilizar && !allowedPrices.has(update.precoUtilizar)) {
      return res.status(400).json({ message: 'Preco utilizar invalido.' });
    }

    const updated = await FiscalCfop.findByIdAndUpdate(id, update, { new: true }).lean();
    if (!updated) {
      return res.status(404).json({ message: 'CFOP nao encontrado.' });
    }

    res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar CFOP:', error);
    res.status(500).json({ message: 'Erro ao atualizar CFOP.' });
  }
});

router.post('/bulk', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: 'Nenhuma alteracao informada.' });
    }

    const allowedMovements = new Set([
      'normal',
      'transferencia',
      'devolucao',
      'compra',
      'perda',
      'transformacao-cupom',
    ]);
    const allowedPrices = new Set(['venda', 'custo', 'medio']);

    const operations = [];
    const errors = [];

    items.forEach((item, index) => {
      if (!item || !item.id || !item.changes || typeof item.changes !== 'object') {
        errors.push({ index, reason: 'Item invalido.' });
        return;
      }

      const update = {};
      if (typeof item.changes.ativo === 'boolean') update.ativo = item.changes.ativo;
      if (typeof item.changes.bonificacao === 'boolean') update.bonificacao = item.changes.bonificacao;
      if (typeof item.changes.tipoMovimentacao === 'string' && allowedMovements.has(item.changes.tipoMovimentacao)) {
        update.tipoMovimentacao = item.changes.tipoMovimentacao;
      }
      if (typeof item.changes.precoUtilizar === 'string' && allowedPrices.has(item.changes.precoUtilizar)) {
        update.precoUtilizar = item.changes.precoUtilizar;
      }

      if (!Object.keys(update).length) {
        errors.push({ index, reason: 'Nenhuma alteracao valida.' });
        return;
      }

      operations.push({
        updateOne: {
          filter: { _id: item.id },
          update: { $set: update },
        },
      });
    });

    if (!operations.length) {
      return res.status(400).json({ message: 'Nenhuma alteracao valida para gravar.', errors });
    }

    const result = await FiscalCfop.bulkWrite(operations, { ordered: false });
    const updated = result.modifiedCount || 0;

    res.json({
      updated,
      errors,
      message: `Alteracoes gravadas: ${updated}.`,
    });
  } catch (error) {
    console.error('Erro ao gravar alteracoes em massa:', error);
    res.status(500).json({ message: 'Erro ao gravar alteracoes em massa.' });
  }
});

module.exports = router;
