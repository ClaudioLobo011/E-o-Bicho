const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const path = require('path');
const Product = require('../models/Product');
const Category = require('../models/Category');
const multer = require('multer');
const fs = require('fs');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const PdvState = require('../models/PdvState');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
    buildProductImageFileName,
    buildProductImagePublicPath,
    buildProductImageStoragePath,
    ensureProductImageFolder,
    getProductImagesDriveFolderPath,
    moveFile,
    parseProductImagePublicPath,
    resolveDiskPathFromPublicPath,
    sanitizeBarcodeSegment,
} = require('../utils/productImagePath');
const {
    deleteFile: deleteDriveFile,
    findDriveFileByPath,
    isDriveConfigured,
    uploadBufferToDrive,
} = require('../utils/googleDrive');

const tempUploadDir = path.join(__dirname, '..', 'tmp', 'uploads', 'products');

const ensureTempUploadDir = () => {
    if (!fs.existsSync(tempUploadDir)) {
        fs.mkdirSync(tempUploadDir, { recursive: true });
    }
};

// Configuração do Multer para upload de imagens
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        try {
            ensureTempUploadDir();
            cb(null, tempUploadDir);
        } catch (error) {
            cb(error);
        }
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `temp-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage: storage });


const resolveAuthenticatedUser = async (req) => {
    try {
        const header = typeof req.headers?.authorization === 'string' ? req.headers.authorization.trim() : '';
        if (!header) return null;
        const [scheme, token] = header.split(' ');
        if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!decoded?.id) return null;
        const user = await User.findById(decoded.id).select('role email');
        if (!user) return null;
        return {
            id: decoded.id,
            role: user.role,
            email: user.email,
        };
    } catch (error) {
        return null;
    }
};


router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const payload = req.body || {};
        const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');
        const normalizeDocument = (value) => {
            if (value === null || value === undefined) return '';
            if (typeof value === 'number' && Number.isFinite(value)) {
                return String(value).replace(/\D+/g, '');
            }
            if (typeof value === 'string') {
                return value.trim().replace(/\D+/g, '');
            }
            return String(value).replace(/\D+/g, '');
        };
        const parseDate = (value) => {
            if (!value) return null;
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        };
        const parseNumber = (value) => {
            if (value === null || value === undefined || value === '') return null;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };

        const nome = normalizeString(payload.nome);
        if (!nome) {
            return res.status(400).json({ message: 'Informe a descrição do produto.' });
        }

        const codbarras = normalizeString(payload.codbarras);
        if (!codbarras) {
            return res.status(400).json({ message: 'Informe o código de barras do produto.' });
        }

        const existingBarcode = await Product.findOne({ codbarras }).lean();
        if (existingBarcode) {
            return res.status(409).json({ message: 'Já existe um produto com este código de barras.' });
        }

        let cod = normalizeString(payload.cod);
        const codProvided = Boolean(cod);
        if (codProvided) {
            const existingCod = await Product.findOne({ cod }).lean();
            if (existingCod) {
                return res.status(409).json({ message: 'Já existe um produto com este código interno.' });
            }
        } else {
            cod = await generateSequentialCod();
        }

        const fornecedores = Array.isArray(payload.fornecedores)
            ? payload.fornecedores
                .map((item) => {
                    const fornecedor = normalizeString(item?.fornecedor);
                    if (!fornecedor) return null;
                    const valorCalculo = parseNumber(item?.valorCalculo);
                    const documentoFornecedor = normalizeDocument(
                        item?.documentoFornecedor ||
                        item?.documento ||
                        item?.supplierDocument ||
                        item?.cnpjFornecedor ||
                        item?.cnpj
                    );
                    return {
                        fornecedor,
                        documentoFornecedor,
                        nomeProdutoFornecedor: normalizeString(item?.nomeProdutoFornecedor),
                        codigoProduto: normalizeString(item?.codigoProduto),
                        unidadeEntrada: normalizeString(item?.unidadeEntrada),
                        tipoCalculo: normalizeString(item?.tipoCalculo),
                        valorCalculo: valorCalculo,
                    };
                })
                .filter(Boolean)
            : [];

        const estoques = Array.isArray(payload.estoques)
            ? payload.estoques
                .map((item) => {
                    const deposito = item?.deposito || item?.depositId;
                    if (!deposito) return null;
                    const quantidade = parseNumber(item?.quantidade);
                    return {
                        deposito,
                        quantidade: quantidade === null ? 0 : quantidade,
                        unidade: normalizeString(item?.unidade),
                    };
                })
                .filter(Boolean)
            : [];

        const costNumber = parseNumber(payload.custo);
        const saleNumber = parseNumber(payload.venda);
        const stockNumber = parseNumber(payload.stock);

        const productData = {
            cod,
            codbarras,
            nome,
            descricao: payload.descricao || '',
            marca: payload.marca || '',
            unidade: normalizeString(payload.unidade),
            referencia: normalizeString(payload.referencia),
            custo: Number.isFinite(costNumber) && costNumber >= 0 ? costNumber : 0,
            venda: Number.isFinite(saleNumber) && saleNumber >= 0 ? saleNumber : 0,
            categorias: Array.isArray(payload.categorias) ? payload.categorias : [],
            especificacoes: typeof payload.especificacoes === 'object' && payload.especificacoes !== null
                ? payload.especificacoes
                : {},
            fornecedores,
            estoques,
            stock: estoques.length > 0
                ? estoques.reduce((sum, entry) => sum + (Number(entry.quantidade) || 0), 0)
                : Number.isFinite(stockNumber) && stockNumber >= 0
                    ? stockNumber
                    : 0,
            dataCadastro: parseDate(payload.dataCadastro),
            peso: parseNumber(payload.peso),
            iat: normalizeString(payload.iat),
            tipoProduto: normalizeString(payload.tipoProduto),
            ncm: normalizeString(payload.ncm),
            naoMostrarNoSite: payload.naoMostrarNoSite === undefined
                ? true
                : Boolean(payload.naoMostrarNoSite),
            inativo: Boolean(payload.inativo),
            codigosComplementares: Array.isArray(payload.codigosComplementares)
                ? payload.codigosComplementares.map((code) => normalizeString(code)).filter(Boolean)
                : [],
            fiscal: sanitizeFiscalData(payload.fiscal || {}, {}, req.user?.id || ''),
            fiscalPorEmpresa: {},
        };

        if (payload.fiscalPorEmpresa && typeof payload.fiscalPorEmpresa === 'object') {
            Object.entries(payload.fiscalPorEmpresa).forEach(([companyId, fiscalData]) => {
                if (!companyId) return;
                productData.fiscalPorEmpresa[companyId] = sanitizeFiscalData(
                    fiscalData,
                    {},
                    req.user?.id || ''
                );
            });
        }

        let createdProduct = null;
        let attempts = 0;

        while (attempts < 5 && !createdProduct) {
            try {
                const product = new Product(productData);
                createdProduct = await product.save();
            } catch (error) {
                if (!codProvided && error?.code === 11000 && error?.keyPattern?.cod) {
                    cod = await generateSequentialCod();
                    productData.cod = cod;
                    attempts += 1;
                    continue;
                }
                if (error?.code === 11000 && error?.keyPattern?.codbarras) {
                    return res.status(409).json({ message: 'Já existe um produto com este código de barras.' });
                }
                if (error?.code === 11000 && error?.keyPattern?.cod) {
                    return res.status(409).json({ message: 'Já existe um produto com este código interno.' });
                }
                throw error;
            }
        }

        if (!createdProduct) {
            return res.status(500).json({ message: 'Não foi possível gerar um código interno único para o produto.' });
        }

        const populatedProduct = await Product.findById(createdProduct._id)
            .populate('categorias')
            .populate({
                path: 'estoques.deposito',
                populate: { path: 'empresa' }
            })
            .lean();

        res.status(201).json({ product: populatedProduct });
    } catch (error) {
        console.error('Erro ao cadastrar produto:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});


// Função auxiliar recursiva para encontrar todos os IDs de sub-categorias
async function findAllSubCategoryIds(categoryId) {
    let ids = [categoryId];
    const children = await Category.find({ parent: categoryId });
    for (const child of children) {
        ids = ids.concat(await findAllSubCategoryIds(child._id));
    }
    return ids;
}

const extractCodComponents = (cod) => {
    if (typeof cod !== 'string') return null;
    const trimmed = cod.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(.*?)(\d+)([^0-9]*)$/);
    if (match) {
        return {
            prefix: match[1] || '',
            numeric: match[2] || '',
            suffix: match[3] || '',
        };
    }
    const digits = trimmed.replace(/\D+/g, '');
    if (!digits) return null;
    const startIndex = trimmed.indexOf(digits);
    return {
        prefix: startIndex > 0 ? trimmed.slice(0, startIndex) : '',
        numeric: digits,
        suffix: trimmed.slice(startIndex + digits.length) || '',
    };
};

const generateSequentialCod = async () => {
    const existingProducts = await Product.find(
        { cod: { $exists: true, $ne: null } },
        { cod: 1 }
    )
        .collation({ locale: 'pt', numericOrdering: true })
        .sort({ cod: 1 })
        .lean();

    if (!existingProducts.length) {
        return '000001';
    }

    let padding = 6;
    const numericCodes = [];

    existingProducts.forEach((product) => {
        const components = extractCodComponents(product.cod);
        if (!components?.numeric) {
            const digits = typeof product.cod === 'string' ? product.cod.replace(/\D+/g, '') : '';
            const parsed = Number.parseInt(digits || '0', 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                padding = Math.max(padding, digits.length || 0);
                numericCodes.push(parsed);
            }
            return;
        }

        const parsed = Number.parseInt(components.numeric, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return;
        padding = Math.max(padding, components.numeric.length || 0);
        if (!components.prefix && !components.suffix) {
            numericCodes.push(parsed);
            return;
        }

        numericCodes.push(parsed);
    });

    if (!numericCodes.length) {
        return '000001';
    }

    numericCodes.sort((a, b) => a - b);

    let candidate = 1;
    for (const value of numericCodes) {
        if (value < candidate) continue;
        if (value === candidate) {
            candidate += 1;
            continue;
        }
        break;
    }

    return String(candidate).padStart(padding, '0');
};

// GET /api/products/by-category (pública)
router.get('/by-category', async (req, res) => {
    try {
        const { name: categoryName, parent: parentName, grandparent: grandParentName } = req.query;
        let query = { nome: new RegExp('^' + categoryName + '$', 'i') };

        if (parentName) {
            let parentCandidates = await Category.find({ nome: new RegExp('^' + parentName + '$', 'i') });

            if (grandParentName) {
                const grandParent = await Category.findOne({ nome: new RegExp('^' + grandParentName + '$', 'i') });
                if (grandParent) {
                    parentCandidates = await Category.find({ nome: new RegExp('^' + parentName + '$', 'i'), parent: grandParent._id });
                }
            }
            if (parentCandidates.length > 0) {
                query.parent = { $in: parentCandidates.map(p => p._id) };
            }
        }

        const topCategory = await Category.findOne(query);
        if (!topCategory) return res.json({ products: [], page: 1, pages: 1, total: 0 });

        const allCategoryIds = await findAllSubCategoryIds(topCategory._id);
        const categoryFilters = {
            categorias: { $in: allCategoryIds },
            naoMostrarNoSite: { $ne: true },
        };
        const products = await Product.find(categoryFilters)
            .populate('categorias')
            .sort({ nome: 1 })
            .lean();

        products.forEach(p => { if (!p.imagemPrincipal) p.imagemPrincipal = '/image/placeholder.png'; });
        res.json({ products, page: 1, pages: 1, total: products.length });
    } catch (error) {
        console.error("Erro ao buscar produtos por categoria:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// GET /api/products (pública, listagem com paginação e busca)
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 20, search = '', includeHidden = 'false', audience = '' } = req.query;

        let allowHiddenProducts = false;
        if (includeHidden === 'true' || audience === 'pdv') {
            const authenticated = await resolveAuthenticatedUser(req);
            allowHiddenProducts = Boolean(authenticated);
        }

        const query = allowHiddenProducts ? {} : { naoMostrarNoSite: { $ne: true } };

        if (search) {
            const normalizedSearch = search.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            query.searchableString = { $regex: normalizedSearch, $options: 'i' };
        }

        const products = await Product.find(query)
            .limit(parseInt(limit))
            .skip(parseInt(limit) * (page - 1))
            .populate('categorias')
            .sort({ nome: 1 })
            .lean();

        const total = await Product.countDocuments(query);

        products.forEach(p => {
            if (!p.imagemPrincipal) {
                p.imagemPrincipal = '/image/placeholder.png';
            }
            if (Array.isArray(p.estoques) && p.estoques.length > 0) {
                const total = p.estoques.reduce((sum, entry) => {
                    const quantity = Number(entry?.quantidade);
                    return sum + (Number.isFinite(quantity) ? quantity : 0);
                }, 0);
                p.stock = total;
            } else {
                const parsedStock = Number(p.stock);
                p.stock = Number.isFinite(parsedStock) ? parsedStock : 0;
            }
        });

        res.json({
            products,
            page: parseInt(page),
            pages: Math.ceil(total / limit),
            total: total
        });
    } catch (error) {
        console.error("Erro ao buscar produtos:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// GET /api/products/destaques (pública)
router.get('/destaques', async (req, res) => {
    try {
        const destaques = await Product.find({
            isDestaque: true,
            naoMostrarNoSite: { $ne: true },
        }).sort({ destaqueOrder: 1 });
        res.json(destaques);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar produtos em destaque.' });
    }
});

// PUT /api/products/bulk-update-category (restrito)
router.put('/bulk-update-category', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const { productIds, newCategoryId, brandName } = req.body;
        if (!productIds || !newCategoryId || !Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ message: 'Dados inválidos ou nenhum produto selecionado.' });
        }

        const updateOperation = { $addToSet: { categorias: newCategoryId } };
        if (brandName) updateOperation.$set = { marca: brandName };

        const result = await Product.updateMany({ _id: { $in: productIds } }, updateOperation);
        res.json({ message: `${result.modifiedCount} produtos foram atualizados com sucesso.` });
    } catch (error) {
        console.error("Erro ao atualizar produtos em massa:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// PUT /api/products/destaques/order (restrito)
router.put('/destaques/order', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const { orderedIds } = req.body;
        if (!Array.isArray(orderedIds)) {
            return res.status(400).json({ message: 'Formato de dados inválido.' });
        }
        await Promise.all(
            orderedIds.map((id, index) =>
                Product.findByIdAndUpdate(id, { destaqueOrder: index + 1 })
            )
        );
        res.json({ message: 'Ordem dos destaques atualizada com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao reordenar os destaques.' });
    }
});

// GET /api/products/by-barcode/:barcode (pública)
router.get('/by-barcode/:barcode', async (req, res) => {
    try {
        const fullBarcode = req.params.barcode;
        const parts = fullBarcode.split('-');
        const baseBarcode = parts[0];
        const imageIndex = parts.length > 1 ? parseInt(parts[1], 10) - 1 : -1;

        const wantsHidden = req.query?.includeHidden === 'true' || req.query?.audience === 'pdv';
        let allowHidden = false;
        if (wantsHidden) {
            const authenticated = await resolveAuthenticatedUser(req);
            allowHidden = Boolean(authenticated);
        }

        const filters = { codbarras: baseBarcode };
        if (!allowHidden) {
            filters.naoMostrarNoSite = { $ne: true };
        }

        const product = await Product.findOne(filters).populate('categorias').lean();
        if (!product) return res.status(404).json({ message: 'Produto não encontrado.' });

        if (imageIndex >= 0 && product.imagens && product.imagens[imageIndex]) {
            product.imagemPrincipal = product.imagens[imageIndex];
        } else if (!product.imagemPrincipal) {
            product.imagemPrincipal = '/image/placeholder.png';
        }

        res.json({ products: [product], page: 1, pages: 1, total: 1 });
    } catch (error) {
        console.error("Erro na busca por código de barras:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// GET /api/products/check-unique (pública)
router.get('/check-unique', async (req, res) => {
    try {
        const rawCod = typeof req.query.cod === 'string' ? req.query.cod.trim() : '';
        const rawBarcode = typeof req.query.codbarras === 'string' ? req.query.codbarras.trim() : '';

        if (!rawCod && !rawBarcode) {
            return res.status(400).json({ message: 'Informe o código interno ou o código de barras.' });
        }

        const filters = [];
        if (rawCod) filters.push({ cod: rawCod });
        if (rawBarcode) filters.push({ codbarras: rawBarcode });

        const query = filters.length > 1 ? { $or: filters } : filters[0];

        const product = await Product.findOne(query, { nome: 1, cod: 1, codbarras: 1 }).lean();

        if (!product) {
            return res.json({ exists: false });
        }

        return res.json({
            exists: true,
            product: {
                _id: product._id,
                nome: product.nome,
                cod: product.cod,
                codbarras: product.codbarras,
            },
        });
    } catch (error) {
        console.error('Erro ao verificar duplicidade de produto:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

router.get(
    '/search-by-supplier',
    requireAuth,
    authorizeRoles('admin', 'admin_master'),
    async (req, res) => {
        try {
            const supplierCodeCanonical = canonicalSupplierProductCode(req.query?.supplierCode);
            if (!supplierCodeCanonical) {
                return res.status(400).json({ message: 'Informe o código do produto no fornecedor.' });
            }

            const supplierNameCanonical = canonicalSupplierName(req.query?.supplierName);
            const supplierDocumentDigits = normalizeDocumentDigits(req.query?.supplierDocument);

            const supplierCodeRaw = normalizeSupplierString(req.query?.supplierCode);
            const codeRegex = new RegExp(`^${escapeRegExp(supplierCodeRaw)}$`, 'i');

            const candidates = await Product.find({ 'fornecedores.codigoProduto': { $regex: codeRegex } })
                .select('cod codbarras nome imagemPrincipal imagens marca unidade fornecedores')
                .lean();

            const match = candidates.find((product) => {
                if (!Array.isArray(product?.fornecedores)) return false;
                return product.fornecedores.some((entry) => {
                    if (canonicalSupplierProductCode(entry?.codigoProduto) !== supplierCodeCanonical) {
                        return false;
                    }

                    if (supplierNameCanonical) {
                        if (canonicalSupplierName(entry?.fornecedor) !== supplierNameCanonical) {
                            return false;
                        }
                    }

                    if (supplierDocumentDigits) {
                        const entryDocument = normalizeDocumentDigits(entry?.documentoFornecedor);
                        if (entryDocument && entryDocument !== supplierDocumentDigits) {
                            return false;
                        }
                    }

                    return true;
                });
            });

            if (!match) {
                return res.status(404).json({ message: 'Produto não encontrado para o fornecedor informado.' });
            }

            return res.json({ product: match });
        } catch (error) {
            console.error('Erro ao localizar produto pelo fornecedor:', error);
            res.status(500).json({ message: 'Erro ao localizar produto pelo fornecedor.' });
        }
    }
);

// ========================================================================
// ========= FUNÇÃO AUXILIAR PARA BREADCRUMB ===============================
async function getCategoryPath(categoryId) {
    // Primeiro, monta a lista de categorias do nó raiz até a folha
    const nodes = [];
    let currentIdToSearch = categoryId;
    for (let i = 0; i < 10; i++) {
        if (!currentIdToSearch) break;
        const currentCategory = await mongoose.model('Category').findById(currentIdToSearch).lean();
        if (!currentCategory) break;
        nodes.unshift({ nome: currentCategory.nome });
        currentIdToSearch = currentCategory.parent;
    }

    // Em seguida, constrói os hrefs incluindo parent/grandparent quando existirem
    const path = nodes.map((cat, index, arr) => {
        let href = `/pages/menu-departments-item/search.html?category=${encodeURIComponent(cat.nome)}`;
        if (index > 0) {
            href += `&parent=${encodeURIComponent(arr[index - 1].nome)}`;
        }
        if (index > 1) {
            href += `&grandparent=${encodeURIComponent(arr[index - 2].nome)}`;
        }
        return { nome: cat.nome, href };
    });

    return path;
}

// GET /api/products/:id (pública)
router.get('/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id)
            .populate('categorias')
            .populate({
                path: 'estoques.deposito',
                populate: { path: 'empresa' }
            })
            .lean();
        if (!product) return res.status(404).json({ message: 'Produto não encontrado.' });

        if (product.categorias && product.categorias.length > 0) {
            const primaryCategory = product.categorias[0];
            product.breadcrumbPath = await getCategoryPath(primaryCategory._id);
        } else {
            product.breadcrumbPath = [];
        }

        res.json(product);
    } catch (error) {
        console.error("Erro ao buscar produto por ID:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// PUT /api/products/:id (restrito)
const fiscalStatusAllowed = new Set(['pendente', 'parcial', 'aprovado']);

const sanitizeFiscalString = (value, fallback = '') => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    return fallback;
};

const sanitizeFiscalNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const sanitizeFiscalTax = (tax = {}, existing = {}) => ({
    codigo: sanitizeFiscalString(tax?.codigo, existing?.codigo || ''),
    cst: sanitizeFiscalString(tax?.cst, existing?.cst || ''),
    aliquota: sanitizeFiscalNumber(tax?.aliquota ?? existing?.aliquota ?? null),
    tipoCalculo: sanitizeFiscalString(tax?.tipoCalculo, existing?.tipoCalculo || 'percentual') || 'percentual',
    valorBase: sanitizeFiscalNumber(tax?.valorBase ?? existing?.valorBase ?? null),
});

const sanitizeFiscalCfop = (cfop = {}, existing = {}) => ({
    dentroEstado: sanitizeFiscalString(cfop?.dentroEstado, existing?.dentroEstado || ''),
    foraEstado: sanitizeFiscalString(cfop?.foraEstado, existing?.foraEstado || ''),
    transferencia: sanitizeFiscalString(cfop?.transferencia, existing?.transferencia || ''),
    devolucao: sanitizeFiscalString(cfop?.devolucao, existing?.devolucao || ''),
    industrializacao: sanitizeFiscalString(cfop?.industrializacao, existing?.industrializacao || ''),
});

const sanitizeFiscalStatus = (value, existing = 'pendente') => {
    const normalized = sanitizeFiscalString(value, existing || 'pendente').toLowerCase();
    return fiscalStatusAllowed.has(normalized) ? normalized : (fiscalStatusAllowed.has(existing) ? existing : 'pendente');
};

const sanitizeFiscalData = (rawFiscal = {}, existingFiscal = {}, updatedBy = '') => ({
    origem: sanitizeFiscalString(rawFiscal?.origem, existingFiscal?.origem || '0') || '0',
    cest: sanitizeFiscalString(rawFiscal?.cest, existingFiscal?.cest || ''),
    csosn: sanitizeFiscalString(rawFiscal?.csosn, existingFiscal?.csosn || ''),
    cst: sanitizeFiscalString(rawFiscal?.cst, existingFiscal?.cst || ''),
    cfop: {
        nfe: sanitizeFiscalCfop(rawFiscal?.cfop?.nfe, existingFiscal?.cfop?.nfe || {}),
        nfce: sanitizeFiscalCfop(rawFiscal?.cfop?.nfce, existingFiscal?.cfop?.nfce || {}),
    },
    pis: sanitizeFiscalTax(rawFiscal?.pis, existingFiscal?.pis || {}),
    cofins: sanitizeFiscalTax(rawFiscal?.cofins, existingFiscal?.cofins || {}),
    ipi: {
        cst: sanitizeFiscalString(rawFiscal?.ipi?.cst, existingFiscal?.ipi?.cst || ''),
        codigoEnquadramento: sanitizeFiscalString(rawFiscal?.ipi?.codigoEnquadramento, existingFiscal?.ipi?.codigoEnquadramento || ''),
        aliquota: sanitizeFiscalNumber(rawFiscal?.ipi?.aliquota ?? existingFiscal?.ipi?.aliquota ?? null),
        tipoCalculo: sanitizeFiscalString(rawFiscal?.ipi?.tipoCalculo, existingFiscal?.ipi?.tipoCalculo || 'percentual') || 'percentual',
        valorBase: sanitizeFiscalNumber(rawFiscal?.ipi?.valorBase ?? existingFiscal?.ipi?.valorBase ?? null),
    },
    fcp: {
        indicador: sanitizeFiscalString(rawFiscal?.fcp?.indicador, existingFiscal?.fcp?.indicador || '0') || '0',
        aliquota: sanitizeFiscalNumber(rawFiscal?.fcp?.aliquota ?? existingFiscal?.fcp?.aliquota ?? null),
        aplica: Boolean(rawFiscal?.fcp?.aplica ?? existingFiscal?.fcp?.aplica ?? false),
    },
    status: {
        nfe: sanitizeFiscalStatus(rawFiscal?.status?.nfe, existingFiscal?.status?.nfe || 'pendente'),
        nfce: sanitizeFiscalStatus(rawFiscal?.status?.nfce, existingFiscal?.status?.nfce || 'pendente'),
    },
    atualizadoEm: new Date(),
    atualizadoPor: sanitizeFiscalString(rawFiscal?.atualizadoPor, updatedBy || existingFiscal?.atualizadoPor || ''),
});

router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const payload = req.body || {};

        const existingProduct = await Product.findById(req.params.id);
        if (!existingProduct) {
            return res.status(404).json({ message: 'Produto não encontrado.' });
        }

        const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');
        const normalizeDocument = (value) => {
            if (value === null || value === undefined) return '';
            if (typeof value === 'number' && Number.isFinite(value)) {
                return String(value).replace(/\D+/g, '');
            }
            if (typeof value === 'string') {
                return value.trim().replace(/\D+/g, '');
            }
            return String(value).replace(/\D+/g, '');
        };
        const parseDate = (value) => {
            if (!value) return null;
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        };
        const parseNumber = (value) => {
            if (value === null || value === undefined || value === '') return null;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };

        const fornecedores = Array.isArray(payload.fornecedores)
            ? payload.fornecedores
                .map((item) => {
                    const fornecedor = normalizeString(item?.fornecedor);
                    if (!fornecedor) return null;
                    const valorCalculo = parseNumber(item?.valorCalculo);
                    const documentoFornecedor = normalizeDocument(
                        item?.documentoFornecedor ||
                        item?.documento ||
                        item?.supplierDocument ||
                        item?.cnpjFornecedor ||
                        item?.cnpj
                    );
                    return {
                        fornecedor,
                        documentoFornecedor,
                        nomeProdutoFornecedor: normalizeString(item?.nomeProdutoFornecedor),
                        codigoProduto: normalizeString(item?.codigoProduto),
                        unidadeEntrada: normalizeString(item?.unidadeEntrada),
                        tipoCalculo: normalizeString(item?.tipoCalculo),
                        valorCalculo: valorCalculo,
                    };
                })
                .filter(Boolean)
            : [];

        const estoques = Array.isArray(payload.estoques)
            ? payload.estoques
                .map((item) => {
                    const deposito = item?.deposito || item?.depositId;
                    if (!deposito) return null;
                    const quantidade = parseNumber(item?.quantidade);
                    return {
                        deposito,
                        quantidade: quantidade === null ? 0 : quantidade,
                        unidade: normalizeString(item?.unidade),
                    };
                })
                .filter(Boolean)
            : [];

        const updatePayload = {};

        if (payload.nome !== undefined) {
            const normalizedName = normalizeString(payload.nome);
            if (!normalizedName) {
                return res.status(400).json({ message: 'Informe a descrição do produto.' });
            }
            updatePayload.nome = normalizedName;
        }

        if (payload.descricao !== undefined) updatePayload.descricao = payload.descricao;
        if (payload.marca !== undefined) updatePayload.marca = payload.marca;
        if (payload.categorias !== undefined) updatePayload.categorias = Array.isArray(payload.categorias) ? payload.categorias : [];
        if (payload.especificacoes !== undefined) updatePayload.especificacoes = payload.especificacoes;
        if (payload.unidade !== undefined) updatePayload.unidade = normalizeString(payload.unidade);
        if (payload.referencia !== undefined) updatePayload.referencia = normalizeString(payload.referencia);
        if (payload.dataCadastro !== undefined) updatePayload.dataCadastro = parseDate(payload.dataCadastro);
        if (payload.peso !== undefined) updatePayload.peso = parseNumber(payload.peso);
        if (payload.iat !== undefined) updatePayload.iat = normalizeString(payload.iat);
        if (payload.tipoProduto !== undefined) updatePayload.tipoProduto = normalizeString(payload.tipoProduto);
        if (payload.ncm !== undefined) updatePayload.ncm = normalizeString(payload.ncm);
        if (payload.custo !== undefined) updatePayload.custo = parseNumber(payload.custo);
        if (payload.venda !== undefined) updatePayload.venda = parseNumber(payload.venda);
        if (payload.codigosComplementares !== undefined) {
            updatePayload.codigosComplementares = Array.isArray(payload.codigosComplementares)
                ? payload.codigosComplementares.map((code) => normalizeString(code)).filter(Boolean)
                : [];
        }
        if (payload.naoMostrarNoSite !== undefined) {
            updatePayload.naoMostrarNoSite = Boolean(payload.naoMostrarNoSite);
        }

        updatePayload.fornecedores = fornecedores;
        updatePayload.estoques = estoques;

        if (estoques.length > 0) {
            const totalStock = estoques.reduce((sum, item) => sum + (Number(item.quantidade) || 0), 0);
            updatePayload.stock = totalStock;
        } else if (payload.stock !== undefined) {
            const parsedStock = parseNumber(payload.stock);
            updatePayload.stock = parsedStock === null ? 0 : parsedStock;
        }

        if (payload.fiscal !== undefined) {
            updatePayload.fiscal = sanitizeFiscalData(payload.fiscal, existingProduct?.fiscal || {}, req.user?.id || '');
        }

        const updatedProduct = await Product.findByIdAndUpdate(
            req.params.id,
            updatePayload,
            { new: true, runValidators: true }
        );

        const populatedProduct = await Product.findById(req.params.id)
            .populate('categorias')
            .populate({
                path: 'estoques.deposito',
                populate: { path: 'empresa' }
            })
            .lean();

        res.json(populatedProduct);
    } catch (error) {
        console.error("Erro ao atualizar produto:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

const normalizeSupplierString = (value) => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
};

const canonicalSupplierName = (value) => {
    const normalized = normalizeSupplierString(value);
    if (!normalized) return '';
    return normalized
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
};

const canonicalSupplierProductCode = (value) => normalizeSupplierString(value).toUpperCase();

const normalizeDocumentDigits = (value) => normalizeSupplierString(value).replace(/\D+/g, '');

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseNullableNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const mapSupplierEntriesToPlainObject = (entries = []) =>
    entries.map((entry) => (typeof entry?.toObject === 'function' ? entry.toObject() : { ...entry }));

router.post(
    '/:id/suppliers/link',
    requireAuth,
    authorizeRoles('admin', 'admin_master'),
    async (req, res) => {
        try {
            const productId = req.params.id;
            const product = await Product.findById(productId);
            if (!product) {
                return res.status(404).json({ message: 'Produto não encontrado.' });
            }

            const supplierName = normalizeSupplierString(req.body?.fornecedor);
            const supplierProductCode = normalizeSupplierString(req.body?.codigoProduto);
            if (!supplierProductCode) {
                return res
                    .status(400)
                    .json({ message: 'Informe o código do produto no fornecedor.' });
            }
            if (!supplierName) {
                return res.status(400).json({ message: 'Informe o nome do fornecedor.' });
            }

            const supplierDocumentDigits = normalizeDocumentDigits(
                req.body?.documentoFornecedor ||
                req.body?.supplierDocument ||
                req.body?.documento ||
                req.body?.cnpjFornecedor ||
                req.body?.cnpj
            );
            const supplierProductName = normalizeSupplierString(req.body?.nomeProdutoFornecedor);
            const supplierUnit = normalizeSupplierString(req.body?.unidadeEntrada);
            const supplierCalcType = normalizeSupplierString(req.body?.tipoCalculo);
            const supplierCalcValue = parseNullableNumber(req.body?.valorCalculo);

            const suppliers = Array.isArray(product.fornecedores)
                ? [...product.fornecedores]
                : [];
            const normalizedSupplierName = canonicalSupplierName(supplierName);
            const normalizedSupplierCode = canonicalSupplierProductCode(supplierProductCode);
            const existingIndex = suppliers.findIndex((entry) => {
                if (canonicalSupplierProductCode(entry?.codigoProduto) !== normalizedSupplierCode) {
                    return false;
                }
                const entryDocumentDigits = normalizeDocumentDigits(entry?.documentoFornecedor);
                if (supplierDocumentDigits && entryDocumentDigits) {
                    return entryDocumentDigits === supplierDocumentDigits;
                }
                return canonicalSupplierName(entry?.fornecedor) === normalizedSupplierName;
            });

            if (existingIndex >= 0) {
                const existingEntry = suppliers[existingIndex];
                let changed = false;

                if (normalizeSupplierString(existingEntry?.fornecedor) !== supplierName) {
                    existingEntry.fornecedor = supplierName;
                    changed = true;
                }

                if (supplierDocumentDigits) {
                    const entryDocumentDigits = normalizeDocumentDigits(existingEntry?.documentoFornecedor);
                    if (entryDocumentDigits !== supplierDocumentDigits) {
                        existingEntry.documentoFornecedor = supplierDocumentDigits;
                        changed = true;
                    }
                }

                if (supplierProductName) {
                    const normalizedExistingName = normalizeSupplierString(
                        existingEntry?.nomeProdutoFornecedor
                    );
                    if (normalizedExistingName !== supplierProductName) {
                        existingEntry.nomeProdutoFornecedor = supplierProductName;
                        changed = true;
                    }
                }

                if (supplierUnit) {
                    if (normalizeSupplierString(existingEntry?.unidadeEntrada) !== supplierUnit) {
                        existingEntry.unidadeEntrada = supplierUnit;
                        changed = true;
                    }
                }

                if (supplierCalcType) {
                    if (normalizeSupplierString(existingEntry?.tipoCalculo) !== supplierCalcType) {
                        existingEntry.tipoCalculo = supplierCalcType;
                        changed = true;
                    }
                }

                if (req.body?.valorCalculo !== undefined) {
                    if (supplierCalcValue !== null) {
                        if (!Number.isFinite(existingEntry?.valorCalculo) || existingEntry.valorCalculo !== supplierCalcValue) {
                            existingEntry.valorCalculo = supplierCalcValue;
                            changed = true;
                        }
                    } else if (existingEntry?.valorCalculo !== null && existingEntry?.valorCalculo !== undefined) {
                        existingEntry.valorCalculo = null;
                        changed = true;
                    }
                }

                if (changed) {
                    suppliers[existingIndex] = existingEntry;
                    product.fornecedores = suppliers;
                    product.markModified('fornecedores');
                    await product.save();
                }

                return res.json({
                    linked: true,
                    updated: changed,
                    fornecedor: mapSupplierEntriesToPlainObject([suppliers[existingIndex]])[0],
                    fornecedores: mapSupplierEntriesToPlainObject(product.fornecedores),
                });
            }

            const newEntry = {
                fornecedor: supplierName,
                documentoFornecedor: supplierDocumentDigits,
                nomeProdutoFornecedor: supplierProductName,
                codigoProduto: supplierProductCode,
                unidadeEntrada: supplierUnit,
                tipoCalculo: supplierCalcType,
                valorCalculo: supplierCalcValue,
            };

            suppliers.push(newEntry);
            product.fornecedores = suppliers;
            product.markModified('fornecedores');
            await product.save();

            return res.status(201).json({
                linked: true,
                created: true,
                fornecedor: mapSupplierEntriesToPlainObject([newEntry])[0],
                fornecedores: mapSupplierEntriesToPlainObject(product.fornecedores),
            });
        } catch (error) {
            console.error('Erro ao vincular fornecedor ao produto:', error);
            res.status(500).json({ message: 'Erro ao vincular fornecedor ao produto.' });
        }
    }
);

// POST /api/products/:id/destaque (restrito)
router.post('/:id/destaque', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const highestOrder = await Product.findOne({ isDestaque: true }).sort({ destaqueOrder: -1 });
        const newOrder = highestOrder ? highestOrder.destaqueOrder + 1 : 1;
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            { isDestaque: true, destaqueOrder: newOrder },
            { new: true }
        );
        if (!product) return res.status(404).json({ message: 'Produto não encontrado.' });
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao marcar produto como destaque.' });
    }
});

// DELETE /api/products/:id/destaque (restrito)
router.delete('/:id/destaque', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            { isDestaque: false, destaqueOrder: 0 },
            { new: true }
        );
        if (!product) return res.status(404).json({ message: 'Produto não encontrado.' });
        res.json({ message: 'Produto removido dos destaques.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao remover produto dos destaques.' });
    }
});

// POST /api/products/by-ids (restrito)
router.post('/by-ids', requireAuth, async (req, res) => {
    try {
        const { ids } = req.body;
        const products = await Product.find({ _id: { $in: ids } });
        res.json(products);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar produtos.' });
    }
});

// POST /api/products/:id/upload (restrito)
router.post('/:id/upload', requireAuth, authorizeRoles('admin', 'admin_master'), upload.array('imagens', 10), async (req, res) => {
    const tempFiles = Array.isArray(req.files) ? req.files : [];
    const storedFiles = [];
    const uploadedDriveFiles = [];

    const cleanupTempUploads = async () => {
        await Promise.allSettled(tempFiles.map(async (file) => {
            try {
                if (file?.path && fs.existsSync(file.path)) {
                    await fs.promises.unlink(file.path);
                }
            } catch (cleanupError) {
                console.warn('Falha ao remover arquivo temporário de upload:', cleanupError);
            }
        }));
    };

    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            await cleanupTempUploads();
            return res.status(404).send('Produto não encontrado');
        }

        if (!isDriveConfigured()) {
            await cleanupTempUploads();
            return res.status(500).json({ message: 'Armazenamento no Google Drive não está configurado.' });
        }

        if (!tempFiles.length) {
            return res.status(400).json({ message: 'Nenhuma imagem foi recebida para upload.' });
        }

        const barcodeSegment = sanitizeBarcodeSegment(product.codbarras || product.cod || product._id);
        let imageCounter = Array.isArray(product.imagens) ? product.imagens.length : 0;

        await ensureProductImageFolder(barcodeSegment);

        const newImagePaths = [];
        const uploadResults = [];

        for (const file of tempFiles) {
            imageCounter += 1;
            const newFilename = buildProductImageFileName({
                barcode: barcodeSegment,
                sequence: imageCounter,
                originalName: file.originalname,
            });

            const targetPath = buildProductImageStoragePath(barcodeSegment, newFilename);
            let fileBuffer = null;

            try {
                fileBuffer = await fs.promises.readFile(file.path);
            } catch (readError) {
                uploadResults.push({
                    status: 'error',
                    originalName: file?.originalname || '',
                    message: `Falha ao ler o arquivo temporário: ${readError.message}`,
                });
                try {
                    if (file.path && fs.existsSync(file.path)) {
                        await fs.promises.unlink(file.path);
                    }
                } catch (cleanupError) {
                    console.warn('Falha ao remover arquivo temporário após erro de leitura:', cleanupError);
                }
                continue;
            }

            try {
                await moveFile(file.path, targetPath);
            } catch (moveError) {
                uploadResults.push({
                    status: 'error',
                    originalName: file?.originalname || '',
                    message: `Falha ao mover o arquivo para armazenamento interno: ${moveError.message}`,
                });
                try {
                    if (file.path && fs.existsSync(file.path)) {
                        await fs.promises.unlink(file.path);
                    }
                } catch (cleanupError) {
                    console.warn('Falha ao remover arquivo temporário após erro de movimentação:', cleanupError);
                }
                continue;
            }

            let driveResult = null;
            let driveErrorMessage = '';
            try {
                const folderPath = getProductImagesDriveFolderPath(barcodeSegment);
                driveResult = await uploadBufferToDrive(fileBuffer, {
                    mimeType: file.mimetype || 'application/octet-stream',
                    name: newFilename,
                    folderPath,
                });
            } catch (driveError) {
                driveErrorMessage = driveError?.message || 'Erro desconhecido ao enviar para o Google Drive.';
                console.error('Falha ao enviar imagem de produto para o Google Drive:', driveError);
            }

            if (!driveResult) {
                uploadResults.push({
                    status: 'error',
                    originalName: file?.originalname || '',
                    message: driveErrorMessage || 'Não foi possível concluir o upload para o Google Drive.',
                });

                try {
                    if (fs.existsSync(targetPath)) {
                        await fs.promises.unlink(targetPath);
                    }
                } catch (cleanupError) {
                    console.warn('Falha ao remover arquivo local após erro no Drive:', cleanupError);
                }
                try {
                    if (file.path && fs.existsSync(file.path)) {
                        await fs.promises.unlink(file.path);
                    }
                } catch (cleanupError) {
                    console.warn('Falha ao remover arquivo temporário após erro no Drive:', cleanupError);
                }
                continue;
            }

            if (driveResult?.id) {
                uploadedDriveFiles.push(driveResult.id);
            }

            storedFiles.push(targetPath);
            const publicPath = buildProductImagePublicPath(barcodeSegment, newFilename);
            newImagePaths.push(publicPath);
            uploadResults.push({
                status: 'success',
                originalName: file?.originalname || '',
                storedFileName: newFilename,
                driveId: driveResult?.id || null,
                driveLinks: {
                    webViewLink: driveResult?.webViewLink || null,
                    webContentLink: driveResult?.webContentLink || null,
                },
                publicPath,
            });
        }

        if (!newImagePaths.length) {
            await cleanupTempUploads();
            return res.status(500).json({
                message: 'Não foi possível enviar as imagens selecionadas.',
                results: uploadResults,
            });
        }

        product.imagens = Array.isArray(product.imagens) ? product.imagens : [];
        product.imagens.push(...newImagePaths);
        if (!product.imagemPrincipal || product.imagemPrincipal.includes('placeholder')) {
            product.imagemPrincipal = newImagePaths[0];
        }

        await product.save();

        await cleanupTempUploads();

        const responseProduct = typeof product.toObject === 'function' ? product.toObject() : product;
        responseProduct._uploadedImages = newImagePaths;
        responseProduct._uploadResults = uploadResults;

        const hasErrors = uploadResults.some((result) => result.status === 'error');
        const statusCode = hasErrors ? 207 : 200;

        res.status(statusCode).json(responseProduct);
    } catch (error) {
        console.error("Erro no upload de imagens:", error);

        await cleanupTempUploads();

        for (const storedFile of storedFiles || []) {
            try {
                if (storedFile && fs.existsSync(storedFile)) {
                    await fs.promises.unlink(storedFile);
                }
            } catch (cleanupError) {
                console.warn('Falha ao remover imagem armazenada após erro:', cleanupError);
            }
        }
        if (uploadedDriveFiles.length) {
            await Promise.allSettled(uploadedDriveFiles.map((fileId) => deleteDriveFile(fileId)));
        }
        res.status(500).send('Erro no servidor');
    }
});

// DELETE /api/products/:productId/images (restrito)
router.patch(
    '/:productId/images/order',
    requireAuth,
    authorizeRoles('admin', 'admin_master'),
    async (req, res) => {
        try {
            const { productId } = req.params;
            const receivedOrder = Array.isArray(req.body?.imagens) ? req.body.imagens : null;

            if (!receivedOrder) {
                return res.status(400).json({ message: 'É necessário informar a nova ordem das imagens.' });
            }

            const product = await Product.findById(productId);
            if (!product) {
                return res.status(404).json({ message: 'Produto não encontrado.' });
            }

            const currentImages = Array.isArray(product.imagens)
                ? product.imagens.map((url) => (typeof url === 'string' ? url.trim() : '')).filter(Boolean)
                : [];

            if (currentImages.length === 0) {
                return res.status(400).json({ message: 'O produto não possui imagens para reordenar.' });
            }

            const sanitizedReceived = receivedOrder
                .map((url) => (typeof url === 'string' ? url.trim() : ''))
                .filter(Boolean);

            if (sanitizedReceived.length === 0) {
                return res.status(400).json({ message: 'A nova ordem não contém imagens válidas.' });
            }

            const validOrder = [];
            const seen = new Set();

            for (const url of sanitizedReceived) {
                if (seen.has(url)) continue;
                if (currentImages.includes(url)) {
                    validOrder.push(url);
                    seen.add(url);
                }
            }

            for (const url of currentImages) {
                if (!seen.has(url)) {
                    validOrder.push(url);
                    seen.add(url);
                }
            }

            if (validOrder.length === 0) {
                return res.status(400).json({ message: 'Não foi possível aplicar a nova ordem informada.' });
            }

            product.imagens = validOrder;
            if (validOrder.length > 0) {
                product.imagemPrincipal = validOrder[0];
            } else if (!product.imagemPrincipal || product.imagemPrincipal.includes('placeholder')) {
                product.imagemPrincipal = '/image/placeholder.png';
            }

            await product.save();

            res.json({
                message: 'Ordem das imagens atualizada com sucesso.',
                imagens: product.imagens,
                imagemPrincipal: product.imagemPrincipal,
            });
        } catch (error) {
            console.error('Erro ao atualizar a ordem das imagens:', error);
            res.status(500).json({ message: 'Erro ao atualizar a ordem das imagens do produto.' });
        }
    }
);

router.delete('/:productId/images', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const { productId } = req.params;
        const { imageUrl } = req.body;
        if (!imageUrl) return res.status(400).json({ message: 'O URL da imagem é obrigatório.' });
        
        const product = await Product.findById(productId);
        if (!product) return res.status(404).json({ message: 'Produto não encontrado.' });

        product.imagens.pull(imageUrl);
        try {
            const diskPath = resolveDiskPathFromPublicPath(imageUrl);
            if (diskPath && fs.existsSync(diskPath)) {
                await fs.promises.unlink(diskPath);
            }
        } catch (fileError) {
            console.warn('Falha ao remover arquivo de imagem ao apagar URL:', fileError);
        }
        if (isDriveConfigured()) {
            try {
                const parsed = parseProductImagePublicPath(imageUrl);
                if (parsed) {
                    const folderPath = getProductImagesDriveFolderPath(parsed.barcodeSegment);
                    const driveFile = await findDriveFileByPath({
                        folderPath,
                        fileName: parsed.fileName,
                    });
                    if (driveFile?.id) {
                        await deleteDriveFile(driveFile.id);
                    }
                }
            } catch (driveCleanupError) {
                console.warn('Falha ao remover imagem do Google Drive:', driveCleanupError);
            }
        }
        if (product.imagemPrincipal === imageUrl) {
            product.imagemPrincipal = product.imagens.length > 0 ? product.imagens[0] : '/image/placeholder.png';
        }
        await product.save();
        res.json({ message: 'Imagem apagada com sucesso.', product });
    } catch (error) {
        console.error("Erro ao apagar a imagem:", error);
        res.status(500).json({ message: 'Erro no servidor ao apagar a imagem.' });
    }
});

// DELETE /api/products/:productId/categories/:categoryId (restrito)
router.delete('/:productId/categories/:categoryId', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    const { productId, categoryId } = req.params;
    try {
        const product = await Product.findByIdAndUpdate(productId, { $pull: { categorias: categoryId } }, { new: true });
        if (!product) return res.status(404).json({ message: 'Produto não encontrado.' });
        res.json({ message: 'Categoria removida com sucesso.' });
    } catch (error) {
        console.error('Erro ao remover categoria do produto:', error);
        res.status(500).json({ message: 'Erro ao remover categoria do produto.' });
    }
});

// DELETE /api/products/:id (restrito)
router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const { id } = req.params;
        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).json({ message: 'Produto não encontrado.' });
        }

        const productId = product._id;
        const productIdString = productId.toString();
        const productIdCandidates = [productId, productIdString];

        const basePaths = [
            'completedSales.items',
            'completedSales.receiptSnapshot.itens',
            'completedSales.receiptSnapshot.items',
            'completedSales.fiscalItemsSnapshot',
            'completedSales.fiscalItemsSnapshot.itens',
            'completedSales.fiscalItemsSnapshot.items',
        ];

        const propertyVariants = [
            'productSnapshot._id',
            'productSnapshot.id',
            'productSnapshot.productId',
            'productSnapshot.product_id',
            'productSnapshot.produtoId',
            'productSnapshot.produto_id',
            'productId',
            'product_id',
            'produtoId',
            'produto_id',
            'id',
            'product',
            'produto',
        ];

        const salesLinkQuery = [{ 'inventoryMovements.items.product': productId }];

        for (const basePath of basePaths) {
            for (const variant of propertyVariants) {
                salesLinkQuery.push({ [`${basePath}.${variant}`]: { $in: productIdCandidates } });
            }
        }

        const hasSalesLinks = await PdvState.exists({ $or: salesLinkQuery });

        if (hasSalesLinks) {
            return res.status(409).json({ message: 'Não é possível excluir produtos que possuam vendas registradas.' });
        }

        const imagePaths = new Set();

        if (typeof product.imagemPrincipal === 'string' && product.imagemPrincipal && !product.imagemPrincipal.includes('placeholder')) {
            imagePaths.add(product.imagemPrincipal);
        }

        if (Array.isArray(product.imagens)) {
            product.imagens
                .filter((imagePath) => typeof imagePath === 'string' && imagePath && !imagePath.includes('placeholder'))
                .forEach((imagePath) => imagePaths.add(imagePath));
        }

        await product.deleteOne();

        for (const imagePath of imagePaths) {
            const absolutePath = resolveDiskPathFromPublicPath(imagePath);
            try {
                if (absolutePath && fs.existsSync(absolutePath)) {
                    await fs.promises.unlink(absolutePath);
                }
            } catch (fileError) {
                console.warn(`Não foi possível remover a imagem ${absolutePath || imagePath}:`, fileError);
            }
            if (isDriveConfigured()) {
                try {
                    const parsed = parseProductImagePublicPath(imagePath);
                    if (parsed) {
                        const folderPath = getProductImagesDriveFolderPath(parsed.barcodeSegment);
                        const driveFile = await findDriveFileByPath({
                            folderPath,
                            fileName: parsed.fileName,
                        });
                        if (driveFile?.id) {
                            await deleteDriveFile(driveFile.id);
                        }
                    }
                } catch (driveCleanupError) {
                    console.warn('Não foi possível remover arquivo do Google Drive:', driveCleanupError);
                }
            }
        }

        res.json({ message: 'Produto removido com sucesso.' });
    } catch (error) {
        console.error('Erro ao apagar produto:', error);
        res.status(500).json({ message: 'Erro ao apagar produto.' });
    }
});

module.exports = router;
