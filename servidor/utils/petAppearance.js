const PET_COAT_LENGTHS = ['Curto', 'Médio', 'Longo'];

const has = (source, key) => Object.prototype.hasOwnProperty.call(source, key);
const text = (value) => String(value ?? '').trim();

function normalizePetCoatLength(value) {
  const length = text(value);
  if (length && !PET_COAT_LENGTHS.includes(length)) {
    const error = new Error('Selecione uma pelagem válida: Curto, Médio ou Longo.');
    error.code = 'INVALID_PET_COAT_LENGTH';
    throw error;
  }
  return length;
}

function petAppearanceUpdate(source, { color, length, legacy, separate } = {}) {
  const update = {};
  if (has(source, color)) {
    update.cor = text(source[color]);
    update.pelagemCor = update.cor;
  } else if (legacy && has(source, legacy)) {
    update.cor = text(source[legacy]);
    update.pelagemCor = update.cor;
  }
  if (separate && has(source, length)) update.pelagem = normalizePetCoatLength(source[length]);
  return update;
}

function storefrontPetAppearance(source) {
  return petAppearanceUpdate(source, { color: 'pet_cor', length: 'pet_pelagem', legacy: 'pet_pelagem', separate: has(source, 'pet_cor') });
}

function staffPetAppearance(source) {
  return petAppearanceUpdate(source, { color: 'cor', length: 'pelagem', legacy: has(source, 'pelagemCor') ? 'pelagemCor' : 'pelagem', separate: has(source, 'cor') });
}

function desktopPetAppearance(source) {
  const color = has(source, 'coatColor') ? 'coatColor' : has(source, 'color') ? 'color' : 'cor';
  return petAppearanceUpdate(source, { color, length: 'pelagem', legacy: 'pelagemCor', separate: true });
}

module.exports = { PET_COAT_LENGTHS, storefrontPetAppearance, staffPetAppearance, desktopPetAppearance };
