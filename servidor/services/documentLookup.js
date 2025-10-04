const { cpf, cnpj } = require('cpf-cnpj-validator');

const LOOKUP_TIMEOUT = Number.parseInt(process.env.DOCUMENT_LOOKUP_TIMEOUT_MS, 10) || 8000;
const CPF_LOOKUP_URL_TEMPLATE = process.env.CPF_LOOKUP_URL_TEMPLATE || '';
const CPF_LOOKUP_METHOD = process.env.CPF_LOOKUP_HTTP_METHOD || 'GET';
const CPF_LOOKUP_TOKEN = process.env.CPF_LOOKUP_TOKEN || '';
const CPF_LOOKUP_TOKEN_HEADER = process.env.CPF_LOOKUP_TOKEN_HEADER || 'Authorization';
const CPF_LOOKUP_TOKEN_TEMPLATE = process.env.CPF_LOOKUP_TOKEN_TEMPLATE || 'Bearer {token}';

class DocumentLookupError extends Error {
  constructor(message, { statusCode = 500, code = 'DOCUMENT_LOOKUP_ERROR', details = null } = {}) {
    super(message);
    this.name = 'DocumentLookupError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');

const formatDocument = (document, type) => {
  if (type === 'cnpj' && document.length === 14) {
    return `${document.slice(0, 2)}.${document.slice(2, 5)}.${document.slice(5, 8)}/${document.slice(8, 12)}-${document.slice(12)}`;
  }
  if (type === 'cpf' && document.length === 11) {
    return `${document.slice(0, 3)}.${document.slice(3, 6)}.${document.slice(6, 9)}-${document.slice(9)}`;
  }
  return document;
};

const buildTimeoutController = (timeoutMs = LOOKUP_TIMEOUT) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timeout),
  };
};

const fetchJson = async (url, { headers = {}, method = 'GET', timeout = LOOKUP_TIMEOUT } = {}) => {
  const controller = buildTimeoutController(timeout);
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'E-o-Bicho/1.0 document lookup',
        ...headers,
      },
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = text;
      }
    }

    return { response, data };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new DocumentLookupError('Tempo limite excedido ao consultar a base cadastral.', {
        statusCode: 504,
        code: 'LOOKUP_TIMEOUT',
      });
    }
    if (error instanceof DocumentLookupError) {
      throw error;
    }
    throw new DocumentLookupError('Falha ao consultar a base cadastral externa.', {
      statusCode: 502,
      code: 'LOOKUP_REQUEST_FAILED',
      details: error.message,
    });
  } finally {
    controller.dispose();
  }
};

const buildPhone = (ddd, number) => {
  const normalizedDdd = digitsOnly(ddd);
  const normalizedNumber = digitsOnly(number);
  if (!normalizedDdd && !normalizedNumber) {
    return '';
  }
  if (normalizedDdd && normalizedNumber) {
    return `${normalizedDdd}${normalizedNumber}`;
  }
  return normalizedDdd || normalizedNumber;
};

const mapBrasilApiCnpj = (payload = {}) => {
  const document = digitsOnly(payload.cnpj || '');
  return {
    type: 'cnpj',
    document,
    formattedDocument: formatDocument(document, 'cnpj'),
    country: 'Brasil',
    legalName: payload.razao_social || '',
    fantasyName: payload.nome_fantasia || '',
    status: payload.descricao_situacao_cadastral || '',
    openingDate: payload.data_inicio_atividade || '',
    cnae: {
      code: payload.cnae_fiscal || '',
      description: payload.cnae_fiscal_descricao || '',
    },
    address: {
      cep: digitsOnly(payload.cep || ''),
      logradouro: [payload.descricao_tipo_de_logradouro, payload.logradouro].filter(Boolean).join(' ').trim(),
      numero: payload.numero || '',
      complemento: payload.complemento || '',
      bairro: payload.bairro || '',
      cidade: payload.municipio || '',
      uf: (payload.uf || '').toUpperCase(),
    },
    contact: {
      email: payload.email || '',
      phone: buildPhone(payload.ddd_telefone_1, payload.telefone_1),
      mobile: buildPhone(payload.ddd_telefone_2, payload.telefone_2),
    },
    source: 'brasilapi_cnpj',
    sourceName: 'BrasilAPI (dados públicos da Receita Federal)',
  };
};

