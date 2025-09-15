const express = require('express');
const router = express.Router();
const Store = require('../models/Store');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

// Configuração do Multer para upload de imagens das lojas
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'public/uploads/stores';
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, `store-${req.params.id}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage: storage });

// GET /api/stores - Público
router.get('/', async (req, res) => {
    try {
        const stores = await Store.find({}).sort({ nome: 1 });
        res.json(stores);
    } catch (error) { 
        console.error("Erro ao buscar lojas:", error);
        res.status(500).json({ message: 'Erro no servidor.' }); 
    }
});

// GET /api/stores/:id - Público
router.get('/:id', async (req, res) => {
    try {
        const store = await Store.findById(req.params.id);
        if (!store) return res.status(404).json({ message: 'Loja não encontrada.' });
        res.json(store);
    } catch (error) { 
        console.error("Erro ao buscar loja:", error);
        res.status(500).json({ message: 'Erro no servidor.' }); 
    }
});

// POST /api/stores - Criar loja (restrito)
router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const newStore = new Store(req.body);
        const savedStore = await newStore.save();
        res.status(201).json(savedStore);
    } catch (error) { 
        console.error("Erro ao criar loja:", error);
        res.status(500).json({ message: 'Erro ao criar loja.' }); 
    }
});

// PUT /api/stores/:id - Atualizar loja (restrito)
router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const updatedStore = await Store.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updatedStore) return res.status(404).json({ message: 'Loja não encontrada.' });
        res.json(updatedStore);
    } catch (error) { 
        console.error("Erro ao atualizar loja:", error);
        res.status(500).json({ message: 'Erro ao atualizar loja.' }); 
    }
});

// DELETE /api/stores/:id - Deletar loja (restrito)
router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const deletedStore = await Store.findByIdAndDelete(req.params.id);
        if (!deletedStore) return res.status(404).json({ message: 'Loja não encontrada.' });
        res.json({ message: 'Loja apagada com sucesso.' });
    } catch (error) { 
        console.error("Erro ao apagar loja:", error);
        res.status(500).json({ message: 'Erro ao apagar loja.' }); 
    }
});

// POST /api/stores/:id/upload - Upload de imagem (restrito)
router.post('/:id/upload', requireAuth, authorizeRoles('admin', 'admin_master'), upload.single('imagem'), async (req, res) => {
    try {
        const store = await Store.findById(req.params.id);
        if (!store) {
            return res.status(404).json({ message: 'Loja não encontrada.' });
        }
        store.imagem = `/uploads/stores/${req.file.filename}`;
        await store.save();
        res.json(store);
    } catch (error) {
        console.error("Erro no upload da imagem da loja:", error);
        res.status(500).json({ message: 'Erro no servidor ao fazer upload da imagem.' });
    }
});

module.exports = router;
