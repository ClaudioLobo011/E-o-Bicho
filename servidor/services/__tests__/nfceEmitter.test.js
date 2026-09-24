const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { _test } = require('../nfceEmitter');

describe('NFC-e pagamentos, Pix e troco', () => {
  const mixedItems = [{ itemType: 'product', total: 219.9 }, { itemType: 'service', total: 130 }];
  const xmlPayment = (payment, total = 10, change = 0) => _test.serializeFiscalPayments({ payments: [payment], total, change });

  test('projeção interna de itens dispensa pagamentos sem enfraquecer a emissão NFC-e', () => {
    const input = { items: [{ total: 100 }, { itemType: 'service', total: 80 }], discount: 10, addition: 5 };
    const projection = _test.buildFiscalProjection(input, { itemsOnly: true });
    assert.deepEqual(projection.adjustedItems.map(item => item.netTotal), [97.22, 77.78]);
    assert.equal(projection.totalLiquido, 97.22); assert.equal(projection.payments, undefined);
    assert.throws(() => _test.buildFiscalProjection(input), /pagamentos reais/);
    assert.throws(() => _test.buildFiscalProjection({ ...input, itemsOnly: true }), /pagamentos reais/);
    assert.throws(() => _test.buildFiscalProjection(input, { itemsOnly: 'true' }), /pagamentos reais/);
    assert.throws(() => _test.buildFiscalProjection({ ...input, payments: [{ forma: '01', valor: 174.99 }] }), /centavos/);
  });

  test('preserva códigos explícitos suportados e diferencia Pix manual/dinâmico, crediário e cartão loja', () => {
    for (const code of ['01', '02', '03', '04', '05', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '90', '91', '99']) assert.equal(_test.resolvePaymentCode(code), code);
    for (const [label, code] of [['Dinheiro', '01'], ['Crédito (3x)', '03'], ['Débito', '04'], ['Cartão da Loja', '05'], ['Crediário', '05'], ['Pix', '20'], ['Pix estático', '20'], ['Chave Pix', '20'], ['Pix dinâmico', '17'], ['Pix automático', '23'], ['TEF', '24'], ['Transferência bancária', '18'], ['Vale alimentação', '10'], ['Vale refeição', '11']]) assert.equal(_test.resolvePaymentCode(label), code, label);
    assert.throws(() => _test.resolvePaymentCode(''), /Informe a forma/);
    assert.throws(() => _test.resolvePaymentCode('80'), /não suportado/);
  });

  test('cartões 03/04 e Pix dinâmico17 incluem card/tpIntegra2 sem inventar adquirente ou autorização', () => {
    for (const code of ['03', '04', '17']) {
      const xml = xmlPayment({ forma: code, valor: 10 });
      assert.match(xml, /<card><tpIntegra>2<\/tpIntegra><\/card>/);
      assert.doesNotMatch(xml, /<CNPJ>|<cAut>|<tBand>/);
    }
  });

  test('Pix manual20 e formas sem dados eletrônicos não recebem grupo card', () => {
    for (const code of ['01', '02', '05', '10', '11', '12', '13', '15', '16', '18', '19', '20', '21', '23', '24']) assert.doesNotMatch(xmlPayment({ forma: code, valor: 10 }), /<card>/);
    assert.throws(() => xmlPayment({ forma: '20', valor: 10, card: { tpIntegra: '1' } }), /não permite/);
    assert.throws(() => xmlPayment({ forma: '01', valor: 10, card: { tpIntegra: '2' } }), /não permite/);
    assert.throws(() => xmlPayment({ forma: '22', valor: 10 }), /falha de hardware/);
  });

  test('preserva integração declarada e autorização longa sem truncar nem preencher campos ausentes', () => {
    const authorization = 'A'.repeat(64);
    const xml = xmlPayment({ forma: '03', valor: 10, card: { tpIntegra: '1', CNPJ: '12345678000195', tBand: '01', cAut: authorization } });
    assert.match(xml, /<tpIntegra>1<\/tpIntegra>/);
    assert.ok(xml.includes(`<cAut>${authorization}</cAut>`));
    assert.throws(() => xmlPayment({ forma: '03', valor: 10, card: { tpIntegra: '1' } }), /autorização reais/);
    assert.throws(() => xmlPayment({ forma: '03', valor: 10, card: { tpIntegra: '3' } }), /integração.*inválido/);
  });

  test('Outros exige xPag na ordem correta e escapa a descrição; indPag aceita apenas0/1', () => {
    const xml = xmlPayment({ forma: '99', valor: 10, descricao: 'Vale & convênio', indPag: 1 });
    assert.match(xml, /<indPag>1<\/indPag><tPag>99<\/tPag><xPag>Vale &amp; convênio<\/xPag><vPag>10.00<\/vPag>/);
    assert.throws(() => xmlPayment({ forma: '99', valor: 10 }), /Descreva/);
    assert.throws(() => xmlPayment({ forma: '01', valor: 10, indPag: 2 }), /Indicador.*inválido/);
  });

  test('caso misto349.90 Pixmanual projeta somente produto219.90 sem card e conservaorigem', () => {
    const original = { receiptSnapshot: { pagamentos: { items: [{ label: 'Pix', valor: 349.9 }] }, totais: { trocoValor: 0 } } };
    const before = JSON.stringify(original);
    const projected = _test.buildFiscalProjection({ items: mixedItems, ..._test.resolveSaleFiscalPayments(original) });
    assert.equal(projected.totalLiquido, 219.9);
    assert.equal(projected.payments[0].valor, 219.9);
    const xml = _test.serializeFiscalPayments({ payments: projected.payments, change: projected.change, total: projected.totalLiquido });
    assert.match(xml, /<tPag>20<\/tPag><vPag>219.90<\/vPag>/);
    assert.doesNotMatch(xml, /<card>|<vTroco>/);
    assert.equal(JSON.stringify(original), before);
  });

  test('misto com dinheiro400 preserva troco50.10 integral e projeta recebido270', () => {
    for (const payments of [[{ forma: '01', valor: 400 }], [{ forma: '01', amount: 349.9, tenderedAmount: 400, change: 50.1 }]]) {
      const original = JSON.stringify(payments);
      const projected = _test.buildFiscalProjection({ items: mixedItems, payments, change: 50.1 });
      assert.equal(projected.payments[0].valor, 270);
      assert.equal(projected.change, 50.1);
      const xml = _test.serializeFiscalPayments({ payments: projected.payments, total: 219.9, change: projected.change });
      assert.match(xml, /<vPag>270.00<\/vPag>/);
      assert.match(xml, /<vTroco>50.10<\/vTroco>/);
      assert.equal(JSON.stringify(payments), original);
    }
  });

  test('troco não é rateado sobre cartão/Pix e cashlíquidozero mantém a linha de devolução', () => {
    const projected = _test.buildFiscalProjection({ items: mixedItems,
      payments: [{ forma: '04', valor: 349.9 }, { forma: '01', valor: 50.1 }], change: 50.1 });
    assert.deepEqual(projected.payments.map((p) => [p.forma, p.valor]), [['04', 219.9], ['01', 50.1]]);
    assert.doesNotThrow(() => _test.serializeFiscalPayments({ payments: projected.payments, total: 219.9, change: 50.1 }));
    assert.throws(() => _test.buildFiscalProjection({ items: mixedItems, payments: [{ forma: '20', valor: 400 }], change: 50.1 }), /sem pagamento em dinheiro/);
    assert.throws(() => _test.buildFiscalProjection({ items: mixedItems, payments: [{ forma: '03', amount: 349.9, tenderedAmount: 400, change: 50.1 }], change: 50.1 }), /só pode ser registrado/);
  });

  test('troco em venda só de produtos preserva bruto/líquido e metadados Desktop', () => {
    const result = _test.buildFiscalProjection({ items: [{ total: 10 }], payments: [{ forma: '01', amount: 10, tenderedAmount: 20, change: 10 }], change: 10 });
    assert.equal(result.payments[0].valor, 20);
    assert.equal(result.payments[0].amount, 10);
    assert.equal(result.change, 10);
    assert.match(_test.serializeFiscalPayments({ payments: result.payments, total: 10, change: 10 }), /<vPag>20.00<\/vPag>/);
  });

  test('rateia múltiplas formas em centavos exatos sem preencher pagamento faltante', () => {
    const projected = _test.buildFiscalProjection({ items: [{ total: 0.03 }, { itemType: 'service', total: 0.02 }], payments: [{ forma: '01', valor: 0.02 }, { forma: '20', valor: 0.03 }] });
    assert.deepEqual(projected.payments.map((p) => p.valor), [0.01, 0.02]);
    assert.throws(() => _test.buildFiscalProjection({ items: mixedItems, payments: [{ forma: '01', valor: 349.89 }] }), /centavos/);
    assert.throws(() => _test.buildFiscalProjection({ items: mixedItems, payments: [{ forma: '01', valor: 349.9 }], change: 50.1 }), /centavos/);
    assert.throws(() => _test.buildFiscalProjection({ items: mixedItems, payments: [] }), /pagamentos reais/);
    assert.throws(() => _test.serializeFiscalPayments({ payments: [{ forma: '01', valor: 9.99 }], total: 10 }), /centavos/);
  });

  test('desconto, acréscimo e troco em venda mista mantêm rateio de pagamentos exato', () => {
    const result = _test.buildFiscalProjection({ items: [{ total: 100 }, { itemType: 'service', total: 80 }], discount: 10, addition: 5,
      payments: [{ forma: '01', valor: 70 }, { forma: '20', valor: 125 }], change: 20 });
    assert.equal(result.totalLiquido, 97.22);
    assert.equal(result.discount, 5.56);
    assert.equal(result.addition, 2.78);
    assert.deepEqual(result.payments.map((payment) => payment.valor), [47.78, 69.44]);
    assert.doesNotThrow(() => _test.serializeFiscalPayments({ payments: result.payments, total: result.totalLiquido, change: result.change }));
  });

  test('14 e 90 são bloqueados na NFC-e; pagamento posterior explícito91 tem valor zero', () => {
    for (const forma of ['14', '90']) assert.throws(() => xmlPayment({ forma, valor: 0 }), /NFC-e não permite/);
    const projected = _test.buildFiscalProjection({ items: mixedItems, payments: [{ forma: '91', valor: 349.9 }] });
    assert.equal(projected.payments[0].valor, 219.9);
    assert.match(_test.serializeFiscalPayments({ payments: projected.payments, total: 219.9 }), /<indPag>1<\/indPag><tPag>91<\/tPag><vPag>0.00<\/vPag>/);
    const partial = _test.buildFiscalProjection({ items: [{ total: 40 }, { itemType: 'service', total: 60 }], payments: [{ forma: '01', valor: 50 }, { forma: '91', valor: 0 }] });
    assert.deepEqual(partial.payments.map((payment) => payment.valor), [20, 0]);
    assert.doesNotThrow(() => _test.serializeFiscalPayments({ payments: partial.payments, total: 40 }));
    const credit = _test.buildFiscalProjection({ items: mixedItems, payments: [{ forma: 'Crediário', valor: 349.9 }] });
    assert.match(_test.serializeFiscalPayments({ payments: credit.payments, total: 219.9 }), /<indPag>1<\/indPag><tPag>05<\/tPag><vPag>219.90<\/vPag>/);
  });

  test('limite vigente do troco é 300 mil, sem aplicar o limite antigo de mil reais', () => {
    assert.doesNotThrow(() => xmlPayment({ forma: '01', valor: 2010 }, 10, 2000));
    assert.throws(() => xmlPayment({ forma: '01', valor: 300010.01 }, 10, 300000.01), /300.000/);
  });

  test('não fabrica dinheiro sem snapshot e preserva fallback comprovado de pagamentos', () => {
    assert.deepEqual(_test.resolveSaleFiscalPayments({}), { payments: [], change: 0 });
    const resolved = _test.resolveSaleFiscalPayments({ payments: [{ fiscalCode: '17', name: 'Pix dinâmico', amount: 10, card: { tpIntegra: '2' } }] });
    assert.equal(resolved.payments[0].forma, '17');
    assert.equal(resolved.payments[0].valor, 10);
    assert.match(_test.serializeFiscalPayments({ payments: resolved.payments, total: 10 }), /<tPag>17<\/tPag>/);
    assert.deepEqual(resolved.payments[0].card, { tpIntegra: '2' });
  });

  test('campos fiscais opcionais vazios não apagam a forma real e valores formatados antigos mantêm troco', () => {
    const source = _test.resolveSaleFiscalPayments({ receiptSnapshot: { pagamentos: { items: [{ label: 'Dinheiro', formatted: 'R$ 400,00', fiscalCode: '', tPag: '', tpIntegra: '', card: { tpIntegra: '', cnpj: '' } }] }, totais: { troco: 'R$ 50,10' } } });
    const result = _test.buildFiscalProjection({ items: mixedItems, ...source });
    const xml = _test.serializeFiscalPayments({ payments: result.payments, change: result.change, total: result.totalLiquido });
    assert.match(xml, /<tPag>01<\/tPag><vPag>270.00<\/vPag>/);
    assert.match(xml, /<vTroco>50.10<\/vTroco>/);
    assert.doesNotMatch(xml, /<card>/);
    for (const value of [false, [10], {}, -1, 'invalid']) assert.throws(() => xmlPayment({ forma: '01', valor: value }), /válido/);
  });

  test('validação do XML admite saldo futuro91 e recusa valor indevido em90/91', () => {
    const document = (paymentXml) => `<NFe><infNFe><ide><tpEmis>1</tpEmis></ide><det><prod><qCom>1</qCom><vUnCom>100</vUnCom><vProd>100</vProd></prod></det><total><ICMSTot><vProd>100</vProd><vNF>100</vNF></ICMSTot></total>${paymentXml}</infNFe></NFe>`;
    const valid = _test.serializeFiscalPayments({ payments: [{ forma: '01', valor: 50 }, { forma: '91', valor: 50 }], total: 100 });
    assert.equal(_test.validateFiscalXmlTotals(document(valid)).valid, true);
    assert.equal(_test.validateFiscalXmlTotals(document('<pag><detPag><tPag>91</tPag><vPag>50</vPag></detPag></pag>')).valid, false);
    assert.equal(_test.validateFiscalXmlTotals(document('<pag><detPag><tPag>91</tPag><vPag>100</vPag></detPag></pag>')).valid, false);
  });

  test('rejeição391 propaga classificação permanente sem transformar falha de rede em rejeição', () => {
    assert.deepEqual(_test.sefazFailureMetadata({ details: { protocolStatus: '391', loteStatus: '104' } }), { sefazStatus: '391', permanent: true, retryable: false, statusCode: 422 });
    assert.deepEqual(_test.sefazFailureMetadata(new Error('ETIMEDOUT')), {});
    assert.equal(_test.sefazFailureMetadata({ details: { loteStatus: '108' } }).retryable, true);
    assert.equal(_test.sefazFailureMetadata({ details: { protocolStatus: '204' } }).requiresConsultation, true);
  });
});

