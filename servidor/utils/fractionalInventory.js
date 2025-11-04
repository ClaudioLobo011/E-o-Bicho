const mongoose = require('mongoose');
const Product = require('../models/Product');

const recalculateFractionalStockForProduct = async (productId, { session } = {}) => {
    if (!productId) {
        return null;
    }

    try {
        const product = await Product.findById(productId)
            .select('fracionado unidade custo')
            .populate('fracionado.itens.produto')
            .lean({ autopopulate: false })
            .session(session);

        if (!product) {
            return null;
        }

        const fractionalConfig = product.fracionado || {};
        const fractionalItems = Array.isArray(fractionalConfig.itens) ? fractionalConfig.itens : [];
        const isActive = Boolean(fractionalConfig.ativo) && fractionalItems.length > 0;

        const now = new Date();

        if (!isActive) {
            await Product.updateOne(
                { _id: productId },
                {
                    $set: {
                        'fracionado.custoCalculado': null,
                        'fracionado.estoqueEquivalente': null,
                        'fracionado.atualizadoEm': now,
                    },
                },
                { session }
            );
            return { productId, updated: false };
        }

        const parentCostValue = Number(product.custo);
        const fractionalItemsWithProducts = fractionalItems.filter((item) => item?.produto);

        const childIds = fractionalItemsWithProducts
            .map((item) => {
                const child = item?.produto;
                if (!child) return null;
                if (child instanceof mongoose.Types.ObjectId) {
                    return child.toString();
                }
                if (typeof child === 'object' && child._id) {
                    return child._id.toString();
                }
                return null;
            })
            .filter(Boolean);

        const uniqueChildIds = Array.from(new Set(childIds));

        const childProducts = await Product.find({ _id: { $in: uniqueChildIds } })
            .select('estoques unidade custo stock')
            .lean({ autopopulate: false })
            .session(session);

        const childMap = new Map(childProducts.map((child) => [child._id.toString(), child]));

        const depositTotals = new Map();
        const missingChildren = [];

        let totalFractionQuantity = 0;
        fractionalItemsWithProducts.forEach((item) => {
            const baseQuantity = Number(item?.quantidadeOrigem);
            const fractionQuantityRaw = Number(item?.quantidadeFracionada);
            const normalizedBase = Number.isFinite(baseQuantity) && baseQuantity > 0 ? baseQuantity : 1;
            const normalizedFraction = Number.isFinite(fractionQuantityRaw) && fractionQuantityRaw > 0 ? fractionQuantityRaw : 0;
            totalFractionQuantity += normalizedFraction;

            const childRef = item?.produto;
            const childId = childRef instanceof mongoose.Types.ObjectId
                ? childRef.toString()
                : (typeof childRef === 'object' && childRef?._id ? childRef._id.toString() : null);

            if (!childId) {
                missingChildren.push({ item });
                return;
            }

            const childProduct = childMap.get(childId);
            if (!childProduct) {
                missingChildren.push({ childId, item });
                return;
            }

            const ratio = normalizedFraction > 0 && normalizedBase > 0
                ? (normalizedBase / normalizedFraction)
                : 0;

            const childStock = Array.isArray(childProduct.estoques)
                ? childProduct.estoques.reduce((sum, entry) => {
                      const quantity = Number(entry?.quantidade);
                      return sum + (Number.isFinite(quantity) ? quantity : 0);
                  }, 0)
                : 0;

            const equivalentStock = ratio > 0 && Number.isFinite(childStock)
                ? childStock * ratio
                : 0;

            if (ratio > 0 && Array.isArray(childProduct.estoques)) {
                childProduct.estoques.forEach((entry) => {
                    const deposit = entry?.deposito;
                    let depositId = null;
                    if (deposit instanceof mongoose.Types.ObjectId) {
                        depositId = deposit.toString();
                    } else if (typeof deposit === 'object' && deposit?._id) {
                        depositId = deposit._id.toString();
                    }
                    if (!depositId) return;

                    const childQuantity = Number(entry?.quantidade);
                    if (!Number.isFinite(childQuantity) || childQuantity <= 0) return;

                    const equivalentQuantity = childQuantity * ratio;
                    if (!Number.isFinite(equivalentQuantity) || equivalentQuantity <= 0) return;

                    const current = depositTotals.get(depositId) || { quantidade: 0, unidade: '', deposito: entry?.deposito };
                    const depositUnit = typeof entry?.unidade === 'string' ? entry.unidade.trim() : '';
                    const resolvedUnit = current.unidade
                        || depositUnit
                        || (typeof childProduct?.unidade === 'string' ? childProduct.unidade.trim() : '')
                        || (typeof product.unidade === 'string' ? product.unidade.trim() : '')
                        || '';

                    depositTotals.set(depositId, {
                        quantidade: current.quantidade + equivalentQuantity,
                        unidade: resolvedUnit,
                        deposito: current.deposito || entry?.deposito,
                    });
                });
            }
        });

        const costPerFraction = Number.isFinite(parentCostValue) && parentCostValue > 0
            && Number.isFinite(totalFractionQuantity) && totalFractionQuantity > 0
            ? parentCostValue / totalFractionQuantity
            : null;

        const depositEntries = Array.from(depositTotals.entries()).map(([depositId, info]) => {
            const rawQuantity = Number.isFinite(info?.quantidade) && info.quantidade > 0 ? info.quantidade : 0;
            const flooredQuantity = Math.floor(rawQuantity);
            const fractionalPart = rawQuantity - flooredQuantity;
            const unitLabel = typeof info?.unidade === 'string' && info.unidade.trim()
                ? info.unidade.trim()
                : (typeof product.unidade === 'string' ? product.unidade.trim() : '');

            return {
                depositId,
                rawQuantity,
                assignedQuantity: flooredQuantity > 0 ? flooredQuantity : 0,
                fractionalPart: fractionalPart > 0 ? fractionalPart : 0,
                unidade: unitLabel,
                deposito: info?.deposito || null,
            };
        });

        const totalRawStock = depositEntries.reduce((sum, entry) => {
            const value = Number(entry.rawQuantity);
            if (!Number.isFinite(value) || value <= 0) {
                return sum;
            }
            return sum + value;
        }, 0);

        const roundedTotalRawStock = Number.isFinite(totalRawStock) && totalRawStock > 0
            ? Math.round(totalRawStock * 1_000_000) / 1_000_000
            : 0;

        const normalizedTotalStock = Number.isFinite(totalRawStock) && totalRawStock > 0
            ? Math.floor(totalRawStock)
            : 0;

        const updateDocument = {
            'fracionado.custoCalculado': Number.isFinite(costPerFraction) ? costPerFraction : null,
            'fracionado.estoqueEquivalente': Number.isFinite(totalRawStock) ? normalizedTotalStock : null,
            'fracionado.estoqueCalculadoDetalhado': Number.isFinite(totalRawStock) ? roundedTotalRawStock : null,
            stock: normalizedTotalStock,
            'fracionado.atualizadoEm': now,
        };

        if (depositEntries.length > 0) {
            updateDocument.estoques = depositEntries
                .filter((entry) => entry.assignedQuantity > 0)
                .map((entry) => ({
                    deposito: new mongoose.Types.ObjectId(entry.depositId),
                    quantidade: entry.assignedQuantity,
                    unidade: entry.unidade || (typeof product.unidade === 'string' ? product.unidade.trim() : ''),
                }));
        } else {
            updateDocument.estoques = [];
        }

        await Product.updateOne(
            { _id: productId },
            { $set: updateDocument },
            { session }
        );

        if (missingChildren.length) {
            console.warn(
                'Alguns produtos filhos não foram encontrados ao recalcular o estoque fracionado do produto pai.',
                { productId, missingChildren }
            );
        }

        return { productId, updated: true, missingChildren };
    } catch (error) {
        console.error('Erro ao recalcular o estoque fracionado do produto.', { productId }, error);
        throw error;
    }
};

const refreshParentFractionalStocks = async (childProductId, { session } = {}) => {
    if (!childProductId) {
        return [];
    }

    try {
        const parents = await Product.find({
            'fracionado.ativo': true,
            'fracionado.itens.produto': childProductId,
        })
            .select('_id')
            .lean({ autopopulate: false })
            .session(session);

        const updates = [];
        for (const parent of parents) {
            const parentId = parent?._id ? String(parent._id) : null;
            if (!parentId) continue;
            try {
                const result = await recalculateFractionalStockForProduct(parentId, { session });
                if (result) {
                    updates.push(result);
                }
            } catch (recalcError) {
                console.error(
                    'Erro ao atualizar o estoque fracionado do produto pai vinculado.',
                    { parentId, childProductId },
                    recalcError
                );
            }
        }
        return updates;
    } catch (error) {
        console.error('Erro ao localizar produtos pais para recalcular estoques fracionados.', { childProductId }, error);
        return [];
    }
};

module.exports = {
    recalculateFractionalStockForProduct,
    refreshParentFractionalStocks,
};

