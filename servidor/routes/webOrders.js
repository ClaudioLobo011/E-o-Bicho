const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRoles = require('../middlewares/authorizeRoles');
const User = require('../models/User');
const Store = require('../models/Store');
const UserAddress = require('../models/UserAddress');
const WebOrder = require('../models/WebOrder');
const Product = require('../models/Product');
const Deposit = require('../models/Deposit');
const { applyProductImageUrls } = require('../utils/productImageUrl');
const { verifyMercadoPagoPayment } = require('../services/mercadoPagoVerification');

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

function resolveBestPrice(product, quantity, isSubscribed, groupQuantities = null) {
  const basePrice = Number(product?.venda || 0);
  let bestPrice = basePrice;

  if (product?.promocao?.ativa && product?.promocao?.porcentagem > 0) {
    const promoPrice = basePrice * (1 - product.promocao.porcentagem / 100);
    if (promoPrice < bestPrice) bestPrice = promoPrice;
  }

  if (product?.promocaoCondicional?.ativa && product?.promocaoCondicional?.tipo === 'acima_de') {
    const promo = product.promocaoCondicional;
    const isGrouped = Boolean(promo?.produtosDiferentes && String(promo?.codigoGrupo || '').trim());
    const qtyForRule = isGrouped && groupQuantities
      ? Number(groupQuantities.get(`acima_de|${String(promo?.codigoGrupo || '').trim()}`) || 0)
      : quantity;
    if (qtyForRule >= promo.quantidadeMinima) {
      const conditionalPrice = basePrice * (1 - product.promocaoCondicional.descontoPorcentagem / 100);
      if (conditionalPrice < bestPrice) bestPrice = conditionalPrice;
    }
  }

  if (product?.promocaoCondicional?.ativa && product?.promocaoCondicional?.tipo === 'leve_pague') {
    const { leve, pague } = product.promocaoCondicional;
    const isGrouped = Boolean(product.promocaoCondicional?.produtosDiferentes && String(product.promocaoCondicional?.codigoGrupo || '').trim());
    const qtyForRule = isGrouped && groupQuantities
      ? Number(groupQuantities.get(`leve_pague|${String(product.promocaoCondicional?.codigoGrupo || '').trim()}`) || 0)
      : quantity;
    if (leve > 0 && qtyForRule >= leve) {
      const promoPacks = Math.floor(qtyForRule / leve);
      const paidItems = promoPacks * pague;
      const remainingItems = qtyForRule % leve;
      const totalPrice = (paidItems + remainingItems) * basePrice;
      const effective = totalPrice / qtyForRule;
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
  const conditionalGroupQuantities = new Map();
  rows.forEach((item) => {
    const product = item?.product;
    const promo = product?.promocaoCondicional;
    if (!product || !promo?.ativa || !promo?.produtosDiferentes) return;
    const groupCode = String(promo?.codigoGrupo || '').trim();
    if (!groupCode) return;
    const qty = Math.max(0, Math.trunc(Number(item?.quantity || 0)));
    if (!qty) return;
    const key = `${String(promo?.tipo || '')}|${groupCode}`;
    conditionalGroupQuantities.set(key, (conditionalGroupQuantities.get(key) || 0) + qty);
  });

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
    const unitPrice = resolveBestPrice(product, quantity, Boolean(item?.isSubscribed), conditionalGroupQuantities);
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
    const gateway = sanitizeString(paymentPayload?.gateway || 'mercadopago').toLowerCase();
    const localTestPayment =
      gateway === 'local'
      && process.env.NODE_ENV !== 'production'
      && String(process.env.ALLOW_LOCAL_TEST_PAYMENTS || '').toLowerCase() === 'true';
    let verifiedPayment = null;
    if (localTestPayment) {
      verifiedPayment = {
        id: paymentId || `local-${crypto.randomUUID()}`,
        status: 'approved',
        status_detail: 'local-test',
        transaction_amount: totals.total,
        payment_type_id: normalizePaymentMethod(paymentPayload?.method),
      };
    } else {
      if (!paymentId) {
        return res.status(400).json({ message: 'Identificador de pagamento obrigatorio.' });
      }
      const verification = await verifyMercadoPagoPayment({
        paymentId,
        expectedAmount: totals.total,
        externalReference: sanitizeString(req.body?.externalReference || ''),
      });
      if (!verification.ok) {
        return res.status(402).json({
          message: 'Pagamento nao confirmado pelo provedor.',
          code: verification.reason,
        });
      }
      verifiedPayment = verification.payment;
    }

    const orderCode = buildOrderCode();
    const orderNumber = Date.now() + Math.floor(Math.random() * 1000);

    const createOrderAndReserve = async () => {
      const deposit = await Deposit.findOne({ empresa: store._id }).sort({ createdAt: 1 });
      if (!deposit) {
        const error = new Error('Nenhum deposito configurado para a loja.');
        error.statusCode = 409;
        throw error;
      }
      const order = await WebOrder.create({
      number: orderNumber,
      code: orderCode,
      origin: 'ECOMMERCE',
      status: 'PAGO_RESERVADO',
      store: {
        id: store._id,
        name: sanitizeString(store?.nome || store?.nomeFantasia || store?.razaoSocial || ''),
      },
      customer: resolveCustomerSnapshot(user, addressSnapshot),
      payment: {
        method: normalizePaymentMethod(verifiedPayment?.payment_type_id || paymentPayload?.method),
        status: sanitizeString(verifiedPayment?.status || 'approved'),
        statusDetail: sanitizeString(verifiedPayment?.status_detail),
        id: sanitizeString(verifiedPayment?.id || paymentId),
        orderId: sanitizeString(verifiedPayment?.order?.id || paymentPayload?.orderId),
        amount: Number(verifiedPayment?.transaction_amount || totals.total || 0),
        fees: Number(verifiedPayment?.fee_details?.reduce?.((sum, row) => sum + Number(row?.amount || 0), 0) || 0),
        gateway,
        confirmedAt: new Date(),
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
      inventoryReservation: {
        depositId: deposit._id,
        status: 'reserved',
        reservedAt: new Date(),
      },
      history: [
        {
          date: new Date(),
          user: sanitizeString(user?.email || 'Sistema'),
          description: 'Pedido criado e pagamento confirmado.',
        },
      ],
      });
      for (const item of cartSnapshot.items) {
        const quantity = Number(item?.quantity || 0);
        if (!item?.productId || !Number.isFinite(quantity) || quantity <= 0) continue;
        const updated = await Product.updateOne(
          {
            _id: item.productId,
            estoques: {
              $elemMatch: {
                deposito: deposit._id,
                quantidade: { $gte: quantity },
              },
            },
          },
          {
            $inc: { 'estoques.$.quantidade': -quantity },
            $set: { updatedAt: new Date() },
          }
        );
        if (Number(updated?.modifiedCount || 0) !== 1) {
          const error = new Error(`Estoque insuficiente para o produto ${item.productId}.`);
          error.statusCode = 409;
          throw error;
        }
      }
      return order;
    };
    const transactionsEnabled =
      String(process.env.MONGO_TRANSACTIONS_ENABLED || 'true').toLowerCase() !== 'false'
      && typeof mongoose.connection?.transaction === 'function';
    if (!transactionsEnabled) {
      const error = new Error('Pedidos online exigem transacoes MongoDB habilitadas.');
      error.statusCode = 503;
      throw error;
    }
    const order = await mongoose.connection.transaction(createOrderAndReserve);

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
    return res.status(Number(error?.statusCode || 500)).json({
      message: error?.message || 'Erro ao criar pedido.',
    });
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
