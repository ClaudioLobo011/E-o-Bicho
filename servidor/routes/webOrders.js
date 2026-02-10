const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const User = require('../models/User');
const Store = require('../models/Store');
const UserAddress = require('../models/UserAddress');
const WebOrder = require('../models/WebOrder');
const { applyProductImageUrls } = require('../utils/productImageUrl');

const router = express.Router();

const ADMIN_ROLES = ['admin', 'admin_master', 'funcionario'];

const sanitizeString = (value) => (typeof value === 'string' ? value.trim() : '');

function buildOrderCode() {
  const stamp = Date.now();
  const random = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `WEB-${stamp}-${random}`;
}

function normalizePaymentMethod(method) {
  const normalized = sanitizeString(method).toLowerCase();
  if (['card', 'credit_card', 'debit_card'].includes(normalized)) return 'card';
  if (normalized === 'pix') return 'pix';
  if (normalized === 'boleto') return 'boleto';
  return normalized || 'card';
}

function resolveCustomerSnapshot(user, address) {
  const name = sanitizeString(user?.nomeCompleto || user?.razaoSocial || user?.nomeFantasia || user?.nomeContato || '');
  const document = sanitizeString(user?.cpf || user?.cnpj || '');
  const phone = sanitizeString(user?.celular || user?.telefone || user?.celularSecundario || user?.telefoneSecundario || '');
  const type = user?.tipoConta === 'pessoa_juridica' ? 'juridica' : 'fisica';
  const email = sanitizeString(user?.email || '');

  return {
    id: user?._id || null,
    name,
    document,
    phone,
    email,
    type,
    address: address || {},
  };
}

function resolveAddressSnapshot(address) {
  if (!address) return {};
  return {
    id: address?._id || null,
    cep: sanitizeString(address?.cep),
    logradouro: sanitizeString(address?.logradouro),
    numero: sanitizeString(address?.numero),
    complemento: sanitizeString(address?.complemento),
    bairro: sanitizeString(address?.bairro),
    cidade: sanitizeString(address?.cidade),
    uf: sanitizeString(address?.uf),
    pais: sanitizeString(address?.pais || 'Brasil'),
  };
}

function resolveBestPrice(product, quantity, isSubscribed) {
  const basePrice = Number(product?.venda || 0);
  let bestPrice = basePrice;

  if (product?.promocao?.ativa && product?.promocao?.porcentagem > 0) {
    const promoPrice = basePrice * (1 - product.promocao.porcentagem / 100);
    if (promoPrice < bestPrice) bestPrice = promoPrice;
  }

  if (product?.promocaoCondicional?.ativa && product?.promocaoCondicional?.tipo === 'acima_de') {
    if (quantity >= product.promocaoCondicional.quantidadeMinima) {
      const conditionalPrice = basePrice * (1 - product.promocaoCondicional.descontoPorcentagem / 100);
      if (conditionalPrice < bestPrice) bestPrice = conditionalPrice;
    }
  }

  if (product?.promocaoCondicional?.ativa && product?.promocaoCondicional?.tipo === 'leve_pague') {
    const { leve, pague } = product.promocaoCondicional;
    if (leve > 0 && quantity >= leve) {
      const promoPacks = Math.floor(quantity / leve);
      const paidItems = promoPacks * pague;
      const remainingItems = quantity % leve;
      const totalPrice = (paidItems + remainingItems) * basePrice;
      const effective = totalPrice / quantity;
      if (effective < bestPrice) bestPrice = effective;
    }
  }

  if (isSubscribed && product?.precoClube && product.precoClube > 0) {
    if (product.precoClube < bestPrice) bestPrice = product.precoClube;
  }

  return bestPrice;
}

