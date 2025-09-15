/**
 * Exibe um modal para confirmar a remoção de um produto dos favoritos.
 * @param {string} productId - O ID do produto a ser removido.
 * @param {string} productName - O nome do produto (para a mensagem).
 */
async function confirmRemoveFavorite(productId, productName) {
    showModal({
        title: 'Remover Favorito',
        message: `Tem a certeza de que deseja remover "${productName}" dos seus favoritos?`,
        confirmText: 'Sim, remover',
        cancelText: 'Cancelar',
        onConfirm: async () => {
            // Usa o novo FavoritesManager para remover o item no back-end
            await FavoritesManager.removeFavorite(productId);
            // Recarrega a lista de favoritos na página sem precisar de recarregar a página inteira
            loadFavorites(); 
        }
    });
}

/**
 * Carrega e renderiza os produtos favoritados a partir do back-end.
 */
async function loadFavorites() {
    const container = document.getElementById('favorites-list-container');
    const emptyState = document.getElementById('favorites-empty-state');

    if (!container) {
        return; // Sai se não estiver na página de favoritos
    }

    // Usa o novo FavoritesManager para buscar os IDs de favoritos do utilizador logado
    const favoriteIds = await FavoritesManager.getFavorites();

    if (favoriteIds.length === 0) {
        container.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    try {
        // Usa a rota existente para buscar os dados completos dos produtos a partir dos seus IDs
        const response = await fetch(`${API_CONFIG.BASE_URL}/products/by-ids`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${JSON.parse(localStorage.getItem('loggedInUser'))?.token || ''}`
            },
            body: JSON.stringify({ ids: favoriteIds })
        });
        const products = await response.json();
        
        if (!response.ok) throw new Error('Falha ao buscar os detalhes dos produtos favoritos.');

        container.innerHTML = '';
        products.forEach(product => {
            let priceHtml = '';
            // Lógica de Hierarquia de Preços (consistente com as outras páginas)
            if (product.promocao && product.promocao.ativa && product.promocao.porcentagem > 0) {
                const discountedPrice = product.venda * (1 - product.promocao.porcentagem / 100);
                priceHtml = `<div><span class="block text-sm text-gray-500 line-through">R$ ${product.venda.toFixed(2).replace('.', ',')}</span><div class="flex items-center"><span class="text-lg font-bold text-primary">R$ ${discountedPrice.toFixed(2).replace('.', ',')}</span><span class="ml-2 text-xs font-bold text-white bg-primary rounded-full px-2 py-0.5">Promo</span></div></div>`;
            } else if (product.promocaoCondicional && product.promocaoCondicional.ativa) {
                let promoText = 'Oferta Especial';
                if (product.promocaoCondicional.tipo === 'leve_pague') { promoText = `Leve ${product.promocaoCondicional.leve} Pague ${product.promocaoCondicional.pague}`; }
                else if (product.promocaoCondicional.tipo === 'acima_de') { promoText = `+${product.promocaoCondicional.quantidadeMinima} un. com ${product.promocaoCondicional.descontoPorcentagem}%`; }
                priceHtml = `<div><span class="block text-lg font-bold text-gray-800">R$ ${product.venda.toFixed(2).replace('.', ',')}</span><div class="flex items-center"><span class="text-xs font-bold text-white bg-primary rounded-full px-2 py-1">${promoText}</span></div></div>`;
            } else if (product.precoClube && product.precoClube < product.venda) {
                priceHtml = `<div><span class="block text-lg font-bold text-gray-950">R$ ${product.venda.toFixed(2).replace('.', ',')}</span><div class="flex items-center"><span class="text-lg font-bold text-primary">R$ ${product.precoClube.toFixed(2).replace('.', ',')}</span><span class="ml-2 text-xs font-bold text-white bg-primary rounded-full px-2 py-0.5">Club</span></div></div>`;
            } else {
                priceHtml = `<span class="block text-lg font-bold text-gray-950">R$ ${product.venda.toFixed(2).replace('.', ',')}</span>`;
            }

            const productCardHtml = `
                <div class="relative bg-white rounded-lg shadow product-card transition duration-300 group overflow-hidden flex flex-col">
                    <button class="absolute top-2 right-2 z-20 p-1.5 bg-white/80 backdrop-blur-sm rounded-full shadow-md transition-colors duration-200 hover:bg-red-50 focus:outline-none" onclick="confirmRemoveFavorite('${product._id}', '${product.nome.replace(/'/g, "\\'")}')" aria-label="Remover dos favoritos">
                        <svg class="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" /></svg>
                    </button>
                    ${product.promocao && product.promocao.ativa && product.promocao.porcentagem > 0 ? `<div class="absolute top-3 left-0 w-auto bg-primary text-white text-xs font-bold py-1 pl-2 pr-3 rounded-r z-10">-${product.promocao.porcentagem}% DE DESCONTO</div>` : ''}
                    <a href="/pages/menu-departments-item/product.html?id=${product._id}" class="block">
                        <div class="p-4 product-info flex flex-col h-full">
                            <div class="relative w-full h-48 mb-4">
                                <img src="${API_CONFIG.SERVER_URL}${product.imagemPrincipal}" alt="${product.nome}" class="w-full h-full object-contain rounded-md">
                                <div class="add-to-cart absolute bottom-3 right-3 w-[55px] h-[55px] flex items-center justify-center rounded-full transition-all duration-300 opacity-0 group-hover:opacity-100 hover:bg-secondary" data-product-id="${product._id}">
                                    <div data-icon="sacola" class="w-[55px] h-[55px]"></div>
                                    <span class="sr-only">Adicionar ao Carrinho</span>
                                </div>
                            </div>
                            <div class="product-details flex flex-col flex-grow">
                                <h3 class="font-normal text-base h-12 line-clamp-2">${product.nome}</h3>
                                <div class="product-price flex items-center mb-2 mt-auto min-h-[4rem]">${priceHtml}</div>
                            </div>
                        </div>
                    </a>
                </div>`;
            container.innerHTML += productCardHtml;
        });
        
        emptyState.classList.add('hidden');
        container.classList.remove('hidden');

    } catch (error) {
        console.error('Erro ao carregar favoritos:', error);
        container.innerHTML = '<p class="text-red-500">Ocorreu um erro ao carregar os seus favoritos.</p>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Só executa o código dos favoritos se estivermos na página de favoritos
    if (window.location.pathname.endsWith('favoritos.html')) {
        loadFavorites();
    }
});