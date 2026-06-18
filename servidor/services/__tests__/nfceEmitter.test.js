const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../nfceEmitter');

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
