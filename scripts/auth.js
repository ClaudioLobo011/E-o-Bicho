// --- Remember Me helpers ---
const REMEMBER_KEY = 'rememberLogin'; // { identifier: '...' }

function hydrateRememberedIdentifier() {
  // Preenche o campo de login com o identificador salvo e marca o checkbox
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null');
    if (saved?.identifier) {
      const idInput = document.getElementById('identifier');
      if (idInput) idInput.value = saved.identifier;
      const rememberEl = document.getElementById('remember-me');
      if (rememberEl) rememberEl.checked = true;
    }
  } catch { /* ignore */ }
}

function saveRememberIdentifier(identifier, checked) {
  if (checked && identifier) {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ identifier }));
  } else {
    localStorage.removeItem(REMEMBER_KEY);
  }
}

function initializeAuth() {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');

    if (loginForm) {
        hydrateRememberedIdentifier();
        const rememberEl = document.getElementById('remember-me');
        rememberEl?.addEventListener('change', () => {
        if (!rememberEl.checked) localStorage.removeItem(REMEMBER_KEY);
        });

        loginForm.addEventListener('submit', handleLoginSubmit);
    }

    if (signupForm) {
        const radioPf = document.getElementById('radio-pf');
        const radioPj = document.getElementById('radio-pj');
        const formPf = document.getElementById('form-pf');
        const formPj = document.getElementById('form-pj');
        const ieInput = document.getElementById('ie');
        const isentoCheckbox = document.getElementById('isento_ie');

        window.toggleForms = () => {
            if (!radioPf || !formPf || !formPj) return;
            if (radioPf.checked) {
                formPf.style.maxHeight = formPf.scrollHeight + "px";
                formPf.style.opacity = 1;
                formPj.style.maxHeight = 0;
                formPj.style.opacity = 0;
            } else {
                formPj.style.maxHeight = formPj.scrollHeight + "px";
                formPj.style.opacity = 1;
                formPf.style.maxHeight = 0;
                formPf.style.opacity = 0;
            }
        };
        
        const handleIeCheckbox = () => {
            if (!isentoCheckbox || !ieInput) return;
            if (isentoCheckbox.checked) {
                ieInput.disabled = true;
                ieInput.value = 'ISENTO';
                ieInput.classList.add('bg-gray-100');
            } else {
                ieInput.disabled = false;
                if (ieInput.value === 'ISENTO') {
                    ieInput.value = '';
                }
                ieInput.classList.remove('bg-gray-100');
            }
        };

        radioPf.addEventListener('change', window.toggleForms);
        radioPj.addEventListener('change', window.toggleForms);
        if (isentoCheckbox) {
            isentoCheckbox.addEventListener('change', handleIeCheckbox);
            handleIeCheckbox();
        }
        
        setTimeout(window.toggleForms, 150);

        signupForm.addEventListener('submit', handleSignupSubmit);
    }
}


async function handleLoginSubmit(event) {
  event.preventDefault();
  const submitButton = event.target.querySelector('button[type="submit"]');
  const originalButtonHtml = submitButton.innerHTML;
  submitButton.disabled = true;
  submitButton.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>A Entrar...`;

  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries()); // { identifier, senha }

  try {
    const response = await fetch(`${API_CONFIG.BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || 'Erro desconhecido');
    }

    // salva a sessão como o site já usa
    localStorage.setItem('loggedInUser', JSON.stringify({
      id: result.user._id,
      token: result.token,
      ...result.user
    }));

    // >>> ADIÇÃO: lembrar (ou apagar) o identificador
    const rememberEl = document.getElementById('remember-me');
    const identifierNow = data.identifier ?? document.getElementById('identifier')?.value ?? '';
    saveRememberIdentifier(identifierNow, !!rememberEl?.checked);
    // <<<

    // modal de sucesso + redirecionamento (seu comportamento atual)
    const modal = document.getElementById('login-success-modal');
    if (modal) {
      modal.classList.remove('hidden');
      let countdown = 3;
      const timerSpan = document.getElementById('login-redirect-timer');
      timerSpan.textContent = `A redirecionar em ${countdown}...`;
      const interval = setInterval(() => {
        countdown--;
        timerSpan.textContent = `A redirecionar em ${countdown}...`;
        if (countdown <= 0) {
          clearInterval(interval);
          window.location.href = '/index.html';
        }
      }, 1000);
    }
  } catch (error) {
    showModal({ title: 'Erro de Login', message: error.message, confirmText: 'Tentar Novamente' });
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = originalButtonHtml;
  }
}

