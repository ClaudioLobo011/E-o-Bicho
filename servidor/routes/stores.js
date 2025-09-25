const express = require('express');
const router = express.Router();
const Store = require('../models/Store');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const tls = require('tls');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

// Configuração do Multer para upload de imagens das lojas
const storeImageStorage = multer.diskStorage({
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
const uploadStoreImage = multer({ storage: storeImageStorage });
const uploadCertificate = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});
const execFileAsync = promisify(execFile);
const fsPromises = fs.promises;

const CERTIFICATE_KEY = (process.env.CERTIFICATE_SECRET_KEY || 'dev-cert-key-por-favor-altere').padEnd(32, '0').slice(0, 32);

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

const hasNativePkcs12Support =
    typeof tls?.createSecureContext === 'function' &&
    typeof crypto?.X509Certificate === 'function';

const encryptBuffer = (buffer) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(CERTIFICATE_KEY), iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
};

const encryptText = (value) => encryptBuffer(Buffer.from(String(value || ''), 'utf8'));

const isValidCertificateExtension = (filename = '') => /\.(pfx|p12)$/i.test(filename);

const parseOpenSslDateToIso = (value = '') => {
    const trimmed = value.trim().replace(/[\u200e\u200f]/g, '');
    if (!trimmed) return '';

    const slashMatch = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (slashMatch) {
        const [, part1, part2, rawYear, rawHour = '0', rawMinute = '0', rawSecond = '0'] = slashMatch;
        const first = Number(part1);
        const second = Number(part2);
        let year = Number(rawYear);
        if (rawYear.length === 2) {
            year += year >= 70 ? 1900 : 2000;
        }

        let day = first;
        let month = second;

        if (first > 12 && second <= 12) {
            day = first;
            month = second;
        } else if (second > 12 && first <= 12) {
            day = second;
            month = first;
        }

        const hour = Number(rawHour);
        const minute = Number(rawMinute);
        const secondPart = Number(rawSecond);

        const date = new Date(Date.UTC(year, month - 1, day, hour, minute, secondPart));
        if (!Number.isNaN(date.getTime())) {
            return date.toISOString().slice(0, 10);
        }
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }
    return parsed.toISOString().slice(0, 10);
};

const parseSha1ToFingerprint = (value = '') => {
    const normalized = value.replace(/[^a-f0-9]/gi, '').toUpperCase();
    if (normalized.length !== 40) {
        return '';
    }
    return normalized.match(/.{1,2}/g).join(':');
};

const OPENSSL_UNAVAILABLE_MESSAGE = 'OpenSSL não está disponível no servidor.';
const OPENSSL_INSTALL_HELP = `${OPENSSL_UNAVAILABLE_MESSAGE} Instale o utilitário de linha de comando OpenSSL e certifique-se de que o executável "openssl" esteja no PATH do sistema (ex.: "apt install openssl" em distribuições Debian/Ubuntu, "brew install openssl" no macOS ou o pacote Win64 OpenSSL no Windows).`;

const extractMetadataWithNode = (buffer, password) => {
    if (!hasNativePkcs12Support) {
        throw new Error('Este runtime do Node.js não possui suporte nativo para leitura de arquivos PKCS#12.');
    }
    try {
        const secureContext = tls.createSecureContext({ pfx: buffer, passphrase: password });
        const derCertificate = secureContext.context.getCertificate();

        if (!derCertificate || !derCertificate.length) {
            throw new Error('Não foi possível localizar o certificado no arquivo enviado.');
        }

        const x509 = new crypto.X509Certificate(derCertificate);
        const validade = parseOpenSslDateToIso(x509.validTo);
        if (!validade) {
            throw new Error('Não foi possível identificar a data de validade do certificado.');
        }

        const fingerprint = (x509.fingerprint || '').toUpperCase();

        return { validade, fingerprint };
    } catch (error) {
        const message = String(error?.message || '').toLowerCase();
        if (message.includes('mac verify failure') || message.includes('invalid password') || message.includes('bad decrypt')) {
            throw new Error('Senha do certificado incorreta.');
        }
        if (message.includes('pkcs12') || message.includes('asn1') || message.includes('unable to load') || message.includes('not a pkcs12')) {
            throw new Error('Certificado PKCS#12 inválido.');
        }

        throw new Error('Não foi possível processar o certificado.');
    }
};

