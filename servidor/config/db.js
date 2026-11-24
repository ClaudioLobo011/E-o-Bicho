const mongoose = require('mongoose');
const { DEFAULT_COMPANY, getCompany } = require('../../scripts/core/config');

mongoose.set('transactionAsyncLocalStorage', true);

// Criamos uma função assíncrona para conectar à base de dados
const connectDB = async () => {
  try {
    const company = getCompany(process.env.SITE_EMPRESA || DEFAULT_COMPANY);
    const uri = process.env.MONGO_URI;
    if (company.id !== DEFAULT_COMPANY) {
      const probe = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 1 });
      try {
        if (probe.db().databaseName !== company.database) {
          throw new Error('MONGO_URI deve indicar o banco ' + company.database);
        }
        const state = await probe.db('admin').command({ connectionStatus: 1 });
        const roles = state.authInfo.authenticatedUserRoles;
        if (roles.length !== 1 || roles[0].role !== 'readWrite' || roles[0].db !== company.database) {
          throw new Error('Use uma credencial MongoDB restrita ao banco ' + company.database);
        }
      } finally {
        await probe.close();
      }
    }
    // Tenta conectar usando a URI do nosso ficheiro .env
    await mongoose.connect(uri, {
      // O driver compacta o tráfego entre a API e o MongoDB. Isso reduz o
      // volume transferido sem alterar o formato dos documentos.
      compressors: ['zlib'],
      zlibCompressionLevel: 6,
    });

    console.log('MongoDB Conectado com sucesso via db.js!');
  } catch (err) {
    console.error('Erro ao conectar ao MongoDB:', err.message);
    
    // Se a conexão falhar, encerra a aplicação, pois ela não pode funcionar sem a base de dados.
    process.exit(1);
  }
};

// Exporta a função para que outros ficheiros a possam usar
module.exports = connectDB;
