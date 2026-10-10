const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname,'../../../scripts/funcionarios/banhoetosa/profissionais.js'),'utf8');
test('atualizar quadro em segundo plano não sobrescreve o formulário aberto', async () => {
  const state={selectedStoreId:'company',profissionais:[{_id:'old'}]};
  const ctx=vm.createContext({state,buildProfissionaisEndpoint:()=>'/professionals',api:async()=>({ok:true,json:async()=>[]}),normalizeProfissionais:x=>x,els:{profSelect:{value:'old',innerHTML:'preservar'}},modalProfissionais:[{_id:'old'}]});
  vm.runInContext(source.slice(source.indexOf('export async function loadProfissionais('),source.indexOf('export function getModalProfissionaisList(')).replace('export async','async'),ctx);
  await ctx.loadProfissionais({refreshModal:false});
  assert.equal(state.profissionais.length,0);
  assert.equal(ctx.els.profSelect.innerHTML,'preservar');
  assert.equal(ctx.modalProfissionais.length,1);
  ctx.api=async()=>({ok:false});
  await assert.rejects(ctx.loadProfissionais({refreshModal:false}),/Não foi possível/);
});