const extractCertificateMetadataWithCertutil = async (buffer, password) => {
    if (process.platform !== 'win32') {
        throw new Error('Certutil não está disponível neste sistema operacional.');
    }

    const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'store-cert-'));
    const pfxPath = path.join(tmpDir, 'certificado.pfx');

    try {
        await fsPromises.writeFile(pfxPath, buffer);

        let stdout;
        try {
            ({ stdout } = await execFileAsync('certutil', ['-dump', '-p', password, pfxPath]));
        } catch (error) {
            const output = `${error?.stdout || ''}\n${error?.stderr || ''}`.toLowerCase();

            if (output.includes('wrong password') || output.includes('incorrect password') || output.includes('senha incorreta')) {
                throw new Error('Senha do certificado incorreta.');
            }

            if (
                output.includes('0x80090029') ||
                output.includes('0x8009000b') ||
                output.includes('pfx') ||
                output.includes('pkcs12')
            ) {
                throw new Error('Certificado PKCS#12 inválido.');
            }

            throw new Error('Não foi possível processar o certificado.');
        }

        const lines = String(stdout || '')
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        const validadeLine = lines.find((line) => line.toLowerCase().startsWith('notafter'));
        const fingerprintLine = lines.find((line) => line.toLowerCase().startsWith('cert hash(sha1)'));

        if (!validadeLine) {
            throw new Error('Não foi possível identificar a data de validade do certificado.');
        }

        const validadeRaw = validadeLine.split(':').slice(1).join(':').trim();
        const validade = parseOpenSslDateToIso(validadeRaw);
        if (!validade) {
            throw new Error('Não foi possível identificar a data de validade do certificado.');
        }

        let fingerprint = '';
        if (fingerprintLine) {
            fingerprint = parseSha1ToFingerprint(fingerprintLine.split(':').slice(1).join(':'));
        }

        return { validade, fingerprint };
    } finally {
        await fsPromises.rm(tmpDir, { recursive: true, force: true });
    }
};

const extractCertificateMetadataWithOpenSsl = async (buffer, password) => {
    const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'store-cert-'));
    const pfxPath = path.join(tmpDir, 'certificado.pfx');
    const pemPath = path.join(tmpDir, 'certificado.pem');
    try {
        await fsPromises.writeFile(pfxPath, buffer);
        try {
            await execFileAsync('openssl', [
                'pkcs12',
                '-in', pfxPath,
                '-clcerts',
                '-nokeys',
                '-passin', `pass:${password}`,
                '-out', pemPath,
                '-nodes'
            ]);
        } catch (error) {
            if (error?.code === 'ENOENT') {
                throw new Error('OpenSSL não está disponível no servidor.');
            }
            const stderr = String(error?.stderr || '').toLowerCase();
            if (stderr.includes('mac verify failure') || stderr.includes('invalid password')) {
                throw new Error('Senha do certificado incorreta.');
            }
            if (stderr.includes('pkcs12 routines') || stderr.includes('pkcs12_parse')) {
                throw new Error('Certificado PKCS#12 inválido.');
            }
            throw new Error('Não foi possível processar o certificado.');
        }

        let stdout;
        try {
            ({ stdout } = await execFileAsync('openssl', [
                'x509',
                '-in', pemPath,
                '-noout',
                '-enddate',
                '-fingerprint',
                '-sha1'
            ]));
        } catch (error) {
            if (error?.code === 'ENOENT') {
                throw new Error('OpenSSL não está disponível no servidor.');
            }
            const stderr = String(error?.stderr || '').toLowerCase();
            if (stderr.includes('unable to load certificate')) {
                throw new Error('Não foi possível ler o certificado gerado.');
            }
            throw new Error('Falha ao extrair dados do certificado.');
        }

        const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        let validadeRaw = '';
        let fingerprint = '';
        for (const line of lines) {
            if (line.startsWith('notAfter=')) {
                validadeRaw = line.replace('notAfter=', '').trim();
            } else if (line.toUpperCase().startsWith('SHA1 FINGERPRINT=')) {
                fingerprint = line.split('=')[1]?.trim() || '';
            }
        }

        const validade = parseOpenSslDateToIso(validadeRaw);
        if (!validade) {
            throw new Error('Não foi possível identificar a data de validade do certificado.');
        }

        return { validade, fingerprint };
    } finally {
        await fsPromises.rm(tmpDir, { recursive: true, force: true });
    }
};

