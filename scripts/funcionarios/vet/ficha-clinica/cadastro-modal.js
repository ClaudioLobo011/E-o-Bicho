import { api, notify, state, els, normalizeId, pickFirst } from './core.js';
import { onSelectCliente, onSelectPet } from './tutor.js';

const modalState = {
  mounted: false,
  tab: 'cliente',
  selectedCliente: null,
  selectedPet: null,
  selectedAddress: null,
  clienteId: '',
  petId: '',
  addressId: '',
  addresses: [],
  pets: [],
  searchQuery: '',
  searchResults: [],
  searchLoading: false,
  searchTimer: null,
  searchAbort: null,
  saving: false,
  registerMode: false,
  phoneLookupTimer: null,
  codeLookupTimer: null,
  lastPhoneLookup: '',
  lastCodeLookup: '',
  petSpeciesMap: null,
  petSpeciesMapPromise: null,
  petBreedOptions: [],
};

const refs = {};

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function d(v) { return String(v || '').replace(/\D/g, ''); }
function getIMaskLib() {
  return typeof window !== 'undefined' ? window.IMask : (typeof IMask !== 'undefined' ? IMask : undefined);
}
function buildPhoneMaskOptions() {
  return {
    mask: [
      { mask: '0000-0000' },
      { mask: '00000-0000' },
    ],
  };
}
function buildCpfCnpjMaskOptions() {
  const IM = getIMaskLib();
  if (!IM) return { mask: '000.000.000-00' };
  return {
    mask: [
      { mask: '000.000.000-00' },
      { mask: '00.000.000/0000-00' },
    ],
    dispatch(appended, dynamicMasked) {
      const value = (dynamicMasked.value + appended).replace(/\D/g, '');
      return dynamicMasked.compiledMasks[value.length > 11 ? 1 : 0];
    },
  };
}
function registerMask(key, element, options) {
  const IM = getIMaskLib();
  if (!IM || !element) return null;
  refs.masks = refs.masks || {};
  if (refs.masks[key]) {
    try { refs.masks[key].destroy(); } catch {}
  }
  refs.masks[key] = IM(element, { ...options });
  return refs.masks[key];
}
function setMaskedValue(key, value, opts = {}) {
  const { unmasked = false } = opts;
  const text = value == null ? '' : String(value);
  const mask = refs.masks?.[key];
  if (!mask) return false;
  try {
    if (unmasked) mask.unmaskedValue = d(text);
    else mask.value = text;
    return true;
  } catch {
    try {
      mask.value = text;
      return true;
    } catch {
      return false;
    }
  }
}
function setFieldValue(fieldOrElement, value, opts = {}) {
  const element = typeof fieldOrElement === 'string' ? refs[fieldOrElement] : fieldOrElement;
  if (!element) return;
  const text = value == null ? '' : String(value);
  const maskKey = opts.maskKey || element.dataset.maskKey || '';
  if (maskKey && setMaskedValue(maskKey, text, opts)) return;
  element.value = text;
}
function initInputMasks() {
  const IM = getIMaskLib();
  if (!IM) return;
  registerMask('topDdd', refs.topDdd, { mask: '00' });
  registerMask('topNum', refs.topNum, buildPhoneMaskOptions());
  registerMask('doc', refs.c?.doc, buildCpfCnpjMaskOptions());
  registerMask('cep', refs.c?.cep, { mask: '00000-000' });
  registerMask('fone1Ddd', refs.c?.f1ddd, { mask: '00' });
  registerMask('fone1Num', refs.c?.f1num, buildPhoneMaskOptions());
  registerMask('fone2Ddd', refs.c?.f2ddd, { mask: '00' });
  registerMask('fone2Num', refs.c?.f2num, buildPhoneMaskOptions());
}
function fmtDate(v) {
  if (!v) return '';
  const dt = new Date(v);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString().slice(0, 10);
}
function splitPhone(v) {
  const x = d(v);
  if (x.length >= 10) return { ddd: x.slice(0, 2), num: x.slice(2) };
  return { ddd: '', num: x };
}
function joinPhone(ddd, num) {
  const x = `${d(ddd).slice(0, 2)}${d(num).slice(0, 9)}`;
  return x.length >= 10 ? x : '';
}
async function readErr(resp, fallback) {
  const data = await resp.json().catch(() => ({}));
  return data?.message || fallback;
}
function q(id) { return refs.root?.querySelector(`#${id}`) || null; }

