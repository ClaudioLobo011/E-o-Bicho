const express = require('express');
const router = express.Router();
const Banner = require('../models/Banner');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

// Configuração do Multer para upload de imagens dos banners
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'public/uploads/banners';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `banner-${Date.now()}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage: storage });

// ROTA: GET /api/banners - Busca todos os banners ordenados (pública)
router.get('/', async (req, res) => {
    try {
        const banners = await Banner.find({}).sort({ order: 1 });
        res.json(banners);
    } catch (error) {
        console.error('Erro ao buscar banners:', error);
        res.status(500).json({ message: 'Erro ao buscar banners.' });
    }
});

// ROTA: POST /api/banners - Cria um novo banner (apenas admin/admin_master)
router.post(
    '/',
    requireAuth,
    authorizeRoles('admin', 'admin_master'),
    upload.fields([
        { name: 'bannerImage', maxCount: 1 },
        { name: 'bannerImageMobile', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const desktopImage = req.files?.bannerImage?.[0];
            const mobileImage = req.files?.bannerImageMobile?.[0];

            if (!desktopImage) {
                return res.status(400).json({ message: 'Nenhum ficheiro de imagem enviado.' });
            }
            const { title, subtitle, buttonText, link } = req.body;
            const newBanner = new Banner({
                imageUrl: `/uploads/banners/${desktopImage.filename}`,
                mobileImageUrl: mobileImage ? `/uploads/banners/${mobileImage.filename}` : '',
                title,
                subtitle,
                buttonText,
                link
            });
            await newBanner.save();
            res.status(201).json(newBanner);
        } catch (error) {
            console.error('Erro ao criar banner:', error);
            res.status(500).json({ message: 'Erro ao criar banner.' });
        }
    }
);

// ROTA: DELETE /api/banners/:id - Apaga um banner (apenas admin/admin_master)
router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        await Banner.findByIdAndDelete(req.params.id);
        res.json({ message: 'Banner apagado com sucesso.' });
    } catch (error) {
        console.error('Erro ao apagar banner:', error);
        res.status(500).json({ message: 'Erro ao apagar banner.' });
    }
});

// ROTA: PUT /api/banners/order - Atualiza a ordem dos banners (apenas admin/admin_master)
router.put('/order', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const { orderedIds } = req.body;
        const bulkOps = orderedIds.map((id, index) => ({
            updateOne: {
                filter: { _id: id },
                update: { $set: { order: index } }
            }
        }));
        await Banner.bulkWrite(bulkOps);
        res.json({ message: 'Ordem dos banners atualizada.' });
    } catch (error) {
        console.error('Erro ao reordenar banners:', error);
        res.status(500).json({ message: 'Erro ao reordenar banners.' });
    }
});

module.exports = router;
