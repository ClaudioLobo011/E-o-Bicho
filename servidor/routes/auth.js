const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const UserAddress = require('../models/UserAddress');
const { body, validationResult } = require('express-validator');
const { cpf, cnpj } = require('cpf-cnpj-validator');
const authMiddleware = require('../middlewares/authMiddleware');
const requireAuth = require('../middlewares/requireAuth');
const crypto = require('crypto');
const { sendMail } = require('../utils/mailer');
const {
  digitsOnly,
  normalizeBrazilPhone,
  isBrazilianMobile,
  phoneVariants,
  normalizeCpf,
  normalizeCnpj,
  effectiveWebAccountStatus,
  phoneLookupQuery,
} = require('../utils/customerIdentity');
const {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_MS,
  createOtp,
  otpMatches,
  sendPhoneOtp,
} = require('../services/phoneOtpService');

// ===================== TOTP helpers (sem dependências) =====================
function base32Encode(buf) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}
function base32Decode(str) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const lookup = new Map(alphabet.split('').map((c, i) => [c, i]));
  let bits = 0, value = 0; const out = [];
  const clean = str.toUpperCase().replace(/=+$/,'');
  for (const ch of clean) {
    if (!lookup.has(ch)) continue;
    value = (value << 5) | lookup.get(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function hotp(secretBuf, counter) {
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(ctr).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}
function totp(secretBuf, timestamp = Date.now(), period = 30) {
  const counter = Math.floor(timestamp / 1000 / period);
  return hotp(secretBuf, counter);
}
function verifyTotp(secretBuf, token, window = 1, period = 30) {
  token = String(token || '').replace(/\D/g, '').padStart(6, '0');
  const now = Date.now();
  for (let w = -window; w <= window; w++) {
    const t = totp(secretBuf, now + w * period * 1000, period);
    if (t === token) return true;
  }
  return false;
}
// Criptografia simétrica para guardar o secret
const TOTP_KEY = (process.env.TOTP_SECRET_KEY || 'dev-key-please-change').padEnd(32, '0').slice(0,32);
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(TOTP_KEY), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}
function decrypt(payload) {
  try {
    const buf = Buffer.from(String(payload || ''), 'base64');
    const iv = buf.subarray(0,12);
    const tag = buf.subarray(12,28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(TOTP_KEY), iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  } catch { return ''; }
}

function formatCpf(digits) {
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function formatCnpj(digits) {
  if (digits.length !== 14) return digits;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function buildIdentifierQuery(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;

  const or = [{ email: raw.toLowerCase() }];
  const isEmail = raw.includes('@');
  const digits = digitsOnly(raw);

  if (!isEmail && digits) {
    if (digits.length === 11) {
      const formatted = formatCpf(digits);
      or.push({ cpf: raw }, { cpf: digits }, { cpf: formatted });
    } else if (digits.length === 14) {
      const formatted = formatCnpj(digits);
      or.push({ cnpj: raw }, { cnpj: digits }, { cnpj: formatted });
    }
    const normalizedPhone = normalizeBrazilPhone(raw);
    if (normalizedPhone) {
      or.push({ celularNormalizado: normalizedPhone }, { celular: { $in: phoneVariants(normalizedPhone) } });
    }
  }

  return { $or: or };
}

async function resolveUserByIdentifier(identifier) {
  if (isBrazilianMobile(identifier)) {
    const byPhone = await User.findOne(phoneLookupQuery(identifier));
    if (byPhone) return byPhone;
  }
  const query = buildIdentifierQuery(identifier);
  return query ? User.findOne(query) : null;
}

const MAX_CODIGO_CLIENTE_SEQUENCIAL = 999999999;
const STAFF_ROLES = new Set(['funcionario', 'franqueado', 'franqueador', 'admin', 'admin_master']);

function parseCodigoClienteSequencial(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const code = Math.trunc(raw);
    if (code >= 1 && code <= MAX_CODIGO_CLIENTE_SEQUENCIAL) return code;
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (!/^[\d.\-\/\s]+$/.test(trimmed)) return null;
    const digits = trimmed.replace(/\D/g, '');
    if (!digits) return null;
    const code = Number.parseInt(digits, 10);
    if (!Number.isFinite(code)) return null;
    if (code < 1 || code > MAX_CODIGO_CLIENTE_SEQUENCIAL) return null;
    return code;
  }
  return null;
}

async function obterMaiorCodigoClienteSequencial() {
  const candidatos = await User.find({ codigoCliente: { $exists: true } })
    .select('codigoCliente')
    .sort({ codigoCliente: -1 })
    .limit(20)
    .lean();
  return candidatos.reduce((maior, doc) => {
    const parsed = parseCodigoClienteSequencial(doc?.codigoCliente);
    if (parsed && parsed > maior) return parsed;
    return maior;
  }, 0);
}

async function gerarCodigoClienteSequencial() {
  const maior = await obterMaiorCodigoClienteSequencial();
  return maior + 1;
}

const registerValidationRules = [
  body('nomeCompleto').if(body('tipoConta').equals('pessoa_fisica')).notEmpty().withMessage('O nome completo é obrigatório.').isLength({ min: 3 }).withMessage('O nome deve ter pelo menos 3 caracteres.'),
  body('razaoSocial').if(body('tipoConta').equals('pessoa_juridica')).notEmpty().withMessage('A razão social é obrigatória.'),
  body('email').notEmpty().withMessage('O e-mail é obrigatório.').isEmail().withMessage('Por favor, insira um e-mail válido.').normalizeEmail(),
  body('celular').notEmpty().withMessage('O número de celular é obrigatório.').custom((value) => {
    if (!isBrazilianMobile(value)) throw new Error('Informe um celular brasileiro válido, com DDD.');
    return true;
  }),
  body('senha').isLength({ min: 8 }).withMessage('A senha deve ter no mínimo 8 caracteres.').matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/).withMessage('A senha deve conter pelo menos uma letra maiúscula, uma minúscula e um número.'),
  body('confirm_password').notEmpty().withMessage('A confirmação de senha é obrigatória.').custom((value, { req }) => { if (value !== req.body.senha) { throw new Error('As senhas não coincidem. Por favor, tente novamente.'); } return true; }),
  body('cpf').if(body('tipoConta').equals('pessoa_fisica')).notEmpty().withMessage('O CPF é obrigatório.').custom((value) => { if (!cpf.isValid(value)) { throw new Error('O CPF inserido não é válido.'); } return true; }),
  body('cnpj').if(body('tipoConta').equals('pessoa_juridica')).notEmpty().withMessage('O CNPJ é obrigatório.').custom((value) => { if (!cnpj.isValid(value)) { throw new Error('O CNPJ inserido não é válido.'); } return true; }),
  body('terms').equals('on').withMessage('Você deve concordar com os termos e condições para se registar.'),
  body('inscricaoEstadual').if(body('tipoConta').equals('pessoa_juridica')).if(body('isentoIE').not().exists()).notEmpty().withMessage('A Inscrição Estadual é obrigatória quando não isento.'),
];

function signCompletionToken(user) {
  return jwt.sign(
    { id: String(user._id), phone: normalizeBrazilPhone(user.celularNormalizado || user.celular), purpose: 'account_completion' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function readCompletionToken(req) {
  const authorization = String(req.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : String(req.body?.completionToken || '');
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload?.purpose === 'account_completion' ? payload : null;
  } catch (_error) {
    return null;
  }
}

async function findCustomerByPhone(value) {
  const query = phoneLookupQuery(value);
  if (!query) return null;
  return User.findOne({ role: 'cliente', ...query });
}

router.post('/account/lookup', async (req, res) => {
  const celular = normalizeBrazilPhone(req.body?.celular);
  if (!isBrazilianMobile(celular)) return res.status(400).json({ message: 'Informe um celular válido, com DDD.' });
  const user = await findCustomerByPhone(celular);
  if (!user) return res.json({ exists: false, status: 'not_found' });
  const status = effectiveWebAccountStatus(user);
  if (['store_only', 'pending_completion'].includes(status)) {
    return res.json({ exists: true, status, code: 'ACCOUNT_COMPLETION_REQUIRED', message: 'Este número já tem um cadastro. Confirme o celular para terminar o cadastro do site.' });
  }
  return res.json({ exists: true, status, code: status === 'active' ? 'ACCOUNT_ALREADY_ACTIVE' : 'ACCOUNT_BLOCKED' });
});

router.post('/account/phone/send-code', async (req, res) => {
  try {
    const celular = normalizeBrazilPhone(req.body?.celular);
    if (!isBrazilianMobile(celular)) return res.status(400).json({ message: 'Informe um celular válido, com DDD.' });
    const user = await findCustomerByPhone(celular);
    if (!user || !['store_only', 'pending_completion'].includes(effectiveWebAccountStatus(user))) {
      return res.status(400).json({ message: 'Não há cadastro de loja pendente para este celular.' });
    }
    if (user.phoneOtpSentAt && Date.now() - new Date(user.phoneOtpSentAt).getTime() < OTP_RESEND_MS) {
      return res.status(429).json({ message: 'Aguarde um minuto antes de solicitar outro código.' });
    }
    const otp = createOtp();
    await sendPhoneOtp({ phone: celular, code: otp.code });
    user.phoneOtpHash = otp.hash;
    user.phoneOtpExpires = otp.expiresAt;
    user.phoneOtpAttempts = 0;
    user.phoneOtpSentAt = new Date();
    user.webAccountStatus = 'pending_completion';
    user.celularNormalizado = celular;
    await user.save();
    return res.json({ ok: true, message: 'Código enviado para o celular cadastrado.' });
  } catch (error) {
    return res.status(error.code === 'PHONE_OTP_PROVIDER_NOT_CONFIGURED' ? 503 : 500).json({ message: error.message || 'Não foi possível enviar o código.' });
  }
});

router.post('/account/phone/verify', async (req, res) => {
  const celular = normalizeBrazilPhone(req.body?.celular);
  const code = digitsOnly(req.body?.code);
  const user = await findCustomerByPhone(celular);
  if (!user || !user.phoneOtpHash || !user.phoneOtpExpires) return res.status(400).json({ message: 'Código inválido ou não solicitado.' });
  if (new Date(user.phoneOtpExpires) < new Date()) return res.status(400).json({ message: 'Código expirado. Solicite outro.' });
  if ((user.phoneOtpAttempts || 0) >= OTP_MAX_ATTEMPTS) return res.status(429).json({ message: 'Limite de tentativas atingido. Solicite outro código.' });
  if (!otpMatches(code, user.phoneOtpHash)) {
    user.phoneOtpAttempts = (user.phoneOtpAttempts || 0) + 1;
    await user.save();
    return res.status(400).json({ message: 'Código inválido.' });
  }
  user.phoneOtpHash = undefined;
  user.phoneOtpExpires = undefined;
  user.phoneOtpAttempts = 0;
  user.celularVerificadoEm = new Date();
  user.webAccountStatus = 'pending_completion';
  await user.save();
  return res.json({ ok: true, completionToken: signCompletionToken(user) });
});

router.get('/account/completion', async (req, res) => {
  const payload = readCompletionToken(req);
  if (!payload) return res.status(401).json({ message: 'Confirmação expirada. Confirme o celular novamente.' });
  const user = await User.findById(payload.id).lean();
  if (!user || normalizeBrazilPhone(user.celularNormalizado || user.celular) !== payload.phone) return res.status(401).json({ message: 'Confirmação inválida.' });
  const addresses = await UserAddress.find({ user: user._id }).sort({ isDefault: -1, createdAt: 1 }).lean();
  return res.json({
    user: {
      tipoConta: user.tipoConta || (user.cnpj ? 'pessoa_juridica' : 'pessoa_fisica'),
      nomeCompleto: user.nomeCompleto || '', razaoSocial: user.razaoSocial || '', email: user.email || '',
      celular: normalizeBrazilPhone(user.celularNormalizado || user.celular), telefone: user.telefone || '',
      cpf: user.cpf || '', cnpj: user.cnpj || '', genero: user.genero || '', dataNascimento: user.dataNascimento || '',
      nomeContato: user.nomeContato || '', inscricaoEstadual: user.inscricaoEstadual || '', estadoIE: user.estadoIE || '', isentoIE: !!user.isentoIE,
    },
    addresses,
  });
});

router.post('/account/complete', registerValidationRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const payload = readCompletionToken(req);
  if (!payload) return res.status(401).json({ message: 'Confirmação expirada. Confirme o celular novamente.' });
  const user = await User.findById(payload.id);
  if (!user || !['store_only', 'pending_completion'].includes(effectiveWebAccountStatus(user))) return res.status(409).json({ message: 'Este cadastro já foi concluído ou não está disponível.' });
  const celular = normalizeBrazilPhone(req.body.celular);
  if (celular !== payload.phone) return res.status(400).json({ message: 'O celular confirmado não pode ser alterado nesta etapa.' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const reqCpf = normalizeCpf(req.body.cpf);
  const reqCnpj = normalizeCnpj(req.body.cnpj);
  const conflicts = [{ email }, { celularNormalizado: celular }];
  if (reqCpf) conflicts.push({ cpf: reqCpf });
  if (reqCnpj) conflicts.push({ cnpj: reqCnpj });
  const duplicate = await User.findOne({ _id: { $ne: user._id }, $or: conflicts }).lean();
  if (duplicate) return res.status(409).json({ message: 'E-mail, celular ou documento já pertence a outro cadastro.' });
  user.tipoConta = req.body.tipoConta;
  user.email = email;
  user.celular = celular;
  user.celularNormalizado = celular;
  user.telefone = req.body.telefone || '';
  user.nomeCompleto = req.body.nomeCompleto || '';
  user.cpf = reqCpf || undefined;
  user.genero = req.body.genero || '';
  user.dataNascimento = req.body.dataNascimento || undefined;
  user.razaoSocial = req.body.razaoSocial || '';
  user.cnpj = reqCnpj || undefined;
  user.nomeContato = req.body.nomeContato || '';
  user.inscricaoEstadual = req.body.inscricaoEstadual || '';
  user.estadoIE = req.body.estadoIE || '';
  user.isentoIE = req.body.isentoIE === 'on' || req.body.isentoIE === true;
  user.senha = await bcrypt.hash(String(req.body.senha), await bcrypt.genSalt(10));
  user.webAccountStatus = 'active';
  user.webActivatedAt = new Date();
  user.celularVerificadoEm = user.celularVerificadoEm || new Date();
  await user.save();
  return res.json({ message: 'Cadastro concluído com sucesso. Você já pode entrar no site.' });
});

// ROTA: POST /api/register
router.post('/register', registerValidationRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const celular = normalizeBrazilPhone(req.body.celular);
    const reqCpf = normalizeCpf(req.body.cpf);
    const reqCnpj = normalizeCnpj(req.body.cnpj);

    const conditions = [{ email }, { celularNormalizado: celular }, { celular: { $in: phoneVariants(celular) } }];
    if (reqCpf) conditions.push({ cpf: reqCpf });
    if (reqCnpj) conditions.push({ cnpj: reqCnpj });

    const userExists = await User.findOne({ $or: conditions });

    if (userExists) {
      let field, message;
      const samePhone = normalizeBrazilPhone(userExists.celularNormalizado || userExists.celular) === celular;
      const accountStatus = effectiveWebAccountStatus(userExists);
      if (samePhone && ['store_only', 'pending_completion'].includes(accountStatus)) {
        return res.status(409).json({
          code: 'ACCOUNT_COMPLETION_REQUIRED',
          field: 'celular',
          message: 'Este celular já possui um cadastro feito na loja. Confirme o número e termine o cadastro para entrar no site.',
        });
      }
      if (String(userExists.email || '').toLowerCase() === email) {
        field = 'email';
        message = 'Este email já está a ser utilizado.';
      } else if (samePhone) {
        field = 'celular';
        message = 'Este número de celular já está a ser utilizado.';
      } else if (reqCpf && userExists.cpf === reqCpf) {
        field = 'cpf';
        message = 'Este CPF já está a ser utilizado.';
      } else if (reqCnpj && userExists.cnpj === reqCnpj) {
        field = 'cnpj';
        message = 'Este CNPJ já está a ser utilizado.';
      }

      if (field) {
        return res.status(400).json({
          errors: [{ path: field, msg: message }]
        });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(req.body.senha, salt);
    const isento = req.body.isentoIE === 'on';

    const basePayload = {
      tipoConta: req.body.tipoConta,
      email,
      senha: hashedPassword,
      celular,
      celularNormalizado: celular,
      celularVerificadoEm: new Date(),
      telefone: req.body.telefone,
      nomeCompleto: req.body.nomeCompleto,
      cpf: reqCpf || undefined,
      genero: req.body.genero,
      dataNascimento: req.body.dataNascimento,
      razaoSocial: req.body.razaoSocial,
      cnpj: reqCnpj || undefined,
      nomeContato: req.body.nomeContato,
      inscricaoEstadual: req.body.inscricaoEstadual,
      estadoIE: req.body.estadoIE,
      isentoIE: isento,
      role: 'cliente',
      webAccountStatus: 'active',
      registrationSource: 'site',
      webActivatedAt: new Date(),
    };

    let savedUser = null;
    let attempt = 0;
    while (!savedUser && attempt < 3) {
      attempt += 1;
      const codigoCliente = await gerarCodigoClienteSequencial();
      const newUser = new User({
        ...basePayload,
        codigoCliente,
      });
      try {
        savedUser = await newUser.save();
      } catch (creationError) {
        const duplicateCodigo =
          creationError?.code === 11000 &&
          (creationError?.keyPattern?.codigoCliente ||
            String(creationError?.message || '').toLowerCase().includes('codigocliente'));
        if (duplicateCodigo && attempt < 3) {
          continue;
        }
        throw creationError;
      }
    }

    if (!savedUser) {
      throw new Error('Nao foi possivel gerar codigo sequencial do cliente.');
    }

    res.status(201).json({
      message: 'Utilizador registado com sucesso!',
      user: {
        id: savedUser._id,
        nome: savedUser.nomeCompleto || savedUser.razaoSocial,
        role: savedUser.role
      }
    });

  } catch (error) {
    console.error(error);
    if (error.code === 11000) {
      return res.status(400).json({
        errors: [{ path: 'geral', msg: 'Um dos dados inseridos (email, CPF, CNPJ ou celular) já está em uso.' }]
      });
    }
    res.status(500).json({ message: 'Erro no servidor. Tente novamente mais tarde.' });
  }
});

// ROTA: POST /api/login
router.post('/login', async (req, res) => {
    const { identifier, senha } = req.body;
    try {
        const user = await resolveUserByIdentifier(identifier);

        if (!user) {
            return res.status(400).json({ message: 'Credenciais inválidas.' });
        }

        const accountStatus = effectiveWebAccountStatus(user);
        if (String(user.role || '').toLowerCase() === 'cliente' && ['store_only', 'pending_completion'].includes(accountStatus)) {
            return res.status(409).json({
              code: 'ACCOUNT_COMPLETION_REQUIRED',
              message: 'Este celular já possui um cadastro feito na loja. Termine o cadastro para entrar no site.',
            });
        }
        if (accountStatus === 'blocked') return res.status(403).json({ message: 'Este acesso está bloqueado.' });
        if (!(await bcrypt.compare(senha, user.senha))) {
            return res.status(400).json({ message: 'Credenciais inválidas.' });
        }

        // Gera o token JWT
        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(200).json({
            message: 'Login bem-sucedido!',
            token, // <-- agora existe
            user: {
                id: user._id,
                nome: user.nomeCompleto || user.razaoSocial || user.username,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// ROTA: POST /api/auth/login-funcionario
router.post('/login-funcionario', async (req, res) => {
    const { identifier, senha } = req.body || {};
    try {
        const user = await resolveUserByIdentifier(identifier);

        if (!user) {
            return res.status(400).json({ message: 'Credenciais inválidas.' });
        }

        const accountStatus = effectiveWebAccountStatus(user);
        if (String(user.role || '').toLowerCase() === 'cliente' && ['store_only', 'pending_completion'].includes(accountStatus)) {
            return res.status(409).json({
              code: 'ACCOUNT_COMPLETION_REQUIRED',
              message: 'Este celular já possui um cadastro feito na loja. Termine o cadastro para entrar no site.',
            });
        }
        if (accountStatus === 'blocked') return res.status(403).json({ message: 'Este acesso está bloqueado.' });
        if (!(await bcrypt.compare(senha, user.senha))) {
            return res.status(400).json({ message: 'Credenciais inválidas.' });
        }

        if (!STAFF_ROLES.has(String(user.role || '').toLowerCase())) {
            return res.status(403).json({ message: 'Acesso permitido apenas para funcionários.' });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        return res.status(200).json({
            message: 'Login de funcionário bem-sucedido!',
            token,
            user: {
                id: user._id,
                nome: user.nomeCompleto || user.razaoSocial || user.username,
                email: user.email,
                role: user.role
            }
        });
    } catch (_error) {
        return res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// GET /api/users/:id -> Busca os dados de um utilizador
router.get('/users/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.id !== req.params.id && req.user.role !== 'admin_master') {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const user = await User.findById(req.params.id).select('-senha');
    if (!user) {
      return res.status(404).json({ message: 'Utilizador não encontrado.' });
    }

    res.status(200).json(user);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro no servidor.' });
  }
});

// PUT /api/users/:id -> Atualiza utilizador
router.put('/users/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.id !== req.params.id && req.user.role !== 'admin_master') {
      return res.status(403).json({ message: 'Acesso negado' });
    }

    const userId = req.params.id;
    const updateData = req.body;

    const updatedUser = await User.findByIdAndUpdate(userId, updateData, { new: true }).select('-senha');

    if (!updatedUser) {
      return res.status(404).json({ message: 'Utilizador não encontrado' });
    }

    res.status(200).json({
      message: 'Dados atualizados com sucesso!',
      user: {
        id: updatedUser._id,
        nome: updatedUser.nomeCompleto || updatedUser.razaoSocial,
        role: updatedUser.role
      }
    });

  } catch (error) {
    console.error('Erro ao atualizar utilizador:', error);
    res.status(500).json({ message: 'Erro no servidor. Tente novamente mais tarde.' });
  }
});

// GET /api/auth/check -> Verifica token e retorna role
router.get('/check', authMiddleware, (req, res) => {
    if (!req.user) {
        return res.status(401).json({ message: 'Não autenticado' });
    }

    // Exemplo: o authMiddleware adiciona req.user com { id, email, role }
    res.json({
        success: true,
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        originalRole: req.user.originalRole || req.user.role,
        adminMasterModeActive: req.user.adminMasterModeActive !== false
    });
});

// POST /api/auth/email/send-verification
router.post('/email/send-verification', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    if (user.emailVerified) return res.status(400).json({ message: 'E-mail já verificado' });

    const token = crypto.randomBytes(32).toString('hex');
    user.emailVerificationToken = token;
    user.emailVerificationExpires = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h
    await user.save();

    const FRONT = process.env.FRONTEND_URL || 'http://localhost:5500';
    const link = `${FRONT}/pages/verificar-email.html?token=${token}`;

    await sendMail({
      to: user.email,
      subject: 'Verifique seu e-mail',
      html: `
        <h2>Olá, ${user.nomeCompleto || user.razaoSocial || ''}</h2>
        <p>Confirme seu e-mail clicando no link abaixo (válido por <b>2 horas</b>):</p>
        <p><a href="${link}" target="_blank">${link}</a></p>
      `,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Falha ao enviar e-mail de verificação' });
  }
});

// GET /api/auth/email/verify?token=...
router.get('/email/verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'Token ausente' });

    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: new Date() }, // ainda válido (2h)
    });
    if (!user) return res.status(400).json({ message: 'Token inválido ou expirado' });

    user.emailVerified = true;
    user.emailVerificationToken = undefined; // -> uso único
    user.emailVerificationExpires = undefined;
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Falha ao verificar e-mail' });
  }
});

// POST /api/auth/password/request
router.post('/password/request', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    if (!user.emailVerified) return res.status(400).json({ message: 'E-mail não verificado' });

    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetToken = token;
    user.passwordResetExpires = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2h
    await user.save();

    const FRONT = process.env.FRONTEND_URL || 'http://localhost:5500';
    const link = `${FRONT}/pages/resetar-senha.html?token=${token}`;

    await sendMail({
      to: user.email,
      subject: 'Redefinição de senha',
      html: `
        <h2>Olá, ${user.nomeCompleto || user.razaoSocial || ''}</h2>
        <p>Para definir uma nova senha, use o link abaixo (válido por <b>2 horas</b>):</p>
        <p><a href="${link}" target="_blank">${link}</a></p>
        <p>Este link é de <b>uso único</b>.</p>
      `,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Falha ao solicitar alteração de senha' });
  }
});


// POST /api/auth/password/reset
router.post('/password/reset', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) return res.status(400).json({ message: 'Dados inválidos' });

    const user = await User.findOne({
      passwordResetToken: token,
      passwordResetExpires: { $gt: new Date() }, // ainda válido (2h)
    });
    if (!user) return res.status(400).json({ message: 'Token inválido ou expirado' });

    const strong = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!strong.test(password)) {
      return res.status(400).json({ message: 'A senha deve ter 8+ caracteres, com maiúscula, minúscula e número.' });
    }

    const salt = await bcrypt.genSalt(10);
    user.senha = await bcrypt.hash(password, salt);

    // -> uso único: ao usar, removemos o token
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;

    await user.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Falha ao redefinir senha' });
  }
});

// POST /api/auth/password/change (autenticado)
// Altera imediatamente a senha do usuário autenticado (usado após verificação por e-mail/TOTP no fluxo "Esqueci minha senha")
router.post('/password/change', requireAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ message: 'Informe a nova senha' });

    const strong = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!strong.test(String(password))) {
      return res.status(400).json({ message: 'A senha deve ter 8+ caracteres, com maiúscula, minúscula e número.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });

    const salt = await bcrypt.genSalt(10);
    user.senha = await bcrypt.hash(String(password), salt);
    // Invalida eventual token de reset pendente
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Falha ao alterar senha' });
  }
});

