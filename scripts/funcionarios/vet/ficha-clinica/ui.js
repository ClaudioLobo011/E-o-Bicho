// UI helpers for the Vet ficha clínica
import {
  state,
  els,
  pickFirst,
  PET_PLACEHOLDERS,
  setPetDetailField,
  setPetExtraField,
  clearPetExtras,
  formatPetSex,
  formatPetRga,
  formatPetMicrochip,
  formatPetWeight,
  formatDateDisplay,
  getSelectedPet,
  CARD_TUTOR_ACTIVE_CLASSES,
  CARD_PET_ACTIVE_CLASSES,
  CARD_BUTTON_INACTIVE_CLASSES,
  CARD_BUTTON_DISABLED_CLASSES,
} from './core.js';
import { updateConsultaAgendaCard } from './consultas.js';

export function updatePageVisibility() {
  if (!els.pageContent) return;
  const hasTutor = !!(state.selectedCliente && state.selectedCliente._id);
  const hasPet = !!state.selectedPetId;
  if (els.topTabs) {
    els.topTabs.classList.toggle('hidden', !hasTutor);
  }
  if (hasTutor && hasPet) {
    els.pageContent.classList.remove('hidden');
  } else {
    els.pageContent.classList.add('hidden');
  }
}

function setPetPlaceholders() {
  if (els.petNome) els.petNome.textContent = PET_PLACEHOLDERS.nome;
  setPetDetailField(PET_PLACEHOLDERS.tipo, els.petTipo, els.petTipoWrapper, { forceShow: true });
  setPetDetailField(PET_PLACEHOLDERS.raca, els.petRaca, els.petRacaWrapper, { forceShow: true });
  setPetDetailField(PET_PLACEHOLDERS.nascimento, els.petNascimento, els.petNascimentoWrapper, { forceShow: true });
  setPetDetailField(PET_PLACEHOLDERS.peso, els.petPeso, els.petPesoWrapper, { forceShow: true });
  if (els.petMainDetails) {
    els.petMainDetails.classList.remove('hidden');
  }
  clearPetExtras();
}

function updatePetInfo(pet = getSelectedPet()) {
  if (!pet) {
    setPetPlaceholders();
    return;
  }
  clearPetExtras();

  const nome = (pet.nome || '').trim();
  if (els.petNome) els.petNome.textContent = nome || '—';

  const tipo = (pet.tipo || pet.tipoPet || pet.especie || pet.porte || '').trim();
  const raca = (pet.raca || pet.breed || '').trim();
  const nascimento = formatDateDisplay(pet.dataNascimento || pet.nascimento);
  const peso = formatPetWeight(pet.peso || pet.pesoAtual);

  const hasTipo = setPetDetailField(tipo, els.petTipo, els.petTipoWrapper);
  const hasRaca = setPetDetailField(raca, els.petRaca, els.petRacaWrapper);
  const hasNascimento = setPetDetailField(nascimento, els.petNascimento, els.petNascimentoWrapper);
  const hasPeso = setPetDetailField(peso, els.petPeso, els.petPesoWrapper);
  if (els.petMainDetails) {
    const hasMainDetails = hasTipo || hasRaca || hasNascimento || hasPeso;
    els.petMainDetails.classList.toggle('hidden', !hasMainDetails);
  }

  const cor = pickFirst(pet.pelagemCor, pet.cor, pet.corPelagem, pet.corPelo);
  const sexo = formatPetSex(pet.sexo);
  const rga = formatPetRga(pickFirst(pet.rga, pet.rg));
  const microchip = formatPetMicrochip(pickFirst(pet.microchip, pet.microChip, pet.chip));

  const hasCor = setPetExtraField(cor, els.petCor, els.petCorWrapper);
  const hasSexo = setPetExtraField(sexo, els.petSexo, els.petSexoWrapper);
  const hasRga = setPetExtraField(rga, els.petRga, els.petRgaWrapper);
  const hasMicrochip = setPetExtraField(microchip, els.petMicrochip, els.petMicrochipWrapper);
  const hasExtras = hasCor || hasSexo || hasRga || hasMicrochip;
  if (els.petExtraContainer) {
    els.petExtraContainer.classList.toggle('hidden', !hasExtras);
  }
}

function updateToggleButtons(showPet, petAvailable) {
  const toggleStates = [...CARD_TUTOR_ACTIVE_CLASSES, ...CARD_PET_ACTIVE_CLASSES, ...CARD_BUTTON_INACTIVE_CLASSES];
  if (els.toggleTutor) {
    els.toggleTutor.classList.remove(...toggleStates);
    els.toggleTutor.classList.add(...(showPet ? CARD_BUTTON_INACTIVE_CLASSES : CARD_TUTOR_ACTIVE_CLASSES));
  }
  if (els.togglePet) {
    els.togglePet.classList.remove(...toggleStates, ...CARD_BUTTON_DISABLED_CLASSES);
    if (petAvailable) {
      els.togglePet.classList.add(...(showPet ? CARD_PET_ACTIVE_CLASSES : CARD_BUTTON_INACTIVE_CLASSES));
      els.togglePet.removeAttribute('disabled');
    } else {
      els.togglePet.classList.add(...CARD_BUTTON_INACTIVE_CLASSES, ...CARD_BUTTON_DISABLED_CLASSES);
      els.togglePet.setAttribute('disabled', 'disabled');
    }
  }
}

export function updateCardDisplay() {
  const pet = getSelectedPet();
  const hasPet = !!pet;
  if (hasPet) {
    updatePetInfo(pet);
  } else {
    setPetPlaceholders();
  }
  const wantsPet = state.currentCardMode === 'pet';
  const showPet = wantsPet && hasPet;
  if (wantsPet && !hasPet) {
    state.currentCardMode = 'tutor';
  }
  if (els.tutorInfo) els.tutorInfo.classList.toggle('hidden', showPet);
  if (els.petInfo) els.petInfo.classList.toggle('hidden', !showPet);
  if (els.cardIcon) {
    els.cardIcon.classList.remove(...CARD_TUTOR_ACTIVE_CLASSES, ...CARD_PET_ACTIVE_CLASSES);
    els.cardIcon.classList.add(...(showPet ? CARD_PET_ACTIVE_CLASSES : CARD_TUTOR_ACTIVE_CLASSES));
  }
  if (els.cardIconSymbol) {
    els.cardIconSymbol.className = `fas ${showPet ? 'fa-paw' : 'fa-user'} text-xl`;
  }
  updateToggleButtons(showPet, hasPet);
  updateConsultaAgendaCard();
}

export function setCardMode(mode) {
  state.currentCardMode = mode === 'pet' ? 'pet' : 'tutor';
  updateCardDisplay();
}
