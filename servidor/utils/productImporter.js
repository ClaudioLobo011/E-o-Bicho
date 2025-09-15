const xlsx = require('xlsx');
const Product = require('../models/Product');
const fs = require('fs');
const path = require('path');

// ▼▼▼ CORREÇÃO 1: Expressão regular corrigida para remover TODOS os acentos ▼▼▼
const normalizeText = (text) => {
    if (!text) return '';
    return text
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""); // Esta é a regex correta
};

const importProducts = async (socket) => {
    try {
        socket.emit('import-log', 'Iniciando processo de importação...');
        
        const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'products');
        const allImageFiles = fs.readdirSync(uploadsDir);
        socket.emit('import-log', `Encontradas ${allImageFiles.length} imagens na pasta de uploads.`);

        const workbook = xlsx.readFile(path.join(__dirname, '..', 'data', 'produtos.xlsx'));
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const productsFromExcel = xlsx.utils.sheet_to_json(sheet);
        
        socket.emit('import-log', `Encontrados ${productsFromExcel.length} produtos na planilha.`);

        let updatedCount = 0;
        let createdCount = 0;
        let productsWithImagesCount = 0;

        for (const product of productsFromExcel) {
            if (!product.cod) {
                socket.emit('import-log', `AVISO: Produto sem 'cod' (SKU) foi ignorado: ${product.nome}`);
                continue;
            }

            const filter = { cod: product.cod };
            
            const productBarcode = product.codbarras ? product.codbarras.toString() : '';
            const matchingImages = allImageFiles.filter(file => file.startsWith(productBarcode));
            const imagePathsForDB = matchingImages.map(file => `/uploads/products/${file}`);
            
            const updateData = {
                nome: product.nome,
                codbarras: product.codbarras,
                descricao: product.descricao,
                custo: product.custo,
                venda: product.venda,
                stock: product.stock,
                marca: product.marca,
                // ▼▼▼ CORREÇÃO 2: Adicionado 'product.codbarras' à string de busca ▼▼▼
                searchableString: normalizeText(`${product.nome} ${product.cod} ${product.marca} ${product.codbarras}`),
                imagens: imagePathsForDB,
                imagemPrincipal: imagePathsForDB.length > 0 ? imagePathsForDB[0] : '/image/placeholder.png'
            };
            
            if(imagePathsForDB.length > 0) {
                productsWithImagesCount++;
            }

            const result = await Product.findOneAndUpdate(
                filter,
                { $set: updateData },
                { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
            );

            if (result.createdAt.getTime() === result.updatedAt.getTime()) {
                createdCount++;
            } else {
                updatedCount++;
            }
        }
        
        socket.emit('import-log', '---------------------------------------------');
        socket.emit('import-log', 'PROCESSO CONCLUÍDO!');
        socket.emit('import-log', `- Produtos Novos Criados: ${createdCount}`);
        socket.emit('import-log', `- Produtos Existentes Atualizados: ${updatedCount}`);
        socket.emit('import-log', `- Produtos com imagens associadas: ${productsWithImagesCount}`);
        socket.emit('import-log', '---------------------------------------------');
        socket.emit('import-finished');

    } catch (error) {
        console.error('ERRO NO IMPORTADOR:', error);
        socket.emit('import-log', `ERRO: ${error.message}`);
        socket.emit('import-error');
    }
};

module.exports = { importProducts };