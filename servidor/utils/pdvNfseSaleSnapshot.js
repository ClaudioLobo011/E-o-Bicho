const environments = new Set(['homologacao', 'producao']);

function getNfseEnvironmentSnapshot(sale) {
  if (environments.has(sale?.nfseEnvironment)) return sale.nfseEnvironment;
  const snapshot = sale?.receiptSnapshot?.nfseEnvironment;
  return environments.has(snapshot) ? snapshot : undefined;
}

function preserveNfseEnvironmentSnapshot(sale, original = sale) {
  const nfseEnvironment = getNfseEnvironmentSnapshot(original);
  const result = { ...sale, nfseEnvironment };
  if (sale?.receiptSnapshot && typeof sale.receiptSnapshot === 'object' && !Array.isArray(sale.receiptSnapshot)) {
    result.receiptSnapshot = { ...sale.receiptSnapshot };
    if (nfseEnvironment) result.receiptSnapshot.nfseEnvironment = nfseEnvironment;
    else delete result.receiptSnapshot.nfseEnvironment;
  }
  return result;
}

module.exports = { getNfseEnvironmentSnapshot, preserveNfseEnvironmentSnapshot };
