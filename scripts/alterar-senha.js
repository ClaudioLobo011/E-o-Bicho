(() => {
  "use strict";
  function initializeSecurity() {
    const $ = (id) => document.getElementById(id),
      group = $("method-group");
    if (!group || group.dataset.initialized) return;
    group.dataset.initialized = "true";
    const preview = () => !!window.CATALOG_PREVIEW;
    const dialog = $("password-dialog");
    let user = null,
      ownerId = "",
      busy = false,
      setupData = null,
      emailSent = false,
      verifiedToken = null,
      previousFocus = null,
      overflow = null,
      loadRevision = 0;
    function session() {
      try {
        const value = JSON.parse(localStorage.getItem("loggedInUser"));
        return value?.id && value?.token ? value : null;
      } catch {
        return null;
      }
    }
    function message(text = "") {
      $("security-feedback").textContent = text;
      $("security-feedback").hidden = !text;
    }
    function maskEmail(email) {
      const parts = String(email || "").split("@");
      if (parts.length !== 2 || !parts[0] || !parts[1])
        return "E-mail não informado";
      const keep = Math.min(3, parts[0].length);
      return (
        parts[0].slice(0, keep) +
        "*".repeat(Math.max(1, parts[0].length - keep)) +
        "@" +
        parts[1]
      );
    }
    function controls() {
      for (const id of [
        "method-email",
        "method-totp",
        "btn-receber",
        "email-send-verification",
        "totp-start",
        "totp-verify-btn",
        "em-ok",
        "em-close",
        "pw-save",
        "pw-close",
      ])
        $(id).disabled = busy || !user;
      $("security-retry").disabled = busy;
      $("btn-receber").disabled =
        busy || !user || (!preview() && (!user.emailVerified || !user.email));
      $("em-ok").disabled = busy || !emailSent;
      $("totp-verify-btn").disabled =
        busy || !user || (!user.totpEnabled && !setupData);
      $("em-code").disabled = busy;
      $("totp-code").disabled = busy;
      for (const id of ["pw1", "pw2", "pw-save"])
        $(id).disabled = busy || preview() || !verifiedToken;
      for (const button of document.querySelectorAll("[data-password-toggle]"))
        button.disabled = busy || preview() || !verifiedToken;
    }
    function setBusy(value) {
      busy = value;
      controls();
    }
    async function request(
      path,
      { method = "POST", body, publicEndpoint = false, authToken } = {},
    ) {
      const current = session();
      if (!current || current.id !== ownerId)
        throw Error(
          "Entre novamente para continuar. Seu cadastro foi preservado.",
        );
      if (preview() && method !== "GET")
        throw Error("As alterações de segurança estão bloqueadas na prévia.");
      const headers = { "Content-Type": "application/json" };
      if (!publicEndpoint)
        headers.Authorization = "Bearer " + (authToken || current.token);
      const response = await fetch(API_CONFIG.BASE_URL + path, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Error(
          response.status === 401
            ? "Entre novamente para continuar. Seu cadastro foi preservado."
            : result.message ||
                "Não foi possível concluir a solicitação. Tente novamente.",
        );
      return result;
    }
    function selectedMethod() {
      return $("method-totp").checked ? "totp" : "email";
    }
    function showMethod() {
      const totp = selectedMethod() === "totp";
      $("security-email-panel").hidden = totp;
      $("totp-setup").hidden = !totp;
      for (const card of group.querySelectorAll("[data-card]"))
        card.classList.toggle(
          "selected",
          card.dataset.card === selectedMethod(),
        );
      if (totp) {
        $("totp-start").hidden = !!user?.totpEnabled || !!setupData;
        $("totp-code-form").hidden = !user?.totpEnabled && !setupData;
        $("totp-instr-1").textContent = user?.totpEnabled
          ? "Abra o aplicativo autenticador vinculado à sua conta."
          : setupData
            ? "Escaneie o QR ou use a chave manual e confirme o primeiro código."
            : "Configure o aplicativo para receber os códigos de segurança.";
        if (user?.totpEnabled) {
          $("totp-qr-panel").hidden = true;
          $("totp-qr").removeAttribute("src");
          $("totp-secret-text").textContent = "";
        }
      }
      controls();
    }
    async function loadUser() {
      const current = session(),
        ticket = ++loadRevision;
      if (!current) {
        user = null;
        controls();
        message("Entre na sua conta para consultar as opções de segurança.");
        $("security-login").hidden = false;
        return;
      }
      ownerId = current.id;
      setBusy(true);
      message("Consultando as opções de segurança da sua conta…");
      $("security-retry").hidden = true;
      try {
        const result = await request("/users/" + encodeURIComponent(ownerId), {
          method: "GET",
        });
        if (ticket !== loadRevision) return;
        if (!result || typeof result !== "object" || Array.isArray(result))
          throw Error("Não foi possível confirmar as opções da conta.");
        user = result;
        setupData = null;
        emailSent = false;
        $("email-masked").textContent = maskEmail(user.email);
        $("email-status-badge").textContent = user.emailVerified
          ? "Verificado"
          : "Não verificado";
        $("email-status-badge").classList.toggle(
          "is-verified",
          !!user.emailVerified,
        );
        $("totp-status").textContent = user.totpEnabled
          ? "Ativado na sua conta"
          : "Configuração disponível";
        $("security-email-help").textContent = user.emailVerified
          ? "O código será enviado ao e-mail verificado da sua conta."
          : "Confirme seu e-mail para usar esta opção. Você também pode escolher o app autenticador.";
        $("email-send-verification").hidden = !!user.emailVerified;
        $("btn-receber").textContent = preview()
          ? "Ver prévia do código"
          : "Receber código por e-mail";
        $("method-email").checked = true;
        $("method-totp").checked = false;
        showMethod();
        message();
        $("security-login").hidden = true;
      } catch (error) {
        user = null;
        message(error.message);
        $("security-retry").hidden = false;
      } finally {
        if (ticket === loadRevision) setBusy(false);
      }
    }
    group.addEventListener("change", () => {
      if (busy || !user) return;
      verifiedToken = null;
      showMethod();
      message();
    });
    $("security-retry").addEventListener("click", loadUser);
    $("email-send-verification").addEventListener("click", async () => {
      if (busy || !user) return;
      if (preview()) {
        message("Prévia: nenhum e-mail de verificação foi enviado.");
        return;
      }
      setBusy(true);
      try {
        const result = await request("/auth/email/send-verification");
        if (!result.ok)
          throw Error(
            result.message || "Não foi possível enviar a verificação.",
          );
        message(
          "Enviamos a verificação. Confira seu e-mail e depois use Tentar novamente para atualizar o status.",
        );
        $("security-retry").hidden = false;
      } catch (error) {
        message(error.message);
      } finally {
        setBusy(false);
      }
    });
    $("btn-receber").addEventListener("click", async () => {
      if (busy || !user || (!preview() && (!user.emailVerified || !user.email)))
        return;
      setBusy(true);
      message();
      try {
        if (!preview()) {
          const result = await request("/auth/quick/email/send", {
            publicEndpoint: true,
            body: { identifier: user.email },
          });
          if (!result.ok)
            throw Error(result.message || "Não foi possível enviar o código.");
        }
        emailSent = true;
        $("email-verify-form").hidden = false;
        $("em-code").value = "";
        $("em-msg").textContent = preview()
          ? "Prévia: digite 6 dígitos para visualizar a etapa seguinte. Nenhum código foi enviado."
          : "Código enviado. Confira o e-mail, inclusive a pasta de spam. Ele é válido por 10 minutos.";
        $("btn-receber").textContent = preview()
          ? "Reabrir prévia do código"
          : "Reenviar código";
      } catch (error) {
        message(error.message);
      } finally {
        setBusy(false);
        if (emailSent) $("em-code").focus({ preventScroll: true });
      }
    });
    $("em-close").addEventListener("click", () => {
      if (!busy) {
        $("email-verify-form").hidden = true;
        $("em-code").value = "";
        emailSent = false;
        controls();
        $("btn-receber").focus({ preventScroll: true });
      }
    });
    async function renderQr(payload) {
      const demo = preview();
      $("totp-qr-panel").hidden = false;
      $("totp-manual").hidden = demo;
      $("totp-secret-text").textContent = demo ? "" : payload.secret;
      try {
        if (!window.LocalQRCode) throw Error("QR indisponível");
        const svg = await LocalQRCode.toString(
          demo
            ? "Prévia visual E o Bicho. Não configure este código no autenticador."
            : payload.otpauth,
          { type: "svg", width: 160, margin: 4, errorCorrectionLevel: "M" },
        );
        $("totp-qr").src =
          "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
        $("totp-qr").hidden = false;
      } catch {
        $("totp-qr").hidden = true;
        if (!demo) {
          $("totp-manual").open = true;
          message(
            "O QR não carregou. Use a chave manual para configurar seu aplicativo.",
          );
        }
      }
      if (demo)
        $("totp-instr-1").textContent =
          "QR demonstrativo. Não configure seu app com ele; nenhum autenticador será ativado.";
    }
    $("totp-start").addEventListener("click", async () => {
      if (busy || !user || user.totpEnabled) return;
      setBusy(true);
      message();
      try {
        const result = preview()
          ? { demo: true }
          : await request("/auth/totp/setup");
        if (
          !preview() &&
          (!result.secret ||
            typeof result.otpauth !== "string" ||
            !result.otpauth.startsWith("otpauth://"))
        )
          throw Error(
            "Não foi possível preparar o autenticador. Tente novamente.",
          );
        setupData = result;
        showMethod();
        await renderQr(result);
      } catch (error) {
        message(error.message);
      } finally {
        setBusy(false);
      }
    });
    function validCode(value) {
      return /^\d{6}$/.test(value);
    }
    function openPassword(token) {
      verifiedToken = token;
      previousFocus = document.activeElement;
      $("password-form").reset();
      $("pw-err").textContent = "";
      $("pw-err").hidden = true;
      $("password-preview-note").hidden = !preview();
      overflow = {
        html: document.documentElement.style.overflow,
        body: document.body.style.overflow,
      };
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      controls();
      updateRules();
      if (!dialog.open) dialog.showModal();
    }
    $("email-verify-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !emailSent || !user) return;
      const code = $("em-code").value.trim();
      if (!validCode(code)) {
        $("em-msg").textContent = "Digite os 6 dígitos numéricos do código.";
        return;
      }
      setBusy(true);
      try {
        const result = preview()
          ? { ok: true }
          : await request("/auth/quick/email/verify", {
              publicEndpoint: true,
              body: { identifier: user.email, code },
            });
        if (
          !result.ok ||
          (!preview() && (!result.token || typeof result.token !== "string"))
        )
          throw Error(result.message || "Não foi possível confirmar o código.");
        $("em-code").value = "";
        openPassword(preview() ? null : result.token);
      } catch (error) {
        $("em-msg").textContent = error.message;
      } finally {
        setBusy(false);
        if (dialog.open && !preview()) $("pw1").focus({ preventScroll: true });
      }
    });
    $("totp-code-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !user || (!user.totpEnabled && !setupData)) return;
      const token = $("totp-code").value.trim();
      if (!validCode(token)) {
        message("Digite os 6 dígitos numéricos do aplicativo autenticador.");
        return;
      }
      setBusy(true);
      message();
      try {
        const result = preview()
          ? { ok: true }
          : await request("/auth/totp/verify", { body: { token } });
        if (!result.ok || result.enabled === false)
          throw Error(result.message || "Código inválido. Tente novamente.");
        if (!preview()) {
          user.totpEnabled = true;
          $("totp-status").textContent = "Ativado na sua conta";
          setupData = null;
          $("totp-secret-text").textContent = "";
          $("totp-qr").removeAttribute("src");
          $("totp-qr-panel").hidden = true;
        }
        $("totp-code").value = "";
        openPassword(preview() ? null : session().token);
      } catch (error) {
        message(error.message);
      } finally {
        setBusy(false);
        if (dialog.open && !preview()) $("pw1").focus({ preventScroll: true });
      }
    });
    function updateRules() {
      const value = $("pw1").value,
        met = {
          length: value.length >= 8,
          upper: /[A-Z]/.test(value),
          lower: /[a-z]/.test(value),
          number: /\d/.test(value),
        };
      for (const [key, valid] of Object.entries(met))
        document
          .querySelector('[data-rule="' + key + '"]')
          .classList.toggle("is-met", valid);
    }
    $("pw1").addEventListener("input", updateRules);
    for (const button of document.querySelectorAll("[data-password-toggle]"))
      button.addEventListener("click", () => {
        const input = $(button.dataset.passwordToggle),
          visible = input.type === "password";
        input.type = visible ? "text" : "password";
        button.textContent = visible ? "Ocultar" : "Mostrar";
        button.setAttribute("aria-pressed", String(visible));
        button.setAttribute(
          "aria-label",
          (visible ? "Ocultar " : "Mostrar ") +
            (input.id === "pw1" ? "nova senha" : "confirmação de senha"),
        );
      });
    $("password-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      const error = $("pw-err");
      error.hidden = false;
      if (preview()) {
        error.textContent = "A alteração de senha está desativada na prévia.";
        return;
      }
      if (!verifiedToken) {
        error.textContent =
          "Confirme sua identidade novamente antes de continuar.";
        return;
      }
      const password = $("pw1").value;
      if (password !== $("pw2").value) {
        error.textContent = "As senhas não coincidem.";
        return;
      }
      if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
        error.textContent =
          "Use ao menos 8 caracteres, com letra maiúscula, minúscula e número.";
        return;
      }
      setBusy(true);
      error.textContent = "";
      try {
        const result = await request("/auth/password/change", {
          authToken: verifiedToken,
          body: { password },
        });
        if (!result.ok)
          throw Error(result.message || "Não foi possível alterar a senha.");
        dialog.close();
        message("Senha alterada com sucesso.");
      } catch (failure) {
        error.textContent = failure.message;
      } finally {
        setBusy(false);
      }
    });
    $("pw-close").addEventListener("click", () => {
      if (!busy) dialog.close();
    });
    dialog.addEventListener("cancel", (event) => {
      if (busy) event.preventDefault();
    });
    dialog.addEventListener("close", () => {
      verifiedToken = null;
      $("password-form").reset();
      for (const id of ["pw1", "pw2"]) $(id).type = "password";
      for (const button of document.querySelectorAll(
        "[data-password-toggle]",
      )) {
        button.textContent = "Mostrar";
        button.setAttribute("aria-pressed", "false");
        button.setAttribute(
          "aria-label",
          "Mostrar " +
            (button.dataset.passwordToggle === "pw1"
              ? "nova senha"
              : "confirmação de senha"),
        );
      }
      updateRules();
      if (overflow) {
        document.documentElement.style.overflow = overflow.html;
        document.body.style.overflow = overflow.body;
        overflow = null;
      }
      if (previousFocus?.isConnected && !previousFocus.disabled)
        previousFocus.focus({ preventScroll: true });
      controls();
    });
    dialog.addEventListener("click", (event) => {
      if (busy || event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    });
    $("security-preview-note").hidden = !preview();
    controls();
    loadUser();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initializeSecurity, {
      once: true,
    });
  else initializeSecurity();
})();
