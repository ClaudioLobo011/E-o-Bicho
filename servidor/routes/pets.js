const express = require('express');
const router = express.Router();
const Pet = require('../models/Pet');
const requireAuth = require('../middlewares/requireAuth');

// Middleware para validar acesso aos pets
function authorizePetAccess(req, res, next) {
  const { userId } = req.params;
  if (userId && req.user.id !== userId && req.user.role !== 'admin_master') {
    return res.status(403).json({ message: 'Acesso negado' });
  }
  next();
}

// Criar um pet (qualquer usuário logado pode criar)
router.post('/', requireAuth, async (req, res) => {
  try {
    const newPet = new Pet({
      owner: req.user.id, // garante que o dono é o usuário logado
      nome: req.body.pet_name,
      tipo: req.body.pet_type,
      raca: req.body.pet_raca,
      porte: req.body.pet_porte,
      sexo: req.body.pet_sexo,
      dataNascimento: req.body.pet_nascimento,
      microchip: req.body.pet_microchip,
      pelagemCor: req.body.pet_pelagem,
      rga: req.body.pet_rga,
      peso: req.body.pet_peso,
    });

    const savedPet = await newPet.save();
    res.status(201).json({ message: 'Pet adicionado com sucesso!', pet: savedPet });
  } catch (error) {
    res.status(500).json({ message: 'Erro no servidor ao salvar o pet.' });
  }
});

// Buscar pets de um usuário
router.get('/user/:userId', requireAuth, async (req, res) => {
  try {
    // só o próprio user ou admin pode ver
    if (req.user.id !== req.params.userId && req.user.role !== 'admin_master') {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    const pets = await Pet.find({ owner: req.params.userId, obito: { $ne: true } });
    res.json(pets);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar pets.' });
  }
});

// Buscar um pet específico
router.get('/:petId', requireAuth, async (req, res) => {
  try {
    const pet = await Pet.findById(req.params.petId);
    if (!pet) return res.status(404).json({ message: 'Pet não encontrado.' });

    if (String(pet.owner) !== req.user.id && req.user.role !== 'admin_master') {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    res.json(pet);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar pet.' });
  }
});

// Atualizar pet
router.put('/:petId', requireAuth, async (req, res) => {
  try {
    const pet = await Pet.findById(req.params.petId);
    if (!pet) return res.status(404).json({ message: 'Pet não encontrado.' });

    if (String(pet.owner) !== req.user.id && req.user.role !== 'admin_master') {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    const updateData = {
      nome: req.body.pet_name,
      tipo: req.body.pet_type,
      raca: req.body.pet_raca,
      porte: req.body.pet_porte,
      sexo: req.body.pet_sexo,
      dataNascimento: req.body.pet_nascimento,
      microchip: req.body.pet_microchip,
      pelagemCor: req.body.pet_pelagem,
      rga: req.body.pet_rga,
      peso: req.body.pet_peso,
    };

    const updatedPet = await Pet.findByIdAndUpdate(req.params.petId, updateData, { new: true, runValidators: true });
    res.json({ message: 'Pet atualizado com sucesso!', pet: updatedPet });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar pet.' });
  }
});

// Excluir pet
router.delete('/:petId', requireAuth, async (req, res) => {
  try {
    const pet = await Pet.findById(req.params.petId);
    if (!pet) return res.status(404).json({ message: 'Pet não encontrado.' });

    if (String(pet.owner) !== req.user.id && req.user.role !== 'admin_master') {
      return res.status(403).json({ message: 'Acesso negado.' });
    }

    await Pet.findByIdAndDelete(req.params.petId);
    res.json({ message: 'Pet excluído com sucesso!' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao excluir pet.' });
  }
});

module.exports = router;
