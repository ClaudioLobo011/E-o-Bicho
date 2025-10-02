const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const BankAccount = require('../models/BankAccount');
const Store = require('../models/Store');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

const normalizeString = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
};

const sanitizeBankCode = (value) => {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  const digits = normalized.replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 8) return digits;
  if (digits.length >= 3) return digits.slice(0, 3).padStart(3, '0');
  return digits.padStart(3, '0');
};

const sanitizeAgency = (value) => normalizeString(value).replace(/\s+/g, '');
const sanitizeAccountNumber = (value) => normalizeString(value).replace(/\s+/g, '');
const sanitizeAccountDigit = (value) => normalizeString(value).replace(/\s+/g, '');
const sanitizePixKey = (value) => normalizeString(value);

const sanitizeDocument = (value) => {
  const normalized = normalizeString(value);
  const digits = normalized.replace(/[^0-9a-zA-Z]/g, '');
  return digits || normalized;
};

const parseLocaleNumber = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return fallback;
  const normalized = value
    .trim()
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^0-9.+-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeAccountType = (value, fallback = 'corrente') => {
  const normalized = normalizeString(value).toLowerCase().replace(/[^a-z]/g, '_');
  if (['corrente', 'conta_pagamento', 'conta_investimento'].includes(normalized)) {
    return normalized;
  }
  return fallback;
};

const buildPublicAccountPayload = (account) => {
  if (!account) return null;
  const plain = typeof account.toObject === 'function' ? account.toObject() : account;
  return {
    _id: plain._id,
    company: plain.company,
    bankCode: plain.bankCode,
    bankName: plain.bankName,
    agency: plain.agency,
    accountNumber: plain.accountNumber,
    accountDigit: plain.accountDigit,
    accountType: plain.accountType,
    pixKey: plain.pixKey,
    documentNumber: plain.documentNumber,
    alias: plain.alias,
    initialBalance: plain.initialBalance,
    dailyCdi: plain.dailyCdi,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
};

router.get('/', requireAuth, authorizeRoles('admin', 'admin_master', 'funcionario'), async (req, res) => {
  try {
    const { company } = req.query;
    const query = {};
    if (company && mongoose.Types.ObjectId.isValid(company)) {
      query.company = company;
    }

    const accounts = await BankAccount.find(query)
      .sort({ createdAt: -1 })
      .populate('company', 'nome nomeFantasia razaoSocial cnpj cpf inscricaoEstadual');

    res.json({ accounts: accounts.map(buildPublicAccountPayload) });
  } catch (error) {
    console.error('Erro ao listar contas bancárias:', error);
    res.status(500).json({ message: 'Erro ao listar contas bancárias.' });
  }
});

router.get('/:id', requireAuth, authorizeRoles('admin', 'admin_master', 'funcionario'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Identificador inválido.' });
    }

    const account = await BankAccount.findById(id).populate(
      'company',
      'nome nomeFantasia razaoSocial cnpj cpf inscricaoEstadual'
    );

    if (!account) {
      return res.status(404).json({ message: 'Conta bancária não encontrada.' });
    }

    res.json(buildPublicAccountPayload(account));
  } catch (error) {
    console.error('Erro ao buscar conta bancária:', error);
    res.status(500).json({ message: 'Erro ao buscar conta bancária.' });
  }
});

