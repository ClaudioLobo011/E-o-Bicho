const mongoose = require('mongoose');
const Product = require('../models/Product');

const FRACTION_PRECISION = 6;
const FRACTION_EPSILON = 1 / 10 ** FRACTION_PRECISION;

const buildHttpError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const toObjectIdOrNull = (value) => {
    if (!value) return null;
    if (value instanceof mongoose.Types.ObjectId) {
        return value;
    }
    if (typeof value === 'string' && isValidObjectId(value)) {
        return new mongoose.Types.ObjectId(value);
    }
    if (typeof value === 'number') {
        const stringValue = String(value);
        if (isValidObjectId(stringValue)) {
            return new mongoose.Types.ObjectId(stringValue);
        }
    }
    return null;
};

const toNullableNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const normalized = value.replace(',', '.');
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }
    if (value && typeof value.valueOf === 'function') {
        const normalized = Number(value.valueOf());
        return Number.isFinite(normalized) ? normalized : null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const roundQuantity = (value) => {
    if (!Number.isFinite(value)) return 0;
    const factor = 10 ** FRACTION_PRECISION;
    return Math.round(value * factor) / factor;
};

const computeTotalStock = (product) => {
    if (!product || !Array.isArray(product.estoques)) return 0;
    return product.estoques.reduce((sum, entry) => {
        const quantity = toNullableNumber(entry?.quantidade);
        return sum + (Number.isFinite(quantity) ? quantity : 0);
    }, 0);
};

const ensureDepositEntry = (product, depositId) => {
    const depositObjectId = toObjectIdOrNull(depositId);
    if (!depositObjectId || !product) return null;
    if (!Array.isArray(product.estoques)) {
        product.estoques = [];
    }
    const depositKey = depositObjectId.toString();
    let entry = product.estoques.find(
        (item) => item?.deposito && item.deposito.toString() === depositKey,
    );
    if (!entry) {
        entry = {
            deposito: depositObjectId,
            quantidade: 0,
            unidade: product.unidade || '',
        };
        product.estoques.push(entry);
    } else if (!entry.unidade) {
        entry.unidade = product.unidade || '';
    }
    return entry;
};

const sanitizeFractionEntries = (rawList) => {
    if (!Array.isArray(rawList)) return [];
    return rawList
        .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const productId = toObjectIdOrNull(item?.produto || item?.produtoId || item?.productId);
            const cod = typeof item?.cod === 'string' ? item.cod.trim() : '';
            const codbarras = typeof item?.codbarras === 'string' ? item.codbarras.trim() : '';
            const descricao = typeof item?.descricao === 'string' ? item.descricao.trim() : '';
            const unidade = typeof item?.unidade === 'string' ? item.unidade.trim() : '';
            const quantidade = toNullableNumber(item?.quantidade);
            const custo = toNullableNumber(item?.custo);
            const markup = toNullableNumber(item?.markup);
            const venda = toNullableNumber(item?.venda);
            const estoque = toNullableNumber(item?.estoque);

            if (!productId && !cod && !codbarras && !descricao) {
                return null;
            }

            return {
                produto: productId,
                cod,
                codbarras,
                descricao,
                quantidade,
                unidade,
                custo,
                markup,
                venda,
                estoque,
            };
        })
        .filter(Boolean);
};

