#!/usr/bin/env node

require('dotenv').config();

const {
  consultNfceStatusServico,
  SefazTransmissionError,
} = require('../services/sefazTransmitter');
const { loadPfxBuffer, extractCertificatePair } = require('./utils/certificates');

const ensureEnv = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) {
    throw new Error(`Variável de ambiente obrigatória não definida: ${key}`);
  }
  return String(value).trim();
};

const main = async () => {
  try {
    const pfxPath = ensureEnv('CERT_PFX_PATH');
    const pfxPassword = ensureEnv('CERT_PFX_PASSWORD');
    const uf = process.env.NFCE_UF || process.env.NFCE_ESTADO || 'MS';
    const ambiente = process.env.NFCE_AMBIENTE || 'homologacao';

    const pfxBuffer = loadPfxBuffer(pfxPath);
    const { privateKeyPem, certificatePem, certificateChain } = extractCertificatePair(
      pfxBuffer,
      pfxPassword
    );

    const { responseXml, endpoint } = await consultNfceStatusServico({
      uf,
      environment: ambiente,
      certificate: certificatePem,
      certificateChain,
      privateKey: privateKeyPem,
    });

    console.log('Endpoint utilizado:', endpoint);
    console.log('Resposta completa da SEFAZ (StatusServico4):');
    console.log(responseXml);
  } catch (error) {
    if (error instanceof SefazTransmissionError) {
      console.error('Falha ao consultar status da SEFAZ:', error.message);
      if (error.details) {
        console.error('Detalhes:', JSON.stringify(error.details, null, 2));
      }
    } else {
      console.error('Erro ao executar teste de status da NFC-e:', error.message || error);
    }
    process.exitCode = 1;
  }
};

main();
