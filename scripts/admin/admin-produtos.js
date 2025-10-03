function initAdminProdutos() {
    // --- Estado da Página ---
    let currentPage = 1;
    let currentLimit = 20;
    let currentSearch = '';
    let totalPages = 1;
    let debounceTimer;
    let allFlatCategories = [];
    let selectedProductIds = new Set(); // Usaremos um Set para gerir os IDs selecionados de forma eficiente

    // --- Referências aos elementos do DOM ---
    const tableBody = document.getElementById('products-table-body');
    const limitSelect = document.getElementById('limit-select');
    const searchInput = document.getElementById('search-input');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const pageInfo = document.getElementById('page-info');
    const bulkActionsToolbar = document.getElementById('bulk-actions-toolbar');
    const selectionCount = document.getElementById('selection-count');
    const bulkCategorySelect = document.getElementById('bulk-category-select');
    const bulkApplyBtn = document.getElementById('apply-bulk-action-btn');
    const selectAllCheckbox = document.getElementById('select-all-checkbox');

    // --- Lógica de Busca e Renderização ---

    /**
     * Busca os produtos da API e orquestra a renderização da tabela e da paginação.
     */
    async function fetchAndDisplayProducts() {
        if (!tableBody) return;
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4"><i class="fas fa-spinner fa-spin mr-2"></i>A carregar produtos...</td></tr>`;
        const url = `${API_CONFIG.BASE_URL}/products?page=${currentPage}&limit=${currentLimit}&search=${currentSearch}`;

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Falha ao buscar os produtos.');
            
            const data = await response.json();
            const { products, page, pages } = data;

            currentPage = page;
            totalPages = pages;
            
            renderTable(products);
            updatePaginationControls();
            updateBulkActionsToolbar();

        } catch (error) {
            console.error('Erro ao buscar e exibir produtos:', error);
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red-500">Erro ao carregar produtos.</td></tr>`;
        }
    }

    /**
     * Renderiza as linhas da tabela com os dados dos produtos.
     * @param {Array} products - A lista de produtos a serem exibidos.
     */
    function renderTable(products) {
        tableBody.innerHTML = '';
        if (products.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4">Nenhum produto encontrado.</td></tr>`;
            return;
        }

        const rowsHtml = products.map(product => {
            const precoVenda = product.venda.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            const isChecked = selectedProductIds.has(product._id) ? 'checked' : '';
            const totalStockFromDeposits = Array.isArray(product.estoques)
                ? product.estoques.reduce((sum, entry) => {
                    const quantity = Number(entry?.quantidade);
                    return sum + (Number.isFinite(quantity) ? quantity : 0);
                }, 0)
                : Number(product.stock) || 0;
            const stockDisplay = Number.isFinite(totalStockFromDeposits)
                ? totalStockFromDeposits.toLocaleString('pt-BR', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 3,
                })
                : '0';

            const categoryTagsHtml = product.categorias && product.categorias.length > 0
                ? product.categorias.map(cat =>
                    `<span class="inline-flex items-center bg-gray-200 text-gray-700 text-xs font-medium px-2 py-0.5 rounded-full mr-1 mb-1">
                        ${cat.nome}
                        <button type="button" class="remove-category-btn flex-shrink-0 ml-1.5 h-4 w-4 rounded-full inline-flex items-center justify-center text-gray-400 hover:bg-gray-300 hover:text-gray-500 focus:outline-none" data-product-id="${product._id}" data-category-id="${cat._id}">
                            <svg class="h-2 w-2" stroke="currentColor" fill="none" viewBox="0 0 8 8"><path stroke-linecap="round" stroke-width="1.5" d="M1 1l6 6m0-6L1 7" /></svg>
                        </button>
                    </span>`
                ).join('')
                : '<span class="text-xs text-gray-400">Sem categoria</span>';
            
            return `
                <tr class="bg-white border-b hover:bg-gray-50">
                    <td class="p-4">
                        <input type="checkbox" class="product-checkbox form-checkbox h-4 w-4 text-primary rounded border-gray-300" data-id="${product._id}" ${isChecked}>
                    </td>
                    <td class="px-6 py-4">
                        <img src="${API_CONFIG.SERVER_URL}${product.imagemPrincipal}" alt="${product.nome}" class="w-16 h-16 object-cover rounded-md bg-gray-200 border">
                    </td>
                    <th scope="row" class="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                        <div>${product.nome}</div>
                        <div class="mt-1 flex flex-wrap items-center">${categoryTagsHtml}</div>
                    </th>
                    <td class="px-6 py-4">${precoVenda}</td>
                    <td class="px-6 py-4">${stockDisplay}</td>
                    <td class="px-6 py-4 text-center">
                        <a href="admin-produto-editar.html?id=${product._id}" class="font-medium text-blue-600 hover:underline mr-3">Editar</a>
                        <a href="#" class="font-medium text-red-600 hover:underline">Apagar</a>
                    </td>
                </tr>
            `;
        }).join('');
        tableBody.innerHTML = rowsHtml;
    }

    /**
     * Busca as categorias da API e preenche o dropdown de seleção em massa.
     */
    async function fetchCategoriesForDropdown() {
        try {
            const [hierarchicalRes, flatRes] = await Promise.all([
                fetch(`${API_CONFIG.BASE_URL}/categories/hierarchical`),
                fetch(`${API_CONFIG.BASE_URL}/categories`)
            ]);
            if (!hierarchicalRes.ok || !flatRes.ok) throw new Error('Falha ao buscar categorias');

            const hierarchicalCategories = await hierarchicalRes.json();
            allFlatCategories = await flatRes.json(); 
            
            bulkCategorySelect.innerHTML = '<option value="">Selecione uma categoria para aplicar</option>';

            const createOptions = (categories, parentLabel = '') => {
                for (const category of categories) {
                    const label = parentLabel ? `${parentLabel} > ${category.nome}` : category.nome;
                    if (category.children && category.children.length > 0) {
                        const optgroup = document.createElement('optgroup');
                        optgroup.label = label;
                        bulkCategorySelect.appendChild(optgroup);
                        createOptions(category.children, label);
                    } else {
                        const option = document.createElement('option');
                        option.value = category._id;
                        option.textContent = label;
                        bulkCategorySelect.appendChild(option);
                    }
                }
            };
            createOptions(hierarchicalCategories);
        } catch (error) {
            console.error('Erro ao buscar categorias:', error);
        }
    }

    // --- Lógica de UI (Paginação e Ações em Massa) ---

    /**
     * Verifica quantos produtos estão selecionados e mostra/esconde a barra de ações.
     */
    function updateBulkActionsToolbar() {
        const count = selectedProductIds.size;
        const totalVisibleCheckboxes = document.querySelectorAll('.product-checkbox').length;

        if (count > 0) {
            selectionCount.textContent = `${count} produto(s) selecionado(s)`;
            bulkActionsToolbar.classList.remove('hidden');
        } else {
            bulkActionsToolbar.classList.add('hidden');
        }
        
        selectAllCheckbox.checked = totalVisibleCheckboxes > 0 && count === totalVisibleCheckboxes;
    }

    /**
     * Atualiza a visibilidade e o estado dos botões de paginação.
     */
    function updatePaginationControls() {
        pageInfo.textContent = `Página ${currentPage} de ${totalPages}`;
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= totalPages;
    }

    // --- Event Listeners ---

    function initializeEventListeners() {
        limitSelect.addEventListener('change', (event) => {
            currentLimit = Number(event.target.value);
            currentPage = 1;
            fetchAndDisplayProducts();
        });
        
        searchInput.addEventListener('input', (event) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                currentSearch = event.target.value;
                currentPage = 1;
                fetchAndDisplayProducts();
            }, 500);
        });

        prevPageBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                fetchAndDisplayProducts();
            }
        });

        nextPageBtn.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                fetchAndDisplayProducts();
            }
        });

        selectAllCheckbox.addEventListener('change', () => {
            document.querySelectorAll('.product-checkbox').forEach(checkbox => {
                checkbox.checked = selectAllCheckbox.checked;
                const id = checkbox.dataset.id;
                if (selectAllCheckbox.checked) {
                    selectedProductIds.add(id);
                } else {
                    selectedProductIds.delete(id);
                }
            });
            updateBulkActionsToolbar();
        });

        tableBody.addEventListener('change', (event) => {
            if (event.target.classList.contains('product-checkbox')) {
                const id = event.target.dataset.id;
                if (event.target.checked) {
                    selectedProductIds.add(id);
                } else {
                    selectedProductIds.delete(id);
                }
                updateBulkActionsToolbar();
            }
        });

        bulkApplyBtn.addEventListener('click', async () => {
            const productIds = Array.from(selectedProductIds);
            const newCategoryId = bulkCategorySelect.value;
            let brandNameToUpdate = null;

            if (productIds.length === 0 || !newCategoryId) {
                showModal({ title: 'Atenção', message: 'Selecione pelo menos um produto e uma categoria.', confirmText: 'OK' });
                return;
            }

            const categoryMap = new Map(allFlatCategories.map(cat => [cat._id.toString(), cat]));
            let selectedCat = categoryMap.get(newCategoryId);
            
            while (selectedCat && selectedCat.parent) {
                const parent = categoryMap.get(selectedCat.parent.toString());
                if (parent && parent.nome === 'Marcas') {
                    brandNameToUpdate = categoryMap.get(newCategoryId).nome;
                    break;
                }
                selectedCat = parent;
            }

            const requestBody = { productIds, newCategoryId };
            if (brandNameToUpdate) {
                requestBody.brandName = brandNameToUpdate;
            }

            try {
                const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                const token = loggedInUser?.token;
                const response = await fetch(`${API_CONFIG.BASE_URL}/products/bulk-update-category`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(requestBody)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message);
                
                showModal({ title: 'Sucesso!', message: result.message, confirmText: 'OK', onConfirm: () => fetchAndDisplayProducts() });
            } catch (error) {
                showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
            }
        });

        tableBody.addEventListener('click', async (event) => {
            const removeButton = event.target.closest('button.remove-category-btn');
            if (removeButton) {
                const productId = removeButton.dataset.productId;
                const categoryId = removeButton.dataset.categoryId;
                const categoryName = removeButton.closest('span').firstChild.textContent.trim();
                const productName = removeButton.closest('tr').querySelector('th[scope="row"] > div').textContent.trim();

                showModal({
                    title: 'Confirmar Remoção',
                    message: `Tem a certeza que deseja remover a categoria "${categoryName}" do produto "${productName}"?`,
                    confirmText: 'Remover',
                    cancelText: 'Cancelar',
                    onConfirm: async () => {
                        try {
                            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                            const token = loggedInUser?.token;
                            const response = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}/categories/${categoryId}`, {
                                method: 'DELETE',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`
                                }
                            });
                            const result = await response.json();
                            if (!response.ok) throw new Error(result.message);

                            showModal({ title: 'Sucesso!', message: 'Categoria removida do produto.', confirmText: 'OK' });
                            fetchAndDisplayProducts();
                        } catch (error) {
                            showModal({ title: 'Erro', message: `Não foi possível remover a categoria: ${error.message}`, confirmText: 'OK' });
                        }
                    }
                });
            }
        });
    }

    // --- CARGA INICIAL ---
    fetchAndDisplayProducts();
    fetchCategoriesForDropdown();
    initializeEventListeners();
}

if (!window.__EOBICHO_ADMIN_VIEWS__) {
  window.__EOBICHO_ADMIN_VIEWS__ = {};
}
window.__EOBICHO_ADMIN_VIEWS__['admin-produtos'] = initAdminProdutos;

if (!window.AdminSPA) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdminProdutos, { once: true });
  } else {
    initAdminProdutos();
  }
}