test('mantém desconto e acréscimo na ordem exigida pelo schema do produto', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'nfceEmitter.js'), 'utf8');
  const productBlockStart = source.indexOf("infNfeLines.push(`        <vProd>");
  const productBlockEnd = source.indexOf("infNfeLines.push('      </prod>')", productBlockStart);
  const productBlock = source.slice(productBlockStart, productBlockEnd);

  assert.ok(productBlock.indexOf('<vUnTrib>') < productBlock.indexOf('<vDesc>'));
  assert.ok(productBlock.indexOf('<vDesc>') < productBlock.indexOf('<indTot>'));
  assert.ok(productBlock.indexOf('<vOutro>') < productBlock.indexOf('<indTot>'));
});

describe('nfceEmitter CRT', () => {
  test('mapeia regimes do cadastro de empresa para CRT da NFC-e', () => {
    assert.equal(_test.resolveEmitterCrt('simples'), '1');
    assert.equal(_test.resolveEmitterCrt('simples_excesso_sublimite'), '2');
    assert.equal(_test.resolveEmitterCrt('mei'), '4');
    assert.equal(_test.resolveEmitterCrt('lucro_presumido'), '3');
    assert.equal(_test.resolveEmitterCrt('lucro_real'), '3');
    assert.equal(_test.resolveEmitterCrt('lucro_arbitrado'), '3');
    assert.equal(_test.resolveEmitterCrt('normal'), '3');
  });

  test('normaliza espacos e caixa antes de resolver CRT', () => {
    assert.equal(_test.resolveEmitterCrt(' SIMPLES '), '1');
    assert.equal(_test.resolveEmitterCrt(' SIMPLES_EXCESSO_SUBLIMITE '), '2');
    assert.equal(_test.resolveEmitterCrt(' Mei '), '4');
    assert.equal(_test.resolveEmitterCrt(' Lucro_Presumido '), '3');
    assert.equal(_test.resolveEmitterCrt(' Lucro_Arbitrado '), '3');
    assert.equal(_test.resolveEmitterCrt(' NORMAL '), '3');
  });

  test('aceita valores numericos de CRT', () => {
    assert.equal(_test.resolveEmitterCrt('1'), '1');
    assert.equal(_test.resolveEmitterCrt('2'), '2');
    assert.equal(_test.resolveEmitterCrt('3'), '3');
    assert.equal(_test.resolveEmitterCrt('4'), '4');
  });

  test('bloqueia NFC-e quando regime da empresa nao esta cadastrado', () => {
    assert.throws(
      () => _test.resolveEmitterCrt(''),
      /Regime tributario da empresa invalido ou nao informado/
    );
    assert.throws(
      () => _test.resolveEmitterCrt('regime_inexistente'),
      /Regime tributario da empresa invalido ou nao informado/
    );
  });
});