const lookupCnpj = async (document) => {
  const digits = digitsOnly(document);
  if (!digits || digits.length !== 14 || !cnpj.isValid(digits)) {
    throw new DocumentLookupError('CNPJ inválido. Informe um número com 14 dígitos.', {
      statusCode: 400,
      code: 'INVALID_CNPJ',
    });
  }

  const { response, data } = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);

  if (response.status === 404) {
    throw new DocumentLookupError('CNPJ não encontrado na base consultada.', {
      statusCode: 404,
      code: 'CNPJ_NOT_FOUND',
    });
  }

  if (!response.ok) {
    throw new DocumentLookupError('Serviço de consulta de CNPJ indisponível no momento.', {
      statusCode: 502,
      code: 'CNPJ_LOOKUP_FAILED',
      details: data,
    });
  }

  if (!data || typeof data !== 'object') {
    throw new DocumentLookupError('Resposta inválida da base de CNPJ.', {
      statusCode: 502,
      code: 'INVALID_CNPJ_RESPONSE',
    });
  }

  return mapBrasilApiCnpj(data);
};

const resolveCpfEndpoint = (cpfDigits) => {
  if (!CPF_LOOKUP_URL_TEMPLATE) {
    throw new DocumentLookupError('Consulta automática de CPF não está configurada no servidor.', {
      statusCode: 503,
      code: 'CPF_LOOKUP_NOT_CONFIGURED',
    });
  }
  return CPF_LOOKUP_URL_TEMPLATE.replace('{cpf}', cpfDigits).replace('{document}', cpfDigits);
};

const mapGenericCpfPayload = (payload = {}) => ({
  type: 'cpf',
  document: digitsOnly(payload.cpf || payload.document || ''),
  formattedDocument: formatDocument(digitsOnly(payload.cpf || payload.document || ''), 'cpf'),
  country: payload.country || 'Brasil',
  legalName: payload.nome || payload.name || '',
  fantasyName: payload.nome_social || payload.fantasyName || '',
  status: payload.situacao_cadastral || payload.status || '',
  address: {
    cep: digitsOnly(payload.cep || ''),
    logradouro: payload.logradouro || '',
    numero: payload.numero || '',
    complemento: payload.complemento || '',
    bairro: payload.bairro || '',
    cidade: payload.cidade || payload.municipio || '',
    uf: (payload.uf || '').toUpperCase(),
  },
  contact: {
    email: payload.email || '',
    phone: digitsOnly(payload.telefone || ''),
    mobile: digitsOnly(payload.celular || payload.mobile || ''),
  },
  source: 'custom_cpf_endpoint',
  sourceName: 'Endpoint configurável de CPF',
});

const lookupCpf = async (document) => {
  const digits = digitsOnly(document);
  if (!digits || digits.length !== 11 || !cpf.isValid(digits)) {
    throw new DocumentLookupError('CPF inválido. Informe um número com 11 dígitos.', {
      statusCode: 400,
      code: 'INVALID_CPF',
    });
  }

  const url = resolveCpfEndpoint(digits);
  const headers = {};
  if (CPF_LOOKUP_TOKEN) {
    headers[CPF_LOOKUP_TOKEN_HEADER] = CPF_LOOKUP_TOKEN_TEMPLATE.replace('{token}', CPF_LOOKUP_TOKEN);
  }

  const { response, data } = await fetchJson(url, {
    method: CPF_LOOKUP_METHOD,
    headers,
  });

  if (response.status === 404) {
    throw new DocumentLookupError('CPF não encontrado na base consultada.', {
      statusCode: 404,
      code: 'CPF_NOT_FOUND',
    });
  }

  if (!response.ok) {
    throw new DocumentLookupError('Serviço de consulta de CPF retornou um erro.', {
      statusCode: 502,
      code: 'CPF_LOOKUP_FAILED',
      details: data,
    });
  }

  if (response.ok && data && typeof data !== 'object') {
    throw new DocumentLookupError('Resposta inválida da base de CPF.', {
      statusCode: 502,
      code: 'INVALID_CPF_RESPONSE',
    });
  }

  return mapGenericCpfPayload(data || {});
};

const lookupDocument = async (document) => {
  const digits = digitsOnly(document);
  if (!digits) {
    throw new DocumentLookupError('Informe um CPF ou CNPJ para realizar a consulta.', {
      statusCode: 400,
      code: 'DOCUMENT_REQUIRED',
    });
  }

  if (digits.length === 14) {
    return lookupCnpj(digits);
  }

  if (digits.length === 11) {
    return lookupCpf(digits);
  }

  throw new DocumentLookupError('Documento deve conter 11 dígitos (CPF) ou 14 dígitos (CNPJ).', {
    statusCode: 400,
    code: 'INVALID_DOCUMENT_LENGTH',
  });
};

module.exports = {
  lookupDocument,
  DocumentLookupError,
};
