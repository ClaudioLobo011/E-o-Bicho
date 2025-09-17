import { attachEvents } from './events.js';
import { init } from './init.js';

// Attach handlers immediately (module scripts are deferred by default)
attachEvents();
init();

try {
  const precosApi = window?.cadastroServicosPrecos;
  if (precosApi?.initPrecosTab) {
    precosApi.initPrecosTab();
  } else {
    console.warn('cadastro-servicos: módulo de preços não disponível');
  }
} catch (err) {
  console.error('Falha ao inicializar aba de preços', err);
}

// Patch alert -> toast for this page
try {
  if (!window.__alertPatched_servicos) {
    const orig = window.alert.bind(window);
    window.alert = function(message) {
      const msg = String(message || '');
      const low = msg.toLowerCase();
      let type = 'info';
      if (low.includes('sucesso')) type = 'success';
      else if (low.includes('erro') || low.includes('não foi possível') || low.includes('nao foi poss')) type = 'error';
      else if (low.startsWith('selecione') || low.startsWith('informe') || low.startsWith('preencha')) type = 'warning';
      if (typeof window.showToast === 'function') window.showToast(msg, type, 2500);
      else orig(msg);
    };
    window.__alertPatched_servicos = true;
  }
} catch (_) { /* ignore */ }

// Guarda básica: impede salvar quando faltarem os filtros obrigatórios
try {
  const saveBtn = document.getElementById('ap-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', (ev) => {
      try {
        const tipo = document.getElementById('ap-tipo')?.value || '';
        const store = document.getElementById('ap-store')?.value || '';
        const servId = document.getElementById('ap-serv-id')?.value || '';
        if (!(servId && store && tipo)) {
          if (window.showToast) window.showToast('Selecione serviço, tipo e empresa.', 'warning');
          ev.preventDefault(); ev.stopImmediatePropagation();
          return;
        }
      } catch (_) { /* ignore */ }
    }, true); // capture antes do handler padrão
  }
} catch (_) { /* ignore */ }
