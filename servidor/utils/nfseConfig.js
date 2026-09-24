'use strict';

const text = (value) => value == null ? '' : String(value).trim();
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const optionalNumber = (value) => value == null || (typeof value === 'string' && !value.trim())
  ? null : ['number', 'string'].includes(typeof value) ? Number(value) : NaN;
const invalid = (message) => Object.assign(new Error(message), { status: 400 });

function normalizeStoreNfse(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Configuração de NFS-e da empresa inválida.');
  const input = object(value);
  const config = {
    enabled: input.enabled === true,
    environment: text(input.environment) || 'homologacao',
    serieDps: text(input.serieDps),
    regimeEspecialTributacao: text(input.regimeEspecialTributacao),
    opSimpNac: text(input.opSimpNac),
    regApTribSN: text(input.regApTribSN),
    incluirInscricaoMunicipal: input.incluirInscricaoMunicipal === true,
  };
  if (!['homologacao', 'producao'].includes(config.environment)) throw invalid('Ambiente da NFS-e inválido.');
  if (config.serieDps && (!/^\d{1,5}$/.test(config.serieDps) || Number(config.serieDps) < 1 || Number(config.serieDps) > 49999)) throw invalid('A série da DPS deve estar entre 1 e 49999.');
  if (config.regimeEspecialTributacao && !/^[0-69]$/.test(config.regimeEspecialTributacao)) throw invalid('Regime especial da NFS-e inválido.');
  if (config.opSimpNac && !/^[1-3]$/.test(config.opSimpNac)) throw invalid('Opção pelo Simples Nacional inválida.');
  if (config.regApTribSN && !/^[1-3]$/.test(config.regApTribSN)) throw invalid('Regime de apuração do Simples Nacional inválido.');
  if (config.enabled && (!config.serieDps || !config.regimeEspecialTributacao || !config.opSimpNac)) {
    throw invalid('Para habilitar NFS-e, informe série da DPS, regime especial e opção pelo Simples Nacional.');
  }
  if (config.enabled && config.opSimpNac === '3' && !config.regApTribSN) throw invalid('Informe o regime de apuração do Simples Nacional.');
  return config;
}

function normalizeNfseFiscal(value = {}) {
  const input = object(value);
  const ibs = object(input.ibsCbs);
  return {
    codigoTributacaoNacional: text(input.codigoTributacaoNacional),
    codigoTributacaoMunicipal: text(input.codigoTributacaoMunicipal),
    codigoNbs: text(input.codigoNbs),
    descricao: text(input.descricao),
    tributacaoIss: text(input.tributacaoIss),
    aliquotaIss: optionalNumber(input.aliquotaIss),
    tipoRetencaoIss: text(input.tipoRetencaoIss),
    municipioPrestacao: text(input.municipioPrestacao || input.municipioIncidencia),
    paisResultado: text(input.paisResultado),
    tipoImunidade: text(input.tipoImunidade),
    totalTributosModo: text(input.totalTributosModo),
    pTotTribSN: optionalNumber(input.pTotTribSN),
    pTotTribFed: optionalNumber(input.pTotTribFed),
    pTotTribEst: optionalNumber(input.pTotTribEst),
    pTotTribMun: optionalNumber(input.pTotTribMun),
    tributosFonte: text(input.tributosFonte),
    tributosVersao: text(input.tributosVersao),
    tributosVigenciaInicio: text(input.tributosVigenciaInicio),
    tributosVigenciaFim: text(input.tributosVigenciaFim),
    tributosCodigoReferencia: text(input.tributosCodigoReferencia),
    ibsCbs: {
      enabled: ibs.enabled === true,
      finNFSe: text(ibs.finNFSe),
      CST: text(ibs.CST || ibs.cst),
      cClassTrib: text(ibs.cClassTrib),
      cIndOp: text(ibs.cIndOp),
      indFinal: text(ibs.indFinal),
      indDest: text(ibs.indDest),
    },
  };
}

