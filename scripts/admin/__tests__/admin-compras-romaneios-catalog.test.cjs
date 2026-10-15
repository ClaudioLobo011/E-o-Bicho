const {test}=require('node:test');
const assert=require('node:assert/strict');
const {catalogIssues}=require('../admin-compras-romaneios.js');
test('cadastro inativo pode estar vinculado mas continua pendente para conclusão',()=>{
  const index=new Map([['active',{inativo:false}],['pending',{inativo:true}]]);
  assert.deepEqual(catalogIssues({productId:'pending',reviewed:true,conversionConfirmed:true},index),['Cadastro inativo']);
  assert.deepEqual(catalogIssues({productId:'active'},index),[]);
  assert.deepEqual(catalogIssues({productId:'removed'},index),['Cadastro não encontrado']);
  assert.deepEqual(catalogIssues({productId:'pending'},null),['Verificando cadastro']);
  assert.deepEqual(catalogIssues({productId:null},null),[]);
});
test('kit fica pendente se uma peça vinculada estiver inativa',()=>{
  const index=new Map([['a',{inativo:false}],['b',{inativo:true}]]);
  const line={kit:{components:[{productId:'a'},{productId:'b'},{productId:'b'}]}};
  assert.deepEqual(catalogIssues(line,index),['Cadastro inativo']);
  index.set('b',{inativo:false});
  assert.deepEqual(catalogIssues(line,index),[]);
});
