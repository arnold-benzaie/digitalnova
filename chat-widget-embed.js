/**
 * PUBLIC-MAP AI Assistant — standalone embed (Phase 1B).
 *
 * Vanilla JS, no framework, no build step — matches this static site's
 * own convention (plain <script> files, no bundler). Loaded with
 * `<script defer>` so it never blocks page rendering.
 *
 * Talks to the SAME backend already validated in the Next.js app
 * (Phase 1A): POST API_ENDPOINT with { type, ... }, `credentials:
 * "include"` so the httpOnly, SameSite=None visitorId cookie set by the
 * server round-trips correctly cross-origin — this script never reads,
 * writes, or invents a visitor identifier of its own (no second
 * visitorId system, no fingerprinting, see lib/chat/visitor.ts).
 *
 * FR/EN text lives in PM_CHAT_STRINGS below, deliberately mirroring
 * app/lib/i18n/dictionaries/chat.ts's FR/EN values exactly (same wording
 * approved in Phase 1A) — this static site has no bundler/shared module
 * system with the Next.js app, so "reuse" here means keeping this table
 * manually in sync with that file rather than inventing new copy. If
 * this integration becomes permanent, generating this file from that
 * dictionary would remove the manual-sync risk — not built now, since
 * Phase 1B is validation-only.
 */
