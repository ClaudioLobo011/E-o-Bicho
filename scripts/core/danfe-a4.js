/* Shared, measured A4 pagination. Loaded only by the NF-e print window. */
(function () {
  'use strict';
  const VERSION = '2026-10-16-a4-v1';
  const CSS = `
    @page { size: A4 portrait; margin: 7mm; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 7pt; line-height: 1.2; }
    * { box-sizing: border-box; }
    .a4-page { width: 196mm; height: 282mm; display: flex; flex-direction: column;
      break-after: page; page-break-after: always; }
    .a4-page:last-child { break-after: auto; page-break-after: auto; }
    .a4-header, .a4-footer { flex: none; }
    .a4-flow { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .a4-flow > * { flex-shrink: 0; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    td, th { padding: 2px 3px; overflow-wrap: anywhere; }
    .block { margin: 0 0 1mm; }
    .items { font-size: 7pt; margin: 0; }
    .items td, .items th { border: 1px solid #000; }
    .items th { height: 7mm; font-size: 6pt; vertical-align: middle; }
    .items td { padding: 1mm .6mm; }
    .items .num, .items td.center, .items .right { font-size: 6.4pt; }
    .items td { white-space: normal !important; overflow: visible !important; text-overflow: clip !important; }
    .items .num, .items .right { white-space: nowrap !important; }
    .a4-fill { flex: 1; min-height: 0; border: 0; position: relative; }
    .a4-fill table { position: absolute; inset: 0; height: 100%; }
    .a4-fill td { border: 1px solid #000; border-top: 0; padding: 0; }
    .a4-footer { height: 21mm; }
    .a4-footer table { margin: 0; }
    .a4-footer td { font-size: 7pt; white-space: pre-wrap; }
    .a4-footer .section-title { font-size: 6pt; white-space: normal; }
    .a4-footer-compact { height: 6mm; border: 1px solid #000; padding: 1mm; font-size: 6.5pt; }
    .a4-footer table { height: 100%; }
    .a4-footer tr:first-child { height: 4mm; }
    .a4-footer td { vertical-align: top; }
    .a4-header svg { display: block; max-width: 100%; height: 13mm; }
    .barcode-box { min-width: 0; }
    .a4-section { border: 1px solid #000; padding: .6mm; background: #f5f5f5;
      font-size: 6.5pt; font-weight: bold; }
    .a4-page-number { font-size: 7pt; font-weight: bold; }
    .danfe-folha { min-height: 3.5mm; }
    @media screen { body { background: #ddd; } .a4-page { background: white; margin: 7mm auto;
      box-shadow: 0 0 3px #777; } }
  `;

  function paginate(doc = document) {
    if (doc.body.dataset.a4Ready === VERSION) return;
    const full = doc.querySelector('.danfe-page-first');
    const source = full || doc.body;
    const items = source.querySelector('table.items');
    if (!items) throw new Error('Tabela de produtos não encontrada.');
    const rows = Array.from(doc.querySelectorAll('table.items > tbody > tr'));
    const columns = items.querySelectorAll('col').length;
    const descIndex = full ? 2 : 1;
    const footerSource = items.nextElementSibling;
    const headerSource = full ? source.querySelector('.danfe-box').closest('table') : source.firstElementChild;
    const headerTemplate = headerSource.cloneNode(true);
    const before = [];
    for (let el = source.firstElementChild; el && el !== items; el = el.nextElementSibling) {
      before.push(el.cloneNode(true));
    }
    const tableTemplate = items.cloneNode(true);
    tableTemplate.tBodies[0].replaceChildren();
    const footerTemplate = footerSource?.cloneNode(true);
    let notes = full ? (footerTemplate?.rows[1]?.cells[0]?.textContent || '') : '';
    const style = doc.createElement('style'); style.textContent = CSS; doc.head.append(style);
    const root = doc.createElement('main'); root.className = 'a4-document';
    doc.body.replaceChildren(root);
    const pages = [];
    let current;
    const bottom = (el) => el.getBoundingClientRect().bottom;
    const fits = (el, flow) => bottom(el) <= bottom(flow) - 1;

    // Find the largest exact text prefix that fits; do not discard whitespace or content.
    function fitText(cell, value, test) {
      let low = 0, high = value.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        cell.textContent = value.slice(0, mid);
        if (test()) low = mid; else high = mid - 1;
      }
      if (low < value.length) {
        const word = value.lastIndexOf(' ', low);
        if (word > low * .7) low = word + 1;
      }
      cell.textContent = value.slice(0, low);
      return low;
    }

    function newPage(first = false, notesOnly = false) {
      const page = doc.createElement('section'); page.className = 'a4-page';
      const header = doc.createElement('div'); header.className = 'a4-header';
      if (first) {
        const headerIndex = before.findIndex(el => el.querySelector('.danfe-box'));
        header.append(...before.splice(0, full ? headerIndex + 1 : 1));
      } else header.append(headerTemplate.cloneNode(true));
      if (!header.querySelector('.danfe-folha')) {
        const n = doc.createElement('div'); n.className = 'danfe-folha'; header.append(n);
      }
      const flow = doc.createElement('div'); flow.className = 'a4-flow';
      const footer = doc.createElement('div'); footer.className = 'a4-footer';
      if (notesOnly) footer.style.height = '210mm';
      page.append(header, flow, footer); root.append(page);
      if (full && (first || notes)) {
        const table = footerTemplate.cloneNode(true);
        table.removeAttribute('style'); footer.append(table);
        const cell = table.rows[1].cells[0];
        if (!first) table.rows[0].cells[0].textContent = 'Dados adicionais - continuação';
        const count = fitText(cell, notes, () => bottom(table) <= bottom(footer) + .5);
        if (notes && !count) throw new Error('Não foi possível acomodar os dados adicionais.');
        notes = notes.slice(count);
      } else if (!full && first && footerTemplate) {
        footer.append(footerTemplate.cloneNode(true));
      } else {
        footer.classList.add('a4-footer-compact');
        footer.textContent = full ? 'Continuação dos produtos. Dados adicionais na folha 1 e nas folhas indicadas.' : 'Continuação dos produtos.';
      }
      current = { page, flow, footer, table: null, fill: null };
      pages.push(current);
      if (flow.getBoundingClientRect().height < 30) throw new Error('Cabeçalho excede a área útil do A4.');
      return current;
    }

    newPage(true);
    // Optional billing/volume blocks also consume actual space, not a fixed estimate.
    for (const block of before) {
      // Each row of six installments can move independently instead of becoming one oversized cell.
      const grid = block.querySelector('.dup-grid');
      if (grid && grid.rows.length > 1) {
        const outerRow = grid.closest('.dup-grid-wrapper').parentElement;
        for (const gridRow of Array.from(grid.rows)) {
          const clone = outerRow.cloneNode(true);
          clone.querySelector('.dup-grid').replaceChildren(gridRow);
          outerRow.before(clone);
        }
        outerRow.remove();
      }
      current.flow.append(block);
      if (fits(block, current.flow)) continue;
      block.remove();
      // Split tables by their original rows, repeating their section heading.
      if (block.tagName === 'TABLE') {
        const sourceRows = Array.from(block.rows);
        let part = block.cloneNode(true);
        Array.from(part.querySelectorAll('tr')).forEach(r => r.remove());
        let body = doc.createElement('tbody'); part.append(body);
        current.flow.append(part);
        const title = sourceRows[0]?.querySelector('.section-title') ? sourceRows.shift() : null;
        if (title) body.append(title.cloneNode(true));
        for (const row of sourceRows) {
          body.append(row);
          if (fits(part, current.flow)) continue;
          row.remove();
          if (body.rows.length === (title ? 1 : 0)) part.remove();
          newPage();
          part = block.cloneNode(false);
          const cols = block.querySelector('colgroup'); if (cols) part.append(cols.cloneNode(true));
          body = doc.createElement('tbody'); part.append(body);
          if (title) body.append(title.cloneNode(true));
          body.append(row); current.flow.append(part);
          if (!fits(part, current.flow)) throw new Error('Um bloco de dados excede uma folha A4. Revise o conteúdo antes de imprimir.');
        }
      } else {
        newPage(); current.flow.append(block);
        if (!fits(block, current.flow)) throw new Error('Bloco maior que a folha A4.');
      }
    }

    function startItems() {
      const title = doc.createElement('div'); title.className = 'a4-section';
      title.textContent = 'DADOS DOS PRODUTOS / SERVIÇOS' + (pages.length > 1 ? ' - CONTINUAÇÃO' : '');
      const table = tableTemplate.cloneNode(true);
      current.flow.append(title, table); current.table = table;
      const filler = doc.createElement('div'); filler.className = 'a4-fill';
      const fillTable = doc.createElement('table');
      const cols = table.querySelector('colgroup'); if (cols) fillTable.append(cols.cloneNode(true));
      const tr = doc.createElement('tr');
      for (let i = 0; i < columns; i++) tr.append(doc.createElement('td'));
      const tbody = doc.createElement('tbody'); tbody.append(tr); fillTable.append(tbody);
      filler.append(fillTable); current.flow.append(filler); current.fill = filler;
      current.title = title;
    }
    startItems();
    for (const original of rows) {
      let row = original;
      for (;;) {
        current.table.tBodies[0].append(row);
        for (const cell of row.querySelectorAll('.num, .right')) {
          if (cell.scrollWidth > cell.clientWidth + 1) {
            cell.style.setProperty('white-space', 'normal', 'important');
            cell.style.overflowWrap = 'anywhere';
          }
        }
        if (fits(current.table, current.flow)) break;
        row.remove();
        if (current.table.tBodies[0].rows.length || current.flow.children.length > 3) {
          if (!current.table.tBodies[0].rows.length) {
            current.table.remove(); current.fill.remove(); current.title.remove();
          }
          newPage(); startItems(); continue;
        }
        // A description taller than an otherwise empty page continues without duplicating values.
        current.table.tBodies[0].append(row);
        const cell = row.cells[descIndex];
        const value = cell.textContent;
        const count = fitText(cell, value, () => fits(current.table, current.flow));
        if (!count) throw new Error('Um produto não cabe na largura útil do A4.');
        const rest = value.slice(count);
        if (!rest) break;
        const next = row.cloneNode(true);
        Array.from(next.cells).forEach((c, index) => { if (index !== 0 && index !== descIndex) c.textContent = ''; });
        next.cells[descIndex].textContent = rest;
        next.dataset.itemContinuation = 'true';
        next.cells[0].textContent = original.cells[0].textContent + ' (cont.)';
        row = next; newPage(); startItems();
      }
    }
    while (notes) {
      newPage(false, true);
      const note = doc.createElement('div'); note.className = 'a4-section';
      note.textContent = 'CONTINUAÇÃO DOS DADOS ADICIONAIS NO RODAPÉ'; current.flow.append(note);
    }
    pages.forEach(({ page }, index) => {
      page.querySelectorAll('.danfe-folha').forEach(el => { el.textContent = `Folha ${index + 1}/${pages.length}`; });
    });
    doc.body.dataset.a4Ready = VERSION;
    return { pages: pages.length, items: rows.length };
  }

  async function print(options = {}) {
    try {
      await document.fonts.ready;
      if (options.withBarcode && options.chave) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
          script.onload = resolve; script.onerror = () => reject(new Error('Não foi possível carregar o código de barras. Tente imprimir novamente.'));
          document.head.append(script);
        });
        document.querySelectorAll('[data-danfe-barcode]').forEach(svg => {
          window.JsBarcode(svg, options.chave, { format: 'CODE128', displayValue: false, height: 48, margin: 0, width: 1.2 });
        });
        document.querySelectorAll('[data-barcode-fallback]').forEach(el => { el.style.display = 'none'; });
      }
      paginate();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.focus(); window.print();
    } catch (error) {
      document.body.dataset.a4Error = error.message;
      window.alert('Impressão não iniciada: ' + error.message);
      throw error;
    }
  }
  window.EoBichoDanfeA4 = { paginate, print, version: VERSION };
})();
