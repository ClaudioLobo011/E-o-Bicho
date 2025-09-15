document.addEventListener('DOMContentLoaded', () => {

    // Atualiza toda a UI do checkout após mudanças no carrinho
    async function refreshCheckoutUI() {
    try {
        // re-renderiza itens, resumo e barra de frete grátis
        await loadAndRenderPage();

        // recalcula o frete para o CEP atual (se houver)
        if (typeof findCepInput === 'function' && typeof triggerFreteRecalc === 'function') {
        const cepEl = findCepInput();
        const cep = cepEl?.value?.replace(/\D/g, '');
        if (cep) triggerFreteRecalc(cep);
        }
    } catch (err) {
        console.error('[checkout] refreshCheckoutUI error:', err);
    }
    }

    function getAuthHeaders() {
        const user = JSON.parse(localStorage.getItem('loggedInUser'));
        return user?.token ? { 'Authorization': `Bearer ${user.token}` } : {};
    }

    const tableBody = document.getElementById('checkout-items-body');
    if (!tableBody) return;
    let selectedDelivery = {
        cost: 0,
        type: 'Padrão' 
    };
    const freeShippingGoal = 100;

    // --- FUNÇÕES DE RENDERIZAÇÃO ---
    function renderCheckoutItems(cart) {
        tableBody.innerHTML = '';
        if (!cart || cart.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="5" class="text-center py-10 text-gray-500">O seu carrinho está vazio.</td></tr>';
            return;
        }

        cart.forEach(cartItem => {
            const product = cartItem.product;
            if (!product) return;
            
            const itemTotal = cartItem.effectivePrice * cartItem.quantity;

            const isSubscribed = cartItem.isSubscribed;
            const switchBg = isSubscribed ? 'bg-primary' : 'bg-gray-200';
            const switchTranslate = isSubscribed ? 'translate-x-5' : 'translate-x-0';

            const rowHtml = `
                <tr class="border-b">
                    <td class="py-4 px-4 align-top">
                        <div class="flex items-start space-x-3">
                            <img src="${API_CONFIG.SERVER_URL}${product.imagemPrincipal}" alt="${product.nome}" class="w-16 h-16 object-contain border rounded-md">
                            <div>
                                <p class="font-semibold text-gray-800">${product.nome}</p>
                                
                                <div class="mt-2">
                                    <button data-action="toggle-subscription" data-product-id="${product._id}" class="${switchBg} relative inline-flex h-6 w-11 items-center rounded-full transition-colors">
                                        <span class="${switchTranslate} inline-block h-4 w-4 transform rounded-full bg-white transition-transform"></span>
                                    </button>
                                    <span class="ml-2 text-sm font-medium ${isSubscribed ? 'text-primary' : 'text-gray-600'}">
                                        Assinatura Recorrente
                                    </span>
                                </div>

                                <div class="mt-2 ${!isSubscribed ? 'hidden' : ''}">
                                    <label class="text-xs text-gray-500">Envio a cada</label>
                                    <select data-action="update-frequency" data-product-id="${product._id}" class="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm rounded-md">
                                        <option value="30" ${cartItem.subscriptionFrequency === 30 ? 'selected' : ''}>30 dias</option>
                                        <option value="45" ${cartItem.subscriptionFrequency === 45 ? 'selected' : ''}>45 dias</option>
                                        <option value="60" ${cartItem.subscriptionFrequency === 60 ? 'selected' : ''}>60 dias</option>
                                        <option value="90" ${cartItem.subscriptionFrequency === 90 ? 'selected' : ''}>90 dias</option>
                                        <option value="custom">Personalizar</option>
                                    </select>
                                </div>

                            </div>
                        </div>
                    </td>
                    <td class="py-4 px-2 text-center">
                        ${(product.venda - cartItem.effectivePrice > 0.01) ? `<span class="line-through text-gray-400">R$ ${product.venda.toFixed(2).replace('.', ',')}</span>` : ''}
                        <span class="block font-medium">R$ ${cartItem.effectivePrice.toFixed(2).replace('.', ',')}</span>
                    </td>
                    <td class="py-4 px-2 text-center">
                        <div class="flex items-center justify-center">
                            <button data-action="decrease-qty" data-product-id="${product._id}" class="w-7 h-7 flex items-center justify-center border rounded-l hover:bg-gray-100">-</button>
                            <span class="w-8 h-7 flex items-center justify-center border-t border-b">${cartItem.quantity}</span>
                            <button data-action="increase-qty" data-product-id="${product._id}" class="w-7 h-7 flex items-center justify-center border rounded-r hover:bg-gray-100">+</button>
                        </div>
                    </td>
                    <td class="py-4 px-2 text-center font-bold">R$ ${itemTotal.toFixed(2).replace('.', ',')}</td>
                    <td class="py-4 px-2 text-center">
                        <button data-action="remove-item" data-product-id="${product._id}" class="text-gray-400 hover:text-red-500"><i class="far fa-trash-alt"></i></button>
                    </td>
                </tr>
            `;
            tableBody.innerHTML += rowHtml;
        });
    }

    function updateDeliveryOptionsUI(isFreeShipping) {
        const allButtons = document.querySelectorAll('.delivery-option-btn');
        allButtons.forEach(btn => {
            // Agora procuramos pela classe específica, tornando o código mais seguro
            const priceSpan = btn.querySelector('.delivery-price-span'); 
            if (!priceSpan) return;

            // Se o frete for grátis para o total da compra, todas as opções ficam "Grátis"
            if (isFreeShipping) {
                priceSpan.textContent = 'Grátis';
                priceSpan.classList.add('text-primary'); // Garante que fique verde
                priceSpan.classList.remove('text-gray-500');
            } else {
                // Se não, volta a mostrar o preço original guardado no data-cost
                const originalCost = parseFloat(btn.dataset.cost);
                if (originalCost === 0) {
                    priceSpan.textContent = 'Grátis';
                    priceSpan.classList.add('text-primary');
                    priceSpan.classList.remove('text-gray-500');
                } else {
                    priceSpan.textContent = `R$ ${originalCost.toFixed(2).replace('.', ',')}`;
                    priceSpan.classList.remove('text-primary', 'text-gray-500'); // Remove cores especiais se não for grátis
                }
            }
        });
    }

    function updateSummary(cart) {
        const itemCountEl = document.getElementById('summary-item-count');
        const subtotalEl = document.getElementById('summary-subtotal');
        const discountsEl = document.getElementById('summary-discounts');
        const deliveryEl = document.getElementById('summary-delivery');
        const totalEl = document.getElementById('summary-total');

        const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
        const subtotal = cart.reduce((sum, item) => sum + (item.product.venda * item.quantity), 0);
        const totalEffective = cart.reduce((sum, item) => sum + (item.effectivePrice * item.quantity), 0);
        const totalDiscounts = subtotal - totalEffective;
        
        // Lógica de Frete Grátis
        const hasFreeShipping = totalEffective >= freeShippingGoal;
        const finalDeliveryCost = hasFreeShipping ? 0 : selectedDelivery.cost;

        const finalTotal = totalEffective + finalDeliveryCost;

        itemCountEl.textContent = itemCount;
        subtotalEl.textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
        discountsEl.textContent = `- R$ ${totalDiscounts.toFixed(2).replace('.', ',')}`;
        if(deliveryEl) deliveryEl.textContent = finalDeliveryCost > 0 ? `R$ ${finalDeliveryCost.toFixed(2).replace('.', ',')}` : 'Grátis';
        totalEl.textContent = `R$ ${finalTotal.toFixed(2).replace('.', ',')}`;
        
        // Chama a nova função para atualizar a aparência dos botões
        updateDeliveryOptionsUI(hasFreeShipping);
    }

    async function loadFeaturedProducts() {
        const container = document.getElementById('featured-products-container');
        const wrapper = document.getElementById('featured-slider-wrapper');
        const prevButton = document.getElementById('prev-featured-btn');
        const nextButton = document.getElementById('next-featured-btn');

        // Se os elementos do slider não existirem na página, a função para.
        if (!container || !wrapper || !prevButton || !nextButton) {
            return;
        }

        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/products/destaques`);
            if (!response.ok) throw new Error('Não foi possível buscar os produtos em destaque.');
            
            const products = await response.json();

            if (products.length === 0) {
                wrapper.innerHTML = '<p class="text-center text-gray-500 col-span-full">Nenhum produto em destaque no momento.</p>';
                return;
            }

            container.innerHTML = ''; 

            products.forEach(product => {
                // A lógica de preços que já definimos continua igual
                let priceHtml = '';
                if (product.promocao && product.promocao.ativa && product.promocao.porcentagem > 0) {
                    const discountedPrice = product.venda * (1 - product.promocao.porcentagem / 100);
                    priceHtml = `
                        <div>
                            <span class="block text-sm text-gray-500 line-through">R$ ${product.venda.toFixed(2).replace('.', ',')}</span>
                            <div class="flex items-center">
                                <span class="text-lg font-bold text-primary">R$ ${discountedPrice.toFixed(2).replace('.', ',')}</span>
                                <span class="ml-2 text-xs font-bold text-white bg-primary rounded-full px-2 py-0.5">Promo</span>
                            </div>
                        </div>
                    `;
                } else if (product.promocaoCondicional && product.promocaoCondicional.ativa) {
                    let promoText = 'Oferta Especial';
                    if (product.promocaoCondicional.tipo === 'leve_pague') {
                        promoText = `Leve ${product.promocaoCondicional.leve} Pague ${product.promocaoCondicional.pague}`;
                    } else if (product.promocaoCondicional.tipo === 'acima_de') {
                        promoText = `+${product.promocaoCondicional.quantidadeMinima} un. com ${product.promocaoCondicional.descontoPorcentagem}%`;
                    }
                    priceHtml = `
                        <div>
                            <span class="block text-lg font-bold text-gray-800">R$ ${product.venda.toFixed(2).replace('.', ',')}</span>
                            <div class="flex items-center">
                                <span class="text-xs font-bold text-white bg-primary rounded-full px-2 py-1">${promoText}</span>
                            </div>
                        </div>
                    `;
                } else if (product.precoClube && product.precoClube < product.venda) {
                    priceHtml = `
                        <div>
                            <span class="block text-lg font-bold text-gray-950">R$ ${product.venda.toFixed(2).replace('.', ',')}</span>
                            <div class="flex items-center">
                                <span class="text-lg font-bold text-primary">R$ ${product.precoClube.toFixed(2).replace('.', ',')}</span>
                                <span class="ml-2 text-xs font-bold text-white bg-primary rounded-full px-2 py-0.5">Club</span>
                            </div>
                        </div>
                    `;
                } else {
                    priceHtml = `<span class="block text-lg font-bold text-gray-950">R$ ${product.venda.toFixed(2).replace('.', ',')}</span>`;
                }

                // Criação do card completo do produto
                const productCard = `
                    <a href="${basePath}pages/menu-departments-item/product.html?id=${product._id}" class="relative block bg-white rounded-lg shadow product-card transition duration-300 group overflow-hidden w-60 sm:w-64 flex-shrink-0">
                        
                        ${product.promocao && product.promocao.ativa && product.promocao.porcentagem > 0 ? `
                            <div class="absolute top-3 left-0 w-auto bg-primary text-white text-xs font-bold py-1 pl-2 pr-3 rounded-r z-10">
                                -${product.promocao.porcentagem}% DE DESCONTO
                            </div>
                        ` : ''}

                        <div class="p-4 product-info flex flex-col h-full">
                            <div class="relative w-full h-48 mb-4">
                                <img src="${API_CONFIG.SERVER_URL}${product.imagemPrincipal}" alt="${product.nome}" class="w-full h-full object-cover rounded-md">
                                
                                <div class="add-to-cart absolute bottom-3 right-3 w-[55px] h-[55px] flex items-center justify-center rounded-full transition-all duration-300 opacity-0 group-hover:opacity-100 hover:bg-secondary" data-product-id="${product._id}">
                                    <div data-icon="sacola" class="w-[55px] h-[55px]"></div>
                                    <span class="sr-only">Adicionar ao Carrinho</span>
                                </div>
                            </div>
                            <div class="product-details flex flex-col flex-grow">
                                <h3 class="font-normal text-base h-12 line-clamp-2">${product.nome}</h3>
                                <div class="product-price flex items-center mb-2 mt-auto min-h-[2.5rem]">${priceHtml}</div>
                            </div>
                        </div>
                    </a>
                `;

                container.innerHTML += productCard;
            });

            container.addEventListener('click', async (event) => {
            const btn = event.target.closest('.add-to-cart');
            if (!btn) return;

            event.preventDefault();
            const productId = btn.dataset.productId;

            try {
                await CartManager.addItem(productId);               // adiciona no carrinho (já atualiza o badge)
                if (typeof showToast === 'function') {
                showToast('Produto adicionado à sacola.', 'success');
                }
                await refreshCheckoutUI();                          // << re-render da página do checkout
                // opcional: rolar até o topo da tabela para o usuário ver o item novo
                const tbl = document.getElementById('checkout-items');
                if (tbl) tbl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (err) {
                console.error(err);
                if (typeof showToast === 'function') showToast('Não foi possível adicionar o produto.', 'error');
            }
            });

            // Lógica de navegação do slider
            let currentIndex = 0;
            const totalItems = products.length;
            const updateSlider = () => {
                const card = container.querySelector('.product-card');
                if (!card) return;
                const cardWidth = card.offsetWidth;
                const gap = 24;
                const itemsVisible = Math.floor(wrapper.offsetWidth / (cardWidth + gap));
                const maxIndex = Math.max(0, totalItems - itemsVisible);
                if (currentIndex > maxIndex) currentIndex = maxIndex;
                if (currentIndex < 0) currentIndex = 0;
                const moveDistance = (cardWidth + gap) * currentIndex;
                container.style.transform = `translateX(-${moveDistance}px)`;
                prevButton.disabled = currentIndex === 0;
                nextButton.disabled = currentIndex >= maxIndex;
            };
            nextButton.addEventListener('click', () => {
                const card = container.querySelector('.product-card');
                if (!card) return;
                const cardWidth = card.offsetWidth;
                const gap = 24;
                const itemsVisible = Math.floor(wrapper.offsetWidth / (cardWidth + gap));
                const maxIndex = Math.max(0, totalItems - itemsVisible);
                currentIndex = Math.min(currentIndex + itemsVisible, maxIndex);
                updateSlider();
            });
            prevButton.addEventListener('click', () => {
                const card = container.querySelector('.product-card');
                if (!card) return;
                const cardWidth = card.offsetWidth;
                const gap = 24;
                const itemsVisible = Math.floor(wrapper.offsetWidth / (cardWidth + gap));
                currentIndex = Math.max(currentIndex - itemsVisible, 0);
                updateSlider();
            });
            let resizeTimer;
            window.addEventListener('resize', () => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(updateSlider, 250);
            });
            updateSlider();
            if (typeof loadIcons === 'function') {
                await loadIcons();
            }
            
        } catch (error) {
            console.error('Erro ao carregar produtos em destaque:', error);
            wrapper.innerHTML = '<p class="text-center text-red-500">Ocorreu um erro ao carregar os produtos.</p>';
        }
    }

    function updateFreeShippingProgress(total) {
        const freeShippingGoal = 100; // Define o valor para frete grátis (R$ 100)
        const progressBarContainer = document.getElementById('free-shipping-progress-bar');
        const progressText = document.getElementById('free-shipping-text');
        const progressValues = document.getElementById('free-shipping-values');
        const progressFill = document.getElementById('free-shipping-fill');

        if (!progressBarContainer) return;

        if (total >= freeShippingGoal) {
            // Se já atingiu o frete grátis
            progressBarContainer.classList.remove('hidden');
            progressText.innerHTML = '<span class="text-primary font-bold">Você conseguiu Frete Grátis!</span> 🎉';
            progressValues.textContent = `R$ ${total.toFixed(2)} / R$ ${freeShippingGoal.toFixed(2)}`;
            progressFill.style.width = '100%';
        } else if (total > 0) {
            // Se está a caminho
            const remaining = freeShippingGoal - total;
            const percentage = (total / freeShippingGoal) * 100;
            progressBarContainer.classList.remove('hidden');
            progressText.innerHTML = `Faltam <span class="font-bold text-primary">R$ ${remaining.toFixed(2).replace('.', ',')}</span> para <span class="font-bold">Frete Grátis</span>`;
            progressValues.textContent = `R$ ${total.toFixed(2)} / R$ ${freeShippingGoal.toFixed(2)}`;
            progressFill.style.width = `${percentage}%`;
        } else {
            // Se o carrinho estiver vazio
            progressBarContainer.classList.add('hidden');
        }
    }

    async function loadAndRenderPage() {
        const cart = await CartManager.getCart();
        renderCheckoutItems(cart);
        updateSummary(cart);

        const total = cart.reduce((sum, item) => sum + (item.effectivePrice * item.quantity), 0);
        updateFreeShippingProgress(total);
    }

    // --- EVENT LISTENERS ---
    tableBody.addEventListener('click', async (event) => {
        const target = event.target.closest('button[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const productId = target.dataset.productId;
        if (!action || !productId) return;

        const cart = await CartManager.getCart();
        const currentItem = cart.find(item => item.product._id === productId);

        if (action === 'remove-item') {
            await CartManager.removeItem(productId);
        } else if (currentItem) {
            if (action === 'increase-qty') {
                await CartManager.updateQuantity(productId, currentItem.quantity + 1);
            } else if (action === 'decrease-qty') {
                await CartManager.updateQuantity(productId, currentItem.quantity - 1);
            } else if (action === 'toggle-subscription') {
                await CartManager.updateSubscription(productId, !currentItem.isSubscribed);
            }
        }
        
        loadAndRenderPage(); // Recarrega e renderiza tudo para mostrar o novo preço
    });

    const deliveryContainer = document.getElementById('delivery-options-container');
    if (deliveryContainer) {
        deliveryContainer.addEventListener('click', (event) => {
            const selectedButton = event.target.closest('.delivery-option-btn');
            if (!selectedButton) return;

            // 1. Atualiza a opção de entrega selecionada na variável
            selectedDelivery = {
                cost: parseFloat(selectedButton.dataset.cost),
                type: selectedButton.dataset.type
            };
            
            // 2. Remove o destaque de TODOS os botões, restaurando para o estado padrão
            deliveryContainer.querySelectorAll('.delivery-option-btn').forEach(btn => {
                btn.classList.remove('border-primary', 'bg-primary/10'); // Remove classes de seleção
                btn.classList.add('border-gray-200', 'bg-transparent');   // Adiciona classes padrão
            });

            // 3. Adiciona o destaque APENAS ao botão que foi clicado
            selectedButton.classList.remove('border-gray-200', 'bg-transparent'); // Remove classes padrão
            selectedButton.classList.add('border-primary', 'bg-primary/10');      // Adiciona classes de seleção
            
            // 4. Recalcula o sumário com a nova seleção
            loadAndRenderPage();
        });
    }

    (function () {
    // Helpers locais (não colidem com o seu código existente)
    function onlyDigits(v) { return (v || '').replace(/\D/g, ''); }
    function formatCEP(v) {
        const d = onlyDigits(v).slice(0, 8);
        return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
    }

    // Procura o input do CEP na seção "Calcular frete e prazo"
    function findCepInput() {
        return (
        document.getElementById('cep-input') ||
        document.querySelector('input[placeholder*="CEP" i]') ||
        (function () {
            const label = Array.from(document.querySelectorAll('label'))
            .find(l => /Calcular\s+frete\s+e\s+prazo/i.test(l.textContent || ''));
            if (!label) return null;
            const box = label.closest('div');
            return box ? (box.querySelector('input[type="text"], input') || null) : null;
        })()
        );
    }

    // Caixa (opcional) para mostrar o resumo do endereço no checkout
    function ensureAddressSummaryBox() {
        let box = document.getElementById('selected-address-summary');
        if (box) return box;
        const label = Array.from(document.querySelectorAll('label'))
        .find(l => /Calcular\s+frete\s+e\s+prazo/i.test(l.textContent || ''));
        const container = label ? label.parentElement : document.body;
        box = document.createElement('div');
        box.id = 'selected-address-summary';
        box.className = 'mt-3 text-sm bg-green-50 border border-green-200 text-green-800 rounded p-3';
        container.appendChild(box);
        return box;
    }
    function updateAddressSummary(address) {
        const box = ensureAddressSummaryBox();
        const line1 = [address.logradouro, address.numero].filter(Boolean).join(', ');
        const line2 = [address.bairro, address.cidade, address.uf].filter(Boolean).join(' - ');
        const comp  = address.complemento ? ` (${address.complemento})` : '';
        box.innerHTML = `
        <div class="font-semibold">Entrega para:</div>
        <div>${line1}${comp}</div>
        <div>${line2}</div>
        <div>CEP: <strong>${address.cep}</strong></div>
        `;
    }

    // Chama sua rotina de frete, seja qual for o nome
    function triggerFreteRecalc(cep) {
        if (typeof window.recalculateDelivery === 'function') {
        window.recalculateDelivery(cep);
        } else if (typeof window.calculateFrete === 'function') {
        window.calculateFrete(cep);
        } else if (typeof window.updateShippingForCep === 'function') {
        window.updateShippingForCep(cep);
        } else {
        // opcional: mensagem discreta
        try { window.showToast && window.showToast('Frete será calculado ao finalizar.', 'info', 1500); } catch(_) {}
        console.debug('[checkout] Sem função de frete registrada. CEP:', cep);
        }
    }

    // === Handler chamado pelo "Usar este" do sidebar ===
    window.onAddressSelected = function (address) {
        // 1) Preenche o CEP no checkout
        const cepInput = findCepInput();
        if (cepInput) {
        cepInput.value = formatCEP(address.cep || '');
        try { cepInput.dispatchEvent(new Event('input',  { bubbles: true })); } catch(_) {}
        try { cepInput.dispatchEvent(new Event('change', { bubbles: true })); } catch(_) {}
        }

        // 2) Atualiza resumo visual (opcional)
        updateAddressSummary(address);

        // 3) Recalcula frete usando sua rotina
        triggerFreteRecalc(address.cep);

        // 4) Dispara um evento para quem mais quiser ouvir
        document.dispatchEvent(new CustomEvent('checkout:cep-selected', { detail: { address } }));

        // 5) Feedback
        try { window.showToast && window.showToast('CEP atualizado no checkout.', 'success', 1200); } catch(_) {}
    };

    // Garante formatação do CEP se o usuário digitar manualmente
    document.addEventListener('DOMContentLoaded', () => {
        const cepInput = findCepInput();
        if (cepInput) {
        cepInput.addEventListener('input', () => {
            cepInput.value = formatCEP(cepInput.value);
        });
        }
    });
    })();

    (function () {
    const API_BASE = (typeof API_CONFIG !== 'undefined' && API_CONFIG.BASE_URL) ? API_CONFIG.BASE_URL : '/api';

    function money(n) {
        n = Number(n || 0);
        return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    }

    // Atualiza os botões do painel existente (#delivery-options-container)
    function applyQuoteToExistingPanel(quote) {
        const cont = document.getElementById('delivery-options-container');
        if (!cont) return;

        const map = {
        'Padrão':          quote?.methods?.padrao?.price,
        'Express':         quote?.methods?.express?.price,
        'Agendada':        quote?.methods?.agendada?.price,
        'Retire na loja':  quote?.methods?.pickup?.price,
        'Retire na Loja':  quote?.methods?.pickup?.price, // variação de capitalização
        };

        // Atualiza cada botão pelo data-type
        cont.querySelectorAll('.delivery-option-btn').forEach(btn => {
        const type = (btn.dataset.type || '').trim();
        if (!(type in map)) return;

        const price = Number(map[type]);
        // 1) grava valor no data-cost
        btn.dataset.cost = isFinite(price) ? price.toFixed(2) : '0.00';

        // 2) atualiza o texto do preço
        const span = btn.querySelector('.delivery-price-span');
        if (span) {
            if (price <= 0) {
            span.textContent = 'Grátis';
            span.classList.add('text-primary');
            span.classList.remove('text-gray-500');
            } else {
            span.textContent = money(price);
            span.classList.remove('text-primary');
            }
        }
        });

        // Mantém a seleção atual; se nenhuma, escolhe “Padrão” (ou “Retire na loja” se quiser)
        const selectedBtn =
        cont.querySelector('.delivery-option-btn.border-primary') ||
        cont.querySelector('.delivery-option-btn[data-type="Padrão"]') ||
        cont.querySelector('.delivery-option-btn[data-type="Retire na loja"]') ||
        cont.querySelector('.delivery-option-btn');

        if (selectedBtn) {
        // Atualiza o objeto local usado pelo resumo de valores
        selectedDelivery = {
            cost: parseFloat(selectedBtn.dataset.cost || '0') || 0,
            type: selectedBtn.dataset.type
        };
        }

        // Se quiser exibir a loja base/distância em algum canto, você tem em quote.store e quote.distanceKm
        // console.debug('Loja base:', quote.store?.nome, 'Distância:', quote.distanceKm, 'km');

        // Re-renderiza totais com o novo preço da opção selecionada
        loadAndRenderPage();
    }

    // >>> Esta é a função chamada quando muda o CEP/endereço <<<
    window.recalculateDelivery = async function(cep, opts = {}) {
        try {
        const url = new URL(`${API_BASE}/shipping/quote`, window.location.origin);
        url.searchParams.set('cep', cep);
        if (opts.bairro) url.searchParams.set('bairro', opts.bairro);

        const resp = await fetch(url.toString(), {
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            }
        });
        if (!resp.ok) throw new Error('Falha ao calcular o frete.');
        const quote = await resp.json();

        applyQuoteToExistingPanel(quote);
        } catch (e) {
        console.error(e);
        if (typeof showModal === 'function') {
            showModal({ title: 'Frete', message: e.message || 'Não foi possível calcular o frete agora.', confirmText: 'OK' });
        } else {
            alert(e.message || 'Não foi possível calcular o frete agora.');
        }
        }
    };
    })();

    // === AUTO: usar o endereço principal ao entrar no checkout ===
    (function () {
    const API_BASE = (typeof API_CONFIG !== 'undefined' && API_CONFIG.BASE_URL) ? API_CONFIG.BASE_URL : '/api';

    function getLoggedUserId() {
        try { const u = JSON.parse(localStorage.getItem('loggedInUser')); return u && u.id ? u.id : null; }
        catch { return null; }
    }
    function onlyDigits(v){ return (v||'').replace(/\D/g,''); }
    function formatCEP(v){ const d=onlyDigits(v).slice(0,8); return d.length>5?d.slice(0,5)+'-'+d.slice(5):d; }

    function findCepInput() {
        return (
        document.getElementById('cep-input') ||
        document.querySelector('input[placeholder*="CEP" i]') ||
        null
        );
    }
    function updateAddressSummary(address) {
        let box = document.getElementById('selected-address-summary');
        if (!box) {
        const label = Array.from(document.querySelectorAll('label'))
            .find(l => /Calcular\s+frete\s+e\s+prazo/i.test(l.textContent || ''));
        const container = label ? label.parentElement : document.body;
        box = document.createElement('div');
        box.id = 'selected-address-summary';
        box.className = 'mt-3 text-sm bg-green-50 border border-green-200 text-green-800 rounded p-3';
        container.appendChild(box);
        }
        const line1 = [address.logradouro, address.numero].filter(Boolean).join(', ');
        const line2 = [address.bairro, address.cidade, address.uf].filter(Boolean).join(' - ');
        const comp  = address.complemento ? ` (${address.complemento})` : '';
        box.innerHTML = `
        <div class="font-semibold">Entrega para:</div>
        <div>${line1}${comp}</div>
        <div>${line2}</div>
        <div>CEP: <strong>${address.cep}</strong></div>
        `;
    }

    async function getUserAddresses(userId) {
        const headers = {
            'Content-Type': 'application/json',
            ...getAuthHeaders()
        };
        const r = await fetch(`${API_BASE}/addresses/${userId}`, { headers });
        if (!r.ok) throw new Error('Não foi possível carregar seus endereços.');
        return r.json();
    }

    // **Executa já** (estamos dentro do DOMContentLoaded principal deste arquivo)
    (async function autoSelectDefaultAddress() {
        const userId = getLoggedUserId();
        if (!userId) return;

        try {
        const addresses = await getUserAddresses(userId);

        if (!addresses || addresses.length === 0) {
            // Sem endereços → abrir o sidebar direto no formulário
            if (typeof window.openAddressSidebarForNewAddress === 'function') {
            window.openAddressSidebarForNewAddress();
            } else if (typeof showModal === 'function') {
            showModal({ title: 'Endereço', message: 'Cadastre um endereço para continuar.', confirmText: 'OK' });
            } else {
            alert('Cadastre um endereço para continuar.');
            }
            return;
        }

        // Usa o principal (ou primeiro)
        const main = addresses.find(a => a.isDefault) || addresses[0];

        // Preenche o input do CEP
        const cepInput = findCepInput();
        if (cepInput) {
            cepInput.value = formatCEP(main.cep || '');
            try { cepInput.dispatchEvent(new Event('input',  { bubbles: true })); } catch (_) {}
            try { cepInput.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
        }

        // Resumo + cálculo de frete no seu painel existente
        updateAddressSummary(main);
        if (typeof window.recalculateDelivery === 'function') {
            window.recalculateDelivery(main.cep, { bairro: main.bairro });
        }
        } catch (e) {
        console.error(e);
        }
    })();
    })();



    // --- CARGA INICIAL ---
    
    loadAndRenderPage();
    loadFeaturedProducts();
    
});