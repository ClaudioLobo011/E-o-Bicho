// Variável de controlo para garantir que os eventos só sejam adicionados uma vez
let cartEventListenersAdded = false;

const cartPlaceholderOptions = ['/public/image/placeholder.svg', `${API_CONFIG.SERVER_URL}/image/placeholder.svg`, `${API_CONFIG.SERVER_URL}/image/placeholder.png`];

const normalizeCartImageUrl = (url) => {
    if (!url) return null;
    return /^https?:\/\//i.test(url) ? url : `${API_CONFIG.SERVER_URL}${url}`;
};

const buildCartProductImage = (product) => {
    const imageEl = document.createElement('img');
    imageEl.alt = product.nome || 'Produto';
    imageEl.className = 'w-20 h-20 object-contain border rounded-md';

    const productImageUrl = normalizeCartImageUrl(product.imagemPrincipal);
    const fallbackSources = [productImageUrl, ...cartPlaceholderOptions].filter(Boolean);
    let fallbackIndex = 0;

    imageEl.onerror = () => {
        fallbackIndex += 1;
        if (fallbackIndex < fallbackSources.length) {
            imageEl.src = fallbackSources[fallbackIndex];
        } else {
            imageEl.onerror = null;
        }
    };

    imageEl.src = fallbackSources[0] || cartPlaceholderOptions[0];
    return imageEl;
};

/**
 * Inicializa os botões principais da sacola (abrir/fechar).
 */
function initializeCart() {
    const openCartBtn = document.getElementById('open-cart-btn');
    const closeCartBtn = document.getElementById('close-cart-btn');
    const cartOverlay = document.getElementById('cart-overlay');
    const cartPanel = document.getElementById('cart-panel');
    
    if (!openCartBtn || !cartPanel) return;

    const openCart = async () => {
        await renderCartItems();
        cartOverlay.classList.remove('hidden');
        cartPanel.classList.remove('translate-x-full');
        document.body.classList.add('overflow-hidden');
    };

    const closeCart = () => {
        cartOverlay.classList.add('hidden');
        cartPanel.classList.add('translate-x-full');
        document.body.classList.remove('overflow-hidden');
    };
    
    openCartBtn.addEventListener('click', openCart);
    if (closeCartBtn) closeCartBtn.addEventListener('click', closeCart);
    if (cartOverlay) cartOverlay.addEventListener('click', closeCart);
}

/**
 * Desenha os itens dentro do painel da sacola.
 */
