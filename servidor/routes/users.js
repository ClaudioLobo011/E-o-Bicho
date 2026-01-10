const express = require('express');
const router = express.Router();
const User = require('../models/User');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const STAFF_ROLES = new Set(['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master']);

// GET /api/users/:id - Buscar dados de um utilizador
router.get('/:id', requireAuth, async (req, res) => {
    try {
        // Se não for admin, só pode buscar o próprio perfil
        if (!STAFF_ROLES.has(req.user.role) && req.user.id !== req.params.id) {
            return res.status(403).json({ message: 'Acesso negado.' });
        }

        const user = await User.findById(req.params.id).select('-senha -totpSecretEnc -totpTempSecretEnc');
        if (!user) {
            return res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
        res.json(user);
    } catch (error) {
        console.error("Erro ao buscar utilizador:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// PUT /api/users/:id - Atualizar dados de um utilizador
router.put('/:id', requireAuth, async (req, res) => {
    try {
        // Se não for admin, só pode atualizar o próprio perfil
        if (!STAFF_ROLES.has(req.user.role) && req.user.id !== req.params.id) {
            return res.status(403).json({ message: 'Acesso negado.' });
        }

        const {
            nomeCompleto, email, dataNascimento, genero, celular, telefone,
            razaoSocial, nomeContato, inscricaoEstadual, isentoIE, estadoIE
        } = req.body;

        const updateFields = {
            nomeCompleto, email, dataNascimento, genero, celular, telefone,
            razaoSocial, nomeContato, inscricaoEstadual, isentoIE, estadoIE
        };
        
        Object.keys(updateFields).forEach(key => updateFields[key] === undefined && delete updateFields[key]);

        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            { $set: updateFields },
            { new: true, runValidators: true }
        ).select('-senha');

        if (!updatedUser) {
            return res.status(404).json({ message: 'Utilizador não encontrado.' });
        }
        
        const userForLocalStorage = {
            id: updatedUser._id,
            nome: updatedUser.nomeCompleto || updatedUser.razaoSocial,
            email: updatedUser.email,
            role: updatedUser.role
        };

        res.json({ message: 'Dados atualizados com sucesso!', user: userForLocalStorage });

    } catch (error) {
        console.error("Erro ao atualizar utilizador:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

module.exports = router;
