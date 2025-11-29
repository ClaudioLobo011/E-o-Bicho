const express = require('express');
const router = express.Router();
const SearchTerm = require('../models/SearchTerm');
const Product = require('../models/Product');
const { applyProductImageUrls } = require('../utils/productImageUrl');

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// POST /api/search/track { term }
router.post('/track', async (req, res) => {
  try {
    const termRaw = String(req.body?.term || '').trim();
    if (!termRaw) return res.json({ ok: true });
    const term = normalize(termRaw);
    const update = {
      $set: { lastSearchedAt: new Date(), original: termRaw },
      $inc: { count: 1 },
    };
    await SearchTerm.findOneAndUpdate({ term }, update, { upsert: true, new: true });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Falha ao registrar busca' });
  }
});

// GET /api/search/top?limit=5
router.get('/top', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 5, 20));
    const terms = await SearchTerm.find({}).sort({ count: -1, lastSearchedAt: -1 }).limit(limit).lean();
    res.json(terms.map(t => t.original || t.term));
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Falha ao obter termos' });
  }
});

// GET /api/search/suggest?q=...
router.get('/suggest', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 4, 10));
    const norm = normalize(q);
    let terms = [];
    if (norm) {
      terms = await SearchTerm.find({ term: { $regex: '^' + norm } })
        .sort({ count: -1, lastSearchedAt: -1 })
        .limit(limit)
        .lean();
    }
    const termList = terms.map(t => t.original || t.term);

    // Produtos sugeridos (usa searchableString)
    const productFilters = { naoMostrarNoSite: { $ne: true } };
    if (norm) {
      productFilters.searchableString = { $regex: norm, $options: 'i' };
    }

    const products = await Product.find(productFilters)
      .limit(limit)
      .sort({ nome: 1 })
      .lean();
    products.forEach(applyProductImageUrls);

    res.json({ terms: termList, products });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Falha nas sugestões' });
  }
});

module.exports = router;

