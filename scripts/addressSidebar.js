// scripts/addressSidebar.js
// CEP editável no formulário: consulta ViaCEP ao clicar "Buscar" (ou Enter) e preenche os campos bloqueados.
// Usa delegação global para garantir que o botão funcione mesmo com HTML injetado dinamicamente.
(function() {
  const API_BASE = (typeof API_CONFIG !== 'undefined' && API_CONFIG.BASE_URL) ? API_CONFIG.BASE_URL : '/api';
  let lastViaCepData = null;

  // ===== Utils =====
  function onlyDigits(v) { return (v || '').replace(/\D/g, ''); }
  function formatCEP(v) {
    const d = onlyDigits(v).slice(0, 8);
    if (d.length <= 5) return d;
    return d.slice(0, 5) + '-' + d.slice(5);
  }
  function getLoggedUserId() {
    try {
      const u = JSON.parse(localStorage.getItem('loggedInUser'));
      return u && u.id ? u.id : null;
    } catch { return null; }
  }
  function safeShowModal(opts) {
    const hasInfo = document.getElementById('info-modal');
    const hasConfirm = document.getElementById('confirm-modal');
    if (typeof showModal === 'function' && (hasInfo || hasConfirm)) {
      try { showModal(opts); return; } catch(e) {}
    }
    if (opts && opts.message) alert(opts.message);
  }
  function getAuthHeaders(asJson = false) {
  try {
    const token = JSON.parse(localStorage.getItem('loggedInUser') || 'null')?.token;
    const h = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    if (asJson) h['Content-Type'] = 'application/json';
    return h;
  } catch {
    return asJson ? { 'Content-Type': 'application/json' } : {};
  }
}

  // ===== ViaCEP =====
  async function fetchViaCEP(cep) {
    const clean = onlyDigits(cep);
    if (clean.length !== 8) throw new Error('CEP inválido');
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    if (!res.ok) throw new Error('Falha ao consultar ViaCEP');
    const data = await res.json();
    if (data.erro) throw new Error('CEP não encontrado');

    return {
      cep: formatCEP(clean),
      logradouro: data.logradouro || '',
      bairro: data.bairro || '',
      cidade: data.localidade || '',
      uf: data.uf || '',
      ibge: data.ibge || ''
    };
  }

  // Preenche os campos bloqueados com ViaCEP (mantém número/complemento)
  function prefillAddressFromViaCep(vc) {
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('addr_cep', vc.cep);
    setVal('addr_logradouro', vc.logradouro);
    setVal('addr_bairro', vc.bairro);
    setVal('addr_cidade', vc.cidade);
    setVal('addr_uf', vc.uf);
  }

  // Garante que o formulário esteja preenchido conforme o CEP digitado no próprio form
  async function ensureViaCepForForm() {
    const cepInput = document.getElementById('addr_cep');
    if (!cepInput) throw new Error('Campo CEP não encontrado.');
    const raw = cepInput.value;
    const btn = document.getElementById('addr_cep_search_btn');

    // feedback visual
    if (btn) { btn.disabled = true; btn.textContent = 'Buscando...'; }

    try {
      const vc = await fetchViaCEP(raw);
      prefillAddressFromViaCep(vc);
      lastViaCepData = vc;
      if (typeof showToast === 'function') showToast('CEP atualizado.', 'success', 1500);
      return vc;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Buscar'; }
    }
  }

  // ===== Sidebar HTML =====
  function mountSidebarHtmlIfNeeded() {
    if (document.getElementById('address-panel')) return Promise.resolve();
    return fetch('../components/account/address-sidebar.html')
      .then(r => r.text())
      .then(html => {
        const div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div);
      });
  }

  // Views
  function showListView() {
    document.getElementById('address-title').textContent = 'Endereços';
    document.getElementById('address-list-view').classList.remove('hidden');
    document.getElementById('address-form-view').classList.add('hidden');
    document.getElementById('address-list-footer').classList.remove('hidden');
    document.getElementById('address-form-footer').classList.add('hidden');
  }
  function showFormView() {
    document.getElementById('address-title').textContent = 'Cadastrar Endereço';
    document.getElementById('address-list-view').classList.add('hidden');
    document.getElementById('address-form-view').classList.remove('hidden');
    document.getElementById('address-list-footer').classList.add('hidden');
    document.getElementById('address-form-footer').classList.remove('hidden');
  }

  // Abre/fecha
  function openSidebar() {
    const overlay = document.getElementById('address-overlay');
    const panel   = document.getElementById('address-panel');
    overlay.classList.remove('hidden');
    requestAnimationFrame(() => { panel.classList.remove('translate-x-full'); });
  }
  function closeSidebar() {
    const overlay = document.getElementById('address-overlay');
    const panel   = document.getElementById('address-panel');
    panel.classList.add('translate-x-full');
    setTimeout(() => overlay.classList.add('hidden'), 250);
  }

  // Inicializa o form para um novo cadastro (com ViaCEP inicial opcional)
  function prefillFormWithViaCEP(vc) {
    if (vc) prefillAddressFromViaCep(vc); // CEP pode ser alterado depois
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('addr_numero', '');
    setVal('addr_complemento', '');
    setVal('addr_apelido', 'Principal');
    const chk = document.getElementById('addr_is_default');
    if (chk) chk.checked = true;
  }

  // Render da LISTA
  function renderAddressList(addresses) {
    const list = document.getElementById('address-list');
    const empty = document.getElementById('address-empty-hint');
    list.innerHTML = '';

    if (!addresses || addresses.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    addresses.forEach(addr => {
      const div = document.createElement('div');
      div.className = 'border rounded-lg p-3';
      const line1 = [addr.logradouro, addr.numero].filter(Boolean).join(', ');
      const line2 = [addr.bairro, addr.cidade, addr.uf].filter(Boolean).join(' - ');
      const cep   = addr.cep || '';
      const comp  = addr.complemento ? ` (${addr.complemento})` : '';
      const badge = addr.isDefault ? '<span class="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">Principal</span>' : '';

      div.innerHTML = `
        <div class="flex justify-between items-start gap-3">
          <div class="text-sm text-gray-700">
            <div class="font-semibold">${addr.apelido || 'Endereço' } ${badge}</div>
            <div>${line1}${comp}</div>
            <div>${line2}</div>
            <div>CEP: ${cep}</div>
          </div>
          <div class="flex-shrink-0">
            <button data-id="${addr._id}" class="address-use-btn px-3 py-2 rounded bg-primary text-white text-sm font-semibold hover:bg-secondary">Usar este</button>
          </div>
        </div>
      `;
      list.appendChild(div);
    });

    // listeners dos itens (re-render não acumula)
    list.querySelectorAll('.address-use-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-id');
        const chosen = addresses.find(a => String(a._id) === String(id));
        if (typeof window.onAddressSelected === 'function') window.onAddressSelected(chosen);
        if (window.recalculateDelivery) {
          window.recalculateDelivery(chosen.cep, { bairro: chosen.bairro });
        }
        closeSidebar();
      };
    });
  }

  // Bind FIXO do sidebar
  function bindSidebarButtonsCommon(userId) {
    const overlay = document.getElementById('address-overlay');
    const closeBtn = document.getElementById('address-close-btn');
    const backBtn  = document.getElementById('address-cancel-btn');
    const saveBtn  = document.getElementById('address-save-btn');
    const createBtn= document.getElementById('address-create-btn');

    if (overlay) overlay.onclick = (e) => { if (e.target === overlay) closeSidebar(); };
    if (closeBtn) closeBtn.onclick = closeSidebar;

    if (backBtn) backBtn.onclick = (e) => { e.preventDefault(); showListView(); };

    if (saveBtn) saveBtn.onclick = async (e) => {
      e.preventDefault();
      try {
        // Garante que o CEP exibido esteja validado/preenchido no form
        const cepInput = document.getElementById('addr_cep');
        if (!lastViaCepData || (cepInput && cepInput.value !== (lastViaCepData.cep || ''))) {
          await ensureViaCepForForm();
        }

        const numero = (document.getElementById('addr_numero')?.value || '').trim();
        const complemento = (document.getElementById('addr_complemento')?.value || '').trim();
        const apelido = (document.getElementById('addr_apelido')?.value || 'Principal').trim();
        const isDefault = !!document.getElementById('addr_is_default')?.checked;

        if (!numero) {
          safeShowModal({ title: 'Atenção', message: 'Informe o número do endereço.', confirmText: 'OK' });
          return;
        }

        const payload = {
          userId,
          apelido,
          isDefault,
          cep: lastViaCepData.cep,
          logradouro: lastViaCepData.logradouro,
          bairro: lastViaCepData.bairro,
          cidade: lastViaCepData.cidade,
          uf: lastViaCepData.uf,
          ibge: lastViaCepData.ibge,
          numero,
          complemento
        };

        await saveUserAddress(payload);

        const addresses = await getUserAddresses(userId);
        renderAddressList(addresses);
        showListView();

        safeShowModal({ title: 'Tudo certo!', message: 'Endereço salvo com sucesso.', confirmText: 'OK' });
      } catch (err) {
        console.error(err);
        safeShowModal({ title: 'Erro', message: err.message || 'Erro ao salvar endereço', confirmText: 'OK' });
      }
    };

    if (createBtn) createBtn.onclick = (e) => {
      e.preventDefault();
      prefillFormWithViaCEP(lastViaCepData || null);
      showFormView();
    };
  }

  // ===== Delegação GLOBAL para o botão BUSCAR e o campo CEP do FORM =====
  // funciona mesmo que o HTML seja injetado depois
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    if (target.id === 'addr_cep_search_btn') {
      e.preventDefault();
      ensureViaCepForForm().catch(err =>
        safeShowModal({ title: 'CEP', message: err.message || 'CEP inválido', confirmText: 'OK' })
      );
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t && t.id === 'addr_cep') {
      t.value = formatCEP(t.value);
    }
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (e.key === 'Enter' && t && t.id === 'addr_cep') {
      e.preventDefault();
      ensureViaCepForForm().catch(err =>
        safeShowModal({ title: 'CEP', message: err.message || 'CEP inválido', confirmText: 'OK' })
      );
    }
  });

  // ===== API =====
  async function getUserAddresses(userId) {
    const res = await fetch(`${API_BASE}/addresses/${userId}`, {
      headers: getAuthHeaders(false),
    });
    if (!res.ok) throw new Error('Não foi possível carregar endereços do usuário');
    return res.json();
  }
  async function saveUserAddress(payload) {
    const res = await fetch(`${API_BASE}/addresses`, {
      method: 'POST',
      headers: getAuthHeaders(true),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(t || 'Erro ao salvar endereço');
    }
    return res.json();
  }

  // ===== Fluxo principal ao clicar OK do CEP no checkout =====
  async function handleCepFlow() {
    const userId = getLoggedUserId();
    if (!userId) {
      safeShowModal({ title: 'Sessão', message: 'Você precisa estar logado.', confirmText: 'OK' });
      return;
    }
    const cepInputMain = document.getElementById('cep-input');
    const raw = cepInputMain ? cepInputMain.value : '';

    try {
      // consulta inicial (para abrir lista com base em um CEP válido)
      lastViaCepData = await fetchViaCEP(raw);
      if (cepInputMain) cepInputMain.value = lastViaCepData.cep;

      await mountSidebarHtmlIfNeeded();
      bindSidebarButtonsCommon(userId);

      const addresses = await getUserAddresses(userId);
      renderAddressList(addresses);
      showListView();
      openSidebar();
    } catch (err) {
      console.error(err);
      safeShowModal({ title: 'CEP inválido', message: err.message || 'Verifique o CEP informado.', confirmText: 'OK' });
    }
  }

  // ===== Gatilhos do checkout =====
  document.addEventListener('DOMContentLoaded', () => {
    const cepInput = document.getElementById('cep-input');
    const cepBtn   = document.getElementById('cep-ok-btn');

    if (cepInput) {
      cepInput.addEventListener('input', () => { cepInput.value = formatCEP(cepInput.value); });
      cepInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); handleCepFlow(); }
      });
    }
    if (cepBtn) {
      cepBtn.addEventListener('click', (e) => { e.preventDefault(); handleCepFlow(); });
    }
  });

  // Hooks opcionais
  window.recalculateDelivery = window.recalculateDelivery || function(cep) {
    console.debug('Recalcular frete para CEP:', cep);
  };
  window.onAddressSelected = window.onAddressSelected || function(address) {
    console.debug('Endereço selecionado:', address);
  };
  window.openAddressSidebarForNewAddress = async function () {
  const userId = (function(){
    try { const u = JSON.parse(localStorage.getItem('loggedInUser')); return u && u.id ? u.id : null; }
    catch { return null; }
  })();

  await (async function mount() {
    if (document.getElementById('address-panel')) return;
  const html = await fetch('../components/account/address-sidebar.html').then(r=>r.text());
    const div = document.createElement('div'); div.innerHTML = html; document.body.appendChild(div);
  })();

  // reutiliza os helpers que já existem no arquivo
  if (typeof bindSidebarButtonsCommon === 'function') bindSidebarButtonsCommon(userId);
  if (typeof showFormView === 'function') showFormView();
  if (typeof openSidebar === 'function') openSidebar();
  };

})();
