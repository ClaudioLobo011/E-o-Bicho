// A heterogeneous kit requires every component in the SAME deposit.
function calculateKitDepositBalances(items, childMap, parentUnit = 'UN') {
    const requirements = new Map();
    const idOf = value => String(value?._id || value || '');
    for (const item of items) {
        const id = idOf(item.produto);
        const base = Number(item.quantidadeOrigem), count = Number(item.quantidadeFracionada);
        if (!id || !(base > 0) || !(count > 0)) return new Map();
        requirements.set(id, (requirements.get(id) || 0) + count / base);
    }
    if (!requirements.size) return new Map();
    const deposits = new Map();
    for (const [id] of requirements) {
        for (const entry of childMap.get(id)?.estoques || []) {
            const depositId = idOf(entry.deposito);
            if (!depositId) continue;
            if (!deposits.has(depositId)) deposits.set(depositId, { deposito: entry.deposito, quantities: new Map() });
            const row = deposits.get(depositId);
            const quantity = Number(entry.quantidade);
            row.quantities.set(id, (row.quantities.get(id) || 0) + (Number.isFinite(quantity) ? quantity : 0));
        }
    }
    return new Map([...deposits].map(([id, row]) => [id, {
        deposito: row.deposito,
        unidade: parentUnit,
        quantidade: Math.max(0, Math.min(...[...requirements].map(([childId, required]) => (row.quantities.get(childId) || 0) / required))),
    }]));
}
module.exports = { calculateKitDepositBalances };