async function renderCartItems() {
    // Busca o carrinho atualizado do servidor, que já contém os preços efetivos
    const cart = await CartManager.getCart();
    
    // Referências aos elementos do DOM
    const container = document.getElementById('cart-items-container');
    const footer = document.getElementById('cart-footer');
    const subtotalEl = document.getElementById('cart-subtotal');

    // Se algum elemento crucial não for encontrado, a função para.
    if (!container || !footer || !subtotalEl) {
        console.error("Elementos da sacola não foram encontrados no DOM.");
        return;
    }

    // Limpa completamente o contentor antes de desenhar
    container.innerHTML = '';

    // Se o carrinho estiver vazio, mostra a mensagem apropriada
    if (cart.length === 0) {
        footer.classList.add('hidden');
        container.innerHTML = `
            <div id="cart-empty-state" class="p-6 text-center flex-grow flex flex-col justify-center items-center h-full">
                <div class="text-6xl text-gray-300 mb-4">
                    <i class="fas fa-shopping-bag"></i>
                </div>
                <h3 class="font-semibold text-lg text-gray-800">Você ainda não tem produtos na sacola.</h3>
            </div>
        `;
        return;
    }

    try {
        let subtotal = 0;

        // Itera sobre cada item do carrinho para criar o seu HTML
        cart.forEach(cartItem => {
            const product = cartItem.product;
            if (!product) return; // Pula itens cujo produto não foi encontrado
            
            // Usa o 'effectivePrice' que o back-end já calculou
            const itemTotal = cartItem.effectivePrice * cartItem.quantity;
            subtotal += itemTotal;

            const itemWrapper = document.createElement('div');
            itemWrapper.className = 'flex items-start space-x-3 p-2 border-b last:border-b-0';

            const imageEl = buildCartProductImage(product);
            itemWrapper.appendChild(imageEl);

            const infoWrapper = document.createElement('div');
            infoWrapper.className = 'flex-grow space-y-2';
            infoWrapper.innerHTML = `
                        <p class="text-sm font-semibold text-gray-800">${product.nome}</p>

                        <div>
                            ${cartItem.effectivePrice < product.venda ? `<p class="text-xs text-gray-500 line-through">R$ ${product.venda.toFixed(2).replace('.', ',')}</p>` : ''}
                            <p class="text-sm font-bold text-primary">R$ ${cartItem.effectivePrice.toFixed(2).replace('.', ',')} <span class="text-xs text-gray-600 font-normal">/un.</span></p>
                        </div>

                        <div class="flex items-center justify-between">
                            <div class="flex items-center border border-gray-200 rounded">
                                <button class="px-2 py-1 text-gray-600 hover:bg-gray-100" data-action="decrease-qty" data-product-id="${product._id}">-</button>
                                <span class="px-3 text-sm font-bold">${cartItem.quantity}</span>
                                <button class="px-2 py-1 text-gray-600 hover:bg-gray-100" data-action="increase-qty" data-product-id="${product._id}">+</button>
                            </div>
                            <p class="text-base font-bold text-gray-800">R$ ${itemTotal.toFixed(2).replace('.', ',')}</p>
                        </div>`;

            itemWrapper.appendChild(infoWrapper);

            const removeButton = document.createElement('button');
            removeButton.className = 'text-gray-400 hover:text-red-500 pt-1';
            removeButton.dataset.action = 'remove-item';
            removeButton.dataset.productId = product._id;
            removeButton.innerHTML = '<i class="fas fa-trash-alt"></i>';

            itemWrapper.appendChild(removeButton);
            container.appendChild(itemWrapper);
        });
        
        // Atualiza o subtotal e mostra o rodapé
        subtotalEl.textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
        footer.classList.remove('hidden');

    } catch (error) {
        console.error('Erro ao renderizar itens do carrinho:', error);
        container.innerHTML = '<p class="text-red-500">Ocorreu um erro ao carregar a sua sacola.</p>';
    }
}

/**
 * Adiciona os "escutadores" de eventos de clique para os botões da sacola.
 * Usa uma variável de controlo para garantir que só é executado uma vez.
 */
function initializeCartEventListeners() {
    if (cartEventListenersAdded) {
        return;
    }

    document.body.addEventListener('click', async (event) => {
        const target = event.target;
        const actionButton = target.closest('button[data-action]');
        
        if (!actionButton || !document.getElementById('cart-items-container')?.contains(actionButton)) {
            return;
        }

        const action = actionButton.dataset.action;
        const productId = actionButton.dataset.productId;

        if (!action || !productId) return;

        actionButton.disabled = true;

        if (action === 'remove-item') {
            await CartManager.removeItem(productId);
        } else {
            const cart = await CartManager.getCart();
            const currentItem = cart.find(item => item.product && item.product._id.toString() === productId);
            if (!currentItem) {
                actionButton.disabled = false;
                return;
            }

            if (action === 'increase-qty') {
                await CartManager.updateQuantity(productId, currentItem.quantity + 1);
            } else if (action === 'decrease-qty') {
                await CartManager.updateQuantity(productId, currentItem.quantity - 1);
            }
        }
        
        await renderCartItems();
    });

    cartEventListenersAdded = true;
}

/**
 * Observador que espera os componentes serem carregados para inicializar tudo.
 */
document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver((mutationsList, obs) => {
        if (document.getElementById('open-cart-btn') && document.getElementById('cart-panel')) {
            initializeCart();
            if (typeof CartManager !== 'undefined') CartManager.updateCartCount();
            initializeCartEventListeners();
            obs.disconnect();
        }
    });

    if (document.getElementById('header-placeholder')) {
        observer.observe(document.body, { childList: true, subtree: true });
    }

    const cartContainer = document.getElementById('cart-items-container');
    if(cartContainer) {
        cartContainer.addEventListener('click', async (event) => {
            const target = event.target.closest('button[data-action="toggle-subscription"]');
            if (!target) return;
            
            const productId = target.dataset.productId;
            const cart = await CartManager.getCart();
            const currentItem = cart.find(item => item.product._id === productId);
            if (!currentItem) return;

            // Inverte o estado da assinatura e chama a API
            await CartManager.updateSubscription(productId, !currentItem.isSubscribed);
            await renderCartItems(); // Re-renderiza para mostrar o novo preço
        });
    }

});