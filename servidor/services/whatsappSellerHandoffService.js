const clean = (value) => (typeof value === 'string' ? value.trim() : '');

const normalize = (value) => clean(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const SELLER_OFFER_MESSAGE = 'Se quiser, também posso direcionar você para um de nossos vendedores.';
const SELLER_HANDOFF_MESSAGE = [
  '🏷️ *VENDEDOR SOLICITADO*',
  'Pronto! Sinalizei esta conversa para nossa equipe de vendas. Um de nossos vendedores continuará o atendimento por aqui.',
].join('\n');

const isSellerOfferTopic = (message) => {
  const text = normalize(message);
  return Boolean(text) && /\b(desconto|promocao|oferta|negociar|negociacao|melhor preco|menor preco|abaixar|baixar o preco|fechar (?:o )?pedido|finalizar (?:o )?pedido)\b/.test(text);
};

const isDirectSellerRequest = (message) => {
  const text = normalize(message);
  if (!text || !/\b(vendedor|vendedora|atendente|pessoa|humano|equipe de vendas)\b/.test(text)) {
    return false;
  }
  return /\b(quero|gostaria|preciso|pode|consegue|falar|chamar|direcionar|encaminhar|transferir|passar)\b/.test(text);
};

const isAffirmativeReply = (message) => {
  const text = normalize(message);
  return /^(sim|pode|pode sim|quero|quero sim|claro|por favor|ok|certo|beleza|manda|direciona|encaminha|transfere)(?:\b|$)/.test(text);
};

const isNegativeReply = (message) => {
  const text = normalize(message);
  return /^(nao|nao precisa|agora nao|deixa|obrigad[oa]|so isso|somente isso)(?:\b|$)/.test(text);
};

const ensureSellerOffer = (reply) => {
  const text = clean(reply);
  if (!text) return SELLER_OFFER_MESSAGE;
  const normalizedReply = normalize(text);
  if (/direcionar.+vendedor|encaminhar.+vendedor|falar.+vendedor/.test(normalizedReply)) {
    return text;
  }
  return `${text}\n\n${SELLER_OFFER_MESSAGE}`;
};

module.exports = {
  SELLER_HANDOFF_MESSAGE,
  SELLER_OFFER_MESSAGE,
  ensureSellerOffer,
  isAffirmativeReply,
  isDirectSellerRequest,
  isNegativeReply,
  isSellerOfferTopic,
};