const shouldBubbleError = (error) => {
    if (!error) return false;
    const message = String(error.message || '').toLowerCase();
    return (
        message.includes('senha do certificado incorreta') ||
        message.includes('senha incorreta')
    );
};

const extractCertificateMetadata = async (buffer, password) => {
    let nativeError = null;
    let certutilError = null;

    if (hasNativePkcs12Support) {
        try {
            return extractMetadataWithNode(buffer, password);
        } catch (error) {
            if (shouldBubbleError(error)) {
                throw error;
            }
            nativeError = error;
        }
    }

    if (process.platform === 'win32') {
        try {
            return await extractCertificateMetadataWithCertutil(buffer, password);
        } catch (error) {
            if (shouldBubbleError(error)) {
                throw error;
            }
            certutilError = error;
        }
    }

    try {
        return await extractCertificateMetadataWithOpenSsl(buffer, password);
    } catch (error) {
        if (error?.message && error.message.includes(OPENSSL_UNAVAILABLE_MESSAGE)) {
            if (certutilError) {
                throw certutilError;
            }

            if (nativeError) {
                throw nativeError;
            }

            if (hasNativePkcs12Support) {
                throw new Error(OPENSSL_INSTALL_HELP);
            }

            throw new Error(OPENSSL_INSTALL_HELP);
        }

        throw error;
    }
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
    const cnaePrincipalDescricao = trimString(
        body.cnaePrincipalDescricao
        || body.cnaeDescricao
        || body.cnaeDescricaoPrincipal
    );
    const rawCnaeSecundario = trimString(body.cnaeSecundario || body.cnaeSecundaria);
    const cnaeSecundarioDescricao = trimString(
        body.cnaeSecundarioDescricao
        || body.cnaeDescricaoSecundario
        || body.cnaeSecundariaDescricao
    );
    const cnaesSecundariosArray = Array.isArray(body.cnaesSecundarios)
        ? body.cnaesSecundarios
        : (rawCnaeSecundario ? rawCnaeSecundario.split(/[;,\n]/) : []);
    const cnaesSecundarios = cnaesSecundariosArray
        .map((value) => trimString(value))
        .filter((value) => value.length > 0);
    const cnaeSecundario = cnaesSecundarios.join(', ');
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
    const contadorCpf = trimString(body.contadorCpf || body.contador?.cpf);
    const contadorCrc = trimString(body.contadorCrc || body.contador?.crc);
    const contadorCnpj = trimString(body.contadorCnpj || body.contador?.cnpj);
    const contadorCep = trimString(body.contadorCep || body.contador?.cep);
    const contadorEndereco = trimString(body.contadorEndereco || body.contador?.endereco);
    const contadorCidade = trimString(body.contadorCidade || body.contador?.cidade);
    const contadorNumero = trimString(body.contadorNumero || body.contador?.numero);
    const contadorBairro = trimString(body.contadorBairro || body.contador?.bairro);
    const contadorComplemento = trimString(body.contadorComplemento || body.contador?.complemento);
    const contadorRazaoSocial = trimString(body.contadorRazaoSocial || body.contador?.razaoSocial);
    const contadorTelefone = trimString(body.contadorTelefone || body.contador?.telefone);
    const contadorFax = trimString(body.contadorFax || body.contador?.fax);
    const contadorCelular = trimString(body.contadorCelular || body.contador?.celular);
    const contadorEmail = trimString(body.contadorEmail || body.contador?.email);
    const certificadoValidade = trimString(body.certificadoValidade || body.certificado?.validade);
    const cscIdProducao = trimString(body.cscIdProducao);
    const cscIdHomologacao = trimString(body.cscIdHomologacao);
    const cscTokenProducao = trimString(body.cscTokenProducao);
    const cscTokenHomologacao = trimString(body.cscTokenHomologacao);
    const hasCscTokenProducao = Object.prototype.hasOwnProperty.call(body, 'cscTokenProducao');
    const hasCscTokenHomologacao = Object.prototype.hasOwnProperty.call(body, 'cscTokenHomologacao');

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
        cnaeSecundario,
        cnaePrincipalDescricao,
        cnaeSecundarioDescricao,
        cnaesSecundarios,
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
        contadorCpf,
        contadorCrc,
        contadorCnpj,
        contadorCep,
        contadorEndereco,
        contadorCidade,
        contadorNumero,
        contadorBairro,
        contadorComplemento,
        contadorRazaoSocial,
        contadorTelefone,
        contadorFax,
        contadorCelular,
        contadorEmail,
        certificadoValidade,
        cscIdProducao,
        cscIdHomologacao,
        horario,
        servicos
    };

    if (hasCscTokenProducao) {
        if (cscTokenProducao) {
            payload.cscTokenProducaoCriptografado = encryptText(cscTokenProducao);
            payload.cscTokenProducaoArmazenado = true;
        } else {
            payload.cscTokenProducaoCriptografado = null;
            payload.cscTokenProducaoArmazenado = false;
        }
    }

    if (hasCscTokenHomologacao) {
        if (cscTokenHomologacao) {
            payload.cscTokenHomologacaoCriptografado = encryptText(cscTokenHomologacao);
            payload.cscTokenHomologacaoArmazenado = true;
        } else {
            payload.cscTokenHomologacaoCriptografado = null;
            payload.cscTokenHomologacaoArmazenado = false;
        }
    }

    const imagem = trimString(body.imagem);
    if (imagem) payload.imagem = imagem;

    return payload;
};