function ensureMounted() {
  if (modalState.mounted) return;
  const root = document.createElement('div');
  root.id = 'vet-ficha-cadastro-modal-root';
  root.innerHTML = `
<div id="vet-ficha-cad-modal" class="fixed inset-0 z-[60] hidden" aria-hidden="true">
  <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" data-vet-ficha-cad-dismiss="backdrop"></div>
  <div class="relative mx-auto flex min-h-full w-full items-start justify-center px-3 py-6 sm:items-center">
    <div class="relative flex w-full max-w-[1352px] min-h-0 transform-gpu flex-col overflow-hidden rounded-2xl bg-white text-[12px] leading-[1.35] shadow-2xl transition-all duration-200 ease-out" style="height:90vh; min-height:90vh; max-height:90vh;">
      <div class="flex items-center justify-between bg-primary px-4 py-2">
        <h2 class="text-[11px] font-semibold uppercase tracking-wide text-white">FICHA CLINICA</h2>
        <button type="button" id="vet-ficha-cad-close" class="inline-flex h-8 w-8 items-center justify-center rounded text-white transition hover:bg-white/20" aria-label="Fechar modal">
          <i class="fas fa-times text-2xl"></i>
        </button>
      </div>

      <div class="flex-1 overflow-y-auto bg-gray-100 px-4 py-4">
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div class="lg:col-span-3">
            <label for="vet-ficha-cad-top-ddd" class="block text-[11px] font-semibold text-gray-700">Telefone:</label>
            <div class="mt-1 flex gap-2">
              <input id="vet-ficha-cad-top-ddd" type="text" maxlength="2" value="21" class="w-12 rounded-md border border-gray-300 bg-white px-2 py-2 text-[12px] text-gray-700">
              <input id="vet-ficha-cad-top-num" type="text" class="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-700" placeholder="-">
            </div>
          </div>
          <div class="lg:col-span-4">
            <label for="vet-ficha-cad-search-trigger" class="block text-[11px] font-semibold text-gray-700">Procurar Cliente (F2):</label>
            <input id="vet-ficha-cad-search-trigger" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-700" placeholder="Digite codigo, CPF/CNPJ ou nome">
          </div>
          <div class="lg:col-span-5">
            <div class="mt-6 flex flex-wrap items-center justify-center gap-8 lg:gap-16">
              <button type="button" id="vet-ficha-cad-btn-register" class="inline-flex items-center gap-2 text-[12px] text-gray-700 transition hover:text-primary">
                <i class="far fa-user text-sky-400"></i><span>Cadastrar Cliente</span>
              </button>
              <button type="button" id="vet-ficha-cad-btn-change" class="inline-flex items-center gap-2 text-[12px] text-gray-700 transition hover:text-primary">
                <i class="fas fa-right-left text-gray-500"></i><span>Alterar Cliente</span>
              </button>
            </div>
          </div>
        </div>

        <div class="mt-3 inline-flex overflow-hidden rounded-sm border border-gray-300 text-[12px] font-semibold uppercase leading-none">
          <button type="button" id="vet-ficha-cad-tab-btn-cliente" class="bg-primary px-4 py-2 text-white">Cliente</button>
          <button type="button" id="vet-ficha-cad-tab-btn-pet" class="bg-gray-200 px-4 py-2 text-gray-500">Pet</button>
        </div>

        <div id="vet-ficha-cad-tab-cliente" class="mt-0">
          <form id="vet-ficha-cad-cliente-form" class="grid grid-cols-1 gap-2 rounded-b-sm border border-gray-300 bg-gray-100 px-2 py-2 md:grid-cols-12">
            <div class="md:col-span-12">
              <p class="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-primary">
                <i class="far fa-user text-primary"></i><span>Informacoes do cliente</span>
              </p>
            </div>
            <div class="md:col-span-6">
              <label for="vet-ficha-cad-nome" class="block text-[11px] font-semibold text-gray-800">Nome:</label>
              <input id="vet-ficha-cad-nome" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]">
            </div>
            <div class="md:col-span-6">
              <label for="vet-ficha-cad-doc" class="block text-[11px] font-semibold text-gray-800">CPF/CNPJ:</label>
              <input id="vet-ficha-cad-doc" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]">
            </div>
            <div class="md:col-span-3">
              <label for="vet-ficha-cad-sexo" class="block text-[11px] font-semibold text-gray-800">Sexo:</label>
              <select id="vet-ficha-cad-sexo" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-700">
                <option value=""></option><option value="M">Masculino</option><option value="F">Feminino</option>
              </select>
            </div>
            <div class="md:col-span-3">
              <label for="vet-ficha-cad-nasc" class="block text-[11px] font-semibold text-gray-800">Data de Nascimento:</label>
              <input id="vet-ficha-cad-nasc" type="date" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-700">
            </div>
            <div class="md:col-span-6">
              <label for="vet-ficha-cad-email" class="block text-[11px] font-semibold text-gray-800">Email:</label>
              <input id="vet-ficha-cad-email" type="email" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-700">
            </div>
            <div class="md:col-span-12">
              <label for="vet-ficha-cad-logradouro" class="block text-[11px] font-semibold text-gray-800">Endereco:</label>
              <input id="vet-ficha-cad-logradouro" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]">
            </div>
            <div class="md:col-span-2">
              <label for="vet-ficha-cad-numero" class="block text-[11px] font-semibold text-gray-800">Numero:</label>
              <input id="vet-ficha-cad-numero" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]">
            </div>
            <div class="md:col-span-2">
              <label for="vet-ficha-cad-cep" class="block text-[11px] font-semibold text-gray-800">Cep:</label>
              <input id="vet-ficha-cad-cep" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]">
            </div>
            <div class="md:col-span-8">
              <label for="vet-ficha-cad-bairro" class="block text-[11px] font-semibold text-gray-800">Bairro:</label>
              <input id="vet-ficha-cad-bairro" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]">
            </div>
            <div class="md:col-span-4">
              <label for="vet-ficha-cad-cidade" class="block text-[11px] font-semibold text-gray-800">Cidade:</label>
              <input id="vet-ficha-cad-cidade" type="text" value="RIO DE JANEIRO" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]">
            </div>
            <div class="md:col-span-4">
              <label for="vet-ficha-cad-obs" class="block text-[11px] font-semibold text-gray-800">Observacao:</label>
              <input id="vet-ficha-cad-obs" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]">
            </div>
            <div class="md:col-span-4">
              <label for="vet-ficha-cad-complemento" class="block text-[11px] font-semibold text-gray-800">Complemento:</label>
              <input id="vet-ficha-cad-complemento" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]">
            </div>
            <div class="md:col-span-3">
              <label for="vet-ficha-cad-fone1-ddd" class="block text-[11px] font-semibold text-gray-800">Telefone 1:</label>
              <div class="mt-1 flex gap-2">
                <input id="vet-ficha-cad-fone1-ddd" type="text" maxlength="2" value="21" class="w-12 rounded-md border border-gray-300 bg-white px-2 py-2 text-[12px]">
                <input id="vet-ficha-cad-fone1-num" type="text" class="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]" placeholder="-">
              </div>
            </div>
            <div class="md:col-span-3">
              <label for="vet-ficha-cad-fone2-ddd" class="block text-[11px] font-semibold text-gray-800">Telefone 2:</label>
              <div class="mt-1 flex gap-2">
                <input id="vet-ficha-cad-fone2-ddd" type="text" maxlength="2" value="21" class="w-12 rounded-md border border-gray-300 bg-white px-2 py-2 text-[12px]">
                <input id="vet-ficha-cad-fone2-num" type="text" class="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]" placeholder="-">
              </div>
            </div>
            <div id="vet-ficha-cad-save-wrap-cliente" class="md:col-span-6 hidden items-end justify-end">
              <button type="button" id="vet-ficha-cad-saveall-cliente" class="rounded-lg bg-primary px-6 py-2 text-sm font-semibold text-white transition hover:bg-secondary">Gravar</button>
            </div>
            <div class="hidden">
              <input id="vet-ficha-cad-uf" type="text" value="RJ"><input id="vet-ficha-cad-ibge" type="text"><input id="vet-ficha-cad-coduf" type="text"><input id="vet-ficha-cad-pais" type="text" value="Brasil">
            </div>
            <button type="submit" class="hidden">Salvar</button>
          </form>
          <div class="mt-2 rounded-sm border border-gray-300 bg-gray-100 p-2">
            <p class="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-primary"><i class="far fa-map text-primary"></i><span>Enderecos do cliente</span></p>
            <div id="vet-ficha-cad-address-empty" class="mb-2 rounded border border-dashed border-gray-300 bg-white px-3 py-2 text-[11px] text-gray-500">Selecione um cliente para visualizar os enderecos.</div>
            <div id="vet-ficha-cad-address-list" class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"></div>
          </div>
        </div>
        <div id="vet-ficha-cad-tab-pet" class="mt-0 hidden rounded-b-sm border border-gray-300 bg-gray-100 p-2">
          <div class="mb-1">
            <p class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-primary"><i class="fas fa-paw text-primary"></i><span>Pet</span></p>
          </div>
          <div class="grid grid-cols-1 gap-2 md:grid-cols-12">
            <div class="md:col-span-4"><label for="vet-ficha-cad-pet-nome" class="block text-[11px] font-semibold text-gray-800">Nome do Pet:</label><input id="vet-ficha-cad-pet-nome" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]"></div>
            <div class="md:col-span-2"><label for="vet-ficha-cad-pet-tipo" class="block text-[11px] font-semibold text-gray-800">Tipo:</label><select id="vet-ficha-cad-pet-tipo" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-700"><option value=""></option><option value="cachorro">Cachorro</option><option value="gato">Gato</option><option value="passaro">Passaro</option><option value="peixe">Peixe</option><option value="roedor">Roedor</option><option value="lagarto">Lagarto</option><option value="tartaruga">Tartaruga</option></select></div>
            <div class="md:col-span-2"><label for="vet-ficha-cad-pet-sexo" class="block text-[11px] font-semibold text-gray-800">Sexo:</label><select id="vet-ficha-cad-pet-sexo" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]"><option value=""></option><option value="M">Macho</option><option value="F">Femea</option></select></div>
            <div class="md:col-span-2"><label for="vet-ficha-cad-pet-porte" class="block text-[11px] font-semibold text-gray-800">Porte:</label><select id="vet-ficha-cad-pet-porte" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-700"><option value="">Sem porte definido</option><option value="mini">Mini</option><option value="pequeno">Pequeno</option><option value="medio">Medio</option><option value="grande">Grande</option><option value="gigante">Gigante</option></select></div>
            <div class="md:col-span-2"><label for="vet-ficha-cad-pet-peso" class="block text-[11px] font-semibold text-gray-800">Peso:</label><input id="vet-ficha-cad-pet-peso" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]"></div>
          </div>
          <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-12">
            <div class="md:col-span-4"><label for="vet-ficha-cad-pet-raca" class="block text-[11px] font-semibold text-gray-800">Raca:</label><div class="relative mt-1"><input id="vet-ficha-cad-pet-raca" type="text" class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px] text-gray-700" autocomplete="off"><div id="vet-ficha-cad-pet-raca-suggest" class="absolute z-30 mt-1 hidden max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg"></div></div></div>
            <div class="md:col-span-3"><label for="vet-ficha-cad-pet-nasc" class="block text-[11px] font-semibold text-gray-800">Data de Nascimento:</label><input id="vet-ficha-cad-pet-nasc" type="date" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]"></div>
            <div class="md:col-span-3"><label for="vet-ficha-cad-pet-cor" class="block text-[11px] font-semibold text-gray-800">Pelagem/Cor:</label><input id="vet-ficha-cad-pet-cor" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]"></div>
            <div class="md:col-span-2"><label for="vet-ficha-cad-pet-cod-ant" class="block text-[11px] font-semibold text-gray-800">Cod. Antigo:</label><input id="vet-ficha-cad-pet-cod-ant" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]"></div>
          </div>
          <div class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-12">
            <div class="md:col-span-4"><label for="vet-ficha-cad-pet-microchip" class="block text-[11px] font-semibold text-gray-800">Microchip:</label><input id="vet-ficha-cad-pet-microchip" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]"></div>
            <div class="md:col-span-3"><label for="vet-ficha-cad-pet-rga" class="block text-[11px] font-semibold text-gray-800">RGA:</label><input id="vet-ficha-cad-pet-rga" type="text" class="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-[12px]"></div>
            <div class="md:col-span-2"><label class="block text-[11px] font-semibold text-gray-800">&nbsp;</label><label class="mt-2 inline-flex items-center gap-2 text-[12px] text-gray-700"><input id="vet-ficha-cad-pet-castrado" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"><span>Castrado</span></label></div>
            <div class="md:col-span-2"><label class="block text-[11px] font-semibold text-gray-800">&nbsp;</label><label class="mt-2 inline-flex items-center gap-2 text-[12px] text-gray-700"><input id="vet-ficha-cad-pet-obito" type="checkbox" class="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary/30"><span>Obito</span></label></div>
            <div id="vet-ficha-cad-save-wrap-pet" class="md:col-span-1 hidden"><label class="block text-[11px] font-semibold text-gray-800">&nbsp;</label><button type="button" id="vet-ficha-cad-saveall-pet" class="mt-1 w-full rounded-md bg-primary px-2 py-2 text-[12px] font-semibold text-white transition hover:bg-secondary">Gravar</button></div>
          </div>
          <div class="mt-2">
            <p class="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-primary"><i class="far fa-clock text-primary"></i><span>Pets do cliente</span></p>
            <div id="vet-ficha-cad-pets-empty" class="rounded border border-dashed border-gray-300 bg-white px-3 py-2 text-[11px] text-gray-500">Selecione um cliente para visualizar os pets.</div>
            <div id="vet-ficha-cad-pets-list" class="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2"></div>
          </div>
        </div>
      </div>

      <div id="vet-ficha-cad-footer-cliente" class="shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-3">
        <div class="mb-2 flex items-center justify-between rounded bg-gray-700 px-3 py-1 text-[11px] text-white">
          <span id="vet-ficha-cad-status-cliente">Cliente: Nenhum</span>
          <span id="vet-ficha-cad-status-pet">Pet: Nenhum</span>
          <span id="vet-ficha-cad-status-aba">Aba: Cliente</span>
        </div>
        <div class="flex items-center justify-end gap-2">
          <button type="button" id="vet-ficha-cad-confirm-cliente" class="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700">Confirmar (F5)</button>
          <button type="button" id="vet-ficha-cad-cancel-cliente" class="rounded-lg border border-rose-900 bg-red-700 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-800">Cancelar</button>
        </div>
      </div>
      <div id="vet-ficha-cad-footer-pet" class="hidden shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-3">
        <div class="mb-2 flex items-center justify-between rounded bg-gray-700 px-3 py-1 text-[11px] text-white">
          <span id="vet-ficha-cad-status-cliente-2">Cliente: Nenhum</span>
          <span id="vet-ficha-cad-status-pet-2">Pet: Nenhum</span>
          <span id="vet-ficha-cad-status-aba-2">Aba: Pet</span>
        </div>
        <div class="flex items-center justify-end gap-2">
          <button type="button" id="vet-ficha-cad-confirm-pet" class="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700">Confirmar (F5)</button>
          <button type="button" id="vet-ficha-cad-cancel-pet" class="rounded-lg border border-rose-900 bg-red-700 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-800">Cancelar</button>
        </div>
      </div>
    </div>
  </div>
</div>

<div id="vet-ficha-cad-search-modal" class="fixed inset-0 z-[99999] hidden" aria-hidden="true" style="z-index:100010;">
  <div class="absolute inset-0 bg-slate-900/60" data-vet-ficha-cad-search-dismiss="backdrop"></div>
  <div class="relative mx-auto flex min-h-full w-full items-start justify-center px-3 py-6 sm:items-center">
    <div class="relative z-[100000] flex w-full max-w-[1352px] min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-[12px] leading-[1.35] shadow-2xl" style="z-index:100011; height:90vh; min-height:90vh; max-height:90vh;">
      <div class="flex items-center justify-between rounded-t-2xl bg-gray-600 px-4 py-3 text-white">
        <h3 class="text-sm font-semibold">Procurar cliente</h3>
        <button type="button" id="vet-ficha-cad-search-close" class="rounded-full p-1 text-gray-800 transition hover:bg-black/5 hover:text-gray-900" aria-label="Fechar busca de cliente"><i class="fas fa-times"></i></button>
      </div>
      <div class="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div class="flex flex-col gap-2 md:flex-row md:items-center">
          <div class="relative flex-1"><span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><i class="fas fa-search"></i></span><input id="vet-ficha-cad-search-input" type="text" class="w-full rounded-lg border border-gray-200 px-3 py-2 pl-9 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="Digite codigo, CPF/CNPJ ou nome"></div>
          <button type="button" id="vet-ficha-cad-search-btn" class="rounded-lg border border-gray-200 bg-gray-50 px-5 py-2 text-sm font-semibold text-gray-700 transition hover:border-primary hover:text-primary">Buscar</button>
        </div>
        <div class="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"><tr><th class="px-3 py-2">Codigo</th><th class="px-3 py-2">Nome</th><th class="px-3 py-2">CPF/CNPJ</th><th class="px-3 py-2">Endereco</th></tr></thead>
            <tbody id="vet-ficha-cad-search-results" class="divide-y divide-gray-100"></tbody>
          </table>
          <div id="vet-ficha-cad-search-empty" class="px-3 py-6 text-center text-sm text-gray-500">Digite para pesquisar clientes.</div>
        </div>
      </div>
    </div>
  </div>
</div>
`;
  document.body.appendChild(root);
  refs.root = root;
  refs.modal = q('vet-ficha-cad-modal');
  refs.searchModal = q('vet-ficha-cad-search-modal');
}

