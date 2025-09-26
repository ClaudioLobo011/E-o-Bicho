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

const COLUMN_KEYS = {
    code: ['Código', 'Codigo', 'codigo', 'CÓDIGO', 'code'],
    barcode: ['Código de Barras', 'Codigo de Barras', 'código de barras', 'codBarras', 'codbarras'],
    name: ['Descrição', 'Descricao', 'descricao', 'DESCRIÇÃO', 'nome', 'Nome'],
    cost: ['Custo', 'custo', 'Preço de Custo'],
    price: ['Venda', 'venda', 'Preço de Venda'],
    stock: ['Estoque', 'estoque', 'Qtd'],
    inactive: ['Inativo (Sim, Não)', 'Inativo', 'inativo']
};

const sanitizeString = (value) => {
    if (value === undefined || value === null) {
        return '';
    }
    return value.toString().trim();
};

const parseNumber = (value, defaultValue = 0) => {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : defaultValue;
    }

    const cleaned = value
        .toString()
        .replace(/\s+/g, '')
        .replace(/\./g, '')
        .replace(',', '.');

    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : defaultValue;
};

const parseBoolean = (value) => {
    if (typeof value === 'boolean') {
        return value;
    }

    if (value === undefined || value === null) {
        return false;
    }

    const normalized = value.toString().trim().toLowerCase();
    return ['sim', 's', '1', 'true'].includes(normalized);
};

const findValueInRow = (row, keys) => {
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(row, key)) {
            return row[key];
        }
    }
    return undefined;
};

const parseProductsFromBuffer = (buffer) => {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];

    if (!sheetName) {
        throw new Error('O arquivo não possui planilhas válidas.');
    }

    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
        throw new Error('Não foi possível ler a primeira planilha do arquivo.');
    }

    const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

    const products = [];
    const warnings = [];

    rows.forEach((row, index) => {
        const rowNumber = index + 2; // considerando cabeçalho na linha 1

        const rawCode = sanitizeString(findValueInRow(row, COLUMN_KEYS.code));
        const rawBarcode = sanitizeString(findValueInRow(row, COLUMN_KEYS.barcode));
        const rawName = sanitizeString(findValueInRow(row, COLUMN_KEYS.name));
        const rawCost = findValueInRow(row, COLUMN_KEYS.cost);
        const rawPrice = findValueInRow(row, COLUMN_KEYS.price);
        const rawStock = findValueInRow(row, COLUMN_KEYS.stock);
        const rawInactive = findValueInRow(row, COLUMN_KEYS.inactive);

        if (!rawCode) {
            warnings.push(`Linha ${rowNumber}: Código obrigatório não informado. Registro ignorado.`);
            return;
        }

        if (!rawBarcode) {
            warnings.push(`Linha ${rowNumber}: Código de Barras obrigatório não informado. Registro ignorado.`);
            return;
        }

        if (!rawName) {
            warnings.push(`Linha ${rowNumber}: Descrição obrigatória não informada. Registro ignorado.`);
            return;
        }

        products.push({
            cod: rawCode,
            codbarras: rawBarcode,
            nome: rawName,
            descricao: rawName,
            custo: parseNumber(rawCost, 0),
            venda: parseNumber(rawPrice, 0),
            stock: parseNumber(rawStock, 0),
            inativo: parseBoolean(rawInactive)
        });
    });

    return { products, warnings };
};

const importProducts = async (socket, productsFromExcel) => {
    try {
        socket.emit('import-log', 'Iniciando processo de importação...');

        const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'products');
        const allImageFiles = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
        socket.emit('import-log', `Encontradas ${allImageFiles.length} imagens na pasta de uploads.`);

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
                marca: product.marca || '',
                inativo: Boolean(product.inativo),
                searchableString: normalizeText(`${product.nome} ${product.cod} ${product.marca || ''} ${product.codbarras}`),
                imagens: imagePathsForDB,
                imagemPrincipal: imagePathsForDB.length > 0 ? imagePathsForDB[0] : '/image/placeholder.png'
            };

            if (imagePathsForDB.length > 0) {
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

module.exports = { importProducts, parseProductsFromBuffer };