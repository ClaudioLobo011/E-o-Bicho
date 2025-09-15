document.addEventListener('DOMContentLoaded', () => {
    const storesContainer = document.getElementById('stores-list-container');
    if (!storesContainer) return;

    // Função auxiliar para formatar o horário a partir do objeto
    function formatarHorario(horario) {
        if (!horario) return 'Não informado';
        
        const dias = [
            { key: 'segunda', label: 'Segunda a sexta' }, // Agruparemos os dias da semana
            { key: 'sabado', label: 'Sábado' },
            { key: 'domingo', label: 'Domingo e Feriado' }
        ];

        let horarioHtml = '';
        
        // Lógica simplificada para agrupar dias da semana se o horário for o mesmo
        const seg = horario.segunda;
        const sex = horario.sexta;
        if (seg && sex && seg.abre === sex.abre && seg.fecha === sex.fecha && !seg.fechada) {
            horarioHtml += `Segunda a sexta - das ${seg.abre} às ${seg.fecha}<br>`;
        } else {
            // Se não for igual, mostra individualmente (pode ser expandido no futuro)
            if(horario.segunda && !horario.segunda.fechada) horarioHtml += `Segunda - das ${horario.segunda.abre} às ${horario.segunda.fecha}<br>`;
        }

        if (horario.sabado) {
            horarioHtml += horario.sabado.fechada ? 'Sábado - Fechada<br>' : `Sábado - das ${horario.sabado.abre} às ${horario.sabado.fecha}<br>`;
        }
        if (horario.domingo) {
            horarioHtml += horario.domingo.fechada ? 'Domingo e Feriado - Fechada' : `Domingo e Feriado - das ${horario.domingo.abre} às ${horario.domingo.fecha}`;
        }

        return horarioHtml;
    }

    async function fetchAndDisplayStores() {
        try {
            const response = await fetch(`${API_CONFIG.BASE_URL}/stores`);
            const stores = await response.json();
            
            storesContainer.innerHTML = '';

            if (stores.length === 0) {
                storesContainer.innerHTML = '<p class="text-center text-gray-500">Nenhuma loja física encontrada no momento.</p>';
                return;
            }

            stores.forEach(store => {
                const horarioFormatado = formatarHorario(store.horario);
                const storeHtml = `
                <div class="bg-white rounded-lg shadow overflow-hidden flex flex-col md:flex-row">
                    <div class="md:w-1/2 p-4 flex items-center justify-center">
                        <img src="${API_CONFIG.SERVER_URL}${store.imagem}" alt="${store.nome}" class="w-[600px] h-auto max-h-[350px] object-cover rounded-md">
                    </div>
                    <div class="md:w-1/2 p-6">
                        <h3 class="text-xl font-bold text-gray-800 mb-4">${store.nome}</h3>
                        <div class="mt-4 space-y-3 text-gray-700 text-sm">
                            <p><span class="font-semibold">Endereço:</span><br>${store.endereco.replace(/\n/g, '<br>')}</p>
                            <p><span class="font-semibold">CEP:</span><br>${store.cep}</p>
                            <p><span class="font-semibold">Telefone:</span><br>${store.telefone}</p>
                            ${store.whatsapp ? `<p><span class="font-semibold">Whatsapp:</span><br>${store.whatsapp}</p>` : ''}
                            <p><span class="font-semibold">Horário de funcionamento:</span><br>${horarioFormatado}</p>
                        </div>
                    </div>
                </div>
                `;
                storesContainer.innerHTML += storeHtml;
            });

        } catch (error) {
            console.error("Erro ao buscar lojas:", error);
            storesContainer.innerHTML = '<p class="text-center text-red-500">Ocorreu um erro ao carregar as nossas lojas.</p>';
        }
    }

    fetchAndDisplayStores();
});