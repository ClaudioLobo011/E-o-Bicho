const express = require('express');
const router = express.Router();
const Vehicle = require('../models/Vehicle');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

// GET /api/vehicles - Público (usado no cálculo de frete)
router.get('/', async (req, res) => {
    try {
        const vehicles = await Vehicle.find({});
        res.json(vehicles);
    } catch (error) { 
        console.error("Erro ao buscar veículos:", error);
        res.status(500).json({ message: 'Erro no servidor.' }); 
    }
});

// POST /api/vehicles - Criar veículo (restrito)
router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const newVehicle = new Vehicle(req.body);
        const savedVehicle = await newVehicle.save();
        res.status(201).json(savedVehicle);
    } catch (error) { 
        console.error("Erro ao criar veículo:", error);
        res.status(500).json({ message: 'Erro ao criar veículo.' }); 
    }
});

// PUT /api/vehicles/:id - Atualizar veículo (restrito)
router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const updatedVehicle = await Vehicle.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!updatedVehicle) return res.status(404).json({ message: 'Veículo não encontrado.' });
        res.json(updatedVehicle);
    } catch (error) { 
        console.error("Erro ao atualizar veículo:", error);
        res.status(500).json({ message: 'Erro ao atualizar veículo.' }); 
    }
});

// DELETE /api/vehicles/:id - Deletar veículo (restrito)
router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const deletedVehicle = await Vehicle.findByIdAndDelete(req.params.id);
        if (!deletedVehicle) return res.status(404).json({ message: 'Veículo não encontrado.' });
        res.json({ message: 'Veículo apagado com sucesso.' });
    } catch (error) { 
        console.error("Erro ao apagar veículo:", error);
        res.status(500).json({ message: 'Erro ao apagar veículo.' }); 
    }
});

module.exports = router;
