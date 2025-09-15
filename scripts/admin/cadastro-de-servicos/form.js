import { els, getSelectedValues, setSelectedValues, selectOnlyTodos } from './core.js';
import { getSelectedCategories, setSelectedCategories } from './categories.js';

export function validarESerializar() {
  const nome = (els.inputNome?.value || '').trim();
  const grupo = els.selectGrupo?.value || '';
  const dur = Number(els.inputDuracao?.value);
  const custo = Number(els.inputCusto?.value);
  const valor = Number(els.inputValor?.value);

  const erros = [];
  if (!nome) erros.push('Informe o nome do serviço.');
  if (!grupo) erros.push('Selecione um grupo.');
  if (!Number.isInteger(dur) || dur < 1 || dur > 600) erros.push('Duração deve estar entre 1 e 600 minutos.');
  if (Number.isNaN(custo) || custo < 0) erros.push('Custo inválido.');
  if (Number.isNaN(valor) || valor < 0) erros.push('Valor inválido.');

  let portes = els.selectPorte ? getSelectedValues(els.selectPorte) : ['Todos'];
  if (portes.length === 0) portes = ['Todos'];
  if (portes.includes('Todos')) portes = ['Todos'];

  const categorias = getSelectedCategories();

  const payload = { nome, grupo, duracaoMinutos: dur, custo, valor, porte: portes, categorias };
  return { ok: erros.length === 0, erros, payload };
}

export function resetForm() {
  if (!els.form) return;
  els.inputId.value = '';
  els.inputNome.value = '';
  if (els.selectGrupo) els.selectGrupo.value = '';
  if (els.inputDuracao) els.inputDuracao.value = '30';
  if (els.inputCusto) els.inputCusto.value = '0';
  if (els.inputValor) els.inputValor.value = '0';
  if (els.selectPorte) selectOnlyTodos();
  setSelectedCategories([]);
  if (els.submitLabel) els.submitLabel.textContent = 'Salvar';
  els.btnCancelar?.classList.add('hidden');
}

export function fillForm(item) {
  if (!els.form || !item) return;
  els.inputId.value = item._id || '';
  els.inputNome.value = item.nome || '';
  if (els.selectGrupo) els.selectGrupo.value = item.grupo?._id || item.grupo || '';
  if (els.inputDuracao) els.inputDuracao.value = Number(item.duracaoMinutos || 0).toString();
  if (els.inputCusto) els.inputCusto.value = Number(item.custo || 0).toString();
  if (els.inputValor) els.inputValor.value = Number(item.valor || 0).toString();
  if (els.selectPorte) {
    const arr = Array.isArray(item.porte) ? item.porte : (item.porte ? [item.porte] : []);
    // Se vier "Todos" do backend, deixamos sem seleção (equivale a todos)
    const valores = arr.includes('Todos') ? [] : arr;
    setSelectedValues(els.selectPorte, valores);
  }
  setSelectedCategories(Array.isArray(item.categorias) ? item.categorias : []);
  if (els.submitLabel) els.submitLabel.textContent = 'Atualizar';
  els.btnCancelar?.classList.remove('hidden');
}
