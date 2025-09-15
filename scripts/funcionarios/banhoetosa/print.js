import { money, todayStr, normalizeDate, els, getFilteredAgendamentos } from './core.js';

export function buildCupomHTML(items, meta = {}) {
  const storeName = (meta.storeName || '').trim();
  const dateStr   = (meta.dateStr || '').trim();
  const rows = (items || []).map(a => {
    const pet   = (a.pet || '').toString().trim();
    const serv  = (a.servico || '').toString().trim();
    const valor = money(Number(a.valor || 0));
    return `<div class="row"><span class="txt">${pet} ${serv}</span><span class="val">${valor}</span></div>`;
  }).join('');
  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Impressão</title>
  <style>
    @page { size: 80mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    html, body { padding: 0; margin: 0; }
    body { width: 74mm; font: 13px/1.35 -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"; color: #000; -webkit-font-smoothing: none; font-weight: 600; }
    .wrap { padding: 2mm 0; }
    .h1 { text-align:center; font-weight:700; font-size: 15px; margin-bottom: 1mm; }
    .meta { text-align:center; font-size: 12px; color:#000; font-weight:700; margin-bottom: 2mm; }
    .hr { border-top: 1px dashed #000; margin: 2mm 0; }
    .row { display:flex; align-items:flex-start; justify-content:space-between; gap: 4mm; padding: 1mm 0; }
    .row .txt { flex: 1 1 auto; word-break: break-word; font-weight:700; }
    .row .val { flex: 0 0 auto; white-space: nowrap; font-weight:700; }
    .foot { text-align:center; margin-top: 2mm; font-size: 12px; color:#000; font-weight:700; }
    @media print { .no-print { display: none !important; } }
  </style>
  </head>
  <body>
    <div class="wrap">
      <div class="h1">Agenda</div>
      <div class="meta">${storeName ? storeName + ' • ' : ''}${dateStr}</div>
      <div class="hr"></div>
      ${rows || '<div class="row"><span class="txt">Sem itens</span><span class="val"></span></div>'}
      <div class="hr"></div>
      <div class="foot">Obrigado!</div>
    </div>
    <script>
      window.onload = function(){ setTimeout(function(){ window.print(); }, 50); };
      window.onafterprint = function(){ setTimeout(function(){ window.close(); }, 50); };
    </script>
  </body>
  </html>`;
}

export function handlePrintCupom() {
  try {
    const items = getFilteredAgendamentos();
    items.sort((a, b) => {
      const da = new Date(a.h || a.scheduledAt || 0).getTime();
      const db = new Date(b.h || b.scheduledAt || 0).getTime();
      return da - db;
    });
    const dateStr = (document.getElementById('agenda-date-label-visible')?.textContent || '').trim() || new Date((normalizeDate(els.dateInput?.value || todayStr())) + 'T00:00:00').toLocaleDateString('pt-BR');
    const storeName = (document.getElementById('agenda-store-label-visible')?.textContent || '').trim();
    const html = buildCupomHTML(items, { storeName, dateStr });
    const w = window.open('', 'print_cupom', 'width=420,height=600');
    if (!w) { alert('O navegador bloqueou a janela de impressão. Habilite pop-ups para continuar.'); return; }
    w.document.open('text/html');
    w.document.write(html);
    w.document.close();
    w.focus();
  } catch (e) {
    console.error('handlePrintCupom', e);
    alert('Não foi possível preparar a impressão.');
  }
}