// ========================= Quick Access (Login Rápido) =========================
function findUserByIdentifier(identifier) {
  return resolveUserByIdentifier(identifier);
}

function canUseQuickAccess(user) {
  return !!user && effectiveWebAccountStatus(user) === 'active';
}

// GET /api/auth/quick/options?identifier=...
router.get('/quick/options', async (req, res) => {
  try {
    const { identifier } = req.query;
    if (!identifier) return res.status(400).json({ message: 'Informe o identificador' });
    const user = await findUserByIdentifier(identifier);
    if (!canUseQuickAccess(user)) return res.json({ email: false, totp: false }); // não vaza existência
    res.json({ email: !!user.emailVerified, totp: !!user.totpEnabled, emailMasked: user.email?.replace(/(^.).*(@.*$)/,'$1***$2') });
  } catch (e) {
    res.status(500).json({ message: 'Erro ao consultar opções' });
  }
});

// POST /api/auth/quick/email/send { identifier }
router.post('/quick/email/send', async (req, res) => {
  try {
    const { identifier } = req.body || {};
    if (!identifier) return res.status(400).json({ message: 'Informe o identificador' });
    const user = await findUserByIdentifier(identifier);
    if (!canUseQuickAccess(user) || !user.emailVerified) return res.status(200).json({ ok: true }); // resposta genérica

    // throttle simples: se ainda válido, não reenviar
    if (user.quickEmailCodeExpires && user.quickEmailCodeExpires > new Date()) {
      return res.json({ ok: true });
    }

    const code = ('' + Math.floor(100000 + Math.random()*900000));
    const hash = crypto.createHash('sha256').update(code).digest('hex');
    user.quickEmailCodeHash = hash;
    user.quickEmailCodeExpires = new Date(Date.now() + 10*60*1000); // 10 minutos
    user.quickEmailCodeAttempts = 0;
    await user.save();

    await sendMail({
      to: user.email,
      subject: 'Seu código de acesso rápido',
      html: `<p>Seu código é <b style="font-size:18px">${code}</b>. Válido por 10 minutos.</p>`
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Falha ao enviar código' });
  }
});

// POST /api/auth/quick/email/verify { identifier, code }
router.post('/quick/email/verify', async (req, res) => {
  try {
    const { identifier, code } = req.body || {};
    if (!identifier || !code) return res.status(400).json({ message: 'Dados inválidos' });
    const user = await findUserByIdentifier(identifier);
    if (!canUseQuickAccess(user)) return res.status(400).json({ message: 'Código inválido' });
    if (!user.quickEmailCodeHash || !user.quickEmailCodeExpires || user.quickEmailCodeExpires < new Date()) {
      return res.status(400).json({ message: 'Código expirado' });
    }
    if (user.quickEmailCodeAttempts >= 5) return res.status(429).json({ message: 'Muitas tentativas' });

    const hash = crypto.createHash('sha256').update(String(code)).digest('hex');
    if (hash !== user.quickEmailCodeHash) {
      user.quickEmailCodeAttempts = (user.quickEmailCodeAttempts || 0) + 1;
      await user.save();
      return res.status(400).json({ message: 'Código inválido' });
    }
    // sucesso: limpa OTP e autentica
    user.quickEmailCodeHash = undefined;
    user.quickEmailCodeExpires = undefined;
    user.quickEmailCodeAttempts = 0;
    await user.save();

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, token, user: { _id: user._id, nome: user.nomeCompleto || user.razaoSocial, email: user.email, role: user.role } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Falha ao validar código' });
  }
});

// POST /api/auth/quick/totp/verify { identifier, token }
router.post('/quick/totp/verify', async (req, res) => {
  try {
    const { identifier, token } = req.body || {};
    if (!identifier || !token) return res.status(400).json({ message: 'Dados inválidos' });
    const user = await findUserByIdentifier(identifier);
    if (!canUseQuickAccess(user) || !user.totpEnabled || !user.totpSecretEnc) return res.status(400).json({ message: 'Código inválido' });
    const secret = decrypt(user.totpSecretEnc);
    const ok = verifyTotp(base32Decode(secret), String(token));
    if (!ok) return res.status(400).json({ message: 'Código inválido' });
    const jwtToken = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ ok: true, token: jwtToken, user: { _id: user._id, nome: user.nomeCompleto || user.razaoSocial, email: user.email, role: user.role } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Falha no acesso rápido' });
  }
});
// ====================== TOTP 2FA (Google Authenticator) =====================
// POST /api/auth/totp/setup  -> gera secret temporário e devolve otpauth
router.post('/totp/setup', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    const secretBuf = crypto.randomBytes(20);
    const secret = base32Encode(secretBuf);
    user.totpTempSecretEnc = encrypt(secret);
    user.totpTempCreatedAt = new Date();
    await user.save();
    const issuer = encodeURIComponent('E o Bicho');
    const label = encodeURIComponent(user.email);
    const otpauth = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30&algorithm=SHA1`;
    res.json({ secret, otpauth, enabled: !!user.totpEnabled });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Falha ao gerar TOTP' });
  }
});

// POST /api/auth/totp/verify -> confirma código (usa temp se existir; senão, definitivo)
router.post('/totp/verify', requireAuth, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ message: 'Token ausente' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });

    let secret = '';
    if (user.totpTempSecretEnc) secret = decrypt(user.totpTempSecretEnc);
    if (!secret && user.totpSecretEnc) secret = decrypt(user.totpSecretEnc);
    if (!secret) return res.status(400).json({ message: 'Secret não configurado' });

    const ok = verifyTotp(base32Decode(secret), String(token));
    if (!ok) return res.status(400).json({ message: 'Código inválido' });

    // se estava em setup, promove a definitivo
    if (user.totpTempSecretEnc) {
      user.totpSecretEnc = encrypt(secret);
      user.totpTempSecretEnc = undefined;
      user.totpTempCreatedAt = undefined;
      user.totpEnabled = true;
      await user.save();
    }
    res.json({ ok: true, enabled: !!user.totpEnabled });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Falha ao verificar TOTP' });
  }
});

// POST /api/auth/totp/disable -> desativa (opcional, requer token atual)
router.post('/totp/disable', requireAuth, async (req, res) => {
  try {
    const { token } = req.body || {};
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Usuário não encontrado' });
    if (!user.totpSecretEnc || !user.totpEnabled) return res.status(400).json({ message: 'TOTP não está ativo' });
    if (!token || !verifyTotp(base32Decode(decrypt(user.totpSecretEnc)), String(token))) {
      return res.status(400).json({ message: 'Código inválido' });
    }
    user.totpEnabled = false;
    user.totpSecretEnc = undefined;
    await user.save();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Falha ao desativar TOTP' });
  }
});

module.exports = router;