function buildCartSnapshot(cartItems) {
  const rows = Array.isArray(cartItems) ? cartItems : [];
  const items = [];
  let subtotal = 0;
  let total = 0;

  rows.forEach((item) => {
    const product = item?.product;
    if (!product) return;
    applyProductImageUrls(product);
    const quantity = Number(item?.quantity || 0);
    if (quantity <= 0) return;
    const unitBase = Number(product?.venda || 0);
    const unitPrice = resolveBestPrice(product, quantity, Boolean(item?.isSubscribed));
    const discount = Math.max(0, unitBase - unitPrice);
    const lineTotal = unitPrice * quantity;
    subtotal += unitBase * quantity;
    total += lineTotal;

    const image = sanitizeString(product?.imagemPrincipal || product?.imagens?.[0] || '');
    items.push({
      productId: product?._id || null,
      sku: sanitizeString(product?.cod || ''),
      name: sanitizeString(product?.nome || ''),
      quantity,
      unitPrice,
      discount,
      total: lineTotal,
      imageUrl: image,
    });
  });

  const discounts = subtotal - total;
  return { items, subtotal, total, discounts };
}

router.post('/web', requireAuth, async (req, res) => {
  try {
    const storeId = sanitizeString(req.body?.storeId || req.query?.storeId);
    if (!mongoose.Types.ObjectId.isValid(storeId)) {
      return res.status(400).json({ message: 'Loja invalida.' });
    }

    const store = await Store.findById(storeId).select('nome nomeFantasia razaoSocial');
    if (!store) {
      return res.status(404).json({ message: 'Loja nao encontrada.' });
    }

    const user = await User.findById(req.user.id).populate('cart.product');
    if (!user) {
      return res.status(404).json({ message: 'Usuario nao encontrado.' });
    }

    const paymentPayload = req.body?.payment && typeof req.body.payment === 'object' ? req.body.payment : {};
    const paymentId = sanitizeString(paymentPayload?.id || '');
    const existing = paymentId ? await WebOrder.findOne({ 'payment.id': paymentId }) : null;
    if (existing) {
      return res.json({ orderId: existing._id, code: existing.code, status: existing.status });
    }

    let addressSnapshot = resolveAddressSnapshot(req.body?.address);
    const addressId = sanitizeString(req.body?.addressId || addressSnapshot?.id);
    if (addressId && mongoose.Types.ObjectId.isValid(addressId)) {
      const addressDoc = await UserAddress.findOne({ _id: addressId, user: user._id });
      if (addressDoc) {
        addressSnapshot = resolveAddressSnapshot(addressDoc);
      }
    }

    const cartSnapshot = buildCartSnapshot(user.cart || []);
    if (!cartSnapshot.items.length) {
      return res.status(400).json({ message: 'Carrinho vazio.' });
    }

    const deliveryPayload = req.body?.delivery && typeof req.body.delivery === 'object' ? req.body.delivery : {};
    const deliveryCost = Number(deliveryPayload?.cost || 0);
    const deliveryType = sanitizeString(deliveryPayload?.type || '');

    const totals = {
      subtotal: cartSnapshot.subtotal,
      discounts: cartSnapshot.discounts,
      deliveryCost: Number.isFinite(deliveryCost) ? deliveryCost : 0,
      total: cartSnapshot.total + (Number.isFinite(deliveryCost) ? deliveryCost : 0),
    };

    const orderCode = buildOrderCode();
    const orderNumber = Date.now() + Math.floor(Math.random() * 1000);

    const order = await WebOrder.create({
      number: orderNumber,
      code: orderCode,
      origin: 'ECOMMERCE',
      status: sanitizeString(req.body?.status || 'PAGO'),
      store: {
        id: store._id,
        name: sanitizeString(store?.nome || store?.nomeFantasia || store?.razaoSocial || ''),
      },
      customer: resolveCustomerSnapshot(user, addressSnapshot),
      payment: {
        method: normalizePaymentMethod(paymentPayload?.method),
        status: sanitizeString(paymentPayload?.status),
        statusDetail: sanitizeString(paymentPayload?.statusDetail),
        id: paymentId,
        orderId: sanitizeString(paymentPayload?.orderId),
        amount: Number(paymentPayload?.amount || totals.total || 0),
        fees: Number(paymentPayload?.fees || 0),
        gateway: sanitizeString(paymentPayload?.gateway || 'mercadopago'),
        confirmedAt: paymentPayload?.confirmedAt ? new Date(paymentPayload.confirmedAt) : new Date(),
      },
      fiscal: {
        status: 'pendente',
      },
      delivery: {
        type: deliveryType,
        cost: Number.isFinite(deliveryCost) ? deliveryCost : 0,
      },
      totals,
      total: totals.total,
      items: cartSnapshot.items,
      notes: sanitizeString(req.body?.notes),
      externalReference: sanitizeString(req.body?.externalReference || paymentId),
      history: [
        {
          date: new Date(),
          user: sanitizeString(user?.email || 'Sistema'),
          description: 'Pedido criado e pagamento confirmado.',
        },
      ],
    });

    const io = req.app?.get('socketio');
    if (io) {
      io.emit('web-orders:new', {
        orderId: order._id,
        code: order.code,
        status: order.status,
        storeId: order.store?.id,
        origin: order.origin,
      });
    }

    return res.json({ orderId: order._id, code: order.code, status: order.status });
  } catch (error) {
    console.error('web-orders:create', error);
    return res.status(500).json({ message: 'Erro ao criar pedido.' });
  }
});

