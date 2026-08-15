const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ensureSellerOffer,
  isAffirmativeReply,
  isDirectSellerRequest,
  isNegativeReply,
  isSellerOfferTopic,
} = require('../whatsappSellerHandoffService');

test('identifica pedidos comerciais que devem oferecer um vendedor', () => {
  assert.equal(isSellerOfferTopic('Consegue um desconto para mim?'), true);
  assert.equal(isSellerOfferTopic('Tem alguma promoção nessa ração?'), true);
  assert.equal(isSellerOfferTopic('Quero agendar um banho'), false);
  assert.match(
    ensureSellerOffer('O desconto precisa ser confirmado pela equipe.'),
    /direcionar você para um de nossos vendedores/i
  );
});

test('entende pedido direto e respostas curtas à oferta de vendedor', () => {
  assert.equal(isDirectSellerRequest('Quero falar com um vendedor'), true);
  assert.equal(isDirectSellerRequest('Pode me encaminhar para uma atendente?'), true);
  assert.equal(isDirectSellerRequest('Qual o preço desse produto?'), false);
  assert.equal(isAffirmativeReply('Sim, pode me direcionar'), true);
  assert.equal(isNegativeReply('Não precisa, obrigado'), true);
});
