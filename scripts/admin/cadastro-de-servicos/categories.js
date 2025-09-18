import { els } from './core.js';

export const SERVICE_CATEGORIES = [
  { id: 'tosa', label: 'Tosa', icon: 'fas fa-scissors' },
  { id: 'banho', label: 'Banho', icon: 'fas fa-bath' },
  { id: 'taxi_pet', label: 'Taxi Pet', icon: 'fas fa-taxi' },
  { id: 'internacao', label: 'Internação', icon: 'fas fa-hospital' },
  { id: 'hotel', label: 'Hotel', icon: 'fas fa-hotel' },
  { id: 'vacina', label: 'Vacina', icon: 'fas fa-syringe' },
  { id: 'day_care', label: 'Day Care', icon: 'fas fa-paw' },
  { id: 'outros', label: 'Outros', icon: 'fas fa-ellipsis-h' },
  { id: 'veterinario', label: 'Veterinário', icon: 'fas fa-stethoscope' },
  { id: 'exame', label: 'Exame', icon: 'fas fa-vial' },
  { id: 'banho_tosa', label: 'Banho & Tosa', icon: 'fas fa-brush' },
];

export const CATEGORY_MAP = Object.freeze(
  SERVICE_CATEGORIES.reduce((acc, cat) => {
    acc[cat.id] = cat;
    return acc;
  }, /** @type {Record<string, {id: string, label: string, icon: string}>} */ ({}))
);

let rendered = false;

function setButtonState(btn, active) {
  btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  btn.classList.toggle('bg-primary/10', active);
  btn.classList.toggle('border-primary', active);
  btn.classList.toggle('text-primary', active);
  btn.classList.toggle('shadow', active);
  btn.classList.toggle('bg-white', !active);
  btn.classList.toggle('border-gray-200', !active);
  btn.classList.toggle('text-gray-600', !active);
  btn.classList.toggle('shadow-sm', !active);
}

function handleClick(event) {
  const btn = event.target?.closest?.('button[data-cat-id]');
  if (!btn) return;
  event.preventDefault();
  const next = btn.getAttribute('aria-pressed') !== 'true';
  setButtonState(btn, next);
}

export function initCategoriesBar() {
  const container = els.categoriesBar;
  if (!container || rendered) return;

  container.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (const cat of SERVICE_CATEGORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.catId = cat.id;
    btn.className = 'category-pill inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition hover:border-primary/50 hover:text-primary/80 focus:outline-none focus:ring-2 focus:ring-primary/40 bg-white border-gray-200 text-gray-600 shadow-sm';
    btn.innerHTML = `<i class="${cat.icon} text-base"></i><span>${cat.label}</span>`;
    setButtonState(btn, false);
    fragment.appendChild(btn);
  }

  container.appendChild(fragment);
  container.addEventListener('click', handleClick);
  rendered = true;
}

export function getSelectedCategories() {
  const container = els.categoriesBar;
  if (!container) return [];
  return Array.from(container.querySelectorAll('button[data-cat-id][aria-pressed="true"]'))
    .map((btn) => btn.dataset.catId)
    .filter(Boolean);
}

export function setSelectedCategories(ids = []) {
  const container = els.categoriesBar;
  if (!container) return;
  if (!rendered) initCategoriesBar();
  const set = new Set(ids);
  container.querySelectorAll('button[data-cat-id]').forEach((btn) => {
    const isActive = set.has(btn.dataset.catId);
    setButtonState(btn, isActive);
  });
}

