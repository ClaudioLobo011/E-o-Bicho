const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

const categories = require('./data/categories');
const Category = require('./models/Category');

dotenv.config();

const importData = async () => {
    await connectDB();
    try {
        await Category.deleteMany();
        console.log('Categorias antigas removidas...');

        // Função recursiva para inserir as categorias
        const createCategories = async (categoriesArray, parentId = null) => {
            for (let category of categoriesArray) {
                const newCategory = await Category.create({
                    nome: category.name,
                    parent: parentId
                });

                if (category.children && category.children.length > 0) {
                    // Se a categoria tem filhos, chama a função novamente para eles,
                    // passando o ID da categoria que acabámos de criar como o novo 'parentId'.
                    await createCategories(category.children, newCategory._id);
                }
            }
        }

        await createCategories(categories);

        console.log('\x1b[32m%s\x1b[0m', 'Categorias hierárquicas importadas com SUCESSO!');
        process.exit();
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `ERRO: ${error}`);
        process.exit(1);
    }
}

const destroyData = async () => {
    await connectDB();
    try {
        await Category.deleteMany();
        console.log('\x1b[33m%s\x1b[0m', 'Todas as categorias foram destruídas com SUCESSO!');
        process.exit();
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `ERRO: ${error}`);
        process.exit(1);
    }
}

if (process.argv[2] === '-d') {
    destroyData();
} else {
    importData();
}