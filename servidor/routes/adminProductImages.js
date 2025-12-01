const express = require('express');
const multer = require('multer');
const router = express.Router();
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const { verifyAndLinkProductImages, uploadLocalProductImages } = require('../services/productImageVerification');

const LOG_LIMIT = 500;

let lastResult = null;
let currentResult = null;
let isProcessing = false;
const upload = multer({ storage: multer.memoryStorage() });
const uploadAnyField = upload.any();

function createEmptyResult() {
  const startedAt = new Date().toISOString();

  return {
    logs: [],
    data: {
      summary: {
        linked: 0,
        already: 0,
        products: 0,
        images: 0,
      },
      products: [],
      startedAt,
      finishedAt: null,
      status: 'processing',
      error: null,
    },
    meta: {
      totalProducts: 0,
      processedProducts: 0,
    },
  };
}

function buildLogEntry(message, type = 'info') {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    message,
    type,
    timestamp: new Date().toISOString(),
  };
}

function appendLog(result, entry) {
  if (!result || !entry) {
    return;
  }

  result.logs.push(entry);
  if (result.logs.length > LOG_LIMIT) {
    result.logs = result.logs.slice(-LOG_LIMIT);
  }
}

function applyProgress(result, progress) {
  if (!result || !progress) {
    return;
  }

  if (progress.summary) {
    result.data.summary = {
      ...result.data.summary,
      ...progress.summary,
    };
  }

  if (progress.meta) {
    result.meta = {
      ...result.meta,
      ...progress.meta,
    };
  }
}

function upsertProduct(result, product) {
  if (!result || !product) {
    return;
  }

  const existingIndex = result.data.products.findIndex((item) => item.id === product.id);
  if (existingIndex >= 0) {
    result.data.products[existingIndex] = product;
    return;
  }

  result.data.products.push(product);
}

router.get('/imagens/status', requireAuth, authorizeRoles('funcionario', 'admin', 'admin_master'), (req, res) => {
  const payload = currentResult || lastResult;

  if (!payload) {
    return res.status(404).json({ message: 'Nenhuma verificação anterior foi encontrada.' });
  }

  return res.json(payload);
});

router.post('/imagens/verificar', requireAuth, authorizeRoles('funcionario', 'admin', 'admin_master'), (req, res) => {
  if (isProcessing) {
    return res.status(409).json({ message: 'Uma verificação já está em andamento. Aguarde a conclusão.' });
  }

  isProcessing = true;
  const sharedResult = createEmptyResult();
  currentResult = sharedResult;
  lastResult = sharedResult;

  verifyAndLinkProductImages({
    onLog: (entry) => {
      appendLog(sharedResult, entry);
    },
    onStart: ({ totalProducts }) => {
      sharedResult.meta.totalProducts = Number(totalProducts) || 0;
    },
    onProgress: (progress) => {
      applyProgress(sharedResult, progress);
    },
    onProduct: (product) => {
      upsertProduct(sharedResult, product);
    },
  })
    .then((result) => {
      if (result && typeof result === 'object') {
        if (Array.isArray(result.logs)) {
          sharedResult.logs = result.logs.slice(-LOG_LIMIT);
        }

        if (result.data) {
          sharedResult.data = {
            ...sharedResult.data,
            ...result.data,
            status: result.data.status || 'completed',
          };
        } else {
          sharedResult.data.status = 'completed';
        }

        if (result.meta) {
          sharedResult.meta = {
            ...sharedResult.meta,
            ...result.meta,
          };
        }
      }

      lastResult = sharedResult;
    })
    .catch((error) => {
      console.error('Erro ao verificar imagens de produtos:', error);
      const message = error?.message || 'Falha ao executar a verificação de imagens.';
      appendLog(sharedResult, buildLogEntry(message, 'error'));
      sharedResult.data.status = 'failed';
      sharedResult.data.error = message;
    })
    .finally(() => {
      sharedResult.data.finishedAt = new Date().toISOString();
      lastResult = sharedResult;
      currentResult = null;
      isProcessing = false;
    });

  return res.status(202).json({
    message: 'Verificação iniciada.',
    startedAt: sharedResult.data.startedAt,
    status: sharedResult.data.status,
  });
});

router.post(
  '/imagens/upload-local',
  requireAuth,
  authorizeRoles('funcionario', 'admin', 'admin_master'),
  uploadAnyField,
  async (req, res) => {
    try {
      const files = Array.isArray(req.files)
        ? req.files
        : Object.values(req.files || {}).flat();

      const result = await uploadLocalProductImages(files || []);

      lastResult = result;

      const payload = {
        message: 'Upload concluído.',
        ...result,
        summary: result?.data?.summary || {},
        products: result?.data?.products || [],
      };

      if (result?.data?.status === 'failed') {
        return res.status(400).json(payload);
      }

      return res.json(payload);
    } catch (error) {
      console.error('Erro ao receber upload de imagens locais:', error);
      return res.status(500).json({ message: error?.message || 'Falha ao processar o upload de imagens.' });
    }
  }
);

module.exports = router;
