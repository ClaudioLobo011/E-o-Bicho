import {
  state, els,
  normalizeDate, todayStr, pad, money, shortTutorName,
  clearChildren, getFilteredAgendamentos, getVisibleProfissionais,
  updateHeaderLabel, localDateStr, addDays, startOfWeek, startOfMonth, startOfNextMonth,
  renderStatusBadge, statusMeta
} from './core.js';

export function renderGrid() {
  if (!els.agendaList) return;
  if (state.view === 'week')  { renderWeekGrid();  return; }
  if (state.view === 'month') { renderMonthGrid(); return; }

  const date = normalizeDate(els.dateInput?.value || todayStr());
  updateHeaderLabel();
  const BUSINESS_START = 8;
  const BUSINESS_END   = 19;
  const hours = []; for (let h = 0; h < 24; h++) hours.push(`${pad(h)}:00`);
  clearChildren(els.agendaList);

  const profsAll  = state.profissionais || [];
  const profs     = getVisibleProfissionais();
  const byNameAll = new Map((profsAll || []).map(p => [String(p.nome || '').trim().toLowerCase(), p._id]));
  const colCount = 1 + (profs?.length || 0);

  const header = document.createElement('div');
  header.style.display = 'grid';
  header.style.gridTemplateColumns = `120px repeat(${Math.max(colCount - 1, 0)}, minmax(var(--agenda-col-w, 360px), 1fr))`;
  header.className = 'bg-white border-b';
  const headLabels = ['Hora', ...profs.map(p => p.nome)];
  headLabels.forEach((label, idx) => {
    const cell = document.createElement('div');
    cell.className = 'px-3 py-2 text-xs font-medium text-slate-600';
    if (idx === 0) {
      cell.textContent = label;
    } else {
      cell.style.textAlign = 'center';
      const span = document.createElement('span');
      span.className = 'agenda-head-label inline-block';
      span.textContent = label || '';
      cell.dataset.profId = String(profs[idx - 1]._id);
      cell.appendChild(span);
    }
    header.appendChild(cell);
  });
  const counter = document.createElement('div');
  counter.className = 'col-span-full text-right px-3 py-1 text-xs text-slate-500';
  const itemsAll = state.agendamentos || [];
  const items    = getFilteredAgendamentos(itemsAll);
  const filtered = (state.filters.statuses.size || state.filters.profIds.size) ? ` (filtrados: ${items.length})` : '';
  counter.textContent = `Agendamentos: ${itemsAll.length}${filtered}`;
  header.appendChild(counter);
  els.agendaList.appendChild(header);

  const body = document.createElement('div');
  body.style.display = 'grid';
  body.style.gridTemplateColumns = `120px repeat(${Math.max(colCount - 1, 0)}, minmax(var(--agenda-col-w, 360px), 1fr))`;
  els.agendaList.appendChild(body);

  const isToday = normalizeDate(date) === todayStr();
  const now = new Date();
  const nowHH = `${pad(now.getHours())}:00`;

  hours.forEach(hh => {
    const hourNumber = parseInt(hh.split(':')[0], 10);
    const inBusiness = hourNumber >= BUSINESS_START && hourNumber < BUSINESS_END;
    const isNowRow   = isToday && hh === nowHH;
    const timeCell = document.createElement('div');
    timeCell.className = 'px-3 py-3 border-b text-sm ' + (isNowRow ? 'bg-sky-50 text-slate-800 font-medium' : 'bg-gray-50 text-gray-600');
    timeCell.textContent = hh;
    body.appendChild(timeCell);
    (profs || []).forEach(p => {
      const cell = document.createElement('div');
      cell.className = `px-2 py-2 border-b agenda-slot ${inBusiness ? '' : 'bg-slate-50'} ${isNowRow ? 'bg-sky-50' : ''}`;
      cell.dataset.profissionalId = String(p._id);
      cell.dataset.hh = hh;
      body.appendChild(cell);
    });
  });

  let placed = 0;
  for (const a of items) {
    const when = a.h || a.scheduledAt;
    if (!when) continue;
    const d  = new Date(when);
    const hh = `${pad(d.getHours())}:00`;
    let profId = a.profissionalId ? String(a.profissionalId) : null;
    if (!profId) {
      let nameCandidate = '';
      if (typeof a.profissional === 'string') nameCandidate = a.profissional;
      else if (a.profissional && typeof a.profissional === 'object') nameCandidate = a.profissional.nome || '';
      const normalized = String(nameCandidate || '').trim().toLowerCase();
      if (normalized && byNameAll.has(normalized)) profId = String(byNameAll.get(normalized));
    }
    if (!profId) continue;
    let col = body.querySelector(`div[data-profissional-id="${profId}"][data-hh="${hh}"]`);
    if (!col && profs[0]) {
      col = body.querySelector(`div[data-profissional-id="${profs[0]._id}"][data-hh="${hh}"]`);
    }
    if (!col) continue;
    const meta = statusMeta(a.status);
    const card = document.createElement('div');
    card.setAttribute('data-appointment-id', a._id || '');
    card.style.setProperty('--stripe', meta.stripe);
    card.style.setProperty('--card-max-w', '260px');
    card.className = `agenda-card border ${meta.borderClass} cursor-move select-none`;
    card.setAttribute('draggable', 'true');

    const headerEl = document.createElement('div');
    headerEl.className = 'flex items-center justify-between gap-2 pr-14 md:pr-16 mb-1';
    const tutorShort = shortTutorName(a.clienteNome || '');
    const headLabel  = tutorShort ? `${tutorShort} | ${a.pet || ''}` : (a.pet || '');
    headerEl.innerHTML = `
      <div class="font-semibold text-sm text-gray-900 truncate" title="${headLabel}">${headLabel}</div>
      ${renderStatusBadge(a.status)}
    `;

    const bodyEl = document.createElement('div');
    if (a.observacoes && String(a.observacoes).trim()) {
      const svc = document.createElement('div');
      svc.className = 'text-[13px] text-gray-600 clamp-2';
      svc.textContent = a.servico || '';
      const obs = document.createElement('div');
      obs.className = 'mt-1 text-[12px] text-gray-700 italic clamp-2';
      obs.textContent = String(a.observacoes).trim();
      bodyEl.appendChild(svc);
      bodyEl.appendChild(obs);
    } else {
      bodyEl.className = 'text-[13px] text-gray-600 clamp-2';
      bodyEl.textContent = a.servico || '';
    }

    const footerEl = document.createElement('div');
    footerEl.className = 'flex items-center justify-end gap-2 pt-1';
    const price = document.createElement('div');
    price.className = 'text-[13px] text-gray-800 font-medium';
    price.textContent = money(a.valor);
    footerEl.appendChild(price);

    card.appendChild(headerEl);
    card.appendChild(bodyEl);
    card.appendChild(footerEl);
    col.appendChild(card);
    placed++;
  }

  if (placed === 0) {
    const empty = document.createElement('div');
    empty.className = 'px-4 py-3 text-sm text-slate-600 bg-slate-50 border-b';
    empty.textContent = 'Sem agendamentos para este filtro/dia.';
    els.agendaList.insertBefore(empty, header.nextSibling);
  }
}