router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const company = normalizeString(req.body.company);
    if (!company) {
      return res.status(400).json({ message: 'Selecione a empresa proprietária da conta.' });
    }

    const storeExists = await Store.exists({ _id: company });
    if (!storeExists) {
      return res.status(404).json({ message: 'Empresa informada não foi encontrada.' });
    }

    const bankCode = sanitizeBankCode(req.body.bankCode);
    if (!bankCode) {
      return res.status(400).json({ message: 'Informe o código Bacen/ISPB do banco.' });
    }

    const agency = sanitizeAgency(req.body.agency);
    if (!agency) {
      return res.status(400).json({ message: 'Informe a agência bancária.' });
    }

    const accountNumber = sanitizeAccountNumber(req.body.accountNumber);
    if (!accountNumber) {
      return res.status(400).json({ message: 'Informe o número da conta bancária.' });
    }

    const accountDigit = sanitizeAccountDigit(req.body.accountDigit);
    const accountType = normalizeAccountType(req.body.accountType);
    const pixKey = sanitizePixKey(req.body.pixKey);
    const documentNumber = sanitizeDocument(req.body.documentNumber);

    if (!documentNumber) {
      return res.status(400).json({ message: 'Informe o documento vinculado à conta.' });
    }

    const alias = normalizeString(req.body.alias);
    const bankName = normalizeString(req.body.bankName);
    const initialBalance = parseLocaleNumber(req.body.initialBalance, 0);
    const dailyCdi = parseLocaleNumber(req.body.dailyCdi, 0);

    const payload = {
      company,
      bankCode,
      bankName,
      agency,
      accountNumber,
      accountDigit,
      accountType,
      pixKey,
      documentNumber,
      alias,
      initialBalance,
      dailyCdi,
    };

    const created = await BankAccount.create(payload);
    const populated = await created.populate('company', 'nome nomeFantasia razaoSocial cnpj cpf inscricaoEstadual');
    res.status(201).json(buildPublicAccountPayload(populated));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Já existe uma conta cadastrada com os mesmos dados para esta empresa.' });
    }
    console.error('Erro ao criar conta bancária:', error);
    res.status(500).json({ message: 'Erro ao criar conta bancária.' });
  }
});

router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Identificador inválido.' });
    }

    const existing = await BankAccount.findById(id);
    if (!existing) {
      return res.status(404).json({ message: 'Conta bancária não encontrada.' });
    }

    let company = normalizeString(req.body.company) || String(existing.company);
    if (!company) {
      return res.status(400).json({ message: 'Selecione a empresa proprietária da conta.' });
    }

    const companyExists = await Store.exists({ _id: company });
    if (!companyExists) {
      return res.status(404).json({ message: 'Empresa informada não foi encontrada.' });
    }

    const bankCode = sanitizeBankCode(req.body.bankCode) || existing.bankCode;
    const agency = sanitizeAgency(req.body.agency) || existing.agency;
    const accountNumber = sanitizeAccountNumber(req.body.accountNumber) || existing.accountNumber;
    const accountDigit =
      typeof req.body.accountDigit === 'undefined'
        ? existing.accountDigit
        : sanitizeAccountDigit(req.body.accountDigit);
    const accountType = normalizeAccountType(req.body.accountType, existing.accountType);
    const pixKey =
      typeof req.body.pixKey === 'undefined'
        ? existing.pixKey
        : sanitizePixKey(req.body.pixKey);
    const documentNumber = sanitizeDocument(req.body.documentNumber) || existing.documentNumber;
    const alias =
      typeof req.body.alias === 'undefined'
        ? existing.alias
        : normalizeString(req.body.alias);
    const bankName =
      typeof req.body.bankName === 'undefined'
        ? existing.bankName
        : normalizeString(req.body.bankName);
    const initialBalance = parseLocaleNumber(req.body.initialBalance, existing.initialBalance || 0);
    const dailyCdi = parseLocaleNumber(req.body.dailyCdi, existing.dailyCdi || 0);

    existing.company = company;
    existing.bankCode = bankCode;
    existing.bankName = bankName;
    existing.agency = agency;
    existing.accountNumber = accountNumber;
    existing.accountDigit = accountDigit;
    existing.accountType = accountType;
    existing.pixKey = pixKey;
    existing.documentNumber = documentNumber;
    existing.alias = alias;
    existing.initialBalance = initialBalance;
    existing.dailyCdi = dailyCdi;

    await existing.save();
    const populated = await existing.populate('company', 'nome nomeFantasia razaoSocial cnpj cpf inscricaoEstadual');

    res.json(buildPublicAccountPayload(populated));
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'Já existe uma conta cadastrada com os mesmos dados para esta empresa.' });
    }
    console.error('Erro ao atualizar conta bancária:', error);
    res.status(500).json({ message: 'Erro ao atualizar conta bancária.' });
  }
});

module.exports = router;
