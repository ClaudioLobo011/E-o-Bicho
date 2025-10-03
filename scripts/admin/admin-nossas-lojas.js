document.addEventListener('DOMContentLoaded', () => {
    // --- Referências ao DOM ---
    const tableBody = document.getElementById('stores-table-body');
    const addStoreBtn = document.getElementById('add-store-btn');
    const modal = document.getElementById('store-modal');
    const form = document.getElementById('store-form');
    const cancelBtn = document.getElementById('cancel-store-modal-btn');
    const modalTitle = document.getElementById('store-modal-title');
    const hiddenStoreId = document.getElementById('store-id');
    const horarioContainer = document.getElementById('horario-inputs-container');
    const openServicesModalBtn = document.getElementById('open-services-modal-btn');
    const servicesModal = document.getElementById('services-modal');
    const saveServicesModalBtn = document.getElementById('save-services-modal-btn');
    const servicesCheckboxContainer = document.getElementById('services-checkbox-container');
    const serviceTagsContainer = document.getElementById('service-tags-container');
    const imagePreview = document.getElementById('image-preview');
    const imageInput = document.getElementById('store-image-input');
    const cepInput = document.getElementById('store-cep');
    const enderecoHiddenInput = document.getElementById('store-endereco');
    const razaoSocialInput = document.getElementById('store-razao-social');
    const nomeFantasiaInput = document.getElementById('store-nome');
    const cnpjInput = document.getElementById('store-cnpj');
    const cnaeInput = document.getElementById('store-cnae');
    const cnaeDescricaoInput = document.getElementById('store-cnae-descricao');
    const cnaeSecundarioInput = document.getElementById('store-cnae-secundario');
    const cnaeSecundarioDescricaoInput = document.getElementById('store-cnae-secundario-descricao');
    const inscricaoEstadualInput = document.getElementById('store-inscricao-estadual');
    const inscricaoMunicipalInput = document.getElementById('store-inscricao-municipal');
    const regimeTributarioSelect = document.getElementById('store-regime-tributario');
    const emailFiscalInput = document.getElementById('store-email-fiscal');
    const telefoneInput = document.getElementById('store-telefone');
    const celularInput = document.getElementById('store-whatsapp');
    const municipioInput = document.getElementById('store-municipio');
    const ufInput = document.getElementById('store-uf');
    const logradouroInput = document.getElementById('store-logradouro');
    const bairroInput = document.getElementById('store-bairro');
    const numeroInput = document.getElementById('store-numero');
    const complementoInput = document.getElementById('store-complemento');
    const codIbgeMunicipioInput = document.getElementById('store-cod-ibge-municipio');
    const codUfInput = document.getElementById('store-cod-uf');
    const certificadoArquivoInput = document.getElementById('store-certificado-arquivo');
    const certificadoSenhaInput = document.getElementById('store-certificado-senha');
    const certificadoValidadeInput = document.getElementById('store-certificado-validade');
    const certificadoStatusText = document.getElementById('store-certificado-status');
    const certificadoAtualText = document.getElementById('store-certificado-atual');
    const cscIdProducaoInput = document.getElementById('store-csc-id-producao');
    const cscTokenProducaoInput = document.getElementById('store-csc-token-producao');
    const cscTokenProducaoHelper = document.getElementById('store-csc-token-producao-helper');
    const cscTokenProducaoClearBtn = document.getElementById('store-csc-token-producao-clear');
    const cscIdHomologacaoInput = document.getElementById('store-csc-id-homologacao');
    const cscTokenHomologacaoInput = document.getElementById('store-csc-token-homologacao');
    const cscTokenHomologacaoHelper = document.getElementById('store-csc-token-homologacao-helper');
    const cscTokenHomologacaoClearBtn = document.getElementById('store-csc-token-homologacao-clear');
    const contadorNomeInput = document.getElementById('store-contador-nome');
    const contadorCpfInput = document.getElementById('store-contador-cpf');
    const contadorCrcInput = document.getElementById('store-contador-crc');
    const contadorCnpjInput = document.getElementById('store-contador-cnpj');
    const contadorCepInput = document.getElementById('store-contador-cep');
    const contadorEnderecoInput = document.getElementById('store-contador-endereco');
    const contadorCidadeInput = document.getElementById('store-contador-cidade');
    const contadorNumeroInput = document.getElementById('store-contador-numero');
    const contadorBairroInput = document.getElementById('store-contador-bairro');
    const contadorComplementoInput = document.getElementById('store-contador-complemento');
    const contadorRazaoSocialInput = document.getElementById('store-contador-razao-social');
    const contadorTelefoneInput = document.getElementById('store-contador-telefone');
    const contadorFaxInput = document.getElementById('store-contador-fax');
    const contadorCelularInput = document.getElementById('store-contador-celular');
    const contadorEmailInput = document.getElementById('store-contador-email');
    const closeModalBtn = document.getElementById('close-store-modal');
    const tabButtons = Array.from(document.querySelectorAll('#store-modal .tab-button'));
    const tabPanels = Array.from(document.querySelectorAll('#store-modal .tab-panel'));
    // -- REFERÊNCIAS PARA O MAPA DE LOCALIZAÇÃO --
    let locationMap = null;
    let locationMarker = null;
    const latInput = document.getElementById('store-latitude');
    const lonInput = document.getElementById('store-longitude');

    // --- Utilidades de formulário ---
    const enderecoFields = [logradouroInput, numeroInput, complementoInput, bairroInput, municipioInput, ufInput];

    const formatSingleCnaeValue = (value = '') => {
        const digits = String(value || '').replace(/\D/g, '').slice(0, 7);
        if (!digits) return '';
        if (digits.length <= 4) return digits;

        let formatted = digits.slice(0, 4);
        formatted += `-${digits.slice(4, 5)}`;
        if (digits.length > 5) {
            formatted += `/${digits.slice(5, 7)}`;
        }
        return formatted;
    };

    const formatMultipleCnaesValue = (value = '') => {
        if (Array.isArray(value)) {
            const formattedArray = value
                .map((item) => formatSingleCnaeValue(item))
                .filter((item) => item.length > 0);
            return formattedArray.join(', ');
        }

        const raw = String(value || '');
        const tokens = raw.split(/[,;\n]+/);
        const formattedTokens = tokens
            .map((token) => formatSingleCnaeValue(token))
            .filter((token) => token.length > 0);
        const hasTrailingSeparator = /[,;\n]+\s*$/.test(raw);
        let result = formattedTokens.join(', ');
        if (hasTrailingSeparator && result.length > 0) {
            result += ', ';
        }
        return result;
    };

    const applyCnaeMaskToInput = (input, { allowMultiple = false } = {}) => {
        if (!input) return;
        const formatter = allowMultiple ? formatMultipleCnaesValue : formatSingleCnaeValue;
        const updateValue = () => {
            const formatted = formatter(input.value);
            if (formatted === input.value) return;
            input.value = formatted;
            if (document.activeElement === input) {
                try {
                    input.setSelectionRange(formatted.length, formatted.length);
                } catch (error) {
                    // Ignore selection errors for unsupported input types
                }
            }
        };
        input.addEventListener('input', updateValue);
        input.addEventListener('blur', updateValue);
    };

    applyCnaeMaskToInput(cnaeInput);
    applyCnaeMaskToInput(cnaeSecundarioInput, { allowMultiple: true });

    const CSC_TOKEN_DEFAULT_MESSAGES = {
        producao: 'Informe o token do CSC de produção fornecido pela SEFAZ.',
        homologacao: 'Informe o token do CSC de homologação fornecido pela SEFAZ.'
    };

    const setCscTokenState = (input, { stored = false, cleared = false } = {}) => {
        if (!input) return;
        input.dataset.stored = stored ? 'true' : 'false';
        input.dataset.cleared = cleared ? 'true' : 'false';
    };

    const updateCscTokenHelper = (input, helper, defaultMessage) => {
        if (!helper) return;
        if (!input) {
            helper.textContent = defaultMessage;
            return;
        }

        const value = (input.value || '').trim();
        const stored = input.dataset.stored === 'true';
        const cleared = input.dataset.cleared === 'true';

        let message = defaultMessage;
        if (value.length > 0) {
            message = 'Um novo token será salvo ao confirmar.';
        } else if (cleared) {
            message = 'O token atual será removido ao salvar.';
        } else if (stored) {
            message = 'Um token está armazenado. Deixe em branco para manter ou informe um novo para substituir.';
        }

        helper.textContent = message;
    };

    const updateCscTokenClearButton = (button, isCleared) => {
        if (!button) return;
        button.textContent = isCleared ? 'Desfazer' : 'Remover';
    };

    const resetCscTokenInput = (input, helper, defaultMessage, clearButton) => {
        if (!input) return;
        input.value = '';
        setCscTokenState(input, { stored: false, cleared: false });
        updateCscTokenHelper(input, helper, defaultMessage);
        updateCscTokenClearButton(clearButton, false);
    };

    const toggleCscTokenCleared = (input, helper, defaultMessage, clearButton) => {
        if (!input) return;
        const isCurrentlyCleared = input.dataset.cleared === 'true';
        if (!isCurrentlyCleared) {
            input.value = '';
        }
        setCscTokenState(input, {
            stored: input.dataset.stored === 'true',
            cleared: !isCurrentlyCleared
        });
        updateCscTokenHelper(input, helper, defaultMessage);
        updateCscTokenClearButton(clearButton, !isCurrentlyCleared);
        input.focus();
    };

    const registerCscTokenInputEvents = (input, helper, defaultMessage, clearButton) => {
        if (!input) return;
        input.addEventListener('input', () => {
            if (input.dataset.cleared === 'true') {
                setCscTokenState(input, {
                    stored: input.dataset.stored === 'true',
                    cleared: false
                });
                updateCscTokenClearButton(clearButton, false);
            }
            updateCscTokenHelper(input, helper, defaultMessage);
        });
        input.addEventListener('change', () => updateCscTokenHelper(input, helper, defaultMessage));
        input.addEventListener('blur', () => updateCscTokenHelper(input, helper, defaultMessage));
    };

    registerCscTokenInputEvents(
        cscTokenProducaoInput,
        cscTokenProducaoHelper,
        CSC_TOKEN_DEFAULT_MESSAGES.producao,
        cscTokenProducaoClearBtn
    );
    registerCscTokenInputEvents(
        cscTokenHomologacaoInput,
        cscTokenHomologacaoHelper,
        CSC_TOKEN_DEFAULT_MESSAGES.homologacao,
        cscTokenHomologacaoClearBtn
    );

    cscTokenProducaoClearBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        toggleCscTokenCleared(
            cscTokenProducaoInput,
            cscTokenProducaoHelper,
            CSC_TOKEN_DEFAULT_MESSAGES.producao,
            cscTokenProducaoClearBtn
        );
    });

    cscTokenHomologacaoClearBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        toggleCscTokenCleared(
            cscTokenHomologacaoInput,
            cscTokenHomologacaoHelper,
            CSC_TOKEN_DEFAULT_MESSAGES.homologacao,
            cscTokenHomologacaoClearBtn
        );
    });

    const buildEnderecoCompleto = () => {
        const logradouro = (logradouroInput?.value || '').trim();
        const numero = (numeroInput?.value || '').trim();
        const complemento = (complementoInput?.value || '').trim();
        const bairro = (bairroInput?.value || '').trim();
        const municipio = (municipioInput?.value || '').trim();
        const uf = (ufInput?.value || '').trim();

        const partes = [];
        if (logradouro) {
            partes.push(numero ? `${logradouro}, ${numero}` : logradouro);
        }
        if (complemento) {
            partes.push(complemento);
        }
        if (bairro) {
            partes.push(bairro);
        }
        if (municipio || uf) {
            const regiao = [municipio, uf].filter(Boolean).join(' - ');
            if (regiao) partes.push(regiao);
        }

        const enderecoCompleto = partes.join(' | ');
        if (enderecoHiddenInput) enderecoHiddenInput.value = enderecoCompleto;
        return enderecoCompleto;
    };

    enderecoFields.forEach(field => field?.addEventListener('input', buildEnderecoCompleto));

    const updateCertificadoStatus = (message = '', tone = 'muted') => {
        if (!certificadoStatusText) return;
        certificadoStatusText.textContent = message;
        certificadoStatusText.classList.remove('text-gray-500', 'text-red-600', 'text-emerald-600');
        if (tone === 'error') {
            certificadoStatusText.classList.add('text-red-600');
        } else if (tone === 'success') {
            certificadoStatusText.classList.add('text-emerald-600');
        } else {
            certificadoStatusText.classList.add('text-gray-500');
        }
    };

    const formatDateForDisplay = (isoDate = '') => {
        const parts = isoDate.split('-');
        if (parts.length !== 3) return isoDate;
        const [year, month, day] = parts;
        if (!year || !month || !day) return isoDate;
        return `${day}/${month}/${year}`;
    };

    const previewCertificate = async () => {
        if (!certificadoArquivoInput || !certificadoSenhaInput) return;
        const file = certificadoArquivoInput.files?.[0];
        const senha = (certificadoSenhaInput.value || '').trim();
        if (!file || !senha) {
            updateCertificadoStatus('', 'muted');
            return;
        }

        try {
            updateCertificadoStatus('Validando certificado...', 'muted');
            const formData = new FormData();
            formData.append('certificado', file);
            formData.append('senha', senha);

            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            if (!token) throw new Error('Sessão expirada. Faça login novamente.');

            const response = await fetch(`${API_CONFIG.BASE_URL}/stores/certificate/preview`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result?.message || 'Falha ao validar o certificado.');
            }

            if (result.validade) {
                certificadoValidadeInput.value = result.validade;
            }
            updateCertificadoStatus('Certificado validado com sucesso.', 'success');
        } catch (error) {
            certificadoValidadeInput.value = '';
            updateCertificadoStatus(error.message || 'Não foi possível validar o certificado.', 'error');
        }
    };

    const uploadCertificateForStore = async (storeId) => {
        const file = certificadoArquivoInput?.files?.[0];
        const senha = (certificadoSenhaInput?.value || '').trim();
        if (!storeId || !file || !senha) {
            return null;
        }

        const formData = new FormData();
        formData.append('certificado', file);
        formData.append('senha', senha);

        const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
        const token = loggedInUser?.token;
        if (!token) {
            throw new Error('Sessão expirada. Faça login novamente.');
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}/stores/${storeId}/certificate`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result?.message || 'Não foi possível salvar o certificado.');
        }

        if (result.validade) {
            certificadoValidadeInput.value = result.validade;
        }

        if (certificadoAtualText) {
            const partes = [];
            if (result.arquivo || file.name) {
                partes.push(`Arquivo armazenado: ${result.arquivo || file.name}`);
            }
            if (result.validade) {
                partes.push(`Validade: ${formatDateForDisplay(result.validade)}`);
            }
            if (result.fingerprint) {
                partes.push(`Fingerprint: ${result.fingerprint}`);
            }
            certificadoAtualText.textContent = partes.length ? partes.join(' • ') : 'Certificado armazenado.';
        }

        updateCertificadoStatus('Certificado armazenado com sucesso.', 'success');
        certificadoArquivoInput.value = '';
        certificadoSenhaInput.value = '';

        return result;
    };

    const activateTab = (target) => {
        tabButtons.forEach((button) => {
            const isActive = button.dataset.tabTarget === target;
            button.classList.toggle('bg-emerald-50', isActive);
            button.classList.toggle('text-emerald-700', isActive);
            button.classList.toggle('text-gray-600', !isActive);
            button.classList.toggle('hover:text-gray-800', !isActive);
        });
        tabPanels.forEach((panel) => {
            panel.classList.toggle('hidden', panel.dataset.tabPanel !== target);
        });
        if (target === 'endereco') {
            setTimeout(() => {
                if (locationMap) {
                    locationMap.invalidateSize();
                }
            }, 50);
        }
    };

    tabButtons.forEach((button) => {
        button.addEventListener('click', () => activateTab(button.dataset.tabTarget));
    });

    activateTab('endereco');

    // --- Dados e Constantes ---
    const diasDaSemana = [
        { key: 'domingo', label: 'Domingo' },
        { key: 'segunda', label: 'Segunda-feira' },
        { key: 'terca', label: 'Terça-feira' },
        { key: 'quarta', label: 'Quarta-feira' },
        { key: 'quinta', label: 'Quinta-feira' },
        { key: 'sexta', label: 'Sexta-feira' },
        { key: 'sabado', label: 'Sábado' },
    ];
    const availableServices = ['Banho e Tosa', 'Veterinária', 'Farmácia'];
    let selectedServices = [];

    const ufIbgeCodes = {
        AC: '12',
        AL: '27',
        AP: '16',
        AM: '13',
        BA: '29',
        CE: '23',
        DF: '53',
        ES: '32',
        GO: '52',
        MA: '21',
        MT: '51',
        MS: '50',
        MG: '31',
        PA: '15',
        PB: '25',
        PR: '41',
        PE: '26',
        PI: '22',
        RJ: '33',
        RN: '24',
        RS: '43',
        RO: '11',
        RR: '14',
        SC: '42',
        SP: '35',
        SE: '28',
        TO: '17',
    };

    // --- Funções do Modal de Serviços ---
    const openServicesModal = () => {
        servicesCheckboxContainer.innerHTML = '';
        availableServices.forEach(service => {
            const isChecked = selectedServices.includes(service) ? 'checked' : '';
            const checkboxHtml = `
                <label class="flex items-center">
                    <input type="checkbox" value="${service}" ${isChecked} class="form-checkbox h-5 w-5 text-primary rounded service-checkbox">
                    <span class="ml-2 text-gray-700">${service}</span>
                </label>`;
            servicesCheckboxContainer.innerHTML += checkboxHtml;
        });
        servicesModal.classList.remove('hidden');
    };
    const closeServicesModal = () => servicesModal.classList.add('hidden');
    const saveServicesSelection = () => {
        selectedServices = Array.from(servicesCheckboxContainer.querySelectorAll('.service-checkbox:checked')).map(cb => cb.value);
        renderServiceTags();
        closeServicesModal();
    };
    const renderServiceTags = () => {
        serviceTagsContainer.innerHTML = '';
        selectedServices.forEach(service => {
            const tagHtml = `<span class="bg-primary/10 text-primary text-sm font-semibold px-2.5 py-1 rounded-full">${service}</span>`;
            serviceTagsContainer.innerHTML += tagHtml;
        });
    };

    // --- Pré-visualização da Imagem ---
    imageInput.addEventListener('change', () => {
        const file = imageInput.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePreview.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });

    certificadoArquivoInput?.addEventListener('change', () => {
        if (!certificadoArquivoInput.files?.length) {
            updateCertificadoStatus('', 'muted');
            return;
        }
        previewCertificate();
    });

    certificadoSenhaInput?.addEventListener('blur', previewCertificate);
    certificadoSenhaInput?.addEventListener('change', previewCertificate);
    certificadoSenhaInput?.addEventListener('input', () => updateCertificadoStatus('', 'muted'));

    // --- Criação Dinâmica dos Horários ---
    const createHorarioInputs = () => {
        horarioContainer.innerHTML = '';
        diasDaSemana.forEach(({ key, label }) => {
            const dayHtml = `
                <div data-day="${key}" class="grid grid-cols-1 sm:grid-cols-4 gap-2 items-center">
                    <label class="font-medium text-sm sm:col-span-1">${label}</label>
                    <div class="sm:col-span-2 flex items-center gap-2">
                        <input type="time" name="abre" class="time-input block w-full border-gray-300 rounded-md shadow-sm text-sm">
                        <span>às</span>
                        <input type="time" name="fecha" class="time-input block w-full border-gray-300 rounded-md shadow-sm text-sm">
                    </div>
                    <div class="sm:col-span-1 flex items-center justify-end sm:justify-start">
                        <input type="checkbox" name="fechada" class="fechada-checkbox h-4 w-4 text-primary rounded">
                        <label class="ml-2 text-sm">Fechada</label>
                    </div>
                </div>`;
            horarioContainer.innerHTML += dayHtml;
        });
    };
    
    async function buscarEnderecoPorCep(cep) {
        const sanitizedCep = cep.replace(/\D/g, '');
        if (sanitizedCep.length !== 8) return null;

        const url = `https://viacep.com.br/ws/${sanitizedCep}/json/`;
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Não foi possível consultar o CEP no momento.');
            }
            const data = await response.json();
            if (data.erro) {
                return null;
            }
            return data;
        } catch (error) {
            console.error('Erro ao consultar CEP:', error);
            throw error;
        }
    }

    // --- FUNÇÃO DE GEOCODIFICAÇÃO ROBUSTA ---
    async function geocodeAddress(address, cep) {
        const fullAddress = `${address || ''}, ${cep || ''}`;
        if (fullAddress.trim() === ',') return null;

        const queryString = encodeURIComponent(fullAddress);
        const url = `https://nominatim.openstreetmap.org/search?q=${queryString}&countrycodes=br&format=json&limit=1`;
        console.log(`Buscando coordenadas para o endereço completo: "${fullAddress}"`);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Falha na rede.');
            const data = await response.json();

            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                return { lat, lng };
            } else {
                console.warn(`Nenhuma coordenada encontrada para o endereço: "${fullAddress}"`);
                return null;
            }
        } catch (error) {
            console.error('Erro na geocodificação:', error);
            return null;
        }
    }

    // --- FUNÇÃO PARA INICIAR O MAPA NO MODAL ---
    const initializeLocationPicker = () => {
        if (locationMap || !document.getElementById('location-picker-map')) return;

        locationMap = L.map('location-picker-map').setView([-22.9068, -43.1729], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(locationMap);

        locationMap.on('click', (e) => {
            const coords = e.latlng;
            latInput.value = coords.lat;
            lonInput.value = coords.lng;

            if (!locationMarker) {
                locationMarker = L.marker(coords).addTo(locationMap);
            } else {
                locationMarker.setLatLng(coords);
            }
        });
    };

    // --- Funções do Modal Principal (Adicionar/Editar Loja) ---
    const openModalForNew = () => {
        modalTitle.textContent = 'Adicionar Nova Loja';
        hiddenStoreId.value = '';
        form.reset();
        selectedServices = [];
        renderServiceTags();
        activateTab('endereco');
        buildEnderecoCompleto();

        if (cnaeInput) cnaeInput.value = '';
        if (cnaeDescricaoInput) cnaeDescricaoInput.value = '';
        if (cnaeSecundarioInput) cnaeSecundarioInput.value = '';
        if (cnaeSecundarioDescricaoInput) cnaeSecundarioDescricaoInput.value = '';
        diasDaSemana.forEach(({ key }) => {
            const dayRow = horarioContainer.querySelector(`[data-day="${key}"]`);
            const inputs = dayRow.querySelectorAll('.time-input');
            const checkbox = dayRow.querySelector('.fechada-checkbox');
            inputs.forEach(input => {
                input.disabled = false;
                input.value = '';
            });
            checkbox.checked = false;
        });

        imagePreview.src = '/public/image/placeholder.png';
        imageInput.value = '';
        if (certificadoArquivoInput) certificadoArquivoInput.value = '';
        if (certificadoSenhaInput) certificadoSenhaInput.value = '';
        if (certificadoValidadeInput) certificadoValidadeInput.value = '';
        if (certificadoAtualText) certificadoAtualText.textContent = 'Nenhum certificado armazenado.';
        if (cscIdProducaoInput) cscIdProducaoInput.value = '';
        if (cscIdHomologacaoInput) cscIdHomologacaoInput.value = '';
        resetCscTokenInput(
            cscTokenProducaoInput,
            cscTokenProducaoHelper,
            CSC_TOKEN_DEFAULT_MESSAGES.producao,
            cscTokenProducaoClearBtn
        );
        resetCscTokenInput(
            cscTokenHomologacaoInput,
            cscTokenHomologacaoHelper,
            CSC_TOKEN_DEFAULT_MESSAGES.homologacao,
            cscTokenHomologacaoClearBtn
        );
        updateCertificadoStatus('', 'muted');
        modal.classList.remove('hidden');

        setTimeout(() => {
            if (locationMap) {
                locationMap.setView([-22.9068, -43.1729], 12);
                locationMap.invalidateSize();
                if (locationMarker) {
                    locationMarker.remove();
                    locationMarker = null;
                }
                latInput.value = '';
                lonInput.value = '';
            }
        }, 100);
    };

    const openModalForEdit = async (storeId) => {
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/stores/${storeId}`);
            if (!response.ok) throw new Error('Falha ao carregar dados da loja.');
            const store = await response.json();

            modalTitle.textContent = 'Editar Loja';
            hiddenStoreId.value = store._id;
            razaoSocialInput.value = store.razaoSocial || '';
            nomeFantasiaInput.value = store.nomeFantasia || store.nome || '';
            cnpjInput.value = store.cnpj || '';
            if (cscIdProducaoInput) cscIdProducaoInput.value = store.cscIdProducao || '';
            if (cscIdHomologacaoInput) cscIdHomologacaoInput.value = store.cscIdHomologacao || '';
            if (cscTokenProducaoInput) {
                cscTokenProducaoInput.value = '';
                setCscTokenState(cscTokenProducaoInput, {
                    stored: Boolean(store.cscTokenProducaoArmazenado),
                    cleared: false
                });
                updateCscTokenHelper(
                    cscTokenProducaoInput,
                    cscTokenProducaoHelper,
                    CSC_TOKEN_DEFAULT_MESSAGES.producao
                );
                updateCscTokenClearButton(cscTokenProducaoClearBtn, false);
            }
            if (cscTokenHomologacaoInput) {
                cscTokenHomologacaoInput.value = '';
                setCscTokenState(cscTokenHomologacaoInput, {
                    stored: Boolean(store.cscTokenHomologacaoArmazenado),
                    cleared: false
                });
                updateCscTokenHelper(
                    cscTokenHomologacaoInput,
                    cscTokenHomologacaoHelper,
                    CSC_TOKEN_DEFAULT_MESSAGES.homologacao
                );
                updateCscTokenClearButton(cscTokenHomologacaoClearBtn, false);
            }
            if (cnaeInput) {
                const cnaePrincipalValue = store.cnaePrincipal || store.cnae || '';
                cnaeInput.value = formatSingleCnaeValue(cnaePrincipalValue);
            }
            if (cnaeDescricaoInput) {
                cnaeDescricaoInput.value = store.cnaePrincipalDescricao
                    || store.cnaeDescricao
                    || store.cnaeDescricaoPrincipal
                    || '';
            }
            if (cnaeSecundarioInput) {
                const rawCnaeSecundario = Array.isArray(store.cnaesSecundarios)
                    ? store.cnaesSecundarios
                    : (store.cnaeSecundario || store.cnaeSecundaria || store.cnaeSecundarios || '');
                cnaeSecundarioInput.value = formatMultipleCnaesValue(rawCnaeSecundario);
            }
            if (cnaeSecundarioDescricaoInput) {
                cnaeSecundarioDescricaoInput.value = store.cnaeSecundarioDescricao
                    || store.cnaeDescricaoSecundario
                    || '';
            }
            inscricaoEstadualInput.value = store.inscricaoEstadual || '';
            inscricaoMunicipalInput.value = store.inscricaoMunicipal || '';
            regimeTributarioSelect.value = store.regimeTributario || '';
            emailFiscalInput.value = store.emailFiscal || '';
            telefoneInput.value = store.telefone || '';
            celularInput.value = store.whatsapp || store.celular || '';
            cepInput.value = store.cep || '';
            municipioInput.value = store.municipio || '';
            ufInput.value = store.uf || '';
            logradouroInput.value = store.logradouro || '';
            if (bairroInput) bairroInput.value = store.bairro || '';
            numeroInput.value = store.numero || '';
            complementoInput.value = store.complemento || '';
            codIbgeMunicipioInput.value = store.codigoIbgeMunicipio || store.codIbgeMunicipio || '';
            codUfInput.value = store.codigoUf || store.codUf || '';
            if (contadorNomeInput) contadorNomeInput.value = store.contadorNome || store.contador?.nome || '';
            if (contadorCpfInput) contadorCpfInput.value = store.contadorCpf || store.contador?.cpf || '';
            if (contadorCrcInput) contadorCrcInput.value = store.contadorCrc || store.contador?.crc || '';
            if (contadorCnpjInput) contadorCnpjInput.value = store.contadorCnpj || store.contador?.cnpj || '';
            if (contadorCepInput) contadorCepInput.value = store.contadorCep || store.contador?.cep || '';
            if (contadorEnderecoInput) contadorEnderecoInput.value = store.contadorEndereco || store.contador?.endereco || '';
            if (contadorCidadeInput) contadorCidadeInput.value = store.contadorCidade || store.contador?.cidade || '';
            if (contadorNumeroInput) contadorNumeroInput.value = store.contadorNumero || store.contador?.numero || '';
            if (contadorBairroInput) contadorBairroInput.value = store.contadorBairro || store.contador?.bairro || '';
            if (contadorComplementoInput) contadorComplementoInput.value = store.contadorComplemento || store.contador?.complemento || '';
            if (contadorRazaoSocialInput) contadorRazaoSocialInput.value = store.contadorRazaoSocial || store.contador?.razaoSocial || '';
            if (contadorTelefoneInput) contadorTelefoneInput.value = store.contadorTelefone || store.contador?.telefone || '';
            if (contadorFaxInput) contadorFaxInput.value = store.contadorFax || store.contador?.fax || '';
            if (contadorCelularInput) contadorCelularInput.value = store.contadorCelular || store.contador?.celular || '';
            if (contadorEmailInput) contadorEmailInput.value = store.contadorEmail || store.contador?.email || '';
            certificadoValidadeInput.value = store.certificadoValidade || '';
            if (certificadoSenhaInput) certificadoSenhaInput.value = '';
            if (certificadoAtualText) {
                const partes = [];
                if (store.certificadoArquivoNome) {
                    partes.push(`Arquivo armazenado: ${store.certificadoArquivoNome}`);
                }
                if (store.certificadoValidade) {
                    partes.push(`Validade: ${formatDateForDisplay(store.certificadoValidade)}`);
                }
                if (store.certificadoFingerprint) {
                    partes.push(`Fingerprint: ${store.certificadoFingerprint}`);
                }
                certificadoAtualText.textContent = partes.length ? partes.join(' • ') : 'Nenhum certificado armazenado.';
            }
            updateCertificadoStatus('', 'muted');
            if (enderecoHiddenInput) enderecoHiddenInput.value = store.endereco || '';
            if (!logradouroInput.value && store.endereco) logradouroInput.value = store.endereco;
            buildEnderecoCompleto();

            selectedServices = store.servicos || [];
            renderServiceTags();
            activateTab('endereco');

            diasDaSemana.forEach(({ key }) => {
                const horarioDia = store.horario ? store.horario[key] : null;
                const dayRow = horarioContainer.querySelector(`[data-day="${key}"]`);
                const abreInput = dayRow.querySelector('input[name="abre"]');
                const fechaInput = dayRow.querySelector('input[name="fecha"]');
                const fechadaCheckbox = dayRow.querySelector('input[name="fechada"]');
                if (horarioDia) {
                    abreInput.value = horarioDia.abre || '';
                    fechaInput.value = horarioDia.fecha || '';
                    fechadaCheckbox.checked = Boolean(horarioDia.fechada);
                    abreInput.disabled = horarioDia.fechada;
                    fechaInput.disabled = horarioDia.fechada;
                } else {
                    abreInput.value = '';
                    fechaInput.value = '';
                    fechadaCheckbox.checked = false;
                    abreInput.disabled = false;
                    fechaInput.disabled = false;
                }
            });

            if (store.imagem) {
                const isAbsolute = /^https?:/i.test(store.imagem);
                imagePreview.src = isAbsolute ? store.imagem : `${API_CONFIG.SERVER_URL}${store.imagem}`;
            } else {
                imagePreview.src = '/public/image/placeholder.png';
            }
            imageInput.value = '';
            if (certificadoArquivoInput) certificadoArquivoInput.value = '';

            modal.classList.remove('hidden');

            setTimeout(async () => {
                if (locationMap) {
                    locationMap.invalidateSize();
                    if (locationMarker) {
                        locationMarker.remove();
                        locationMarker = null;
                    }

                    let initialCoords = null;
                    let initialZoom = 12;

                    if (store.latitude && store.longitude) {
                        initialCoords = { lat: store.latitude, lng: store.longitude };
                        initialZoom = 17;
                    } else {
                        const enderecoConsulta = buildEnderecoCompleto() || store.endereco;
                        const foundCoords = await geocodeAddress(enderecoConsulta, store.cep);
                        if (foundCoords) {
                            initialCoords = foundCoords;
                            initialZoom = 17;
                        }
                    }

                    if (!initialCoords) {
                        initialCoords = { lat: -22.9068, lng: -43.1729 };
                    }

                    locationMap.setView([initialCoords.lat, initialCoords.lng], initialZoom);

                    if (store.latitude && store.longitude) {
                        locationMarker = L.marker(initialCoords).addTo(locationMap);
                        latInput.value = store.latitude;
                        lonInput.value = store.longitude;
                    } else {
                        latInput.value = '';
                        lonInput.value = '';
                    }
                }
            }, 100);
        } catch (error) {
            showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
        }
    };

    const closeModal = () => {
        modal.classList.add('hidden');
        form.reset();
        selectedServices = [];
        renderServiceTags();
        activateTab('endereco');
        buildEnderecoCompleto();
        imagePreview.src = '/public/image/placeholder.png';
        imageInput.value = '';
        if (certificadoArquivoInput) certificadoArquivoInput.value = '';
        if (certificadoSenhaInput) certificadoSenhaInput.value = '';
        if (certificadoValidadeInput) certificadoValidadeInput.value = '';
        if (certificadoAtualText) certificadoAtualText.textContent = 'Nenhum certificado armazenado.';
        if (cscIdProducaoInput) cscIdProducaoInput.value = '';
        if (cscIdHomologacaoInput) cscIdHomologacaoInput.value = '';
        resetCscTokenInput(
            cscTokenProducaoInput,
            cscTokenProducaoHelper,
            CSC_TOKEN_DEFAULT_MESSAGES.producao,
            cscTokenProducaoClearBtn
        );
        resetCscTokenInput(
            cscTokenHomologacaoInput,
            cscTokenHomologacaoHelper,
            CSC_TOKEN_DEFAULT_MESSAGES.homologacao,
            cscTokenHomologacaoClearBtn
        );
        updateCertificadoStatus('', 'muted');
        if (locationMarker) {
            locationMarker.remove();
            locationMarker = null;
        }
        latInput.value = '';
        lonInput.value = '';
    };

    // --- Renderização da Tabela ---
    async function fetchAndDisplayStores() {
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/stores`);
            const stores = await response.json();
            
            tableBody.innerHTML = '';
            stores.forEach(store => {
                const rowHtml = `
                    <tr class="bg-white border-b hover:bg-gray-50">
                        <td class="px-6 py-4 font-medium text-gray-900">${store.nome}</td>
                        <td class="px-6 py-4">${store.endereco}</td>
                        <td class="px-6 py-4 text-center">
                            <button data-action="edit" data-id="${store._id}" class="font-medium text-blue-600 hover:underline mr-3">Editar</button>
                            <button data-action="delete" data-id="${store._id}" class="font-medium text-red-600 hover:underline">Apagar</button>
                        </td>
                    </tr>
                `;
                tableBody.innerHTML += rowHtml;
            });
        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="3" class="text-center py-10 text-red-500">Não foi possível carregar as lojas.</td></tr>`;
        }
    }

    // --- Event Listeners ---
    addStoreBtn.addEventListener('click', openModalForNew);
    cancelBtn.addEventListener('click', closeModal);
    closeModalBtn?.addEventListener('click', closeModal);
    openServicesModalBtn.addEventListener('click', openServicesModal);
    saveServicesModalBtn.addEventListener('click', saveServicesSelection);

    horarioContainer.addEventListener('change', (event) => {
        if (event.target.classList.contains('fechada-checkbox')) {
            const dayRow = event.target.closest('[data-day]');
            const inputs = dayRow.querySelectorAll('.time-input');
            inputs.forEach(input => {
                input.disabled = event.target.checked;
                if (event.target.checked) {
                    input.value = '';
                }
            });
        }
    });
    
    cepInput.addEventListener('blur', async () => {
        const cepValue = cepInput.value;
        const sanitizedCep = cepValue.replace(/\D/g, '');
        if (sanitizedCep.length !== 8) {
            return;
        }

        let cepData = null;
        try {
            cepData = await buscarEnderecoPorCep(sanitizedCep);
        } catch (error) {
            showModal({ title: 'Erro', message: error.message || 'Não foi possível consultar o CEP. Tente novamente.', confirmText: 'OK' });
            return;
        }

        if (!cepData) {
            showModal({ title: 'CEP não encontrado', message: 'Revise o CEP informado ou preencha os campos manualmente.', confirmText: 'OK' });
            return;
        }

        logradouroInput.value = cepData.logradouro || '';
        complementoInput.value = cepData.complemento || '';
        if (bairroInput) bairroInput.value = cepData.bairro || '';
        municipioInput.value = cepData.localidade || '';
        ufInput.value = (cepData.uf || '').toUpperCase();
        codIbgeMunicipioInput.value = cepData.ibge || '';
        codUfInput.value = ufIbgeCodes[ufInput.value] || '';
        buildEnderecoCompleto();

        const enderecoValue = buildEnderecoCompleto() || enderecoHiddenInput?.value;
        const coords = await geocodeAddress(enderecoValue, cepValue);
        if (coords && locationMap) {
            locationMap.setView([coords.lat, coords.lng], 17);
            showModal({
                title: 'Localização Encontrada',
                message: 'O mapa foi centralizado na morada informada. Agora, clique no local exato da loja para ajustar.',
                confirmText: 'Entendi'
            });
        } else {
            showModal({
                title: 'Endereço não encontrado',
                message: 'Não foi possível encontrar este endereço. Verifique os dados ou aponte a localização manualmente no mapa.',
                confirmText: 'OK'
            });
        }
    });

    contadorCepInput?.addEventListener('blur', async () => {
        const cepValue = contadorCepInput.value || '';
        const sanitizedCep = cepValue.replace(/\D/g, '');
        if (sanitizedCep.length !== 8) {
            return;
        }

        let cepData = null;
        try {
            cepData = await buscarEnderecoPorCep(sanitizedCep);
        } catch (error) {
            showModal({ title: 'Erro ao consultar CEP', message: error.message || 'Não foi possível consultar o CEP do contador. Tente novamente.', confirmText: 'OK' });
            return;
        }

        if (!cepData) {
            showModal({ title: 'CEP não encontrado', message: 'Revise o CEP informado ou preencha os dados do contador manualmente.', confirmText: 'OK' });
            return;
        }

        if (contadorEnderecoInput) contadorEnderecoInput.value = cepData.logradouro || '';
        if (contadorBairroInput) contadorBairroInput.value = cepData.bairro || '';
        if (contadorCidadeInput) contadorCidadeInput.value = cepData.localidade || '';
        if (contadorComplementoInput) contadorComplementoInput.value = cepData.complemento || '';
    });

    tableBody.addEventListener('click', (event) => {
        const target = event.target;
        const action = target.dataset.action;
        const id = target.dataset.id;
        if (!action || !id) return;

        if (action === 'edit') {
            openModalForEdit(id);
        } else if (action === 'delete') {
            showModal({
                title: 'Confirmar Exclusão',
                message: 'Tem a certeza de que deseja apagar esta loja? Esta ação não pode ser desfeita.',
                confirmText: 'Sim, apagar',
                cancelText: 'Cancelar',
                onConfirm: async () => {
                    try {
                        const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                        const token = loggedInUser?.token;

                        await fetch(`${API_CONFIG.BASE_URL}/stores/${id}`, {
                            method: 'DELETE',
                            headers: {
                                'Authorization': `Bearer ${token}`
                            }
                        });
                        fetchAndDisplayStores();
                    } catch (error) {
                        showModal({ title: 'Erro', message: 'Não foi possível apagar a loja.', confirmText: 'OK'});
                    }
                }
            });
        }
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const storeId = hiddenStoreId.value;
        const submitButton = document.getElementById('save-store-modal-btn');
        submitButton.disabled = true;

        const enderecoCompleto = buildEnderecoCompleto();
        const formattedCnaePrincipal = cnaeInput ? formatSingleCnaeValue(cnaeInput.value) : '';
        if (cnaeInput) cnaeInput.value = formattedCnaePrincipal;
        let formattedCnaeSecundario = cnaeSecundarioInput ? formatMultipleCnaesValue(cnaeSecundarioInput.value) : '';
        formattedCnaeSecundario = formattedCnaeSecundario.replace(/[,\s]+$/, '');
        if (cnaeSecundarioInput) cnaeSecundarioInput.value = formattedCnaeSecundario;
        const cnaesSecundarios = formattedCnaeSecundario
            ? formattedCnaeSecundario.split(/,\s*/).map((value) => value.trim()).filter((value) => value.length > 0)
            : [];
        const cscIdProducaoValue = (cscIdProducaoInput?.value || '').trim();
        const cscIdHomologacaoValue = (cscIdHomologacaoInput?.value || '').trim();
        const cscTokenProducaoValue = (cscTokenProducaoInput?.value || '').trim();
        const cscTokenHomologacaoValue = (cscTokenHomologacaoInput?.value || '').trim();

        const storeData = {
            nome: nomeFantasiaInput.value,
            nomeFantasia: nomeFantasiaInput.value,
            razaoSocial: razaoSocialInput.value,
            cnpj: cnpjInput.value,
            cnaePrincipal: formattedCnaePrincipal,
            cnaePrincipalDescricao: cnaeDescricaoInput?.value || '',
            cnaeSecundario: formattedCnaeSecundario,
            cnaeSecundarioDescricao: cnaeSecundarioDescricaoInput?.value || '',
            cnaesSecundarios,
            inscricaoEstadual: inscricaoEstadualInput.value,
            inscricaoMunicipal: inscricaoMunicipalInput.value,
            regimeTributario: regimeTributarioSelect.value,
            emailFiscal: emailFiscalInput.value,
            telefone: telefoneInput.value,
            whatsapp: celularInput.value,
            cep: cepInput.value,
            municipio: municipioInput.value,
            uf: ufInput.value,
            logradouro: logradouroInput.value,
            bairro: bairroInput?.value || '',
            numero: numeroInput.value,
            complemento: complementoInput.value,
            codigoIbgeMunicipio: codIbgeMunicipioInput.value,
            codigoUf: codUfInput.value,
            endereco: enderecoCompleto,
            latitude: parseFloat(latInput.value) || null,
            longitude: parseFloat(lonInput.value) || null,
            servicos: selectedServices,
            horario: {},
            contadorNome: contadorNomeInput?.value || '',
            contadorCpf: contadorCpfInput?.value || '',
            contadorCrc: contadorCrcInput?.value || '',
            contadorCnpj: contadorCnpjInput?.value || '',
            contadorCep: contadorCepInput?.value || '',
            contadorEndereco: contadorEnderecoInput?.value || '',
            contadorCidade: contadorCidadeInput?.value || '',
            contadorNumero: contadorNumeroInput?.value || '',
            contadorBairro: contadorBairroInput?.value || '',
            contadorComplemento: contadorComplementoInput?.value || '',
            contadorRazaoSocial: contadorRazaoSocialInput?.value || '',
            contadorTelefone: contadorTelefoneInput?.value || '',
            contadorFax: contadorFaxInput?.value || '',
            contadorCelular: contadorCelularInput?.value || '',
            contadorEmail: contadorEmailInput?.value || '',
            certificadoValidade: certificadoValidadeInput.value,
            cscIdProducao: cscIdProducaoValue,
            cscIdHomologacao: cscIdHomologacaoValue
        };

        if (cscTokenProducaoInput) {
            if (cscTokenProducaoValue) {
                storeData.cscTokenProducao = cscTokenProducaoValue;
            } else if (cscTokenProducaoInput.dataset.cleared === 'true') {
                storeData.cscTokenProducao = '';
            }
        }

        if (cscTokenHomologacaoInput) {
            if (cscTokenHomologacaoValue) {
                storeData.cscTokenHomologacao = cscTokenHomologacaoValue;
            } else if (cscTokenHomologacaoInput.dataset.cleared === 'true') {
                storeData.cscTokenHomologacao = '';
            }
        }

        diasDaSemana.forEach(({ key }) => {
            const dayRow = horarioContainer.querySelector(`[data-day="${key}"]`);
            storeData.horario[key] = {
                abre: dayRow.querySelector('input[name="abre"]').value,
                fecha: dayRow.querySelector('input[name="fecha"]').value,
                fechada: dayRow.querySelector('input[name="fechada"]').checked
            };
        });

        const method = storeId ? 'PUT' : 'POST';
        const url = storeId ? `${API_CONFIG.BASE_URL}/stores/${storeId}` : `${API_CONFIG.BASE_URL}/stores`;

        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(storeData) });
            const savedStore = await response.json();
            if (!response.ok) throw new Error('Falha ao salvar os dados da loja.');

            if (imageInput.files[0]) {
                const formData = new FormData();
                formData.append('imagem', imageInput.files[0]);
                const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                const token = loggedInUser?.token;
                await fetch(`${API_CONFIG.BASE_URL}/stores/${savedStore._id}/upload`, {
                    method: 'POST',
                    body: formData,
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            }

            if (certificadoArquivoInput?.files?.length && (certificadoSenhaInput?.value || '').trim()) {
                try {
                    await uploadCertificateForStore(savedStore._id);
                } catch (certError) {
                    updateCertificadoStatus(certError.message || 'Não foi possível salvar o certificado.', 'error');
                    showModal({
                        title: 'Certificado não armazenado',
                        message: certError.message || 'A loja foi atualizada, mas o certificado digital não pôde ser salvo. Verifique o arquivo e a senha e tente novamente.',
                        confirmText: 'OK'
                    });
                    submitButton.disabled = false;
                    return;
                }
            }

            closeModal();
            fetchAndDisplayStores();
            showModal({ title: 'Sucesso!', message: `Loja ${storeId ? 'atualizada' : 'adicionada'} com sucesso.`, confirmText: 'OK' });
        } catch (error) {
            showModal({ title: 'Erro', message: error.message, confirmText: 'Tentar Novamente' });
        } finally {
            submitButton.disabled = false;
        }
    });

    // --- Carga Inicial ---
    createHorarioInputs();
    fetchAndDisplayStores();
    initializeLocationPicker();
});