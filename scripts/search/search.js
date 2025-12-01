// Search page logic: supports category view and free-text search (?search=)
document.addEventListener('DOMContentLoaded', () => {
  initializeSearchPage();
});

const normalizeProductImageUrl = (rawUrl) => {
  const placeholder = `${API_CONFIG.SERVER_URL}/image/placeholder.svg`;
  const cleanUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!cleanUrl) return placeholder;
  return /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `${API_CONFIG.SERVER_URL}${cleanUrl}`;
};

function initializeSearchPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const term = urlParams.get('search') || urlParams.get('q');
  if (term) {
    renderSearchResults(term);
    return;
  }

  const categoryName = urlParams.get('category');
  const parentName = urlParams.get('parent');
  const grandParentName = urlParams.get('grandparent');

  const pageTitleEl = document.getElementById('page-title');
  if (pageTitleEl) pageTitleEl.textContent = categoryName || '';
  if (categoryName) document.title = `${categoryName} - E o Bicho`;

  if (!categoryName) { return; }

  fetchProductsByCategory(categoryName, parentName, grandParentName);
  fetchAndRenderSubCategories(categoryName, parentName, grandParentName);
  fetchAndRenderBreadcrumb(categoryName, parentName, grandParentName);
}

async function renderSearchResults(term) {
  const list = document.getElementById('product-list-container');
  const aside = document.querySelector('aside');
  const breadcrumb = document.getElementById('breadcrumb-container');
  const title = document.getElementById('page-title');
  if (aside) aside.style.display = 'none';
  if (breadcrumb) breadcrumb.innerHTML = '';
  if (title) { title.textContent = `Resultados para "${term}"`; }
  document.title = `${term} - Busca - E o Bicho`;

  try {
    list.innerHTML = '<p class="col-span-full text-center text-gray-500">Carregando.</p>';
    fetch(`${API_CONFIG.BASE_URL}/search/track`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ term }) }).catch(()=>{});

    const pageSize = 60;
    let page = 1, totalPages = 1; const all = [];
    do {
      const resp = await fetch(`${API_CONFIG.BASE_URL}/products?search=${encodeURIComponent(term)}&limit=${pageSize}&page=${page}`);
      if (!resp.ok) {
        const jerr = await resp.json().catch(()=>({}));
        throw new Error(jerr.message || 'Erro ao buscar produtos');
      }
      const j = await resp.json();
      (j.products || []).forEach(p => all.push(p));
      totalPages = j.pages || 1; page++;
    } while (page <= totalPages);

    list.innerHTML = '';
    renderProducts(all, list);
    if (!all.length) list.innerHTML = '<p class="col-span-full text-center text-gray-500">Nenhum produto encontrado.</p>';
  } catch (e) {
    console.error(e);
    list.innerHTML = '<p class="col-span-full text-center text-gray-500">Falha ao carregar resultados.</p>';
  }
}