router.get('/web', requireAuth, authorizeRoles(...ADMIN_ROLES), async (req, res) => {
  try {
    const andFilters = [{ origin: 'ECOMMERCE' }];

    const storeId = sanitizeString(req.query.storeId || req.query.store || req.query.empresa);
    if (storeId && mongoose.Types.ObjectId.isValid(storeId)) {
      andFilters.push({ 'store.id': new mongoose.Types.ObjectId(storeId) });
    }

    const orderStatus = sanitizeString(req.query.orderStatus || req.query.status);
    if (orderStatus) andFilters.push({ status: orderStatus });

    const paymentStatus = sanitizeString(req.query.paymentStatus);
    if (paymentStatus) andFilters.push({ 'payment.status': paymentStatus });

    const paymentMethod = sanitizeString(req.query.paymentMethod);
    if (paymentMethod) andFilters.push({ 'payment.method': normalizePaymentMethod(paymentMethod) });

    const deliveryType = sanitizeString(req.query.deliveryType);
    if (deliveryType) andFilters.push({ 'delivery.type': deliveryType });

    const startDate = sanitizeString(req.query.startDate);
    const endDate = sanitizeString(req.query.endDate);
    if (startDate || endDate) {
      const range = {};
      if (startDate) range.$gte = new Date(`${startDate}T00:00:00.000Z`);
      if (endDate) range.$lte = new Date(`${endDate}T23:59:59.999Z`);
      andFilters.push({ createdAt: range });
    }

    const customer = sanitizeString(req.query.customer);
    if (customer) {
      const regex = new RegExp(customer, 'i');
      andFilters.push({
        $or: [
          { 'customer.name': regex },
          { 'customer.document': regex },
          { 'customer.phone': regex },
          { 'customer.email': regex },
        ],
      });
    }

    const orderNumber = sanitizeString(req.query.orderNumber || req.query.number);
    if (orderNumber) {
      const regex = new RegExp(orderNumber, 'i');
      const numeric = Number(orderNumber);
      const orFilters = [
        { code: regex },
        { externalReference: regex },
      ];
      if (Number.isFinite(numeric)) {
        orFilters.push({ number: numeric });
      }
      andFilters.push({ $or: orFilters });
    }

    const invoiceNumber = sanitizeString(req.query.invoiceNumber);
    if (invoiceNumber) {
      const regex = new RegExp(invoiceNumber, 'i');
      andFilters.push({ $or: [{ 'fiscal.number': regex }, { 'fiscal.key': regex }] });
    }

    const query = andFilters.length > 1 ? { $and: andFilters } : andFilters[0];
    const orders = await WebOrder.find(query).sort({ createdAt: -1 }).lean();
    return res.json({ orders });
  } catch (error) {
    console.error('web-orders:list', error);
    return res.status(500).json({ message: 'Erro ao consultar pedidos.' });
  }
});

router.get('/my', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const orders = await WebOrder.find({ 'customer.id': userId }).sort({ createdAt: -1 }).lean();
    return res.json({ orders });
  } catch (error) {
    console.error('web-orders:my', error);
    return res.status(500).json({ message: 'Erro ao consultar pedidos.' });
  }
});

module.exports = router;