const ensureFractionRelations = async ({ parentId, fractions, session, validateOnly = false } = {}) => {
    const parentObjectId = toObjectIdOrNull(parentId);
    if (!parentObjectId) return;

    const entries = Array.isArray(fractions) ? fractions : [];

    const invalidSelfLink = entries.find((entry) => {
        const childId = toObjectIdOrNull(entry?.produto);
        return childId && childId.toString() === parentObjectId.toString();
    });
    if (invalidSelfLink) {
        throw buildHttpError(400, 'Um produto não pode ser fracionado a partir de si mesmo.');
    }

    const requiredQuantityEntry = entries.find((entry) => {
        const childId = toObjectIdOrNull(entry?.produto);
        if (!childId) return false;
        const quantity = toNullableNumber(entry?.quantidade);
        return !Number.isFinite(quantity) || quantity <= 0;
    });
    if (requiredQuantityEntry) {
        throw buildHttpError(400, 'Informe uma quantidade válida para todos os produtos fracionados vinculados.');
    }

    const childIds = entries
        .map((entry) => toObjectIdOrNull(entry?.produto))
        .filter(Boolean)
        .map((id) => id.toString());

    const uniqueChildIds = [...new Set(childIds)];

    if (!uniqueChildIds.length) {
        if (validateOnly) {
            return;
        }
        const unlinkQuery = Product.updateMany(
            { fracionadoDe: parentObjectId },
            { $unset: { fracionadoDe: '' } },
        );
        if (session) unlinkQuery.session(session);
        await unlinkQuery;
        return;
    }

    const childObjectIds = uniqueChildIds.map((id) => new mongoose.Types.ObjectId(id));

    const findChildrenQuery = Product.find(
        { _id: { $in: childObjectIds } },
        { fracionadoDe: 1, nome: 1, cod: 1 },
    );
    if (session) findChildrenQuery.session(session);
    const children = await findChildrenQuery.lean();

    if (children.length !== childObjectIds.length) {
        const foundIds = new Set(children.map((child) => child._id.toString()));
        const missingIds = uniqueChildIds.filter((id) => !foundIds.has(id));
        if (missingIds.length) {
            throw buildHttpError(400, 'Alguns produtos fracionados informados não foram encontrados.');
        }
    }

    const conflictingChild = children.find((child) => {
        if (!child.fracionadoDe) return false;
        return child.fracionadoDe.toString() !== parentObjectId.toString();
    });
    if (conflictingChild) {
        const label = conflictingChild.nome || conflictingChild.cod || conflictingChild._id;
        throw buildHttpError(409, `O produto ${label} já está vinculado a outro fracionamento.`);
    }

    if (validateOnly) {
        return;
    }

    const linkQuery = Product.updateMany(
        { _id: { $in: childObjectIds } },
        { $set: { fracionadoDe: parentObjectId } },
    );
    if (session) linkQuery.session(session);
    await linkQuery;

    const unlinkQuery = Product.updateMany(
        {
            fracionadoDe: parentObjectId,
            _id: { $nin: childObjectIds },
        },
        { $unset: { fracionadoDe: '' } },
    );
    if (session) unlinkQuery.session(session);
    await unlinkQuery;
};

const setProductDepositQuantity = async ({ product, productId, depositId, quantity, session }) => {
    let doc = product;
    if (!doc) {
        const query = Product.findById(productId);
        if (session) query.session(session);
        doc = await query;
    }
    if (!doc) return null;
    const entry = ensureDepositEntry(doc, depositId);
    if (!entry) return null;
    const previous = toNullableNumber(entry.quantidade) || 0;
    const target = roundQuantity(Number(quantity) || 0);
    if (Math.abs(target - previous) <= FRACTION_EPSILON) {
        return { product: doc, previousQuantity: previous, nextQuantity: previous, changed: false };
    }
    entry.quantidade = target;
    doc.stock = roundQuantity(computeTotalStock(doc));
    doc.markModified('estoques');
    if (session) {
        await doc.save({ session });
    } else {
        await doc.save();
    }
    return { product: doc, previousQuantity: previous, nextQuantity: target, changed: true };
};

const adjustProductDepositQuantity = async ({ product, productId, depositId, delta, session }) => {
    if (!Number.isFinite(delta) || Math.abs(delta) <= FRACTION_EPSILON) {
        return { product: product || null, changed: false };
    }
    let doc = product;
    if (!doc) {
        const query = Product.findById(productId);
        if (session) query.session(session);
        doc = await query;
    }
    if (!doc) return null;
    const entry = ensureDepositEntry(doc, depositId);
    if (!entry) return null;
    const previous = toNullableNumber(entry.quantidade) || 0;
    const next = roundQuantity(previous + delta);
    if (Math.abs(next - previous) <= FRACTION_EPSILON) {
        return { product: doc, previousQuantity: previous, nextQuantity: next, changed: false };
    }
    entry.quantidade = next;
    doc.stock = roundQuantity(computeTotalStock(doc));
    doc.markModified('estoques');
    if (session) {
        await doc.save({ session });
    } else {
        await doc.save();
    }
    return { product: doc, previousQuantity: previous, nextQuantity: next, changed: true };
};