function validateNfseFiscal(value = {}) {
  const fiscal = normalizeNfseFiscal(value);
  if (!/^\d{6}$/.test(fiscal.codigoTributacaoNacional)) throw invalid('Informe o código de tributação nacional do serviço com 6 dígitos.');
  if (fiscal.codigoTributacaoMunicipal && !/^\d{3}$/.test(fiscal.codigoTributacaoMunicipal)) throw invalid('O código de tributação municipal deve ter 3 dígitos.');
  if (fiscal.codigoNbs && !/^\d{9}$/.test(fiscal.codigoNbs)) throw invalid('O código NBS deve ter 9 dígitos.');
  if (!/^[1-4]$/.test(fiscal.tributacaoIss)) throw invalid('Selecione a tributação do ISS.');
  if (!/^[1-3]$/.test(fiscal.tipoRetencaoIss)) throw invalid('Selecione a retenção do ISS.');
  if (fiscal.aliquotaIss !== null && (!Number.isFinite(fiscal.aliquotaIss) || fiscal.aliquotaIss < 0 || fiscal.aliquotaIss > 5)) throw invalid('Alíquota do ISS inválida: informe um percentual de 0 a 5.');
  if (fiscal.municipioPrestacao && !/^\d{7}$/.test(fiscal.municipioPrestacao)) throw invalid('O município da prestação deve conter o código IBGE com 7 dígitos.');
  if (!['nao_informar', 'simples', 'percentual'].includes(fiscal.totalTributosModo)) throw invalid('Selecione como informar o total aproximado dos tributos.');
  for (const key of ['pTotTribSN', 'pTotTribFed', 'pTotTribEst', 'pTotTribMun']) {
    const number = fiscal[key];
    if (number !== null && (!Number.isFinite(number) || number < 0 || number > 100)) throw invalid('Percentual do total dos tributos inválido.');
  }
  if (fiscal.totalTributosModo === 'simples' && fiscal.pTotTribSN === null) throw invalid('Informe o percentual total de tributos do Simples Nacional.');
  if (fiscal.totalTributosModo === 'percentual' && ['pTotTribFed', 'pTotTribEst', 'pTotTribMun'].some(key => fiscal[key] === null)) throw invalid('Informe os percentuais federal, estadual e municipal do total dos tributos.');
  for (const [key, max] of [['tributosFonte', 200], ['tributosVersao', 60], ['tributosCodigoReferencia', 60]]) {
    if (fiscal[key].length > max) throw invalid(`O campo ${key} deve ter até ${max} caracteres.`);
  }
  const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(new Date(`${date}T12:00:00Z`).getTime())
    && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
  if (Boolean(fiscal.tributosVigenciaInicio) !== Boolean(fiscal.tributosVigenciaFim)) throw invalid('Informe o início e o fim da vigência dos tributos aproximados.');
  if (fiscal.tributosVigenciaInicio && (!validDate(fiscal.tributosVigenciaInicio) || !validDate(fiscal.tributosVigenciaFim))) throw invalid('Informe datas válidas para a vigência dos tributos aproximados.');
  if (fiscal.tributosVigenciaInicio > fiscal.tributosVigenciaFim) throw invalid('O início da vigência dos tributos aproximados não pode ser posterior ao fim.');
  if (fiscal.tributacaoIss === '2' && !/^[1-5]$/.test(fiscal.tipoImunidade)) throw invalid('Selecione o tipo de imunidade.');
  if (fiscal.tributacaoIss === '3' && !/^[A-Z]{2}$/.test(fiscal.paisResultado)) throw invalid('Informe o código ISO do país de resultado do serviço exportado.');
  if (fiscal.descricao.length > 2000) throw invalid('A descrição fiscal deve ter até 2.000 caracteres.');
  for (const [key, length] of [['CST', 3], ['cClassTrib', 6], ['cIndOp', 6]]) {
    if (fiscal.ibsCbs[key] && !(new RegExp(`^\\d{${length}}$`)).test(fiscal.ibsCbs[key])) throw invalid(`Campo IBS/CBS ${key} inválido: informe ${length} dígitos.`);
  }
  if (fiscal.ibsCbs.indFinal && !/^[01]$/.test(fiscal.ibsCbs.indFinal)) throw invalid('Indicador de consumidor final inválido.');
  if (fiscal.ibsCbs.indDest && !/^[01]$/.test(fiscal.ibsCbs.indDest)) throw invalid('Indicador de destinatário inválido.');
  if (fiscal.ibsCbs.enabled && ['finNFSe', 'cIndOp', 'indDest', 'CST', 'cClassTrib'].some(key => !fiscal.ibsCbs[key])) throw invalid('Preencha finalidade, indicador da operação, destinatário, CST e classificação tributária do IBS/CBS.');
  if (fiscal.ibsCbs.enabled && (fiscal.ibsCbs.finNFSe !== '0' || !/^\d{9}$/.test(fiscal.codigoNbs))) throw invalid('IBS/CBS exige finalidade regular e código NBS com 9 dígitos.');
  return fiscal;
}

function normalizeServiceFiscalMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Configuração fiscal dos serviços inválida.');
  const output = {};
  for (const [storeId, entry] of Object.entries(value)) {
    if (!/^[a-f\d]{24}$/i.test(storeId)) throw invalid('Empresa inválida na configuração fiscal do serviço.');
    const fiscalRuleCode = text(entry?.fiscalRuleCode);
    const descricao = text(entry?.descricao);
    if (fiscalRuleCode && !/^[1-9]\d*$/.test(fiscalRuleCode)) throw invalid('Código de regra fiscal inválido.');
    if (descricao.length > 2000) throw invalid('A descrição fiscal deve ter até 2.000 caracteres.');
    if (fiscalRuleCode || descricao) output[storeId] = { fiscalRuleCode, descricao };
  }
  return output;
}

module.exports = { normalizeStoreNfse, normalizeNfseFiscal, validateNfseFiscal, normalizeServiceFiscalMap };