describe('nfceEmitter itens fiscais do PDV', () => {
  test('usa items da venda quando fiscalItemsSnapshot esta vazio', () => {
    const sale = {
      fiscalItemsSnapshot: [],
      items: [
        {
          productId: '696f8c460afa280e65021e80',
          name: 'Produto 33',
          quantity: 2,
          unitPrice: 10,
        },
      ],
    };

    assert.deepEqual(_test.collectFiscalItemCandidates(sale), sale.items);
  });

  test('extrai o ObjectId valido quando productId vem composto', () => {
    const item = _test.normalizeFiscalItem({
      productId: '696f8c460afa280e65021e80:68ae259898f580f973cc506d',
      name: 'Produto 33',
      quantity: 1,
      unitPrice: 20,
    });

    assert.equal(item.productId, '696f8c460afa280e65021e80');
  });

  test('preserva valor bruto e separa desconto do item para o XML fiscal', () => {
    const item = _test.normalizeFiscalItem({
      productId: '696f8c460afa280e65021e80',
      quantity: 1,
      unitPrice: 54.9,
      totalPrice: 40,
      itemDiscountValue: 14.9,
    });

    assert.equal(item.total, 54.9);
    assert.equal(item.discount, 14.9);
    assert.equal(item.netTotal, 40);
  });

  test('distribui desconto geral em centavos sem alterar o total', () => {
    const items = [
      { total: 10, discount: 0 },
      { total: 20, discount: 0 },
      { total: 30, discount: 0 },
    ];
    const allocated = _test.allocateFiscalAmount(items, 10, 'discount');

    assert.equal(allocated.reduce((sum, value) => sum + value, 0), 10);
    assert.deepEqual(allocated, [1.67, 3.33, 5]);
  });

  test('projeta desconto e pagamento somente sobre mercadorias quando a venda tambem possui servico', () => {
    const items = [
      { itemType: 'service', total: 100, discount: 0, addition: 0 },
      { itemType: 'product', total: 49.9, discount: 0, addition: 0 },
      { itemType: 'product', total: 235.9, discount: 0, addition: 0 },
      { itemType: 'product', total: 195.9, discount: 0, addition: 0 },
      { itemType: 'product', total: 271.9, discount: 0, addition: 0 },
    ];
    const projection = _test.buildFiscalProjection({
      items,
      discount: 10,
      payments: [{ forma: '01', valor: 843.6 }],
    });

    assert.equal(projection.excludedServices, 1);
    assert.equal(projection.fiscalItems.length, 4);
    assert.equal(projection.totalProducts, 753.6);
    assert.equal(projection.discount, 8.83);
    assert.equal(projection.totalLiquido, 744.77);
    assert.deepEqual(projection.payments.map((payment) => payment.valor), [744.77]);
    assert.equal(projection.change, 0);
    assert.equal(
      projection.fiscalItems.reduce((sum, item) => sum + Math.round(item.discount * 100), 0),
      883
    );
  });

  test('preserva pagamentos e troco quando todos os itens sao mercadorias', () => {
    const payments = [{ forma: '01', valor: 20 }];
    const projection = _test.buildFiscalProjection({
      items: [{ itemType: 'product', total: 10, discount: 0, addition: 0 }],
      payments,
      change: 10,
    });

    assert.deepEqual(projection.payments, payments);
    assert.equal(projection.change, 10);
    assert.equal(projection.totalLiquido, 10);
  });

  test('servico legado com identificador e sem tipo nunca entra na NFC-e', () => {
    for (const field of ['serviceId', 'servicoId', 'servico']) {
      const items = [
        _test.normalizeFiscalItem({ [field]: '68c495aa32e7d9326182050c', quantity: 1, unitPrice: 70 }),
        _test.normalizeFiscalItem({ productId: '696f8c460afa280e65021e80', quantity: 1, unitPrice: 20 }),
      ];
      const projected = _test.buildFiscalProjection({ items, payments: [{ forma: '01', valor: 90 }] });
      assert.equal(projected.excludedServices, 1, field);
      assert.equal(projected.fiscalItems.length, 1, field);
      assert.equal(projected.totalLiquido, 20, field);
      assert.equal(projected.payments[0].valor, 20, field);
    }
  });

  test('recupera a forma de pagamento pelo movimento de caixa quando o snapshot antigo possui somente o id', () => {
    const metadata = _test.resolveSalePaymentMetadata(
      {
        paymentTags: ['Crédito'],
        cashContributions: [
          { paymentId: '68d6e9ecef99f353f564f6b2', paymentLabel: 'Crédito', amount: 843.6 },
        ],
      },
      { id: '68d6e9ecef99f353f564f6b2', valor: 843.6, parcelas: 1 },
      0
    );

    assert.deepEqual(metadata, { label: 'Crédito', code: 'Crédito' });
  });

  test('detecta XML antigo com desconto total ausente nos itens antes de enviar a SEFAZ', () => {
    const validation = _test.validateFiscalXmlTotals(`
      <NFe><infNFe><ide><tpEmis>1</tpEmis></ide>
        <det nItem="1"><prod><qCom>1.0000</qCom><vUnCom>100.0000000000</vUnCom><vProd>100.00</vProd></prod></det>
        <total><ICMSTot><vProd>100.00</vProd><vDesc>10.00</vDesc><vOutro>0.00</vOutro><vNF>90.00</vNF></ICMSTot></total>
        <pag><detPag><vPag>90.00</vPag></detPag></pag>
      </infNFe></NFe>
    `);

    assert.equal(validation.valid, false);
    assert.equal(validation.emissionType, '1');
    assert.ok(validation.issues.some((issue) => issue.startsWith('vDesc total')));
  });

  test('aceita XML cujos totais, itens e pagamentos fecham em centavos', () => {
    const validation = _test.validateFiscalXmlTotals(`
      <NFe><infNFe><ide><tpEmis>1</tpEmis></ide>
        <det nItem="1"><prod><qCom>1.0000</qCom><vUnCom>100.0000000000</vUnCom><vProd>100.00</vProd><vDesc>10.00</vDesc></prod></det>
        <total><ICMSTot><vProd>100.00</vProd><vDesc>10.00</vDesc><vOutro>0.00</vOutro><vNF>90.00</vNF></ICMSTot></total>
        <pag><detPag><vPag>90.00</vPag></detPag></pag>
      </infNFe></NFe>
    `);

    assert.deepEqual(validation, { valid: true, issues: [], emissionType: '1' });
  });

  test('resolve codigo da regra fiscal salvo no produto', () => {
    assert.equal(_test.resolveFiscalRuleCode({ fiscalRuleCode: ' 2 ' }), '2');
    assert.equal(_test.resolveFiscalRuleCode({ regraFiscalCodigo: '3' }), '3');
    assert.equal(_test.resolveFiscalRuleCode({ ruleCode: '4' }), '4');
  });

  test('bloqueia fiscal antigo sem regra vinculada no produto', async () => {
    const storeId = '68af208d8fb601d67fa31562';
    const ruleCache = new Map([[storeId, [{ code: 1, fiscal: { cst: '00', csosn: '' } }]]]);

    await assert.rejects(
      () => _test.resolveFiscalRuleForProduct({
        product: {
          _id: '691b529d97dcb439161b6d55',
          cod: '4730',
          nome: 'Produto antigo',
          fiscalPorEmpresa: {
            [storeId]: { cst: '00', csosn: '102' },
          },
        },
        storeObject: { _id: storeId },
        ruleCache,
      }),
      /nao possui regra fiscal vinculada/
    );
  });

  test('busca dados fiscais somente pela regra vinculada ao produto', async () => {
    const storeId = '68af208d8fb601d67fa31562';
    const expectedFiscal = { cst: '60', csosn: '', cfop: { nfce: { dentroEstado: '5405' } } };
    const ruleCache = new Map([[storeId, [{ code: 2, fiscal: expectedFiscal }]]]);

    const resolved = await _test.resolveFiscalRuleForProduct({
      product: {
        _id: '691b529d97dcb439161b6d55',
        cod: '4730',
        nome: 'Produto com regra',
        fiscalPorEmpresa: {
          [storeId]: { fiscalRuleCode: '2', cst: '00', csosn: '102' },
        },
      },
      storeObject: { _id: storeId },
      ruleCache,
    });

    assert.deepEqual(resolved, expectedFiscal);
  });

  test('usa SEM GTIN quando codigo de barras nao e GTIN valido', () => {
    assert.equal(_test.resolveGtinForXml('33'), 'SEM GTIN');
    assert.equal(_test.resolveGtinForXml('ABC'), 'SEM GTIN');
  });

  test('mantem GTIN valido no XML', () => {
    assert.equal(_test.resolveGtinForXml('7891910000197'), '7891910000197');
  });

  test('monta ICMS60 quando a regra fiscal usa CST 60', () => {
    const lines = [];
    _test.buildIcmsGroup({ lines, fiscalData: { origem: '0', cst: '60' }, itemTotal: 0.5 });

    assert.ok(lines.includes('          <ICMS60>'));
    assert.ok(lines.includes('            <CST>60</CST>'));
    assert.ok(lines.includes('          </ICMS60>'));
    assert.equal(lines.includes('          <ICMS00>'), false);
  });

  test('monta ICMS40 para CST sem tributacao', () => {
    const lines = [];
    _test.buildIcmsGroup({ lines, fiscalData: { origem: '0', cst: '40' }, itemTotal: 0.5 });

    assert.ok(lines.includes('          <ICMS40>'));
    assert.ok(lines.includes('            <CST>40</CST>'));
  });

  test('monta o grupo correto para todos os CST validos', () => {
    const cases = [
      ['00', 'ICMS00'],
      ['10', 'ICMS10'],
      ['20', 'ICMS20'],
      ['30', 'ICMS30'],
      ['40', 'ICMS40'],
      ['41', 'ICMS40'],
      ['50', 'ICMS40'],
      ['51', 'ICMS51'],
      ['60', 'ICMS60'],
      ['70', 'ICMS70'],
      ['90', 'ICMS90'],
    ];

    for (const [cst, group] of cases) {
      const lines = [];
      _test.buildIcmsGroup({ lines, fiscalData: { origem: '0', cst }, itemTotal: 1 });

      assert.ok(lines.includes(`          <${group}>`), `CST ${cst} deveria gerar ${group}`);
      assert.ok(lines.includes(`            <CST>${cst}</CST>`), `CST ${cst} deveria ser preservado`);
      assert.ok(lines.includes(`          </${group}>`), `CST ${cst} deveria fechar ${group}`);
    }
  });

  test('monta o grupo correto para todos os CSOSN validos', () => {
    const cases = [
      ['101', 'ICMSSN101'],
      ['102', 'ICMSSN102'],
      ['103', 'ICMSSN102'],
      ['201', 'ICMSSN201'],
      ['202', 'ICMSSN202'],
      ['203', 'ICMSSN202'],
      ['300', 'ICMSSN102'],
      ['400', 'ICMSSN102'],
      ['500', 'ICMSSN500'],
      ['900', 'ICMSSN900'],
    ];

    for (const [csosn, group] of cases) {
      const lines = [];
      _test.buildIcmsGroup({ lines, fiscalData: { origem: '0', csosn }, itemTotal: 1 });

      assert.ok(lines.includes(`          <${group}>`), `CSOSN ${csosn} deveria gerar ${group}`);
      assert.ok(lines.includes(`            <CSOSN>${csosn}</CSOSN>`), `CSOSN ${csosn} deveria ser preservado`);
      assert.ok(lines.includes(`          </${group}>`), `CSOSN ${csosn} deveria fechar ${group}`);
    }
  });

  test('bloqueia CST e CSOSN invalidos antes de enviar para SEFAZ', () => {
    assert.throws(
      () => _test.buildIcmsGroup({ lines: [], fiscalData: { cst: '99' }, itemTotal: 1 }),
      /CST 99 nao suportado/
    );
    assert.throws(
      () => _test.buildIcmsGroup({ lines: [], fiscalData: { csosn: '999' }, itemTotal: 1 }),
      /CSOSN 999 nao suportado/
    );
  });

  test('retorna base e valor de ICMS para totalizacao', () => {
    const lines = [];
    const summary = _test.buildIcmsGroup({
      lines,
      fiscalData: { origem: '0', cst: '00', icms: { aliquota: 18 } },
      itemTotal: 100,
    });

    assert.equal(summary.base, 100);
    assert.equal(summary.value, 18);
  });

  test('mantem ordem esperada do ICMS90 no schema', () => {
    const lines = [];
    _test.buildIcmsGroup({ lines, fiscalData: { origem: '0', cst: '90' }, itemTotal: 1 });

    assert.ok(lines.indexOf('            <vBC>1.00</vBC>') < lines.indexOf('            <pRedBC>0.00</pRedBC>'));
  });
});
