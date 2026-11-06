function initializeAccountPage() {
    if (document.body.dataset.accountInitialized) return;
    document.body.dataset.accountInitialized = 'true';
    const modern = document.body.classList.contains('profile-page');
    let loaded = false, snapshot = [], saving = false;
    const feedback = (text = '', error = false) => {
        const target = document.getElementById('profile-feedback');
        if (!target) return;
        target.textContent = text;
        target.hidden = !text;
        target.classList.toggle('is-error', error);
    };
    const setControls = (busy) => {
        if (!modern) return;
        document.getElementById('profile-editor').setAttribute('aria-busy', String(busy));
        document.querySelectorAll('#form-pf input, #form-pf select, #form-pj input, #form-pj select, #profile-editor button').forEach(el => {
            el.disabled = busy || ['cpf', 'cnpj'].includes(el.id) || (el.id === 'ie' && document.getElementById('isento_ie').checked);
        });
    };
    const rememberFields = () => {
        snapshot = [...document.querySelectorAll('#profile-editor input, #profile-editor select')].map(el => ({ id: el.id, value: el.value, checked: el.checked }));
    };
    const syncIe = () => {
        const checkbox = document.getElementById('isento_ie'), input = document.getElementById('ie');
        if (!checkbox || !input || !modern) return;
        input.disabled = !loaded || saving || checkbox.checked;
        if (checkbox.checked) input.value = 'ISENTO';
        else if (input.value === 'ISENTO') input.value = '';
    };
    if (modern) {
        setControls(true);
        document.getElementById('profile-preview-note').hidden = !window.CATALOG_PREVIEW;
        document.getElementById('profile-retry').addEventListener('click', populateUserData);
        document.getElementById('isento_ie').addEventListener('change', syncIe);
        document.querySelectorAll('[data-profile-reset]').forEach(button => button.addEventListener('click', () => {
            if (!loaded || saving) return;
            snapshot.forEach(({ id, value, checked }) => {
                const field = document.getElementById(id);
                if (field._profileMask) field._profileMask.value = value;
                else field.value = value;
                if (field.type === 'checkbox') field.checked = checked;
            });
            syncIe();
            feedback('Alterações descartadas. Os dados carregados foram restaurados.');
        }));
    }
    // --- Elementos Globais da Página ---
    const tabPf = document.getElementById('tab-pf');
    const tabPj = document.getElementById('tab-pj');
    const formPf = document.getElementById('form-pf');
    const formPj = document.getElementById('form-pj');

    // --- Lógica das Abas ---
    function showPfForm() {
        if (!formPf || !formPj) return;
        formPj.classList.add('hidden');
        formPf.classList.remove('hidden');
        tabPf.classList.add('border-primary', 'text-primary', 'font-semibold');
        tabPf.classList.remove('border-transparent', 'text-gray-500', 'font-medium');
        tabPj.classList.add('border-transparent', 'text-gray-500', 'font-medium');
        tabPj.classList.remove('border-primary', 'text-primary', 'font-semibold');
    }

    function showPjForm() {
        if (!formPf || !formPj) return;
        formPf.classList.add('hidden');
        formPj.classList.remove('hidden');
        tabPj.classList.add('border-primary', 'text-primary', 'font-semibold');
        tabPj.classList.remove('border-transparent', 'text-gray-500', 'font-medium');
        tabPf.classList.add('border-transparent', 'text-gray-500', 'font-medium');
        tabPf.classList.remove('border-primary', 'text-primary', 'font-semibold');
    }

    if (tabPf && tabPj) {
        tabPf.addEventListener('click', showPfForm);
        tabPj.addEventListener('click', showPjForm);
    }

    // --- Lógica para Popular os Dados do Utilizador ---
    async function populateUserData() {
        let loggedInUser;
        try { loggedInUser = JSON.parse(localStorage.getItem('loggedInUser')); } catch { loggedInUser = null; }
        loaded = false;
        if (modern) {
            setControls(true);
            feedback('Carregando seus dados com cuidado…');
            document.getElementById('profile-retry').hidden = true;
            document.getElementById('profile-login').hidden = true;
        }

        if (!loggedInUser || !loggedInUser.id || !loggedInUser.token) {
            if (modern) {
                feedback('Entre na sua conta para consultar e atualizar seu cadastro.');
                document.getElementById('profile-login').hidden = false;
                document.getElementById('profile-type').textContent = 'Sua conta';
                document.getElementById('profile-editor').setAttribute('aria-busy', 'false');
                return;
            }
            showModal({
                title: 'Atenção',
                message: 'Você precisa estar logado para acessar esta página.',
                confirmText: 'Ir para Login',
                onConfirm: () => { window.location.href = '/pages/login.html'; }
            });
            return;
        }

        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/users/${loggedInUser.id}`, {
                headers: {
                    'Authorization': `Bearer ${loggedInUser.token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) throw new Error('Não foi possível buscar os dados do utilizador.');
            const userData = await response.json();

            const tabsNav = document.getElementById('account-type-tabs');
            if (tabsNav) tabsNav.parentElement.classList.add('hidden');

            if (userData.tipoConta === 'pessoa_juridica') {
                populatePjForm(userData);
                showPjForm();
            } else {
                populatePfForm(userData);
                showPfForm();
            }
            applyMasks();
            loaded = true;
            if (modern) {
                document.getElementById('profile-type').textContent = userData.tipoConta === 'pessoa_juridica' ? 'Conta · Pessoa jurídica' : 'Conta · Pessoa física';
                syncIe();
                setControls(false);
                rememberFields();
                feedback();
            }
        } catch (error) {
            if (modern) {
                feedback('Não foi possível carregar seus dados. Tente novamente.', true);
                document.getElementById('profile-retry').hidden = false;
                document.getElementById('profile-editor').setAttribute('aria-busy', 'false');
                document.getElementById('profile-type').textContent = 'Consulta indisponível';
            } else showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
        }
    }

    function populatePfForm(data) {
        ['data_nascimento', 'ddd-cel', 'celular', 'ddd-tel', 'telefone'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('name').value = data.nomeCompleto || '';
        document.getElementById('cpf').value = data.cpf || '';
        document.getElementById('email-pf').value = data.email || '';
        document.getElementById('genero').value = data.genero || '';
        if (data.dataNascimento) {
            const date = new Date(data.dataNascimento);
            const day = String(date.getUTCDate()).padStart(2, '0');
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const year = date.getUTCFullYear();
            document.getElementById('data_nascimento').value = `${day}/${month}/${year}`;
        }

        if (data.celular) {
            const cleanCelular = String(data.celular).replace(/\D/g, '');
            if (cleanCelular.length >= 10) {
                document.getElementById('ddd-cel').value = cleanCelular.substring(0, 2);
                document.getElementById('celular').value = cleanCelular.substring(2);
            }
        }

        if (data.telefone) {
            const cleanTelefone = String(data.telefone).replace(/\D/g, '');
            if (cleanTelefone.length >= 10) {
                document.getElementById('ddd-tel').value = cleanTelefone.substring(0, 2);
                document.getElementById('telefone').value = cleanTelefone.substring(2);
            }
        }
    }

    function populatePjForm(data) {
        ['ddd-cel-pj', 'celular-pj', 'ddd-tel-pj', 'telefone-pj'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('razao_social').value = data.razaoSocial || '';
        document.getElementById('cnpj').value = data.cnpj || '';
        document.getElementById('email-pj').value = data.email || '';
        document.getElementById('nome_contato').value = data.nomeContato || '';
        
        if (data.celular) {
            const cleanCelular = String(data.celular).replace(/\D/g, '');
            if (cleanCelular.length >= 10) {
                document.getElementById('ddd-cel-pj').value = cleanCelular.substring(0, 2);
                document.getElementById('celular-pj').value = cleanCelular.substring(2);
            }
        }
        if (data.telefone) {
            const cleanTelefone = String(data.telefone).replace(/\D/g, '');
            if (cleanTelefone.length >= 10) {
                document.getElementById('ddd-tel-pj').value = cleanTelefone.substring(0, 2);
                document.getElementById('telefone-pj').value = cleanTelefone.substring(2);
            }
        }
        
        document.getElementById('ie').value = data.inscricaoEstadual || '';
        document.getElementById('isento_ie').checked = data.isentoIE || false;
        document.getElementById('estado_ie').value = data.estadoIE || '';
    }

    // --- Lógica das Máscaras ---
    function applyMasks() {
        if (typeof IMask !== 'function') return;
        const masksToApply = [
            { selector: '#cpf', mask: '000.000.000-00' },
            { selector: '#cnpj', mask: '00.000.000/0000-00' },
            { selector: '#celular', mask: '00000-0000' },
            { selector: '#celular-pj', mask: '00000-0000' },
            { selector: '#telefone', mask: '0000-0000' },
            { selector: '#telefone-pj', mask: '0000-0000' }
        ];
        if (modern) masksToApply.push(
            ...['ddd-cel', 'ddd-tel', 'ddd-cel-pj', 'ddd-tel-pj'].map(id => ({ selector: '#' + id, mask: '00' })),
            { selector: '#data_nascimento', mask: '00/00/0000' }
        );
        masksToApply.forEach(item => {
            const element = document.querySelector(item.selector);
            if (element) {
                if (element._profileMask) element._profileMask.updateValue();
                else element._profileMask = IMask(element, { mask: item.mask });
            }
        });
    }

    // --- Lógica para Salvar as Alterações ---
    function initializeSaveButtons() {
        const handleSave = async (formId, button) => {
            if (modern && (!loaded || saving)) return;
            if (modern && window.CATALOG_PREVIEW) {
                feedback('Prévia: os campos foram editados apenas nesta tela. Nenhuma alteração foi enviada ao seu cadastro.');
                return;
            }
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            if (!loggedInUser) return;
            const originalButtonHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>A Salvar...`;
            saving = true;
            if (modern) setControls(true);
            const form = document.getElementById(formId);
            const updateData = {};
            if (formId === 'form-pf') {
                updateData.nomeCompleto = form.querySelector('#name').value;
                updateData.email = form.querySelector('#email-pf').value;
                const dataNascimentoInput = form.querySelector('#data_nascimento').value;
                if (dataNascimentoInput) {
                    const parts = dataNascimentoInput.split('/');
                    if (parts.length === 3) {
                        updateData.dataNascimento = `${parts[2]}-${parts[1]}-${parts[0]}`;
                    }
                }
                updateData.genero = form.querySelector('#genero').value;
                const dddCel = form.querySelector('#ddd-cel').value;
                const celularNum = form.querySelector('#celular').value;
                updateData.celular = (dddCel + celularNum).replace(/\D/g, '');
                const dddTel = form.querySelector('#ddd-tel').value;
                const telNum = form.querySelector('#telefone').value;
                updateData.telefone = (dddTel + telNum).replace(/\D/g, '');
            } else if (formId === 'form-pj') {
                updateData.razaoSocial = form.querySelector('#razao_social').value;
                updateData.email = form.querySelector('#email-pj').value;
                updateData.nomeContato = form.querySelector('#nome_contato').value;
                const dddCelPj = form.querySelector('#ddd-cel-pj').value;
                const celularNumPj = form.querySelector('#celular-pj').value;
                updateData.celular = (dddCelPj + celularNumPj).replace(/\D/g, '');
                const dddTelPj = form.querySelector('#ddd-tel-pj').value;
                const telNumPj = form.querySelector('#telefone-pj').value;
                updateData.telefone = (dddTelPj + telNumPj).replace(/\D/g, '');
                updateData.inscricaoEstadual = form.querySelector('#ie').value;
                updateData.isentoIE = form.querySelector('#isento_ie').checked;
                updateData.estadoIE = form.querySelector('#estado_ie').value;
            }

            try {
                const response = await fetch(`${API_CONFIG.BASE_URL}/users/${loggedInUser.id}`, {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${loggedInUser.token}` // <--- ESSENCIAL
                    },
                    body: JSON.stringify(updateData),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message);
                localStorage.setItem('loggedInUser', JSON.stringify({
                ...result.user,
                id: loggedInUser.id,
                token: loggedInUser.token
                }));
                if (modern) {
                    rememberFields();
                    feedback('Pronto! Seus dados foram atualizados.');
                } else showModal({ title: 'Sucesso!', message: 'Os seus dados foram atualizados.', confirmText: 'OK', onConfirm: () => window.location.reload() });
            } catch (error) {
                if (modern) feedback('Não foi possível salvar as alterações. Seus dados digitados foram mantidos para tentar novamente.', true);
                else showModal({ title: 'Erro', message: `Não foi possível salvar as alterações: ${error.message}`, confirmText: 'Tentar Novamente' });
            } finally {
                saving = false;
                if (modern) setControls(false);
                button.disabled = false;
                button.innerHTML = originalButtonHtml;
            }
        };

        const savePfBtn = document.getElementById('save-pf-btn');
        if (savePfBtn) savePfBtn.addEventListener('click', () => handleSave('form-pf', savePfBtn));
        const savePjBtn = document.getElementById('save-pj-btn');
        if (savePjBtn) savePjBtn.addEventListener('click', () => handleSave('form-pj', savePjBtn));
    }

    // Execução inicial
    populateUserData();
    initializeSaveButtons();
}