const getDepositQuantity = (product, depositId) => {
    if (!product || !depositId) return 0;
    const depositObjectId = toObjectIdOrNull(depositId);
    if (!depositObjectId) return 0;
    const depositKey = depositObjectId.toString();
    const entry = Array.isArray(product.estoques)
        ? product.estoques.find((item) => item?.deposito && item.deposito.toString() === depositKey)
        : null;
    return toNullableNumber(entry?.quantidade) || 0;
};

const syncFractionGroupForParent = async ({ parentId, session } = {}) => {
    const parentObjectId = toObjectIdOrNull(parentId);
    if (!parentObjectId) return;

    const parentQuery = Product.findById(parentObjectId);
    if (session) parentQuery.session(session);
    const parent = await parentQuery;
    if (!parent) return;

    const fractions = Array.isArray(parent.fracionamentos)
        ? parent.fracionamentos.filter((entry) => {
              const childId = toObjectIdOrNull(entry?.produto);
              const quantity = toNullableNumber(entry?.quantidade);
              return childId && Number.isFinite(quantity) && quantity > 0;
          })
        : [];

    if (!fractions.length) {
        return;
    }

    const parentDeposits = Array.isArray(parent.estoques) ? parent.estoques : [];

    await Promise.all(
        fractions.map(async (fraction) => {
            const childId = toObjectIdOrNull(fraction?.produto);
            const factor = toNullableNumber(fraction?.quantidade);
            if (!childId || !Number.isFinite(factor) || factor <= 0) return;
            const childQuery = Product.findById(childId);
            if (session) childQuery.session(session);
            const child = await childQuery;
            if (!child) return;
            let changed = false;
            if (!Array.isArray(child.estoques)) {
                child.estoques = [];
            }
            parentDeposits.forEach((parentEntry) => {
                const depositId = toObjectIdOrNull(parentEntry?.deposito);
                if (!depositId) return;
                const parentQuantity = toNullableNumber(parentEntry?.quantidade) || 0;
                const desiredQuantity = roundQuantity(parentQuantity * factor);
                const entry = ensureDepositEntry(child, depositId);
                if (!entry) return;
                const current = toNullableNumber(entry.quantidade) || 0;
                if (Math.abs(desiredQuantity - current) > FRACTION_EPSILON) {
                    entry.quantidade = desiredQuantity;
                    changed = true;
                }
            });
            const computedStock = roundQuantity(computeTotalStock(child));
            const currentStock = toNullableNumber(child.stock) || 0;
            if (!changed && Math.abs(currentStock - computedStock) > FRACTION_EPSILON) {
                child.stock = computedStock;
                changed = true;
            } else if (changed) {
                child.stock = computedStock;
            }
            if (changed) {
                child.markModified('estoques');
                if (session) {
                    await child.save({ session });
                } else {
                    await child.save();
                }
            }
        }),
    );
};

