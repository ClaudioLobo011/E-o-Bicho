const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');

// ROTA: GET /api/categories (pública)
// DESCRIÇÃO: Busca todas as categorias
router.get('/', async (req, res) => {
    try {
        const categories = await Category.find({}).sort({ nome: 1 });
        res.json(categories);
    } catch (error) {
        console.error('Erro ao buscar categorias:', error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// ROTA: POST /api/categories (restrita a admin/admin_master)
// DESCRIÇÃO: Cria uma nova categoria
router.post('/', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    const { nome, parent } = req.body;

    if (!nome) {
        return res.status(400).json({ message: 'O nome da categoria é obrigatório.' });
    }

    try {
        const newCategory = new Category({
            nome,
            parent: parent || null
        });

        const savedCategory = await newCategory.save();
        res.status(201).json(savedCategory);

    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Já existe uma categoria com este nome dentro da mesma categoria pai.' });
        }
        console.error("Erro ao criar categoria:", error);
        res.status(500).json({ message: 'Erro no servidor ao criar a categoria.' });
    }
});

// ROTA: GET /api/categories/hierarchical (pública)
router.get('/hierarchical', async (req, res) => {
    try {
        const allCategories = await Category.find({});
        const buildHierarchy = (categories, parentId = null) => {
            const result = [];
            const children = categories.filter(cat => String(cat.parent) === String(parentId));
            for (const child of children) {
                const grandchildren = buildHierarchy(categories, child._id);
                result.push({
                    _id: child._id,
                    nome: child.nome,
                    children: grandchildren
                });
            }
            return result;
        };
        res.json(buildHierarchy(allCategories));
    } catch (error) {
        console.error("Erro ao buscar categorias hierárquicas:", error);
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

// ROTA: GET /api/categories/subcategories (pública)
router.get('/subcategories', async (req, res) => {
    try {
        const { name: parentName, parent: grandParentName, grandparent: greatGrandParentName } = req.query;
        let parentQuery = { nome: new RegExp('^' + parentName + '$', 'i') };

        if (grandParentName) {
            const grandParent = await Category.findOne({ nome: new RegExp('^' + grandParentName + '$', 'i') });
            if (grandParent) {
                parentQuery.parent = grandParent._id;
                if (greatGrandParentName) {
                    const greatGrandParent = await Category.findOne({ nome: new RegExp('^' + greatGrandParentName + '$', 'i') });
                    if (greatGrandParent) {
                        const confirmedGrandParent = await Category.findOne({ nome: new RegExp('^' + grandParentName + '$', 'i'), parent: greatGrandParent._id });
                        if (confirmedGrandParent) {
                            parentQuery.parent = confirmedGrandParent._id;
                        }
                    }
                }
            }
        }

        const parentCategory = await Category.findOne(parentQuery);
        if (!parentCategory) return res.json([]);

        const subCategories = await Category.find({ parent: parentCategory._id }).sort({ nome: 1 });
        res.json(subCategories);
    } catch (error) {
        console.error('Erro ao buscar sub-categorias:', error);
        res.status(500).json({ message: 'Erro no servidor' });
    }
});

// ROTA: GET /api/categories/path (pública)
router.get('/path', async (req, res) => {
    try {
        const { name, parent: parentName, grandparent: grandParentName } = req.query;
        if (!name) return res.status(400).json({ message: 'O nome da categoria é obrigatório.' });

        let query = { nome: new RegExp('^' + name + '$', 'i') };

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
        } else {
            query.parent = null;
        }

        let currentCategory = await Category.findOne(query);
        if (!currentCategory && !parentName) {
            currentCategory = await Category.findOne({ nome: new RegExp('^' + name + '$', 'i'), parent: null });
        }
        if (!currentCategory) return res.json([]);

        const path = [];
        while (currentCategory) {
            path.unshift(currentCategory);
            currentCategory = currentCategory.parent ? await Category.findById(currentCategory.parent) : null;
        }
        res.json(path);
    } catch (error) {
        console.error('Erro ao buscar caminho da categoria:', error);
        res.status(500).json({ message: 'Erro no servidor' });
    }
});

// ROTA: PUT /api/categories/:id (restrita a admin/admin_master)
router.put('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const { nome, parent } = req.body;
        const categoryId = req.params.id;

        if (!nome) {
            return res.status(400).json({ message: 'O nome da categoria é obrigatório.' });
        }

        const updatedCategory = await Category.findByIdAndUpdate(
            categoryId,
            { nome, parent: parent || null },
            { new: true, runValidators: true }
        );

        if (!updatedCategory) {
            return res.status(404).json({ message: 'Categoria não encontrada.' });
        }

        res.json(updatedCategory);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Já existe uma categoria com este nome dentro da mesma categoria pai.' });
        }
        console.error('Erro ao atualizar categoria:', error);
        res.status(500).json({ message: 'Erro no servidor ao atualizar a categoria.' });
    }
});

// ROTA: DELETE /api/categories/:id (restrita a admin/admin_master)
router.delete('/:id', requireAuth, authorizeRoles('admin', 'admin_master'), async (req, res) => {
    try {
        const categoryId = req.params.id;

        const childCategory = await Category.findOne({ parent: categoryId });
        if (childCategory) {
            return res.status(400).json({ message: 'Não é possível apagar esta categoria, pois ela contém sub-categorias.' });
        }

        const deletedCategory = await Category.findByIdAndDelete(categoryId);
        if (!deletedCategory) {
            return res.status(404).json({ message: 'Categoria não encontrada.' });
        }

        res.json({ message: 'Categoria apagada com sucesso.' });
    } catch (error) {
        console.error('Erro ao apagar categoria:', error);
        res.status(500).json({ message: 'Erro no servidor ao apagar a categoria.' });
    }
});

module.exports = router;
