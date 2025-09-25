const express = require('express');
const router = express.Router();
const Store = require('../models/Store');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

// Configuração do Multer para upload de imagens das lojas
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = 'public/uploads/stores';
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, `store-${req.params.id}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage: storage });

const allowedRegimes = new Set(['simples', 'mei', 'normal']);
const weekDays = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

const trimString = (value) => (typeof value === 'string' ? value.trim() : '');
const normalizeUf = (value) => trimString(value).toUpperCase();
const parseCoordinate = (value) => {
    if (value === null || value === undefined) return null;
    const normalized = typeof value === 'string' ? value.trim() : value;
    if (normalized === '') return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

const sanitizeHorario = (horario) => {
    const result = {};
    weekDays.forEach((day) => {
        const source = horario && typeof horario === 'object' ? horario[day] : null;
        result[day] = {
            abre: trimString(source?.abre),
            fecha: trimString(source?.fecha),
            fechada: Boolean(source?.fechada)
        };
    });
    return result;
};

const sanitizeStorePayload = (body = {}) => {
    const nomeFantasia = trimString(body.nomeFantasia) || trimString(body.nome);
    const nome = trimString(body.nome) || nomeFantasia || trimString(body.razaoSocial);
    const razaoSocial = trimString(body.razaoSocial);
    const cnpj = trimString(body.cnpj);
    const cnaePrincipal = trimString(body.cnaePrincipal || body.cnae);
    const inscricaoEstadual = trimString(body.inscricaoEstadual);
    const inscricaoMunicipal = trimString(body.inscricaoMunicipal);
    const regime = trimString(body.regimeTributario).toLowerCase();
    const regimeTributario = allowedRegimes.has(regime) ? regime : '';
    const emailFiscal = trimString(body.emailFiscal);
    const telefone = trimString(body.telefone);
    const whatsapp = trimString(body.whatsapp || body.celular);
    const cep = trimString(body.cep);
    const municipio = trimString(body.municipio);
    const uf = normalizeUf(body.uf);
    const logradouro = trimString(body.logradouro);
    const numero = trimString(body.numero);
    const complemento = trimString(body.complemento);
    const codigoIbgeMunicipio = trimString(body.codigoIbgeMunicipio || body.codIbgeMunicipio);
    const codigoUf = trimString(body.codigoUf || body.codUf);
    const endereco = trimString(body.endereco);
    const latitude = parseCoordinate(body.latitude);
    const longitude = parseCoordinate(body.longitude);
    const contadorNome = trimString(body.contadorNome || body.contador?.nome);
    const contadorEmail = trimString(body.contadorEmail || body.contador?.email);
    const contadorTelefone = trimString(body.contadorTelefone || body.contador?.telefone);
    const contadorCrc = trimString(body.contadorCrc || body.contador?.crc);
    const certificadoValidade = trimString(body.certificadoValidade || body.certificado?.validade);
    const certificadoSenha = typeof body.certificadoSenha === 'string'
        ? body.certificadoSenha
        : (typeof body.certificado?.senha === 'string' ? body.certificado.senha : '');
    const certificadoArquivoNome = trimString(body.certificadoArquivoNome || body.certificado?.arquivoNome);

    const servicos = Array.isArray(body.servicos)
        ? Array.from(new Set(
            body.servicos
                .map((service) => trimString(service))
                .filter((service) => service.length > 0)
        ))
        : [];

    const horario = sanitizeHorario(body.horario);

    const payload = {
        nome,
        nomeFantasia,
        razaoSocial,
        cnpj,
        cnaePrincipal,
        inscricaoEstadual,
        inscricaoMunicipal,
        regimeTributario,
        emailFiscal,
        telefone,
        whatsapp,
        endereco,
        cep,
        municipio,
        uf,
        logradouro,
        numero,
        complemento,
        codigoIbgeMunicipio,
        codigoUf,
        latitude,
        longitude,
        contadorNome,
        contadorEmail,
        contadorTelefone,
        contadorCrc,
        certificadoValidade,
        certificadoSenha,
        certificadoArquivoNome,
        horario,
        servicos
    };

    const imagem = trimString(body.imagem);
    if (imagem) payload.imagem = imagem;

    return payload;
};

// GET /api/stores - Público
router.get('/', async (req, res) => {
    try {
        const stores = await Store.find({}).sort({ nome: 1 });
        res.json(stores);
    } catch (error) {
        console.error("Erro ao buscar lojas:", error);
        res.status(500).json({ message: 'Erro no servidor.' }); 
    }
});

// GET /api/stores/:id - Público
router.get('/:id', async (req, res) => {
    try {
        const store = await Store.findById(req.params.id);
        if (!store) return res.status(404).json({ message: 'Loja não encontrada.' });
        res.json(store);
    } catch (error) { 
        console.error("Erro ao buscar loja:", error);
        res.status(500).json({ message: 'Erro no servidor.' }); 
    }
});

// POST /api/stores - Criar loja (restrito)
router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const payload = sanitizeStorePayload(req.body);
        if (!payload.nome) {
            return res.status(400).json({ message: 'O nome da loja é obrigatório.' });
        }
        const newStore = new Store(payload);
        const savedStore = await newStore.save();
        res.status(201).json(savedStore);
    } catch (error) {
        console.error("Erro ao criar loja:", error);
        res.status(500).json({ message: 'Erro ao criar loja.' });
    }
});

// PUT /api/stores/:id - Atualizar loja (restrito)
router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const payload = sanitizeStorePayload(req.body);
        if (!payload.nome) {
            return res.status(400).json({ message: 'O nome da loja é obrigatório.' });
        }
        const updatedStore = await Store.findByIdAndUpdate(
            req.params.id,
            payload,
            { new: true, runValidators: true }
        );
        if (!updatedStore) return res.status(404).json({ message: 'Loja não encontrada.' });
        res.json(updatedStore);
    } catch (error) {
        console.error("Erro ao atualizar loja:", error);
        res.status(500).json({ message: 'Erro ao atualizar loja.' });
    }
});

// DELETE /api/stores/:id - Deletar loja (restrito)
router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const deletedStore = await Store.findByIdAndDelete(req.params.id);
        if (!deletedStore) return res.status(404).json({ message: 'Loja não encontrada.' });
        res.json({ message: 'Loja apagada com sucesso.' });
    } catch (error) { 
        console.error("Erro ao apagar loja:", error);
        res.status(500).json({ message: 'Erro ao apagar loja.' }); 
    }
});

// POST /api/stores/:id/upload - Upload de imagem (restrito)
router.post('/:id/upload', requireAuth, authorizeRoles('admin', 'admin_master'), upload.single('imagem'), async (req, res) => {
    try {
        const store = await Store.findById(req.params.id);
        if (!store) {
            return res.status(404).json({ message: 'Loja não encontrada.' });
        }
        store.imagem = `/uploads/stores/${req.file.filename}`;
        await store.save();
        res.json(store);
    } catch (error) {
        console.error("Erro no upload da imagem da loja:", error);
        res.status(500).json({ message: 'Erro no servidor ao fazer upload da imagem.' });
    }
});

module.exports = router;
