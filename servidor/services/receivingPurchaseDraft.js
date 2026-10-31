const clone = value => JSON.parse(JSON.stringify(value));
const round = value => Math.round(value * 1e6) / 1e6;

// Only builds an unapproved purchase receipt. Never changes catalog or inventory.
function buildReceivingPurchaseDraft(receipt, supplier, products, code, userId, now = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const items = receipt.lines.filter(line => line.receivedQuantity > 0).map((line, index) => {
    const product = products.get(String(line.productId));
    const quantity = line.receivedQuantity, conversion = line.stockFactor;
    const total = round(quantity * line.unitCost);
    return {
      index, nItem: String(index + 1), supplierCode: line.supplierCode,
      description: product.nome || line.description, unit: line.unit, quantity,
      unitPrice: line.unitCost, total, discount: 0, freight: 0, insurance: 0, other: 0,
      unitTrib: product.unidade || 'UN', qTrib: round(quantity * conversion),
      conversion, conversionMultiplier: conversion, conversionDivider: 1,
      originalConversionFactor: conversion, entryStockQuantity: round(quantity * conversion),
      unitCostWithTaxes: round(line.unitCost / conversion),
      ean: line.barcode, eanTrib: product.codbarras || line.barcode,
      barcodeDisplay: line.barcode, barcodeCandidates: line.barcode ? [line.barcode] : [],
      validationStatus: 'matched', matchedProduct: clone(product),
      sourceReceivingLineId: line.id,
    };
  });
  const total = Math.round(items.reduce((sum, item) => sum + item.total, 0) * 100) / 100;
  const header = { code: String(code).padStart(4, '0'), number: String(code), type: 'RECIBO', model: '', serie: '', entryType: 'revenda', issueDate: date, entryDate: date };
  const selection = { companyId: String(receipt.companyId), depositId: String(receipt.depositId), supplierId: String(receipt.supplierId) };
  const supplierData = { id: String(supplier._id), name: supplier.legalName || supplier.fantasyName, document: supplier.cnpj || '' };
  const totals = { products: total, totalValue: total };
  const additionalInfo = { observation: `Gerado do romaneio ${receipt.code}. Referência: ${receipt.reference || 'não informada'}. ${receipt.notes || ''}`.trim() };
  const metadata = { sourceReceivingReceiptId: String(receipt._id), sourceReceivingCode: receipt.code, sourceReceivingVersion: receipt.version, generatedBy: String(userId), generatedAt: now.toISOString() };
  const payload = { header, selection, supplier: supplierData, totals, items, additionalInfo, metadata, xml: {}, duplicates: [], payments: [], references: [], importedData: {} };
  return { code, status: 'draft', sourceReceivingReceiptId: receipt._id, header, ...selection, supplierName: supplierData.name, supplierDocument: supplierData.document, totals, items, additionalInfo, metadata, selection, payload };
}
module.exports = { buildReceivingPurchaseDraft };