const applyFractionalStockChange = async ({
    product,
    productId,
    depositId,
    delta,
    session,
} = {}) => {
    const depositObjectId = toObjectIdOrNull(depositId);
    if (!depositObjectId) return;

    let baseProduct = product;
    if (!baseProduct) {
        const query = Product.findById(productId);
        if (session) query.session(session);
        baseProduct = await query;
    }
    if (!baseProduct) return;

    const targetProductId = baseProduct._id.toString();

    let parent = baseProduct;
    const isChildChange = Boolean(baseProduct.fracionadoDe);

    if (isChildChange) {
        const parentQuery = Product.findById(baseProduct.fracionadoDe);
        if (session) parentQuery.session(session);
        parent = await parentQuery;
    }

    if (!parent) {
        return;
    }

    const fractions = Array.isArray(parent.fracionamentos)
        ? parent.fracionamentos.filter((entry) => {
              const childId = toObjectIdOrNull(entry?.produto);
              const quantity = toNullableNumber(entry?.quantidade);
              return childId && Number.isFinite(quantity) && quantity > 0;
          })
        : [];

    if (!fractions.length) {
        return;
    }

    if (isChildChange) {
        const fraction = fractions.find(
            (entry) => entry?.produto && entry.produto.toString() === targetProductId,
        );
        if (!fraction) {
            return;
        }
        const factor = toNullableNumber(fraction?.quantidade);
        if (!Number.isFinite(factor) || factor <= 0) {
            return;
        }
        const parentQuantityBefore = getDepositQuantity(parent, depositObjectId);
        const numericDelta = Number.isFinite(delta) ? delta : 0;
        const childQuantityAfter = getDepositQuantity(baseProduct, depositObjectId);
        const previousChildQuantity = roundQuantity(childQuantityAfter - numericDelta);
        if (Number.isFinite(numericDelta) && Math.abs(numericDelta) > FRACTION_EPSILON) {
            if (numericDelta < -FRACTION_EPSILON) {
                if (parentQuantityBefore > 0) {
                    const consumption = Math.abs(numericDelta);
                    const parentUnitsToConsume = Math.min(
                        parentQuantityBefore,
                        Math.ceil(consumption / factor),
                    );
                    if (parentUnitsToConsume > 0) {
                        const parentAdjustment = await adjustProductDepositQuantity({
                            product: parent,
                            productId: parent._id,
                            depositId: depositObjectId,
                            delta: -parentUnitsToConsume,
                            session,
                        });
                        if (parentAdjustment?.product) {
                            parent = parentAdjustment.product;
                        }

                        const needsReplenish = previousChildQuantity < consumption;
                        if (needsReplenish) {
                            const replenishedQuantity = roundQuantity(
                                childQuantityAfter + parentUnitsToConsume * factor,
                            );
                            const childResult = await setProductDepositQuantity({
                                product: baseProduct,
                                productId: baseProduct._id,
                                depositId: depositObjectId,
                                quantity: replenishedQuantity,
                                session,
                            });
                            if (childResult?.product) {
                                baseProduct = childResult.product;
                            }
                        }
                    }
                }
            } else {
                const result = await adjustProductDepositQuantity({
                    product: parent,
                    productId: parent._id,
                    depositId: depositObjectId,
                    delta: numericDelta / factor,
                    session,
                });
                if (result?.product) {
                    parent = result.product;
                }
            }
        } else {
            const refreshQuery = Product.findById(parent._id);
            if (session) refreshQuery.session(session);
            parent = await refreshQuery;
        }
    } else {
        parent = baseProduct;
    }

    const parentQuantity = getDepositQuantity(parent, depositObjectId);

    await Promise.all(
        fractions.map(async (fraction) => {
            const childId = fraction?.produto ? fraction.produto.toString() : null;
            if (!childId) return;
            const factor = toNullableNumber(fraction?.quantidade);
            if (!Number.isFinite(factor) || factor <= 0) return;
            const desiredQuantity = roundQuantity(parentQuantity * factor);
            const isTargetChild = childId === targetProductId;
            let childDoc = isTargetChild ? baseProduct : null;
            if (!childDoc) {
                const childQuery = Product.findById(childId);
                if (session) childQuery.session(session);
                childDoc = await childQuery;
            }
            if (!childDoc) return;
            if (isChildChange && isTargetChild) {
                return;
            }
            await setProductDepositQuantity({
                product: childDoc,
                productId: childId,
                depositId: depositObjectId,
                quantity: desiredQuantity,
                session,
            });
        }),
    );
};

module.exports = {
    FRACTION_PRECISION,
    FRACTION_EPSILON,
    sanitizeFractionEntries,
    ensureFractionRelations,
    applyFractionalStockChange,
    syncFractionGroupForParent,
};