function renderProducts(products, container) {
  if (!Array.isArray(products)) products = [];
  else products = products.filter(p => p && p.naoMostrarNoSite !== true);
  if (!container) return;
  const toReais = (n)=> `R$ ${Number(n||0).toFixed(2).replace('.', ',')}`;

  const html = products.map(p => {
    const img = normalizeProductImageUrl(p.imagemPrincipal);
    let price = '';
    if (p.promocao && p.promocao.ativa && p.promocao.porcentagem > 0) {
      const disc = (p.venda||0) * (1 - (p.promocao.porcentagem/100));
      price = `<div><span class=\"block text-sm text-gray-500 line-through\">${toReais(p.venda)}</span><div class=\"flex items-center\"><span class=\"text-base font-bold text-primary\">${toReais(disc)}</span><span class=\"ml-2 text-xs font-bold text-white bg-primary rounded-full px-2 py-0.5\">Promo</span></div></div>`;
    } else if (p.precoClube && p.precoClube < p.venda) {
      price = `<div><span class=\"block text-sm text-gray-500\">${toReais(p.venda)}</span><div class=\"flex items-center\"><span class=\"text-base font-bold text-primary\">${toReais(p.precoClube)}</span><span class=\"ml-2 text-xs font-bold text-white bg-primary rounded-full px-2 py-0.5\">Club</span></div></div>`;
    } else {
      price = `<span class=\"block text-base font-bold text-gray-900\">${toReais(p.venda)}</span>`;
    }

    return `
      <a href="/pages/menu-departments-item/product.html?id=${p._id}" class="relative block bg-white rounded-lg shadow product-card transition duration-300 group overflow-hidden flex flex-col">
        ${p.promocao && p.promocao.ativa && p.promocao.porcentagem>0 ? `<div class=\"absolute top-3 left-0 w-auto bg-primary text-white text-xs font-bold py-1 pl-2 pr-3 rounded-r z-10\">-${p.promocao.porcentagem}% DE DESCONTO</div>` : ''}
        <div class="p-4 product-info flex flex-col h-full">
          <div class="relative w-full h-48 mb-4">
            <img src="${img}" alt="${p.nome}" class="w-full h-full object-contain rounded-md">
            <div class="add-to-cart absolute bottom-3 right-3 w-[55px] h-[55px] flex items-center justify-center rounded-full transition-all duration-300 opacity-0 group-hover:opacity-100 hover:bg-secondary" data-product-id="${p._id}">
              <div data-icon="sacola" class="w-[55px] h-[55px]"></div>
              <span class="sr-only">Adicionar ao Carrinho</span>
            </div>
          </div>
          <div class="product-details flex flex-col flex-grow">
            <h3 class="font-normal text-base h-12 line-clamp-2">${p.nome}</h3>
            <div class="product-price flex items-center mb-2 mt-auto min-h-[4rem]">${price}</div>
          </div>
        </div>
      </a>`;
  }).join('');

  container.innerHTML += html;
  if (typeof loadIcons === 'function') { try { loadIcons(); } catch(_) {} }

  container.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('.add-to-cart');
    if (!btn) return; ev.preventDefault();
    const id = btn.getAttribute('data-product-id');
    try { await CartManager.addItem(id); showToast?.('Produto adicionado à sacola.', 'success'); }
    catch { showToast?.('Não foi possível adicionar.', 'error'); }
  }, { once: true });
}

async function fetchProductsByCategory(categoryName, parentName, grandParentName) {
  const container = document.getElementById('product-list-container');
  if (!container) return;
  try {
    const params = new URLSearchParams({ name: categoryName });
    if (parentName) params.set('parent', parentName);
    if (grandParentName) params.set('grandparent', grandParentName);
    const url = `${API_CONFIG.BASE_URL}/products/by-category?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Falha ao buscar produtos da categoria');
    const j = await r.json();
    container.innerHTML = '';
    renderProducts(j.products || [], container);
    if (!j.products || !j.products.length) container.innerHTML = '<p class="col-span-full text-center text-gray-500">Nenhum produto encontrado nesta categoria.</p>';
  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="col-span-full text-center text-gray-500">Falha ao carregar produtos.</p>';
  }
}

async function fetchAndRenderSubCategories(categoryName, parentName, grandParentName) {
  const container = document.getElementById('subcategory-list-container');
  if (!container) return;
  try {
    const params = new URLSearchParams({ name: categoryName });
    if (parentName) params.set('parent', parentName);
    if (grandParentName) params.set('grandparent', grandParentName);
    const url = `${API_CONFIG.BASE_URL}/categories/subcategories?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Falha ao buscar subcategorias');
    const sub = await r.json();
    container.innerHTML = '';
    if (!sub.length) { container.innerHTML = '<p class="text-xs text-gray-400">Não há subcategorias.</p>'; return; }
    sub.forEach(sc => {
      let href = `/pages/menu-departments-item/search.html?category=${encodeURIComponent(sc.nome)}&parent=${encodeURIComponent(categoryName)}`;
      if (parentName) href += `&grandparent=${encodeURIComponent(parentName)}`;
      const a = document.createElement('a');
      a.href = href;
      a.className = 'block py-2 px-3 text-sm text-gray-600 hover:bg-primary/10 hover:text-primary font-medium rounded-md transition-colors';
      a.textContent = sc.nome;
      container.appendChild(a);
    });
  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="text-xs text-gray-400">Falha ao carregar subcategorias.</p>';
  }
}

async function fetchAndRenderBreadcrumb(categoryName, parentName, grandParentName) {
  const container = document.getElementById('breadcrumb-container');
  if (!container) return;
  try {
    const params = new URLSearchParams({ name: categoryName });
    if (parentName) params.set('parent', parentName);
    if (grandParentName) params.set('grandparent', grandParentName);
    const url = `${API_CONFIG.BASE_URL}/categories/path?${params.toString()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('Falha ao buscar breadcrumb');
    const path = await r.json();
    container.innerHTML = '<li><a href="/" class="text-gray-500 hover:text-primary">Início</a></li>';
    path.forEach((c, idx) => {
      container.innerHTML += '<li><span class="text-gray-400">&gt;</span></li>';
      const isLast = idx === path.length - 1;
      if (isLast) {
        container.innerHTML += `<li><span class="font-semibold text-gray-700">${c.nome}</span></li>`;
      } else {
        const parent = idx > 0 ? path[idx - 1].nome : null;
        const grandparent = idx > 1 ? path[idx - 2].nome : null;
        const paramsLink = new URLSearchParams({ category: c.nome });
        if (parent) paramsLink.set('parent', parent);
        if (grandparent) paramsLink.set('grandparent', grandparent);
        container.innerHTML += `<li><a href="/pages/menu-departments-item/search.html?${paramsLink.toString()}" class="text-gray-500 hover:text-primary">${c.nome}</a></li>`;
      }
    });
  } catch (e) { console.error(e); }
}
