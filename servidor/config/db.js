const mongoose = require('mongoose');

// Criamos uma função assíncrona para conectar à base de dados
const connectDB = async () => {
  try {
    // Tenta conectar usando a URI do nosso ficheiro .env
    await mongoose.connect(process.env.MONGO_URI);

    console.log('MongoDB Conectado com sucesso via db.js!');
  } catch (err) {
    console.error('Erro ao conectar ao MongoDB:', err.message);
    
    // Se a conexão falhar, encerra a aplicação, pois ela não pode funcionar sem a base de dados.
    process.exit(1);
  }
};

// Exporta a função para que outros ficheiros a possam usar
module.exports = connectDB;