router.post('/certificate/preview', requireAuth, authorizeRoles('admin', 'admin_master'), uploadCertificate.single('certificado'), async (req, res) => {
    try {
        const senha = trimString(req.body?.senha);
        if (!req.file) {
            return res.status(400).json({ message: 'Envie o arquivo do certificado (.pfx ou .p12).' });
        }
        if (!isValidCertificateExtension(req.file.originalname)) {
            return res.status(400).json({ message: 'Formato de certificado inválido. Utilize arquivos .pfx ou .p12.' });
        }
        if (!senha) {
            return res.status(400).json({ message: 'Informe a senha do certificado.' });
        }

        const metadata = await extractCertificateMetadata(req.file.buffer, senha);
        res.json(metadata);
    } catch (error) {
        const status = error.message && error.message.includes('OpenSSL') ? 500 : 400;
        console.error('Erro ao validar certificado:', error);
        res.status(status).json({ message: error.message || 'Não foi possível validar o certificado.' });
    }
});

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

router.post('/:id/certificate', requireAuth, authorizeRoles('admin', 'admin_master'), uploadCertificate.single('certificado'), async (req, res) => {
    try {
        const senha = trimString(req.body?.senha);
        if (!req.file) {
            return res.status(400).json({ message: 'Envie o arquivo do certificado (.pfx ou .p12).' });
        }
        if (!isValidCertificateExtension(req.file.originalname)) {
            return res.status(400).json({ message: 'Formato de certificado inválido. Utilize arquivos .pfx ou .p12.' });
        }
        if (!senha) {
            return res.status(400).json({ message: 'Informe a senha do certificado.' });
        }

        const store = await Store.findById(req.params.id).select('+certificadoArquivoCriptografado +certificadoSenhaCriptografada');
        if (!store) {
            return res.status(404).json({ message: 'Loja não encontrada.' });
        }

        const metadata = await extractCertificateMetadata(req.file.buffer, senha);

        store.certificadoArquivoCriptografado = encryptBuffer(req.file.buffer);
        store.certificadoSenhaCriptografada = encryptText(senha);
        store.certificadoArquivoNome = req.file.originalname;
        store.certificadoValidade = metadata.validade;
        store.certificadoFingerprint = metadata.fingerprint;
        await store.save();

        res.json({
            message: 'Certificado armazenado com sucesso.',
            validade: metadata.validade,
            fingerprint: metadata.fingerprint,
            arquivo: store.certificadoArquivoNome
        });
    } catch (error) {
        const status = error.message && error.message.includes('OpenSSL') ? 500 : 400;
        console.error('Erro ao salvar certificado:', error);
        res.status(status).json({ message: error.message || 'Não foi possível salvar o certificado.' });
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
router.post('/:id/upload', requireAuth, authorizeRoles('admin', 'admin_master'), uploadStoreImage.single('imagem'), async (req, res) => {
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