function mapRefs() {
  refs.close = q('vet-ficha-cad-close');
  refs.tabBtnCliente = q('vet-ficha-cad-tab-btn-cliente');
  refs.tabBtnPet = q('vet-ficha-cad-tab-btn-pet');
  refs.tabCliente = q('vet-ficha-cad-tab-cliente');
  refs.tabPet = q('vet-ficha-cad-tab-pet');
  refs.footerCliente = q('vet-ficha-cad-footer-cliente');
  refs.footerPet = q('vet-ficha-cad-footer-pet');
  refs.status = [q('vet-ficha-cad-status-cliente'), q('vet-ficha-cad-status-pet'), q('vet-ficha-cad-status-aba'), q('vet-ficha-cad-status-cliente-2'), q('vet-ficha-cad-status-pet-2'), q('vet-ficha-cad-status-aba-2')];
  refs.topDdd = q('vet-ficha-cad-top-ddd'); refs.topNum = q('vet-ficha-cad-top-num'); refs.searchTrigger = q('vet-ficha-cad-search-trigger');
  refs.btnRegister = q('vet-ficha-cad-btn-register'); refs.btnChange = q('vet-ficha-cad-btn-change');
  refs.confirmBtns = [q('vet-ficha-cad-confirm-cliente'), q('vet-ficha-cad-confirm-pet')];
  refs.saveAllBtns = [q('vet-ficha-cad-saveall-cliente'), q('vet-ficha-cad-saveall-pet')];
  refs.saveClienteWrap = q('vet-ficha-cad-save-wrap-cliente');
  refs.savePetWrap = q('vet-ficha-cad-save-wrap-pet');
  refs.cancelBtns = [q('vet-ficha-cad-cancel-cliente'), q('vet-ficha-cad-cancel-pet')];
  refs.addrList = q('vet-ficha-cad-address-list'); refs.addrEmpty = q('vet-ficha-cad-address-empty');
  refs.petsList = q('vet-ficha-cad-pets-list'); refs.petsEmpty = q('vet-ficha-cad-pets-empty');
  refs.searchClose = q('vet-ficha-cad-search-close'); refs.searchInput = q('vet-ficha-cad-search-input'); refs.searchBtn = q('vet-ficha-cad-search-btn'); refs.searchResults = q('vet-ficha-cad-search-results'); refs.searchEmpty = q('vet-ficha-cad-search-empty');
  refs.clienteForm = q('vet-ficha-cad-cliente-form');
  refs.c = {
    nome: q('vet-ficha-cad-nome'), doc: q('vet-ficha-cad-doc'), sexo: q('vet-ficha-cad-sexo'), nasc: q('vet-ficha-cad-nasc'), email: q('vet-ficha-cad-email'),
    logradouro: q('vet-ficha-cad-logradouro'), numero: q('vet-ficha-cad-numero'), cep: q('vet-ficha-cad-cep'), bairro: q('vet-ficha-cad-bairro'), cidade: q('vet-ficha-cad-cidade'), obs: q('vet-ficha-cad-obs'), complemento: q('vet-ficha-cad-complemento'),
    f1ddd: q('vet-ficha-cad-fone1-ddd'), f1num: q('vet-ficha-cad-fone1-num'), f2ddd: q('vet-ficha-cad-fone2-ddd'), f2num: q('vet-ficha-cad-fone2-num'), tipoConta: q('vet-ficha-cad-tipo-conta'), endDefault: q('vet-ficha-cad-end-default'), uf: q('vet-ficha-cad-uf'), ibge: q('vet-ficha-cad-ibge'), coduf: q('vet-ficha-cad-coduf'), pais: q('vet-ficha-cad-pais')
  };
  refs.p = { nome:q('vet-ficha-cad-pet-nome'), tipo:q('vet-ficha-cad-pet-tipo'), sexo:q('vet-ficha-cad-pet-sexo'), porte:q('vet-ficha-cad-pet-porte'), peso:q('vet-ficha-cad-pet-peso'), raca:q('vet-ficha-cad-pet-raca'), nasc:q('vet-ficha-cad-pet-nasc'), cor:q('vet-ficha-cad-pet-cor'), codAnt:q('vet-ficha-cad-pet-cod-ant'), microchip:q('vet-ficha-cad-pet-microchip'), rga:q('vet-ficha-cad-pet-rga'), castrado:q('vet-ficha-cad-pet-castrado'), obito:q('vet-ficha-cad-pet-obito') };
  refs.petRacaSuggest = q('vet-ficha-cad-pet-raca-suggest');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizePorteLabel(value) {
  const key = normalizeText(value);
  if (key.startsWith('mini')) return 'mini';
  if (key.startsWith('peq')) return 'pequeno';
  if (key.startsWith('med')) return 'medio';
  if (key.startsWith('gra')) return 'grande';
  if (key.startsWith('gig')) return 'gigante';
  return '';
}

function fixEncoding(value) {
  if (value == null) return value;
  const text = String(value);
  try {
    if (typeof escape === 'function') return decodeURIComponent(escape(text));
  } catch {
    return text;
  }
  return text;
}

function setDatalistOptions(datalist, values) {
  if (!datalist) return;
  const list = Array.from(new Set((values || []).map((v) => String(v || '').trim()).filter(Boolean)));
  datalist.innerHTML = list.map((item) => `<option value="${esc(item)}"></option>`).join('');
}

function closePetBreedSuggestions() {
  refs.petRacaSuggest?.classList.add('hidden');
}

function renderPetBreedSuggestions() {
  const box = refs.petRacaSuggest;
  const input = refs.p?.raca;
  if (!box || !input) return;
  const all = Array.isArray(modalState.petBreedOptions) ? modalState.petBreedOptions : [];
  const query = normalizeText(input.value);
  const filtered = (query
    ? all.filter((item) => normalizeText(item).includes(query))
    : all
  ).slice(0, 80);
  if (!filtered.length) {
    box.innerHTML = '';
    box.classList.add('hidden');
    return;
  }
  box.innerHTML = filtered
    .map((item) => `<button type="button" data-vet-ficha-cad-breed-option="${esc(item)}" class="block w-full border-b border-gray-100 px-3 py-2 text-left text-[12px] text-gray-700 hover:bg-primary/5 last:border-b-0">${esc(item)}</button>`)
    .join('');
  box.classList.remove('hidden');
}

function setSelectOptions(select, values, { includeEmpty = true, emptyLabel = '' } = {}) {
  if (!select) return;
  const current = String(select.value || '');
  const normalizedCurrent = normalizeText(current);
  const unique = Array.from(new Set((values || []).map((v) => String(v || '').trim()).filter(Boolean)));
  const options = [];
  if (includeEmpty) {
    options.push(`<option value="">${esc(emptyLabel)}</option>`);
  }
  unique.forEach((item) => {
    options.push(`<option value="${esc(item)}">${esc(item)}</option>`);
  });
  select.innerHTML = options.join('');
  if (current) {
    setSelectLikeValue(select, current);
  } else if (normalizedCurrent) {
    setSelectLikeValue(select, normalizedCurrent);
  }
}

function setSelectLikeValue(select, value) {
  if (!select) return;
  const raw = String(value || '');
  const normalized = normalizeText(raw);
  const options = Array.from(select.options || []);
  const exact = options.find((opt) => String(opt.value || '') === raw);
  if (select.tagName !== 'SELECT') {
    select.value = raw;
    return;
  }
  if (exact) { select.value = exact.value; return; }
  const byValue = options.find((opt) => normalizeText(opt.value || '') === normalized);
  if (byValue) { select.value = byValue.value; return; }
  const byText = options.find((opt) => normalizeText(opt.textContent || '') === normalized);
  if (byText) { select.value = byText.value || byText.textContent || ''; return; }
  if (raw) {
    const opt = document.createElement('option');
    opt.value = raw;
    opt.textContent = raw;
    select.appendChild(opt);
    select.value = raw;
    return;
  }
  select.value = '';
}

async function loadPetSpeciesMap() {
  if (modalState.petSpeciesMap) return modalState.petSpeciesMap;
  if (modalState.petSpeciesMapPromise) return modalState.petSpeciesMapPromise;

  const base = window.basePath || '../../';
  const jsonUrl = `${base}data/racas.json`;
  const legacyUrl = `${base}data/Racas-leitura.js`;

  const cleanList = (body) => String(body || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && line !== '...')
    .map((line) => line.replace(/\*.*?\*/g, ''))
    .map((line) => line.replace(/\s*\(duplicata.*$/i, ''))
    .map((line) => line.replace(/\s*[â€”-].*$/, '').replace(/\s*-\s*registro.*$/i, ''));

  const buildFromJson = (payload) => {
    const species = {};
    const dogPayload = payload?.cachorro || {};
    const portes = dogPayload.portes || {};
    const dogMap = {
      mini: Array.from(new Set(portes.mini || [])),
      pequeno: Array.from(new Set(portes.pequeno || [])),
      medio: Array.from(new Set(portes.medio || [])),
      grande: Array.from(new Set(portes.grande || [])),
      gigante: Array.from(new Set(portes.gigante || [])),
    };
    const dogAll = Array.from(new Set([
      ...(Array.isArray(dogPayload.all) ? dogPayload.all : []),
      ...dogMap.mini, ...dogMap.pequeno, ...dogMap.medio, ...dogMap.grande, ...dogMap.gigante,
    ]));
    const dogLookup = {};
    const dogMapPayload = dogPayload.map || {};
    dogAll.forEach((nome) => {
      const normalized = normalizeText(nome);
      const porte = dogMapPayload[normalized] || dogMapPayload[nome]
        || (dogMap.mini.includes(nome) ? 'mini'
          : dogMap.pequeno.includes(nome) ? 'pequeno'
            : dogMap.medio.includes(nome) ? 'medio'
              : dogMap.grande.includes(nome) ? 'grande'
                : 'gigante');
      dogLookup[normalized] = porte;
    });
    species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };
    ['gato', 'passaro', 'peixe', 'roedor', 'lagarto', 'tartaruga'].forEach((tipo) => {
      species[tipo] = Array.from(new Set(Array.isArray(payload?.[tipo]) ? payload[tipo] : []));
    });
    return species;
  };

  const buildFromLegacy = (text) => {
    const species = {};
    const dogMap = { mini: [], pequeno: [], medio: [], grande: [], gigante: [] };
    const reDogGlobal = /porte[_\s-]?(mini|pequeno|medio|grande|gigante)\s*{([\s\S]*?)}\s*/gi;
    let match;
    while ((match = reDogGlobal.exec(text))) {
      dogMap[String(match[1]).toLowerCase()] = Array.from(new Set(cleanList(match[2])));
    }
    const dogAll = Array.from(new Set([...dogMap.mini, ...dogMap.pequeno, ...dogMap.medio, ...dogMap.grande, ...dogMap.gigante]));
    const dogLookup = {};
    dogAll.forEach((nome) => {
      const normalized = normalizeText(nome);
      dogLookup[normalized] = dogMap.mini.includes(nome) ? 'mini'
        : dogMap.pequeno.includes(nome) ? 'pequeno'
          : dogMap.medio.includes(nome) ? 'medio'
            : dogMap.grande.includes(nome) ? 'grande'
              : 'gigante';
    });
    species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };
    const simpleSpecies = ['gatos', 'gato', 'passaros', 'passaro', 'peixes', 'peixe', 'roedores', 'roedor', 'lagartos', 'lagarto', 'tartarugas', 'tartaruga'];
    simpleSpecies.forEach((sp) => {
      const result = new RegExp(`${sp}\\s*{([\\s\\S]*?)}`, 'i').exec(text);
      if (!result) return;
      const list = cleanList(result[1]);
      const singular = /roedores$/i.test(sp) ? 'roedor'
        : /gatos$/i.test(sp) ? 'gato'
          : /passaros$/i.test(sp) ? 'passaro'
            : /peixes$/i.test(sp) ? 'peixe'
              : /lagartos$/i.test(sp) ? 'lagarto'
                : /tartarugas$/i.test(sp) ? 'tartaruga'
                  : sp.replace(/s$/, '');
      species[singular] = Array.from(new Set(list));
    });
    return species;
  };

  modalState.petSpeciesMapPromise = (async () => {
    try {
      const response = await fetch(jsonUrl, { headers: { Accept: 'application/json' } });
      if (response.ok) {
        modalState.petSpeciesMap = buildFromJson(await response.json());
        return modalState.petSpeciesMap;
      }
    } catch {}
    try {
      const response = await fetch(legacyUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      modalState.petSpeciesMap = buildFromLegacy(text);
      return modalState.petSpeciesMap;
    } catch {
      modalState.petSpeciesMap = null;
      return null;
    } finally {
      modalState.petSpeciesMapPromise = null;
    }
  })();

  return modalState.petSpeciesMapPromise;
}

function ensurePetFixedOptions() {
  // Tipo e porte agora usam select (mais consistente com outras telas)
  if (refs.p?.tipo) setSelectLikeValue(refs.p.tipo, refs.p.tipo.value || '');
  if (refs.p?.porte) setSelectLikeValue(refs.p.porte, refs.p.porte.value || '');
}

function inferPetTypeFromBreed(breedValue) {
  const speciesMap = modalState.petSpeciesMap;
  const breedKey = normalizeText(breedValue);
  if (!speciesMap || !breedKey) return '';
  const dogBreeds = speciesMap?.cachorro?.all || [];
  if (dogBreeds.some((item) => normalizeText(item) === breedKey)) return 'cachorro';
  for (const type of ['gato', 'passaro', 'peixe', 'roedor', 'lagarto', 'tartaruga']) {
    const list = speciesMap?.[type] || [];
    if (list.some((item) => normalizeText(item) === breedKey)) return type;
  }
  return '';
}

function setPorteFromBreedIfDog() {
  const tipoInput = refs.p?.tipo;
  const racaInput = refs.p?.raca;
  const porteInput = refs.p?.porte;
  if (!tipoInput || !racaInput || !porteInput) return;
  if (normalizeText(tipoInput.value) !== 'cachorro') return;
  const map = modalState.petSpeciesMap?.cachorro?.map;
  if (!map) return;
  const desired = map[normalizeText(racaInput.value)] || '';
  if (!desired) return;
  setSelectLikeValue(porteInput, normalizePorteLabel(desired) || desired);
}

async function refreshPetBreedOptions() {
  ensurePetFixedOptions();
  await loadPetSpeciesMap().catch(() => {});
  const tipo = normalizeText(refs.p?.tipo?.value);
  const speciesMap = modalState.petSpeciesMap;
  if (!refs.p?.raca || !speciesMap) return;
  let breeds = [];
  if (tipo === 'cachorro') breeds = (speciesMap?.cachorro?.all || []).slice();
  else if (tipo === 'gato') breeds = (speciesMap?.gato || speciesMap?.gatos || []).slice();
  else if (tipo === 'passaro') breeds = (speciesMap?.passaro || speciesMap?.passaros || []).slice();
  else if (['peixe', 'roedor', 'lagarto', 'tartaruga'].includes(tipo)) breeds = (speciesMap?.[tipo] || []).slice();
  else {
    breeds = Array.from(new Set([
      ...(speciesMap?.cachorro?.all || []),
      ...(speciesMap?.gato || speciesMap?.gatos || []),
      ...(speciesMap?.passaro || speciesMap?.passaros || []),
      ...(speciesMap?.peixe || []),
      ...(speciesMap?.roedor || []),
      ...(speciesMap?.lagarto || []),
      ...(speciesMap?.tartaruga || []),
    ]));
  }
  breeds = breeds.map((item) => fixEncoding(item)).sort((a, b) => a.localeCompare(b));
  modalState.petBreedOptions = breeds;
  if (document.activeElement === refs.p.raca) {
    renderPetBreedSuggestions();
  }
}

async function handlePetBreedTypePorteSync(source = '') {
  await refreshPetBreedOptions();
  const tipoInput = refs.p?.tipo;
  const racaInput = refs.p?.raca;
  if (!tipoInput || !racaInput) return;
  const breed = String(racaInput.value || '').trim();
  if (breed) {
    const inferred = inferPetTypeFromBreed(breed);
    if (inferred && normalizeText(tipoInput.value) !== inferred) {
      setSelectLikeValue(tipoInput, inferred);
      await refreshPetBreedOptions();
    }
  }
  if (source !== 'tipo') {
    setPorteFromBreedIfDog();
  }
}

function setTab(tab) {
  modalState.tab = tab === 'pet' ? 'pet' : 'cliente';
  const pet = modalState.tab === 'pet';
  refs.tabCliente?.classList.toggle('hidden', pet);
  refs.tabPet?.classList.toggle('hidden', !pet);
  refs.footerCliente?.classList.toggle('hidden', pet);
  refs.footerPet?.classList.toggle('hidden', !pet);
  refs.tabBtnCliente?.classList.toggle('bg-primary', !pet); refs.tabBtnCliente?.classList.toggle('text-white', !pet); refs.tabBtnCliente?.classList.toggle('bg-gray-200', pet); refs.tabBtnCliente?.classList.toggle('text-gray-500', pet);
  refs.tabBtnPet?.classList.toggle('bg-primary', pet); refs.tabBtnPet?.classList.toggle('text-white', pet); refs.tabBtnPet?.classList.toggle('bg-gray-200', !pet); refs.tabBtnPet?.classList.toggle('text-gray-500', !pet);
  updateStatus();
}

function updateStatus() {
  const cliTxt = `Cliente: ${pickFirst(modalState.selectedCliente?.nome, modalState.selectedCliente?.razaoSocial) || 'Nenhum'}`;
  const petTxt = `Pet: ${modalState.selectedPet?.nome || 'Nenhum'}`;
  const abaTxt = `Aba: ${modalState.tab === 'pet' ? 'Pet' : 'Cliente'}`;
  if (refs.status[0]) refs.status[0].textContent = cliTxt;
  if (refs.status[1]) refs.status[1].textContent = petTxt;
  if (refs.status[2]) refs.status[2].textContent = abaTxt;
  if (refs.status[3]) refs.status[3].textContent = cliTxt;
  if (refs.status[4]) refs.status[4].textContent = petTxt;
  if (refs.status[5]) refs.status[5].textContent = abaTxt;
}

function clearClienteForm() {
  const c = refs.c; if (!c) return;
  Object.entries(c).forEach(([k, el]) => {
    if (!el) return;
    if (el.type === 'checkbox') el.checked = false;
    else if (el.tagName === 'SELECT') el.value = k === 'tipoConta' ? 'pessoa_fisica' : '';
    else el.value = '';
  });
  c.cidade.value = 'RIO DE JANEIRO'; c.uf.value = 'RJ'; c.pais.value = 'Brasil'; c.f1ddd.value = c.f1ddd.value || '21'; c.f2ddd.value = c.f2ddd.value || '21';
  modalState.addressId = ''; modalState.selectedAddress = null;
}

function applyDefaultDdds() {
  if (!setMaskedValue('topDdd', '21')) { if (refs.topDdd) refs.topDdd.value = '21'; }
  if (!setMaskedValue('fone1Ddd', '21')) { if (refs.c?.f1ddd) refs.c.f1ddd.value = '21'; }
  if (!setMaskedValue('fone2Ddd', '21')) { if (refs.c?.f2ddd) refs.c.f2ddd.value = '21'; }
}

function setClienteRegisterMode(enabled) {
  modalState.registerMode = !!enabled;
  const required = modalState.registerMode;
  refs.saveClienteWrap?.classList.toggle('hidden', !required);
  refs.saveClienteWrap?.classList.toggle('flex', required);
  refs.savePetWrap?.classList.toggle('hidden', !required);
  if (refs.c?.nome) refs.c.nome.required = required;
  if (refs.c?.doc) refs.c.doc.required = required;
  if (refs.c?.cep) refs.c.cep.required = required;
  if (refs.c?.sexo) refs.c.sexo.required = required;
}

function clearModalCustomerContext() {
  modalState.selectedCliente = null;
  modalState.selectedPet = null;
  modalState.selectedAddress = null;
  modalState.clienteId = '';
  modalState.petId = '';
  modalState.addressId = '';
  modalState.addresses = [];
  modalState.pets = [];
  modalState.lastPhoneLookup = '';
  modalState.lastCodeLookup = '';
  fillTop(null);
  clearClienteForm();
  clearPetForm();
  applyDefaultDdds();
  if (!setMaskedValue('topNum', '')) { if (refs.topNum) refs.topNum.value = ''; }
  if (!setMaskedValue('fone1Num', '')) { if (refs.c?.f1num) refs.c.f1num.value = ''; }
  if (!setMaskedValue('fone2Num', '')) { if (refs.c?.f2num) refs.c.f2num.value = ''; }
  renderAddresses();
  renderPets();
  updateStatus();
}
function clearPetForm() {
  const p = refs.p; if (!p) return;
  Object.values(p).forEach((el) => { if (!el) return; if (el.type === 'checkbox') el.checked = false; else el.value = ''; });
  modalState.petId = ''; modalState.selectedPet = null; updateStatus();
}

function fillTop(cliente) {
  const txt = cliente ? (cliente.codigo ? `${cliente.codigo} - ${cliente.nome || ''}` : (cliente.nome || '')) : '';
  if (refs.searchTrigger) refs.searchTrigger.value = txt;
  const ph = splitPhone(pickFirst(cliente?.celular, cliente?.telefone));
  if (ph.ddd) {
    if (!setMaskedValue('topDdd', ph.ddd, { unmasked: true }) && refs.topDdd) refs.topDdd.value = ph.ddd;
  } else if (!refs.topDdd?.value) {
    applyDefaultDdds();
  }
  if (!setMaskedValue('topNum', ph.num || '', { unmasked: true }) && refs.topNum) refs.topNum.value = ph.num || '';
}

function fillCliente(cliente) {
  if (!cliente) { clearClienteForm(); return; }
  const c = refs.c;
  if (c.tipoConta) c.tipoConta.value = cliente.tipoConta === 'pessoa_juridica' ? 'pessoa_juridica' : 'pessoa_fisica';
  c.nome.value = pickFirst(cliente.nome, cliente.nomeCompleto, cliente.nomeContato, cliente.razaoSocial, cliente.apelido) || '';
  {
    const docValue = pickFirst(cliente.cpf, cliente.cnpj, cliente.inscricaoEstadual, cliente.doc, cliente.documento) || '';
    const docDigits = d(docValue);
    if ((docDigits.length === 11 || docDigits.length === 14) && setMaskedValue('doc', docDigits, { unmasked: true })) {
      // masked applied
    } else {
      c.doc.value = docValue;
    }
  }
  c.sexo.value = pickFirst(cliente.genero, cliente.sexo) || '';
  c.nasc.value = fmtDate(pickFirst(cliente.dataNascimento, cliente.nascimento));
  c.email.value = cliente.email || '';
  const p1 = splitPhone(pickFirst(cliente.celular, cliente.telefone));
  if (p1.ddd) {
    if (!setMaskedValue('fone1Ddd', p1.ddd, { unmasked: true })) c.f1ddd.value = p1.ddd;
  } else if (!c.f1ddd.value) c.f1ddd.value = '21';
  if (!setMaskedValue('fone1Num', p1.num || '', { unmasked: true })) c.f1num.value = p1.num || '';
  const p2 = splitPhone(pickFirst(cliente.telefone, cliente.telefoneSecundario, cliente.celularSecundario));
  if (p2.ddd) {
    if (!setMaskedValue('fone2Ddd', p2.ddd, { unmasked: true })) c.f2ddd.value = p2.ddd;
  } else if (!c.f2ddd.value) c.f2ddd.value = '21';
  if (!setMaskedValue('fone2Num', p2.num || '', { unmasked: true })) c.f2num.value = p2.num || '';
}

function fillAddress(address) {
  const c = refs.c;
  if (!address) { c.logradouro.value=''; c.numero.value=''; if (!setMaskedValue('cep','')) c.cep.value=''; c.bairro.value=''; c.complemento.value=''; c.obs.value=''; if (!c.cidade.value) c.cidade.value='RIO DE JANEIRO'; if (c.endDefault) c.endDefault.checked=false; modalState.addressId=''; modalState.selectedAddress=null; renderAddresses(); return; }
  modalState.selectedAddress = { ...address }; modalState.addressId = normalizeId(address._id);
  c.logradouro.value = address.logradouro || ''; c.numero.value = address.numero || ''; if (!setMaskedValue('cep', address.cep || '', { unmasked: true })) c.cep.value = address.cep || ''; c.bairro.value = address.bairro || ''; c.cidade.value = address.cidade || 'RIO DE JANEIRO'; c.complemento.value = address.complemento || ''; c.obs.value = address.observacao || ''; c.uf.value = address.uf || 'RJ'; c.ibge.value = address.codIbgeMunicipio || address.ibge || ''; c.coduf.value = address.codUf || ''; c.pais.value = address.pais || 'Brasil'; if (c.endDefault) c.endDefault.checked = !!address.isDefault;
  renderAddresses();
}

function fillPet(pet) {
  if (!pet) { clearPetForm(); return; }
  modalState.selectedPet = { ...pet }; modalState.petId = normalizeId(pet._id);
  const p = refs.p; p.nome.value = pet.nome || ''; setSelectLikeValue(p.tipo, pet.tipo || ''); p.sexo.value = pet.sexo || ''; setSelectLikeValue(p.porte, pet.porte || ''); p.peso.value = pet.peso || ''; p.raca.value = pet.raca || ''; p.nasc.value = fmtDate(pet.dataNascimento); p.cor.value = pet.pelagemCor || pet.cor || ''; p.codAnt.value = pet.codAntigoPet || ''; p.microchip.value = pet.microchip || ''; p.rga.value = pet.rga || ''; p.castrado.checked = !!pet.castrado; p.obito.checked = !!pet.obito; renderPets(); updateStatus();
  void handlePetBreedTypePorteSync();
}

function renderAddresses() {
  if (!refs.addrList || !refs.addrEmpty) return;
  refs.addrList.innerHTML = '';
  if (!modalState.selectedCliente) { refs.addrEmpty.textContent = 'Selecione um cliente para visualizar os enderecos.'; refs.addrEmpty.classList.remove('hidden'); return; }
  if (!modalState.addresses.length) { refs.addrEmpty.textContent = 'Nenhum endereco cadastrado para este cliente.'; refs.addrEmpty.classList.remove('hidden'); return; }
  refs.addrEmpty.classList.add('hidden');
  refs.addrList.innerHTML = modalState.addresses.map((a) => {
    const selected = normalizeId(a._id) === normalizeId(modalState.addressId);
    const cls = selected ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 bg-white text-gray-700 hover:border-primary hover:bg-primary/5';
    const line1 = [a.logradouro, a.numero].filter(Boolean).join(', ');
    const line2 = [a.bairro, [a.cidade, a.uf].filter(Boolean).join(' - '), a.cep].filter(Boolean).join(' | ');
    return `<button type="button" data-vet-ficha-cad-address="${esc(a._id)}" class="w-full rounded-lg border p-3 text-left transition ${cls}"><div class="flex items-center justify-between gap-2"><span class="font-semibold">${esc(a.apelido || 'Endereco')}</span>${a.isDefault ? '<span class="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Padrao</span>' : ''}</div><div class="mt-1 text-xs">${esc(line1 || '-')}</div><div class="text-xs">${esc(line2 || '-')}</div></button>`;
  }).join('');
}

function renderPets() {
  if (!refs.petsList || !refs.petsEmpty) return;
  refs.petsList.innerHTML = '';
  if (!modalState.selectedCliente) { refs.petsEmpty.textContent = 'Selecione um cliente para visualizar os pets.'; refs.petsEmpty.classList.remove('hidden'); return; }
  if (!modalState.pets.length) { refs.petsEmpty.textContent = 'Nenhum pet cadastrado para este cliente.'; refs.petsEmpty.classList.remove('hidden'); return; }
  refs.petsEmpty.classList.add('hidden');
  refs.petsList.innerHTML = modalState.pets.map((p) => {
    const selected = normalizeId(p._id) === normalizeId(modalState.petId);
    const cls = selected ? 'border-primary bg-primary/5 text-primary' : 'border-gray-200 bg-white text-gray-700 hover:border-primary hover:bg-primary/5';
    const details = [p.tipo, p.raca, p.sexo].filter(Boolean).join(' • ');
    return `<button type="button" data-vet-ficha-cad-pet="${esc(p._id)}" class="w-full rounded-lg border px-4 py-3 text-left transition flex flex-col gap-1 ${cls}"><span class="text-sm font-semibold">${esc(p.nome || 'Pet sem nome')}</span><span class="text-xs">${esc(details || 'Detalhes nao informados')}</span></button>`;
  }).join('');
}

async function loadCliente(id) {
  const cid = normalizeId(id); if (!cid) return;
  const resp = await api(`/func/clientes/${cid}`);
  if (!resp.ok) throw new Error(await readErr(resp, 'Nao foi possivel carregar cliente.'));
  const cliente = await resp.json();
  modalState.selectedCliente = cliente; modalState.clienteId = normalizeId(cliente._id);
  fillTop(cliente); fillCliente(cliente); updateStatus();
  const [ra, rp] = await Promise.all([api(`/func/clientes/${cid}/enderecos`).catch(() => null), api(`/func/clientes/${cid}/pets`).catch(() => null)]);
  modalState.addresses = ra?.ok ? (await ra.json().catch(() => [])) : [];
  modalState.pets = rp?.ok ? (await rp.json().catch(() => [])) : [];
  const currentPetId = normalizeId(state.selectedPetId);
  fillAddress(modalState.addresses.find((a) => a.isDefault) || modalState.addresses[0] || cliente.address || null);
  const curPet = modalState.pets.find((p) => normalizeId(p._id) === currentPetId) || modalState.pets.find((p) => normalizeId(p._id) === normalizeId(modalState.petId));
  if (curPet) fillPet(curPet); else renderPets();
}

function hydrateFromCurrentFicha() {
  modalState.selectedCliente = state.selectedCliente ? { ...state.selectedCliente } : null;
  modalState.clienteId = normalizeId(modalState.selectedCliente?._id);
  modalState.selectedPet = null; modalState.petId = ''; modalState.selectedAddress = null; modalState.addressId = ''; modalState.addresses = []; modalState.pets = [];
  fillTop(modalState.selectedCliente); clearClienteForm(); clearPetForm(); renderAddresses(); renderPets(); updateStatus();
  if (modalState.clienteId) { void loadCliente(modalState.clienteId).catch((e) => notify(e?.message || 'Erro ao carregar cliente.', 'error')); }
}

function searchOpen(initial = '') {
  refs.searchModal?.classList.remove('hidden'); document.body.classList.add('overflow-hidden');
  if (refs.searchInput) refs.searchInput.value = initial; modalState.searchQuery = initial; modalState.searchResults = []; renderSearch();
  if (String(initial).trim().length >= 2) void doSearch(initial);
  setTimeout(() => refs.searchInput?.focus(), 50);
}
function searchClose() {
  refs.searchModal?.classList.add('hidden'); modalState.searchLoading = false; modalState.searchResults = []; renderSearch();
}
function renderSearch() {
  if (!refs.searchResults || !refs.searchEmpty) return;
  refs.searchResults.innerHTML = '';
  if (modalState.searchLoading) { refs.searchEmpty.textContent = 'Buscando clientes...'; refs.searchEmpty.classList.remove('hidden'); return; }
  if (!String(modalState.searchQuery || '').trim() || String(modalState.searchQuery).trim().length < 2) { refs.searchEmpty.textContent = 'Digite para pesquisar clientes.'; refs.searchEmpty.classList.remove('hidden'); return; }
  if (!modalState.searchResults.length) { refs.searchEmpty.textContent = 'Nenhum cliente encontrado.'; refs.searchEmpty.classList.remove('hidden'); return; }
  refs.searchEmpty.classList.add('hidden');
  refs.searchResults.innerHTML = modalState.searchResults.map((c, i) => `<tr data-vet-ficha-cad-search-row="${i}" class="cursor-pointer hover:bg-primary/5"><td class="px-3 py-2 font-semibold text-gray-700">${esc(c.codigo || '-')}</td><td class="px-3 py-2 text-gray-700">${esc(c.nome || 'Cliente sem nome')}</td><td class="px-3 py-2 text-gray-700">${esc(c.cpf || c.cnpj || c.doc || '-')}</td><td class="px-3 py-2 text-gray-600">${esc(c.enderecoFormatado || '-')}</td></tr>`).join('');
}
async function doSearch(term) {
  const qx = String(term || '').trim(); modalState.searchQuery = qx;
  if (modalState.searchAbort) { modalState.searchAbort.abort(); modalState.searchAbort = null; }
  if (qx.length < 2) { modalState.searchLoading = false; modalState.searchResults = []; renderSearch(); return; }
  const ac = new AbortController(); modalState.searchAbort = ac; modalState.searchLoading = true; renderSearch();
  try {
    const resp = await api(`/func/clientes/buscar?q=${encodeURIComponent(qx)}&limit=20`, { signal: ac.signal });
    if (!resp.ok) throw new Error(await readErr(resp, 'Nao foi possivel buscar clientes.'));
    const list = await resp.json().catch(() => []); modalState.searchResults = Array.isArray(list) ? list : [];
  } catch (e) {
    if (e?.name !== 'AbortError') { modalState.searchResults = []; notify(e?.message || 'Nao foi possivel buscar clientes.', 'error'); }
  } finally {
    if (modalState.searchAbort === ac) modalState.searchAbort = null; modalState.searchLoading = false; renderSearch();
  }
}

function normalizePhoneForCompare(value) {
  const x = d(value);
  if (!x) return '';
  if (x.length > 11 && x.startsWith('55')) return x.slice(2);
  return x;
}

function buildPhoneVariants(value) {
  const normalized = normalizePhoneForCompare(value);
  const variants = new Set();
  if (!normalized) return variants;
  variants.add(normalized);
  if (normalized.length >= 11) variants.add(normalized.slice(-11));
  if (normalized.length >= 10) variants.add(normalized.slice(-10));
  if (normalized.length >= 9) variants.add(normalized.slice(-9));
  if (normalized.length >= 8) variants.add(normalized.slice(-8));
  if (normalized.length === 11 && normalized[2] === '9') {
    variants.add(`${normalized.slice(0, 2)}${normalized.slice(3)}`);
    variants.add(normalized.slice(3));
  }
  return variants;
}

function clientePhoneCandidates(cliente) {
  if (!cliente || typeof cliente !== 'object') return [];
  const candidates = [];
  const add = (value) => {
    const digits = normalizePhoneForCompare(value);
    if (!digits) return;
    if (!candidates.includes(digits)) candidates.push(digits);
  };
  add(cliente.telefone);
  add(cliente.celular);
  add(cliente.celular2);
  add(cliente.celular_2);
  add(cliente.celularSecundario);
  add(cliente.telefoneSecundario);
  add(cliente.telefoneFixo);
  add(cliente.telefone_fixo);
  add(cliente.fone);
  add(cliente.fone2);
  add(cliente.whatsapp);
  add(cliente.telefone1);
  add(cliente.telefone2);
  add(cliente.telefone3);
  if (cliente.contato && typeof cliente.contato === 'object') {
    add(cliente.contato.telefone);
    add(cliente.contato.telefone2);
    add(cliente.contato.telefone_2);
    add(cliente.contato.celular);
    add(cliente.contato.celular2);
    add(cliente.contato.celular_2);
    add(cliente.contato.whatsapp);
  }
  if (Array.isArray(cliente.telefones)) {
    cliente.telefones.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === 'string') {
        add(entry);
        return;
      }
      if (typeof entry === 'object') {
        add(entry.telefone || entry.celular || entry.whatsapp || entry.numero || entry.number);
      }
    });
  }
  return candidates;
}

