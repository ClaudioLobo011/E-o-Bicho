// Main entry for the Vet ficha clínica page
import { initFichaClinica } from './init.js';
import { ensureVerifiedRole } from './core.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await ensureVerifiedRole();
  } catch (_) {}
  initFichaClinica();
});
