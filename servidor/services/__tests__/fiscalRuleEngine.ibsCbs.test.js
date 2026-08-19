const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeFiscalData, mergeFiscalData } = require('../fiscalRuleEngine');

test('normaliza e preserva a classificação IBS/CBS da regra fiscal', () => {
  const fiscal = normalizeFiscalData({
    ibsCbs: {
      cst: ' 000 ',
      cClassTrib: ' 000001 ',
      pIBSUF: '0.1',
      pIBSMun: 0,
      pCBS: '0.9',
    },
  });

  assert.deepEqual(fiscal.ibsCbs, {
    cst: '000',
    cClassTrib: '000001',
    pIBSUF: 0.1,
    pIBSMun: 0,
    pCBS: 0.9,
  });
});

test('aceita os nomes legados do bloco da reforma tributária', () => {
  const fiscal = normalizeFiscalData({
    reformaTributaria: {
      cst: '000',
      classificacaoTributaria: '000001',
      aliquotaIbsUf: 0.1,
      aliquotaIbsMunicipal: 0,
      aliquotaCbs: 0.9,
    },
  });

  assert.equal(fiscal.ibsCbs.cClassTrib, '000001');
  assert.equal(fiscal.ibsCbs.pIBSUF, 0.1);
  assert.equal(fiscal.ibsCbs.pIBSMun, 0);
  assert.equal(fiscal.ibsCbs.pCBS, 0.9);
});

test('merge fiscal não remove IBS/CBS já cadastrado', () => {
  const merged = mergeFiscalData(
    { ibsCbs: { cst: '000', cClassTrib: '000001', pIBSUF: 0.1, pIBSMun: 0, pCBS: 0.9 } },
    { origem: '0' }
  );
  assert.equal(merged.ibsCbs.cClassTrib, '000001');
});
