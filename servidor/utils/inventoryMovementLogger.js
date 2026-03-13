const mongoose = require('mongoose');
const InventoryMovementLog = require('../models/InventoryMovementLog');

const toObjectIdOrNull = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'object' && value._id) return toObjectIdOrNull(value._id);
  const normalized = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeOperation = (value, quantityDelta) => {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === 'entrada' || normalized === 'saida' || normalized === 'ajuste') {
    return normalized;
  }
  const delta = normalizeNumber(quantityDelta, 0);
  if (delta > 0) return 'entrada';
  if (delta < 0) return 'saida';
  return 'ajuste';
};

const resolveValueDirection = (value) => {
  const numeric = normalizeNumber(value, 0);
  if (numeric > 0) return 'adicionado';
  if (numeric < 0) return 'retirado';
  return 'neutro';
};

const logInventoryMovement = async (payload = {}) => {
  try {
    const quantityDelta = normalizeNumber(payload.quantityDelta, 0);
    const previousStock = normalizeNumber(payload.previousStock, 0);
    const currentStock = normalizeNumber(payload.currentStock, 0);
    const operation = normalizeOperation(payload.operation, quantityDelta);
    const unitCostNumber = Number(payload.unitCost);
    const unitCost = Number.isFinite(unitCostNumber) ? unitCostNumber : null;
    const providedTotal = Number(payload.totalValueDelta);
    const totalValueDelta = Number.isFinite(providedTotal)
      ? providedTotal
      : (Number.isFinite(unitCost) ? quantityDelta * unitCost : null);

    const doc = {
      movementDate: payload.movementDate ? new Date(payload.movementDate) : new Date(),
      company: toObjectIdOrNull(payload.companyId),
      product: toObjectIdOrNull(payload.productId),
      productCode: normalizeString(payload.productCode),
      productName: normalizeString(payload.productName),
      deposit: toObjectIdOrNull(payload.depositId),
      fromDeposit: toObjectIdOrNull(payload.fromDepositId),
      toDeposit: toObjectIdOrNull(payload.toDepositId),
      operation,
      previousStock,
      quantityDelta,
      currentStock,
      unitCost,
      totalValueDelta: Number.isFinite(totalValueDelta) ? totalValueDelta : null,
      valueDirection: resolveValueDirection(totalValueDelta),
      sourceModule: normalizeString(payload.sourceModule),
      sourceScreen: normalizeString(payload.sourceScreen),
      sourceAction: normalizeString(payload.sourceAction),
      sourceType: normalizeString(payload.sourceType),
      referenceDocument: normalizeString(payload.referenceDocument),
      notes: normalizeString(payload.notes),
      user: toObjectIdOrNull(payload.userId),
      userName: normalizeString(payload.userName),
      userEmail: normalizeString(payload.userEmail),
      metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : null,
    };

    if (!doc.product) {
      return null;
    }

    const session = payload.session || undefined;
    const created = await InventoryMovementLog.create([doc], session ? { session } : undefined);
    return Array.isArray(created) ? created[0] : null;
  } catch (error) {
    console.error('Falha ao registrar histórico de movimentação de estoque:', error);
    return null;
  }
};

module.exports = {
  logInventoryMovement,
};