function listHasPhoneMatch(list, targetDigits) {
  const targetVariants = buildPhoneVariants(targetDigits);
  if (!Array.isArray(list) || !list.length || !targetVariants.size) return null;
  return list.find((entry) => {
    const phones = clientePhoneCandidates(entry);
    return phones.some((candidate) => {
      const candidateVariants = buildPhoneVariants(candidate);
      for (const cv of candidateVariants) {
        if (targetVariants.has(cv)) return true;
        for (const tv of targetVariants) {
          if (cv.endsWith(tv) || tv.endsWith(cv)) return true;
        }
      }
      return false;
    });
  }) || null;
}

function formatLocalPhoneDigits(value) {
  const digits = d(value);
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  if (digits.length === 9) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return digits;
}

function buildPhoneSearchQueries(targetDigits) {
  const targetNormalized = normalizePhoneForCompare(targetDigits);
  const local9 = targetNormalized.slice(-9);
  const local8 = targetNormalized.slice(-8);
  const dddValue = targetNormalized.length >= 10 ? targetNormalized.slice(0, 2) : '';
  const localValue = dddValue ? targetNormalized.slice(2) : targetNormalized;
  const localFormatted = formatLocalPhoneDigits(localValue);
  const formattedQueries = (() => {
    const variants = new Set();
    if (localValue) {
      variants.add(localValue);
      variants.add(localFormatted);
    }
    if (dddValue && localValue) {
      variants.add(`${dddValue}${localValue}`);
      variants.add(`${dddValue} ${localValue}`);
      variants.add(`${dddValue}-${localValue}`);
      variants.add(`(${dddValue})${localValue}`);
      variants.add(`(${dddValue}) ${localValue}`);
      variants.add(`(${dddValue}) ${localFormatted}`);
      variants.add(`${dddValue} ${localFormatted}`);
    }
    return Array.from(variants).filter(Boolean);
  })();
  return Array.from(
    new Set(
      [targetDigits, targetNormalized, local9, local8, ...formattedQueries].filter(
        (value) => value && String(value).trim().length >= 8
      )
    )
  );
}

