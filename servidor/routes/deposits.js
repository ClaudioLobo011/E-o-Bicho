const express = require('express');
const router = express.Router();
const Deposit = require('../models/Deposit');
const Store = require('../models/Store');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const normalizeString = (value) => {
    if (value === undefined || value === null) return '';
    return String(value).trim();
};

const extractNumericValue = (code) => {
    const normalized = normalizeString(code);
    if (!normalized) return 0;
    const matches = normalized.match(/\d+/g);
    if (!matches) {
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return matches.reduce((max, part) => {
        const parsed = Number(part);
        return Number.isFinite(parsed) && parsed > max ? parsed : max;
    }, 0);
};

const generateNextSequentialCode = async () => {
    const deposits = await Deposit.find({}, 'codigo').lean();
    const highest = deposits.reduce((max, deposit) => {
        const current = extractNumericValue(deposit?.codigo);
        return current > max ? current : max;
    }, 0);
    return String(highest + 1);
};

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
        const nome = normalizeString(req.body.nome);
        const empresa = normalizeString(req.body.empresa);

        if (!nome || !empresa) {
            return res.status(400).json({ message: 'Nome e empresa são obrigatórios.' });
        }

        const storeExists = await Store.exists({ _id: empresa });
        if (!storeExists) {
            return res.status(400).json({ message: 'Empresa informada não foi encontrada.' });
        }

        let codigo = await generateNextSequentialCode();
        let attempts = 0;
        while (await Deposit.exists({ codigo }) && attempts < 5) {
            const numeric = extractNumericValue(codigo) + 1;
            codigo = String(numeric);
            attempts += 1;
        }

        if (await Deposit.exists({ codigo })) {
            return res.status(409).json({ message: 'Não foi possível gerar um novo código de depósito. Tente novamente.' });
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
