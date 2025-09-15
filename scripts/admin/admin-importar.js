document.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('start-import-btn');
    const logContainer = document.getElementById('log-container');

    if (!startBtn || !logContainer) {
        return;
    }
    
    // Conecta ao servidor WebSocket (Socket.IO)
    const socket = io(API_CONFIG.SERVER_URL);

    const addLog = (message) => {
        logContainer.innerHTML += `> ${message}\n`;
        // Faz a consola rolar para a última mensagem
        logContainer.scrollTop = logContainer.scrollHeight;
    };
    
    // --- Eventos do Socket.IO ---
    socket.on('connect', () => {
        addLog('Conectado ao servidor em tempo real...');
    });

    socket.on('import-log', (message) => {
        addLog(message);
    });

    socket.on('import-finished', () => {
        addLog('✅ Importação finalizada com sucesso!');
        startBtn.disabled = false; // Reativa o botão
    });
    
    socket.on('import-error', () => {
        addLog('❌ ERRO: A importação falhou. Verifique a consola do servidor para mais detalhes.');
        startBtn.disabled = false; // Reativa o botão
    });

    // --- Evento do Botão ---
    startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        logContainer.innerHTML = ''; // Limpa a consola
        addLog('A enviar pedido de importação para o servidor...');

        try {
            const loggedInUser = JSON.parse(localStorage.getItem('loggedInUser'));
            const token = loggedInUser?.token;
            const response = await fetch(`${API_CONFIG.BASE_URL}/jobs/import-products`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Erro desconhecido ao iniciar o processo.');
            }
            
            addLog(`Servidor respondeu: ${data.message}`);
        } catch (error) {
            addLog(`❌ ERRO: Não foi possível iniciar o processo. ${error.message}`);
            startBtn.disabled = false;
        }
    });
});