(function () {
  "use strict";

  // ---- Configuration -----------------------------------------------------

  // Preview endpoint for validation only (§11 of the approved plan) — the
  // switch to https://app.public-map.com/api/chat is a separate step
  // requiring explicit authorization, never done automatically here.
  var API_ENDPOINT = "https://app-git-preview-ai-assistant-widget-arnold-benzaies-projects.vercel.app/api/chat";

  var STORAGE_KEY = "pm_chat_embed_state_v1";
  var WELCOME_SHOWN_KEY = "pm_chat_welcome_shown_v1"; // sessionStorage — avoids re-showing on every page in the same session
  var MAX_STORED_MESSAGES = 50;
  var WELCOME_BUBBLE_INITIAL_DELAY_MIN_MS = 600;
  var WELCOME_BUBBLE_INITIAL_DELAY_MAX_MS = 1000;
  var WELCOME_BUBBLE_AUTO_DISMISS_MS = 10000;
  var WELCOME_BUBBLE_FADE_MS = 250;

  // ---- Strings (mirrors app/lib/i18n/dictionaries/chat.ts) ---------------

  var PM_CHAT_STRINGS = {
    fr: {
      triggerAriaLabel: "Ouvrir l'assistant PUBLIC-MAP",
      triggerCloseAriaLabel: "Fermer l'assistant PUBLIC-MAP",
      welcomeText: "👋 Bonjour ! Bienvenue chez PUBLIC-MAP.\nComment pouvons-nous vous aider aujourd'hui ?",
      welcomeCloseAriaLabel: "Fermer le message d'accueil",
      assistantName: "PUBLIC-MAP Assistant",
      onlineStatus: "En ligne",
      closeAriaLabel: "Fermer",
      minimizeAriaLabel: "Réduire",
      greetingAnonymous: "👋 Bonjour ! Bienvenue chez PUBLIC-MAP.\nComment pouvons-nous vous aider aujourd'hui ?",
      typingIndicator: "L'assistant écrit…",
      inputPlaceholder: "Écrivez votre message…",
      sendAriaLabel: "Envoyer",
      errorGeneric: "Une erreur est survenue. Veuillez réessayer.",
      errorRateLimited: "Trop de messages envoyés. Merci de patienter un instant avant de réessayer.",
      retry: "Réessayer",
      // Marketing-site suggestion set (Phase 1B §4) — distinct from the
      // Next.js dashboard widget's chips (lib/i18n/dictionaries/chat.ts):
      // an anonymous public-map.com visitor is a prospect, not a signed-in
      // user, so labels stay prospect-facing. Ids match exactly what
      // lib/chat/ai-mock-provider.ts's SITE_SUGGESTIONS returns when the
      // request carries surface:"site" (see postChat below) — gbp,
      // google_ads, seo, website, quote, human.
      suggestions: {
        gbp: "Optimiser mon Google Business Profile",
        google_ads: "Lancer Google Ads",
        seo: "Améliorer mon SEO",
        website: "Créer un site web",
        quote: "Obtenir un devis",
        human: "Parler à quelqu'un",
      },
      leadFormTitle: "Laissez-nous vos coordonnées",
      leadFullName: "Nom complet",
      leadEmail: "E-mail",
      leadPhone: "Téléphone / WhatsApp",
      leadMessage: "Message / besoin",
      leadConsent: "J'accepte que PUBLIC-MAP me contacte concernant ma demande.",
      leadSubmit: "Envoyer",
      leadCancel: "Annuler",
      leadRequiredError: "Merci de compléter les champs obligatoires.",
      leadConsentRequiredError: "Merci d'accepter d'être contacté(e) pour continuer.",
    },
    en: {
      triggerAriaLabel: "Open PUBLIC-MAP assistant",
      triggerCloseAriaLabel: "Close PUBLIC-MAP assistant",
      welcomeText: "👋 Hi! Welcome to PUBLIC-MAP.\nHow can we help you today?",
      welcomeCloseAriaLabel: "Close welcome message",
      assistantName: "PUBLIC-MAP Assistant",
      onlineStatus: "Online",
      closeAriaLabel: "Close",
      minimizeAriaLabel: "Minimize",
      greetingAnonymous: "👋 Hi! Welcome to PUBLIC-MAP.\nHow can we help you today?",
      typingIndicator: "Assistant is typing…",
      inputPlaceholder: "Write your message…",
      sendAriaLabel: "Send",
      errorGeneric: "Something went wrong. Please try again.",
      errorRateLimited: "Too many messages sent. Please wait a moment before trying again.",
      retry: "Retry",
      suggestions: {
        gbp: "Optimize my Google Business Profile",
        google_ads: "Launch Google Ads",
        seo: "Improve my SEO",
        website: "Build a website",
        quote: "Get a quote",
        human: "Talk to someone",
      },
      leadFormTitle: "Leave us your contact details",
      leadFullName: "Full name",
      leadEmail: "Email",
      leadPhone: "Phone / WhatsApp",
      leadMessage: "Message / need",
      leadConsent: "I agree that PUBLIC-MAP may contact me regarding my request.",
      leadSubmit: "Send",
      leadCancel: "Cancel",
      leadRequiredError: "Please fill in the required fields.",
      leadConsentRequiredError: "Please agree to be contacted to continue.",
    },
  };

  function resolveLocale() {
    try {
      var stored = window.localStorage.getItem("digitalnova-lang");
      if (stored === "en" || stored === "fr") return stored;
    } catch (e) {
      /* localStorage unavailable (privacy mode, etc.) — fall through */
    }
    var htmlLang = document.documentElement.lang;
    if (htmlLang && htmlLang.toLowerCase().indexOf("en") === 0) return "en";
    return "fr";
  }

  // ---- Tiny DOM helper -----------------------------------------------------

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "class") node.className = attrs[key];
        else if (key === "text") node.textContent = attrs[key];
        else if (key === "html") node.innerHTML = attrs[key];
        else node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function (child) {
      if (child) node.appendChild(child);
    });
    return node;
  }

  // ---- State (local convenience cache only — never the visitorId itself,
  // which is server-managed via the httpOnly cookie) -----------------------

  function loadStoredState() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveStoredState(conversationId, messages) {
    try {
      var trimmed = messages.slice(-MAX_STORED_MESSAGES);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversationId: conversationId, messages: trimmed }));
    } catch (e) {
      /* storage unavailable — widget still works within this page load */
    }
  }

  // ---- API -----------------------------------------------------------------

  function postChat(body) {
    return fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || data.error) {
          var kind = res.status === 429 ? "rate_limited" : "generic";
          var err = new Error(data.error || "request_failed");
          err.kind = kind;
          throw err;
        }
        return data;
      });
    });
  }

  // ---- Widget ---------------------------------------------------------------

  // ---- Cookie-consent banner awareness (Phase 1B §12, tightened §positioning
  // update) -------------------------------------------------------------
  // analytics.js injects a full-width, bottom-fixed first-visit consent
  // banner (aria-label="Cookie consent") that isn't in the page's static
  // HTML, so its presence/height can't be known upfront — this observes
  // document.body for it appearing/disappearing and resolves the widget's
  // full `bottom` value into the --pm-chat-bottom custom property (read by
  // chat-widget-embed.css): a small fixed rest position normally, or the
  // banner's live height plus a small gap while it's on screen — never
  // overlapping the banner's own Refuser/Accepter buttons.
  var DESKTOP_REST_BOTTOM = 18;
  var DESKTOP_BANNER_GAP = 14;
  var MOBILE_REST_BOTTOM = 14;
  var MOBILE_BANNER_GAP = 10;
  var MOBILE_BREAKPOINT = 768;

  function watchCookieBanner(root) {
    function sync() {
      var isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
      var restBottom = isMobile ? MOBILE_REST_BOTTOM : DESKTOP_REST_BOTTOM;
      var bannerGap = isMobile ? MOBILE_BANNER_GAP : DESKTOP_BANNER_GAP;
      var banner = document.querySelector('[aria-label="Cookie consent"]');
      var bottom = banner ? banner.offsetHeight + bannerGap : restBottom;
      root.style.setProperty("--pm-chat-bottom", bottom + "px");
    }
    sync();
    var observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true });
    window.addEventListener("resize", sync);
  }

  // ---- Live FR/EN follow (Phase 1B §6) ------------------------------------
  // The site's language toggles (i18n-sparkles.js on the homepage; each
  // legal/funnel page's own small inline script) all converge on setting
  // document.documentElement.lang — that single DOM attribute is the most
  // reliable cross-page signal, regardless of which button markup a given
  // page uses (data-lang vs data-language). The homepage additionally
  // dispatches "digitalnova:language-updated" (also used by analytics.js's
  // own banner) — listened to as well so the update is never missed if a
  // future page mutates the attribute without going through a MutationObserver
  // tick for some reason. The callback only re-renders widget copy; it never
  // touches conversationId/messages, so an in-progress conversation survives
  // a language switch.
  function watchLanguageChanges(callback) {
    function sync() {
      callback(resolveLocale());
    }
    var observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    document.addEventListener("digitalnova:language-updated", sync);
  }

  function createWidget() {
    var locale = resolveLocale();
    var t = PM_CHAT_STRINGS[locale];
    var stored = loadStoredState();
    var conversationId = stored ? stored.conversationId : null;
    var messages = stored && stored.messages ? stored.messages : [];
    var phase = "closed"; // closed | open
    var suggestions = [];
    var showLeadForm = false;
    var lastFailedContent = null;

    var root = el("div", { class: "pm-chat-widget-root" });
    document.body.appendChild(root);

    var triggerWrap = el("div", { class: "pm-chat-trigger-wrap" });
    var bubbleHost = el("div", {});
    var triggerBtn = el(
      "button",
      { type: "button", class: "pm-chat-trigger-btn", "aria-label": t.triggerAriaLabel },
      [chatIcon(), el("span", { class: "pm-chat-trigger-dot", "aria-hidden": "true" })],
    );
    triggerBtn.addEventListener("click", openPanel);
    triggerWrap.appendChild(bubbleHost);
    triggerWrap.appendChild(triggerBtn);

    var panel = null;
    var messagesEl = null;
    var inputEl = null;
    var sendBtn = null;

    root.appendChild(triggerWrap);
    watchCookieBanner(root);
    watchLanguageChanges(function (newLocale) {
      if (newLocale === locale) return;
      locale = newLocale;
      t = PM_CHAT_STRINGS[locale];
      triggerBtn.setAttribute("aria-label", t.triggerAriaLabel);
      if (panel) {
        renderPanel(); // conversation state (messages/conversationId) is untouched
        renderSuggestions();
        if (showLeadForm) renderLeadForm();
      }
      var currentBubble = bubbleHost.firstChild;
      if (currentBubble) showWelcomeBubble(); // re-render with the new locale's copy
    });

    var bubbleDismissed = !!stored;
    if (!bubbleDismissed && !hasSeenWelcomeThisSession()) {
      window.setTimeout(function () {
        if (phase === "closed") showWelcomeBubble();
      }, WELCOME_BUBBLE_INITIAL_DELAY_MIN_MS + Math.random() * (WELCOME_BUBBLE_INITIAL_DELAY_MAX_MS - WELCOME_BUBBLE_INITIAL_DELAY_MIN_MS));
    }

    function hasSeenWelcomeThisSession() {
      try {
        return window.sessionStorage.getItem(WELCOME_SHOWN_KEY) === "1";
      } catch (e) {
        return false;
      }
    }

    function markWelcomeSeenThisSession() {
      try {
        window.sessionStorage.setItem(WELCOME_SHOWN_KEY, "1");
      } catch (e) {
        /* storage unavailable — worst case the bubble can reappear on another page this session */
      }
    }

    function showWelcomeBubble() {
      markWelcomeSeenThisSession();
      var bubble = el("div", { class: "pm-chat-bubble", role: "button", tabindex: "0" });
      var closeBtn = el("button", { type: "button", class: "pm-chat-bubble-close", "aria-label": t.welcomeCloseAriaLabel, text: "✕" });
      var dismiss = function () {
        if (bubbleHost.firstChild !== bubble) return;
        bubbleDismissed = true;
        bubble.classList.add("pm-chat-bubble-hiding");
        window.setTimeout(function () {
          if (bubbleHost.firstChild === bubble) bubbleHost.innerHTML = "";
        }, WELCOME_BUBBLE_FADE_MS);
      };
      closeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        dismiss();
      });
      var text = el("div", {});
      text.textContent = t.welcomeText;
      bubble.appendChild(closeBtn);
      bubble.appendChild(text);
      bubble.addEventListener("click", openPanel);
      bubble.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") openPanel();
      });
      bubbleHost.innerHTML = "";
      bubbleHost.appendChild(bubble);
      // Discreet, not persistent — auto-clears itself if the visitor never
      // interacts with it (Phase 1B §2), same as closing it manually.
      window.setTimeout(dismiss, WELCOME_BUBBLE_AUTO_DISMISS_MS);
    }

    function openPanel() {
      phase = "open";
      bubbleHost.innerHTML = "";
      bubbleDismissed = true;
      triggerWrap.style.display = "none";
      renderPanel();
      document.addEventListener("keydown", onEscapeKey);
    }

    function closePanel() {
      phase = "closed";
      if (panel) panel.remove();
      panel = null;
      triggerWrap.style.display = "";
      document.removeEventListener("keydown", onEscapeKey);
      triggerBtn.focus();
    }

    function onEscapeKey(e) {
      if (e.key === "Escape") closePanel();
    }

    function renderPanel() {
      if (panel) panel.remove(); // re-entrant: also called on a live locale change while open
      panel = el("div", { class: "pm-chat-panel", role: "dialog", "aria-label": t.assistantName });

      var header = el("div", { class: "pm-chat-header" }, [
        el("div", {}, [
          el("p", { class: "pm-chat-header-name", text: t.assistantName }),
          el("p", { class: "pm-chat-header-status" }, [el("span", { class: "pm-chat-header-status-dot", "aria-hidden": "true" }), document.createTextNode(t.onlineStatus)]),
        ]),
        el("div", { class: "pm-chat-header-actions" }, [
          headerButton(t.minimizeAriaLabel, minimizeIcon(), closePanel),
          headerButton(t.closeAriaLabel, closeIcon(), closePanel),
        ]),
      ]);

      messagesEl = el("div", { class: "pm-chat-messages" });
      renderMessages();

      var inputBar = el("div", { class: "pm-chat-input-bar" });
      inputEl = el("textarea", { class: "pm-chat-input", rows: "1", placeholder: t.inputPlaceholder, "aria-label": t.inputPlaceholder, maxlength: "4000" });
      sendBtn = el("button", { type: "button", class: "pm-chat-send-btn", "aria-label": t.sendAriaLabel, disabled: "true" }, [sendIcon()]);
      inputEl.addEventListener("input", function () {
        sendBtn.disabled = !inputEl.value.trim();
      });
      inputEl.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submitDraft();
        }
      });
      sendBtn.addEventListener("click", submitDraft);
      inputBar.appendChild(inputEl);
      inputBar.appendChild(sendBtn);

      panel.appendChild(header);
      panel.appendChild(messagesEl);
      panel.appendChild(inputBar);
      root.appendChild(panel);
      inputEl.focus();
    }

    function submitDraft() {
      var content = inputEl.value.trim();
      if (!content) return;
      inputEl.value = "";
      sendBtn.disabled = true;
      sendMessage(content);
    }

    function headerButton(label, icon, handler) {
      var btn = el("button", { type: "button", class: "pm-chat-header-btn", "aria-label": label }, [icon]);
      btn.addEventListener("click", handler);
      return btn;
    }

    function renderMessages() {
      messagesEl.innerHTML = "";
      var displayMessages = messages.length === 0 ? [{ senderType: "assistant", content: t.greetingAnonymous }] : messages;
      displayMessages.forEach(function (message) {
        messagesEl.appendChild(renderMessageBubble(message));
      });
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderMessageBubble(message) {
      var isOwn = message.senderType === "visitor" || message.senderType === "client";
      return el("div", { class: "pm-chat-msg-row " + (isOwn ? "pm-chat-msg-own" : "pm-chat-msg-other") }, [el("div", { class: "pm-chat-msg-bubble", text: message.content })]);
    }

    function appendLocalMessage(senderType, content) {
      messages.push({ senderType: senderType, content: content, createdAt: new Date().toISOString() });
      renderMessages();
    }

    function renderTyping() {
      var row = el("div", { class: "pm-chat-typing", "aria-live": "polite" }, [
        el("span", { class: "pm-chat-typing-dots" }, [el("span", {}), el("span", {}), el("span", {})]),
        el("span", { class: "pm-chat-typing-label", text: t.typingIndicator }),
      ]);
      messagesEl.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return row;
    }

    function renderSuggestions() {
      var existing = panel.querySelector(".pm-chat-suggestions");
      if (existing) existing.remove();
      if (showLeadForm || suggestions.length === 0) return;
      var wrap = el("div", { class: "pm-chat-suggestions" });
      suggestions.forEach(function (id) {
        var label = t.suggestions[id];
        if (!label) return;
        var btn = el("button", { type: "button", class: "pm-chat-suggestion-btn", text: label });
        btn.addEventListener("click", function () {
          sendMessage(label, id);
        });
        wrap.appendChild(btn);
      });
      messagesEl.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderError(kind) {
      var existing = panel.querySelector(".pm-chat-error-box");
      if (existing) existing.remove();
      var msg = kind === "rate_limited" ? t.errorRateLimited : t.errorGeneric;
      var box = el("div", { class: "pm-chat-error-box" });
      box.appendChild(el("p", { class: "pm-chat-error-text", text: msg }));
      var retryBtn = el("button", { type: "button", class: "pm-chat-retry-btn", text: t.retry });
      retryBtn.addEventListener("click", function () {
        box.remove();
        if (lastFailedContent) sendMessage(lastFailedContent);
      });
      box.appendChild(retryBtn);
      messagesEl.appendChild(box);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function sendMessage(content, suggestionId) {
      appendLocalMessage("visitor", content);
      suggestions = [];
      renderSuggestions();
      lastFailedContent = content;
      var typingRow = renderTyping();

      postChat({ type: "message", content: content, locale: locale, conversationId: conversationId, suggestionId: suggestionId, surface: "site" })
        .then(function (result) {
          typingRow.remove();
          conversationId = result.conversationId;
          appendLocalMessage("assistant", result.reply);
          suggestions = (result.suggestions || []).map(function (s) {
            return s.id;
          });
          renderSuggestions();
          if (result.action && result.action.type === "show_lead_form") {
            showLeadForm = true;
            renderLeadForm();
          }
          lastFailedContent = null;
          saveStoredState(conversationId, messages);
        })
        .catch(function (err) {
          typingRow.remove();
          renderError(err && err.kind);
        });
    }

    function renderLeadForm() {
      var existing = panel.querySelector(".pm-chat-lead-form");
      if (existing) existing.remove();
      renderSuggestions();

      var form = el("form", { class: "pm-chat-lead-form" });
      form.appendChild(el("p", { class: "pm-chat-lead-form-title", text: t.leadFormTitle }));

      var nameInput = leadField(t.leadFullName, "text", true);
      var emailInput = leadField(t.leadEmail, "email", true);
      var phoneInput = leadField(t.leadPhone, "tel", false);
      var messageInput = leadField(t.leadMessage, "textarea", true);

      form.appendChild(nameInput.wrap);
      form.appendChild(emailInput.wrap);
      form.appendChild(phoneInput.wrap);
      form.appendChild(messageInput.wrap);

      var consentWrap = el("label", { class: "pm-chat-lead-consent" });
      var consentInput = el("input", { type: "checkbox" });
      consentWrap.appendChild(consentInput);
      consentWrap.appendChild(document.createTextNode(t.leadConsent));
      form.appendChild(consentWrap);

      var errorEl = el("p", { class: "pm-chat-lead-error", style: "display:none" });
      form.appendChild(errorEl);

      var actions = el("div", { class: "pm-chat-lead-actions" });
      var submitBtn = el("button", { type: "submit", class: "pm-chat-lead-submit", text: t.leadSubmit });
      var cancelBtn = el("button", { type: "button", class: "pm-chat-lead-cancel", text: t.leadCancel });
      cancelBtn.addEventListener("click", function () {
        showLeadForm = false;
        form.remove();
        renderSuggestions();
      });
      actions.appendChild(submitBtn);
      actions.appendChild(cancelBtn);
      form.appendChild(actions);

      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var fullName = nameInput.input.value.trim();
        var email = emailInput.input.value.trim();
        var messageText = messageInput.input.value.trim();
        if (!fullName || !email || !messageText) {
          errorEl.textContent = t.leadRequiredError;
          errorEl.style.display = "";
          return;
        }
        if (!consentInput.checked) {
          errorEl.textContent = t.leadConsentRequiredError;
          errorEl.style.display = "";
          return;
        }
        errorEl.style.display = "none";
        submitBtn.disabled = true;
        postChat({
          type: "lead_submit",
          conversationId: conversationId,
          locale: locale,
          fullName: fullName,
          email: email,
          phone: phoneInput.input.value.trim() || undefined,
          message: messageText,
          consent: true,
        })
          .then(function (result) {
            appendLocalMessage("assistant", result.reply);
            showLeadForm = false;
            form.remove();
            saveStoredState(conversationId, messages);
          })
          .catch(function () {
            errorEl.textContent = t.errorGeneric;
            errorEl.style.display = "";
            submitBtn.disabled = false;
          });
      });

      messagesEl.appendChild(form);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function leadField(label, type, required) {
      var wrap = el("label", { class: "pm-chat-lead-field" }, [document.createTextNode(label)]);
      var input = type === "textarea" ? el("textarea", { rows: "2" }) : el("input", { type: type });
      if (required) input.setAttribute("required", "true");
      wrap.appendChild(input);
      return { wrap: wrap, input: input };
    }

    // ---- Icons (inline SVG, no external assets) -----------------------------

    function svg(pathHtml) {
      var wrapper = document.createElement("span");
      wrapper.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' + pathHtml + "</svg>";
      return wrapper.firstChild;
    }
    function chatIcon() {
      return svg('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>');
    }
    function closeIcon() {
      return svg('<path d="M18 6 6 18"/><path d="M6 6l12 12"/>');
    }
    function minimizeIcon() {
      return svg('<path d="M5 12h14"/>');
    }
    function sendIcon() {
      return svg('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>');
    }
  }

  function init() {
    if (document.body) createWidget();
    else document.addEventListener("DOMContentLoaded", createWidget);
  }

  init();
})();