function clearValidationErrors() {
    const signupForm = document.getElementById('signup-form');
    const formPf = document.getElementById('form-pf');
    const formPj = document.getElementById('form-pj');

    if (formPf) formPf.style.maxHeight = 'none';
    if (formPj) formPj.style.maxHeight = 'none';

    signupForm.querySelectorAll('.error-message').forEach(el => {
        el.textContent = '';
        el.classList.remove('show');
    });
    signupForm.querySelectorAll('.input-error').forEach(el => {
        el.classList.remove('input-error');
    });

    if (window.toggleForms) {
      setTimeout(window.toggleForms, 50);
    }
}

function displayValidationError(fieldName, message) {
    const signupForm = document.getElementById('signup-form');
    let field;

    if (fieldName === 'senha' || fieldName === 'confirm_password' || fieldName === 'terms') {
        field = signupForm.querySelector(`[name="${fieldName}"]`);
    } else {
        const radioPf = document.getElementById('radio-pf');
        const formPf = document.getElementById('form-pf');
        const formPj = document.getElementById('form-pj');
        const activeForm = radioPf.checked ? formPf : formPj;
        field = activeForm.querySelector(`[name="${fieldName}"]`);
    }
    
    if (field) {
        field.classList.add('input-error');
        const container = field.closest('div');
        let errorElement = container.querySelector('.error-message');
        if (!errorElement) {
            errorElement = container.parentElement.querySelector('.error-message');
        }

        if (errorElement) {
            errorElement.textContent = message;
            errorElement.classList.add('show');
        }
    }
}


async function handleSignupSubmit(event) {
    event.preventDefault();
    const signupForm = document.getElementById('signup-form');
    const submitButton = signupForm.querySelector('button[type="submit"]');
    const originalButtonHtml = submitButton.innerHTML;
    
    clearValidationErrors();

    submitButton.disabled = true;
    submitButton.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>A Registar...`;
    
    const formData = new FormData(signupForm);
    const data = Object.fromEntries(formData.entries());
    data.tipoConta = document.getElementById('radio-pf').checked ? 'pessoa_fisica' : 'pessoa_juridica';
    
    if (data.tipoConta === 'pessoa_fisica') {
        ['razaoSocial', 'cnpj', 'nomeContato', 'inscricaoEstadual', 'estadoIE', 'isentoIE'].forEach(key => delete data[key]);
        data.email = document.getElementById('email-pf').value;
        data.celular = document.getElementById('celular-pf').value;
        data.telefone = document.getElementById('telefone-pf').value;
    } else { // Pessoa Jurídica
        ['nomeCompleto', 'cpf', 'genero', 'dataNascimento'].forEach(key => delete data[key]);
        data.email = document.getElementById('email-pj').value;
        data.celular = document.getElementById('celular-pj').value;
        data.telefone = document.getElementById('telefone-pj').value;
    }

    try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        const result = await response.json();
        if (!response.ok) {
            const error = new Error('Falha na validação ou erro do servidor');
            error.result = result;
            throw error;
        }
        showSuccessModal(result.message);
    } catch (error) {
        if (error.result && error.result.errors) {
            const formPf = document.getElementById('form-pf');
            const formPj = document.getElementById('form-pj');
           
            if (formPf) formPf.style.maxHeight = 'none';
            if (formPj) formPj.style.maxHeight = 'none';
            
            error.result.errors.forEach(err => {
                displayValidationError(err.path, err.msg);
            });
            
            setTimeout(() => {
                if (window.toggleForms) {
                    window.toggleForms();
                }
            }, 100);

            showModal({ title: 'Atenção', message: 'Por favor, corrija os erros indicados no formulário.', confirmText: 'OK' });
        } else if (error.result && error.result.message) {
             showModal({ title: 'Erro no Registo', message: error.result.message, confirmText: 'Tentar Novamente' });
        } else {
            console.error('Erro de registo:', error);
            showModal({ title: 'Erro Inesperado', message: 'Não foi possível conectar ao servidor. Verifique a sua conexão.', confirmText: 'OK' });
        }
    } finally {
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonHtml;
    }
}

function showSuccessModal(message) {
    const modal = document.getElementById('success-modal');
    if (!modal) return;
    document.getElementById('modal-message').textContent = message;
    modal.classList.remove('hidden');
    let countdown = 3;
    const timerSpan = document.getElementById('redirect-timer');
    timerSpan.textContent = `A redirecionar em ${countdown}...`;
    const interval = setInterval(() => {
        countdown--;
        timerSpan.textContent = `A redirecionar em ${countdown}...`;
        if (countdown <= 0) {
            clearInterval(interval);
            window.location.href = '/pages/login.html';
        }
    }, 1000);
}