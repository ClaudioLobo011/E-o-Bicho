document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = API_CONFIG.BASE_URL;
  const storeSelect = document.getElementById('crm-store-select');

  if (!storeSelect) return;

  const getToken = () => {
    try {
      return JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token || '';
    } catch {
      return '';
    }
  };

  const authHeaders = () => {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const notify = (message, type = 'info') => {
    if (typeof showToast === 'function') {
      showToast(message, type, 3500);
    }
  };

  async function loadStores() {
    storeSelect.disabled = true;
    storeSelect.innerHTML = '<option>Carregando...</option>';

    try {
      const resp = await fetch(`${API_BASE}/stores/allowed`, { headers: authHeaders() });
      if (!resp.ok) {
        throw new Error(`Falha ao carregar empresas (${resp.status})`);
      }
      const data = await resp.json().catch(() => ({}));
      const stores = Array.isArray(data?.stores) ? data.stores : Array.isArray(data) ? data : [];

      if (!stores.length) {
        storeSelect.innerHTML = '<option value="">Nenhuma empresa vinculada</option>';
        notify('Nenhuma empresa vinculada ao seu usuario.', 'warning');
        return;
      }

      const options = ['<option value="">Selecione a empresa</option>', ...stores.map((s) => (
        `<option value="${s._id}">${s.nome}</option>`
      ))];
      storeSelect.innerHTML = options.join('');
    } catch (error) {
      console.error('crm:loadStores', error);
      storeSelect.innerHTML = '<option value="">Erro ao carregar empresas</option>';
      notify('Nao foi possivel carregar as empresas.', 'error');
    } finally {
      storeSelect.disabled = false;
    }
  }

  loadStores();
});
