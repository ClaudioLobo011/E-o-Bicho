import { fetchJSON } from './core.js';

const storeSelect = document.getElementById('serv-fiscal-store');
const ruleSelect = document.getElementById('serv-fiscal-rule');
const description = document.getElementById('serv-fiscal-description');
const status = document.getElementById('serv-fiscal-status');
const summary = document.getElementById('serv-fiscal-summary');
let draft = {};
let currentStore = '';
let rules = [];
let requestId = 0;
let loading = false;
let loadError = false;
let stores = [];

function saveCurrent() {
  if (!currentStore || loading || loadError) return;
  const fiscalRuleCode = ruleSelect?.value || '';
  const descricao = description?.value.trim() || '';
  if (fiscalRuleCode || descricao) draft[currentStore] = { fiscalRuleCode, descricao };
  else delete draft[currentStore];
}

function updateStatus() {
  if (summary) {
    const configured = Object.values(draft).filter(item => item.fiscalRuleCode).length;
    summary.textContent = configured ? `${configured} empresa${configured === 1 ? '' : 's'} com regra vinculada` : 'Nenhuma regra vinculada';
  }
  if (!status || loading || loadError) return;
  const rule = rules.find(item => String(item.code) === ruleSelect?.value);
  const store = stores.find(item => item._id === currentStore);
  status.textContent = !currentStore ? 'Selecione uma empresa para configurar a emissão deste serviço.'
    : !rule ? 'Pendente: selecione uma regra fiscal de serviço para esta empresa.'
      : `${rule.name} · Código nacional ${rule.fiscal?.nfse?.codigoTributacaoNacional || 'pendente'}${store?.nfse?.enabled ? '' : ' · Emissão desabilitada no cadastro da empresa'}`;
}

async function loadCompanyRules() {
  const thisRequest = ++requestId;
  loading = true;
  loadError = false;
  rules = [];
  ruleSelect.disabled = true;
  description.disabled = true;
  description.value = draft[currentStore]?.descricao || '';
  ruleSelect.replaceChildren(new Option(currentStore ? 'Carregando regras…' : 'Selecione uma empresa', ''));
  status.textContent = currentStore ? 'Carregando regras de serviço…' : 'Selecione uma empresa para configurar a emissão deste serviço.';
  try {
    if (currentStore) {
      const response = await fetchJSON(`${API_CONFIG.BASE_URL}/fiscal/default-rules?storeId=${encodeURIComponent(currentStore)}&tipo=servico`);
      if (thisRequest !== requestId) return;
      rules = (response.rules || []).filter(rule => rule.tipo === 'servico');
    }
    if (thisRequest !== requestId) return;
    ruleSelect.replaceChildren(new Option('Sem regra — emissão pendente', ''));
    rules.forEach(rule => ruleSelect.add(new Option(`${rule.code} — ${rule.name}`, String(rule.code))));
    const selectedCode = draft[currentStore]?.fiscalRuleCode || '';
    if (selectedCode && !rules.some(rule => String(rule.code) === selectedCode)) {
      ruleSelect.add(new Option(`${selectedCode} — Regra indisponível: revise o vínculo`, selectedCode));
    }
    ruleSelect.value = selectedCode;
    ruleSelect.disabled = !currentStore;
    description.disabled = !currentStore;
  } catch (error) {
    if (thisRequest !== requestId) return;
    loadError = true;
    status.textContent = 'Não foi possível carregar as regras. O vínculo existente será preservado. Troque a empresa para tentar novamente.';
    console.error('Erro ao carregar regras de serviço', error);
  } finally {
    if (thisRequest === requestId) { loading = false; updateStatus(); }
  }
}

export function collectServiceFiscal() {
  saveCurrent();
  return JSON.parse(JSON.stringify(draft));
}

export function fillServiceFiscal(value = {}) {
  draft = JSON.parse(JSON.stringify(value || {}));
  updateStatus();
  if (storeSelect && currentStore) loadCompanyRules();
}

export async function initServiceFiscal() {
  if (!storeSelect || !ruleSelect) return;
  storeSelect.addEventListener('change', () => {
    saveCurrent();
    currentStore = storeSelect.value;
    loadCompanyRules();
  });
  ruleSelect.addEventListener('change', () => { saveCurrent(); updateStatus(); });
  description.addEventListener('input', () => { saveCurrent(); updateStatus(); });
  try {
    const response = await fetchJSON(`${API_CONFIG.BASE_URL}/stores`);
    stores = Array.isArray(response) ? response : response.stores || [];
    storeSelect.replaceChildren(new Option('Selecione uma empresa', ''));
    stores.forEach(store => storeSelect.add(new Option(store.nomeFantasia || store.nome || store.razaoSocial, store._id)));
    updateStatus();
  } catch (error) {
    status.textContent = 'Não foi possível carregar as empresas. Recarregue a página para configurar a tributação.';
    console.error('Erro ao carregar empresas para NFS-e', error);
  }
}
