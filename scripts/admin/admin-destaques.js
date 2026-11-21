document.addEventListener('DOMContentLoaded', () => {
    // Referências aos elementos do DOM
    const availableList = document.getElementById('available-products-list');
    const featuredList = document.getElementById('featured-products-list');
    const searchInput = document.getElementById('search-available');

    // Variáveis para guardar o estado dos produtos
    let allProducts = [];
    let featuredProducts = [];
    let updatingFeatured = false;

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

        featuredProducts.forEach((product, index) => {
            const li = document.createElement('li');
            li.className = 'featured-product-row';
            li.dataset.id = product._id;
            li.innerHTML = `
                <div class="flex items-center gap-2">
                    <i class="fas fa-grip-vertical cursor-grab text-gray-500" aria-hidden="true"></i>
                    <span class="featured-product-name text-sm font-semibold"></span>
                </div>
                <div class="featured-product-actions">
                    <button type="button" data-move="-1" aria-label="Mover para cima"><i class="fas fa-chevron-up" aria-hidden="true"></i></button>
                    <button type="button" data-move="1" aria-label="Mover para baixo"><i class="fas fa-chevron-down" aria-hidden="true"></i></button>
                    <button type="button" class="remove-btn text-red-600" aria-label="Remover dos destaques"><i class="fas fa-times" aria-hidden="true"></i></button>
                </div>
            `;
            li.querySelector('.featured-product-name').textContent = product.nome;
            li.querySelector('[data-move="-1"]').disabled = updatingFeatured || index === 0;
            li.querySelector('[data-move="1"]').disabled = updatingFeatured || index === featuredProducts.length - 1;
            li.querySelector('.remove-btn').disabled = updatingFeatured;
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
        if (updatingFeatured) return;
        if (e.target.classList.contains('add-btn')) {
            const productId = e.target.dataset.id;
            setUpdating(true);
            try {
                const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                const token = loggedInUser?.token;
                const response = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}/destaque`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
                const addedProduct = allProducts.find(p => p._id === productId);
                if (!response.ok) throw new Error('Falha ao adicionar destaque.');

                featuredProducts.push(addedProduct);
            } catch (error) {
                 showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
            } finally {
                setUpdating(false);
                updateLists();
            }
        }
    });

    // Remover um produto dos destaques
    featuredList.addEventListener('click', async (e) => {
        if (updatingFeatured) return;
        const moveButton = e.target.closest('[data-move]');
        if (moveButton) {
            const productId = moveButton.closest('[data-id]').dataset.id;
            const index = featuredProducts.findIndex(product => product._id === productId);
            const destination = index + Number(moveButton.dataset.move);
            if (index < 0 || destination < 0 || destination >= featuredProducts.length) return;
            const reordered = [...featuredProducts];
            const [product] = reordered.splice(index, 1);
            reordered.splice(destination, 0, product);
            const saved = await saveOrder(reordered.map(item => item._id));
            if (!saved) return;
            const movedRow = [...featuredList.children].find(row => row.dataset.id === productId);
            const sameDirection = movedRow?.querySelector(`[data-move="${moveButton.dataset.move}"]:enabled`);
            (sameDirection || movedRow?.querySelector('[data-move]:enabled'))?.focus();
            return;
        }
        const removeButton = e.target.closest('.remove-btn');
        if (removeButton) {
            const productId = removeButton.closest('[data-id]').dataset.id;
            setUpdating(true);
            try {
                const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                const token = loggedInUser?.token;
                const response = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}/destaque`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                if (!response.ok) throw new Error('Falha ao remover destaque.');

                featuredProducts = featuredProducts.filter(p => p._id !== productId);
            } catch (error) {
                 showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
            } finally {
                setUpdating(false);
                updateLists();
            }
        }
    });

    function setUpdating(pending) {
        updatingFeatured = pending;
        sortable?.option('disabled', pending);
        featuredList.setAttribute('aria-busy', String(pending));
    }

    async function saveOrder(orderedIds) {
        if (updatingFeatured) return false;
        const previous = featuredProducts;
        const byId = new Map(previous.map(product => [product._id, product]));
        featuredProducts = orderedIds.map(id => byId.get(id));
        setUpdating(true);
        renderFeaturedProducts();
        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const response = await fetch(`${API_CONFIG.BASE_URL}/products/destaques/order`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loggedInUser?.token}` },
                body: JSON.stringify({ orderedIds })
            });
            if (!response.ok) throw new Error('Falha ao salvar a nova ordem.');
            return true;
        } catch (error) {
            featuredProducts = previous;
            showModal({ title: 'Erro', message: error.message, confirmText: 'OK' });
            return false;
        } finally {
            setUpdating(false);
            renderFeaturedProducts();
        }
    }

    const sortable = typeof Sortable === 'function' ? new Sortable(featuredList, {
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150,
        ghostClass: 'bg-green-100',
        handle: '.fa-grip-vertical',
        onEnd: ({ oldIndex, newIndex }) => {
            if (oldIndex === newIndex) return;
            void saveOrder([...featuredList.children].map(row => row.dataset.id).filter(Boolean));
        }
    }) : null;

    // --- Carga Inicial ---
    initializePage();
});
