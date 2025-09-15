// scripts/masks.js
document.addEventListener('DOMContentLoaded', () => {
  // Define os padr��es de mǭscara
  const maskPatterns = {
    cpf: '000.000.000-00',
    cnpj: '00.000.000/0000-00',
    celular: '(00) 00000-0000',
    celular2: '00000-0000',
    telefone: '(00) 0000-0000',
    telefone2: '0000-0000',
  };

  // Encontra todos os inputs que tǦm o atributo data-mask
  const inputsToMask = document.querySelectorAll('[data-mask]');

  inputsToMask.forEach(input => {
    const maskName = input.dataset.mask; // Pega o valor (ex: "cpf")
    if (maskPatterns[maskName]) {
      IMask(input, { mask: maskPatterns[maskName] });
    }

    const identifierInput = document.querySelector('[data-mask="identifier"]');

    if (identifierInput) {
    IMask(identifierInput, {
        mask: [
        { mask: '000.000.000-00' },      // Mǭscara para CPF
        { mask: '00.000.000/0000-00' }, // Mǭscara para CNPJ
        { mask: /^\S+@?\S*$/ }          // Mǭscara para E-mail (aceita tudo)
        ],
        // A fun��ǜo dispatch decide qual mǭscara usar
        dispatch: function (appended, dynamicMasked) {
        const value = (dynamicMasked.value + appended);

        // Se o valor contǸm letras (exceto 'e' para '.com.br') ou '@', assume que Ǹ um e-mail.
        if (/[a-df-zA-DF-Z@]/.test(value)) {
            return dynamicMasked.compiledMasks[2]; // Usa a mǭscara de E-mail
        }
        
        // Limpa para contar apenas os d��gitos
        const cleanValue = value.replace(/\D/g, '');

        // Se tiver 11 ou menos d��gitos, usa a mǭscara de CPF.
        if (cleanValue.length <= 11) {
            return dynamicMasked.compiledMasks[0];
        }

        // Se tiver mais de 11 d��gitos, usa a mǭscara de CNPJ.
        return dynamicMasked.compiledMasks[1];
        }
    });
    }

  });
});

