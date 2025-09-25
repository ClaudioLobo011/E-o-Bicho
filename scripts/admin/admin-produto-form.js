document.addEventListener('DOMContentLoaded', () => {
    
    // --- REFERÊNCIAS AO DOM ---
    const form = document.getElementById('edit-product-form');
    const imageUploadInput = document.getElementById('imageUpload');
    const existingImagesGrid = document.getElementById('existing-images-grid');
    const pageTitle = document.getElementById('product-page-title');
    const categoryTagsContainer = document.getElementById('category-tags-container');
    const addCategoryBtn = document.getElementById('add-category-btn');
    const categoryModal = document.getElementById('category-modal');
    const categoryTreeContainer = document.getElementById('category-tree-container');
    const saveCategoryModalBtn = document.getElementById('save-category-modal-btn');
    const cancelCategoryModalBtn = document.getElementById('cancel-category-modal-btn');
    const closeCategoryModalBtn = document.getElementById('close-category-modal-btn');
    const supplierNameInput = document.getElementById('supplier-name');
    const supplierProductCodeInput = document.getElementById('supplier-product-code');
    const supplierEntryUnitSelect = document.getElementById('supplier-entry-unit');
    const supplierCalcTypeSelect = document.getElementById('supplier-calc-type');
    const supplierCalcValueInput = document.getElementById('supplier-calc-value');
    const addSupplierBtn = document.getElementById('add-supplier-btn');
    const supplierListContainer = document.getElementById('supplier-list');
    const depositTableBody = document.getElementById('deposit-stock-tbody');
    const depositEmptyState = document.getElementById('deposit-empty-state');
    const depositTableWrapper = document.getElementById('deposit-table-wrapper');
    const depositTotalDisplay = document.getElementById('deposit-total-display');
    const unitSelect = document.getElementById('unidade');

    const getSelectedProductUnit = () => (unitSelect?.value || '').trim();

    // --- LÓGICA DAS ABAS (Geral / Especificações) ---
    const productTabLinks = document.querySelectorAll('#product-tabs .tab-link');
    const productTabContents = {};
    productTabLinks.forEach((btn) => {
        const tabId = btn.dataset.tab;
        if (tabId) {
            productTabContents[tabId] = document.getElementById(tabId);
        }
    });

    function activateProductTab(tabId) {
        Object.entries(productTabContents).forEach(([id, el]) => {
            if (!el) return;
            if (id === tabId) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });

        productTabLinks.forEach((btn) => {
            const isActive = btn.dataset.tab === tabId;
            btn.classList.toggle('text-primary', isActive);
            btn.classList.toggle('text-gray-500', !isActive);
            btn.classList.toggle('border-primary', isActive);
            btn.classList.toggle('border-transparent', !isActive);
        });
    }

    if (productTabLinks.length) {
        productTabLinks.forEach((btn) => {
            btn.addEventListener('click', () => activateProductTab(btn.dataset.tab));
        });
        const initialTab = document.querySelector('#product-tabs .tab-link.text-primary')?.dataset.tab || productTabLinks[0]?.dataset.tab;
        if (initialTab) activateProductTab(initialTab);
    }

    // --- ESTADO DA PÁGINA ---
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');
    let productCategories = []; // Array de IDs das categorias selecionadas
    let allHierarchicalCategories = []; // Guarda a árvore de categorias
    let allFlatCategories = []; // Lista plana de categorias para consultas rápidas
    let supplierEntries = [];
    let allDeposits = [];
    const depositStockMap = new Map();
    let lastSelectedProductUnit = getSelectedProductUnit();

    const ensureDepositEntry = (depositId) => {
        if (!depositStockMap.has(depositId)) {
            depositStockMap.set(depositId, { quantidade: null, unidade: getSelectedProductUnit() });
        }
    };

    const updateDepositTotalDisplay = () => {
        if (!depositTotalDisplay) return;
        let total = 0;
        depositStockMap.forEach((entry) => {
            const value = Number(entry?.quantidade);
            if (Number.isFinite(value)) {
                total += value;
            }
        });
        depositTotalDisplay.textContent = total.toLocaleString('pt-BR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 3,
        });
    };

    const renderDepositStockRows = () => {
        if (!depositTableBody) return;
        const selectedUnit = getSelectedProductUnit();

        if (!Array.isArray(allDeposits) || allDeposits.length === 0) {
            depositTableBody.innerHTML = '';
            depositEmptyState?.classList.remove('hidden');
            depositTableWrapper?.classList.add('hidden');
            updateDepositTotalDisplay();
            return;
        }

        depositEmptyState?.classList.add('hidden');
        depositTableWrapper?.classList.remove('hidden');
        depositTableBody.innerHTML = '';

        allDeposits.forEach((deposit) => {
            const depositId = deposit._id;
            ensureDepositEntry(depositId);
            const entry = depositStockMap.get(depositId) || { quantidade: null, unidade: selectedUnit };
            const normalizedUnit = (entry?.unidade || '').trim() || selectedUnit;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-4 py-3 text-gray-700">
                    <div class="font-medium text-gray-800">${deposit.nome}</div>
                    <div class="text-xs text-gray-500">${deposit.codigo}${deposit?.empresa?.nome ? ` • ${deposit.empresa.nome}` : ''}</div>
                </td>
                <td class="px-4 py-3">
                    <input type="number" step="0.001" class="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary" data-deposit-id="${depositId}" data-deposit-field="quantidade">
                </td>
                <td class="px-4 py-3">
                    <input type="text" class="block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary" data-deposit-id="${depositId}" data-deposit-field="unidade" placeholder="Ex.: UN, CX">
                </td>
            `;

            const qtyInput = tr.querySelector('input[data-deposit-field="quantidade"]');
            const unitInput = tr.querySelector('input[data-deposit-field="unidade"]');

            depositStockMap.set(depositId, {
                quantidade: entry?.quantidade ?? null,
                unidade: normalizedUnit,
            });

            if (qtyInput) {
                const quantityValue = entry?.quantidade;
                qtyInput.value = quantityValue === null || quantityValue === undefined ? '' : quantityValue;
                qtyInput.addEventListener('input', (event) => {
                    const rawValue = event.target.value;
                    const parsed = rawValue === '' ? null : Number(rawValue);
                    const current = depositStockMap.get(depositId) || { quantidade: null, unidade: selectedUnit };
                    const currentUnit = (current?.unidade || '').trim() || selectedUnit;
                    depositStockMap.set(depositId, {
                        quantidade: rawValue === '' ? null : (Number.isFinite(parsed) ? parsed : current.quantidade),
                        unidade: currentUnit,
                    });
                    updateDepositTotalDisplay();
                });
            }

            if (unitInput) {
                unitInput.value = normalizedUnit;
                unitInput.addEventListener('input', (event) => {
                    const current = depositStockMap.get(depositId) || { quantidade: null, unidade: selectedUnit };
                    depositStockMap.set(depositId, {
                        quantidade: current.quantidade,
                        unidade: event.target.value.trim(),
                    });
                });
            }

            depositTableBody.appendChild(tr);
        });

        updateDepositTotalDisplay();
        lastSelectedProductUnit = getSelectedProductUnit();
    };

    const applyDepositsFromProduct = (product) => {
        depositStockMap.clear();
        if (Array.isArray(allDeposits)) {
            allDeposits.forEach((deposit) => {
                depositStockMap.set(deposit._id, { quantidade: null, unidade: getSelectedProductUnit() });
            });
        }

        if (Array.isArray(product?.estoques)) {
            product.estoques.forEach((estoque) => {
                const depositId = estoque?.deposito?._id || estoque?.deposito;
                if (!depositId) return;
                const quantidadeNumber = Number(estoque?.quantidade);
                depositStockMap.set(depositId, {
                    quantidade: Number.isFinite(quantidadeNumber) ? quantidadeNumber : null,
                    unidade: (estoque?.unidade || '').trim() || getSelectedProductUnit(),
                });
            });
        }

        renderDepositStockRows();
    };

    const resetSupplierForm = () => {
        if (supplierNameInput) supplierNameInput.value = '';
        if (supplierProductCodeInput) supplierProductCodeInput.value = '';
        if (supplierEntryUnitSelect) supplierEntryUnitSelect.value = '';
        if (supplierCalcTypeSelect) supplierCalcTypeSelect.value = '';
        if (supplierCalcValueInput) supplierCalcValueInput.value = '';
    };

    const renderSupplierEntries = () => {
        if (!supplierListContainer) return;
        supplierListContainer.innerHTML = '';

        if (!supplierEntries.length) {
            supplierListContainer.innerHTML = '<p class="text-sm text-gray-500">Nenhum fornecedor adicional adicionado.</p>';
            return;
        }

        supplierEntries.forEach((entry, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'border border-gray-200 rounded-md p-4 bg-gray-50';

            const title = document.createElement('div');
            title.className = 'flex items-start justify-between gap-4';

            const infoContainer = document.createElement('div');
            infoContainer.className = 'space-y-1 text-sm text-gray-700';

            const supplierLine = document.createElement('p');
            supplierLine.innerHTML = `<span class="font-semibold">Fornecedor:</span> ${entry.fornecedor}`;
            const codeLine = document.createElement('p');
            codeLine.innerHTML = `<span class="font-semibold">Código do produto:</span> ${entry.codigoProduto || '—'}`;
            const unitLine = document.createElement('p');
            unitLine.innerHTML = `<span class="font-semibold">Unidade de entrada:</span> ${entry.unidadeEntrada || '—'}`;
            const calcLine = document.createElement('p');
            const valorCalculo = Number.isFinite(entry.valorCalculo) ? entry.valorCalculo : '—';
            calcLine.innerHTML = `<span class="font-semibold">Cálculo:</span> ${entry.tipoCalculo || '—'} ${valorCalculo !== '—' ? `(${valorCalculo})` : ''}`;

            infoContainer.appendChild(supplierLine);
            infoContainer.appendChild(codeLine);
            infoContainer.appendChild(unitLine);
            infoContainer.appendChild(calcLine);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'text-xs font-semibold text-red-600 hover:text-red-700';
            removeBtn.textContent = 'Remover';
            removeBtn.addEventListener('click', () => {
                supplierEntries.splice(index, 1);
                renderSupplierEntries();
            });

            title.appendChild(infoContainer);
            title.appendChild(removeBtn);
            wrapper.appendChild(title);
            supplierListContainer.appendChild(wrapper);
        });
    };

    // --- CAMPOS RELACIONADOS A PREÇOS ---
    const costInput = document.getElementById('custo');
    const saleInput = document.getElementById('venda');
    const markupInput = document.getElementById('markup');
    let isUpdatingFromMarkup = false;
    let isUpdatingFromPrice = false;

    const updateMarkupFromValues = () => {
        if (!costInput || !saleInput || !markupInput || isUpdatingFromMarkup) return;
        const cost = parseFloat(costInput.value);
        const sale = parseFloat(saleInput.value);

        if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(sale)) {
            markupInput.value = '';
            return;
        }

        const markup = ((sale - cost) / cost) * 100;
        isUpdatingFromPrice = true;
        markupInput.value = Number.isFinite(markup) ? markup.toFixed(2) : '';
        isUpdatingFromPrice = false;
    };

    const updateSaleFromMarkup = () => {
        if (!costInput || !saleInput || !markupInput || isUpdatingFromPrice) return;
        const cost = parseFloat(costInput.value);
        const markup = parseFloat(markupInput.value);

        if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(markup)) return;

        const sale = cost * (1 + (markup / 100));
        isUpdatingFromMarkup = true;
        saleInput.value = Number.isFinite(sale) ? sale.toFixed(2) : '';
        isUpdatingFromMarkup = false;
        updateMarkupFromValues();
    };

    costInput?.addEventListener('input', updateMarkupFromValues);
    saleInput?.addEventListener('input', updateMarkupFromValues);
    markupInput?.addEventListener('input', updateSaleFromMarkup);

    if (!productId) {
        alert("ID do produto não encontrado!");
        window.location.href = 'admin-produtos.html';
        return;
    }

    // --- FUNÇÕES DE LÓGICA ---
    const renderCategoryTags = (categories) => {
        categoryTagsContainer.innerHTML = '';
        if (categories.length === 0) {
            categoryTagsContainer.innerHTML = `<span class="text-sm text-gray-500">Nenhuma categoria associada.</span>`;
            return;
        }
        categories.forEach(cat => {
            const tag = document.createElement('span');
            tag.className = "inline-flex items-center bg-gray-200 text-gray-700 text-xs font-medium px-2 py-1 rounded-full";
            tag.textContent = cat.nome;
            categoryTagsContainer.appendChild(tag);
        });
    };

    const populateCategoryTree = (categories, selectedIds) => {
        const createList = (categories, depth = 0) => {
            const ul = document.createElement('ul');
            if (depth > 0) ul.className = 'pl-5';
            
            categories.forEach(cat => {
                const li = document.createElement('li');
                li.className = 'mb-2';
                
                const label = document.createElement('label');
                label.className = 'inline-flex items-center space-x-2';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = cat._id;
                checkbox.checked = selectedIds.includes(cat._id);
                
                const span = document.createElement('span');
                span.textContent = cat.nome;
                
                label.appendChild(checkbox);
                label.appendChild(span);
                li.appendChild(label);

                if (cat.children && cat.children.length > 0) {
                    li.appendChild(createList(cat.children, depth + 1));
                }

                ul.appendChild(li);
            });
            return ul;
        };
        categoryTreeContainer.innerHTML = '';
        categoryTreeContainer.appendChild(createList(categories));
    };

    const populateForm = (product) => {
        pageTitle.textContent = `Editar Produto: ${product.nome}`;
        form.querySelector('#nome').value = product.nome || '';
        form.querySelector('#marca').value = product.marca || '';
        form.querySelector('#cod').value = product.cod || '';
        form.querySelector('#codbarras').value = product.codbarras || '';
        form.querySelector('#descricao').value = product.descricao || '';
        if (unitSelect) {
            unitSelect.value = product.unidade || '';
            lastSelectedProductUnit = getSelectedProductUnit();
        }
        if (form.querySelector('#referencia')) {
            form.querySelector('#referencia').value = product.referencia || '';
        }
        const dataCadastroInput = form.querySelector('#data-cadastro');
        if (dataCadastroInput) {
            const rawDate = product.dataCadastro || product.createdAt || '';
            if (rawDate) {
                const rawDateStr = String(rawDate);
                const [datePart] = rawDateStr.split('T');
                if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
                    dataCadastroInput.value = datePart;
                } else {
                    const parsedDate = new Date(rawDateStr);
                    dataCadastroInput.value = Number.isNaN(parsedDate.getTime())
                        ? ''
                        : parsedDate.toISOString().split('T')[0];
                }
            } else {
                dataCadastroInput.value = '';
            }
        }
        const pesoInput = form.querySelector('#peso');
        if (pesoInput) {
            const pesoValue = Number(product.peso);
            pesoInput.value = Number.isFinite(pesoValue) ? pesoValue : '';
        }
        const iatSelect = form.querySelector('#iat');
        if (iatSelect) {
            iatSelect.value = product.iat || '';
        }
        const tipoProdutoSelect = form.querySelector('#tipo-produto');
        if (tipoProdutoSelect) {
            tipoProdutoSelect.value = product.tipoProduto || '';
        }
        const ncmInput = form.querySelector('#ncm');
        if (ncmInput) {
            ncmInput.value = product.ncm || '';
        }
        supplierEntries = Array.isArray(product.fornecedores)
            ? product.fornecedores.map((item) => ({
                fornecedor: item.fornecedor || '',
                codigoProduto: item.codigoProduto || item.codigo || '',
                unidadeEntrada: item.unidadeEntrada || item.unidade || '',
                tipoCalculo: item.tipoCalculo || '',
                valorCalculo: Number.isFinite(Number(item.valorCalculo)) ? Number(item.valorCalculo) : null,
            }))
            : [];
        renderSupplierEntries();
        resetSupplierForm();
        applyDepositsFromProduct(product);
        if (form.querySelector('#barcode-additional')) {
            form.querySelector('#barcode-additional').value = Array.isArray(product.codigosComplementares) ? product.codigosComplementares.join('\n') : '';
        }
        const custoNumber = Number(product.custo);
        const vendaNumber = Number(product.venda);
        form.querySelector('#custo').value = Number.isFinite(custoNumber) ? custoNumber.toFixed(2) : '';
        form.querySelector('#venda').value = Number.isFinite(vendaNumber) ? vendaNumber.toFixed(2) : '';
        if (markupInput) {
            const cost = parseFloat(costInput?.value || '0');
            const sale = parseFloat(saleInput?.value || '0');
            if (Number.isFinite(cost) && cost > 0 && Number.isFinite(sale)) {
                const markup = ((sale - cost) / cost) * 100;
                markupInput.value = Number.isFinite(markup) ? markup.toFixed(2) : '';
            } else {
                markupInput.value = '';
            }
        }

        const categoriasAtuais = Array.isArray(product.categorias) ? product.categorias : [];
        productCategories = categoriasAtuais.map(cat => cat._id);
        renderCategoryTags(categoriasAtuais);

        const imagens = Array.isArray(product.imagens) ? product.imagens : [];
        existingImagesGrid.innerHTML = imagens.map(imgUrl => `
            <div class="relative group">
                <img src="${API_CONFIG.SERVER_URL}${imgUrl}" alt="Imagem do produto" class="w-full h-24 object-cover rounded-md border">
                <div class="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" class="delete-image-btn text-white text-xs bg-red-600 hover:bg-red-700 px-2 py-1 rounded" data-image-url="${imgUrl}">Apagar</button>
                </div>
            </div>
        `).join('');

        // --- Especificações ---
        const espec = product.especificacoes || {};
        // Idade
        document.querySelectorAll('input[name="spec-idade"]').forEach(cb => {
            cb.checked = Array.isArray(espec.idade) ? espec.idade.includes(cb.value) : false;
        });
        // Pet
        document.querySelectorAll('input[name="spec-pet"]').forEach(cb => {
            cb.checked = Array.isArray(espec.pet) ? espec.pet.includes(cb.value) : false;
        });
        // Porte Raça
        document.querySelectorAll('input[name="spec-porte"]').forEach(cb => {
            cb.checked = Array.isArray(espec.porteRaca) ? espec.porteRaca.includes(cb.value) : false;
        });
        // Apresentação
        const apInput = document.getElementById('spec-apresentacao');
        if (apInput) apInput.value = espec.apresentacao || '';
        // Código de barras (somente visual)
        const eanInput = document.getElementById('spec-codbarras');
        if (eanInput) eanInput.value = product.codbarras || '';

        updateMarkupFromValues();
    };

    const getBrandFromCategories = (selectedCategoryObjects) => {
        if (!selectedCategoryObjects?.length || !allFlatCategories?.length) return '';
        const categoryMap = new Map(allFlatCategories.map(cat => [cat._id.toString(), cat]));
        for (const selectedCat of selectedCategoryObjects) {
            let current = selectedCat;
            while (current && current.parent) {
                const parent = categoryMap.get(current.parent.toString());
                if (parent && parent.nome === 'Marcas') {
                    return selectedCat.nome;
                }
                current = parent;
            }
        }
        return '';
    };

    const initializePage = async () => {
        try {
            // Usa Promise.all para buscar dados do produto, depósitos e categorias em paralelo
            const [productRes, hierarchicalRes, flatRes, depositsRes] = await Promise.all([
                fetch(`${API_CONFIG.BASE_URL}/products/${productId}`),
                fetch(`${API_CONFIG.BASE_URL}/categories/hierarchical`),
                fetch(`${API_CONFIG.BASE_URL}/categories`),
                fetch(`${API_CONFIG.BASE_URL}/deposits`)
            ]);

            if (!productRes.ok || !hierarchicalRes.ok || !flatRes.ok || !depositsRes.ok) {
                throw new Error('Falha ao carregar os dados iniciais da página.');
            }

            const product = await productRes.json();
            allHierarchicalCategories = await hierarchicalRes.json();
            allFlatCategories = await flatRes.json();
            const depositsPayload = await depositsRes.json();
            allDeposits = Array.isArray(depositsPayload?.deposits)
                ? depositsPayload.deposits
                : Array.isArray(depositsPayload)
                    ? depositsPayload
                    : [];

            populateForm(product);
            populateCategoryTree(allHierarchicalCategories, productCategories);

        } catch (error) {
            console.error("Erro ao inicializar a página:", error);
            showModal({ title: 'Erro', message: error.message, confirmText: 'Voltar', onConfirm: () => window.location.href = 'admin-produtos.html' });
        }

    };
    
    // --- EVENT LISTENERS ---
    addCategoryBtn.addEventListener('click', () => {
        populateCategoryTree(allHierarchicalCategories, productCategories);
        categoryModal.classList.remove('hidden');
    });
    cancelCategoryModalBtn.addEventListener('click', () => categoryModal.classList.add('hidden'));
    closeCategoryModalBtn.addEventListener('click', () => categoryModal.classList.add('hidden'));

    const handleAddSupplier = () => {
        const fornecedor = supplierNameInput?.value.trim();
        const codigoProduto = supplierProductCodeInput?.value.trim();
        const unidadeEntrada = supplierEntryUnitSelect?.value;
        const tipoCalculo = supplierCalcTypeSelect?.value;
        const valorCalculoRaw = supplierCalcValueInput?.value.trim();

        if (!fornecedor) {
            alert('Informe o nome do fornecedor.');
            return;
        }
        if (!unidadeEntrada) {
            alert('Selecione a unidade de entrada.');
            return;
        }
        if (!tipoCalculo) {
            alert('Selecione o tipo de cálculo.');
            return;
        }

        let valorCalculo = null;
        if (valorCalculoRaw) {
            const parsed = Number(valorCalculoRaw);
            if (!Number.isFinite(parsed)) {
                alert('Informe um valor de cálculo válido.');
                return;
            }
            valorCalculo = parsed;
        }

        supplierEntries.push({ fornecedor, codigoProduto, unidadeEntrada, tipoCalculo, valorCalculo });
        renderSupplierEntries();
        resetSupplierForm();
    };

    addSupplierBtn?.addEventListener('click', handleAddSupplier);

    unitSelect?.addEventListener('change', () => {
        const newUnit = getSelectedProductUnit();
        depositStockMap.forEach((entry, depositId) => {
            const quantidade = entry?.quantidade ?? null;
            const currentUnit = (entry?.unidade || '').trim();
            if (!currentUnit || currentUnit === lastSelectedProductUnit) {
                depositStockMap.set(depositId, { quantidade, unidade: newUnit });
            } else {
                depositStockMap.set(depositId, { quantidade, unidade: currentUnit });
            }
        });
        lastSelectedProductUnit = newUnit;
        renderDepositStockRows();
    });

    const handleSaveCategories = () => {
        const selectedCheckboxes = categoryTreeContainer.querySelectorAll('input[type="checkbox"]:checked');
        productCategories = Array.from(selectedCheckboxes).map(cb => cb.value);

        const selectedCategoryObjects = allFlatCategories.filter(cat => productCategories.includes(cat._id));
        renderCategoryTags(selectedCategoryObjects);

        const brandName = getBrandFromCategories(selectedCategoryObjects);
        if (brandName) {
            form.querySelector('#marca').value = brandName;
        }

        categoryModal.classList.add('hidden');
    };

    saveCategoryModalBtn.addEventListener('click', handleSaveCategories);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>A Salvar...`;
        
        const formData = new FormData(form);
        const additionalBarcodesRaw = (formData.get('barcode-additional') || '')
            .split('\n')
            .map((code) => code.trim())
            .filter(Boolean);

        const depositPayload = [];
        depositStockMap.forEach((entry, depositId) => {
            if (!depositId) return;
            const unidade = (entry?.unidade || '').trim();
            const quantidadeValue = entry?.quantidade;
            const hasQuantity = quantidadeValue !== null && quantidadeValue !== undefined && quantidadeValue !== '';
            if (!hasQuantity && !unidade) return;
            const parsedQuantity = Number(quantidadeValue);
            depositPayload.push({
                deposito: depositId,
                quantidade: Number.isFinite(parsedQuantity) ? parsedQuantity : 0,
                unidade,
            });
        });

        const totalStock = depositPayload.reduce((sum, item) => sum + (Number(item.quantidade) || 0), 0);

        const updateData = {
            descricao: formData.get('descricao'),
            marca: formData.get('marca'),
            unidade: formData.get('unidade'),
            referencia: formData.get('referencia'),
            custo: formData.get('custo'),
            venda: formData.get('venda'),
            categorias: productCategories,
            fornecedores: supplierEntries.map((item) => ({
                fornecedor: item.fornecedor,
                codigoProduto: item.codigoProduto || null,
                unidadeEntrada: item.unidadeEntrada || null,
                tipoCalculo: item.tipoCalculo || null,
                valorCalculo: item.valorCalculo,
            })),
            especificacoes: {
                idade: Array.from(form.querySelectorAll('input[name="spec-idade"]:checked')).map(i => i.value),
                pet: Array.from(form.querySelectorAll('input[name="spec-pet"]:checked')).map(i => i.value),
                porteRaca: Array.from(form.querySelectorAll('input[name="spec-porte"]:checked')).map(i => i.value),
                apresentacao: (document.getElementById('spec-apresentacao')?.value || '').trim()
            },
            codigosComplementares: additionalBarcodesRaw,
            estoques: depositPayload,
            stock: totalStock,
        };

        const dataCadastroValue = formData.get('data-cadastro');
        const pesoValue = formData.get('peso');
        const iatValue = formData.get('iat');
        const tipoProdutoValue = formData.get('tipo-produto');
        const ncmValue = formData.get('ncm');

        updateData.dataCadastro = dataCadastroValue ? dataCadastroValue : null;
        const parsedPeso = pesoValue ? Number(pesoValue) : null;
        updateData.peso = Number.isFinite(parsedPeso) ? parsedPeso : null;
        updateData.iat = iatValue || null;
        updateData.tipoProduto = tipoProdutoValue || null;
        updateData.ncm = ncmValue ? ncmValue.trim() : null;

        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;

            const textResponse = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(updateData),
            });
            if (!textResponse.ok) throw new Error('Falha ao salvar os dados do produto.');

            const files = imageUploadInput.files;
            if (files.length > 0) {
                const imageFormData = new FormData();
                for (const file of files) {
                    imageFormData.append('imagens', file);
                }
                const uploadResponse = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}/upload`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    },
                    body: imageFormData,
                });
                if (!uploadResponse.ok) throw new Error('Falha ao enviar as imagens.');
            }
            
            try {
            const productRes = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}`);
            if (productRes.ok) {
                const updatedProduct = await productRes.json();
                // Reaproveita sua função que preenche o formulário e a galeria
                populateForm(updatedProduct);
            }
            } catch (e) {
            console.warn('Não foi possível recarregar o produto após salvar.', e);
            }

            showModal({
            title: 'Sucesso!',
            message: 'Produto atualizado com sucesso.',
            confirmText: 'OK'
            });

        } catch (error) {
            showModal({ title: 'Erro', message: `Não foi possível salvar: ${error.message}`, confirmText: 'Tentar Novamente' });
        } finally {
            submitButton.disabled = false;
            submitButton.innerHTML = 'Salvar Alterações';
        }
    });

    existingImagesGrid.addEventListener('click', async (event) => {
        if (event.target.classList.contains('delete-image-btn')) {
            const button = event.target;
            const imageUrlToDelete = button.dataset.imageUrl;

            showModal({
                title: 'Confirmar Exclusão',
                message: `Tem a certeza de que deseja apagar esta imagem? Esta ação não pode ser desfeita.`,
                confirmText: 'Apagar',
                cancelText: 'Cancelar',
                onConfirm: async () => {
                    try {
                        const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                        const token = loggedInUser?.token;
                        const response = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}/images`, {
                            method: 'DELETE',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({ imageUrl: imageUrlToDelete })
                        });
                        
                        const result = await response.json();
                        if (!response.ok) {
                            throw new Error(result.message || 'Falha ao apagar a imagem.');
                        }
                        showModal({ title: 'Sucesso!', message: result.message, confirmText: 'OK' });
                        button.closest('.relative.group').remove();
                    } catch (error) {
                        showModal({ title: 'Erro', message: `Não foi possível excluir a imagem: ${error.message}`, confirmText: 'Ok' });
                    }
                }
            });
        }
    });

    initializePage();
});
