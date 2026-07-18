(function () {
  "use strict";

  const form = document.getElementById("reservation-form");
  const status = document.getElementById("reservation-status");
  const submitButton = form?.querySelector(".booking-submit");
  const submitLabel = form?.querySelector("[data-submit-label]");
  const message = document.getElementById("message");
  const messageCounter = document.getElementById("message-counter");
  const dateInput = document.getElementById("preferredDate");
  const startedAt = document.getElementById("startedAt");
  const languageButtons = document.querySelectorAll("[data-language]");
  let language = "fr";

  const ui = {
    fr: {
      title: "Réserver un appel stratégique | PUBLIC-MAP",
      description: "Préparez une demande d’appel stratégique avec PUBLIC-MAP pour votre visibilité locale, votre site web, votre SEO ou vos automatisations.",
      invalid: "Veuillez vérifier les champs obligatoires avant de continuer.",
      pending: "Validation sécurisée de votre demande…",
      submit: "Envoyer ma demande d’appel",
      sending: "Validation en cours…",
      unavailable: "Le service d’envoi automatique n’est pas encore connecté. Votre demande n’a pas été transmise ni enregistrée.",
      error: "La demande n’a pas pu être transmise. Aucune réservation n’a été créée.",
      success: "Votre demande a été transmise pour examen. Le créneau reste à confirmer par PUBLIC-MAP.",
      email: "Contacter PUBLIC-MAP par e-mail"
    },
    en: {
      title: "Book a strategy call | PUBLIC-MAP",
      description: "Prepare a strategy call request with PUBLIC-MAP for local visibility, websites, SEO or automation.",
      invalid: "Please check the required fields before continuing.",
      pending: "Securely validating your request…",
      submit: "Send my call request",
      sending: "Validating…",
      unavailable: "The automated submission service is not connected yet. Your request has not been sent or stored.",
      error: "The request could not be sent. No booking has been created.",
      success: "Your request has been submitted for review. The time slot still needs to be confirmed by PUBLIC-MAP.",
      email: "Contact PUBLIC-MAP by email"
    }
  };

  function updateLanguage(nextLanguage) {
    language = nextLanguage === "en" ? "en" : "fr";
    document.documentElement.lang = language;
    document.title = ui[language].title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", ui[language].description);
    document.querySelectorAll("[data-fr][data-en]").forEach((element) => {
      element.textContent = element.dataset[language];
    });
    document.querySelectorAll("[data-placeholder-fr][data-placeholder-en]").forEach((element) => {
      element.setAttribute("placeholder", element.dataset[`placeholder${language === "en" ? "En" : "Fr"}`]);
    });
    languageButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.language === language));
    });
    if (submitLabel && !submitButton?.disabled) submitLabel.textContent = ui[language].submit;
  }

  function setStatus(messageText, type, addEmailLink) {
    if (!status) return;
    status.replaceChildren(document.createTextNode(messageText));
    status.className = `booking-status is-visible is-${type}`;
    if (addEmailLink) {
      status.appendChild(document.createTextNode(" "));
      const link = document.createElement("a");
      link.href = "mailto:contact@public-map.com?subject=Demande%20d%27appel%20strat%C3%A9gique%20PUBLIC-MAP";
      link.textContent = ui[language].email;
      status.appendChild(link);
      status.appendChild(document.createTextNode("."));
    }
  }

  function setSubmitting(isSubmitting) {
    if (!submitButton || !submitLabel) return;
    submitButton.disabled = isSubmitting;
    submitButton.setAttribute("aria-busy", String(isSubmitting));
    submitLabel.textContent = isSubmitting ? ui[language].sending : ui[language].submit;
  }

  function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function markValidity() {
    form?.querySelectorAll("input, select, textarea").forEach((field) => {
      if (field.type === "hidden" || field.name === "website") return;
      field.setAttribute("aria-invalid", String(!field.checkValidity()));
    });
  }

  function buildPayload() {
    const values = new FormData(form);
    return {
      fullName: String(values.get("fullName") || "").trim(),
      email: String(values.get("email") || "").trim(),
      phone: String(values.get("phone") || "").trim(),
      company: String(values.get("company") || "").trim(),
      country: String(values.get("country") || ""),
      service: String(values.get("service") || ""),
      budget: String(values.get("budget") || ""),
      preferredDate: String(values.get("preferredDate") || ""),
      timeSlot: String(values.get("timeSlot") || ""),
      message: String(values.get("message") || "").trim(),
      consent: values.get("consent") === "accepted",
      website: String(values.get("website") || ""),
      startedAt: Number(values.get("startedAt") || 0),
      language
    };
  }

  languageButtons.forEach((button) => {
    button.addEventListener("click", () => updateLanguage(button.dataset.language));
  });

  if (startedAt) startedAt.value = String(Date.now());
  if (dateInput) dateInput.min = localDateString(new Date());

  message?.addEventListener("input", () => {
    if (messageCounter) messageCounter.textContent = `${message.value.length} / 2000`;
  });

  form?.addEventListener("input", (event) => {
    const field = event.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
      field.setAttribute("aria-invalid", String(!field.checkValidity()));
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    markValidity();
    if (!form.checkValidity()) {
      setStatus(ui[language].invalid, "error", false);
      form.querySelector(":invalid")?.focus();
      return;
    }

    setSubmitting(true);
    setStatus(ui[language].pending, "pending", false);

    try {
      const response = await fetch("/api/reservation", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(buildPayload())
      });
      const payload = await response.json().catch(() => ({}));

      if (response.ok && payload.ok === true) {
        setStatus(ui[language].success, "pending", false);
        form.reset();
        if (startedAt) startedAt.value = String(Date.now());
        if (messageCounter) messageCounter.textContent = "0 / 2000";
        return;
      }

      if (payload.code === "reservation_backend_not_configured") {
        setStatus(ui[language].unavailable, "warning", true);
        if (submitButton && submitLabel) {
          submitButton.disabled = true;
          submitButton.setAttribute("aria-disabled", "true");
          submitLabel.textContent = language === "en" ? "Automatic submission unavailable" : "Envoi automatique indisponible";
        }
        return;
      }

      if (payload.code === "validation_failed") {
        setStatus(ui[language].invalid, "error", false);
        return;
      }

      setStatus(ui[language].error, "error", true);
    } catch {
      setStatus(ui[language].error, "error", true);
    } finally {
      if (submitButton?.getAttribute("aria-disabled") !== "true") setSubmitting(false);
    }
  });

  updateLanguage("fr");
})();