async function lookupClienteByPhone() {
  const phoneDigits = normalizePhoneForCompare(`${d(refs.topDdd?.value || '').slice(0, 2)}${d(refs.topNum?.value || '')}`);
  if (phoneDigits.length !== 10 && phoneDigits.length !== 11) return;
  if (modalState.lastPhoneLookup === phoneDigits) return;
  modalState.lastPhoneLookup = phoneDigits;
  try {
    const queries = buildPhoneSearchQueries(phoneDigits);
    let matched = null;

    for (const query of queries) {
      const resp = await api(`/func/clientes/buscar?q=${encodeURIComponent(query)}&limit=12`);
      if (!resp.ok) continue;
      const list = await resp.json().catch(() => []);
      matched = listHasPhoneMatch(list, phoneDigits) || (Array.isArray(list) && list.length === 1 ? list[0] : null);
      if (matched?._id) break;
    }

    if (!matched?._id) {
      for (const query of queries) {
        for (const page of [1, 2, 3]) {
          const resp = await api(`/func/clientes?page=${page}&limit=50&search=${encodeURIComponent(query)}`);
          if (!resp.ok) continue;
          const payload = await resp.json().catch(() => ({}));
          const items = Array.isArray(payload?.items) ? payload.items : [];
          matched = listHasPhoneMatch(items, phoneDigits);
          if (matched?._id) break;
          if (!items.length) break;
        }
        if (matched?._id) break;
      }
    }

    // Confere detalhes (incluindo telefones secundarios) quando a lista nao trouxe todos os campos.
    if (!matched?._id) {
      for (const query of queries) {
        const resp = await api(`/func/clientes/buscar?q=${encodeURIComponent(query)}&limit=6`);
        if (!resp.ok) continue;
        const list = await resp.json().catch(() => []);
        if (!Array.isArray(list) || !list.length) continue;
        for (const item of list) {
          const id = normalizeId(item?._id);
          if (!id) continue;
          const detailResp = await api(`/func/clientes/${id}`);
          if (!detailResp.ok) continue;
          const detail = await detailResp.json().catch(() => null);
          if (!detail) continue;
          if (listHasPhoneMatch([detail], phoneDigits)) {
            matched = detail;
            break;
          }
        }
        if (matched?._id) break;
      }
    }

    // Fallback final: varre listagem sem filtro e valida todos os telefones localmente.
    if (!matched?._id) {
      let totalPages = null;
      for (let page = 1; page <= (totalPages || 9999); page += 1) {
        const resp = await api(`/func/clientes?page=${page}&limit=50`);
        if (!resp.ok) break;
        const payload = await resp.json().catch(() => ({}));
        const items = Array.isArray(payload?.items) ? payload.items : [];
        matched = listHasPhoneMatch(items, phoneDigits);
        if (matched?._id) break;
        const parsedTotalPages = Number.parseInt(String(payload?.pagination?.totalPages || '0'), 10);
        if (Number.isInteger(parsedTotalPages) && parsedTotalPages > 0) {
          totalPages = parsedTotalPages;
        }
        if (!items.length) break;
      }
    }

    if (!matched?._id) {
      modalState.lastPhoneLookup = '';
      return;
    }
    setClienteRegisterMode(false);
    await loadCliente(matched._id);
    setTab('cliente');
  } catch {
    modalState.lastPhoneLookup = '';
    // silent
  }
}

