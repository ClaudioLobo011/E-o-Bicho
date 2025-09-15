// Ficheiro: admin-categorias.js (VERSÃO COM CHAMADA DE FUNÇÃO CORRIGIDA)

document.addEventListener('DOMContentLoaded', () => {
    // --- Referências ao DOM ---
    const tableBody = document.getElementById('categories-table-body');
    const addCategoryBtn = document.getElementById('add-category-btn');
    const modal = document.getElementById('category-modal');
    const form = document.getElementById('category-form');
    const cancelBtn = document.getElementById('cancel-category-modal-btn');
    const modalTitle = document.getElementById('category-modal-title');
    const categoryNameInput = document.getElementById('category-name');
    const categoryParentSelect = document.getElementById('category-parent');
    const searchInput = document.getElementById('search-category-input');

    let hierarchicalCategories = [];
    let choicesInstance = null;
    let isEditMode = false;
    let currentEditingId = null;

    // --- Inicialização do Choices.js ---
    if (categoryParentSelect) {
        choicesInstance = new Choices(categoryParentSelect, {
            removeItemButton: true,
            placeholder: true,
            placeholderValue: 'Selecione uma ou mais categorias',
            searchPlaceholderValue: 'Digite para pesquisar',
            searchFn: (search, record) => {
                if (!window.fuzzysort) return Choices.defaults.searchFn(search, record);
                const results = fuzzysort.go(search, [record.label], {
                    threshold: -10000
                });
                return results.length > 0;
            }
        });
    }

    // --- Funções do Modal de Edição/Criação ---
    const openModalForNew = () => {
        isEditMode = false;
        currentEditingId = null;
        form.reset();
        modalTitle.textContent = 'Adicionar Nova Categoria';
        choicesInstance.clearStore();
        populateParentCategorySelect();
        choicesInstance.setChoiceByValue([]);
        modal.classList.remove('hidden');
    };

    const openModalForEdit = (category) => {
        isEditMode = true;
        currentEditingId = category.id;
        form.reset();
        modalTitle.textContent = 'Editar Categoria';
        categoryNameInput.value = category.name;
        choicesInstance.clearStore();
        populateParentCategorySelect();
        const parentId = category.parentId || '';
        choicesInstance.setChoiceByValue(parentId);
        modal.classList.remove('hidden');
    };

    const closeModal = () => modal.classList.add('hidden');

    const populateParentCategorySelect = () => {
        const options = [];
        const createOptions = (categories, parentPath = []) => {
            for (const category of categories) {
                if (isEditMode && category._id === currentEditingId) continue;
                const currentPath = [...parentPath, category.nome];
                options.push({
                    value: category._id,
                    label: currentPath.join(' > ')
                });
                if (category.children && category.children.length > 0) {
                    createOptions(category.children, currentPath);
                }
            }
        };
        createOptions(hierarchicalCategories);
        choicesInstance.setChoices(options, 'value', 'label', false);
    };

    // --- Lógica de Renderização e Filtragem da Tabela ---
    const renderRows = (categories, depth = 0) => {
        for (const category of categories) {
            const row = document.createElement('tr');
            row.className = 'bg-white border-b hover:bg-gray-50';
            const parentId = category.parent ? String(category.parent) : '';
            row.innerHTML = `
                <th scope="row" class="px-6 py-4 font-medium text-gray-900 whitespace-nowrap" style="padding-left: ${1.5 + depth * 1.5}rem;">
                    ${'—'.repeat(depth)} ${category.nome}
                </th>
                <td class="px-6 py-4 text-center">
                    <button class="edit-btn font-medium text-blue-600 hover:underline mr-3" 
                            data-id="${category._id}" 
                            data-name="${category.nome}" 
                            data-parent-id="${parentId}">
                        Editar
                    </button>
                    <button class="delete-btn font-medium text-red-600 hover:underline"
                            data-id="${category._id}"
                            data-name="${category.nome}">
                        Apagar
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
            if (category.children && category.children.length > 0) {
                renderRows(category.children, depth + 1);
            }
        }
    };

    const filterCategories = (categories, searchTerm) => {
        return categories.reduce((acc, category) => {
            const nameMatches = category.nome.toLowerCase().includes(searchTerm);
            const filteredChildren = category.children ? filterCategories(category.children, searchTerm) : [];
            if (nameMatches || filteredChildren.length > 0) {
                acc.push({ ...category,
                    children: filteredChildren
                });
            }
            return acc;
        }, []);
    };

    const handleSearch = () => {
        const searchTerm = searchInput.value.toLowerCase().trim();
        tableBody.innerHTML = '';
        if (!searchTerm) {
            renderRows(hierarchicalCategories);
            return;
        }
        const filteredData = filterCategories(hierarchicalCategories, searchTerm);
        renderRows(filteredData);
    };

    // --- Lógica de Carregamento Inicial ---
    async function fetchAndDisplayCategories() {
        if (!tableBody) return;
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/categories/hierarchical`);
            if (!response.ok) throw new Error('Falha ao buscar as categorias.');
            hierarchicalCategories = await response.json();
            handleSearch();
        } catch (error) {
            console.error(error);
            tableBody.innerHTML = `<tr><td colspan="2" class="text-center py-4 text-red-500">Erro ao carregar categorias.</td></tr>`;
        }
    }

    // --- Lógica de Submissão do Formulário ---
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submitButton = document.getElementById('save-category-modal-btn');
        submitButton.disabled = true;
        const selectedParent = choicesInstance.getValue(true);
        const parentId = Array.isArray(selectedParent) ? selectedParent[0] : selectedParent;
        const categoryData = {
            nome: categoryNameInput.value,
            parent: parentId || null
        };
        try {
            if (isEditMode) {
                const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                const token = loggedInUser?.token;
                const response = await fetch(`${API_CONFIG.BASE_URL}/categories/${currentEditingId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(categoryData)
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message);
            } else {
                const selectedParentIds = choicesInstance.getValue(true);
                if (selectedParentIds.length === 0) {
                    await createCategory(categoryData.nome, null);
                } else {
                    const creationPromises = selectedParentIds.map(pid => createCategory(categoryData.nome, pid));
                    await Promise.all(creationPromises);
                }
            }
            const successMessage = isEditMode ? 'Categoria atualizada com sucesso!' : 'Categoria(s) adicionada(s) com sucesso!';
            showModal({
                title: 'Sucesso!',
                message: successMessage,
                confirmText: 'OK'
            });
            closeModal();
            fetchAndDisplayCategories();
        } catch (error) {
            showModal({
                title: 'Erro',
                message: error.message,
                confirmText: 'Tentar Novamente'
            });
        } finally {
            submitButton.disabled = false;
        }
    });

    async function createCategory(name, parentId) {
        const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
        const token = loggedInUser?.token;
        const response = await fetch(`${API_CONFIG.BASE_URL}/categories`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                nome: name,
                parent: parentId
            })
        });
        const result = await response.json();
        if (!response.ok) {
            if (result.message && result.message.includes('duplicada')) {
                throw new Error(`A categoria "${name}" já existe nesse grupo.`);
            }
            throw new Error(result.message || 'Falha ao criar categoria.');
        }
        return result;
    }

    // --- Event Listeners ---
    addCategoryBtn.addEventListener('click', openModalForNew);
    cancelBtn.addEventListener('click', closeModal);
    searchInput.addEventListener('input', handleSearch);

    tableBody.addEventListener('click', (event) => {
        const editButton = event.target.closest('.edit-btn');
        const deleteButton = event.target.closest('.delete-btn');
        if (editButton) {
            const category = {
                id: editButton.dataset.id,
                name: editButton.dataset.name,
                parentId: editButton.dataset.parentId,
            };
            openModalForEdit(category);
        } else if (deleteButton) {
            const categoryId = deleteButton.dataset.id;
            const categoryName = deleteButton.dataset.name;
            
            // CORREÇÃO AQUI: Chamando a função showModal com o nome correto
            showModal({
                title: 'Confirmar Exclusão',
                message: `Tem a certeza de que deseja apagar a categoria "${categoryName}"? Esta ação não pode ser desfeita.`,
                confirmText: 'Apagar',
                cancelText: 'Cancelar',
                onConfirm: async () => {
                    try {
                        const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
                        const token = loggedInUser?.token;
                        const response = await fetch(`${API_CONFIG.BASE_URL}/categories/${categoryId}`, {
                            method: 'DELETE',
                            headers: {
                                'Authorization': `Bearer ${token}`
                            }
                        });
                        const result = await response.json();
                        if (!response.ok) {
                            throw new Error(result.message);
                        }
                        showModal({
                            title: 'Sucesso!',
                            message: result.message,
                            confirmText: 'OK'
                        });
                        fetchAndDisplayCategories();
                    } catch (error) {
                        showModal({
                            title: 'Erro ao Apagar',
                            message: error.message,
                            confirmText: 'OK'
                        });
                    }
                }
            });
        }
    });

    // --- Carga Inicial ---
    fetchAndDisplayCategories();
});