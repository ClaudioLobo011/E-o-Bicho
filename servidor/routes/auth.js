const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { body, validationResult } = require('express-validator');
const { cpf, cnpj } = require('cpf-cnpj-validator');
const authMiddleware = require('../middlewares/authMiddleware');
const requireAuth = require('../middlewares/requireAuth');
const crypto = require('crypto');
const { sendMail } = require('../utils/mailer');

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

function digitsOnly(value) {
  return String(value || '').replace(/\D+/g, '');
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
  }

  return { $or: or };
}

const MAX_CODIGO_CLIENTE_SEQUENCIAL = 999999999;

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
  body('celular').notEmpty().withMessage('O número de celular é obrigatório.'),
  body('senha').isLength({ min: 8 }).withMessage('A senha deve ter no mínimo 8 caracteres.').matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/).withMessage('A senha deve conter pelo menos uma letra maiúscula, uma minúscula e um número.'),
  body('confirm_password').notEmpty().withMessage('A confirmação de senha é obrigatória.').custom((value, { req }) => { if (value !== req.body.senha) { throw new Error('As senhas não coincidem. Por favor, tente novamente.'); } return true; }),
  body('cpf').if(body('tipoConta').equals('pessoa_fisica')).notEmpty().withMessage('O CPF é obrigatório.').custom((value) => { if (!cpf.isValid(value)) { throw new Error('O CPF inserido não é válido.'); } return true; }),
  body('cnpj').if(body('tipoConta').equals('pessoa_juridica')).notEmpty().withMessage('O CNPJ é obrigatório.').custom((value) => { if (!cnpj.isValid(value)) { throw new Error('O CNPJ inserido não é válido.'); } return true; }),
  body('terms').equals('on').withMessage('Você deve concordar com os termos e condições para se registar.'),
  body('inscricaoEstadual').if(body('tipoConta').equals('pessoa_juridica')).if(body('isentoIE').not().exists()).notEmpty().withMessage('A Inscrição Estadual é obrigatória quando não isento.'),
];

// ROTA: POST /api/register
router.post('/register', registerValidationRules, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, celular, cpf: reqCpf, cnpj: reqCnpj } = req.body;

    const conditions = [{ email }, { celular }];
    if (reqCpf) conditions.push({ cpf: reqCpf });
    if (reqCnpj) conditions.push({ cnpj: reqCnpj });

    const userExists = await User.findOne({ $or: conditions });

    if (userExists) {
      let field, message;
      if (userExists.email === email) {
        field = 'email';
        message = 'Este email já está a ser utilizado.';
      } else if (userExists.celular === celular) {
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
      email: req.body.email,
      senha: hashedPassword,
      celular: req.body.celular,
      telefone: req.body.telefone,
      nomeCompleto: req.body.nomeCompleto,
      cpf: req.body.cpf,
      genero: req.body.genero,
      dataNascimento: req.body.dataNascimento,
      razaoSocial: req.body.razaoSocial,
      cnpj: req.body.cnpj,
      nomeContato: req.body.nomeContato,
      inscricaoEstadual: req.body.inscricaoEstadual,
      estadoIE: req.body.estadoIE,
      isentoIE: isento,
      role: 'cliente',
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
        const query = buildIdentifierQuery(identifier);
        const user = query ? await User.findOne(query) : null;

        if (!user || !(await bcrypt.compare(senha, user.senha))) {
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
        role: req.user.role   // <<-- importante!
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
  const query = buildIdentifierQuery(identifier);
  if (!query) return null;
  return User.findOne(query);
}

// GET /api/auth/quick/options?identifier=...
router.get('/quick/options', async (req, res) => {
  try {
    const { identifier } = req.query;
    if (!identifier) return res.status(400).json({ message: 'Informe o identificador' });
    const user = await findUserByIdentifier(identifier);
    if (!user) return res.json({ email: false, totp: false }); // não vaza existência
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
    if (!user || !user.emailVerified) return res.status(200).json({ ok: true }); // resposta genérica

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
    if (!user) return res.status(400).json({ message: 'Código inválido' });
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
    if (!user || !user.totpEnabled || !user.totpSecretEnc) return res.status(400).json({ message: 'Código inválido' });
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