async function lookupClienteByCodigo(rawValue) {
  const codeDigits = d(rawValue);
  if (!codeDigits) return;
  if (modalState.lastCodeLookup === codeDigits) return;
  modalState.lastCodeLookup = codeDigits;
  try {
    const resp = await api(`/func/clientes/buscar?q=${encodeURIComponent(codeDigits)}&limit=10`);
    if (!resp.ok) return;
    const list = await resp.json().catch(() => []);
    if (!Array.isArray(list) || !list.length) return;
    const exact = list.find((item) => {
      const itemCode = d(item?.codigo || '');
      if (!itemCode) return false;
      return Number.parseInt(itemCode, 10) === Number.parseInt(codeDigits, 10);
    });
    if (!exact?._id) return;
    setClienteRegisterMode(false);
    await loadCliente(exact._id);
    setTab('cliente');
  } catch {
    // silent
  }
}

function buildClientePayload() {
  const c = refs.c; const tipoConta = c.tipoConta?.value === 'pessoa_juridica' ? 'pessoa_juridica' : 'pessoa_fisica';
  const rawDoc = String(c.doc.value || '').trim(); const docDigits = d(rawDoc);
  const payload = { tipoConta, email: String(c.email.value || '').trim(), celular: joinPhone(c.f1ddd.value, c.f1num.value), telefone: joinPhone(c.f2ddd.value, c.f2num.value), sexo: String(c.sexo.value || '').trim(), nascimento: String(c.nasc.value || '').trim(), apelido: String(c.nome.value || '').trim() };
  if (tipoConta === 'pessoa_juridica') { payload.razaoSocial = String(c.nome.value || '').trim(); if (docDigits.length === 14) payload.cnpj = docDigits; else if (docDigits) payload.inscricaoEstadual = rawDoc; }
  else { payload.nome = String(c.nome.value || '').trim(); if (docDigits.length === 11) payload.cpf = docDigits; else if (docDigits.length === 14) { payload.tipoConta = 'pessoa_juridica'; payload.razaoSocial = payload.nome; payload.cnpj = docDigits; delete payload.nome; } }
  return payload;
}
function buildAddressPayload() {
  const c = refs.c; return { apelido: String(c.nome.value || '').trim() || 'Principal', cep: String(c.cep.value || '').trim(), logradouro: String(c.logradouro.value || '').trim(), numero: String(c.numero.value || '').trim(), complemento: String(c.complemento.value || '').trim(), bairro: String(c.bairro.value || '').trim(), cidade: String(c.cidade.value || '').trim(), uf: String(c.uf.value || '').trim().toUpperCase() || 'RJ', ibge: String(c.ibge.value || '').trim(), codIbgeMunicipio: String(c.ibge.value || '').trim(), codUf: String(c.coduf.value || '').trim(), pais: String(c.pais.value || '').trim() || 'Brasil', isDefault: !!c.endDefault?.checked };
}
function buildPetPayload() {
  const p = refs.p; return { nome: String(p.nome.value || '').trim(), tipo: String(p.tipo.value || '').trim(), sexo: String(p.sexo.value || '').trim(), porte: String(p.porte.value || '').trim(), peso: String(p.peso.value || '').trim(), raca: String(p.raca.value || '').trim(), nascimento: String(p.nasc.value || '').trim(), pelagemCor: String(p.cor.value || '').trim(), codAntigoPet: String(p.codAnt.value || '').trim(), microchip: String(p.microchip.value || '').trim(), rga: String(p.rga.value || '').trim(), castrado: !!p.castrado.checked, obito: !!p.obito.checked };
}
function hasAddressInput() { const c = refs.c; return !!(String(c.logradouro.value || '').trim() || String(c.numero.value || '').trim() || String(c.cep.value || '').trim() || String(c.bairro.value || '').trim() || String(c.cidade.value || '').trim() || String(c.complemento.value || '').trim()); }

