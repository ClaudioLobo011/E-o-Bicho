const express = require('express');
const router = express.Router();
const Banner = require('../models/Banner');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const {
    uploadBufferToDrive,
    isDriveConfigured,
    deleteFile,
} = require('../utils/googleDrive');
const {
    isR2Configured,
    uploadBufferToR2,
    deleteObjectFromR2,
    buildPublicUrl,
} = require('../utils/cloudflareR2');

const bannerFolderEnv = process.env.BANNER_DRIVE_FOLDER_PATH || process.env.BANNER_DRIVE_FOLDER || 'banner/imagem';
const bannerFolderSegments = bannerFolderEnv
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean);
const bannerDrivePath = bannerFolderSegments.length ? bannerFolderSegments : ['banners'];

function buildDriveViewLink(fileId) {
    const trimmedId = typeof fileId === 'string' ? fileId.trim() : '';
    return trimmedId ? `https://drive.google.com/uc?id=${trimmedId}&export=view` : '';
}

function buildBannerFileName(originalName) {
    const ext = path.extname(originalName || '').toLowerCase();
    return `banner-${Date.now()}${ext || '.png'}`;
}

const useMemoryStorage = isDriveConfigured() || isR2Configured();
const storage = useMemoryStorage
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = 'public/uploads/banners';
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            cb(null, buildBannerFileName(file.originalname));
        }
    });
const upload = multer({ storage: storage });

// ROTA: GET /api/banners - Busca todos os banners ordenados (pública)
router.get('/', async (req, res) => {
    try {
        const banners = await Banner.find({}).sort({ order: 1 }).lean();

        const bannersWithUrls = banners.map(banner => ({
            ...banner,
            imageUrl:
                buildPublicUrl(banner.imageR2Key) ||
                banner.imageUrl ||
                buildDriveViewLink(banner.imageDriveFileId),
            mobileImageUrl:
                buildPublicUrl(banner.mobileImageR2Key) ||
                banner.mobileImageUrl ||
                buildDriveViewLink(banner.mobileImageDriveFileId)
        }));

        res.json(bannersWithUrls);
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

            let desktopImageUrl = '';
            let mobileImageUrl = '';
            let desktopDriveFileId = '';
            let mobileDriveFileId = '';
            let desktopDrivePath = '';
            let mobileDrivePath = '';
            let desktopR2Key = '';
            let mobileR2Key = '';

            if (isR2Configured()) {
                const desktopName = buildBannerFileName(desktopImage.originalname);
                const desktopKey = [...bannerDrivePath, desktopName].join('/');
                const desktopUpload = await uploadBufferToR2(desktopImage.buffer, {
                    key: desktopKey,
                    contentType: desktopImage.mimetype,
                });
                desktopR2Key = desktopUpload?.key || desktopKey;
                desktopImageUrl = desktopUpload?.url || buildPublicUrl(desktopR2Key);

                if (mobileImage) {
                    const mobileName = buildBannerFileName(mobileImage.originalname);
                    const mobileKey = [...bannerDrivePath, mobileName].join('/');
                    const mobileUpload = await uploadBufferToR2(mobileImage.buffer, {
                        key: mobileKey,
                        contentType: mobileImage.mimetype,
                    });
                    mobileR2Key = mobileUpload?.key || mobileKey;
                    mobileImageUrl = mobileUpload?.url || buildPublicUrl(mobileR2Key);
                }
            } else if (isDriveConfigured()) {
                const desktopName = buildBannerFileName(desktopImage.originalname);
                const desktopUpload = await uploadBufferToDrive(desktopImage.buffer, {
                    mimeType: desktopImage.mimetype,
                    name: desktopName,
                    folderPath: bannerDrivePath,
                });
                desktopDriveFileId = desktopUpload?.id || '';
                desktopImageUrl = buildDriveViewLink(desktopDriveFileId) || desktopUpload?.webContentLink || desktopUpload?.webViewLink || '';
                desktopDrivePath = `/${bannerDrivePath.join('/')}/${desktopName}`;

                if (mobileImage) {
                    const mobileName = buildBannerFileName(mobileImage.originalname);
                    const mobileUpload = await uploadBufferToDrive(mobileImage.buffer, {
                        mimeType: mobileImage.mimetype,
                        name: mobileName,
                        folderPath: bannerDrivePath,
                    });
                    mobileDriveFileId = mobileUpload?.id || '';
                    mobileImageUrl = buildDriveViewLink(mobileDriveFileId) || mobileUpload?.webContentLink || mobileUpload?.webViewLink || '';
                    mobileDrivePath = `/${bannerDrivePath.join('/')}/${mobileName}`;
                }
            } else {
                desktopImageUrl = `/uploads/banners/${desktopImage.filename}`;
                mobileImageUrl = mobileImage ? `/uploads/banners/${mobileImage.filename}` : '';
            }

            const newBanner = new Banner({
                imageUrl: desktopImageUrl,
                imageDriveFileId: desktopDriveFileId,
                imageDrivePath: desktopDrivePath,
                mobileImageUrl: mobileImageUrl,
                mobileImageDriveFileId: mobileDriveFileId,
                mobileImageDrivePath: mobileDrivePath,
                imageR2Key: desktopR2Key,
                mobileImageR2Key: mobileR2Key,
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
        const banner = await Banner.findById(req.params.id);
        if (!banner) {
            return res.status(404).json({ message: 'Banner não encontrado.' });
        }

        await Banner.findByIdAndDelete(req.params.id);

        if (isR2Configured()) {
            const keysToDelete = [banner.imageR2Key, banner.mobileImageR2Key]
                .map(value => (typeof value === 'string' ? value.trim() : ''))
                .filter(Boolean);
            await Promise.allSettled(keysToDelete.map(key => deleteObjectFromR2(key)));
        } else if (isDriveConfigured()) {
            const driveIds = [banner.imageDriveFileId, banner.mobileImageDriveFileId]
                .map(value => (typeof value === 'string' ? value.trim() : ''))
                .filter(Boolean);
            await Promise.allSettled(driveIds.map(id => deleteFile(id)));
        }

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
