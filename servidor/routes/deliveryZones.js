const express = require('express');
const router = express.Router();
const DeliveryZone = require('../models/DeliveryZone');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

// GET /api/delivery-zones/by-store/:storeId - Todas as zonas da loja (pública)
router.get('/by-store/:storeId', async (req, res) => {
    try {
        const zones = await DeliveryZone.find({ store: req.params.storeId });
        res.json(zones);
    } catch (error) {
        console.error('Erro ao buscar zonas:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// POST /api/delivery-zones - Cria nova zona (restrito a admin/admin_master)
router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const { store, nome, tipo, raioKm, bairros, gratis } = req.body;
        const newZone = new DeliveryZone({ store, nome, tipo, raioKm, bairros, gratis });
        await newZone.save();
        res.status(201).json(newZone);
    } catch (error) {
        console.error('Erro ao salvar zona:', error);
        res.status(500).json({ message: 'Erro ao salvar a zona de entrega.' });
    }
});

// PUT /api/delivery-zones/:id - Atualiza zona existente (restrito a admin/admin_master)
router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const { store, nome, tipo, raioKm, bairros, gratis } = req.body;

        const updatedZone = await DeliveryZone.findByIdAndUpdate(
            req.params.id,
            { store, nome, tipo, raioKm, bairros, gratis },
            { new: true, runValidators: true }
        );

        if (!updatedZone) {
            return res.status(404).json({ message: 'Zona não encontrada.' });
        }

        res.json(updatedZone);
    } catch (error) {
        console.error('Erro ao atualizar zona:', error);
        res.status(500).json({ message: 'Erro ao atualizar a zona de entrega.' });
    }
});

// DELETE /api/delivery-zones/:id (restrito a admin/admin_master)
router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const deleted = await DeliveryZone.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: 'Zona não encontrada.' });
        res.json({ message: 'Zona excluída com sucesso.' });
    } catch (error) {
        console.error('Erro ao excluir zona:', error);
        res.status(500).json({ message: 'Erro ao excluir a zona de entrega.' });
    }
});

module.exports = router;
