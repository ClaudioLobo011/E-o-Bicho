import { els } from './core.js';
import api from './api.js';
import { listar } from './list.js';
import { validarESerializar, resetForm, fillForm } from './form.js';

export function attachEvents() {
  if (!els.form) return;

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = validarESerializar();
    if (!v.ok) { alert(v.erros.join('\n')); return; }

    try {
      const id = els.inputId?.value;
      if (id) {
        const saved = await api.update(id, v.payload);
        fillForm(saved);
      } else {
        await api.create(v.payload);
        resetForm();
      }
      await listar();
    } catch (err) {
      console.error(err);
      alert('Erro ao salvar serviço.\n' + (err?.message || ''));
    }
  });

  els.btnCancelar?.addEventListener('click', () => resetForm());

  els.tbody?.addEventListener('click', async (e) => {
    const btn = e.target?.closest?.('button');
    if (!btn) return;
    const id = btn.getAttribute('data-edit') || btn.getAttribute('data-del');
    if (!id) return;
    try {
      if (btn.hasAttribute('data-edit')) {
        const item = await api.get(id);
        fillForm(item);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (btn.hasAttribute('data-del')) {
        if (!confirm('Confirma remover este serviço?')) return;
        await api.remove(id);
        if (els.inputId?.value === id) resetForm();
        await listar();
      }
    } catch (err) {
      console.error(err);
      alert('Não foi possível executar a ação.\n' + (err?.message || ''));
    }
  });
}

