(function () {
  'use strict';

  const ALLOWED_CODES = [1, 2, 3, 4];
  const numberFormatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const selectElement = (id) => document.getElementById(id);

  const setButtonDisabled = (button, disabled) => {
    if (!button) return;
    button.disabled = !!disabled;
    button.classList.toggle('opacity-60', !!disabled);
    button.classList.toggle('cursor-not-allowed', !!disabled);
  };

  const parseNumericInput = (input) => {
    if (!input) return 0;
    const rawValue = String(input.value || '').replace(',', '.');
    const parsed = Number.parseFloat(rawValue);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  document.addEventListener('DOMContentLoaded', () => {
    const form = selectElement('icms-simples-form');
    const codeInput = selectElement('icms-simples-code');
    const valueInput = selectElement('icms-simples-value');
    const companySelect = selectElement('icms-simples-company');
    const submitButton = form?.querySelector('button[type="submit"]');
    const tableBody = selectElement('icms-simples-table-body');
    const emptyStateRow = selectElement('icms-simples-empty-state');
    const countLabel = selectElement('icms-simples-count');
    const codeFeedback = selectElement('icms-simples-code-feedback');

    let stores = [];
    let registros = [];

    const getToken = () => {
      try {
        const logged = JSON.parse(localStorage.getItem('loggedInUser'));
        return logged?.token || '';
      } catch (error) {
        console.warn('Não foi possível obter o token do usuário logado.', error);
        return '';
      }
    };

    const updateCountLabel = () => {
      if (!countLabel) return;
      if (!registros.length) {
        countLabel.textContent = 'Nenhum registro cadastrado';
        return;
      }
      const total = registros.length;
      countLabel.textContent = `${total} registro${total > 1 ? 's' : ''} cadastrado${total > 1 ? 's' : ''}`;
    };

    const renderRegistros = () => {
      if (!tableBody) return;

      if (!Array.isArray(registros) || !registros.length) {
        tableBody.innerHTML = '';
        if (emptyStateRow) {
          emptyStateRow.classList.remove('hidden');
          tableBody.appendChild(emptyStateRow);
        }
        updateCountLabel();
        return;
      }

      const sorted = [...registros].sort((a, b) => {
        if (a.codigo === b.codigo) {
          const nomeA = (a?.empresa?.nome || a?.empresa?.nomeFantasia || a?.empresa?.razaoSocial || '').toLowerCase();
          const nomeB = (b?.empresa?.nome || b?.empresa?.nomeFantasia || b?.empresa?.razaoSocial || '').toLowerCase();
          return nomeA.localeCompare(nomeB);
        }
        return a.codigo - b.codigo;
      });

      tableBody.innerHTML = sorted.map((registro) => {
        const empresaNome = registro?.empresa?.nome || registro?.empresa?.nomeFantasia || registro?.empresa?.razaoSocial || '—';
        const valorNumero = Number.isFinite(registro?.valor) ? registro.valor : 0;
        const valor = `${numberFormatter.format(valorNumero)}%`;
        return `
          <tr>
            <td class="px-4 py-3 text-gray-700">${registro.codigo}</td>
            <td class="px-4 py-3 text-gray-700">${empresaNome}</td>
            <td class="px-4 py-3 text-right text-gray-700">${valor}</td>
          </tr>
        `;
      }).join('');

      if (emptyStateRow) {
        emptyStateRow.classList.add('hidden');
      }
      updateCountLabel();
    };

    const populateCompanies = () => {
      if (!companySelect) return;
      const selectedValue = companySelect.value;
      companySelect.innerHTML = '<option value="">Selecione uma empresa</option>';
      stores.forEach((store) => {
        const option = document.createElement('option');
        option.value = store._id;
        option.textContent = store.nome || store.nomeFantasia || store.razaoSocial || 'Empresa sem nome';
        companySelect.appendChild(option);
      });
      if (selectedValue && stores.some((store) => store._id === selectedValue)) {
        companySelect.value = selectedValue;
      } else if (selectedValue) {
        companySelect.value = '';
      }
    };

    const isCompanyAllowed = (companyId) =>
      stores.some((store) => store._id === companyId);

    const computeNextCode = (companyId) => {
      if (!companyId) {
        return ALLOWED_CODES[0];
      }
      const usedCodes = registros
        .filter((item) => {
          const empresaId = item?.empresa?._id || item?.empresa;
          return empresaId === companyId;
        })
        .map((item) => Number(item.codigo))
        .filter((value) => Number.isFinite(value));
      return ALLOWED_CODES.find((code) => !usedCodes.includes(code));
    };

    const updateCodeField = () => {
      if (!codeInput) return;
      const selectedCompany = companySelect?.value || '';
      const nextCode = computeNextCode(selectedCompany);
      if (!selectedCompany) {
        codeInput.value = String(ALLOWED_CODES[0]);
        setButtonDisabled(submitButton, true);
        codeFeedback?.classList.add('hidden');
        return;
      }
      if (nextCode) {
        codeInput.value = String(nextCode);
        setButtonDisabled(submitButton, false);
        codeFeedback?.classList.add('hidden');
      } else {
        codeInput.value = '—';
        setButtonDisabled(submitButton, true);
        codeFeedback?.classList.remove('hidden');
      }
    };

    const fetchStores = async () => {
      try {
        const token = getToken();
        const response = await fetch(`${API_CONFIG.BASE_URL}/stores/allowed`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error('Não foi possível carregar as empresas.');
        const payload = await response.json();
        const list = Array.isArray(payload?.stores) ? payload.stores : (Array.isArray(payload) ? payload : []);
        stores = Array.isArray(list) ? list : [];
        populateCompanies();
      } catch (error) {
        console.error('Erro ao carregar empresas:', error);
        showModal({
          title: 'Erro ao carregar empresas',
          message: error.message || 'Não foi possível carregar as empresas cadastradas.',
          confirmText: 'Entendi',
        });
      }
    };

    const fetchRegistros = async () => {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/fiscal/icms-simples`);
        if (!response.ok) throw new Error('Não foi possível carregar os registros de ICMS.');
        const payload = await response.json();
        if (Array.isArray(payload)) {
          registros = payload;
        } else if (Array.isArray(payload?.registros)) {
          registros = payload.registros;
        } else {
          registros = [];
        }
        renderRegistros();
        updateCodeField();
      } catch (error) {
        console.error('Erro ao carregar registros de ICMS:', error);
        showModal({
          title: 'Erro ao carregar registros',
          message: error.message || 'Não foi possível carregar os registros cadastrados.',
          confirmText: 'Entendi',
        });
      }
    };

    const resetValueInput = () => {
      if (!valueInput) return;
      valueInput.value = '';
    };

    resetValueInput();

    companySelect?.addEventListener('change', () => {
      if (companySelect?.value && !isCompanyAllowed(companySelect.value)) {
        companySelect.value = '';
        showModal({
          title: 'Empresa não autorizada',
          message: 'Você não tem permissão para configurar ICMS para esta empresa.',
          confirmText: 'Entendi',
        });
      }
      updateCodeField();
    });

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!companySelect || !valueInput) return;

      const empresa = companySelect.value;
      const valor = parseNumericInput(valueInput);
      const codigo = codeInput?.value || '';

      if (!empresa) {
        showModal({
          title: 'Selecione uma empresa',
          message: 'Escolha uma empresa antes de adicionar um novo valor de ICMS.',
          confirmText: 'Entendi',
        });
        return;
      }
      if (!isCompanyAllowed(empresa)) {
        showModal({
          title: 'Empresa não autorizada',
          message: 'Você não tem permissão para configurar ICMS para esta empresa.',
          confirmText: 'Entendi',
        });
        return;
      }

      if (!ALLOWED_CODES.includes(Number(codigo))) {
        showModal({
          title: 'Limite de códigos atingido',
          message: 'Todos os códigos disponíveis já foram cadastrados para esta empresa.',
          confirmText: 'OK',
        });
        return;
      }

      if (!(valor > 0)) {
        showModal({
          title: 'Informe um valor válido',
          message: 'Digite um valor de ICMS maior que zero para cadastrar.',
          confirmText: 'Entendi',
        });
        return;
      }

      const token = getToken();
      if (!token) {
        showModal({
          title: 'Sessão expirada',
          message: 'Faça login novamente para continuar cadastrando valores de ICMS.',
          confirmText: 'OK',
        });
        return;
      }

      try {
        setButtonDisabled(submitButton, true);
        const response = await fetch(`${API_CONFIG.BASE_URL}/fiscal/icms-simples`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ empresa, valor }),
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.message || 'Erro ao cadastrar valor de ICMS.');
        }

        const novoRegistro = await response.json();
        registros = Array.isArray(registros) ? [...registros, novoRegistro] : [novoRegistro];
        renderRegistros();
        resetValueInput();
        updateCodeField();
        showModal({ title: 'Sucesso', message: 'Valor de ICMS cadastrado com sucesso.', confirmText: 'OK' });
      } catch (error) {
        console.error('Erro ao cadastrar valor de ICMS:', error);
        showModal({
          title: 'Erro ao cadastrar',
          message: error.message || 'Não foi possível cadastrar o valor de ICMS.',
          confirmText: 'Entendi',
        });
      } finally {
        updateCodeField();
      }
    });

    const initialize = async () => {
      await Promise.all([fetchStores(), fetchRegistros()]);
      updateCodeField();
    };

    initialize();
  });
})();
