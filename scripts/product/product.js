document.addEventListener('DOMContentLoaded', () => {
    initializeProductPage();
});

// Carrega o SVG de especificações uma única vez e o injeta no DOM.
let _specsSvgPromise = null;
function loadSpecsSvg() {
  if (_specsSvgPromise) return _specsSvgPromise;

  _specsSvgPromise = (async () => {
    const container = document.getElementById('product-specs-svg-container');
    if (!container) return; // página sem o bloco

    const tryFetch = async (url) => {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Falha ao buscar: ${url}`);
      return resp.text();
    };

    let svgMarkup;
    try {
      // 1ª opção: arquivo novo com os IDs (recomendado)
      svgMarkup = await tryFetch('/public/icons/especificacoes-pet.svg');
    } catch {
      // fallback: mantém compatibilidade se o arquivo antigo ainda existir
      svgMarkup = await tryFetch('/public/icons/especificacoes.svg');
    }

    container.innerHTML = svgMarkup; // injeta o <svg ...> no DOM
  })();

  return _specsSvgPromise;
}

let _descSvgPromise = null;
function loadDescSvg() {
  if (_descSvgPromise) return _descSvgPromise;

  _descSvgPromise = (async () => {
    const container = document.getElementById('product-desc-svg-container');
    if (!container) return; // página sem o bloco

    const resp = await fetch('/public/icons/descricao-pet.svg?v=2');
    if (!resp.ok) throw new Error('Não foi possível carregar descricao-pet.svg');

    const svgMarkup = await resp.text();
    container.innerHTML = svgMarkup; // injeta o <svg id="svg-descricao"> no DOM
  })();

  return _descSvgPromise;
}

async function initializeProductPage() {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');

    if (!productId) {
        document.getElementById('product-details-container').innerHTML = 
            '<p class="text-center text-red-500 font-bold">Erro: ID do produto não encontrado na URL.</p>';
        return;
    }

    fetchProductDetails(productId);

    const favButton = document.getElementById('add-to-wishlist-btn');
    if (!favButton) return;

    const heartIconEmpty = `<svg class="h-7 w-7 text-gray-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 116.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z" /></svg>`;
    const heartIconFilled = `<svg class="h-7 w-7 text-red-500" fill="currentColor" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 116.364 6.364L12 20.364l-7.682-7.682a4.5 4.5 0 010-6.364z" /></svg>`;

    // Função para atualizar o estado visual do botão
    const updateButtonState = async () => {
        const isFav = await FavoritesManager.isFavorite(productId);
        favButton.innerHTML = isFav ? heartIconFilled : heartIconEmpty;
        favButton.dataset.favorited = isFav;
    };

    favButton.addEventListener('click', async () => {
        const isCurrentlyFavorited = favButton.dataset.favorited === 'true';
        if (isCurrentlyFavorited) {
            await FavoritesManager.removeFavorite(productId);
        } else {
            await FavoritesManager.addFavorite(productId);
        }
        await updateButtonState();
    });

    await updateButtonState(); // Define o estado inicial
}

async function fetchProductDetails(productId) {
    try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/products/${productId}`);
        if (!response.ok) {
            throw new Error('Produto não encontrado.');
        }
        const product = await response.json();
        
        await renderProductDetails(product);
        
        // A chamada à função de breadcrumb agora usa o array 'categorias'
        renderBreadcrumb(product.breadcrumbPath); 
        renderPromotionsPanel(product);

    } catch (error) {
        console.error('Erro ao buscar detalhes do produto:', error);
        document.getElementById('product-details-container').innerHTML =
             `<p class="text-center text-red-500 font-bold">${error.message}</p>`;
    }
}

/**
 * Preenche a página com os detalhes do produto recebido da API.
 * (VERSÃO ATUALIZADA COM LÓGICA DE PREÇO PROMOCIONAL E PREÇO DO CLUBE)
 * @param {object} product - O objeto do produto.
 */
async function renderProductDetails(product) {
    document.title = `${product.nome} - E o Bicho`;

    document.getElementById('product-title').textContent = product.nome;
    document.getElementById('product-sku').textContent = `Cód. Item ${product.cod}`;
    document.getElementById('product-brand').textContent = `Marca: ${product.marca || 'Não informada'}`;
    
    // --- INÍCIO DA LÓGICA DE PREÇO CORRIGIDA ---
    const priceContainer = document.getElementById('product-price');
    let priceHtml = '';

    // 1. Verifica a Promoção Individual (desconto direto)
    // Esta é a ÚNICA condição que mostra um preço cortado no painel principal.
    if (product.promocao && product.promocao.ativa && product.promocao.porcentagem > 0) {
        const discountedPrice = product.venda * (1 - product.promocao.porcentagem / 100);
        priceHtml = `
            <div class="flex items-end space-x-3">
                <span class="text-4xl font-bold text-primary">R$ ${discountedPrice.toFixed(2).replace('.', ',')}</span>
                <div class="bg-primary text-white font-bold text-sm px-2 py-1 rounded-md mb-1">
                    -${product.promocao.porcentagem}% OFF
                </div>
            </div>
            <div class="mt-1">
                <span class="text-gray-500 text-lg line-through">R$ ${product.venda.toFixed(2).replace('.', ',')}</span>
            </div>
        `;
    } 
    // 2. Para TODOS os outros casos (com ou sem Preço Club), o preço principal é o de venda normal.
    // A vantagem do Preço Club será mostrada apenas no painel de promoções.
    else {
        priceHtml = `<span class="text-4xl font-bold text-primary">R$ ${product.venda.toFixed(2).replace('.', ',')}</span>`;
    }
    priceContainer.innerHTML = priceHtml;
    // --- FIM DA LÓGICA DE PREÇO CORRIGIDA ---

    await loadDescSvg();
    renderProductDescription(product);
    await loadSpecsSvg();
    renderProductSpecifications(product);

    const stockStatusEl = document.getElementById('stock-status');
    if (product.stock > 0) {
        stockStatusEl.className = 'flex items-center space-x-2 text-green-600 font-semibold text-sm';
        stockStatusEl.innerHTML = `<div class="w-3 h-3 bg-green-500 rounded-full"></div><span>Em Estoque</span>`;
    } else {
        stockStatusEl.className = 'flex items-center space-x-2 text-red-500 font-semibold text-sm';
        stockStatusEl.innerHTML = `<div class="w-3 h-3 bg-red-500 rounded-full"></div><span>Indisponível</span>`;
    }

    const mainImage = document.getElementById('main-product-image');
    const thumbnailGallery = document.getElementById('thumbnail-gallery');

    const placeholderOptions = ['/public/image/placeholder.svg', `${API_CONFIG.SERVER_URL}/image/placeholder.svg`, `${API_CONFIG.SERVER_URL}/image/placeholder.png`];
    const productImages = Array.isArray(product.imagens) ? product.imagens : [];
    const normalizeImageUrl = (url) => {
        if (!url) return null;
        return /^https?:\/\//i.test(url) ? url : `${API_CONFIG.SERVER_URL}${url}`;
    };

    const allImages = [product.imagemPrincipal, ...productImages.filter(img => img !== product.imagemPrincipal)]
        .map(normalizeImageUrl)
        .filter(Boolean);

    const setMainImage = (src) => {
        let fallbackIndex = 0;
        mainImage.onerror = () => {
            if (fallbackIndex < placeholderOptions.length) {
                mainImage.src = placeholderOptions[fallbackIndex++];
                return;
            }
            mainImage.onerror = null;
        };

        mainImage.src = src || placeholderOptions[0];
    };

    setMainImage(allImages.length ? allImages[0] : placeholderOptions[0]);
    thumbnailGallery.innerHTML = '';

    const addThumbnail = (imgSrc, isActive = false) => {
        const thumb = document.createElement('img');
        thumb.src = imgSrc;
        thumb.className = 'w-full h-20 object-contain rounded-md cursor-pointer border-2 border-transparent hover:border-primary transition-all p-1';

        let fallbackIndex = 0;
        thumb.onerror = () => {
            if (fallbackIndex < placeholderOptions.length) {
                const nextSrc = placeholderOptions[fallbackIndex++];
                thumb.src = nextSrc;

                if (isActive) {
                    setMainImage(nextSrc);
                }
                return;
            }

            thumb.onerror = null;
        };

        if (isActive) {
            thumb.classList.add('border-primary');
            thumb.classList.remove('border-transparent');
        }

        thumb.addEventListener('click', () => {
            setMainImage(thumb.src);
            thumbnailGallery.querySelectorAll('img').forEach(el => el.classList.remove('border-primary'));
            thumb.classList.add('border-primary');
        });
        thumbnailGallery.appendChild(thumb);
    };

    if (allImages.length === 0) {
        addThumbnail(placeholderOptions[0], true);
        return;
    }

    allImages.forEach((imgSrc, index) => {
        addThumbnail(imgSrc, index === 0);
    });
}

/**
 * Renderiza o caminho de navegação (breadcrumb) na página do produto.
 * (VERSÃO FINAL E CORRIGIDA)
 * @param {Array} breadcrumbPath - O array com o caminho das categorias vindo da API.
 */
function renderBreadcrumb(breadcrumbPath) {
    const container = document.getElementById('breadcrumb-container');
    if (!container || !breadcrumbPath || breadcrumbPath.length === 0) {
        // Se não houver caminho, esconde a navegação inteira para um visual mais limpo
        if (container.parentElement) container.parentElement.style.display = 'none';
        return;
    }

    // Limpa qualquer conteúdo anterior, exceto o link "Início"
    while (container.children.length > 1) {
        container.removeChild(container.lastChild);
    }

    breadcrumbPath.forEach((category, index) => {
        // Adiciona o separador ">"
        const separatorLi = document.createElement('li');
        separatorLi.innerHTML = '<span class="text-gray-400">&gt;</span>';
        container.appendChild(separatorLi);

        const categoryLi = document.createElement('li');
        const isLastItem = index === breadcrumbPath.length - 1;

        if (isLastItem) {
            // O último item é a categoria atual, então não é um link
            categoryLi.className = 'font-semibold text-gray-800';
            categoryLi.textContent = category.nome;
        } else {
            // Os itens anteriores são links para as categorias pai
            const link = document.createElement('a');
            link.href = category.href; // Usa o href que o back-end já preparou
            link.className = 'hover:text-primary hover:underline';
            link.textContent = category.nome;
            categoryLi.appendChild(link);
        }
        container.appendChild(categoryLi);
    });
}

/**
 * Analisa as promoções de um produto e renderiza o painel de vantagens.
 * @param {object} product - O objeto completo do produto vindo da API.
 */
function renderPromotionsPanel(product) {
    const panel = document.getElementById('product-promotions-panel');
    if (!panel) return;

    panel.innerHTML = ''; // Limpa o painel

    let hasAnyBenefit = false;
    let subscriberPrice = null;

    // 1. Verifica o preço da Promoção Individual
    if (product.promocao && product.promocao.ativa && product.promocao.porcentagem > 0) {
        subscriberPrice = product.venda * (1 - product.promocao.porcentagem / 100);
    }

    // 2. Compara com o Preço Club e pega no menor valor
    if (product.precoClube && product.precoClube < product.venda) {
        // Se já tínhamos um preço de promoção, pega no menor dos dois. Senão, usa o do clube.
        subscriberPrice = subscriberPrice ? Math.min(subscriberPrice, product.precoClube) : product.precoClube;
    }

    // Se encontrámos um preço vantajoso para assinantes, cria o HTML
    if (subscriberPrice) {
        hasAnyBenefit = true;
        const subscriberPriceHtml = `
            <div class="flex items-start text-lg">
                <i class="fa-solid fa-rotate text-primary w-5 text-center pt-1"></i>
                <div class="ml-2">
                    <p class="text-gray-800">
                        <span class="font-bold">R$ ${subscriberPrice.toFixed(2).replace('.', ',')}</span>
                        para assinantes
                    </p>
                </div>
            </div>`;
        panel.innerHTML += subscriberPriceHtml;
    }

    // 3. Verifica se há Promoção Condicional
    if (product.promocaoCondicional && product.promocaoCondicional.ativa) {
        hasAnyBenefit = true;
        let promoTitle = 'Promoção Especial';
        let promoDescription = 'Confira a vantagem na sacola.';

        if (product.promocaoCondicional.tipo === 'leve_pague') {
            promoTitle = `Leve ${product.promocaoCondicional.leve}, Pague ${product.promocaoCondicional.pague}`;
            promoDescription = `Na compra de ${product.promocaoCondicional.leve} unidades, você paga apenas ${product.promocaoCondicional.pague}!`;
        } else if (product.promocaoCondicional.tipo === 'acima_de') {
             promoTitle = `Acima de ${product.promocaoCondicional.quantidadeMinima} unidades tem ${product.promocaoCondicional.descontoPorcentagem}% OFF`;
             promoDescription = `Desconto aplicado na compra de ${product.promocaoCondicional.quantidadeMinima} ou mais unidades.`;
        }

        const conditionalPromoHtml = `
            <div class="flex items-start text-sm">
                <i class="fas fa-tags text-primary w-5 text-center pt-1"></i>
                <div class="ml-2">
                    <p class="font-bold text-gray-800">${promoTitle}</p>
                    <p class="text-xs text-gray-600">${promoDescription}</p>
                </div>
            </div>`;
        panel.innerHTML += conditionalPromoHtml;
    }

    // 4. Se qualquer benefício foi encontrado, adiciona as vantagens estáticas e o fundo
    if (hasAnyBenefit) {
        const benefitsHtml = `
            <div class="flex items-start text-sm">
                <i class="fa-solid fa-check text-primary w-5 text-center pt-1"></i>
                <div class="ml-2">
                    <p class="text-gray-800">
                        <span class="font-bold">10% OFF em todas as compras no site, app e lojas físicas</span>
                    </p>
                </div>
            </div>
            <div class="flex items-start text-sm">
                <i class="fa-solid fa-check text-primary w-5 text-center pt-1"></i>
                <div class="ml-2">
                    <p class="text-gray-800">
                        <span class="font-bold">Sem custos ou mensalidade, cancele ou pause quando quiser</span>
                    </p>
                </div>
            </div>
            <div class="flex items-start text-sm">
                <i class="fa-solid fa-check text-primary w-5 text-center pt-1"></i>
                <div class="ml-2">
                    <p class="text-gray-800">
                        <span class="font-bold">Assine os produtos na sacola e garanta os benefícios</span>
                    </p>
                </div>
            </div>`;
        panel.innerHTML += benefitsHtml;
        panel.className = 'bg-green-50 my-6 space-y-4 p-4 rounded-lg'; // Adiciona o estilo ao painel
    } else {
        panel.style.display = 'none'; // Esconde o painel se não houver nenhuma vantagem
    }
}

/**
 * Renderiza a lista de Especificações do produto.
 * Mostra apenas os campos preenchidos/selecionados.
 * Campos: Idade[], Pet[], Porte[], Apresentação (texto), EAN (codbarras)
 */
function renderProductSpecifications(product) {
  const section = document.getElementById('product-specs-section');
  const svg = document.getElementById('svg-especificacoes');
  const listFallback = document.getElementById('product-specs-list'); // mantido para compatibilidade
  if (!section || !svg) return;

  const espec = product?.especificacoes || {};

  // Normaliza valores, remove vazios e duplicados
  const norm = (val) => {
    if (Array.isArray(val)) return [...new Set(val.map(v => String(v || '').trim()).filter(Boolean))];
    const s = String(val || '').trim();
    return s ? [s] : [];
  };

  const linhas = [];
  const add = (rotulo, valor) => {
    const arr = norm(valor);
    if (arr.length) linhas.push(`${rotulo}: ${arr.join(', ')}`);
  };

  add('Idade', espec.idade);
  add('Pet', espec.pet);
  add('Porte', espec.porte);
  add('Apresentação', espec.apresentacao);
  if (product?.codbarras) add('EAN', product.codbarras);

  if (linhas.length === 0) {
    // sem dados → some com o bloco
    section.classList.add('hidden');
    if (listFallback) listFallback.innerHTML = '';
    return;
  }
  section.classList.remove('hidden');

  // IDs disponíveis no SVG (até 5 linhas)
  const ids = ['svg-spec-idade', 'svg-spec-pet', 'svg-spec-porte', 'svg-spec-apresentacao', 'svg-spec-ean'];
  const startY = 110;
  const step = 40;

  // Limpa tudo
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = '';
      el.setAttribute('display', 'none');
    }
  });

  // Preenche apenas o que existe e reposiciona sem deixar “buracos”
  linhas.slice(0, ids.length).forEach((texto, i) => {
    const el = document.getElementById(ids[i]);
    if (!el) return;
    el.textContent = texto;
    el.setAttribute('y', String(startY + i * step));
    el.removeAttribute('display');
  });
  layoutSvgGroup(ids, { groupId: 'svg-desc-content', align: 'center' });
  document.getElementById('product-desc-heading')?.classList.add('hidden');
}

function layoutSvgGroup(
  ids,
  {
    groupId,
    align = 'center',        // 'left' | 'center' | 'right'
    content = { x: 56, y: 112, w: 688, h: 340 },
    stepByCount = (n) => (n <= 5 ? 38 : n <= 8 ? 34 : 28),
    fontSizeByCount = (n) => (n <= 5 ? 20 : n <= 8 ? 18 : 16),
  } = {}
) {
  const CONTENT_X = content.x, CONTENT_Y = content.y, CONTENT_W = content.w, CONTENT_H = content.h;
  const PAD_L = 32, PAD_R = 32;

  let anchor, anchorX;
  if (align === 'right') { anchor = 'end';    anchorX = CONTENT_X + CONTENT_W - PAD_R; }
  else if (align === 'center') { anchor = 'middle'; anchorX = CONTENT_X + CONTENT_W / 2; }
  else { anchor = 'start'; anchorX = CONTENT_X + PAD_L; } // left

  // pega só as linhas com conteúdo
  const nodes = ids.map(id => document.getElementById(id))
                   .filter(el => el && el.textContent.trim().length > 0);

  const group = document.getElementById(groupId);
  if (!nodes.length) { if (group) group.setAttribute('display', 'none'); return; }
  if (group) {
    group.removeAttribute('display');
    // força o anchor também no grupo (propriedade herdável)
    group.removeAttribute('text-anchor');
    group.setAttribute('text-anchor', anchor);
  }

  const n = nodes.length;
  const STEP = stepByCount(n);
  const FONT_SIZE = fontSizeByCount(n);
  const FONT_WEIGHT = 600;
  const BASELINE_TWEAK = 4;

  const totalSpan = (n - 1) * STEP;
  const firstY = CONTENT_Y + (CONTENT_H - totalSpan) / 2 + BASELINE_TWEAK;

  nodes.forEach((el, i) => {
    el.setAttribute('display', '');
    // remove qualquer anchor antigo e seta o novo
    el.removeAttribute('text-anchor');
    el.setAttribute('text-anchor', anchor);
    el.setAttribute('x', String(anchorX));
    el.setAttribute('y', String(firstY + i * STEP));
    el.style.fontSize = FONT_SIZE + 'px';
    el.style.fontWeight = String(FONT_WEIGHT);
    el.style.fontFamily = 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
    el.style.fill = 'var(--color-dark)';
  });
}

function renderProductDescription(product) {
  const descContainer = document.getElementById('product-desc-svg-container');
  const htmlFallback = document.getElementById('product-description'); // mantém compatibilidade
  if (!descContainer) return;

  // 1) Normaliza/limpa a descrição: remove HTML e quebra em linhas
  const raw = String(product?.descricao || '').trim();
  if (!raw) {
    if (htmlFallback) htmlFallback.textContent = '';
    document.getElementById('product-desc-heading')?.classList.remove('hidden');
    return;
  }

  // Converte HTML em texto (preserva quebras <br>)
  const tmp = document.createElement('div');
  tmp.innerHTML = raw.replace(/<br\s*\/?>/gi, '\n');
  const plain = tmp.textContent || tmp.innerText || '';

  // Heurística de bullet points:
  // - quebra por linhas
  // - remove prefixos como "-", "•", "–"
  const lines = plain
    .split(/\r?\n/)
    .map(s => s.replace(/^\s*[-•–]\s*/, '').trim())
    .filter(Boolean);

  // Fallback: se vier tudo em um parágrafo, tenta dividir por " ; " ou ". "
  let parts = lines;
  if (parts.length <= 1) {
    parts = plain.split(/(?:;|\.\s+|- )/).map(s => s.trim()).filter(Boolean);
  }

  // 2) Preenche nos <text id="svg-desc-#">
  const ids = Array.from({ length: 12 }, (_, i) => `svg-desc-${i + 1}`);

  // limpa
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.setAttribute('display', 'none'); }
  });

  // Limita para caber; o layout ajusta fonte/step pelo total
  parts.slice(0, ids.length).forEach((texto, i) => {
    const el = document.getElementById(ids[i]);
    if (!el) return;
    el.textContent = texto;
    el.removeAttribute('display');
  });

  // 3) Alinha (mesma lógica do quadro de especificações)
  // Quer igual ao que você pediu lá (lado direito)? use align: 'right'
  layoutSvgGroup(ids, { groupId: 'svg-desc-content', align: 'center' });

  // 4) Esconde o fallback HTML (mantido por segurança)
  if (htmlFallback) htmlFallback.classList.add('hidden');
}
