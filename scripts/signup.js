(() => {
  "use strict";
  const form = document.querySelector(
    '#signup-form[data-signup-layout="modern"]',
  );
  if (!form) return;
  const password = document.getElementById("password");
  for (const id of ["password", "confirm_password"]) {
    const input = document.getElementById(id);
    const wrap = document.createElement("div");
    wrap.className = "signup-password-wrap";
    input.before(wrap);
    wrap.append(input);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "signup-password-toggle";
    button.textContent = "Mostrar";
    button.setAttribute("aria-controls", id);
    button.setAttribute("aria-pressed", "false");
    const field = id === "password" ? "senha" : "confirmação de senha";
    button.setAttribute("aria-label", "Mostrar " + field);
    button.addEventListener("click", () => {
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      button.textContent = visible ? "Ocultar" : "Mostrar";
      button.setAttribute("aria-pressed", String(visible));
      button.setAttribute(
        "aria-label",
        (visible ? "Ocultar " : "Mostrar ") + field,
      );
    });
    wrap.append(button);
  }
  function updateRules() {
    const value = password.value;
    const rules = {
      length: value.length >= 8,
      upper: /[A-Z]/.test(value),
      lower: /[a-z]/.test(value),
      number: /\d/.test(value),
    };
    for (const [name, met] of Object.entries(rules)) {
      const item = document.querySelector(
        '[data-password-rule="' + name + '"]',
      );
      item.classList.toggle("is-met", met);
      item.querySelector("span").textContent = met ? "✓" : "○";
    }
  }
  password.addEventListener("input", updateRules);
  password.addEventListener("change", updateRules);
  updateRules();
  // The preview never submits registration or sends verification codes.
  if (window.CATALOG_PREVIEW) {
    document.getElementById("signup-preview-note").hidden = false;
    const inform = () => {
      const target = document.getElementById("signup-feedback");
      target.textContent =
        "Esta é uma prévia para conferir a tela. Nenhum cadastro foi enviado e nenhum código foi solicitado. O envio permanece disponível no site oficial.";
      target.hidden = false;
      target.focus();
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    form.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        inform();
      },
      true,
    );
    for (const id of ["completion-send-code", "completion-verify-code"])
      document.getElementById(id).addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          inform();
        },
        true,
      );
  }
})();
