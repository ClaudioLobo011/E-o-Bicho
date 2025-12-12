/**
 * Cria um dump simples (JSON) de todas as coleções do MongoDB em
 * servidor/BancoLocalViewer. Cada coleção vira um arquivo <colecao>.json.
 *
 * Como executar no CMD (na raiz do projeto):
 *   node servidor/scripts/backupLocalViewer.js
 *
 * Requisitos: variáveis de ambiente MONGODB_URI (ou MONGO_URI ou DATABASE_URL)
 * e, se necessário, DB_NAME.
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || '';
const DB_NAME = process.env.DB_NAME || undefined;

if (!MONGO_URI) {
  console.error('[backupLocalViewer] Defina MONGODB_URI (ou MONGO_URI/DATABASE_URL) no .env');
  process.exit(1);
}

const TARGET_DIR = path.join(__dirname, '..', 'BancoLocalViewer');

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

async function dumpCollections() {
  await ensureDir(TARGET_DIR);

  await mongoose.connect(MONGO_URI, DB_NAME ? { dbName: DB_NAME } : {});
  const db = mongoose.connection.db;

  const collections = await db.listCollections().toArray();
  console.log(`[backupLocalViewer] Encontradas ${collections.length} coleções.`);

  for (const col of collections) {
    const name = col.name;
    try {
      const docs = await db.collection(name).find({}).toArray();
      const outPath = path.join(TARGET_DIR, `${name}.json`);
      await fs.promises.writeFile(outPath, JSON.stringify(docs, null, 2), 'utf8');
      console.log(`[backupLocalViewer] Coleção "${name}" salva (${docs.length} docs).`);
    } catch (err) {
      console.error(`[backupLocalViewer] Falha ao exportar "${name}":`, err.message);
    }
  }

  await mongoose.disconnect();
  console.log(`[backupLocalViewer] Finalizado. Arquivos em: ${TARGET_DIR}`);
}

dumpCollections().catch((err) => {
  console.error('[backupLocalViewer] Erro inesperado:', err);
  process.exit(1);
});
