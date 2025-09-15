const mongoose = require('mongoose');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const xlsx = require('xlsx');
const Product = require('./models/Product');

dotenv.config();

// Função auxiliar para remover acentos
const normalizeText = (text) => {
    if (!text) return '';
    return text
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
};

const importData = async () => {
    await connectDB();
    try {
        const workbook = xlsx.readFile(__dirname + '/data/produtos.xlsx');
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const productsFromExcel = xlsx.utils.sheet_to_json(sheet);
        
        console.log(`Encontrados ${productsFromExcel.length} produtos no ficheiro Excel. Iniciando processo de atualização...`);

        let updatedCount = 0;
        let createdCount = 0;

        // ========================================================================
        // ========= LÓGICA DE ATUALIZAÇÃO (UPSERT) =============================
        // ========================================================================
        
        // Em vez de apagar tudo, passamos por cada produto da planilha
        for (const product of productsFromExcel) {
            if (!product.cod) {
                console.warn(`Produto sem 'cod' (SKU) na planilha foi ignorado: ${product.nome}`);
                continue;
            }

            const filter = { cod: product.cod }; // A chave para encontrar o produto é o 'cod'

            // Estes são os campos que vamos atualizar a partir da planilha
            const updateData = {
                nome: product.nome,
                codbarras: product.codbarras,
                descricao: product.descricao,
                custo: product.custo,
                venda: product.venda,
                stock: product.stock,
                marca: product.marca,
                searchableString: normalizeText(`${product.nome} ${product.cod} ${product.marca} ${product.codbarras}`)
            };

            // A mágica acontece aqui: findOneAndUpdate com a opção 'upsert'
            const result = await Product.findOneAndUpdate(
                filter,         // Encontra o produto por este 'cod'
                { $set: updateData }, // Atualiza com estes dados
                {
                    new: true,      // Retorna o documento atualizado
                    upsert: true,   // << IMPORTANTE: Se não encontrar, cria um novo
                    runValidators: true,
                    setDefaultsOnInsert: true
                }
            );

            // Contabiliza se o produto foi criado ou atualizado
            if (result.createdAt.getTime() === result.updatedAt.getTime()) {
                createdCount++;
            } else {
                updatedCount++;
            }
        }
        
        console.log('\n=============================================');
        console.log('\x1b[32m%s\x1b[0m', 'Processo de importação concluído!');
        console.log(`- Produtos Novos Criados: ${createdCount}`);
        console.log(`- Produtos Existentes Atualizados: ${updatedCount}`);
        console.log('=============================================');

        process.exit();
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `ERRO: ${error}`);
        process.exit(1);
    }
}

const destroyData = async () => {
    // A função de destruir continua igual, caso você precise dela
    try {
        await connectDB();
        await Product.deleteMany();
        console.log('\x1b[33m%s\x1b[0m', 'Dados destruídos com SUCESSO!');
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