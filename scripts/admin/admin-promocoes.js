document.addEventListener('DOMContentLoaded', () => {
    // =================================================
    // =========== LÓGICA GERAL DAS ABAS ===============
    // =================================================
    const tabClub = document.getElementById('tab-clubeobicho');
    const tabProducts = document.getElementById('tab-produtos');
    const tabConditional = document.getElementById('tab-condicional');
    const tabBanners = document.getElementById('tab-banners');
    const contentClub = document.getElementById('tab-clubeobicho-content');
    const contentProducts = document.getElementById('tab-produtos-content');
    const contentConditional = document.getElementById('tab-condicional-content');
    const contentBanners = document.getElementById('tab-banners-content');
    const tabs = [
        { tab: tabClub, content: contentClub },
        { tab: tabProducts, content: contentProducts },
        { tab: tabConditional, content: contentConditional },
        { tab: tabBanners, content: contentBanners }
    ];

    function showTab(tabToShow) {
        tabs.forEach(({ tab, content }) => {
            if (!tab || !content) return;
            const isTarget = tab === tabToShow;
            content.classList.toggle('hidden', !isTarget);
            tab.classList.toggle('border-primary', isTarget);
            tab.classList.toggle('text-primary', isTarget);
            tab.classList.toggle('border-transparent', !isTarget);
            tab.classList.toggle('text-gray-500', !isTarget);
        });
    }

    tabs.forEach(({ tab }) => {
        if (tab) {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                showTab(tab);
            });
        }
    });

    // ==================================================
    // ========= LÓGICA ABA CLUBEOBICHO =================
    // ==================================================
    const clubDiscountInput = document.getElementById('desconto-clube-input');
    const clubSaveButton = document.getElementById('salvar-desconto-clube-btn');

    async function loadClubDiscount() {
        if (!clubDiscountInput) return;
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/clube/desconto-global`);
            const data = await response.json();
            if (response.ok) {
                clubDiscountInput.value = data.percentage;
            }
        } catch (error) {
            console.error('Erro ao carregar o desconto do clube:', error);
        }
    }

    if (clubSaveButton) {
        clubSaveButton.addEventListener('click', () => {
            const percentageValue = parseFloat(clubDiscountInput.value);
            if (isNaN(percentageValue) || percentageValue < 0 || percentageValue > 100) {
                showModal({ title: 'Valor Inválido', message: 'Por favor, insira um número entre 0 e 100.', confirmText: 'OK' });
                return;
            }
            showModal({
                title: 'Confirmar Alteração',
                message: `Tem a certeza de que deseja aplicar um desconto de ${percentageValue}% a TODOS os produtos?`,
                confirmText: 'Sim, aplicar',
                cancelText: 'Cancelar',
                onConfirm: async () => {
                    clubSaveButton.disabled = true;
                    clubSaveButton.textContent = 'A aplicar...';
                    try {
                        const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                        const token = loggedInUser?.token;

                        const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/clube/desconto-global`, {
                            method: 'POST',
                            headers: { 
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`   // <-- obrigatório
                            },
                            body: JSON.stringify({ percentage: percentageValue })
                        });
                        const result = await response.json();
                        if (!response.ok) throw new Error(result.message);
                        showModal({ title: 'Sucesso!', message: result.message, confirmText: 'OK' });
                    } catch (error) {
                        showModal({ title: 'Erro', message: error.message, confirmText: 'Tentar Novamente' });
                    } finally {
                        clubSaveButton.disabled = false;
                        clubSaveButton.textContent = 'Aplicar';
                    }
                }
            });
        });
    }

    // ==================================================
    // ========= LÓGICA ABA PROMOÇÕES DE PRODUTOS =======
    // ==================================================
    const promoAvailableList = document.getElementById('available-products-list-promo');
    const promoList = document.getElementById('promo-products-list');
    const promoSearchInput = document.getElementById('search-available-promo');
    let allProducts = []; // Será partilhado por todas as abas que precisam da lista completa
    let promoProducts = [];
    let debounceTimer;

    const renderPromoAvailableList = () => {
        const searchTerm = promoSearchInput.value.toLowerCase();
        const promoIds = new Set(promoProducts.map(p => p._id));
        const filtered = allProducts.filter(p => !promoIds.has(p._id) && p.nome.toLowerCase().includes(searchTerm));
        promoAvailableList.innerHTML = '';
        filtered.forEach(p => {
            const li = document.createElement('li');
            li.className = 'p-2 border rounded-md bg-white cursor-grab';
            li.dataset.id = p._id;
            li.textContent = p.nome;
            promoAvailableList.appendChild(li);
        });
    };
    const renderPromoList = () => {
        promoList.innerHTML = '';
        promoProducts.forEach(p => {
            const li = document.createElement('li');
            li.className = 'p-2 border rounded-md bg-green-50 flex items-center justify-between';
            li.dataset.id = p._id;
            li.innerHTML = `
                <span class="font-semibold text-sm">${p.nome}</span>
                <div class="flex items-center space-x-2">
                    <input type="number" value="${p.promocao ? p.promocao.porcentagem : 0}" min="0" max="100" class="w-20 text-center border-gray-300 rounded-md shadow-sm promo-discount-input" data-id="${p._id}">
                    <span class="text-sm font-bold">%</span>
                    <button class="remove-promo-btn text-red-500 hover:text-red-700" data-id="${p._id}">&times;</button>
                </div>
            `;
            promoList.appendChild(li);
        });
    };
    const updatePromoLists = () => {
        renderPromoAvailableList();
        renderPromoList();
    };
    const initializePromoTab = async () => {
        if (!promoAvailableList) return;
        try {
            const [allProductsRes, promoProductsRes] = await Promise.all([
                fetch(`${API_CONFIG.BASE_URL}/products?limit=5000`),
                fetch(`${API_CONFIG.BASE_URL}/promocoes/produtos`)
            ]);
            allProducts = (await allProductsRes.json()).products;
            promoProducts = await promoProductsRes.json();
            updatePromoLists();
        } catch (error) {
            console.error('Erro ao inicializar aba de promoções:', error);
        }
    };
    if (promoSearchInput) promoSearchInput.addEventListener('input', renderPromoAvailableList);
    if (promoList) {
        promoList.addEventListener('change', (e) => {
            if (e.target.classList.contains('promo-discount-input')) {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(async () => {
                    const productId = e.target.dataset.id;
                    const percentage = parseFloat(e.target.value) || 0;
                    try {
                        const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                        const token = loggedInUser?.token;
                        await fetch(`${API_CONFIG.BASE_URL}/promocoes/produtos/${productId}`, {
                            method: 'POST',
                            headers: { 
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({ porcentagem: percentage })
                        });
                    } catch (error) { showModal({ title: 'Erro de Rede', message: 'Não foi possível salvar o desconto.', confirmText: 'OK'}); }
                }, 500);
            }
        });
        promoList.addEventListener('click', async (e) => {
            if (e.target.closest('.remove-promo-btn')) {
                const productId = e.target.closest('.remove-promo-btn').dataset.id;
                try {
                    const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                    const token = loggedInUser?.token;
                    await fetch(`${API_CONFIG.BASE_URL}/promocoes/produtos/${productId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                    promoProducts = promoProducts.filter(p => p._id !== productId);
                    updatePromoLists();
                } catch (error) { showModal({ title: 'Erro de Rede', message: 'Não foi possível remover a promoção.', confirmText: 'OK'}); }
            }
        });
        new Sortable(promoList, {
            group: 'shared-promo', animation: 150,
            onAdd: async (evt) => {
                const productId = evt.item.dataset.id;
                try {
                    const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                    const token = loggedInUser?.token;
                    await fetch(`${API_CONFIG.BASE_URL}/promocoes/produtos/${productId}`, {
                        method: 'POST', headers: { 
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        }, body: JSON.stringify({ porcentagem: 0 })
                    });
                    const response = await fetch(`${API_CONFIG.BASE_URL}/promocoes/produtos`);
                    promoProducts = await response.json();
                    updatePromoLists();
                } catch (error) {
                    showModal({ title: 'Erro de Rede', message: 'Não foi possível adicionar o produto à promoção.', confirmText: 'OK'});
                    initializePromoTab(); 
                }
            }
        });
        new Sortable(promoAvailableList, { group: 'shared-promo', animation: 150 });
    }

    // ==================================================
    // ====== LÓGICA ABA PROMOÇÃO CONDICIONAL ===========
    // ==================================================
    const condAvailableList = document.getElementById('available-products-list-condicional');
    const condPromoList = document.getElementById('condicional-promo-list');
    const condSearchInput = document.getElementById('search-available-condicional');
    const condModal = document.getElementById('conditional-promo-modal');
    const condModalProductName = document.getElementById('conditional-modal-product-name');
    const condModalProductId = document.getElementById('conditional-modal-product-id');
    const condModalSaveBtn = document.getElementById('save-conditional-modal-btn');
    const condModalCancelBtn = document.getElementById('cancel-conditional-modal-btn');
    const radioLevePague = document.querySelector('input[name="promo_type"][value="leve_pague"]');
    const radioAcimaDe = document.querySelector('input[name="promo_type"][value="acima_de"]');
    const fieldsLevePague = document.getElementById('fields-leve-pague');
    const fieldsAcimaDe = document.getElementById('fields-acima-de');

    const originalPriceInput = document.getElementById('acima-de-original-price');
    const finalPriceInput = document.getElementById('acima-de-valor-final');
    const percentageInput = document.getElementById('desconto-porcentagem-input');
    const quantityInput = document.getElementById('quantidade-minima-input');

    let currentProductPrice = 0;
    let condPromoProducts = [];

    // --- Funções de Cálculo ---
    function updatePercentage() {
        const finalPrice = parseFloat(finalPriceInput.value);
        if (isNaN(finalPrice) || currentProductPrice <= 0) return;
        
        const discount = 100 - (finalPrice / currentProductPrice) * 100;
        percentageInput.value = discount > 0 ? discount.toFixed(2) : 0;
    }

    function updateFinalPrice() {
        const percentage = parseFloat(percentageInput.value);
        if (isNaN(percentage) || currentProductPrice <= 0) return;

        const discountMultiplier = 1 - (percentage / 100);
        finalPriceInput.value = (currentProductPrice * discountMultiplier).toFixed(2);
    }

    const renderCondPromoList = () => {
        condPromoList.innerHTML = '';
        condPromoProducts.forEach(p => {
            const promo = p.promocaoCondicional;
            let promoText = 'Não definida';
            if (promo.tipo === 'leve_pague') {
                promoText = `Leve ${promo.leve || '?'}, Pague ${promo.pague || '?'}`;
            } else if (promo.tipo === 'acima_de') {
                promoText = `Acima de ${promo.quantidadeMinima || '?'} un., ${promo.descontoPorcentagem || '?'}% OFF`;
            }
            const li = document.createElement('li');
            li.className = 'p-2 border rounded-md bg-blue-50 flex items-center justify-between';
            li.dataset.id = p._id;
            li.innerHTML = `
                <div>
                    <span class="font-semibold text-sm">${p.nome}</span>
                    <span class="block text-xs text-blue-700">${promoText}</span>
                </div>
                <div>
                    <button class="edit-cond-promo-btn text-blue-600 hover:text-blue-800 mr-2" data-id="${p._id}">Editar</button>
                    <button class="remove-cond-promo-btn text-red-500 hover:text-red-700" data-id="${p._id}">&times;</button>
                </div>
            `;
            condPromoList.appendChild(li);
        });
    };
    const updateCondLists = () => {
        if (!condSearchInput) return; // Garante que o código não quebra se o elemento não existir
        const searchTerm = condSearchInput.value.toLowerCase();
        const promoIds = new Set(condPromoProducts.map(p => p._id));
        
        const filtered = allProducts.filter(p => {
            const isNotOnPromo = !promoIds.has(p._id);
            const matchesSearch = p.nome.toLowerCase().includes(searchTerm);
            return isNotOnPromo && matchesSearch;
        });
        
        condAvailableList.innerHTML = '';

        if (filtered.length === 0 && searchTerm) {
            condAvailableList.innerHTML = '<li class="p-2 border rounded-md text-center text-gray-500">Nenhum produto encontrado.</li>';
        } else {
            filtered.forEach(p => {
                const li = document.createElement('li');
                li.className = 'p-2 border rounded-md bg-white cursor-grab';
                li.dataset.id = p._id;
                li.textContent = p.nome;
                condAvailableList.appendChild(li);
            });
        }
        renderCondPromoList();
    };
    const openConditionalModal = (product) => {
        condModalProductId.value = product._id;
        condModalProductName.textContent = product.nome;
        currentProductPrice = product.venda; // Guarda o preço original

        const promo = product.promocaoCondicional || {};
        
        // Preenche o formulário
        radioLevePague.checked = promo.tipo !== 'acima_de';
        radioAcimaDe.checked = promo.tipo === 'acima_de';
        fieldsLevePague.classList.toggle('hidden', promo.tipo === 'acima_de');
        fieldsAcimaDe.classList.toggle('hidden', promo.tipo !== 'acima_de');
        
        // Campos "Leve e Pague"
        fieldsLevePague.querySelector('#leve-input').value = promo.leve || '';
        fieldsLevePague.querySelector('#pague-input').value = promo.pague || '';
        
        // Campos "Acima de"
        originalPriceInput.value = `R$ ${product.venda.toFixed(2)}`;
        quantityInput.value = promo.quantidadeMinima || '';
        percentageInput.value = promo.descontoPorcentagem || '';
        
        // Calcula o valor final com base na percentagem guardada
        if(promo.descontoPorcentagem > 0) {
            const discountMultiplier = 1 - (promo.descontoPorcentagem / 100);
            finalPriceInput.value = (product.venda * discountMultiplier).toFixed(2);
        } else {
            finalPriceInput.value = '';
        }
        
        condModal.classList.remove('hidden');
    };
    const closeConditionalModal = () => {
        condModal.classList.add('hidden');
        initializeCondicionalTab();
    };
    const initializeCondicionalTab = async () => {
        if (!condAvailableList) return;
        try {
            // ▼▼▼ A LINHA QUE FALTAVA: Buscar TODOS os produtos (partilhado com a outra aba) ▼▼▼
            if (allProducts.length === 0) {
                const allProductsRes = await fetch(`${API_CONFIG.BASE_URL}/products?limit=5000`);
                allProducts = (await allProductsRes.json()).products;
            }
            
            const res = await fetch(`${API_CONFIG.BASE_URL}/promocoes/condicional`);
            condPromoProducts = await res.json();

            // ▼▼▼ CHAMA A FUNÇÃO DE ATUALIZAÇÃO AQUI, DEPOIS DE TER OS DADOS ▼▼▼
            updateCondLists(); 

        } catch (error) { console.error('Erro ao inicializar a aba condicional:', error); }
    };
    if (radioLevePague) radioLevePague.addEventListener('change', () => {
        fieldsLevePague.classList.remove('hidden');
        fieldsAcimaDe.classList.add('hidden');
    });
    if (radioAcimaDe) radioAcimaDe.addEventListener('change', () => {
        fieldsAcimaDe.classList.remove('hidden');
        fieldsLevePague.classList.add('hidden');
    });
    if (condModalCancelBtn) condModalCancelBtn.addEventListener('click', closeConditionalModal);
    if (condModalSaveBtn) condModalSaveBtn.addEventListener('click', async () => {
        const productId = condModalProductId.value;
        const tipo = document.querySelector('input[name="promo_type"]:checked').value;
        const body = { tipo,
            leve: document.getElementById('leve-input').value,
            pague: document.getElementById('pague-input').value,
            quantidadeMinima: document.getElementById('quantidade-minima-input').value,
            descontoPorcentagem: document.getElementById('desconto-porcentagem-input').value
        };
        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            await fetch(`${API_CONFIG.BASE_URL}/promocoes/condicional/${productId}`, {
                method: 'POST', headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }, body: JSON.stringify(body)
            });
            condModal.classList.add('hidden');
            initializeCondicionalTab();
        } catch(error) { showModal({ title: 'Erro', message: 'Falha ao salvar a promoção.', confirmText: 'OK'}); }
    });
    if (condSearchInput) condSearchInput.addEventListener('input', updateCondLists);
    if (finalPriceInput) finalPriceInput.addEventListener('input', updatePercentage);
    if (percentageInput) percentageInput.addEventListener('input', updateFinalPrice);
    if (condPromoList) {
        condPromoList.addEventListener('click', async (e) => {
            const editBtn = e.target.closest('.edit-cond-promo-btn');
            const removeBtn = e.target.closest('.remove-cond-promo-btn');
            if (editBtn) {
                const product = allProducts.find(p => p._id === editBtn.dataset.id);
                if(product) openConditionalModal(product);
            }
            if (removeBtn) {
                showModal({
                    title: 'Remover Promoção',
                    message: `Tem a certeza de que deseja remover esta promoção condicional?`,
                    confirmText: 'Sim, remover', cancelText: 'Cancelar',
                    onConfirm: async () => {
                        try {
                            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                            const token = loggedInUser?.token;
                            await fetch(`${API_CONFIG.BASE_URL}/promocoes/condicional/${removeBtn.dataset.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                            initializeCondicionalTab();
                        } catch (error) { showModal({ title: 'Erro', message: 'Falha ao remover a promoção.', confirmText: 'OK'}); }
                    }
                });
            }
        });
        new Sortable(condPromoList, { // A lista da DIREITA (Produtos em Promoção)
            group: 'condicional-promo',
            animation: 150,
            // O evento onAdd aqui é acionado quando um item NOVO chega
            onAdd: (evt) => {
                const product = allProducts.find(p => p._id === evt.item.dataset.id);
                if(product) {
                    // Abre o modal para definir a promoção
                    openConditionalModal(product);
                }
            }
        });

        new Sortable(condAvailableList, { // A lista da ESQUERDA (Produtos Disponíveis)
            group: 'condicional-promo',
            animation: 150
            // Não há evento 'onAdd' aqui, pois não queremos fazer nada 
            // quando um item é arrastado de volta para esta lista.
        });
    }

    // ==================================================
    // ============== LÓGICA ABA BANNERS ================
    // ==================================================
    const bannerUploadForm = document.getElementById('banner-upload-form');
    const bannerList = document.getElementById('banner-list');
    const BANNER_SETTINGS_KEY = 'bannerDisplaySettings';
    let cachedBanners = [];

    const loadBannerSettings = () => {
        try {
            return JSON.parse(localStorage.getItem(BANNER_SETTINGS_KEY)) || {};
        } catch (error) {
            console.error('Erro ao ler ajustes de banner:', error);
            return {};
        }
    };

    const saveBannerSettings = (settings) => {
        localStorage.setItem(BANNER_SETTINGS_KEY, JSON.stringify(settings));
    };

    const applyPreviewStyles = (imgEl, settings) => {
        if (!imgEl) return;
        const {
            fitMode = 'cover',
            positionX = 50,
            positionY = 50,
            zoom = 100,
            widthScale = 100,
            heightScale = 100
        } = settings;
        const baseScale = Math.max(50, zoom) / 100;
        const scaleX = baseScale * (widthScale / 100);
        const scaleY = baseScale * (heightScale / 100);
        imgEl.style.objectFit = fitMode;
        imgEl.style.objectPosition = `${positionX}% ${positionY}%`;
        imgEl.style.transform = `scale(${scaleX}, ${scaleY})`;
        imgEl.style.transformOrigin = `${positionX}% ${positionY}%`;
    };

    const openBannerPreviewModal = (banner) => {
        const settings = loadBannerSettings()[banner._id] || {
            fitMode: 'cover',
            positionX: 50,
            positionY: 50,
            zoom: 100,
            widthScale: 100,
            heightScale: 100
        };

        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4';

        overlay.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-5xl w-full">
                <div class="p-4 border-b flex items-center justify-between">
                    <div>
                        <h3 class="text-lg font-semibold text-gray-800">Pré-visualização do Banner</h3>
                        <p class="text-sm text-gray-500">Ajuste o enquadramento para o espaço do carrossel da página inicial.</p>
                    </div>
                    <button class="text-gray-500 hover:text-gray-700" id="close-banner-preview">&times;</button>
                </div>
                <div class="p-6 space-y-4">
                    <div class="relative w-full overflow-hidden bg-gray-100 rounded-lg" style="padding-top: 42%;">
                        <img src="${API_CONFIG.SERVER_URL}${banner.imageUrl}" alt="Pré-visualização do banner" class="absolute inset-0 w-full h-full transition-transform duration-200" id="banner-preview-img">
                        <div class="absolute inset-2 border-2 border-white/60 rounded-lg pointer-events-none"></div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label class="text-sm text-gray-700 flex flex-col space-y-2">
                            <span>Modo de ajuste</span>
                            <select id="fit-mode-select" class="border rounded-md p-2">
                                <option value="cover" ${settings.fitMode === 'cover' ? 'selected' : ''}>Preencher (cortar bordas)</option>
                                <option value="contain" ${settings.fitMode === 'contain' ? 'selected' : ''}>Conter (pode mostrar faixas)</option>
                            </select>
                        </label>
                        <label class="text-sm text-gray-700 flex flex-col space-y-2">
                            <span>Zoom (<span id="zoom-value">${settings.zoom}%</span>)</span>
                            <input type="range" id="zoom-range" min="80" max="160" value="${settings.zoom}" class="w-full">
                        </label>
                        <label class="text-sm text-gray-700 flex flex-col space-y-2">
                            <span>Largura exibida (<span id="width-scale-value">${settings.widthScale}%</span>)</span>
                            <input type="range" id="width-scale-range" min="70" max="150" value="${settings.widthScale}" class="w-full">
                        </label>
                        <label class="text-sm text-gray-700 flex flex-col space-y-2">
                            <span>Altura exibida (<span id="height-scale-value">${settings.heightScale}%</span>)</span>
                            <input type="range" id="height-scale-range" min="70" max="150" value="${settings.heightScale}" class="w-full">
                        </label>
                        <label class="text-sm text-gray-700 flex flex-col space-y-2">
                            <span>Posição Horizontal (<span id="pos-x-value">${settings.positionX}%</span>)</span>
                            <input type="range" id="pos-x-range" min="0" max="100" value="${settings.positionX}" class="w-full">
                        </label>
                        <label class="text-sm text-gray-700 flex flex-col space-y-2">
                            <span>Posição Vertical (<span id="pos-y-value">${settings.positionY}%</span>)</span>
                            <input type="range" id="pos-y-range" min="0" max="100" value="${settings.positionY}" class="w-full">
                        </label>
                    </div>
                </div>
                <div class="p-4 bg-gray-50 border-t flex justify-end space-x-3">
                    <button class="bg-gray-200 text-gray-800 font-bold py-2 px-4 rounded-lg hover:bg-gray-300" id="cancel-banner-preview">Cancelar</button>
                    <button class="bg-primary text-white font-bold py-2 px-4 rounded-lg hover:bg-secondary" id="save-banner-preview">Aplicar ajustes</button>
                </div>
            </div>
        `;

        const previewImg = overlay.querySelector('#banner-preview-img');
        applyPreviewStyles(previewImg, settings);

        const fitSelect = overlay.querySelector('#fit-mode-select');
        const zoomRange = overlay.querySelector('#zoom-range');
        const widthScaleRange = overlay.querySelector('#width-scale-range');
        const heightScaleRange = overlay.querySelector('#height-scale-range');
        const posXRange = overlay.querySelector('#pos-x-range');
        const posYRange = overlay.querySelector('#pos-y-range');
        const zoomValue = overlay.querySelector('#zoom-value');
        const widthScaleValue = overlay.querySelector('#width-scale-value');
        const heightScaleValue = overlay.querySelector('#height-scale-value');
        const posXValue = overlay.querySelector('#pos-x-value');
        const posYValue = overlay.querySelector('#pos-y-value');

        const syncPreview = () => {
            const newSettings = {
                fitMode: fitSelect.value,
                zoom: parseInt(zoomRange.value, 10),
                widthScale: parseInt(widthScaleRange.value, 10),
                heightScale: parseInt(heightScaleRange.value, 10),
                positionX: parseInt(posXRange.value, 10),
                positionY: parseInt(posYRange.value, 10)
            };
            applyPreviewStyles(previewImg, newSettings);
            zoomValue.textContent = `${newSettings.zoom}%`;
            widthScaleValue.textContent = `${newSettings.widthScale}%`;
            heightScaleValue.textContent = `${newSettings.heightScale}%`;
            posXValue.textContent = `${newSettings.positionX}%`;
            posYValue.textContent = `${newSettings.positionY}%`;
        };

        [fitSelect, zoomRange, widthScaleRange, heightScaleRange, posXRange, posYRange].forEach(input => {
            input.addEventListener('input', syncPreview);
        });

        overlay.querySelector('#cancel-banner-preview').addEventListener('click', () => {
            overlay.remove();
        });

        overlay.querySelector('#close-banner-preview').addEventListener('click', () => {
            overlay.remove();
        });

        overlay.querySelector('#save-banner-preview').addEventListener('click', () => {
            const settingsMap = loadBannerSettings();
            settingsMap[banner._id] = {
                fitMode: fitSelect.value,
                zoom: parseInt(zoomRange.value, 10),
                widthScale: parseInt(widthScaleRange.value, 10),
                heightScale: parseInt(heightScaleRange.value, 10),
                positionX: parseInt(posXRange.value, 10),
                positionY: parseInt(posYRange.value, 10)
            };
            saveBannerSettings(settingsMap);
            overlay.remove();
            showModal({ title: 'Ajustes gravados', message: 'Os ajustes foram guardados localmente e serão aplicados na página inicial.', confirmText: 'Ok' });
        });

        document.body.appendChild(overlay);
    };

    async function loadBanners() {
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/banners`);
            const banners = await response.json();
            cachedBanners = banners;
            bannerList.innerHTML = '';
            banners.forEach(banner => {
                const li = document.createElement('li');
                li.className = 'flex items-center justify-between p-2 border rounded-md bg-gray-50 cursor-grab';
                li.dataset.id = banner._id;
                li.innerHTML = `
                    <div class="flex items-center w-full space-x-3">
                        <i class="fas fa-grip-vertical text-gray-400"></i>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 flex-1">
                            <div class="flex items-center space-x-2 p-2 bg-white rounded border border-gray-100">
                                <span class="text-[11px] uppercase tracking-wide text-gray-500">Tela maior</span>
                                <img src="${API_CONFIG.SERVER_URL}${banner.imageUrl}" class="w-24 h-12 object-cover rounded-md">
                            </div>
                            <div class="flex items-center space-x-2 p-2 bg-white rounded border border-gray-100">
                                <span class="text-[11px] uppercase tracking-wide text-gray-500">Tela menor</span>
                                <img src="${banner.mobileImageUrl ? `${API_CONFIG.SERVER_URL}${banner.mobileImageUrl}` : `${API_CONFIG.SERVER_URL}${banner.imageUrl}`}" class="w-24 h-12 object-cover rounded-md ${banner.mobileImageUrl ? '' : 'opacity-70'}">
                            </div>
                        </div>
                        <span class="text-sm font-medium whitespace-nowrap">${banner.link}</span>
                    </div>
                    <button class="remove-banner-btn text-red-500 hover:text-red-700" data-id="${banner._id}">&times;</button>
                `;
                bannerList.appendChild(li);
            });
        } catch (error) {
            console.error('Erro ao carregar banners:', error);
        }
    }

    bannerUploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(bannerUploadForm);
        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            await fetch(`${API_CONFIG.BASE_URL}/banners`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                },
                body: formData
            });
            bannerUploadForm.reset();
            loadBanners();
        } catch (error) {
            showModal({ title: 'Erro', message: 'Falha ao enviar o banner.', confirmText: 'OK'});
        }
    });

    bannerList.addEventListener('click', async (e) => {
        if (e.target.closest('.remove-banner-btn')) {
            const bannerId = e.target.closest('.remove-banner-btn').dataset.id;
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            await fetch(`${API_CONFIG.BASE_URL}/banners/${bannerId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
            loadBanners();
            return;
        }

        const li = e.target.closest('li[data-id]');
        if (!li) return;
        const banner = cachedBanners.find(item => item._id === li.dataset.id);
        if (banner) {
            openBannerPreviewModal(banner);
        }
    });

    new Sortable(bannerList, {
        animation: 150,
        handle: '.fa-grip-vertical',
        onEnd: async (evt) => {
            const orderedIds = Array.from(evt.target.children).map(li => li.dataset.id);
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            await fetch(`${API_CONFIG.BASE_URL}/banners/order`, {
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ orderedIds })
            });
        }
    });

    // --- CARGA INICIAL DE TODAS AS ABAS ---
    if(document.getElementById('desconto-clube-input')) loadClubDiscount();
    if(document.getElementById('available-products-list-promo')) initializePromoTab();
    if(document.getElementById('available-products-list-condicional')) initializeCondicionalTab();
    if(document.getElementById('banner-list')) loadBanners();
});