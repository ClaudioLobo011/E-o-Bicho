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

    function resolveProductImageUrl(url) {
        if (typeof normalizeProductImageUrl === 'function') {
            return normalizeProductImageUrl(url);
        }
        if (!url) return '';
        return /^https?:\/\//i.test(url) ? url : `${API_CONFIG.SERVER_URL}${url}`;
    }

    const tableBody = document.getElementById('checkout-items-body');
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    if (!tableBody) return;
    tableBody.addEventListener('error', event => {
        const img = event.target;
        if (img.tagName === 'IMG' && !img.dataset.fallback) {
            img.dataset.fallback = 'true';
            img.src = '/public/image/placeholder.svg';
        }
    }, true);
    const stepTrack = document.getElementById('checkout-step-track');
    const stepLabel1 = document.getElementById('checkout-step-1');
    const stepLabel2 = document.getElementById('checkout-step-2');
    const stepLabel3 = document.getElementById('checkout-step-3');
    const goPaymentBtn = document.getElementById('checkout-go-payment');
    const paymentMethodOptions = document.querySelectorAll('[data-payment-method]');
    const paymentMethodContinueBtn = document.getElementById('payment-method-continue');
    const paymentMethodBackBtn = document.getElementById('payment-method-back');
    const paymentMethodChangeBtn = document.getElementById('payment-method-change');
    const paymentMethodSelected = document.getElementById('payment-method-selected');
    const paymentCardSection = document.getElementById('payment-card-section');
    const paymentCardFields = document.getElementById('payment-card-fields');
    const paymentAlternativeSection = document.getElementById('payment-alternative-section');
    const paymentAlternativeName = document.getElementById('payment-alternative-name');
    const paymentPixResult = document.getElementById('payment-pix-result');
    const paymentPixStatus = document.getElementById('payment-pix-status');
    const paymentPixContent = document.getElementById('payment-pix-content');
    const paymentPixQr = document.getElementById('payment-pix-qr');
    const paymentPixCode = document.getElementById('payment-pix-code');
    const paymentPixCopyBtn = document.getElementById('payment-pix-copy');
    const paymentPixTicket = document.getElementById('payment-pix-ticket');
    const paymentCardInput = document.getElementById('payment-card-number');
    const paymentExpiryInput = document.getElementById('payment-expiry');
    const paymentCvvInput = document.getElementById('payment-cvv');
    const paymentHolderInput = document.getElementById('payment-holder-name');
    const paymentDocType = document.getElementById('payment-doc-type');
    const paymentDocNumber = document.getElementById('payment-doc-number');
    const paymentEmailInput = document.getElementById('payment-email');
    const paymentSubmitBtn = document.getElementById('payment-submit');
    const paymentSubmitOriginalLabel = paymentSubmitBtn ? paymentSubmitBtn.textContent : '';
    const paymentSummaryName = document.getElementById('payment-summary-name');
    const paymentSummaryEmail = document.getElementById('payment-summary-email');
    const paymentSummaryPhone = document.getElementById('payment-summary-phone');
    const paymentSummaryAddress = document.getElementById('payment-summary-address');
    const paymentSummaryDeliveryType = document.getElementById('payment-summary-delivery-type');
    const paymentSummaryDeliveryCost = document.getElementById('payment-summary-delivery-cost');
    const summaryItemCount2 = document.getElementById('summary-item-count-2');
    const summarySubtotal2 = document.getElementById('summary-subtotal-2');
    const summaryDiscounts2 = document.getElementById('summary-discounts-2');
    const summaryDelivery2 = document.getElementById('summary-delivery-2');
    const summaryTotal2 = document.getElementById('summary-total-2');
    const summaryItemCountMethod = document.getElementById('summary-item-count-method');
    const summarySubtotalMethod = document.getElementById('summary-subtotal-method');
    const summaryDiscountsMethod = document.getElementById('summary-discounts-method');
    const summaryDeliveryMethod = document.getElementById('summary-delivery-method');
    const summaryTotalMethod = document.getElementById('summary-total-method');
    let lastSelectedAddress = null;
    let selectedStore = null;
    let selectedStoreId = '';
    let mpInstance = null;
    let mpPublicKey = '';
    let selectedPaymentMethod = '';
    let pixResultData = null;
    let pixPollTimer = null;
    let orderCreationInFlight = false;
    let orderCreated = false;
    let shippingQuoteReady = false;
    let shippingQuoteRevision = 0;
    let selectedDelivery = {
        cost: 0,
        type: 'Padrão' 
    };
    const freeShippingGoal = 100;
    const PAYMENT_METHOD_LABELS = {
        card: 'Cartao de Credito ou Debito',
        pix: 'Pix',
        boleto: 'Boleto'
    };

    function formatSummaryValue(value, fallback = 'Nao informado') {
        return value ? String(value) : fallback;
    }

    function formatPhone(value) {
        const digits = String(value || '').replace(/\D/g, '');
        if (digits.length === 11) {
            return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
        }
        if (digits.length === 10) {
            return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
        }
        return value ? String(value) : '';
    }

    function resolveSelectedStoreId() {
        return selectedStoreId || selectedStore?.id || selectedStore?._id || '';
    }

    function applyPaymentUserSummary(user) {
        const name = user?.nomeCompleto || user?.nome || user?.name || user?.razaoSocial || user?.nomeContato || '';
        const email = user?.email || '';
        const phoneRaw = user?.celular || user?.telefone || user?.celularSecundario || user?.telefoneSecundario || user?.phone || '';
        const phone = formatPhone(phoneRaw);

        if (paymentSummaryName) paymentSummaryName.textContent = formatSummaryValue(name);
        if (paymentSummaryEmail) paymentSummaryEmail.textContent = formatSummaryValue(email);
        if (paymentSummaryPhone) paymentSummaryPhone.textContent = formatSummaryValue(phone);

        if (paymentEmailInput && !paymentEmailInput.value && email) {
            paymentEmailInput.value = email;
        }
    }

    async function hydratePaymentUserSummary() {
        const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {};
        applyPaymentUserSummary(cached);

        if (!cached.id || !cached.token) return;
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/users/${cached.id}`, {
                headers: {
                    'Authorization': `Bearer ${cached.token}`,
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) return;
            const userData = await response.json();
            applyPaymentUserSummary(userData || {});
        } catch (error) {
            console.warn('[checkout] Falha ao carregar dados do cliente.', error);
        }
    }

    function updatePaymentAddressSummary(address) {
        if (!paymentSummaryAddress) return;
        if (!address) {
            paymentSummaryAddress.textContent = 'Nao informado';
            return;
        }
        const line1 = [address.logradouro, address.numero].filter(Boolean).join(', ');
        const line2 = [address.bairro, address.cidade, address.uf].filter(Boolean).join(' - ');
        const comp = address.complemento ? ` (${address.complemento})` : '';
        const cepLine = address.cep ? `CEP: ${address.cep}` : '';
        const lines = [line1 + comp, line2, cepLine].filter(Boolean).join('\n');
        paymentSummaryAddress.textContent = lines || 'Nao informado';
    }

    function computeTotals(cart) {
        const items = Array.isArray(cart) ? cart : [];
        const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
        const subtotal = items.reduce((sum, item) => sum + (item.product.venda * item.quantity), 0);
        const totalEffective = items.reduce((sum, item) => sum + (item.effectivePrice * item.quantity), 0);
        const totalDiscounts = subtotal - totalEffective;
        const hasFreeShipping = totalEffective >= freeShippingGoal;
        const deliveryCost = hasFreeShipping ? 0 : selectedDelivery.cost;
        const finalTotal = totalEffective + deliveryCost;

        return {
            itemCount,
            subtotal,
            totalEffective,
            totalDiscounts,
            deliveryCost,
            finalTotal,
            hasFreeShipping
        };
    }

    function initPaymentMasks() {
        if (typeof IMask === 'undefined') return;

        if (paymentCardInput) {
            IMask(paymentCardInput, { mask: '0000 0000 0000 0000' });
        }
        if (paymentExpiryInput) {
            IMask(paymentExpiryInput, {
                mask: 'MM/YY',
                blocks: {
                    MM: { mask: IMask.MaskedRange, from: 1, to: 12 },
                    YY: { mask: IMask.MaskedRange, from: 0, to: 99 }
                }
            });
        }
        if (paymentCvvInput) {
            IMask(paymentCvvInput, { mask: '0000' });
        }

        if (paymentDocNumber) {
            let docMask = null;
            const applyDocMask = (type) => {
                if (docMask) docMask.destroy();
                docMask = IMask(paymentDocNumber, {
                    mask: type === 'cnpj' ? '00.000.000/0000-00' : '000.000.000-00'
                });
            };
            applyDocMask(paymentDocType?.value || 'cpf');
            if (paymentDocType) {
                paymentDocType.addEventListener('change', () => applyDocMask(paymentDocType.value));
            }
        }
    }

    initPaymentMasks();
    hydratePaymentUserSummary();

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
                            <img src="${escapeHTML(resolveProductImageUrl(product.imagemPrincipal))}" alt="${escapeHTML(product.nome)}" class="w-16 h-16 object-contain border rounded-md">
                            <div>
                                <p class="font-semibold text-gray-800">${escapeHTML(product.nome)}</p>
                                
                                <div class="mt-2">
                                    <button type="button" role="switch" aria-checked="${!!isSubscribed}" aria-label="Assinatura de ${escapeHTML(product.nome)}" data-action="toggle-subscription" data-product-id="${product._id}" class="${switchBg} relative inline-flex h-6 w-11 items-center rounded-full transition-colors">
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
                            <button type="button" aria-label="Diminuir quantidade" data-action="decrease-qty" data-product-id="${product._id}" class="w-7 h-7 flex items-center justify-center border rounded-l hover:bg-gray-100">-</button>
                            <span class="w-8 h-7 flex items-center justify-center border-t border-b">${cartItem.quantity}</span>
                            <button type="button" aria-label="Aumentar quantidade" data-action="increase-qty" data-product-id="${product._id}" class="w-7 h-7 flex items-center justify-center border rounded-r hover:bg-gray-100">+</button>
                        </div>
                    </td>
                    <td class="py-4 px-2 text-center font-bold">R$ ${itemTotal.toFixed(2).replace('.', ',')}</td>
                    <td class="py-4 px-2 text-center">
                        <button type="button" aria-label="Remover ${escapeHTML(product.nome)}" data-action="remove-item" data-product-id="${product._id}" class="text-gray-400 hover:text-red-500"><i class="far fa-trash-alt"></i></button>
                    </td>
                </tr>
            `;
            tableBody.innerHTML += rowHtml;
        });
    }

    function updateDeliveryOptionsUI(isFreeShipping) {
        const allButtons = document.querySelectorAll('.delivery-option-btn');
        allButtons.forEach(btn => {
            if (btn.disabled) return;
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

    function setCheckoutStep(step) {
        const normalizedStep = Number(step) || 1;
        document.querySelectorAll('.checkout-step').forEach((section, index) => {
            section.hidden = index !== normalizedStep - 1;
        });
        if (stepTrack) {
            const offset = (normalizedStep - 1) * (100 / 3);
            stepTrack.style.transform = `translateX(-${offset}%)`;
        }
        const steps = [
            { label: stepLabel1, active: normalizedStep === 1 },
            { label: stepLabel2, active: normalizedStep === 2 },
            { label: stepLabel3, active: normalizedStep === 3 }
        ];
        steps.forEach(({ label, active }) => {
            if (!label) return;
            label.classList.toggle('text-primary', active);
            label.classList.toggle('font-bold', active);
            label.classList.toggle('text-gray-400', !active);
            if (active) label.setAttribute('aria-current', 'step');
            else label.removeAttribute('aria-current');
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

        if (summaryItemCount2) summaryItemCount2.textContent = itemCount;
        if (summarySubtotal2) summarySubtotal2.textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
        if (summaryDiscounts2) summaryDiscounts2.textContent = `- R$ ${totalDiscounts.toFixed(2).replace('.', ',')}`;
        if (summaryDelivery2) summaryDelivery2.textContent = finalDeliveryCost > 0 ? `R$ ${finalDeliveryCost.toFixed(2).replace('.', ',')}` : 'Gratis';
        if (summaryTotal2) summaryTotal2.textContent = `R$ ${finalTotal.toFixed(2).replace('.', ',')}`;
        if (summaryItemCountMethod) summaryItemCountMethod.textContent = itemCount;
        if (summarySubtotalMethod) summarySubtotalMethod.textContent = `R$ ${subtotal.toFixed(2).replace('.', ',')}`;
        if (summaryDiscountsMethod) summaryDiscountsMethod.textContent = `- R$ ${totalDiscounts.toFixed(2).replace('.', ',')}`;
        if (summaryDeliveryMethod) summaryDeliveryMethod.textContent = finalDeliveryCost > 0 ? `R$ ${finalDeliveryCost.toFixed(2).replace('.', ',')}` : 'Gratis';
        if (summaryTotalMethod) summaryTotalMethod.textContent = `R$ ${finalTotal.toFixed(2).replace('.', ',')}`;
        if (paymentSummaryDeliveryType) paymentSummaryDeliveryType.textContent = selectedDelivery?.type || 'Nao definido';
        if (paymentSummaryDeliveryCost) {
            paymentSummaryDeliveryCost.textContent = finalDeliveryCost > 0 ? `R$ ${finalDeliveryCost.toFixed(2).replace('.', ',')}` : 'Gratis';
        }
        
        // Chama a nova função para atualizar a aparência dos botões
        updateDeliveryOptionsUI(hasFreeShipping);
    }

    function getPaymentMethodLabel(method) {
        return PAYMENT_METHOD_LABELS[method] || '';
    }

    function resolvePayerEmail() {
        const direct = (paymentEmailInput?.value || '').trim();
        if (direct) return direct;
        const summary = (paymentSummaryEmail?.textContent || '').trim();
        if (summary && !/^nao informado$/i.test(summary)) return summary;
        try {
            const cached = JSON.parse(localStorage.getItem('loggedInUser') || 'null') || {};
            return (cached?.email || '').trim();
        } catch (error) {
            return '';
        }
    }

    function updatePaymentSubmitLabel() {
        if (!paymentSubmitBtn) return;
        if (selectedPaymentMethod === 'pix') {
            paymentSubmitBtn.textContent = 'Gerar Pix';
            return;
        }
        paymentSubmitBtn.textContent = paymentSubmitOriginalLabel || 'Concluir Pagamento';
    }

    function stopPixPolling() {
        if (pixPollTimer) {
            clearTimeout(pixPollTimer);
            pixPollTimer = null;
        }
    }

    function resetPixResult() {
        stopPixPolling();
        pixResultData = null;
        if (paymentPixResult) paymentPixResult.classList.add('hidden');
        if (paymentPixStatus) {
            paymentPixStatus.textContent = '';
            paymentPixStatus.style.color = '';
        }
        if (paymentPixContent) paymentPixContent.classList.remove('hidden');
        if (paymentPixQr) paymentPixQr.removeAttribute('src');
        if (paymentPixCode) paymentPixCode.value = '';
        if (paymentPixTicket) {
            paymentPixTicket.setAttribute('href', '#');
            paymentPixTicket.classList.add('hidden');
        }
    }

    function applyPixResult(data) {
        pixResultData = data || null;
        const qrCodeBase64 = data?.qrCodeBase64 || '';
        const qrCode = data?.qrCode || '';
        const ticketUrl = data?.ticketUrl || '';
        const statusMessage = formatPaymentStatus(data?.status, data?.statusDetail);

        if (paymentPixStatus) {
            paymentPixStatus.textContent = statusMessage || 'Pix gerado. Use o QR Code para pagar.';
        }
        if (paymentPixContent) {
            paymentPixContent.classList.remove('hidden');
        }
        if (paymentPixQr) {
            if (qrCodeBase64) {
                paymentPixQr.setAttribute('src', `data:image/jpeg;base64,${qrCodeBase64}`);
            } else {
                paymentPixQr.removeAttribute('src');
            }
        }
        if (paymentPixCode) paymentPixCode.value = qrCode || '';
        if (paymentPixTicket) {
            if (ticketUrl) {
                paymentPixTicket.setAttribute('href', ticketUrl);
                paymentPixTicket.classList.remove('hidden');
            } else {
                paymentPixTicket.setAttribute('href', '#');
                paymentPixTicket.classList.add('hidden');
            }
        }
        if (paymentPixResult) paymentPixResult.classList.remove('hidden');
    }

    function updatePaymentMethodSelectionUI() {
        const hasSelection = !!selectedPaymentMethod;
        if (paymentMethodOptions && paymentMethodOptions.length) {
            paymentMethodOptions.forEach((btn) => {
                const method = btn.getAttribute('data-payment-method');
                const isActive = method === selectedPaymentMethod;
                btn.classList.toggle('border-primary', isActive);
                btn.classList.toggle('bg-primary/10', isActive);
                btn.classList.toggle('border-gray-200', !isActive);
                btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });
        }
        if (paymentMethodContinueBtn) {
            paymentMethodContinueBtn.disabled = !hasSelection;
            paymentMethodContinueBtn.classList.toggle('opacity-60', !hasSelection);
        }
    }

    function updatePaymentMethodView() {
        const label = getPaymentMethodLabel(selectedPaymentMethod);
        const isCard = selectedPaymentMethod === 'card';
        const isPix = selectedPaymentMethod === 'pix';
        const showPrimary = isCard || isPix;
        if (paymentMethodSelected) {
            paymentMethodSelected.textContent = label ? `Forma: ${label}` : '';
        }
        if (paymentAlternativeName) {
            paymentAlternativeName.textContent = label || 'Forma de pagamento';
        }
        if (paymentCardSection) {
            paymentCardSection.classList.toggle('hidden', !showPrimary);
        }
        if (paymentCardFields) {
            paymentCardFields.classList.toggle('hidden', !isCard);
        }
        if (paymentAlternativeSection) {
            paymentAlternativeSection.classList.toggle('hidden', showPrimary || !selectedPaymentMethod);
        }
        if (!isPix) {
            resetPixResult();
        }
        updatePaymentSubmitLabel();
    }

    function setSelectedPaymentMethod(method) {
        selectedPaymentMethod = method || '';
        updatePaymentMethodSelectionUI();
        updatePaymentMethodView();
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
                                <img src="${resolveProductImageUrl(product.imagemPrincipal)}" alt="${product.nome}" class="w-full h-full object-cover rounded-md">
                                
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
        if (goPaymentBtn) goPaymentBtn.disabled = !cart.length;
    }

    document.addEventListener('storefront:cart-updated', loadAndRenderPage);

    // --- EVENT LISTENERS ---
    let cartChangeInFlight = false;
    tableBody.addEventListener('click', async (event) => {
        const target = event.target.closest('button[data-action]');
        if (!target) return;

        const action = target.dataset.action;
        const productId = target.dataset.productId;
        if (!action || !productId) return;
        if (cartChangeInFlight) return;
        cartChangeInFlight = true;
        tableBody.querySelectorAll('button').forEach(button => button.disabled = true);
        try {
        const cart = await CartManager.getCart();
        const currentItem = cart.find(item => item.product._id === productId);

        const user = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
        if (!user?.id || !user?.token) throw Error('Entre novamente na sua conta.');
        const path = `${API_CONFIG.BASE_URL}/cart/${encodeURIComponent(user.id)}/${encodeURIComponent(productId)}`;
        let method = 'PUT', body, suffix = '';
        if (action === 'remove-item') method = 'DELETE';
        else if (currentItem && ['increase-qty','decrease-qty'].includes(action)) {
            const quantity = Math.max(1, currentItem.quantity + (action === 'increase-qty' ? 1 : -1));
            if (quantity === currentItem.quantity) return;
            body = {quantity};
        } else if (currentItem && action === 'toggle-subscription') {
            suffix = '/subscribe'; body = {isSubscribed: !currentItem.isSubscribed};
        } else return;
        await fetchJson(path + suffix, {
            method, headers: {'Content-Type':'application/json', ...getAuthHeaders()},
            ...(body ? {body:JSON.stringify(body)} : {}),
        });
        await loadAndRenderPage();
        await CartManager.updateCartCount();
        } catch(error) {
            if (typeof showToast === 'function') showToast(error.message || 'Não foi possível atualizar a sacola.', 'error');
        } finally {
            cartChangeInFlight = false;
            tableBody.querySelectorAll('button').forEach(button => button.disabled = false);
        }
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
        lastSelectedAddress = address;
        updatePaymentAddressSummary(address);
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

        if (quote && quote.store) {
            selectedStore = quote.store;
            selectedStoreId = quote.store?.id || quote.store?._id || '';
        }

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
        const available = map[type] !== undefined && map[type] !== null && Number.isFinite(price) && price >= 0;
        btn.disabled = !available;
        if (!available) {
            const span = btn.querySelector('.delivery-price-span');
            if (span) span.textContent = 'Indisponível';
            return;
        }
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
        cont.querySelector('.delivery-option-btn.border-primary:not(:disabled)') ||
        cont.querySelector('.delivery-option-btn[data-type="Padrão"]:not(:disabled)') ||
        cont.querySelector('.delivery-option-btn[data-type="Retire na loja"]:not(:disabled)') ||
        cont.querySelector('.delivery-option-btn:not(:disabled)');

        if (selectedBtn) {
        cont.querySelectorAll('.delivery-option-btn').forEach(btn => {
            btn.classList.toggle('border-primary', btn === selectedBtn);
            btn.classList.toggle('bg-primary/10', btn === selectedBtn);
        });
        // Atualiza o objeto local usado pelo resumo de valores
        selectedDelivery = {
            cost: parseFloat(selectedBtn.dataset.cost || '0') || 0,
            type: selectedBtn.dataset.type
        };
        } else shippingQuoteReady = false;

        // Se quiser exibir a loja base/distância em algum canto, você tem em quote.store e quote.distanceKm
        // console.debug('Loja base:', quote.store?.nome, 'Distância:', quote.distanceKm, 'km');

        // Re-renderiza totais com o novo preço da opção selecionada
        loadAndRenderPage();
    }

    // >>> Esta é a função chamada quando muda o CEP/endereço <<<
    window.recalculateDelivery = async function(cep, opts = {}) {
        const revision = ++shippingQuoteRevision;
        shippingQuoteReady = false;
        try {
        if (!/^\d{8}$/.test(String(cep).replace(/\D/g,''))) throw Error('Informe um CEP válido para consultar a entrega.');
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
        if (revision !== shippingQuoteRevision) return;
        if (!quote?.store || !quote?.methods) throw Error('Não foi possível confirmar a loja e o frete.');
        shippingQuoteReady = true;
        applyQuoteToExistingPanel(quote);
        } catch (e) {
        if (revision !== shippingQuoteRevision) return;
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
        lastSelectedAddress = address;
        updatePaymentAddressSummary(address);
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



    function digitsOnly(value) {
        return String(value || '').replace(/\D/g, '');
    }

    function parseExpiryParts(value) {
        const digits = digitsOnly(value);
        return {
            month: digits.slice(0, 2),
            year: digits.slice(2, 4)
        };
    }

    function formatPaymentStatus(status, detail) {
        const map = {
            approved: 'Pagamento aprovado.',
            pending: 'Pagamento pendente.',
            in_process: 'Pagamento em analise.',
            authorized: 'Pagamento autorizado.',
            action_required: 'Pagamento aguardando acao do comprador.',
            rejected: 'Pagamento recusado.',
            cancelled: 'Pagamento cancelado.',
            refunded: 'Pagamento estornado.',
            charged_back: 'Pagamento contestado.'
        };
        const base = map[status] || 'Status do pagamento indefinido.';
        return detail ? `${base} (${detail})` : base;
    }

    function formatPixOrderStatus(paymentStatus, orderStatus, detail) {
        if (paymentStatus) {
            return formatPaymentStatus(paymentStatus, detail);
        }
        const orderMap = {
            action_required: 'Aguardando pagamento Pix.',
            processed: 'Pagamento aprovado.',
            cancelled: 'Pagamento cancelado.'
        };
        const base = orderMap[orderStatus] || 'Status do Pix indefinido.';
        return detail ? `${base} (${detail})` : base;
    }

    function isFinalPaymentStatus(status) {
        return ['approved', 'rejected', 'cancelled', 'refunded', 'charged_back'].includes(status);
    }

    async function createWebOrder(paymentInfo = {}) {
        if (orderCreated || orderCreationInFlight) return null;
        orderCreationInFlight = true;
        try {
            const storeId = resolveSelectedStoreId();
            if (!storeId) throw new Error('Loja nao definida.');
            const cart = await CartManager.getCart();
            const totals = computeTotals(cart);
            const addressId = lastSelectedAddress?._id || lastSelectedAddress?.id || '';
            const address = lastSelectedAddress || null;

            const payload = {
                storeId,
                status: 'PAGO',
                payment: {
                    method: paymentInfo.method || selectedPaymentMethod,
                    status: paymentInfo.status || 'approved',
                    statusDetail: paymentInfo.statusDetail || '',
                    id: paymentInfo.paymentId || '',
                    orderId: paymentInfo.orderId || '',
                    amount: Number(totals.finalTotal || 0),
                    gateway: 'mercadopago',
                },
                delivery: {
                    type: selectedDelivery?.type || '',
                    cost: Number(totals.deliveryCost || 0),
                },
                addressId,
                address,
                externalReference: paymentInfo.paymentId || paymentInfo.orderId || '',
            };

            const headers = getAuthHeaders();
            if (!headers.Authorization) {
                throw new Error('Usuario nao autenticado.');
            }

            const response = await fetchJson(`${API_CONFIG.BASE_URL}/orders/web`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...headers,
                },
                body: JSON.stringify(payload),
            });
            orderCreated = true;
            return response;
        } catch (error) {
            console.warn('[checkout] Falha ao criar pedido.', error);
            if (typeof showToast === 'function') {
                showToast(error?.message || 'Falha ao registrar o pedido.', 'warning', 5000);
            }
            return null;
        } finally {
            orderCreationInFlight = false;
        }
    }

    async function handlePixApproved(paymentInfo = {}) {
        stopPixPolling();
        if (paymentPixContent) {
            paymentPixContent.classList.add('hidden');
        }
        if (paymentPixStatus) {
            paymentPixStatus.textContent = 'Pagamento aprovado. Redirecionando para Meus Pedidos...';
            paymentPixStatus.style.color = '#15803d';
        }
        if (typeof showToast === 'function') {
            showToast('Pagamento aprovado. Redirecionando...', 'success', 4000);
        }
        await createWebOrder({
            method: 'pix',
            status: paymentInfo.paymentStatus || 'approved',
            statusDetail: paymentInfo.detail || '',
            paymentId: pixResultData?.paymentId || '',
            orderId: pixResultData?.orderId || '',
        });
        const target = (typeof basePath !== 'undefined') ? `${basePath}pages/meus-pedidos.html` : '../pages/meus-pedidos.html';
        setTimeout(() => {
            window.location.href = target;
        }, 2000);
    }

    async function redirectToOrdersAfterApproval(paymentInfo = {}) {
        if (typeof showToast === 'function') {
            showToast('Pagamento aprovado. Redirecionando...', 'success', 4000);
        }
        await createWebOrder({
            method: paymentInfo.method || selectedPaymentMethod,
            status: paymentInfo.status || 'approved',
            statusDetail: paymentInfo.statusDetail || '',
            paymentId: paymentInfo.paymentId || '',
        });
        const target = (typeof basePath !== 'undefined') ? `${basePath}pages/meus-pedidos.html` : '../pages/meus-pedidos.html';
        setTimeout(() => {
            window.location.href = target;
        }, 2000);
    }

    async function pollPixStatus(orderId, storeId, attempt = 0) {
        if (!orderId || !storeId) return;
        const maxAttempts = 90;
        const intervalMs = 6000;
        if (attempt >= maxAttempts) return;

        try {
            const data = await fetchJson(
                `${API_CONFIG.BASE_URL}/mercadopago/orders/${encodeURIComponent(orderId)}?storeId=${encodeURIComponent(storeId)}`,
                { headers: getAuthHeaders() }
            );
            const paymentStatus = data?.paymentStatus || '';
            const orderStatus = data?.orderStatus || '';
            const detail = data?.paymentStatusDetail || data?.orderStatusDetail || '';
            if (paymentPixStatus) {
                paymentPixStatus.textContent = formatPixOrderStatus(paymentStatus, orderStatus, detail);
            }
            if (paymentStatus === 'approved' || orderStatus === 'processed') {
                await handlePixApproved({ paymentStatus, detail });
                return;
            }
            if (isFinalPaymentStatus(paymentStatus) || orderStatus === 'cancelled') {
                stopPixPolling();
                return;
            }
        } catch (error) {
            console.warn('[checkout][pix] Falha ao consultar status.', error);
        }

        pixPollTimer = setTimeout(() => {
            pollPixStatus(orderId, storeId, attempt + 1);
        }, intervalMs);
    }

    async function fetchJson(url, options) {
        const resp = await fetch(url, options);
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            const message = data?.message || 'Falha na requisicao.';
            const error = new Error(message);
            error.data = data;
            throw error;
        }
        return data;
    }

    async function ensureMercadoPagoInstance(storeId) {
        if (!storeId) {
            throw new Error('Selecione um endereco para definir a loja.');
        }
        if (typeof MercadoPago === 'undefined') {
            throw new Error('SDK do Mercado Pago nao carregou.');
        }
        const data = await fetchJson(`${API_CONFIG.BASE_URL}/mercadopago/public-key?storeId=${encodeURIComponent(storeId)}`);
        const publicKey = data?.publicKey || '';
        if (!publicKey) {
            throw new Error('Chave publica do Mercado Pago nao encontrada.');
        }
        if (!mpInstance || mpPublicKey !== publicKey) {
            mpInstance = new MercadoPago(publicKey, { locale: 'pt-BR' });
            mpPublicKey = publicKey;
        }
        return mpInstance;
    }

    async function resolvePaymentMethodId(mp, cardNumber) {
        const bin = digitsOnly(cardNumber).slice(0, 6);
        if (bin.length < 6) return '';
        const methods = await mp.getPaymentMethods({ bin });
        return methods?.results?.[0]?.id || '';
    }

    async function pollPaymentStatus(paymentId, storeId, attempts = 4) {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        let lastStatus = '';
        for (let i = 0; i < attempts; i += 1) {
            await wait(4000);
            try {
                const data = await fetchJson(
                    `${API_CONFIG.BASE_URL}/mercadopago/payments/${encodeURIComponent(paymentId)}?storeId=${encodeURIComponent(storeId)}`,
                    { headers: getAuthHeaders() }
                );
                if (data?.status && data.status !== lastStatus) {
                    lastStatus = data.status;
                    if (typeof showToast === 'function') {
                        showToast(formatPaymentStatus(data.status, data.statusDetail), 'info', 4000);
                    }
                }
                if (data?.status === 'approved') {
                    await redirectToOrdersAfterApproval({
                        paymentId,
                        status: data.status,
                        statusDetail: data.statusDetail,
                    });
                    break;
                }
                if (isFinalPaymentStatus(data?.status)) {
                    break;
                }
            } catch (error) {
                console.warn('[checkout] Falha ao consultar status do pagamento.', error);
            }
        }
    }

    if (paymentMethodOptions && paymentMethodOptions.length) {
        paymentMethodOptions.forEach((btn) => {
            btn.addEventListener('click', () => {
                const method = btn.getAttribute('data-payment-method') || '';
                setSelectedPaymentMethod(method);
            });
        });
    }

    if (paymentMethodContinueBtn) {
        paymentMethodContinueBtn.addEventListener('click', () => {
            if (!selectedPaymentMethod) {
                if (typeof showToast === 'function') {
                    showToast('Selecione a forma de pagamento.', 'warning', 4000);
                } else if (typeof showModal === 'function') {
                    showModal({ title: 'Pagamento', message: 'Selecione a forma de pagamento.', confirmText: 'OK' });
                }
                return;
            }
            setCheckoutStep(3);
            updatePaymentMethodView();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    if (paymentMethodBackBtn) {
        paymentMethodBackBtn.addEventListener('click', () => {
            setCheckoutStep(1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    if (paymentMethodChangeBtn) {
        paymentMethodChangeBtn.addEventListener('click', () => {
            setCheckoutStep(2);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    if (paymentPixCopyBtn) {
        paymentPixCopyBtn.addEventListener('click', async () => {
            const code = (paymentPixCode?.value || '').trim();
            if (!code) return;
            try {
                if (navigator?.clipboard?.writeText) {
                    await navigator.clipboard.writeText(code);
                } else {
                    paymentPixCode?.select?.();
                    document.execCommand('copy');
                }
                if (typeof showToast === 'function') {
                    showToast('Pix copia e cola copiado.', 'success', 3000);
                }
            } catch (error) {
                console.warn('[checkout] Falha ao copiar Pix.', error);
            }
        });
    }

    if (paymentSubmitBtn) {
        paymentSubmitBtn.addEventListener('click', async () => {
            if (paymentSubmitBtn.disabled) return;
            paymentSubmitBtn.disabled = true;
            paymentSubmitBtn.textContent = selectedPaymentMethod === 'pix' ? 'Gerando Pix...' : 'Processando...';
            try {
                if (!shippingQuoteReady || !lastSelectedAddress) throw Error('Confirme o endereço e o frete antes de pagar.');
                const storeId = resolveSelectedStoreId();
                const cart = await CartManager.getCart();
                if (!cart || cart.length === 0) {
                    throw new Error('Seu carrinho esta vazio.');
                }

                const totals = computeTotals(cart);
                const finalTotal = Number(totals.finalTotal || 0);
                if (!Number.isFinite(finalTotal) || finalTotal <= 0) {
                    throw new Error('Total do pedido invalido.');
                }
                if (!selectedPaymentMethod) {
                    throw new Error('Selecione a forma de pagamento.');
                }
                if (selectedPaymentMethod === 'pix') {
                    const email = resolvePayerEmail();
                    if (!email) throw new Error('Informe o email para o pagamento.');

                    resetPixResult();
                    const payload = {
                        storeId,
                        amount: Number(finalTotal.toFixed(2)),
                        processingMode: 'automatic',
                        payer: {
                            email
                        }
                    };

                    const pixData = await fetchJson(`${API_CONFIG.BASE_URL}/mercadopago/orders`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...getAuthHeaders()
                        },
                        body: JSON.stringify(payload)
                    });

                    applyPixResult(pixData);
                    if (pixData?.orderId) {
                        pollPixStatus(pixData.orderId, storeId);
                    }
                    if (typeof showModal === 'function') {
                        showModal({ title: 'Pagamento', message: 'Pix gerado. Use o QR Code para pagar.', confirmText: 'OK' });
                    } else if (typeof showToast === 'function') {
                        showToast('Pix gerado. Use o QR Code para pagar.', 'info', 4000);
                    }
                    return;
                }
                if (selectedPaymentMethod !== 'card') {
                    throw new Error('Forma de pagamento selecionada ainda nao esta disponivel.');
                }

                const cardNumber = digitsOnly(paymentCardInput?.value);
                const expiry = parseExpiryParts(paymentExpiryInput?.value);
                const cvv = digitsOnly(paymentCvvInput?.value);
                const holderName = (paymentHolderInput?.value || '').trim();
                const email = (paymentEmailInput?.value || '').trim();
                const docTypeRaw = (paymentDocType?.value || 'cpf').toLowerCase();
                const docType = docTypeRaw === 'cnpj' ? 'CNPJ' : 'CPF';
                const docNumber = digitsOnly(paymentDocNumber?.value);

                if (!cardNumber || cardNumber.length < 13) throw new Error('Informe o numero do cartao.');
                if (!expiry.month || !expiry.year) throw new Error('Informe o vencimento do cartao.');
                if (!cvv || cvv.length < 3) throw new Error('Informe o codigo de seguranca.');
                if (!holderName) throw new Error('Informe o nome do titular.');
                if (!email) throw new Error('Informe o email para o pagamento.');
                if (!docNumber) throw new Error('Informe o documento do titular.');

                const mp = await ensureMercadoPagoInstance(storeId);
                const paymentMethodId = await resolvePaymentMethodId(mp, cardNumber);
                if (!paymentMethodId) {
                    throw new Error('Nao foi possivel identificar a bandeira do cartao.');
                }

                const tokenResponse = await mp.createCardToken({
                    cardNumber,
                    cardholderName: holderName,
                    cardExpirationMonth: expiry.month,
                    cardExpirationYear: expiry.year,
                    securityCode: cvv,
                    identificationType: docType,
                    identificationNumber: docNumber,
                    cardholderEmail: email
                });

                if (tokenResponse?.error) {
                    const tokenMessage = tokenResponse?.error?.message || tokenResponse?.cause?.[0]?.description;
                    throw new Error(tokenMessage || 'Falha ao validar o cartao.');
                }

                const token = tokenResponse?.id;
                if (!token) {
                    throw new Error('Nao foi possivel gerar o token do cartao.');
                }

                const description = `Compra E o Bicho (${totals.itemCount} itens)`;
                const payload = {
                    storeId,
                    amount: Number(finalTotal.toFixed(2)),
                    token,
                    paymentMethodId,
                    installments: 1,
                    description,
                    payer: {
                        email,
                        identification: {
                            type: docType,
                            number: docNumber
                        }
                    },
                    delivery: {
                        type: selectedDelivery?.type || '',
                        cost: totals.deliveryCost || 0
                    }
                };

                const paymentData = await fetchJson(`${API_CONFIG.BASE_URL}/mercadopago/payments`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...getAuthHeaders()
                    },
                    body: JSON.stringify(payload)
                });

                const paymentId = paymentData?.paymentId || paymentData?.id;
                const statusMessage = formatPaymentStatus(paymentData?.status, paymentData?.statusDetail);
                const message = paymentId ? `${statusMessage}<br>ID: ${paymentId}` : statusMessage;

                if (typeof showModal === 'function') {
                    showModal({ title: 'Pagamento', message, confirmText: 'OK' });
                } else if (typeof showToast === 'function') {
                    showToast(statusMessage, 'info', 4000);
                }

                if (paymentData?.status === 'approved') {
                    await redirectToOrdersAfterApproval({
                        paymentId,
                        status: paymentData.status,
                        statusDetail: paymentData.statusDetail,
                    });
                } else if (paymentId && !isFinalPaymentStatus(paymentData?.status)) {
                    pollPaymentStatus(paymentId, storeId);
                }
            } catch (error) {
                console.error('[checkout] Falha ao processar pagamento.', error);
                if (selectedPaymentMethod === 'pix') {
                    console.log('[checkout][pix] detalhes do erro', error?.data || null);
                }
                const msg = error?.message || 'Nao foi possivel concluir o pagamento.';
                if (typeof showModal === 'function') {
                    showModal({ title: 'Pagamento', message: msg, confirmText: 'OK' });
                } else if (typeof showToast === 'function') {
                    showToast(msg, 'error', 4000);
                } else {
                    alert(msg);
                }
            } finally {
                paymentSubmitBtn.disabled = false;
                updatePaymentSubmitLabel();
            }
        });
    }

    // --- CARGA INICIAL ---
    if (goPaymentBtn) {
        goPaymentBtn.addEventListener('click', () => {
            if (!lastSelectedAddress || !shippingQuoteReady || !resolveSelectedStoreId()) {
                if (typeof showModal === 'function') showModal({title:'Entrega ou retirada',message:'Selecione um endereço e consulte as opções de entrega antes de continuar.',confirmText:'Entendi'});
                return;
            }
            setCheckoutStep(2);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
    setCheckoutStep(1);
    updatePaymentMethodSelectionUI();

    loadAndRenderPage();
    loadFeaturedProducts();
    
});
