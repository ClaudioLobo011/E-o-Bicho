const crypto = require('crypto');
const mongoose = require('mongoose');
const forge = require('node-forge');
const { SignedXml } = require('xml-crypto');
const Product = require('../models/Product');
const {
  computeMissingFields,
  describeMissingFields,
  getFiscalDataForStore,
} = require('./fiscalRuleEngine');
const { decryptBuffer, decryptText } = require('../utils/certificates');

const sanitizeDigits = (value, { fallback = '' } = {}) => {
  if (!value) return fallback;
  const digits = String(value).replace(/\D+/g, '');
  return digits || fallback;
};

const safeNumber = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallback;
};

const toDecimal = (value, fractionDigits = 2) => {
  const number = safeNumber(value, 0);
  return number.toFixed(fractionDigits);
};

const formatDateTimeWithOffset = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const offsetMinutes = date.getTimezoneOffset();
  const sign = offsetMinutes > 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(abs / 60)).padStart(2, '0');
  const offsetMins = String(abs % 60).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMins}`;
};

const buildCnf = (sale) => {
  const base =
    sale?.saleCode ||
    sale?.receiptSnapshot?.meta?.saleCode ||
    sale?.id ||
    `${Date.now()}-${Math.random()}`;
  const hash = crypto.createHash('sha256').update(String(base)).digest('hex');
  const numeric = BigInt(`0x${hash.slice(-12)}`);
  const cnfNumber = Number(numeric % BigInt(100000000));
  return String(cnfNumber).padStart(8, '0');
};

const modulo11 = (value) => {
  const reversed = String(value).split('').reverse();
  let weight = 2;
  let total = 0;
  for (const char of reversed) {
    total += Number(char) * weight;
    weight += 1;
    if (weight > 9) weight = 2;
  }
  const remainder = total % 11;
  const dv = remainder === 0 || remainder === 1 ? 0 : 11 - remainder;
  return dv;
};

const buildAccessKey = ({
  ufCode,
  emissionDate,
  cnpj,
  model,
  serie,
  numero,
  emissionType,
  cnf,
}) => {
  const yy = String(emissionDate.getFullYear()).slice(-2);
  const mm = String(emissionDate.getMonth() + 1).padStart(2, '0');
  const datePart = `${yy}${mm}`;
  const normalizedSerie = String(serie).padStart(3, '0');
  const normalizedNumero = String(numero).padStart(9, '0');
  const body = `${String(ufCode).padStart(2, '0')}${datePart}${String(cnpj).padStart(14, '0')}${String(model).padStart(
    2,
    '0'
  )}${normalizedSerie}${normalizedNumero}${String(emissionType).padStart(1, '0')}${String(cnf).padStart(8, '0')}`;
  const dv = modulo11(body);
  return `${body}${dv}`;
};

const extractCertificatePair = (pfxBuffer, password) => {
  try {
    const asn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
    let privateKeyPem = '';
    let certificatePem = '';
    for (const safeContent of p12.safeContents) {
      for (const safeBag of safeContent.safeBags) {
        if (!privateKeyPem && safeBag.type === forge.pki.oids.pkcs8ShroudedKeyBag) {
          privateKeyPem = forge.pki.privateKeyToPem(safeBag.key);
        }
        if (!certificatePem && safeBag.type === forge.pki.oids.certBag) {
          certificatePem = forge.pki.certificateToPem(safeBag.cert);
        }
      }
    }
    if (!privateKeyPem) {
      throw new Error('Não foi possível extrair a chave privada do certificado.');
    }
    if (!certificatePem) {
      throw new Error('Não foi possível extrair o certificado digital.');
    }
    return { privateKeyPem, certificatePem };
  } catch (error) {
    throw new Error('Falha ao processar o certificado digital da empresa.');
  }
};

const normalizeFiscalItem = (item = {}) => {
  const quantity = safeNumber(item.quantity ?? item.quantidade ?? item.qtd ?? 0, 0);
  const unitPrice = safeNumber(item.unitPrice ?? item.valor ?? item.preco ?? item.valorUnitario ?? 0, 0);
  const total = safeNumber(item.totalPrice ?? item.subtotal ?? unitPrice * quantity, 0);
  const productId = item.productId || item.id || item._id || item.productSnapshot?._id || null;
  return {
    productId: productId ? String(productId) : null,
    quantity,
    unitPrice,
    total,
    productSnapshot: item.productSnapshot ? { ...item.productSnapshot } : null,
    name: item.name || item.nome || item.product || item.descricao || '',
    barcode: item.barcode || item.codigoBarras || item.codigo || '',
    internalCode: item.codigoInterno || item.internalCode || '',
    unit: item.unit || item.unidade || item.productSnapshot?.unidade || 'UN',
  };
};

const loadProductsByIds = async (ids = []) => {
  const uniqueIds = Array.from(
    new Set(
      ids
        .map((id) => {
          if (!id) return null;
          if (mongoose.Types.ObjectId.isValid(id)) {
            return id;
          }
          return null;
        })
        .filter(Boolean)
    )
  );
  if (!uniqueIds.length) {
    return new Map();
  }
  const products = await Product.find({ _id: { $in: uniqueIds } }).lean();
  const map = new Map();
  for (const product of products) {
    map.set(String(product._id), product);
  }
  return map;
};

const buildInfAdicObservations = ({ pdv, sale, environmentLabel }) => {
  const observations = [];
  if (pdv?.codigo) {
    observations.push({ tag: 'PDVCodigo', value: pdv.codigo });
  }
  if (pdv?.nome) {
    observations.push({ tag: 'PDVNome', value: pdv.nome });
  }
  if (sale?.saleCode) {
    observations.push({ tag: 'VendaCodigo', value: sale.saleCode });
  }
  const operador = sale?.receiptSnapshot?.meta?.operador || sale?.receiptSnapshot?.meta?.operadorNome;
  if (operador) {
    observations.push({ tag: 'Operador', value: operador });
  }
  if (environmentLabel) {
    observations.push({ tag: 'Ambiente', value: environmentLabel });
  }
  return observations;
};

const emitPdvSaleFiscal = async ({ sale, pdv, store, emissionDate, environment, serie, numero }) => {
  if (!sale || typeof sale !== 'object') {
    throw new Error('Venda inválida para emissão fiscal.');
  }
  const snapshot = sale.receiptSnapshot || {};
  const fiscalItemsRaw = Array.isArray(sale.fiscalItemsSnapshot)
    ? sale.fiscalItemsSnapshot
    : Array.isArray(sale.itemsSnapshot)
    ? sale.itemsSnapshot
    : [];
  const fiscalItems = fiscalItemsRaw.map((item) => normalizeFiscalItem(item));
  if (!fiscalItems.length) {
    throw new Error('Itens da venda não estão disponíveis para emissão fiscal.');
  }

  const productsMap = await loadProductsByIds(fiscalItems.map((item) => item.productId));
  const storeObject = store && typeof store.toObject === 'function' ? store.toObject() : store || {};
  const regime = storeObject?.regimeTributario || storeObject?.regime || '';
  const missingByProduct = [];

  for (const item of fiscalItems) {
    const product = item.productId ? productsMap.get(String(item.productId)) : null;
    if (!product) {
      missingByProduct.push({
        name: item.name || item.productSnapshot?.nome || 'Produto sem identificação',
        issues: ['Produto não localizado na base de dados para validação fiscal.'],
      });
      continue;
    }
    const fiscalData = getFiscalDataForStore(product, storeObject);
    const missing = computeMissingFields(fiscalData, { regime });
    const issues = [
      ...describeMissingFields(missing.comum || []),
      ...describeMissingFields(missing.nfce || []),
    ];
    if (issues.length) {
      missingByProduct.push({ name: product.nome || item.name || 'Produto', issues });
    }
  }

  if (missingByProduct.length) {
    const message = missingByProduct
      .map((entry) => `• ${entry.name}: ${entry.issues.join(', ')}`)
      .join('\n');
    throw new Error(`Ajuste a configuração fiscal dos itens antes da emissão:\n${message}`);
  }

  const emissionRef = emissionDate instanceof Date && !Number.isNaN(emissionDate.getTime())
    ? emissionDate
    : new Date();

  const ufCode = sanitizeDigits(storeObject?.codigoUf, { fallback: '00' }).padStart(2, '0');
  const cnpj = sanitizeDigits(storeObject?.cnpj, { fallback: '00000000000000' }).padStart(14, '0');
  const serieFiscal = String(serie || '').padStart(3, '0');
  const numeroFiscal = Number(numero);
  const cnf = buildCnf(sale);
  const tpAmb = environment === 'producao' ? '1' : '2';
  const accessKey = buildAccessKey({
    ufCode,
    emissionDate: emissionRef,
    cnpj,
    model: '65',
    serie: serieFiscal,
    numero: numeroFiscal,
    emissionType: '1',
    cnf,
  });

  const totalProducts = fiscalItems.reduce((sum, item) => sum + item.total, 0);
  const desconto = safeNumber(snapshot?.totais?.descontoValor ?? snapshot?.totais?.desconto ?? sale.discountValue ?? 0, 0);
  const acrescimo = safeNumber(snapshot?.totais?.acrescimoValor ?? snapshot?.totais?.acrescimo ?? sale.additionValue ?? 0, 0);
  const totalLiquido = Math.max(0, totalProducts - desconto + acrescimo);
  const pagamentosRaw = Array.isArray(snapshot?.pagamentos?.items) ? snapshot.pagamentos.items : [];
  const pagamentos = pagamentosRaw.length
    ? pagamentosRaw.map((payment) => ({
        descricao: payment?.descricao || payment?.label || payment?.nome || 'Pagamento',
        valor: safeNumber(payment?.valor ?? payment?.formatted ?? 0, 0),
        forma: payment?.forma || payment?.codigo || '01',
      }))
    : [
        {
          descricao: 'Dinheiro',
          valor: totalLiquido,
          forma: '01',
        },
      ];
  const troco = safeNumber(snapshot?.totais?.trocoValor ?? snapshot?.totais?.troco ?? 0, 0);

  const delivery = snapshot?.delivery || null;
  const cliente = snapshot?.cliente || null;

  const encryptedCertificate = storeObject?.certificadoArquivoCriptografado;
  if (!encryptedCertificate) {
    throw new Error('O certificado digital da empresa não está configurado.');
  }

  const encryptedCertificatePassword = storeObject?.certificadoSenhaCriptografada;
  if (!encryptedCertificatePassword) {
    throw new Error('A senha do certificado digital não está configurada.');
  }

  let certificateBuffer;
  try {
    certificateBuffer = decryptBuffer(encryptedCertificate);
  } catch (error) {
    throw new Error(`Não foi possível descriptografar o certificado digital: ${error.message}`);
  }

  let certificatePassword;
  try {
    certificatePassword = decryptText(encryptedCertificatePassword);
  } catch (error) {
    throw new Error(`Não foi possível recuperar a senha do certificado digital: ${error.message}`);
  }
  const { privateKeyPem, certificatePem } = extractCertificatePair(certificateBuffer, certificatePassword);

  const cscId = environment === 'producao' ? storeObject.cscIdProducao : storeObject.cscIdHomologacao;
  const cscTokenEncrypted =
    environment === 'producao'
      ? storeObject.cscTokenProducaoCriptografado
      : storeObject.cscTokenHomologacaoCriptografado;
  if (!cscId || !cscTokenEncrypted) {
    throw new Error('O CSC do ambiente selecionado não está configurado para a empresa.');
  }
  let cscToken;
  try {
    cscToken = decryptText(cscTokenEncrypted).trim();
  } catch (error) {
    throw new Error(`Não foi possível recuperar o CSC do ambiente selecionado: ${error.message}`);
  }

  const environmentLabel = environment === 'producao' ? 'Produção' : 'Homologação';

  const emissionIso = formatDateTimeWithOffset(emissionRef);

  const infNfeLines = [];
  infNfeLines.push(`  <infNFe Id="NFe${accessKey}" versao="4.00">`);
  infNfeLines.push('    <ide>');
  infNfeLines.push(`      <cUF>${ufCode}</cUF>`);
  infNfeLines.push(`      <cNF>${cnf}</cNF>`);
  infNfeLines.push(`      <natOp>${snapshot?.meta?.naturezaOperacao || 'VENDA AO CONSUMIDOR'}</natOp>`);
  infNfeLines.push('      <mod>65</mod>');
  infNfeLines.push(`      <serie>${serieFiscal}</serie>`);
  infNfeLines.push(`      <nNF>${String(numeroFiscal)}</nNF>`);
  infNfeLines.push(`      <dhEmi>${emissionIso}</dhEmi>`);
  infNfeLines.push(`      <tpNF>1</tpNF>`);
  infNfeLines.push('      <idDest>1</idDest>');
  infNfeLines.push(`      <cMunFG>${sanitizeDigits(storeObject?.codigoIbgeMunicipio, { fallback: '0000000' }).padStart(7, '0')}</cMunFG>`);
  infNfeLines.push(`      <tpImp>4</tpImp>`);
  infNfeLines.push(`      <tpEmis>1</tpEmis>`);
  infNfeLines.push(`      <cDV>${accessKey.slice(-1)}</cDV>`);
  infNfeLines.push(`      <tpAmb>${tpAmb}</tpAmb>`);
  infNfeLines.push('      <finNFe>1</finNFe>');
  infNfeLines.push('      <indFinal>1</indFinal>');
  infNfeLines.push('      <indPres>1</indPres>');
  infNfeLines.push('      <procEmi>0</procEmi>');
  infNfeLines.push('      <verProc>PDV-EOBICHO-1.0</verProc>');
  infNfeLines.push('    </ide>');
  infNfeLines.push('    <emit>');
  infNfeLines.push(`      <CNPJ>${cnpj}</CNPJ>`);
  infNfeLines.push(`      <xNome>${storeObject?.razaoSocial || storeObject?.nome || ''}</xNome>`);
  infNfeLines.push(`      <xFant>${storeObject?.nomeFantasia || storeObject?.razaoSocial || ''}</xFant>`);
  infNfeLines.push('      <enderEmit>');
  infNfeLines.push(`        <xLgr>${storeObject?.logradouro || storeObject?.endereco || ''}</xLgr>`);
  infNfeLines.push(`        <nro>${storeObject?.numero || 'S/N'}</nro>`);
  infNfeLines.push(`        <xCpl>${storeObject?.complemento || ''}</xCpl>`);
  infNfeLines.push(`        <xBairro>${storeObject?.bairro || ''}</xBairro>`);
  infNfeLines.push(`        <cMun>${sanitizeDigits(storeObject?.codigoIbgeMunicipio, { fallback: '0000000' }).padStart(7, '0')}</cMun>`);
  infNfeLines.push(`        <xMun>${storeObject?.municipio || ''}</xMun>`);
  infNfeLines.push(`        <UF>${(storeObject?.uf || '').toString().toUpperCase()}</UF>`);
  infNfeLines.push(`        <CEP>${sanitizeDigits(storeObject?.cep, { fallback: '' }).padStart(8, '0')}</CEP>`);
  infNfeLines.push('        <cPais>1058</cPais>');
  infNfeLines.push('        <xPais>BRASIL</xPais>');
  infNfeLines.push('      </enderEmit>');
  infNfeLines.push(`      <IE>${sanitizeDigits(storeObject?.inscricaoEstadual, { fallback: '' })}</IE>`);
  infNfeLines.push('      <CRT>1</CRT>');
  infNfeLines.push('    </emit>');

  const destNome = cliente?.nome || cliente?.razaoSocial || 'CONSUMIDOR';
  infNfeLines.push('    <dest>');
  if (cliente?.cnpj) {
    infNfeLines.push(`      <CNPJ>${sanitizeDigits(cliente.cnpj)}</CNPJ>`);
  } else if (cliente?.cpf) {
    infNfeLines.push(`      <CPF>${sanitizeDigits(cliente.cpf)}</CPF>`);
  }
  infNfeLines.push(`      <xNome>${destNome}</xNome>`);
  if (cliente?.email) {
    infNfeLines.push(`      <email>${cliente.email}</email>`);
  }
  infNfeLines.push('      <enderDest>');
  infNfeLines.push(`        <xLgr>${delivery?.logradouro || cliente?.logradouro || ''}</xLgr>`);
  infNfeLines.push(`        <nro>${delivery?.numero || cliente?.numero || 'S/N'}</nro>`);
  infNfeLines.push(`        <xCpl>${delivery?.complemento || cliente?.complemento || ''}</xCpl>`);
  infNfeLines.push(`        <xBairro>${delivery?.bairro || cliente?.bairro || ''}</xBairro>`);
  const destMunicipio = delivery?.cidade || cliente?.cidade || storeObject?.municipio || '';
  const destIbge = sanitizeDigits(delivery?.codigoIbgeMunicipio || cliente?.codigoIbgeMunicipio || storeObject?.codigoIbgeMunicipio, {
    fallback: '0000000',
  }).padStart(7, '0');
  const destUf = (delivery?.uf || cliente?.uf || storeObject?.uf || '').toString().toUpperCase();
  infNfeLines.push(`        <cMun>${destIbge}</cMun>`);
  infNfeLines.push(`        <xMun>${destMunicipio}</xMun>`);
  infNfeLines.push(`        <UF>${destUf}</UF>`);
  infNfeLines.push(`        <CEP>${sanitizeDigits(delivery?.cep || cliente?.cep, { fallback: '' }).padStart(8, '0')}</CEP>`);
  infNfeLines.push('        <cPais>1058</cPais>');
  infNfeLines.push('        <xPais>BRASIL</xPais>');
  infNfeLines.push('      </enderDest>');
  infNfeLines.push(`      <indIEDest>9</indIEDest>`);
  infNfeLines.push('    </dest>');

  fiscalItems.forEach((item, index) => {
    const product = item.productId ? productsMap.get(String(item.productId)) : null;
    const fiscalData = product ? getFiscalDataForStore(product, storeObject) : {};
    const cfop =
      fiscalData?.cfop?.nfce?.dentroEstado ||
      fiscalData?.cfop?.nfce?.foraEstado ||
      fiscalData?.cfop?.nfe?.dentroEstado ||
      '5102';
    const ncm = sanitizeDigits(product?.ncm || item.productSnapshot?.ncm, { fallback: '00000000' });
    const cEAN = sanitizeDigits(item.barcode, { fallback: 'SEM GTIN' });
    const cEANTrib = cEAN === 'SEM GTIN' ? 'SEM GTIN' : cEAN;
    const orig = fiscalData?.origem || '0';
    const csosn = fiscalData?.csosn || '';
    const cst = fiscalData?.cst || '';
    infNfeLines.push(`    <det nItem="${index + 1}">`);
    infNfeLines.push('      <prod>');
    infNfeLines.push(`        <cProd>${item.internalCode || item.productId || String(index + 1).padStart(4, '0')}</cProd>`);
    infNfeLines.push(`        <cEAN>${cEAN}</cEAN>`);
    infNfeLines.push(`        <xProd>${item.name}</xProd>`);
    infNfeLines.push(`        <NCM>${ncm.padStart(8, '0')}</NCM>`);
    if (fiscalData?.cest) {
      infNfeLines.push(`        <CEST>${fiscalData.cest}</CEST>`);
    }
    infNfeLines.push(`        <CFOP>${cfop}</CFOP>`);
    infNfeLines.push(`        <uCom>${item.unit}</uCom>`);
    infNfeLines.push(`        <qCom>${toDecimal(item.quantity, 4)}</qCom>`);
    infNfeLines.push(`        <vUnCom>${toDecimal(item.unitPrice)}</vUnCom>`);
    infNfeLines.push(`        <vProd>${toDecimal(item.total)}</vProd>`);
    infNfeLines.push(`        <cEANTrib>${cEANTrib}</cEANTrib>`);
    infNfeLines.push(`        <uTrib>${item.unit}</uTrib>`);
    infNfeLines.push(`        <qTrib>${toDecimal(item.quantity, 4)}</qTrib>`);
    infNfeLines.push(`        <vUnTrib>${toDecimal(item.unitPrice)}</vUnTrib>`);
    infNfeLines.push('        <indTot>1</indTot>');
    infNfeLines.push('      </prod>');
    infNfeLines.push('      <imposto>');
    infNfeLines.push('        <ICMS>');
    if (csosn) {
      infNfeLines.push('          <ICMSSN102>');
      infNfeLines.push(`            <orig>${orig}</orig>`);
      infNfeLines.push(`            <CSOSN>${csosn}</CSOSN>`);
      infNfeLines.push('          </ICMSSN102>');
    } else {
      infNfeLines.push('          <ICMS00>');
      infNfeLines.push(`            <orig>${orig}</orig>`);
      infNfeLines.push(`            <CST>${cst || '00'}</CST>`);
      infNfeLines.push('            <modBC>3</modBC>');
      infNfeLines.push(`            <vBC>${toDecimal(item.total)}</vBC>`);
      infNfeLines.push('            <pICMS>0.00</pICMS>');
      infNfeLines.push('            <vICMS>0.00</vICMS>');
      infNfeLines.push('          </ICMS00>');
    }
    infNfeLines.push('        </ICMS>');
    infNfeLines.push('        <PIS>');
    infNfeLines.push('          <PISAliq>');
    infNfeLines.push(`            <CST>${fiscalData?.pis?.cst || '49'}</CST>`);
    infNfeLines.push('            <vBC>0.00</vBC>');
    infNfeLines.push(`            <pPIS>${toDecimal(fiscalData?.pis?.aliquota ?? 0)}</pPIS>`);
    infNfeLines.push('            <vPIS>0.00</vPIS>');
    infNfeLines.push('          </PISAliq>');
    infNfeLines.push('        </PIS>');
    infNfeLines.push('        <COFINS>');
    infNfeLines.push('          <COFINSAliq>');
    infNfeLines.push(`            <CST>${fiscalData?.cofins?.cst || '49'}</CST>`);
    infNfeLines.push('            <vBC>0.00</vBC>');
    infNfeLines.push(`            <pCOFINS>${toDecimal(fiscalData?.cofins?.aliquota ?? 0)}</pCOFINS>`);
    infNfeLines.push('            <vCOFINS>0.00</vCOFINS>');
    infNfeLines.push('          </COFINSAliq>');
    infNfeLines.push('        </COFINS>');
    infNfeLines.push('      </imposto>');
    infNfeLines.push('    </det>');
  });

  infNfeLines.push('    <total>');
  infNfeLines.push('      <ICMSTot>');
  infNfeLines.push('        <vBC>0.00</vBC>');
  infNfeLines.push('        <vICMS>0.00</vICMS>');
  infNfeLines.push('        <vICMSDeson>0.00</vICMSDeson>');
  infNfeLines.push('        <vFCPUFDest>0.00</vFCPUFDest>');
  infNfeLines.push('        <vICMSUFDest>0.00</vICMSUFDest>');
  infNfeLines.push('        <vICMSUFRemet>0.00</vICMSUFRemet>');
  infNfeLines.push('        <vFCP>0.00</vFCP>');
  infNfeLines.push(`        <vBCST>0.00</vBCST>`);
  infNfeLines.push('        <vST>0.00</vST>');
  infNfeLines.push('        <vFCPST>0.00</vFCPST>');
  infNfeLines.push('        <vFCPSTRet>0.00</vFCPSTRet>');
  infNfeLines.push(`        <vProd>${toDecimal(totalProducts)}</vProd>`);
  infNfeLines.push(`        <vFrete>0.00</vFrete>`);
  infNfeLines.push(`        <vSeg>0.00</vSeg>`);
  infNfeLines.push(`        <vDesc>${toDecimal(desconto)}</vDesc>`);
  infNfeLines.push(`        <vII>0.00</vII>`);
  infNfeLines.push(`        <vIPI>0.00</vIPI>`);
  infNfeLines.push(`        <vIPIDevol>0.00</vIPIDevol>`);
  infNfeLines.push(`        <vPIS>0.00</vPIS>`);
  infNfeLines.push(`        <vCOFINS>0.00</vCOFINS>`);
  infNfeLines.push(`        <vOutro>${toDecimal(acrescimo)}</vOutro>`);
  infNfeLines.push(`        <vNF>${toDecimal(totalLiquido)}</vNF>`);
  infNfeLines.push('      </ICMSTot>');
  infNfeLines.push('    </total>');

  infNfeLines.push('    <pag>');
  pagamentos.forEach((payment) => {
    const forma = sanitizeDigits(payment.forma, { fallback: '01' }).padStart(2, '0');
    infNfeLines.push('      <detPag>');
    infNfeLines.push(`        <tPag>${forma}</tPag>`);
    infNfeLines.push(`        <vPag>${toDecimal(payment.valor)}</vPag>`);
    infNfeLines.push('      </detPag>');
  });
  infNfeLines.push(`      <vTroco>${toDecimal(troco)}</vTroco>`);
  infNfeLines.push('    </pag>');

  const obs = buildInfAdicObservations({ pdv, sale, environmentLabel });
  infNfeLines.push('    <infAdic>');
  if (obs.length) {
    obs.forEach((entry) => {
      infNfeLines.push(`      <obsCont xCampo="${entry.tag}"><xTexto>${entry.value}</xTexto></obsCont>`);
    });
  }
  if (snapshot?.meta?.observacoes || snapshot?.meta?.observacaoGeral) {
    infNfeLines.push(`      <infCpl>${snapshot.meta.observacoes || snapshot.meta.observacaoGeral}</infCpl>`);
  }
  infNfeLines.push('    </infAdic>');
  infNfeLines.push('  </infNFe>');

  const certificateBody = certificatePem
    .replace('-----BEGIN CERTIFICATE-----', '')
    .replace('-----END CERTIFICATE-----', '')
    .replace(/\s+/g, '');

  const baseXmlLines = ['<?xml version="1.0" encoding="UTF-8"?>', '<NFe xmlns="http://www.portalfiscal.inf.br/nfe">', ...infNfeLines, '</NFe>'];
  const xmlForSignature = baseXmlLines.join('\n');

  const signer = new SignedXml();
  signer.canonicalizationAlgorithm = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';
  signer.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
  signer.addReference({
    xpath: "//*[local-name(.)='infNFe']",
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  signer.signingKey = privateKeyPem;
  signer.keyInfoProvider = {
    getKeyInfo: () => `<X509Data><X509Certificate>${certificateBody}</X509Certificate></X509Data>`,
  };
  signer.computeSignature(xmlForSignature, { prefix: '' });

  const signedXmlContent = signer.getSignedXml();
  const digestValue = signer.references?.[0]?.digestValue || '';
  const signatureValue = signer.signatureValue || '';

  const qrParams = new URLSearchParams();
  qrParams.set('chNFe', accessKey);
  qrParams.set('nVersao', '100');
  qrParams.set('tpAmb', tpAmb);
  qrParams.set('dhEmi', emissionIso);
  qrParams.set('vNF', toDecimal(totalLiquido));
  qrParams.set('vICMS', '0.00');
  qrParams.set('digVal', digestValue);
  qrParams.set('cIdToken', cscId);
  const qrBase = qrParams.toString();
  const cHashQRCode = crypto.createHash('sha1').update(`${qrBase}${cscToken}`).digest('hex');
  const qrCodePayload = `${qrBase}&cHashQRCode=${cHashQRCode}`;

  const infNfeSuplXml = [
    '  <infNFeSupl>',
    `    <qrCode><![CDATA[${qrCodePayload}]]></qrCode>`,
    '    <urlChave>https://www.sefaz.br.gov.br/nfce/consulta</urlChave>',
    '  </infNFeSupl>',
  ].join('\n');

  const signatureIndex = signedXmlContent.indexOf('<Signature');
  let finalXml;
  if (signatureIndex === -1) {
    finalXml = signedXmlContent.replace('</NFe>', `${infNfeSuplXml}\n</NFe>`);
  } else {
    finalXml = `${signedXmlContent.slice(0, signatureIndex)}${infNfeSuplXml}\n${signedXmlContent.slice(signatureIndex)}`;
  }

  const xml = finalXml.startsWith('<?xml')
    ? finalXml
    : `<?xml version="1.0" encoding="UTF-8"?>\n${finalXml}`;

  return {
    xml,
    qrCodePayload,
    digestValue,
    signatureValue,
    accessKey,
    totals: {
      totalProducts,
      totalLiquido,
      desconto,
      acrescimo,
      troco,
    },
  };
};

module.exports = {
  emitPdvSaleFiscal,
};
