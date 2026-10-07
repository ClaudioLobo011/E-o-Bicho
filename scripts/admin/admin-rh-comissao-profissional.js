(() => {
  'use strict';
  const engine = window.ProfessionalCommissionEngine;
  const API = `${API_CONFIG.BASE_URL}/admin/comissoes-profissionais`;
  const $ = (id) => document.getElementById(`commission-${id}`);
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalize = (value) => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const today = engine.dateKey(new Date());
  const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const percentLabel = (value) => `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
  const state = { professionals: [], groups: [], services: [], configs: new Map(), selected: '', draft: null, dirty: false, saving: false };
  const selected = () => state.professionals.find((p) => p._id === state.selected);
  const config = () => state.configs.get(state.selected) || {};
  const eligibleGroups = () => state.groups.filter((g) => g.tiposPermitidos?.includes(state.draft?.professionalType));
  const eligibleServices = () => state.services.filter((s) => s.grupo?.tiposPermitidos?.includes(state.draft?.professionalType));
  function feedback(message, error = false) { $('feedback').textContent = message; $('feedback').dataset.error = String(error); }
  function dirty() { state.dirty = true; $('dirty').textContent = 'Alterações não salvas'; }
  function token() { try { return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || ''; } catch { return ''; } }
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `Erro ${response.status}`);
    return data;
  }
  function loadDraft() {
    const saved = config();
    state.draft = { professionalType: saved.professionalType || selected()?.professionalType,
      groupRules: clone(saved.groupRules || []), serviceRules: clone(saved.serviceRules || []), weekdayRules: clone(saved.weekdayRules || []),
      effectiveFrom: saved.effectiveFrom > today ? saved.effectiveFrom : today, expectedRevision: Number(saved.revision || 0) };
    state.dirty = false; $('dirty').textContent = '';
  }
  function selectProfessional(id) {
    if (state.saving) return;
    if (state.dirty && !window.confirm('Descartar as alterações não salvas deste profissional?')) return;
    state.selected = id; loadDraft(); renderProfessionals(); renderEditor(); feedback('');
  }
  function renderProfessionals() {
    const term = normalize($('professional-search').value);
    const people = state.professionals.filter((p) => normalize(`${p.nome} ${p.cargoCarteira || ''}`).includes(term));
    $('professionals-counter').textContent = `${people.length} profissional(is)`;
    $('professionals-list').innerHTML = people.map((p) => `<button class="commission-person" type="button" data-initials="${escape((p.nome || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("").toUpperCase())}" data-professional="${escape(p._id)}" aria-pressed="${p._id === state.selected}"><span>${escape(p.nome)}</span><small>${p.professionalType === 'veterinario' ? 'Veterinário' : 'Esteticista'}</small></button>`).join('') || '<p class="commission-empty">Nenhum profissional encontrado.</p>';
  }
  function ruleInput(kind, item) {
    const key = kind === 'group' ? 'group' : 'service';
    const rules = state.draft[`${key}Rules`];
    const rule = rules.find((r) => r[key] === item._id);
    const base = kind === 'group' ? item.comissaoPercent : item.comissaoPercent ?? item.grupo?.comissaoPercent ?? 0;
    return `<div class="commission-rule-row"><div>${escape(item.nome)}<small>${escape(item.grupo?.nome || 'Grupo de serviço')}</small></div><span>Base: ${percentLabel(base)}</span><label><span class="commission-muted">Comissão (%)</span><input aria-label="Comissão de ${escape(item.nome)}" type="number" min="0" max="100" step="0.01" placeholder="Herdar" value="${escape(rule?.percent ?? '')}" data-rule-kind="${key}" data-rule-ref="${escape(item._id)}"></label></div>`;
  }
  function renderGeneral() {
    const groups = eligibleGroups().filter((g) => normalize(g.nome).includes(normalize($('group-search').value)));
    const services = eligibleServices().filter((s) => normalize(`${s.nome} ${s.grupo?.nome}`).includes(normalize($('service-search').value)));
    $('groups-body').innerHTML = groups.map((g) => ruleInput('group', g)).join('') || '<p class="commission-empty">Nenhum grupo encontrado.</p>';
    $('services-body').innerHTML = services.map((s) => ruleInput('service', s)).join('') || '<p class="commission-empty">Nenhum serviço encontrado.</p>';
  }
  function exceptionRows(rule, kind, index) {
    const items = kind === 'group' ? eligibleGroups() : eligibleServices();
    return rule[`${kind}Rules`].map((r, i) => `<div class="commission-exception"><select aria-label="${kind === 'group' ? 'Grupo' : 'Serviço'} da exceção" data-exception="${index}:${kind}:${i}:ref"><option value="">Selecionar...</option>${!items.some((item) => item._id === r[kind]) && r[kind] ? `<option value="${escape(r[kind])}" selected>Cadastro indisponível (${escape(r[kind])})</option>` : ''}${items.map((item) => `<option value="${escape(item._id)}" ${item._id === r[kind] ? 'selected' : ''}>${escape(item.nome)}</option>`).join('')}</select><input type="number" min="0" max="100" step="0.01" aria-label="Percentual da exceção" placeholder="%" value="${escape(r.percent)}" data-exception="${index}:${kind}:${i}:percent"><button class="commission-remove" type="button" data-remove-exception="${index}:${kind}:${i}">Remover</button></div>`).join('');
  }
  function renderWeekdays() {
    const rules = state.draft.weekdayRules;
    $('weekday-count').textContent = rules.filter((r) => r.enabled !== false).length;
    $('weekday-rules').innerHTML = rules.map((rule, index) => `<article class="commission-weekday-card"><div class="commission-weekday-top"><h3>Regra ${index + 1}</h3><label><input type="checkbox" data-weekday-enabled="${index}" ${rule.enabled !== false ? 'checked' : ''}> Ativa</label><button class="commission-remove" type="button" data-remove-weekday="${index}">Excluir</button></div><div class="commission-days">${[1,2,3,4,5,6,0].map((day) => `<label><input type="checkbox" data-weekday="${index}:${day}" ${rule.weekdays.includes(day) ? 'checked' : ''}>${days[day]}</label>`).join('')}</div><label>Comissão padrão desses dias (%)<input type="number" min="0" max="100" step="0.01" placeholder="Herdar regras gerais" value="${escape(rule.defaultPercent ?? '')}" data-weekday-percent="${index}"></label><details ${rule.groupRules.length ? 'open' : ''}><summary>Comissão por grupo de serviço (${rule.groupRules.length})</summary>${exceptionRows(rule, 'group', index)}<button class="commission-secondary" type="button" data-add-exception="${index}:group">+ Exceção por grupo</button></details><details ${rule.serviceRules.length ? 'open' : ''}><summary>Comissão por serviço (${rule.serviceRules.length})</summary>${exceptionRows(rule, 'service', index)}<button class="commission-secondary" type="button" data-add-exception="${index}:service">+ Exceção por serviço</button></details></article>`).join('') || '<div class="commission-empty">Nenhuma regra cadastrada.</div>';
  }
  function renderEditor() {
    const person = selected();
    $('editor').hidden = !person; $('selection-placeholder').hidden = Boolean(person); $('save-btn').disabled = !person;
    if (!person) return;
    $('professional-name').textContent = person.nome; $('selected-badge').textContent = person.nome;
    $('role-badge').textContent = state.draft.professionalType === 'veterinario' ? 'Veterinário' : 'Esteticista';
    $('effective-from').value = state.draft.effectiveFrom; $('effective-from').min = state.draft.effectiveFrom > today ? state.draft.effectiveFrom : today;
    renderGeneral(); renderWeekdays();
  }
  function validate() {
    if (!engine.dateKey(state.draft.effectiveFrom) || state.draft.effectiveFrom < today || state.draft.effectiveFrom < (config().effectiveFrom || '')) throw new Error('Escolha uma vigência a partir de hoje e da última configuração.');
    const check = (rules, key) => { const seen = new Set(); for (const r of rules) { if (!r[key] || seen.has(r[key])) throw new Error('Selecione cada grupo ou serviço uma única vez por regra.'); if (engine.numeric(r.percent) === null) throw new Error('Informe percentuais entre 0 e 100%.'); seen.add(r[key]); } };
    check(state.draft.groupRules, 'group'); check(state.draft.serviceRules, 'service');
    const occupied = new Set();
    for (const r of state.draft.weekdayRules) {
      if (!r.weekdays.length) throw new Error('Selecione pelo menos um dia em cada regra.');
      if (r.enabled !== false) for (const day of r.weekdays) { if (occupied.has(day)) throw new Error(`${days[day]} está em duas regras ativas. Ajuste os dias para não haver conflito.`); occupied.add(day); }
      if (r.defaultPercent !== null && r.defaultPercent !== '' && engine.numeric(r.defaultPercent) === null) throw new Error('O percentual do dia deve estar entre 0 e 100%.');
      check(r.groupRules, 'group'); check(r.serviceRules, 'service');
      if ((r.defaultPercent === null || r.defaultPercent === '') && !r.groupRules.length && !r.serviceRules.length) throw new Error('Defina o percentual do dia ou uma exceção.');
    }
    if ([...document.querySelectorAll('.commission-page input[type=number]')].some((input) => !input.validity.valid)) throw new Error('Confira os valores numéricos do formulário.');
  }
  async function save() {
    try {
      validate(); state.saving = true; $('save-btn').disabled = true;
      // Keep a stable draft while the request is in flight.
      $('editor').inert = true;
      const saved = await request(`${API}/${state.selected}`, { method: 'PUT', body: JSON.stringify(state.draft) });
      state.configs.set(state.selected, saved); loadDraft(); renderEditor(); feedback('Configuração salva.');
    } catch (error) { feedback(error.message, true); }
    finally { state.saving = false; $('editor').inert = false; $('save-btn').disabled = !selected(); }
  }
  $('professional-search').addEventListener('input', renderProfessionals);
  $('professionals-list').addEventListener('click', (event) => { const button = event.target.closest('[data-professional]'); if (button) selectProfessional(button.dataset.professional); });
  $('group-search').addEventListener('input', renderGeneral); $('service-search').addEventListener('input', renderGeneral);
  $('save-btn').addEventListener('click', save);
  $('add-weekday').addEventListener('click', () => { state.draft.weekdayRules.push({ id: crypto.randomUUID(), weekdays: [], enabled: true, defaultPercent: null, groupRules: [], serviceRules: [] }); dirty(); renderWeekdays(); });
  for (const name of ['general', 'weekdays']) $('tab-' + name).addEventListener('click', () => { for (const tab of ['general', 'weekdays']) { $(tab).hidden = tab !== name; $('tab-' + tab).setAttribute('aria-selected', String(tab === name)); } });
  $('editor').addEventListener('input', (event) => {
    const input = event.target; const d = input.dataset;
    if (input.type === 'search') return;
    if (input.id === 'commission-effective-from') state.draft.effectiveFrom = input.value;
    if (d.ruleKind) { const key = d.ruleKind; const rules = state.draft[`${key}Rules`]; const index = rules.findIndex((r) => r[key] === d.ruleRef); if (index >= 0) rules.splice(index, 1); if (input.value !== '' || input.validity.badInput) rules.push({ [key]: d.ruleRef, percent: input.validity.badInput ? 'invalid' : input.value }); }
    if (d.weekday !== undefined) { const [index, day] = d.weekday.split(':').map(Number); const rule = state.draft.weekdayRules[index]; rule.weekdays = input.checked ? [...new Set([...rule.weekdays, day])] : rule.weekdays.filter((v) => v !== day); }
    if (d.weekdayEnabled !== undefined) state.draft.weekdayRules[Number(d.weekdayEnabled)].enabled = input.checked;
    if (d.weekdayPercent !== undefined) state.draft.weekdayRules[Number(d.weekdayPercent)].defaultPercent = input.validity.badInput ? 'invalid' : input.value === '' ? null : input.value;
    if (d.exception) { const [index, kind, row, field] = d.exception.split(':'); state.draft.weekdayRules[index][`${kind}Rules`][row][field === 'ref' ? kind : 'percent'] = input.validity.badInput ? 'invalid' : input.value; }
    dirty(); $('weekday-count').textContent = state.draft.weekdayRules.filter((r) => r.enabled !== false).length;
  });
  $('weekday-rules').addEventListener('click', (event) => {
    const button = event.target.closest('button'); if (!button) return;
    const d = button.dataset;
    if (d.removeWeekday !== undefined) state.draft.weekdayRules.splice(Number(d.removeWeekday), 1);
    if (d.addException) { const [index, kind] = d.addException.split(':'); state.draft.weekdayRules[index][`${kind}Rules`].push({ [kind]: '', percent: '' }); }
    if (d.removeException) { const [index, kind, row] = d.removeException.split(':'); state.draft.weekdayRules[index][`${kind}Rules`].splice(Number(row), 1); }
    dirty(); renderWeekdays();
  });
  window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  request(`${API}/bootstrap`).then((data) => {
    state.professionals = data.professionals || []; state.groups = data.groups || []; state.services = data.services || [];
    state.configs = new Map((data.configs || []).map((c) => [c.user, c]));
    state.selected = state.professionals[0]?._id || ''; if (state.selected) loadDraft(); renderProfessionals(); renderEditor();
  }).catch((error) => feedback(error.message, true));
})();
