// scripts/alterar-senha.js — fluxo de alteração de senha com e-mail ou TOTP
document.addEventListener('DOMContentLoaded', () => {
  const logged = JSON.parse(localStorage.getItem('loggedInUser') || 'null');
  if (!logged?.id || !logged?.token) {
    showModal({ title: 'Atenção', message: 'Faça login para continuar.', confirmText: 'Login', onConfirm: () => location.href = '/pages/login.html' });
    return;
  }

  // elementos
  const nameSpan = document.getElementById('sidebar-username') || document.querySelector('[data-user-name]');
  const emailBadge = document.getElementById('email-status-badge');
  const emailMaskedEl = document.getElementById('email-masked');
  const btnReceber = document.getElementById('btn-receber');

  const methodGroup = document.getElementById('method-group');
  const cardEmail = methodGroup.querySelector('[data-card="email"]');
  const cardTotp  = methodGroup.querySelector('[data-card="totp"]');
  const radioEmail= document.getElementById('method-email');
  const radioTotp = document.getElementById('method-totp');

  // TOTP
  const totpStatusEl = document.getElementById('totp-status');
  const totpSetup = document.getElementById('totp-setup');
  const totpQr = document.getElementById('totp-qr');
  const totpCode = document.getElementById('totp-code');
  const totpVerifyBtn = document.getElementById('totp-verify-btn');

  // estado
  let user = null;
  const headersAuth = { 'Authorization': `Bearer ${logged.token}`, 'Content-Type': 'application/json' };

  function maskEmail(email = '') {
    const [l, d] = String(email).split('@');
    if (!l || !d) return email || '';
    const keep = Math.min(3, l.length);
    return `${l.slice(0, keep)}${'*'.repeat(Math.max(0, l.length - keep))}@${d}`;
  }

  function setSelected(card) {
    [cardEmail, cardTotp].filter(Boolean).forEach(c => c.classList.remove('selected'));
    card?.classList.add('selected');
  }

  function setEmailBadge(verified) {
    if (!emailBadge) return;
    if (verified) {
      emailBadge.textContent = 'Verificado';
      emailBadge.className = 'inline-block text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-700';
      btnReceber.disabled = false; btnReceber.classList.remove('opacity-60','cursor-not-allowed');
    } else {
      emailBadge.textContent = 'Não verificado';
      emailBadge.className = 'inline-block text-xs px-2 py-1 rounded bg-red-100 text-red-700';
    }
  }

  // Remove o cartão SMS (não será utilizado) — caso exista por cache
  try { methodGroup.querySelector('[data-card="sms"]')?.closest('label')?.remove(); } catch (_) {}

  methodGroup.addEventListener('click', (e) => {
    const wrapper = e.target.closest('[data-card]');
    if (!wrapper) return;
    if (wrapper.dataset.card === 'email') {
      radioEmail.checked = true; setSelected(cardEmail); totpSetup?.classList.add('hidden');
      btnReceber?.classList.remove('hidden');
    } else if (wrapper.dataset.card === 'totp') {
      radioTotp.checked = true; setSelected(cardTotp); setupTotp().catch(()=>{});
      btnReceber?.classList.add('hidden');
    }
  });

  async function loadUser() {
    const r = await fetch(`${API_CONFIG.BASE_URL}/users/${logged.id}`, { headers: headersAuth });
    if (!r.ok) throw new Error('Falha ao carregar usuário');
    user = await r.json();
    if (nameSpan) nameSpan.textContent = user?.name || logged?.name || '';
    if (emailMaskedEl) emailMaskedEl.textContent = maskEmail(user.email);
    if (totpStatusEl) totpStatusEl.textContent = user.totpEnabled ? 'Ativado neste dispositivo' : 'Proteja sua conta com Google/Microsoft Authenticator';
    setEmailBadge(!!user.emailVerified);
    radioEmail.checked = true; setSelected(cardEmail);
  }

  async function setupTotp() {
    if (!totpSetup) return;
    totpSetup.classList.remove('hidden');
    // Se já estiver habilitado, não gere novo QR. Só campo de código
    if (user?.totpEnabled) {
      if (totpQr) { totpQr.src = ''; totpQr.classList.add('hidden'); }
      const instr = document.getElementById('totp-instr-1');
      if (instr) instr.classList.add('hidden');
      const secretText = document.getElementById('totp-secret-text');
      if (secretText) secretText.textContent = '';
      return;
    }
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/auth/totp/setup`, { method: 'POST', headers: headersAuth });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(data.otpauth)}`;
      if (totpQr) { totpQr.src = qrUrl; totpQr.classList.remove('hidden'); }
      const instr = document.getElementById('totp-instr-1');
      if (instr) instr.classList.remove('hidden');
      const secretText = document.getElementById('totp-secret-text');
      if (secretText) secretText.textContent = `Se precisar, código secreto: ${data.secret}`;
    } catch {
      showToast?.('Falha ao gerar QR do autenticador', 'error');
    }
  }

  function openChangePasswordModal(authToken) {
    const w = document.createElement('div');
    w.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
    w.innerHTML = `
      <div class="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b">
          <h3 class="text-lg font-semibold">Alterar senha</h3>
          <button id="pw-close" class="text-gray-500 hover:text-gray-700"><i class="fa-solid fa-xmark text-xl"></i></button>
        </div>
        <div class="p-5 space-y-3">
          <input id="pw1" type="password" class="w-full border rounded px-3 py-2" placeholder="Nova senha" />
          <input id="pw2" type="password" class="w-full border rounded px-3 py-2" placeholder="Confirmar nova senha" />
          <button id="pw-save" class="w-full rounded-lg bg-primary text-white py-2">Salvar</button>
          <p id="pw-err" class="text-sm text-red-600"></p>
        </div>
      </div>`;
    document.body.appendChild(w);
    const close = ()=> w.remove();
    w.addEventListener('click', (e)=>{ if (e.target===w) close(); });
    w.querySelector('#pw-close').addEventListener('click', close);
    w.querySelector('#pw-save').addEventListener('click', async ()=>{
      const p1 = w.querySelector('#pw1').value;
      const p2 = w.querySelector('#pw2').value;
      const err = w.querySelector('#pw-err');
      err.textContent = '';
      if (p1 !== p2) { err.textContent = 'As senhas não coincidem.'; return; }
      const strong = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
      if (!strong.test(p1)) { err.textContent = 'A senha deve ter 8+ caracteres, com maiúscula, minúscula e número.'; return; }
      try {
        const tokenToUse = authToken || (logged?.token || '');
        const resp = await fetch(`${API_CONFIG.BASE_URL}/auth/password/change`, { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${tokenToUse}` }, body: JSON.stringify({ password: p1 }) });
        const jr = await resp.json().catch(()=>({}));
        if (!resp.ok || !jr.ok) throw new Error(jr.message || 'Falha ao alterar a senha');
        showToast?.('Senha alterada com sucesso!', 'success');
        close();
      } catch(e) {
        showToast?.(e.message || 'Falha ao alterar senha', 'error');
      }
    });
  }

  totpVerifyBtn?.addEventListener('click', async () => {
    const token = (totpCode?.value || '').trim();
    if (token.length < 6) { showToast?.('Digite o código de 6 dígitos', 'warning'); return; }
    try {
      const r = await fetch(`${API_CONFIG.BASE_URL}/auth/totp/verify`, { method: 'POST', headers: headersAuth, body: JSON.stringify({ token }) });
      const j = await r.json().catch(()=>({}));
      if (!r.ok || !j.ok) throw new Error(j.message || 'Código inválido');
      showToast?.('Verificado com sucesso.', 'success');
      if (totpStatusEl) totpStatusEl.textContent = 'Ativado neste dispositivo';
      if (user) user.totpEnabled = true;
      openChangePasswordModal();
    } catch (e) {
      showToast?.(e.message || 'Falha ao verificar TOTP', 'error');
    }
  });

  btnReceber?.addEventListener('click', async () => {
    // Botão agora só serve para e-mail; TOTP esconde o botão
    if (!user?.emailVerified) { showToast?.('Seu e-mail não está verificado.', 'warning'); return; }
    btnReceber.disabled = true; btnReceber.classList.add('opacity-60','cursor-not-allowed');
    try {
      const w = document.createElement('div');
      w.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
      w.innerHTML = `
        <div class="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
          <div class="flex items-center justify-between px-5 py-4 border-b">
            <h3 class="text-lg font-semibold">Verificar e-mail</h3>
            <button id="em-close" class="text-gray-500 hover:text-gray-700"><i class="fa-solid fa-xmark text-xl"></i></button>
          </div>
          <div class="p-5">
            <p id="em-msg" class="text-gray-600 text-sm mb-3">Enviando código...</p>
            <input id="em-code" maxlength="6" inputmode="numeric" class="w-full border rounded px-3 py-2" placeholder="000000" />
            <button id="em-ok" class="mt-3 w-full rounded-lg bg-primary text-white py-2">Validar</button>
          </div>
        </div>`;
      document.body.appendChild(w);
      const close = ()=> w.remove();
      w.addEventListener('click', (e)=>{ if (e.target===w) close(); });
      w.querySelector('#em-close').addEventListener('click', close);

      // Envia código por e-mail (6 dígitos)
      await fetch(`${API_CONFIG.BASE_URL}/auth/quick/email/send`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ identifier: user?.email }) });
      const msg = w.querySelector('#em-msg'); if (msg) msg.textContent = '';

      w.querySelector('#em-ok').addEventListener('click', async ()=>{
        const code = w.querySelector('#em-code').value.trim();
        if (code.length < 6) { showToast?.('Digite o código de 6 dígitos.', 'warning'); return; }
        const resp = await fetch(`${API_CONFIG.BASE_URL}/auth/quick/email/verify`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ identifier: user?.email, code }) });
        const jr = await resp.json().catch(()=>({}));
        if (!resp.ok || !jr.ok) { showToast?.(jr.message || 'Código inválido.', 'error'); return; }
        close();
        openChangePasswordModal(jr.token);
      });
    } catch (e) {
      showToast?.(e.message || 'Erro ao processar sua solicitação.', 'error');
    } finally {
      btnReceber.disabled = false; btnReceber.classList.remove('opacity-60','cursor-not-allowed');
    }
  });

  loadUser().catch(() => showModal({ title: 'Erro', message: 'Não foi possível carregar seus dados.' }));
});