export function renderWeekGrid() {
  const base = normalizeDate(els.dateInput?.value || todayStr());
  const ini  = startOfWeek(base);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ini, i));
  updateHeaderLabel();
  clearChildren(els.agendaList);

  const BUSINESS_START = 8, BUSINESS_END = 19;
  const hours = []; for (let h = 0; h < 24; h++) hours.push(`${pad(h)}:00`);
  const header = document.createElement('div');
  header.style.display = 'grid';
  header.style.gridTemplateColumns = `120px repeat(7, minmax(180px,1fr))`;
  header.className = 'sticky top-0 z-20 bg-white border-b';
  header.innerHTML = `
    <div class="px-2 py-2 text-xs text-slate-500">Horário</div>
    ${days.map(d=>{
      const lab = new Date(d+'T00:00:00').toLocaleDateString('pt-BR', { weekday:'short', day:'2-digit', month:'2-digit' });
      return `<div class=\"px-3 py-2 text-xs font-medium text-slate-700\">${lab}</div>`;
    }).join('')}
  `;
  els.agendaList.appendChild(header);
  const body = document.createElement('div');
  body.style.display = 'grid';
  body.style.gridTemplateColumns = `120px repeat(7, minmax(180px,1fr))`;
  els.agendaList.appendChild(body);

  hours.forEach(hh => {
    const hNum = parseInt(hh.slice(0,2),10);
    const inBusiness = (hNum>=BUSINESS_START && hNum< BUSINESS_END);
    const timeCell = document.createElement('div');
    timeCell.className = `px-2 py-2 border-b text-[12px] ${inBusiness?'text-slate-800':'text-slate-400'}`;
    timeCell.textContent = hh;
    body.appendChild(timeCell);
    days.forEach(d=>{
      const cell = document.createElement('div');
      cell.className = 'px-2 py-2 border-b agenda-slot';
      cell.dataset.day = d;
      cell.dataset.hh  = hh;
      body.appendChild(cell);
    });
  });

  const items = getFilteredAgendamentos(state.agendamentos || []);
  let placed = 0;
  for (const a of items) {
    const when = a.h || a.scheduledAt; if (!when) continue;
    const dt     = new Date(when);
    const dayStr = localDateStr(dt);
    if (dayStr < days[0] || dayStr > days[6]) continue;
    const hh = `${pad(dt.getHours())}:00`;
    const cell = els.agendaList.querySelector(`div[data-day="${dayStr}"][data-hh="${hh}"]`);
    if (!cell) continue;
    const meta = statusMeta(a.status);
    const card = document.createElement('div');
    card.setAttribute('data-appointment-id', a._id || '');
    card.style.setProperty('--stripe', meta.stripe);
    card.style.setProperty('--card-max-w', '100%');
    card.className = `agenda-card border ${meta.borderClass} cursor-pointer select-none px-2 py-1`;
    card.setAttribute('draggable', 'true');
    card.title = [ a.pet || '', a.servico || '', (a.observacoes ? `Obs: ${String(a.observacoes).trim()}` : '') ].filter(Boolean).join(' • ');

    const headerEl = document.createElement('div');
    headerEl.className = 'flex items-center justify-between gap-2 mb-1';
    const tutorShort = shortTutorName(a.clienteNome || a.tutor || '');
    const headLabel  = tutorShort ? `${tutorShort} | ${a.pet || ''}` : (a.pet || '');
    headerEl.innerHTML = `
      <div class="font-medium text-[12px] text-gray-900 truncate" title="${headLabel}">${headLabel}</div>
    `;

    const bodyEl = document.createElement('div');
    const svc = document.createElement('div');
    svc.className = 'text-[12px] text-gray-600 truncate';
    svc.textContent = a.servico || '';
    bodyEl.appendChild(svc);
    if (a.observacoes && String(a.observacoes).trim()) {
      const obs = document.createElement('div');
      obs.className = 'text-[11px] text-gray-700 italic truncate';
      obs.textContent = String(a.observacoes).trim();
      bodyEl.appendChild(obs);
    }

    const footerEl = document.createElement('div');
    footerEl.className = 'flex items-center justify-end gap-2 pt-0.5';
    const statusEl = document.createElement('div');
    statusEl.innerHTML = renderStatusBadge(a.status).replace('text-xs','text-[10px]');
    const price = document.createElement('div');
    price.className = 'text-[12px] text-gray-800 font-semibold';
    price.textContent = money(a.valor);
    footerEl.appendChild(statusEl);
    footerEl.appendChild(price);

    card.appendChild(headerEl);
    card.appendChild(bodyEl);
    card.appendChild(footerEl);
    cell.appendChild(card);
    placed++;
  }
  if (placed === 0) {
    const empty = document.createElement('div');
    empty.className = 'p-6 text-sm text-slate-500';
    empty.textContent = 'Nenhum agendamento no intervalo.';
    els.agendaList.appendChild(empty);
  }
}

export function renderMonthGrid() {
  const base = normalizeDate(els.dateInput?.value || todayStr());
  const m0   = startOfMonth(base);
  const m1   = startOfNextMonth(base);
  updateHeaderLabel();
  clearChildren(els.agendaList);
  const weekDays = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  const header = document.createElement('div');
  header.style.display = 'grid';
  header.style.gridTemplateColumns = `repeat(7, minmax(180px,1fr))`;
  header.className = 'sticky top-0 z-20 bg-white border-b';
  header.innerHTML = weekDays.map(d=>`<div class="px-3 py-2 text-xs font-medium text-slate-700">${d}</div>`).join('');
  els.agendaList.appendChild(header);

  const startGrid = startOfWeek(m0);
  const days = Array.from({length:42},(_,i)=> addDays(startGrid,i));
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = `repeat(7, minmax(180px,1fr))`;
  els.agendaList.appendChild(grid);

  const items = getFilteredAgendamentos((state.agendamentos||[]).slice().sort((a,b)=>(new Date(a.h||a.scheduledAt))-(new Date(b.h||b.scheduledAt))));
  const byDay = new Map();
  for (const a of items) {
    const d = localDateStr(new Date(a.h || a.scheduledAt));
    if (d >= m0 && d < m1) {
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(a);
    }
  }

  days.forEach(d=>{
    const inMonth = (d>=m0 && d<m1);
    const cell = document.createElement('div');
    cell.className = `min-h-[140px] border p-2 ${inMonth? 'bg-white':'bg-slate-50'} agenda-slot`;
    cell.dataset.day = d;
    const title = document.createElement('div');
    title.className = `flex items-center justify-between text-[11px] ${inMonth?'text-slate-700':'text-slate-400'}`;
    const dayNum = new Date(d+'T00:00:00').getDate();
    title.innerHTML = `<span class="font-semibold">${String(dayNum).padStart(2,'0')}</span>`;
    const list = document.createElement('div');
    list.className = 'mt-1 space-y-1 agenda-slot';
    list.dataset.day = d;
    const itemsDay = byDay.get(d) || [];
    itemsDay.forEach((a, idx)=>{
      const meta = statusMeta(a.status);
      const when = new Date(a.h || a.scheduledAt);
      const hhmm = `${pad(when.getHours())}:${String(when.getMinutes()).padStart(2,'0')}`;
      const card = document.createElement('div');
      card.setAttribute('data-appointment-id', a._id || '');
      card.style.setProperty('--stripe', meta.stripe);
      card.style.setProperty('--card-max-w', '100%');
      card.className = `agenda-card border ${meta.borderClass} cursor-pointer select-none px-2 py-1`;
      card.setAttribute('draggable', 'true');
      card.title = [ a.pet || '', a.servico || '', (a.observacoes ? `Obs: ${String(a.observacoes).trim()}` : '') ].filter(Boolean).join(' • ');
      const headerEl = document.createElement('div');
      headerEl.className = 'flex items-center gap-2 pr-14 md:pr-16 mb-1';
      headerEl.innerHTML = `
        <span class="inline-flex items-center px-1.5 py-[1px] rounded bg-slate-100 text-[10px] font-medium">${hhmm}</span>
        <div class="flex-1 flex items-center justify-center">
          ${renderStatusBadge(a.status).replace('text-xs','text-[10px]')}
        </div>
      `;
      const rawTutorName = a.tutor || a.tutorNome || a.clienteNome ||
        (a.cliente && (a.cliente.nomeCompleto || a.cliente.nomeContato || a.cliente.razaoSocial || a.cliente.nome || a.cliente.name)) ||
        (a.tutor && (a.tutor.nomeCompleto || a.tutor.nomeContato || a.tutor.razaoSocial || a.tutor.nome)) ||
        a.responsavelNome || (a.responsavel && (a.responsavel.nome || a.responsavel.name)) || '';
      const tutorShort = shortTutorName(rawTutorName);
      const headLabel  = [tutorShort, (a.pet || '')].filter(Boolean).join(' | ');
      const nameEl = document.createElement('div');
      nameEl.className = 'text-[12px] font-medium text-gray-900 text-center truncate';
      nameEl.title = headLabel; nameEl.textContent = headLabel;
      const footerEl = document.createElement('div');
      footerEl.className = 'flex items-center justify-end pt-0.5';
      const price = document.createElement('div');
      price.className = 'text-[12px] text-gray-800 font-semibold';
      price.textContent = money(a.valor);
      footerEl.appendChild(price);
      card.appendChild(headerEl);
      card.appendChild(nameEl);
      card.appendChild(footerEl);
      list.appendChild(card);
      if (idx>=6 && itemsDay.length>7) {
        const more = document.createElement('div');
        more.className = 'text-[11px] text-slate-500';
        more.textContent = `+${itemsDay.length-6} itens`;
        list.appendChild(more);
        return;
      }
    });
    cell.appendChild(title);
    cell.appendChild(list);
    grid.appendChild(cell);
  });
}

