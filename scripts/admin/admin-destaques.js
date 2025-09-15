document.addEventListener('DOMContentLoaded', () => {
    // Referências aos elementos do DOM
    const availableList = document.getElementById('available-products-list');
    const featuredList = document.getElementById('featured-products-list');
    const searchInput = document.getElementById('search-available');

    // Variáveis para guardar o estado dos produtos
    let allProducts = [];
    let featuredProducts = [];

    /**
     * Atualiza ambas as listas com base no estado atual e no filtro de busca.
     */
    const updateLists = () => {
        const searchTerm = searchInput.value.toLowerCase();
        const filteredProducts = allProducts.filter(p => p.nome.toLowerCase().includes(searchTerm));
        
        renderAvailableProducts(filteredProducts);
        renderFeaturedProducts();
    };

    /**
     * Renderiza a lista de produtos disponíveis (à esquerda).
     * @param {Array} productsToRender - A lista de produtos a serem exibidos.
     */
    const renderAvailableProducts = (productsToRender) => {
        availableList.innerHTML = '';
        const featuredIds = new Set(featuredProducts.map(p => p._id));
        
        const availableToRender = productsToRender.filter(p => !featuredIds.has(p._id));

        if (availableToRender.length === 0) {
            availableList.innerHTML = '<li class="p-2 border rounded-md text-center text-gray-500">Nenhum produto encontrado.</li>';
            return;
        }

        availableToRender.forEach(product => {
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between p-2 border rounded-md bg-white';
            li.innerHTML = `
                <span class="text-sm">${product.nome}</span>
                <button data-id="${product._id}" class="add-btn text-green-600 hover:text-green-800 text-sm font-bold">Adicionar</button>
            `;
            availableList.appendChild(li);
        });
    };

    /**
     * Renderiza a lista de produtos em destaque (à direita).
     */
    const renderFeaturedProducts = () => {
        featuredList.innerHTML = '';
        if (featuredProducts.length === 0) {
            featuredList.innerHTML = '<li class="p-2 border rounded-md text-center text-gray-500">Arraste um produto para aqui ou clique em "Adicionar".</li>';
            return;
        }

        featuredProducts.forEach(product => {
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between p-2 border rounded-md bg-green-50 cursor-grab';
            li.dataset.id = product._id;
            li.innerHTML = `
                <div class="flex items-center">
                    <i class="fas fa-grip-vertical mr-2 text-gray-400"></i>
                    <span class="text-sm font-semibold">${product.nome}</span>
                </div>
                <button data-id="${product._id}" class="remove-btn text-red-500 hover:text-red-700">
                    <i class="fas fa-times"></i>
                </button>
            `;
            featuredList.appendChild(li);
        });
    };

    /**
     * Busca todos os dados do servidor e inicializa a página.
     */
    const initializePage = async () => {
        try {
            const [productsRes, featuredRes] = await Promise.all([
                fetch(`${API_CONFIG.BASE_URL}/products?limit=2000`),
                fetch(`${API_CONFIG.BASE_URL}/products/destaques`)
            ]);

            if (!productsRes.ok || !featuredRes.ok) {
                throw new Error('Falha ao carregar os dados do servidor.');
            }

            const productsData = await productsRes.json();
            const featuredData = await featuredRes.json();

            allProducts = productsData.products;
            featuredProducts = featuredData;
            
            updateLists();

        } catch (error) {
            console.error(error);
            showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
        }
    };
    
    // --- Event Listeners ---

    // Filtro de busca
    searchInput.addEventListener('input', () => {
        updateLists();
    });

    // Adicionar um produto aos destaques
    availableList.addEventListener('click', async (e) => {
        if (e.target.classList.contains('add-btn')) {
            const productId = e.target.dataset.id;
            try {
                const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                const token = loggedInUser?.token;
                const response = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}/destaque`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
                const addedProduct = allProducts.find(p => p._id === productId);
                if (!response.ok) throw new Error('Falha ao adicionar destaque.');

                // --- LÓGICA DE ATUALIZAÇÃO INTELIGENTE ---
                featuredProducts.push(addedProduct); // Adiciona o produto à lista local de destaques
                updateLists(); // Re-renderiza as listas mantendo o filtro
                
            } catch (error) {
                 showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
            }
        }
    });

    // Remover um produto dos destaques
    featuredList.addEventListener('click', async (e) => {
        const removeButton = e.target.closest('.remove-btn');
        if (removeButton) {
            const productId = removeButton.dataset.id;
            try {
                const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                const token = loggedInUser?.token;
                const response = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}/destaque`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                if (!response.ok) throw new Error('Falha ao remover destaque.');

                // --- LÓGICA DE ATUALIZAÇÃO INTELIGENTE ---
                featuredProducts = featuredProducts.filter(p => p._id !== productId); // Remove o produto da lista local
                updateLists(); // Re-renderiza as listas mantendo o filtro

            } catch (error) {
                 showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
            }
        }
    });

    // Inicialização da funcionalidade de arrastar e soltar
    new Sortable(featuredList, {
        animation: 150,
        ghostClass: 'bg-green-100',
        handle: '.fa-grip-vertical',
        onEnd: async function (evt) {
            const orderedIds = Array.from(evt.target.children).map(li => li.dataset.id);
            // Atualiza a ordem da nossa lista local para consistência visual imediata
            featuredProducts.sort((a, b) => orderedIds.indexOf(a._id) - orderedIds.indexOf(b._id));
            try {
                const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                const token = loggedInUser?.token;
                const response = await fetch(`${API_CONFIG.BASE_URL}/products/destaques/order`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ orderedIds })
                });
                if (!response.ok) throw new Error('Falha ao salvar a nova ordem.');
            } catch (error) {
                 showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
            }
        }
    });

    // --- Carga Inicial ---
    initializePage();
});