function hasPetInput() {
  const p = refs.p;
  if (!p) return false;
  return Boolean(
    String(p.nome?.value || '').trim() ||
    String(p.tipo?.value || '').trim() ||
    String(p.sexo?.value || '').trim() ||
    String(p.porte?.value || '').trim() ||
    String(p.peso?.value || '').trim() ||
    String(p.raca?.value || '').trim() ||
    String(p.nasc?.value || '').trim() ||
    String(p.cor?.value || '').trim() ||
    String(p.codAnt?.value || '').trim() ||
    String(p.microchip?.value || '').trim() ||
    String(p.rga?.value || '').trim() ||
    !!p.castrado?.checked ||
    !!p.obito?.checked
  );
}

async function saveClienteEndereco(options = {}) {
  const { silent = false } = options;
  const payload = buildClientePayload();
  if (!payload.celular) throw new Error('Informe o telefone/celular do cliente.');
  if (!String(payload.nome || payload.razaoSocial || '').trim()) throw new Error('Informe o nome do cliente.');
  let resp;
  if (modalState.clienteId) resp = await api(`/func/clientes/${modalState.clienteId}`, { method:'PUT', body: JSON.stringify(payload) });
  else resp = await api('/func/clientes', { method:'POST', body: JSON.stringify(payload) });
  if (!resp.ok) throw new Error(await readErr(resp, 'Nao foi possivel salvar cliente.'));
  const cli = await resp.json(); modalState.selectedCliente = cli; modalState.clienteId = normalizeId(cli._id); fillTop(cli);
  if (hasAddressInput()) {
    const a = buildAddressPayload();
    if (d(a.cep).length !== 8) throw new Error('Informe um CEP valido com 8 digitos.');
    if (!a.logradouro || !a.numero) throw new Error('Informe endereco e numero.');
    const path = modalState.addressId ? `/func/clientes/${modalState.clienteId}/enderecos/${modalState.addressId}` : `/func/clientes/${modalState.clienteId}/enderecos`;
    const method = modalState.addressId ? 'PUT' : 'POST';
    const ra = await api(path, { method, body: JSON.stringify(a) });
    if (!ra.ok) throw new Error(await readErr(ra, 'Nao foi possivel salvar endereco.'));
    const savedA = await ra.json(); modalState.selectedAddress = savedA; modalState.addressId = normalizeId(savedA._id);
  }
  await loadCliente(modalState.clienteId);
  if (!silent) notify('Cliente salvo com sucesso.', 'success');
}

