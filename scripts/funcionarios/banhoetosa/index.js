// Entry point for Banho e Tosa agenda (ESM)
import './core.js';
import './filters.js';
import './stores.js';
import './profissionais.js';
import './agendamentos.js';
import './grid.js';
import './ui.js';
import './modal.js';
import './print.js';
import { attachGlobalActionHandlers } from './actions.js';
import { initBanhoETosa } from './init.js';

document.addEventListener('DOMContentLoaded', () => {
  initBanhoETosa();
  attachGlobalActionHandlers();
});
