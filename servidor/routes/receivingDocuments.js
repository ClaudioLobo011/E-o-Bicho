const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Photo = require('../models/ReceivingPhoto');
const Extraction = require('../models/ReceivingExtraction');
const { extractPhoto, detectDuplicatePages, imageMetadata, parseDocumentText } = require('../services/receivingPhotoExtraction');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 8, fields: 2 } });
const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const validId = id => mongoose.isValidObjectId(id) && /^[a-f0-9]{24}$/i.test(String(id));
const imageBytes = data => Buffer.isBuffer(data) ? data : Buffer.from(data.buffer || data);
let pendingJobs = 0;
let jobQueue = Promise.resolve();

function photoView(photo) {
  return { id: String(photo._id), name: photo.name, sha256: photo.sha256, width: photo.width, height: photo.height, size: photo.size,
    status: photo.extraction ? 'extracted' : 'uploaded', url: `/api/receiving/receipts/${photo.receiptId}/photos/${photo._id}/content` };
}

function createRouter({ authenticateReceiving, findReceipt, PhotoModel = Photo, ExtractionModel = Extraction, extractor = extractPhoto }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
  const access = asyncRoute(async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Recebimento inválido.' });
    req.receivingReceipt = await findReceipt(req, req.params.id);
    if (!req.receivingReceipt) return res.status(404).json({ message: 'Recebimento não encontrado.' });
    next();
  });
  const editable = (req, res, next) => {
    if (req.receivingReceipt.status !== 'draft') return res.status(409).json({ message: 'Recebimento encerrado. As fotos existentes continuam disponíveis.' });
    next();
  };
  router.get('/capabilities', authenticateReceiving, (_req, res) => res.json({ photoImport: { available: true, provider: 'tesseract-local', requiresReview: true, maxPhotos: 8, maxPhotoBytes: 8 * 1024 * 1024 } }));
  router.post('/receipts/:id/parse-text', authenticateReceiving, access, editable, asyncRoute(async (req, res) => {
    if (typeof req.body?.text !== 'string' || req.body.text.length > 120000) return res.status(400).json({ message: 'Informe um texto com até 120 mil caracteres.' });
    const photoId = req.body.photoId || '';
    if (photoId && (!validId(photoId) || !await PhotoModel.exists({ _id: photoId, receiptId: req.params.id }))) return res.status(404).json({ message: 'Foto não encontrada neste recebimento.' });
    res.json({ extraction: parseDocumentText(req.body.text, photoId) });
  }));
  router.get('/receipts/:id/photos', authenticateReceiving, access, asyncRoute(async (req, res) => {
    const photos = await PhotoModel.find({ receiptId: req.params.id }).select('receiptId name sha256 width height size extraction.provider createdAt').sort({ createdAt: 1 }).lean();
    res.json({ photos: photos.map(photoView) });
  }));
  router.post('/receipts/:id/photos', authenticateReceiving, access, editable, upload.array('photos', 8), asyncRoute(async (req, res) => {
    if (!req.files?.length) return res.status(400).json({ message: 'Selecione ao menos uma foto JPG, PNG ou WebP.' });
    const count = await PhotoModel.countDocuments({ receiptId: req.params.id });
    if (count + req.files.length > 40) return res.status(400).json({ message: 'Limite de 40 fotos por recebimento.' });
    const parsed = await Promise.all(req.files.map(async file => ({ file, meta: await imageMetadata(file.buffer) })));
    const photos = [];
    for (const { file, meta } of parsed) {
      const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const photo = await PhotoModel.findOneAndUpdate({ receiptId: req.params.id, sha256 }, { $setOnInsert: {
        name: String(file.originalname || 'foto').replace(/[\x00-\x1f\\/]/g, '_').slice(0, 180), ...meta,
        size: file.buffer.length, data: file.buffer, uploadedBy: String(req.user?.id || ''),
      } }, { upsert: true, new: true, setDefaultsOnInsert: true });
      photos.push(photoView(photo));
    }
    res.status(201).json({ photos });
  }));
  router.get('/receipts/:id/photos/:photoId/content', authenticateReceiving, access, asyncRoute(async (req, res) => {
    if (!validId(req.params.photoId)) return res.status(404).json({ message: 'Foto não encontrada.' });
    const photo = await PhotoModel.findOne({ _id: req.params.photoId, receiptId: req.params.id }).select('+data').lean();
    if (!photo) return res.status(404).json({ message: 'Foto não encontrada.' });
    res.set({ 'Content-Type': photo.contentType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(imageBytes(photo.data));
  }));
  router.post('/receipts/:id/extract', authenticateReceiving, access, editable, asyncRoute(async (req, res) => {
    const ids = req.body?.photoIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 8 || ids.some(id => !validId(id)) || new Set(ids).size !== ids.length) return res.status(400).json({ message: 'Escolha de 1 a 8 fotos diferentes.' });
    if (pendingJobs >= 5) return res.status(429).json({ message: 'Há fotos em processamento. Aguarde um momento e tente novamente.' });
    const photos = await PhotoModel.find({ receiptId: req.params.id, _id: { $in: ids } }).select('_id').lean();
    if (photos.length !== ids.length) return res.status(404).json({ message: 'Uma das fotos não pertence a este recebimento.' });
    const job = await ExtractionModel.create({ receiptId: req.params.id, photoIds: ids });
    pendingJobs += 1;
    jobQueue = jobQueue.catch(() => {}).then(async () => {
      try {
        const pages = [];
        for (const id of ids) {
          const photo = await PhotoModel.findById(id).select('+data').lean();
          if (!photo) throw new Error('Foto indisponível durante a leitura.');
          const page = photo.extraction || await extractor(imageBytes(photo.data), id);
          if (!photo.extraction) await PhotoModel.updateOne({ _id: id }, { $set: { extraction: page } });
          pages.push(page);
        }
        const checkedPages = detectDuplicatePages(pages);
        const extraction = { pages: checkedPages, lines: checkedPages.filter(page => page.selected).flatMap(page => page.lines),
          warnings: ['Confira se todas as páginas e linhas do documento foram fotografadas. Fotos repetidas não devem ser importadas duas vezes.', ...new Set(checkedPages.flatMap(page => page.warnings))] };
        await ExtractionModel.updateOne({ _id: job._id }, { $set: { status: 'completed', extraction } });
      } catch (error) {
        await ExtractionModel.updateOne({ _id: job._id }, { $set: { status: 'failed', message: error.status === 422 ? error.message : 'Não foi possível ler a foto. Tente novamente ou importe uma lista revisada.' } }).catch(() => {});
      } finally { pendingJobs -= 1; }
    });
    res.status(202).json({ jobId: String(job._id), status: 'processing' });
  }));
  router.get('/receipts/:id/extractions/:jobId', authenticateReceiving, access, asyncRoute(async (req, res) => {
    if (!validId(req.params.jobId)) return res.status(404).json({ message: 'Leitura não encontrada.' });
    let job = await ExtractionModel.findOne({ _id: req.params.jobId, receiptId: req.params.id }).lean();
    if (!job) return res.status(404).json({ message: 'Leitura não encontrada.' });
    if (job.status === 'processing' && Date.now() - new Date(job.updatedAt).getTime() > 30 * 60 * 1000) {
      await ExtractionModel.updateOne({ _id: job._id, status: 'processing' }, { $set: { status: 'failed', message: 'Leitura interrompida. Solicite a leitura novamente.' } });
      job = await ExtractionModel.findById(job._id).lean();
    }
    res.json({ jobId: String(job._id), status: job.status, extraction: job.extraction, message: job.message });
  }));
  router.use((error, _req, res, _next) => {
    const status = error instanceof multer.MulterError ? 400 : (error.status || error.statusCode || 500);
    res.status(status).json({ message: error instanceof multer.MulterError ? 'Envie até 8 fotos, com no máximo 8 MB cada.' : status < 500 ? error.message : 'Não foi possível processar as fotos.' });
  });
  return router;
}

module.exports = createRouter;
module.exports.createRouter = createRouter;
