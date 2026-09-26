const https = require('https');
const zlib = require('zlib');

// Endereços publicados no portal oficial, consultados em 23/09/2026.
const ENDPOINTS = Object.freeze({
  homologacao: 'https://sefin.producaorestrita.nfse.gov.br/SefinNacional',
  producao: 'https://sefin.nfse.gov.br/SefinNacional',
});
const MAX_RESPONSE = 12 * 1024 * 1024;
const compressXml = (xml) => zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64');
function decompressXml(value) {
  if (typeof value !== 'string' || !value.length) throw new Error('Emissor Nacional não retornou o XML compactado.');
  return zlib.gunzipSync(Buffer.from(value, 'base64'), { maxOutputLength: MAX_RESPONSE }).toString('utf8');
}

class NfseApiError extends Error {
  constructor(message, { statusCode = 0, codes = [], uncertain = false } = {}) {
    super(message); this.name = 'NfseApiError'; this.statusCode = statusCode; this.codes = codes; this.uncertain = uncertain;
  }
}

function apiError(statusCode, payload) {
  const errors = payload?.erros || payload?.Erros || payload?.erro || payload?.Erro || payload?.errors || [];
  const list = Array.isArray(errors) ? errors : [errors];
  const codes = list.map((e) => String(e?.Codigo || e?.codigo || e?.code || '')).filter(Boolean);
  const details = list.map((e) => [e?.Codigo || e?.codigo || e?.code, e?.Descricao || e?.descricao || e?.message, e?.Complemento || e?.complemento].filter(Boolean).join(' — ')).filter(Boolean);
  const error = new NfseApiError(details.join('; ').slice(0, 2500) || `Emissor Nacional retornou HTTP ${statusCode}.`, { statusCode, codes, uncertain: statusCode >= 500 || statusCode === 408 || statusCode === 429 });
  // A consulta de eventos em produção restrita retorna 404 só com metadados,
  // sem o campo erro documentado no Swagger (verificado via GET em 23/09/2026).
  error.responseEnvironment = Number(payload?.tipoAmbiente);
  error.responseApplication = String(payload?.versaoAplicativo || '');
  error.responseProcessedAt = String(payload?.dataHoraProcessamento || '');
  return error;
}

function request({ environment, path, method = 'GET', body, pair, requestImpl = https.request, timeoutMs = 45000 }) {
  if (!ENDPOINTS[environment]) return Promise.reject(new Error('Ambiente NFS-e inválido.'));
  if (!/^\/[a-zA-Z0-9_/?=&.-]*$/.test(path)) return Promise.reject(new Error('Caminho NFS-e inválido.'));
  const bytes = body ? Buffer.from(JSON.stringify(body), 'utf8') : null;
  return new Promise((resolve, reject) => {
    let deadline;
    const succeed = (value) => { clearTimeout(deadline); resolve(value); };
    const fail = (error) => { clearTimeout(deadline); reject(error); };
    const req = requestImpl(new URL(ENDPOINTS[environment] + path), {
      method, cert: (pair.certificateChain || [pair.certificatePem]).join('\n'), key: pair.privateKeyPem,
      minVersion: 'TLSv1.2', rejectUnauthorized: true,
      headers: { Accept: 'application/json', ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length } : {}) },
    }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (chunk) => { size += chunk.length; if (size > MAX_RESPONSE) req.destroy(new Error('Resposta do emissor excedeu o limite.')); else chunks.push(chunk); });
      res.on('end', () => {
        let payload = {};
        try { const raw = Buffer.concat(chunks).toString('utf8'); if (raw) payload = JSON.parse(raw); } catch { return fail(new NfseApiError(`Resposta inválida do Emissor Nacional (HTTP ${res.statusCode}).`, { statusCode: res.statusCode, uncertain: true })); }
        if (res.statusCode < 200 || res.statusCode > 299) return fail(apiError(res.statusCode, payload));
        if (payload.erros?.length || payload.erro || payload.Erro) return fail(apiError(400, payload));
        succeed(payload);
      });
      res.on('error', () => fail(new NfseApiError('Conexão interrompida. Consulte a DPS antes de retransmitir.', { uncertain: true })));
    });
    deadline = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs);
    deadline.unref?.();
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', () => fail(new NfseApiError('Não foi possível concluir a comunicação com o Emissor Nacional. Consulte a DPS antes de retransmitir.', { uncertain: true })));
    req.end(bytes);
  });
}

function createTransport(pair, options = {}) {
  const call = (environment, path, method, body) => request({ environment, path, method, body, pair, ...options });
  return {
    // Consulta somente leitura com a identidade que será usada na emissão.
    // Não usar Date.now(): o relógio do host pode estar adiantado (E0008).
    emissionTime: async (environment, dpsId) => {
      try {
        await call(environment, `/dps/${dpsId}`, 'GET');
        throw new Error('A DPS reservada já existe no Emissor Nacional. Consulte a numeração antes de emitir.');
      } catch (error) {
        const value = error.responseProcessedAt;
        const validTime = typeof value === 'string'
          && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
          && Number.isFinite(Date.parse(value));
        if (error.statusCode === 404 && error.codes?.includes('E2404')
            && error.responseEnvironment === (environment === 'producao' ? 1 : 2)
            && /^SefinNacional_/.test(error.responseApplication) && validTime) {
          return new Date(value);
        }
        // Sem uma resposta fiscal válida, não assinar com uma hora presumida.
        if (error.codes?.includes('E2404')) throw new Error('Não foi possível validar a hora do Emissor Nacional. Nenhuma DPS foi transmitida; tente novamente após normalizar a consulta.');
        throw error;
      }
    },
    emit: (environment, xml) => call(environment, '/nfse', 'POST', { dpsXmlGZipB64: compressXml(xml) }),
    queryDps: (environment, dpsId) => call(environment, `/dps/${dpsId}`, 'GET'),
    queryNfse: (environment, accessKey) => call(environment, `/nfse/${accessKey}`, 'GET'),
    cancel: (environment, accessKey, xml) => call(environment, `/nfse/${accessKey}/eventos`, 'POST', { pedidoRegistroEventoXmlGZipB64: compressXml(xml) }),
    // Swagger nacional expõe consulta com tipo e sequência obrigatórios.
    // Estes quatro eventos cancelam a nota; consulta paralela é somente leitura.
    events: async (environment, accessKey) => ({ eventos: await Promise.all([101101, 105102, 105104, 305101].map(async (type) => {
      try { return await call(environment, `/nfse/${accessKey}/eventos/${type}/1`, 'GET'); }
      catch (error) {
        const officialNotFound = error.statusCode === 404
          && error.codes.length === 0
          && error.responseEnvironment === (environment === 'producao' ? 1 : 2)
          && /^SefinNacional_/.test(error.responseApplication)
          && Number.isFinite(Date.parse(error.responseProcessedAt));
        if (officialNotFound) return null;
        throw error;
      }
    })) }),
  };
}
module.exports = { ENDPOINTS, NfseApiError, compressXml, decompressXml, request, createTransport };