async function savePet(options = {}) {
  const { silent = false } = options;
  if (!modalState.clienteId) throw new Error('Selecione ou cadastre um cliente antes de gravar o pet.');
  const payload = buildPetPayload();
  if (!payload.nome) throw new Error('Informe o nome do pet.');
  if (!payload.tipo) throw new Error('Informe o tipo do pet.');
  if (!payload.sexo) throw new Error('Informe o sexo do pet.');
  const path = modalState.petId ? `/func/clientes/${modalState.clienteId}/pets/${modalState.petId}` : `/func/clientes/${modalState.clienteId}/pets`;
  const method = modalState.petId ? 'PUT' : 'POST';
  const resp = await api(path, { method, body: JSON.stringify(payload) });
  if (!resp.ok) throw new Error(await readErr(resp, 'Nao foi possivel salvar pet.'));
  const pet = await resp.json(); modalState.selectedPet = pet; modalState.petId = normalizeId(pet._id);
  await loadCliente(modalState.clienteId);
  const match = modalState.pets.find((x) => normalizeId(x._id) === modalState.petId) || pet; fillPet(match);
  if (!silent) notify('Pet salvo com sucesso.', 'success');
}

async function saveAll() {
  if (modalState.saving) return;
  modalState.saving = true;
  [...(refs.saveAllBtns || []), ...(refs.confirmBtns || [])].forEach((b)=>{ if (b) { b.disabled=true; b.classList.add('opacity-60','cursor-not-allowed'); } });
  try {
    await saveClienteEndereco({ silent: true });
    const shouldSavePet = hasPetInput();
    if (shouldSavePet) {
      await savePet({ silent: true });
      notify('Cliente, endereco e pet gravados com sucesso.', 'success');
    } else {
      notify('Cliente e endereco gravados com sucesso.', 'success');
    }
  } catch (e) { notify(e?.message || 'Erro ao gravar.', 'error'); }
  finally { modalState.saving = false; [...(refs.saveAllBtns || []), ...(refs.confirmBtns || [])].forEach((b)=>{ if (b) { b.disabled=false; b.classList.remove('opacity-60','cursor-not-allowed'); } }); }
}

async function confirmAndApply() {
  if (!modalState.clienteId) { notify('Selecione um cliente para confirmar.', 'warning'); return; }
  await onSelectCliente(modalState.selectedCliente || { _id: modalState.clienteId, nome: refs.c?.nome?.value || '' });
  if (modalState.petId) {
    if (els.petSelect) els.petSelect.value = modalState.petId;
    await onSelectPet(modalState.petId);
  }
  closeFichaCadastroModal();
}

function bindEvents() {
  mapRefs();
  initInputMasks();
  refs.root.addEventListener('click', (event) => {
    const dismiss = event.target.closest('[data-vet-ficha-cad-dismiss]'); if (dismiss) return closeFichaCadastroModal();
    const dismissSearch = event.target.closest('[data-vet-ficha-cad-search-dismiss]'); if (dismissSearch) return searchClose();
    const aBtn = event.target.closest('[data-vet-ficha-cad-address]');
    if (aBtn) { const id = normalizeId(aBtn.getAttribute('data-vet-ficha-cad-address')); const a = modalState.addresses.find((x)=>normalizeId(x._id)===id); if (a) fillAddress(a); return; }
    const pBtn = event.target.closest('[data-vet-ficha-cad-pet]');
    if (pBtn) { const id = normalizeId(pBtn.getAttribute('data-vet-ficha-cad-pet')); const p = modalState.pets.find((x)=>normalizeId(x._id)===id); if (p) fillPet(p); return; }
    const breedBtn = event.target.closest('[data-vet-ficha-cad-breed-option]');
    if (breedBtn && refs.p?.raca) {
      refs.p.raca.value = breedBtn.getAttribute('data-vet-ficha-cad-breed-option') || '';
      closePetBreedSuggestions();
      void handlePetBreedTypePorteSync('raca');
      return;
    }
    const row = event.target.closest('[data-vet-ficha-cad-search-row]');
    if (row) { const i = Number.parseInt(row.getAttribute('data-vet-ficha-cad-search-row') || '-1', 10); const cli = modalState.searchResults[i]; if (cli?._id) { searchClose(); void loadCliente(cli._id).catch((e)=>notify(e?.message || 'Erro ao selecionar cliente.', 'error')); setTab('cliente'); } }
  });
  refs.close?.addEventListener('click', closeFichaCadastroModal);
  refs.tabBtnCliente?.addEventListener('click', () => setTab('cliente')); refs.tabBtnPet?.addEventListener('click', () => setTab('pet'));
  refs.confirmBtns.forEach((b)=>b?.addEventListener('click', ()=>{ void confirmAndApply(); }));
  refs.saveAllBtns.forEach((b)=>b?.addEventListener('click', ()=>{ void saveAll(); }));
  refs.cancelBtns.forEach((b)=>b?.addEventListener('click', closeFichaCadastroModal));
  refs.btnRegister?.addEventListener('click', () => {
    setClienteRegisterMode(true);
    setTab('cliente');
    refs.c?.nome?.focus();
  });
  refs.btnChange?.addEventListener('click', () => {
    setClienteRegisterMode(false);
    clearModalCustomerContext();
    setTab('cliente');
    refs.searchTrigger?.focus();
  });
  refs.p?.tipo?.addEventListener('input', () => { void handlePetBreedTypePorteSync('tipo'); });
  refs.p?.tipo?.addEventListener('change', () => { void handlePetBreedTypePorteSync('tipo'); });
  refs.p?.raca?.addEventListener('focus', () => { renderPetBreedSuggestions(); });
  refs.p?.raca?.addEventListener('input', () => { renderPetBreedSuggestions(); void handlePetBreedTypePorteSync('raca'); });
  refs.p?.raca?.addEventListener('change', () => { void handlePetBreedTypePorteSync('raca'); });
  refs.p?.raca?.addEventListener('blur', () => { setTimeout(() => closePetBreedSuggestions(), 120); void handlePetBreedTypePorteSync('raca'); });
  refs.p?.raca?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePetBreedSuggestions();
  });
  refs.searchTrigger?.addEventListener('input', () => {
    const raw = String(refs.searchTrigger?.value || '');
    const trimmed = raw.trim();
    if (/\p{L}/u.test(raw) || trimmed === '*') {
      searchOpen(trimmed);
      return;
    }
    if (/^\d+$/.test(trimmed)) {
      if (modalState.codeLookupTimer) clearTimeout(modalState.codeLookupTimer);
      modalState.codeLookupTimer = setTimeout(() => {
        modalState.codeLookupTimer = null;
        void lookupClienteByCodigo(trimmed);
      }, 350);
    }
  });
  refs.searchTrigger?.addEventListener('blur', () => {
    const trimmed = String(refs.searchTrigger?.value || '').trim();
    if (/^\d+$/.test(trimmed)) {
      void lookupClienteByCodigo(trimmed);
    }
  });
  const topPhoneLookupDebounced = () => {
    if (modalState.phoneLookupTimer) clearTimeout(modalState.phoneLookupTimer);
    modalState.phoneLookupTimer = setTimeout(() => {
      modalState.phoneLookupTimer = null;
      void lookupClienteByPhone();
    }, 350);
  };
  refs.topDdd?.addEventListener('input', topPhoneLookupDebounced);
  refs.topNum?.addEventListener('input', topPhoneLookupDebounced);
  refs.topDdd?.addEventListener('keyup', topPhoneLookupDebounced);
  refs.topNum?.addEventListener('keyup', topPhoneLookupDebounced);
  refs.topDdd?.addEventListener('blur', () => { void lookupClienteByPhone(); });
  refs.topNum?.addEventListener('blur', () => { void lookupClienteByPhone(); });
  refs.searchBtn?.addEventListener('click', () => { void doSearch(refs.searchInput?.value || ''); });
  refs.searchClose?.addEventListener('click', searchClose);
  refs.searchInput?.addEventListener('input', () => { const v = refs.searchInput.value || ''; modalState.searchQuery = v; if (modalState.searchTimer) clearTimeout(modalState.searchTimer); modalState.searchTimer = setTimeout(() => { modalState.searchTimer = null; void doSearch(v); }, 250); });
  refs.searchInput?.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); searchClose(); } if (e.key === 'Enter') { e.preventDefault(); void doSearch(refs.searchInput?.value || ''); } });
  refs.clienteForm?.addEventListener('submit', (e) => { e.preventDefault(); void saveClienteEndereco().catch((err)=>notify(err?.message || 'Erro ao salvar cliente.', 'error')); });
  document.addEventListener('keydown', (e) => {
    if (refs.modal?.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); if (!refs.searchModal?.classList.contains('hidden')) searchClose(); else closeFichaCadastroModal(); }
    else if (e.key === 'F2') { e.preventDefault(); searchOpen(refs.searchTrigger?.value || ''); }
    else if (e.key === 'F5') { e.preventDefault(); void confirmAndApply(); }
    else if (e.altKey && String(e.key).toLowerCase() === 'g') { e.preventDefault(); void saveAll(); }
  });
  refs.c?.cep?.addEventListener('blur', async () => {
    const cep = d(refs.c.cep.value); if (cep.length !== 8) return;
    try { const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`); if (!r.ok) return; const x = await r.json(); if (x?.erro) return; if (!refs.c.logradouro.value) refs.c.logradouro.value = x.logradouro || ''; if (!refs.c.bairro.value) refs.c.bairro.value = x.bairro || ''; if (!refs.c.cidade.value) refs.c.cidade.value = x.localidade || ''; if (!refs.c.uf.value) refs.c.uf.value = (x.uf || '').toUpperCase(); refs.c.ibge.value = x.ibge || ''; } catch {}
  });
  modalState.mounted = true;
}

export function openFichaCadastroModal(opts = {}) {
  ensureMounted();
  if (!modalState.mounted) bindEvents();
  modalState.lastPhoneLookup = '';
  modalState.lastCodeLookup = '';
  hydrateFromCurrentFicha();
  setClienteRegisterMode(false);
  applyDefaultDdds();
  ensurePetFixedOptions();
  void refreshPetBreedOptions();
  setTab(opts?.tab === 'pet' ? 'pet' : 'cliente');
  refs.modal?.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
  if ((opts?.tab === 'pet')) refs.p?.nome?.focus(); else refs.searchTrigger?.focus();
}

export function closeFichaCadastroModal() {
  ensureMounted();
  refs.modal?.classList.add('hidden');
  refs.searchModal?.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}
