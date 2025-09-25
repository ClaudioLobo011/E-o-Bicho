const express = require('express');
const router = express.Router();

const IcmsSimples = require('../models/IcmsSimples');
const Store = require('../models/Store');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const ALLOWED_CODES = [1, 2, 3, 4];

const sanitizeId = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const parseValor = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }

  if (typeof value === 'string') {
    let normalized = value.replace(/\s/g, '');
    if (normalized.includes(',')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed * 100) / 100;
    }
  }

  return NaN;
};

router.get('/', async (req, res) => {
  try {
    const empresa = sanitizeId(req.query.empresa);
    const query = {};
    if (empresa) {
      query.empresa = empresa;
    }

    const registros = await IcmsSimples.find(query)
      .sort({ codigo: 1, createdAt: 1 })
      .populate('empresa', 'nome nomeFantasia razaoSocial')
      .lean();

    res.json({ registros });
  } catch (error) {
    console.error('Erro ao listar valores de ICMS:', error);
    res.status(500).json({ message: 'Erro ao listar os valores de ICMS.' });
  }
});

router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const empresa = sanitizeId(req.body.empresa);
    const valor = parseValor(req.body.valor);

    if (!empresa) {
      return res.status(400).json({ message: 'Empresa é obrigatória.' });
    }

    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ message: 'Informe um valor válido maior que zero.' });
    }

    const storeExists = await Store.exists({ _id: empresa });
    if (!storeExists) {
      return res.status(400).json({ message: 'Empresa informada não encontrada.' });
    }

    const existentes = await IcmsSimples.find({ empresa }).select('codigo').lean();
    const usados = existentes
      .map((item) => Number(item?.codigo))
      .filter((codigo) => Number.isFinite(codigo));
    const proximoCodigo = ALLOWED_CODES.find((codigo) => !usados.includes(codigo));

    if (!proximoCodigo) {
      return res.status(409).json({ message: 'Todos os códigos disponíveis já foram cadastrados para esta empresa.' });
    }

    const registro = await IcmsSimples.create({ empresa, valor, codigo: proximoCodigo });
    const populado = await registro.populate('empresa', 'nome nomeFantasia razaoSocial');
    res.status(201).json(populado);
  } catch (error) {
    console.error('Erro ao cadastrar valor de ICMS:', error);
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Já existe um valor cadastrado com este código para a empresa selecionada.' });
    }
    res.status(500).json({ message: 'Erro ao cadastrar o valor de ICMS.' });
  }
});

router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const valor = parseValor(req.body.valor);

    if (!Number.isFinite(valor) || valor <= 0) {
      return res.status(400).json({ message: 'Informe um valor válido maior que zero.' });
    }

    const atualizado = await IcmsSimples.findByIdAndUpdate(
      req.params.id,
      { valor },
      { new: true },
    ).populate('empresa', 'nome nomeFantasia razaoSocial');

    if (!atualizado) {
      return res.status(404).json({ message: 'Registro de ICMS não encontrado.' });
    }

    res.json(atualizado);
  } catch (error) {
    console.error('Erro ao atualizar valor de ICMS:', error);
    res.status(500).json({ message: 'Erro ao atualizar o valor de ICMS.' });
  }
});

router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const removido = await IcmsSimples.findByIdAndDelete(req.params.id);
    if (!removido) {
      return res.status(404).json({ message: 'Registro de ICMS não encontrado.' });
    }
    res.json({ message: 'Valor de ICMS removido com sucesso.' });
  } catch (error) {
    console.error('Erro ao remover valor de ICMS:', error);
    res.status(500).json({ message: 'Erro ao remover o valor de ICMS.' });
  }
});

module.exports = router;
