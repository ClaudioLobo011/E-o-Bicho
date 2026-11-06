(() => {
  function initializePets() {
    // --- ReferÃƒÂªncias aos elementos do DOM ---
    const petsListContainer = document.getElementById("pets-list-container");
    const addPetBtnContainer = document.getElementById(
      "add-pet-button-container",
    );
    const petFormContainer = document.getElementById("pet-form-container");
    const addPetBtn = document.getElementById("add-pet-btn");
    const petForm = document.getElementById("new-pet-form");
    const cancelPetBtn = document.getElementById("cancel-pet-btn");
    const petTypeSelect = document.getElementById("pet-type");
    const breedInput = document.getElementById("pet-raca");
    const porteSelect = document.getElementById("pet-porte");
    const hiddenPetIdInput = document.getElementById("pet-id");
    if (!petForm || petForm.dataset.initialized) return;
    petForm.dataset.initialized = "true";
    let awesompleteInstance;
    let SPECIES_MAP = null; // { cachorro:{portes:{mini:[],...}, all:[], map:{breed->porte}}, gato:[...], passaro:[...], peixe:[...], roedor:[...], lagarto:[...], tartaruga:[...] }

    // Helpers para normalizar strings (ignora acentos/maiÃƒÂºsculas)
    const norm = (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
    const normSize = (s) => {
      const k = norm(s);
      if (k.startsWith("mini")) return "mini";
      if (k.startsWith("peq")) return "pequeno";
      if (k.startsWith("med")) return "medio";
      if (k.startsWith("gra")) return "grande";
      if (k.startsWith("gig")) return "gigante";
      return "medio";
    };

    // Corrige sequÃªncias comuns de texto corrompidas por encoding (UTF-8 vs ISO-8859-1)
    function fixEncoding(s) {
      if (!s) return s;
      return String(s)
        .replace(/ÃƒÂ¡/g, "Ã¡")
        .replace(/ÃƒÂ¢/g, "Ã¢")
        .replace(/ÃƒÂ£/g, "Ã£")
        .replace(/ÃƒÂ¤/g, "Ã¤")
        .replace(/ÃƒÂ/g, "Ã")
        .replace(/Ãƒâ€š/g, "Ã‚")
        .replace(/ÃƒÆ’/g, "Ãƒ")
        .replace(/ÃƒÂ©/g, "Ã©")
        .replace(/ÃƒÂª/g, "Ãª")
        .replace(/ÃƒÂ¨/g, "Ã¨")
        .replace(/Ãƒâ€°/g, "Ã‰")
        .replace(/ÃƒÅ /g, "ÃŠ")
        .replace(/ÃƒÂ­/g, "Ã­")
        .replace(/ÃƒÂ¬/g, "Ã¬")
        .replace(/ÃƒÂ/g, "Ã")
        .replace(/ÃƒÂ³/g, "Ã³")
        .replace(/ÃƒÂ´/g, "Ã´")
        .replace(/ÃƒÂµ/g, "Ãµ")
        .replace(/Ãƒâ€œ/g, "Ã“")
        .replace(/Ãƒâ€/g, "Ã”")
        .replace(/ÃƒÂº/g, "Ãº")
        .replace(/ÃƒÂ¼/g, "Ã¼")
        .replace(/ÃƒÅ¡/g, "Ãš")
        .replace(/ÃƒÂ§/g, "Ã§")
        .replace(/ÃƒÂ‡/g, "Ã‡")
        .replace(/ÃƒÂ /g, "Ã ")
        .replace(/ÃƒÂ¸/g, "Ã¸")
        .replace(/Ã‚Âº/g, "Âº")
        .replace(/Ã‚Âª/g, "Âª")
        .replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“/g, "â€“")
        .replace(/Ã¢â‚¬â€œ/g, "â€“")
        .replace(/Ã¢â‚¬â€/g, "â€”")
        .replace(/Ã¢â‚¬Ëœ/g, "â€˜")
        .replace(/Ã¢â‚¬â„¢/g, "â€™")
        .replace(/Ã¢â‚¬Å“/g, "â€œ")
        .replace(/Ã¢â‚¬Â/g, "â€")
        .replace(/Ã¢â‚¬Â¢/g, "â€¢")
        .replace(/Ã¢â‚¬Â¦/g, "â€¦");
    }

    async function loadSpeciesMap() {
      if (SPECIES_MAP) return SPECIES_MAP;
      const base = window.basePath || "../";
      const jsonUrl = window.CATALOG_PREVIEW
        ? "/scripts/storefront/pet-racas.json"
        : base + "data/racas.json";
      const legacyUrl = base + "data/Racas-leitura.js";

      const cleanList = (body) =>
        body
          .split(/\n+/)
          .map((x) => x.trim())
          .filter((x) => x && !x.startsWith("//") && x !== "...")
          .map((x) => x.replace(/\*.*?\*/g, ""))
          .map((x) => x.replace(/\s*\(duplicata.*$/i, ""))
          .map((x) =>
            x.replace(/\s*[—-].*$/, "").replace(/\s*-\s*registro.*$/i, ""),
          );

      const buildFromJson = (payload) => {
        if (!payload || typeof payload !== "object")
          throw new Error("payload inválido");
        const species = {};
        const dogPayload = payload.cachorro || {};
        const portes = dogPayload.portes || {};
        const dogMap = {
          mini: Array.from(new Set(portes.mini || [])),
          pequeno: Array.from(new Set(portes.pequeno || [])),
          medio: Array.from(new Set(portes.medio || [])),
          grande: Array.from(new Set(portes.grande || [])),
          gigante: Array.from(new Set(portes.gigante || [])),
        };
        const dogAll = Array.from(
          new Set(
            dogPayload.all || [
              ...dogMap.mini,
              ...dogMap.pequeno,
              ...dogMap.medio,
              ...dogMap.grande,
              ...dogMap.gigante,
            ],
          ),
        );
        const dogLookup = {};
        const dogMapPayload = dogPayload.map || {};
        dogAll.forEach((nome) => {
          const normalized = norm(nome);
          const porte =
            dogMapPayload[normalized] ||
            dogMapPayload[nome] ||
            (dogMap.mini.includes(nome)
              ? "mini"
              : dogMap.pequeno.includes(nome)
                ? "pequeno"
                : dogMap.medio.includes(nome)
                  ? "medio"
                  : dogMap.grande.includes(nome)
                    ? "grande"
                    : "gigante");
          dogLookup[normalized] = porte;
        });
        species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

        const simples = [
          "gato",
          "passaro",
          "peixe",
          "roedor",
          "lagarto",
          "tartaruga",
        ];
        simples.forEach((tipo) => {
          const arr = Array.isArray(payload[tipo]) ? payload[tipo] : [];
          species[tipo] = Array.from(new Set(arr.filter(Boolean)));
        });
        return species;
      };

      const buildFromLegacy = (txt) => {
        if (!txt) throw new Error("conteúdo vazio");
        const species = {};
        let dogMap = {
          mini: [],
          pequeno: [],
          medio: [],
          grande: [],
          gigante: [],
        };
        const reDogGlobal =
          /porte[_\s-]?(mini|pequeno|medio|grande|gigante)\s*{([\s\S]*?)}\s*/gi;
        let m;
        while ((m = reDogGlobal.exec(txt))) {
          const key = m[1].toLowerCase();
          const list = cleanList(m[2]);
          dogMap[key] = Array.from(new Set(list));
        }
        const dogAll = Array.from(
          new Set([
            ...dogMap.mini,
            ...dogMap.pequeno,
            ...dogMap.medio,
            ...dogMap.grande,
            ...dogMap.gigante,
          ]),
        );
        const dogLookup = {};
        dogAll.forEach((n) => {
          const k = norm(n);
          dogLookup[k] = dogMap.mini.includes(n)
            ? "mini"
            : dogMap.pequeno.includes(n)
              ? "pequeno"
              : dogMap.medio.includes(n)
                ? "medio"
                : dogMap.grande.includes(n)
                  ? "grande"
                  : "gigante";
        });
        species.cachorro = { portes: dogMap, all: dogAll, map: dogLookup };

        const simpleSpecies = [
          "gatos",
          "gato",
          "passaros",
          "passaro",
          "peixes",
          "peixe",
          "roedores",
          "roedor",
          "lagartos",
          "lagarto",
          "tartarugas",
          "tartaruga",
        ];
        for (const sp of simpleSpecies) {
          const match = new RegExp(sp + "\\s*{([\\s\\S]*?)}", "i").exec(txt);
          if (!match) continue;
          const list = cleanList(match[1]);
          const singular = /roedores$/i.test(sp)
            ? "roedor"
            : /gatos$/i.test(sp)
              ? "gato"
              : /passaros$/i.test(sp)
                ? "passaro"
                : /peixes$/i.test(sp)
                  ? "peixe"
                  : /lagartos$/i.test(sp)
                    ? "lagarto"
                    : /tartarugas$/i.test(sp)
                      ? "tartaruga"
                      : sp.replace(/s$/, "");
          species[singular] = Array.from(new Set(list));
        }
        return species;
      };

      try {
        const res = await fetch(jsonUrl, {
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          SPECIES_MAP = buildFromJson(await res.json());
          return SPECIES_MAP;
        }
        if (res.status && res.status !== 404) {
          console.warn("pets: falha ao obter racas.json", res.status);
        }
      } catch (err) {
        console.warn("pets: erro ao ler racas.json", err);
      }

      try {
        const res = await fetch(legacyUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const txt = await res.text();
        SPECIES_MAP = buildFromLegacy(txt);
        return SPECIES_MAP;
      } catch (e) {
        console.warn("Falha ao ler Racas-leitura.js", e);
        SPECIES_MAP = null;
        return null;
      }
    }

    function setPorteFromBreedIfDog() {
      if (!porteSelect) return;
      const isDog = petTypeSelect && norm(petTypeSelect.value) === "cachorro";
      if (!isDog) return;
      const map = SPECIES_MAP?.cachorro?.map;
      const b = norm(breedInput?.value || "");
      const k = map ? map[b] : null;
      const desired = k || "medio";
      // encontra a option pelo texto (normalizado)
      const opts = Array.from(porteSelect.options || []);
      const match = opts.find((o) => normSize(o.textContent) === desired);
      if (match) porteSelect.value = match.value || match.textContent;
    }

    function syncPorteDisabled() {
      if (!porteSelect) return;
      const isDog = petTypeSelect && norm(petTypeSelect.value) === "cachorro";
      // Nunca esconder; apenas bloquear com o valor apropriado
      porteSelect.disabled = true;
      if (isDog) {
        setPorteFromBreedIfDog();
      } else {
        const none = Array.from(porteSelect.options).find((o) =>
          (o.textContent || "").toLowerCase().includes("sem porte"),
        );
        if (none) porteSelect.value = none.value || none.textContent;
      }
    }

    // --- Funções de Visibilidade do Formulário ---

    let formReturnFocus = null,
      formOverflow = null,
      formFocusPending = false;
    function restoreFormFocus() {
      if (!formFocusPending || busy) return;
      const target = formReturnFocus?.isConnected ? formReturnFocus : addPetBtn;
      if (target.disabled) return;
      target.focus({ preventScroll: true });
      formFocusPending = false;
    }
    const showForm = () => {
      addPetBtnContainer.classList.add("hidden");
      petFormContainer.classList.remove("hidden");
      document.getElementById("pet-form-title").textContent =
        hiddenPetIdInput.value
          ? "Editar " +
            (document.getElementById("pet-name").value || "cadastro do pet")
          : "Adicionar pet";
      message("", true);
      if (!petFormContainer.open) {
        formFocusPending = false;
        formOverflow = {
          html: document.documentElement.style.overflow,
          body: document.body.style.overflow,
        };
        document.documentElement.style.overflow = "hidden";
        document.body.style.overflow = "hidden";
        petFormContainer.showModal();
        petFormContainer.querySelector(".pets-form-body").scrollTop = 0;
      }
      if (!busy)
        document.getElementById("pet-name").focus({ preventScroll: true });
    };
    const finishForm = () => {
      editRevision++;
      petFormContainer.classList.add("hidden");
      addPetBtnContainer.classList.remove("hidden");
      petForm.reset();
      hiddenPetIdInput.value = "";
      message("", true);
      syncPorteDisabled();
      if (formOverflow) {
        document.documentElement.style.overflow = formOverflow.html;
        document.body.style.overflow = formOverflow.body;
        formOverflow = null;
      }
      formFocusPending = true;
      restoreFormFocus();
    };
    const hideForm = () => {
      if (petFormContainer.open) petFormContainer.close();
      else finishForm();
    };
    petFormContainer.addEventListener("close", finishForm);
    petFormContainer.addEventListener("cancel", (event) => {
      if (busy) event.preventDefault();
    });
    petFormContainer.addEventListener("click", (event) => {
      if (busy || event.target !== petFormContainer) return;
      const rect = petFormContainer.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        hideForm();
    });

    function normalizeStaticLabels() {
      try {
        const sexoSel = document.getElementById("pet-sexo");
        if (sexoSel) {
          Array.from(sexoSel.options).forEach((o) => {
            if (/Fêmea/i.test(o.textContent)) o.textContent = "Fêmea";
          });
        }
        if (porteSelect) {
          let none = Array.from(porteSelect.options).find((o) =>
            (o.textContent || "").toLowerCase().includes("sem porte"),
          );
          if (!none) {
            none = document.createElement("option");
            none.textContent = "Sem porte definido";
            none.value = "Sem porte definido";
            porteSelect.insertBefore(none, porteSelect.firstChild);
          }
          Array.from(porteSelect.options).forEach((o) => {
            if (/Médio/i.test(o.textContent)) o.textContent = "Médio";
          });
        }
      } catch (_) {}
    }

    // Garante que o select de tipos tenha todas as opções desejadas
    function ensurePetTypeOptions() {
      if (!petTypeSelect) return;
      const want = [
        ["cachorro", "Cachorro"],
        ["gato", "Gato"],
        ["passaro", "Pássaro"],
        ["peixe", "Peixe"],
        ["roedor", "Roedor"],
        ["lagarto", "Lagarto"],
        ["tartaruga", "Tartaruga"],
      ];
      const existing = new Set(
        Array.from(petTypeSelect.options).map((o) =>
          (o.value || "").toLowerCase(),
        ),
      );
      for (const [val, label] of want) {
        if (!existing.has(val)) {
          const op = document.createElement("option");
          op.value = val;
          op.textContent = label;
          petTypeSelect.appendChild(op);
        }
      }
      Array.from(petTypeSelect.options).forEach((o) => {
        if ((o.value || "").toLowerCase() === "passaro")
          o.textContent = "Pássaro";
      });
    }

    const esc = (value) =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (char) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[char],
      );
    const $ = (id) => document.getElementById(id);
    let pets = [],
      loaded = false,
      busy = false,
      ownerId = "",
      previewCounter = 0,
      editRevision = 0,
      pendingDelete = null,
      previousFocus = null;
    const preview = () => !!window.CATALOG_PREVIEW;
    function session() {
      try {
        const user = JSON.parse(localStorage.getItem("loggedInUser"));
        return user?.id && user?.token ? user : null;
      } catch {
        return null;
      }
    }
    function message(text = "", form = false) {
      const target = $(form ? "pets-form-feedback" : "pets-feedback");
      target.textContent = text;
      target.hidden = !text;
    }
    function setBusy(value) {
      busy = value;
      document
        .querySelectorAll(
          "#new-pet-form input,#new-pet-form select,#new-pet-form button,#pets-list-container button,#add-pet-btn,#pets-refresh,#pet-form-close,#pet-delete-dialog button",
        )
        .forEach(
          (el) =>
            (el.disabled =
              value || (!loaded && ["add-pet-btn"].includes(el.id))),
        );
      if (!value) {
        syncPorteDisabled();
        restoreFormFocus();
      }
      petForm.querySelector('[type="submit"]').textContent = value
        ? "Salvando…"
        : hiddenPetIdInput.value
          ? "Salvar alterações"
          : "Adicionar pet";
    }
    async function request(path, options = {}) {
      const current = session();
      if (!current || (ownerId && current.id !== ownerId))
        throw Error("Entre na sua conta e atualize a lista para continuar.");
      if (preview() && options.method && options.method !== "GET")
        throw Error("A prévia não altera cadastros reais.");
      const response = await fetch(API_CONFIG.BASE_URL + path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + current.token,
          ...options.headers,
        },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Error(
          response.status === 401
            ? "Entre novamente para consultar seus pets. Seu cadastro foi preservado."
            : result.message || "Não foi possível concluir a solicitação.",
        );
      return result;
    }
    function date(value) {
      if (!value) return "Não informada";
      const d = new Date(value);
      return Number.isNaN(d.getTime())
        ? "Não informada"
        : d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
    }
    const speciesLabels = {
      cachorro: "Cachorro",
      gato: "Gato",
      passaro: "Pássaro",
      peixe: "Peixe",
      roedor: "Roedor",
      lagarto: "Lagarto",
      tartaruga: "Tartaruga",
    };
    function render() {
      $("pets-count").textContent = pets.length
        ? `${pets.length} ${pets.length === 1 ? "companheiro cadastrado" : "companheiros cadastrados"}`
        : "Vamos conhecer seu companheiro?";
      petsListContainer.innerHTML = pets
        .map(
          (pet) =>
            `<article class="pet-card"><div class="pet-card-heading"><span class="pet-avatar" aria-hidden="true">♡</span><div><h2>${esc(fixEncoding(pet.nome) || "Pet sem nome")}</h2><span>${esc(speciesLabels[norm(pet.tipo)] || pet.tipo || "Espécie não informada")}</span></div></div><p class="pet-breed">${esc(fixEncoding(pet.raca) || "Raça não informada")}</p><div class="pet-tags"><span>${esc(pet.sexo || "Sexo não informado")}</span><span>${esc(pet.porte || "Porte não informado")}</span></div><details class="pet-information"><summary>Ver informações <span aria-hidden="true">⌄</span></summary><dl><div><dt>Nascimento</dt><dd>${esc(date(pet.dataNascimento))}</dd></div><div><dt>Pelagem / cor</dt><dd>${esc(pet.pelagemCor || "Não informada")}</dd></div><div><dt>Peso</dt><dd>${esc(pet.peso ?? "Não informado") || "Não informado"}</dd></div><div><dt>Microchip</dt><dd>${esc(pet.microchip || "Não informado")}</dd></div><div><dt>RGA</dt><dd>${esc(pet.rga || "Não informado")}</dd></div></dl></details><div class="pet-card-actions"><button type="button" data-pet-edit="${esc(pet._id)}" aria-label="Editar ${esc(pet.nome)}">Editar cadastro →</button><button type="button" data-pet-delete="${esc(pet._id)}" aria-label="Excluir cadastro de ${esc(pet.nome)}">Excluir</button></div></article>`,
        )
        .join("");
      $("pets-empty").hidden = pets.length > 0;
      if (!pets.length)
        $("pets-empty").innerHTML =
          '<span aria-hidden="true">♡</span><h2>Tem um companheiro por aí?</h2><p>Adicione seu pet para manter as informações dele em um só lugar.</p>';
    }
    async function fetchAndDisplayPets() {
      const current = session();
      if (!current) {
        pets = [];
        loaded = false;
        petsListContainer.innerHTML = "";
        $("pets-count").textContent = "Sua conta, seus companheiros";
        $("pets-empty").hidden = false;
        $("pets-empty").innerHTML =
          '<h2>Entre para consultar seus pets</h2><p>Acesse sua conta para adicionar e cuidar dos cadastros.</p><a href="/pages/login.html">Entrar na conta →</a>';
        addPetBtn.disabled = true;
        petsListContainer.setAttribute("aria-busy", "false");
        return false;
      }
      ownerId = current.id;
      $("pets-refresh").disabled = true;
      addPetBtn.disabled = true;
      petsListContainer.setAttribute("aria-busy", "true");
      message("Carregando seus companheiros…");
      try {
        const result = await request(
          "/pets/user/" + encodeURIComponent(current.id),
        );
        if (!Array.isArray(result))
          throw Error("A lista de pets não pôde ser consultada.");
        pets = result;
        loaded = true;
        render();
        message();
        return true;
      } catch (error) {
        message(error.message + " Use Atualizar para tentar novamente.");
        if (!loaded) $("pets-count").textContent = "Consulta indisponível";
        return false;
      } finally {
        petsListContainer.setAttribute("aria-busy", "false");
        $("pets-refresh").disabled = busy;
        addPetBtn.disabled = busy || !loaded;
      }
    }
    function fillPet(pet) {
      petForm.reset();
      hiddenPetIdInput.value = pet._id;
      const values = {
        "pet-name": pet.nome,
        "pet-type": pet.tipo,
        "pet-raca": pet.raca,
        "pet-porte": pet.porte,
        "pet-sexo": pet.sexo,
        "pet-microchip": pet.microchip,
        "pet-pelagem": pet.pelagemCor,
        "pet-rga": pet.rga,
        "pet-peso": pet.peso,
      };
      for (const [id, value] of Object.entries(values)) {
        if (value === null || value === undefined) continue;
        const field = $(id);
        if (
          field.tagName === "SELECT" &&
          ![...field.options].some((option) => option.value === String(value))
        ) {
          const option = document.createElement("option");
          option.value = String(value);
          option.textContent = String(value);
          field.append(option);
        }
        field.value = value;
      }
      const birth = pet.dataNascimento ? new Date(pet.dataNascimento) : null;
      $("pet-nascimento").value =
        birth && !Number.isNaN(birth.getTime())
          ? birth.toISOString().slice(0, 10)
          : "";
    }
    window.handleEditPet = async (petId) => {
      if (busy || !loaded) return;
      formReturnFocus = document.activeElement;
      const ticket = ++editRevision;
      setBusy(true);
      message();
      try {
        const pet = preview()
          ? pets.find((item) => item._id === petId)
          : await request("/pets/" + encodeURIComponent(petId));
        if (ticket !== editRevision) return;
        if (!pet) throw Error("Pet não encontrado. Atualize a lista.");
        fillPet(pet);
        await updateBreedOptions();
        if (ticket !== editRevision) return;
        showForm();
      } catch (error) {
        message(error.message);
      } finally {
        setBusy(false);
        if (!petFormContainer.classList.contains("hidden"))
          $("pet-name").focus({ preventScroll: true });
      }
    };
    const deleteDialog = $("pet-delete-dialog");
    window.handleDeletePet = (petId) => {
      if (busy || !loaded) return;
      const pet = pets.find((item) => item._id === petId);
      if (!pet) return;
      pendingDelete = pet;
      previousFocus = document.activeElement;
      $("pet-delete-message").textContent = preview()
        ? `Remover “${pet.nome}” da cópia de teste? O cadastro real não será alterado.`
        : `Deseja excluir o cadastro de “${pet.nome}”? Esta ação não pode ser desfeita.`;
      $("pet-delete-error").hidden = true;
      if (!deleteDialog.open) deleteDialog.showModal();
      $("pet-delete-cancel").focus();
    };
    $("pet-delete-confirm").addEventListener("click", async () => {
      if (!pendingDelete || busy || !deleteDialog.open) return;
      const pet = pendingDelete;
      setBusy(true);
      try {
        if (preview()) {
          pets = pets.filter((item) => item._id !== pet._id);
          render();
        } else
          await request("/pets/" + encodeURIComponent(pet._id), {
            method: "DELETE",
          });
        deleteDialog.close();
        if (hiddenPetIdInput.value === pet._id) hideForm();
        if (preview() || (await fetchAndDisplayPets()))
          message(
            preview()
              ? "Cadastro removido apenas da cópia de teste."
              : "Cadastro do pet excluído.",
          );
      } catch (error) {
        $("pet-delete-error").textContent = error.message;
        $("pet-delete-error").hidden = false;
      } finally {
        setBusy(false);
      }
    });
    for (const id of ["pet-delete-cancel", "pet-delete-close"])
      $(id).addEventListener("click", () => {
        if (!busy) deleteDialog.close();
      });
    deleteDialog.addEventListener("cancel", (event) => {
      if (busy) event.preventDefault();
    });
    deleteDialog.addEventListener("close", () => {
      pendingDelete = null;
      if (previousFocus?.isConnected) previousFocus.focus();
      else addPetBtn.focus();
    });
    deleteDialog.addEventListener("click", (event) => {
      if (busy || event.target !== deleteDialog) return;
      const r = deleteDialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        deleteDialog.close();
    });
    petsListContainer.addEventListener("click", (event) => {
      const edit = event.target.closest("[data-pet-edit]"),
        remove = event.target.closest("[data-pet-delete]");
      if (edit) window.handleEditPet(edit.dataset.petEdit);
      if (remove) window.handleDeletePet(remove.dataset.petDelete);
    });
    petForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !loaded) return;
      const current = session();
      if (!current || current.id !== ownerId) {
        message("Entre novamente e atualize a lista para continuar.", true);
        return;
      }
      syncPorteDisabled();
      const data = Object.fromEntries(new FormData(petForm).entries());
      data.pet_porte = porteSelect.value;
      if (
        !data.pet_name.trim() ||
        !data.pet_type ||
        !data.pet_raca.trim() ||
        !data.pet_sexo
      ) {
        message("Preencha nome, tipo, raça e sexo do pet.", true);
        return;
      }
      const petId = hiddenPetIdInput.value,
        editing = !!petId;
      if (!editing) data.owner = current.id;
      setBusy(true);
      message("", true);
      try {
        if (preview()) {
          const mapped = {
            nome: data.pet_name,
            tipo: data.pet_type,
            raca: data.pet_raca,
            porte: data.pet_porte,
            sexo: data.pet_sexo,
            dataNascimento: data.pet_nascimento,
            microchip: data.pet_microchip,
            pelagemCor: data.pet_pelagem,
            rga: data.pet_rga,
            peso: data.pet_peso,
          };
          if (editing)
            pets = pets.map((pet) =>
              pet._id === petId ? { ...pet, ...mapped } : pet,
            );
          else pets.push({ _id: "preview-" + ++previewCounter, ...mapped });
          render();
          hideForm();
          message(
            "Alteração aplicada apenas à cópia de teste. O cadastro real foi preservado.",
          );
        } else {
          await request(
            editing ? "/pets/" + encodeURIComponent(petId) : "/pets",
            { method: editing ? "PUT" : "POST", body: JSON.stringify(data) },
          );
          hideForm();
          if (await fetchAndDisplayPets())
            message(
              editing
                ? "Cadastro do pet atualizado."
                : "Seu pet foi adicionado.",
            );
          else
            message("Dados salvos. Atualize a lista para conferir o cadastro.");
        }
      } catch (error) {
        message(
          "Não foi possível salvar: " +
            error.message +
            " Seus dados digitados foram mantidos.",
          true,
        );
      } finally {
        setBusy(false);
      }
    });
    $("pets-refresh").addEventListener("click", () => {
      if (!busy) {
        hideForm();
        fetchAndDisplayPets();
      }
    });
    $("pet-form-close").addEventListener("click", () => {
      if (!busy) hideForm();
    });
    $("pets-preview-note").hidden = !preview();

    // --- Lógica para Sugestão de Raças (Awesomplete) ---

    async function updateBreedOptions() {
      if (!petTypeSelect || !breedInput) return;
      const selectedType = petTypeSelect.value;
      await loadSpeciesMap().catch(() => {});
      let breeds = [];
      const typeKey = norm(selectedType);

      if (typeKey === "cachorro") {
        breeds = (SPECIES_MAP?.cachorro?.all || []).slice();
      } else if (typeKey === "gato") {
        breeds = (SPECIES_MAP?.gato || SPECIES_MAP?.gatos || []).slice();
      } else if (typeKey === "passaro") {
        breeds = (SPECIES_MAP?.passaro || SPECIES_MAP?.passaros || []).slice();
      } else if (
        ["peixe", "roedor", "lagarto", "tartaruga"].includes(typeKey)
      ) {
        breeds = (SPECIES_MAP?.[typeKey] || []).slice();
      } else {
        breeds = [];
      }

      if (typeKey !== norm(petTypeSelect.value)) return;
      breeds = breeds.map(fixEncoding).sort((a, b) => a.localeCompare(b));

      if (typeof Awesomplete !== "function") {
        let list = document.getElementById("pet-breed-suggestions");
        if (!list) {
          list = document.createElement("datalist");
          list.id = "pet-breed-suggestions";
          breedInput.after(list);
          breedInput.setAttribute("list", list.id);
        }
        list.replaceChildren(
          ...breeds.map((name) => {
            const option = document.createElement("option");
            option.value = name;
            return option;
          }),
        );
        return;
      }
      if (awesompleteInstance) {
        awesompleteInstance.list = breeds;
      } else {
        awesompleteInstance = new Awesomplete(breedInput, {
          minChars: 1,
          list: breeds,
          autoFirst: true,
        });
      }
    }

    // --- Event Listeners Iniciais ---

    if (addPetBtn)
      addPetBtn.addEventListener("click", async () => {
        if (busy || !loaded) return;
        formReturnFocus = addPetBtn;
        petForm.reset();
        hiddenPetIdInput.value = "";
        await updateBreedOptions();
        syncPorteDisabled();
        showForm();
        ensurePetTypeOptions();
        normalizeStaticLabels();
      });
    if (cancelPetBtn)
      cancelPetBtn.addEventListener("click", () => {
        if (!busy) hideForm();
      });
    if (petTypeSelect)
      petTypeSelect.addEventListener("change", async () => {
        await updateBreedOptions();
        syncPorteDisabled();
        setPorteFromBreedIfDog();
      });

    // Atualiza porte ao escolher uma raÃƒÂ§a (para cachorro)
    if (breedInput) {
      breedInput.addEventListener("change", () =>
        setTimeout(setPorteFromBreedIfDog, 0),
      );
      breedInput.addEventListener("blur", () =>
        setTimeout(setPorteFromBreedIfDog, 0),
      );
      breedInput.addEventListener("awesomplete-selectcomplete", () =>
        setTimeout(setPorteFromBreedIfDog, 0),
      );
    }

    // --- ExecuÃƒÂ§ÃƒÂ£o Inicial ---
    fetchAndDisplayPets();
    ensurePetTypeOptions();
    normalizeStaticLabels();
    updateBreedOptions();
    syncPorteDisabled();
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initializePets, {
      once: true,
    });
  else initializePets();
})();
