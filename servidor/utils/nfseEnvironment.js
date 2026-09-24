const environments = new Set(['homologacao', 'producao']);
const normalized = value => String(value || '').trim();

function failure(message) {
  return Object.assign(new Error(message), { status: 422, statusCode: 422, code: 'NFSE_ENVIRONMENT_CONFLICT' });
}

function getPdvNfseConfiguration(pdv, store) {
  const source = store?.nfse?.toObject ? store.nfse.toObject() : (store?.nfse || {});
  // A empresa habilita produção, mas o caixa de testes continua em homologação.
  const allowed = pdv?.ambientesHabilitados;
  const allowsProduction = !Array.isArray(allowed) || allowed.includes('producao');
  const environment = source.environment === 'producao' && pdv?.ambientePadrao === 'producao' && allowsProduction
    ? 'producao' : 'homologacao';
  return { ...source, environment };
}

function resolveSaleNfseEnvironment({ sale = {}, pdv, store, requestedEnvironment, documentEnvironments = [] }) {
  if (!environments.has(store?.nfse?.environment)) throw failure('Selecione o ambiente da NFS-e no cadastro da empresa.');
  const requested = normalized(requestedEnvironment);
  if (requested && !environments.has(requested)) throw failure('Ambiente solicitado da NFS-e inválido.');
  const previous = [...new Set(documentEnvironments.filter(value => environments.has(value)))];
  if (previous.length > 1) throw failure('A venda possui NFS-e em ambientes diferentes. Consulte os documentos existentes antes de emitir.');
  const snapshotValues = [sale.nfseEnvironment, sale.receiptSnapshot?.nfseEnvironment].map(normalized).filter(Boolean);
  if (snapshotValues.some(value => !environments.has(value)) || new Set(snapshotValues).size > 1) {
    throw failure('O ambiente de NFS-e registrado na venda é inválido ou divergente.');
  }
  const snapshot = snapshotValues[0];
  const effective = getPdvNfseConfiguration(pdv, store).environment;
  // Uma NFC-e de homologação comprova que a venda foi um teste. NFC-e antiga
  // de produção, por si só, não autoriza emissão retroativa automática de NFS-e.
  const homologationSale = sale.fiscalEnvironment === 'homologacao'
    || /<tpAmb>\s*2\s*<\/tpAmb>/.test(String(sale.fiscalXmlContent || ''));
  if (!previous.length && snapshot === 'producao' && homologationSale) {
    throw failure('A venda possui prova de homologação e ambiente NFS-e de produção divergente. Consulte o registro original antes de emitir.');
  }
  const environment = previous[0] || snapshot || (homologationSale ? 'homologacao' : effective);
  if (environment === 'producao') {
    if (effective !== 'producao') throw failure('Este PDV não está habilitado para emitir NFS-e em produção.');
    if (!previous.length && !snapshot) {
      const enabledAt = store?.nfse?.productionEnabledAt ? new Date(store.nfse.productionEnabledAt).getTime() : NaN;
      const createdAt = sale.createdAt ? new Date(sale.createdAt).getTime() : NaN;
      if (!Number.isFinite(enabledAt) || !Number.isFinite(createdAt) || createdAt < enabledAt) {
        throw failure('Venda anterior à ativação de produção ou sem ambiente NFS-e registrado. A emissão produtiva foi bloqueada para preservar o histórico; consulte os documentos originais.');
      }
    }
  }
  if (requested && requested !== environment) {
    throw failure(`O ambiente desta venda é ${environment}; não é permitido alterá-lo ao emitir NFS-e.`);
  }
  return environment;
}

module.exports = { getPdvNfseConfiguration, resolveSaleNfseEnvironment };
