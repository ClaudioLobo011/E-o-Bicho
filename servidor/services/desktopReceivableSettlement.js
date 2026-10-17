'use strict';
const integerCents=value=>{const number=Number(value);if(!Number.isFinite(number)||number<0)throw new Error('Valor inválido no recebimento.');return Math.round((number+Number.EPSILON)*100);};
function applyPayment(document,source,eventId,isValidId){
 const processed=Array.isArray(document.metadata?.desktopPaymentEventIds)?document.metadata.desktopPaymentEventIds:[];
 if(processed.includes(eventId))return null;
 if(String(document.customer||'')!==String(source.customerId||''))throw new Error('O cliente da conta não confere com o recebimento do PDV.');
 const amount=integerCents(source.amount);if(!amount)throw new Error('Informe um recebimento maior que zero.');
 if(!isValidId(source.paymentMethodId))throw new Error('Forma de pagamento do recebimento inválida.');
 const paidAt=new Date(source.paidAt);if(Number.isNaN(paidAt.getTime()))throw new Error('Data do recebimento inválida.');
 const installments=(document.installments||[]).map(i=>({...i}));
 const target=[...installments].reverse().find(i=>String(i.status)==='pending');
 if(!target)throw new Error('A conta financeira não possui saldo em aberto para este recebimento.');
 const balance=integerCents(target.value);
 if(amount>balance)throw new Error('Recebimento do PDV supera o saldo da parcela na nuvem.');
 const remaining=(balance-amount)/100;
 target.value=amount/100;target.paidValue=amount/100;target.paidDate=paidAt;target.paymentMethod=source.paymentMethodId;target.paymentNotes=source.notes||'';target.status='received';
 if(remaining>0)installments.push({number:Math.max(...installments.map(i=>Number(i.number)||0))+1,issueDate:target.issueDate||document.issueDate,dueDate:target.dueDate,value:remaining,originalValue:remaining,paidValue:0,bankAccount:target.bankAccount||document.bankAccount,accountingAccount:target.accountingAccount||document.accountingAccount,paymentMethod:document.paymentMethod,originInstallmentNumber:Number(source.installmentNumber||1),status:'pending'});
 return {installments,installmentsCount:installments.length,totalValue:installments.reduce((s,i)=>s+integerCents(i.value),0)/100,metadata:{...(document.metadata||{}),desktopPaymentEventIds:[...processed,eventId],lastDesktopReceiptBatchId:source.batchId||'',lastDesktopReceiptAt:paidAt}};
}
async function settleDesktopReceivable({AccountReceivable,originReference,source,eventId,isValidId}){
 // Compare-and-swap prevents concurrent hosts/retries from losing a payment.
 for(let attempt=0;attempt<5;attempt++){
  const doc=await AccountReceivable.findOne({originReference}).lean();
  if(!doc)throw new Error('Conta financeira ainda não encontrada. Sincronize a venda e confira a configuração financeira do PDV.');
  const update=applyPayment(doc,source,eventId,isValidId);if(!update)return {replayed:true};
  const versionFilter=doc.__v===undefined?{__v:{$exists:false}}:{__v:doc.__v};
  const result=await AccountReceivable.updateOne({_id:doc._id,...versionFilter,'metadata.desktopPaymentEventIds':{$ne:eventId}},{$set:update,$inc:{__v:1}});
  if(result.modifiedCount===1)return {replayed:false};
 }
 throw new Error('A conta foi alterada simultaneamente. O recebimento será tentado novamente.');
}
module.exports={applyPayment,settleDesktopReceivable};
