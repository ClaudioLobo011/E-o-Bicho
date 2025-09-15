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

    // --- LÓGICA DAS ABAS (Geral / Especificações) ---
    const productTabLinks = document.querySelectorAll('#product-tabs .tab-link');
    const productTabContents = {
        'tab-geral': document.getElementById('tab-geral'),
        'tab-especificacoes': document.getElementById('tab-especificacoes'),
    };
    function activateProductTab(tabId) {
        Object.entries(productTabContents).forEach(([id, el]) => {
            if (!el) return;
            if (id === tabId) el.classList.remove('hidden'); else el.classList.add('hidden');
        });
        productTabLinks.forEach((btn) => {
            const isActive = btn.dataset.tab === tabId;
            btn.classList.toggle('text-primary', isActive);
            btn.classList.toggle('border-primary', isActive);
            btn.classList.toggle('text-gray-500', !isActive);
            btn.classList.toggle('border-transparent', !isActive);
            btn.classList.toggle('hover:border-gray-300', !isActive);
        });
    }
    if (productTabLinks.length) {
        productTabLinks.forEach((btn) => {
            btn.addEventListener('click', () => activateProductTab(btn.dataset.tab));
        });
        // Garante aba inicial correta (a que já vem com text-primary) ou default 'Geral'
        activateProductTab(document.querySelector('#product-tabs .tab-link.text-primary')?.dataset.tab || 'tab-geral');
    }

    // --- ESTADO DA PÁGINA ---
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get('id');
    let productCategories = []; // Array de IDs das categorias selecionadas
    let allHierarchicalCategories = []; // Guarda a árvore de categorias

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
        form.querySelector('#custo').value = product.custo || 0;
        form.querySelector('#venda').value = product.venda || 0;
        form.querySelector('#stock').value = product.stock || 0;

        productCategories = product.categorias.map(cat => cat._id);
        renderCategoryTags(product.categorias);

        existingImagesGrid.innerHTML = product.imagens.map(imgUrl => `
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
    };

    const initializeSaveCategoryButton = (allFlatCategories) => {
        saveCategoryModalBtn.addEventListener('click', () => {
            const selectedCheckboxes = categoryTreeContainer.querySelectorAll('input[type="checkbox"]:checked');
            productCategories = Array.from(selectedCheckboxes).map(cb => cb.value);
            
            // Usamos uma única chamada à API para obter todas as categorias de uma vez
            fetch(`${API_CONFIG.BASE_URL}/categories`).then(res => res.json()).then(allFlatCategories => {
                
                // 1. Renderiza as tags, como antes
                const selectedCategoryObjects = allFlatCategories.filter(cat => productCategories.includes(cat._id));
                renderCategoryTags(selectedCategoryObjects);

                // 2. Lógica para encontrar e preencher a marca
                const categoryMap = new Map(allFlatCategories.map(cat => [cat._id.toString(), cat]));
                let brandName = '';

                for (const selectedCat of selectedCategoryObjects) {
                    let current = selectedCat;
                    while (current && current.parent) {
                        const parent = categoryMap.get(current.parent.toString());
                        if (parent && parent.nome === 'Marcas') {
                            brandName = selectedCat.nome; // Encontrou! A marca é o nome da categoria selecionada.
                            break; // Para o loop interno
                        }
                        current = parent;
                    }
                    if (brandName) break; // Para o loop externo se já encontrou a marca
                }

                // 3. Preenche o campo 'marca' no formulário
                if (brandName) {
                    form.querySelector('#marca').value = brandName;
                }

                categoryModal.classList.add('hidden');
            });
        });
    };

    const initializePage = async () => {
        try {
            // Usa Promise.all para buscar dados do produto e TODAS as categorias em paralelo
            const [productRes, hierarchicalRes, flatRes] = await Promise.all([
                fetch(`${API_CONFIG.BASE_URL}/products/${productId}`),
                fetch(`${API_CONFIG.BASE_URL}/categories/hierarchical`),
                fetch(`${API_CONFIG.BASE_URL}/categories`) // <-- ADICIONADO: Busca a lista plana aqui
            ]);

            if (!productRes.ok || !hierarchicalRes.ok || !flatRes.ok) {
                throw new Error('Falha ao carregar os dados iniciais da página.');
            }

            const product = await productRes.json();
            allHierarchicalCategories = await hierarchicalRes.json();
            const allFlatCategories = await flatRes.json(); // <-- Guarda a lista plana

            // Passa a lista plana de categorias para a lógica do botão de salvar
            initializeSaveCategoryButton(allFlatCategories); 
            
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

    // ▼▼▼ ALTERAÇÃO: Lógica de preenchimento automático da marca adicionada aqui ▼▼▼
    saveCategoryModalBtn.addEventListener('click', () => {
        const selectedCheckboxes = categoryTreeContainer.querySelectorAll('input[type="checkbox"]:checked');
        productCategories = Array.from(selectedCheckboxes).map(cb => cb.value);
        
        // Usamos uma única chamada à API para obter todas as categorias de uma vez
        fetch(`${API_CONFIG.BASE_URL}/categories`).then(res => res.json()).then(allFlatCategories => {
            
            // 1. Renderiza as tags, como antes
            const selectedCategoryObjects = allFlatCategories.filter(cat => productCategories.includes(cat._id));
            renderCategoryTags(selectedCategoryObjects);

            // 2. Lógica para encontrar e preencher a marca
            const categoryMap = new Map(allFlatCategories.map(cat => [cat._id.toString(), cat]));
            let brandName = '';

            for (const selectedCat of selectedCategoryObjects) {
                let current = selectedCat;
                while (current && current.parent) {
                    const parent = categoryMap.get(current.parent.toString());
                    if (parent && parent.nome === 'Marcas') {
                        brandName = selectedCat.nome; // Encontrou! A marca é o nome da categoria selecionada.
                        break; // Para o loop interno
                    }
                    current = parent;
                }
                if (brandName) break; // Para o loop externo se já encontrou a marca
            }

            // 3. Preenche o campo 'marca'
            if (brandName) {
                form.querySelector('#marca').value = brandName;
            }

            categoryModal.classList.add('hidden');
        });
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>A Salvar...`;
        
        const formData = new FormData(form);
        const updateData = {
            descricao: formData.get('descricao'),
            marca: formData.get('marca'),
            stock: formData.get('stock'),
            categorias: productCategories,
            especificacoes: {
                idade: Array.from(form.querySelectorAll('input[name="spec-idade"]:checked')).map(i => i.value),
                pet: Array.from(form.querySelectorAll('input[name="spec-pet"]:checked')).map(i => i.value),
                porteRaca: Array.from(form.querySelectorAll('input[name="spec-porte"]:checked')).map(i => i.value),
                apresentacao: (document.getElementById('spec-apresentacao')?.value || '').trim()
            }
        };

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
