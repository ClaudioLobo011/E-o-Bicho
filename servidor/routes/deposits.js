const express = require('express');
const router = express.Router();
const Deposit = require('../models/Deposit');
const Store = require('../models/Store');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

router.get('/', async (req, res) => {
    try {
        const { empresa } = req.query;
        const query = {};
        if (empresa) {
            query.empresa = empresa;
        }
        const deposits = await Deposit.find(query)
            .sort({ nome: 1 })
            .populate('empresa')
            .lean();
        res.json({ deposits });
    } catch (error) {
        console.error('Erro ao listar depósitos:', error);
        res.status(500).json({ message: 'Erro ao listar depósitos.' });
    }
});

router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const codigo = normalizeString(req.body.codigo);
        const nome = normalizeString(req.body.nome);
        const empresa = normalizeString(req.body.empresa);

        if (!codigo || !nome || !empresa) {
            return res.status(400).json({ message: 'Código, nome e empresa são obrigatórios.' });
        }

        const storeExists = await Store.exists({ _id: empresa });
        if (!storeExists) {
            return res.status(400).json({ message: 'Empresa informada não foi encontrada.' });
        }

        const existing = await Deposit.findOne({ codigo });
        if (existing) {
            return res.status(409).json({ message: 'Já existe um depósito com este código.' });
        }

        const deposit = await Deposit.create({ codigo, nome, empresa });
        const populated = await deposit.populate('empresa');
        res.status(201).json(populated);
    } catch (error) {
        console.error('Erro ao criar depósito:', error);
        res.status(500).json({ message: 'Erro ao criar depósito.' });
    }
});

router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const codigo = normalizeString(req.body.codigo);
        const nome = normalizeString(req.body.nome);
        const empresa = normalizeString(req.body.empresa);

        if (!codigo || !nome || !empresa) {
            return res.status(400).json({ message: 'Código, nome e empresa são obrigatórios.' });
        }

        const storeExists = await Store.exists({ _id: empresa });
        if (!storeExists) {
            return res.status(400).json({ message: 'Empresa informada não foi encontrada.' });
        }

        const duplicated = await Deposit.findOne({ codigo, _id: { $ne: req.params.id } });
        if (duplicated) {
            return res.status(409).json({ message: 'Já existe um depósito com este código.' });
        }

        const updated = await Deposit.findByIdAndUpdate(
            req.params.id,
            { codigo, nome, empresa },
            { new: true }
        ).populate('empresa');

        if (!updated) {
            return res.status(404).json({ message: 'Depósito não encontrado.' });
        }

        res.json(updated);
    } catch (error) {
        console.error('Erro ao atualizar depósito:', error);
        res.status(500).json({ message: 'Erro ao atualizar depósito.' });
    }
});

router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const deleted = await Deposit.findByIdAndDelete(req.params.id);
        if (!deleted) {
            return res.status(404).json({ message: 'Depósito não encontrado.' });
        }
        res.json({ message: 'Depósito removido com sucesso.' });
    } catch (error) {
        console.error('Erro ao apagar depósito:', error);
        res.status(500).json({ message: 'Erro ao remover depósito.' });
    }
});

module.exports = router;
