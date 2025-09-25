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

// Configuração do Multer para upload de imagens
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/products/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `temp-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});
const upload = multer({ storage: storage });

// ========================================================================
// ========= ROTAS ESPECÍFICAS (Devem vir primeiro) =======================
// ========================================================================

// Função auxiliar recursiva para encontrar todos os IDs de sub-categorias
async function findAllSubCategoryIds(categoryId) {
    let ids = [categoryId];
    const children = await Category.find({ parent: categoryId });
    for (const child of children) {
        ids = ids.concat(await findAllSubCategoryIds(child._id));
    }
    return ids;
}

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
        const products = await Product.find({ categorias: { $in: allCategoryIds } })
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
        const { page = 1, limit = 20, search = '' } = req.query;
        const query = {};

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
        const destaques = await Product.find({ isDestaque: true }).sort({ destaqueOrder: 1 });
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

        const product = await Product.findOne({ codbarras: baseBarcode }).populate('categorias').lean();
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

// ========================================================================
// ========= FUNÇÃO AUXILIAR PARA BREADCRUMB ===============================
// ========================================================================
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
                    return {
                        fornecedor,
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
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            req.files.forEach(file => fs.unlinkSync(file.path));
            return res.status(404).send('Produto não encontrado');
        }

        const newImagePaths = [];
        let imageCounter = product.imagens.length;

        for (const file of req.files) {
            imageCounter++;
            const fileExtension = path.extname(file.originalname);
            const newFilename = `${product.codbarras}-${imageCounter}${fileExtension}`;
            const oldPath = file.path;
            const newPath = path.join('public', 'uploads', 'products', newFilename);

            fs.renameSync(oldPath, newPath);
            newImagePaths.push(`/uploads/products/${newFilename}`);
        }

        product.imagens.push(...newImagePaths);
        if (!product.imagemPrincipal || product.imagemPrincipal.includes('placeholder')) {
            product.imagemPrincipal = newImagePaths[0];
        }

        await product.save();
        res.send(product);
    } catch (error) {
        console.error("Erro no upload de imagens:", error);
        req.files.forEach(file => fs.unlinkSync(file.path));
        res.status(500).send('Erro no servidor');
    }
});

// DELETE /api/products/:productId/images (restrito)
router.delete('/:productId/images', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const { productId } = req.params;
        const { imageUrl } = req.body;
        if (!imageUrl) return res.status(400).json({ message: 'O URL da imagem é obrigatório.' });
        
        const product = await Product.findById(productId);
        if (!product) return res.status(404).json({ message: 'Produto não encontrado.' });
        
        product.imagens.pull(imageUrl);
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

module.exports = router;
