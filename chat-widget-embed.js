/**
 * PUBLIC-MAP AI Assistant — standalone embed (Phase 1B).
 *
 * Vanilla JS, no framework, no build step — matches this static site's
 * own convention (plain <script> files, no bundler). Loaded with
 * `<script defer>` so it never blocks page rendering.
 *
 * Talks to the SAME backend already validated in the Next.js app
 * (Phase 1A) through a same-origin proxy (api/chat-proxy.js, this same
 * project) rather than calling the app deployment directly: the app's
 * Preview deployments sit behind Vercel Deployment Protection, which
 * intercepts the browser's CORS *preflight* (OPTIONS — never carries
 * cookies by spec) with a redirect — forbidden for a preflight response
 * per the Fetch spec, so a direct cross-origin call is blocked before it
 * ever reaches the app's code, confirmed directly this session. The proxy
 * makes the browser's call same-origin (no CORS involved at all) and
 * relays server-to-server using Vercel's own bypass mechanism — see
 * api/chat-proxy.js for the full explanation.
 *
 * `credentials: "include"` still matters here: it's what lets this
 * same-origin call carry/receive the httpOnly, SameSite=None visitorId
 * cookie the proxy relays through — this script never reads, writes, or
 * invents a visitor identifier of its own (no second visitorId system,
 * no fingerprinting, see lib/chat/visitor.ts).
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

  // Same-origin proxy (api/chat-proxy.js) — see the file header comment
  // above for why. The switch to a Production endpoint is a separate step
  // requiring explicit authorization, never done automatically here.
  var API_ENDPOINT = "/api/chat-proxy";

  var STORAGE_KEY = "pm_chat_embed_state_v1";
  var WELCOME_SHOWN_KEY = "pm_chat_welcome_shown_v1"; // sessionStorage — avoids re-showing on every page in the same session
  var MAX_STORED_MESSAGES = 50;
  var WELCOME_BUBBLE_INITIAL_DELAY_MIN_MS = 600;
  var WELCOME_BUBBLE_INITIAL_DELAY_MAX_MS = 1000;
  var WELCOME_BUBBLE_AUTO_DISMISS_MS = 10000;
  var WELCOME_BUBBLE_FADE_MS = 250;

  // Phase 1E — a compact 4-chip bootstrap (was 6 in Phase 1C) shown
  // alongside the greeting on a fresh panel open, before any real
  // exchange exists — the widget should read as a conversation starting
  // point, not a support menu. Ids only — must exactly mirror
  // lib/chat/ai-mock-provider.ts's SITE_SUGGESTIONS/SITE_LEAVES; clicking
  // any of them still calls the SAME postChat()/mock provider as every
  // other suggestion — no parallel system. "human" is deliberately
  // excluded from both arrays: it gets its own small, discreet CTA
  // instead (see renderInitialSuggestions) — available, never pushed.
  var INITIAL_SUGGESTIONS_MAIN = ["visibility", "lead_generation", "automation", "website"];
  var INITIAL_SUGGESTIONS_MORE = ["gbp", "google_ads", "seo", "quote", "automation_setup", "performance_review", "reviews"];

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
      greetingAnonymous: "👋 Bonjour ! Je suis l'assistant PUBLIC-MAP.\nJe peux vous aider à améliorer votre présence en ligne, votre SEO, Google Ads, votre site web ou vos automatisations.\n\nQue souhaitez-vous améliorer aujourd'hui ?",
      typingIndicator: "PUBLIC-MAP Assistant écrit…",
      inputPlaceholder: "Posez votre question à PUBLIC-MAP…",
      sendAriaLabel: "Envoyer",
      errorGeneric: "Une erreur est survenue. Veuillez réessayer.",
      errorRateLimited: "Trop de messages envoyés. Merci de patienter un instant avant de réessayer.",
      retry: "Réessayer",
      suggestionsTitle: "Suggestions rapides",
      showMore: "Voir toutes les options",
      // Marketing-site suggestion set (Phase 1B §4, enriched Phase 1C) —
      // distinct from the Next.js dashboard widget's chips
      // (lib/i18n/dictionaries/chat.ts): an anonymous public-map.com
      // visitor is a prospect, not a signed-in user, so labels stay
      // prospect-facing. Every id here matches exactly one branch/leaf in
      // lib/chat/ai-mock-provider.ts (see that file's SITE_SUGGESTIONS,
      // *_SUB_SUGGESTIONS and SITE_LEAVES) — clicking any of these cards
      // sends this exact label text as a real message (see sendMessage),
      // never a second, decorative-only chip.
      suggestions: {
        // Compact main 4 + "voir toutes les options" 7 + human's discreet CTA.
        visibility: "📍 Développer ma visibilité",
        lead_generation: "📈 Obtenir plus de clients",
        automation: "🤖 Automatiser mon activité",
        website: "🌐 Créer/améliorer mon site",
        gbp: "📍 Optimiser mon Google Business Profile",
        google_ads: "📣 Lancer ou améliorer mes Google Ads",
        seo: "🔍 Améliorer mon SEO",
        quote: "🧾 Obtenir un devis",
        automation_setup: "⚙️ Mettre en place des automatisations",
        performance_review: "📊 Analyser mes performances digitales",
        reviews: "⭐ Obtenir plus d'avis clients",
        browse_services: "🗂️ Voir les services",
        human: "🎧 Parler à un expert",
        // Google Business Profile sub-menu.
        gbp_audit: "🔎 Audit du profil",
        gbp_info: "📝 Optimisation des informations",
        seo_local: "📍 SEO local",
        gbp_reviews: "⭐ Gestion des avis",
        gbp_posts: "🗞️ Publications",
        gbp_photos: "📷 Photos",
        gbp_performance: "📈 Suivi des performances",
        // Google Ads sub-menu.
        ads_new_campaign: "🚀 Créer une campagne",
        ads_audit: "🔎 Auditer une campagne existante",
        ads_search: "🔍 Search",
        ads_pmax: "⚡ Performance Max",
        ads_display: "🖼️ Display",
        ads_conversion_tracking: "🎯 Suivi des conversions",
        ads_reports: "📄 Rapports",
        // SEO sub-menu.
        seo_technical: "⚙️ SEO technique",
        seo_keywords: "🔑 Recherche de mots-clés",
        seo_pages: "📄 Optimisation des pages",
        seo_search_console: "🛠️ Search Console",
        seo_audit: "🔎 Audit SEO",
        // Website sub-menu.
        website_showcase: "🏠 Site vitrine",
        website_booking: "📅 Réservation",
        website_ecommerce: "🛒 E-commerce",
        website_landing: "🎯 Landing page",
        website_custom: "🧩 Plateforme personnalisée",
        // Automation sub-menu.
        automation_leads: "📥 Automatiser mes leads",
        automation_support: "💬 Automatiser mon support client",
        automation_emails: "✉️ Automatiser mes emails",
        automation_whatsapp: "🟢 Automatiser WhatsApp",
        automation_crm: "🗂️ Automatiser mon CRM",
        automation_integrations: "🔗 n8n / Webhooks",
        automation_examples: "💡 Voir des exemples",
        // Lead-generation sub-menu (new leaves only).
        leadgen_forms: "📋 Formulaires",
        leadgen_qualification: "✅ Qualification automatique",
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
      greetingAnonymous: "👋 Hi! I'm the PUBLIC-MAP Assistant.\nI can help you with your online presence, SEO, Google Ads, websites and business automation.\n\nWhat would you like to improve today?",
      typingIndicator: "PUBLIC-MAP Assistant is typing…",
      inputPlaceholder: "Ask PUBLIC-MAP anything…",
      sendAriaLabel: "Send",
      errorGeneric: "Something went wrong. Please try again.",
      errorRateLimited: "Too many messages sent. Please wait a moment before trying again.",
      retry: "Retry",
      suggestionsTitle: "Quick suggestions",
      showMore: "See all options",
      suggestions: {
        visibility: "📍 Grow my visibility",
        lead_generation: "📈 Get more customers",
        automation: "🤖 Automate my business",
        website: "🌐 Build/improve my website",
        gbp: "📍 Optimize my Google Business Profile",
        google_ads: "📣 Launch or improve my Google Ads",
        seo: "🔍 Improve my SEO",
        quote: "🧾 Get a quote",
        automation_setup: "⚙️ Set up business automations",
        performance_review: "📊 Analyze my digital performance",
        reviews: "⭐ Get more customer reviews",
        browse_services: "🗂️ See services",
        human: "🎧 Talk to an expert",
        gbp_audit: "🔎 Profile audit",
        gbp_info: "📝 Business info optimization",
        seo_local: "📍 Local SEO",
        gbp_reviews: "⭐ Reviews management",
        gbp_posts: "🗞️ Posts",
        gbp_photos: "📷 Photos",
        gbp_performance: "📈 Performance tracking",
        ads_new_campaign: "🚀 Create a campaign",
        ads_audit: "🔎 Audit an existing campaign",
        ads_search: "🔍 Search",
        ads_pmax: "⚡ Performance Max",
        ads_display: "🖼️ Display",
        ads_conversion_tracking: "🎯 Conversion tracking",
        ads_reports: "📄 Reports",
        seo_technical: "⚙️ Technical SEO",
        seo_keywords: "🔑 Keyword research",
        seo_pages: "📄 Page optimization",
        seo_search_console: "🛠️ Search Console",
        seo_audit: "🔎 SEO audit",
        website_showcase: "🏠 Showcase website",
        website_booking: "📅 Booking website",
        website_ecommerce: "🛒 E-commerce",
        website_landing: "🎯 Landing page",
        website_custom: "🧩 Custom platform",
        automation_leads: "📥 Automate my leads",
        automation_support: "💬 Automate my customer support",
        automation_emails: "✉️ Automate my emails",
        automation_whatsapp: "🟢 Automate WhatsApp",
        automation_crm: "🗂️ Automate my CRM",
        automation_integrations: "🔗 n8n / Webhooks",
        automation_examples: "💡 See examples",
        leadgen_forms: "📋 Forms",
        leadgen_qualification: "✅ Automatic qualification",
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
    // Optional fields (conversationId before any reply has come back yet,
    // suggestionId when not from a chip) are tracked locally as `null` —
    // the backend's Zod schemas use .optional(), which accepts an absent
    // key but rejects a literal null, so strip null/undefined keys here
    // rather than at every call site.
    var cleanBody = {};
    Object.keys(body).forEach(function (key) {
      if (body[key] !== null && body[key] !== undefined) cleanBody[key] = body[key];
    });
    return fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(cleanBody),
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
    // interfaceLocale: the page's own FR/EN toggle state (see
    // resolveLocale()) — always sent to the backend as-is, the true
    // "interface locale" signal (lib/chat/conversation-language.ts's
    // priority rule 2). conversationLocale: what UI copy (t) actually
    // renders in — starts equal to interfaceLocale, then follows either a
    // real toggle change (see watchLanguageChanges below) or the resolved
    // `language` the backend returns after each message, so suggestion
    // chips/lead form/placeholder never lag behind the conversation's own
    // established language the way they used to when a single `locale`
    // var served both purposes.
    var interfaceLocale = resolveLocale();
    var conversationLocale = interfaceLocale;
    var t = PM_CHAT_STRINGS[conversationLocale];
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
      if (newLocale === interfaceLocale) return;
      interfaceLocale = newLocale;
      // A real, deliberate toggle wins immediately — matches priority
      // rule 2 outranking rule 3 (previously-established language).
      conversationLocale = newLocale;
      t = PM_CHAT_STRINGS[conversationLocale];
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
          el("p", { class: "pm-chat-header-name-row" }, [el("span", { class: "pm-chat-header-spark", "aria-hidden": "true", text: "✨" }), el("span", { class: "pm-chat-header-name", text: t.assistantName })]),
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
      // Phase 1C: "Suggestions rapides" appears immediately alongside the
      // greeting, before any real exchange — once the visitor sends a
      // first message, messages.length is never 0 again for this
      // conversation, so this naturally stops rendering (see sendMessage).
      if (messages.length === 0) {
        messagesEl.appendChild(renderInitialSuggestions());
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ---- Suggestion cards (Phase 1C) ---------------------------------------
    // Every label is "EMOJI title" (see PM_CHAT_STRINGS.suggestions) — split
    // once here so the card can lay the icon and the short title out
    // separately instead of wrapping them as one run of text.
    function buildSuggestionCard(id, label) {
      var match = /^(\S+)\s+([\s\S]+)$/.exec(label);
      var iconText = match ? match[1] : "💬";
      var titleText = match ? match[2] : label;
      var card = el("button", { type: "button", class: "pm-chat-suggestion-card" }, [
        el("span", { class: "pm-chat-suggestion-icon", "aria-hidden": "true", text: iconText }),
        el("span", { class: "pm-chat-suggestion-label", text: titleText }),
      ]);
      card.addEventListener("click", function () {
        sendMessage(label, id);
      });
      return card;
    }

    function buildSuggestionGrid(ids) {
      var grid = el("div", { class: "pm-chat-suggestions-grid" });
      ids.forEach(function (id) {
        var label = t.suggestions[id];
        if (!label) return;
        grid.appendChild(buildSuggestionCard(id, label));
      });
      return grid;
    }

    function renderInitialSuggestions() {
      var section = el("div", { class: "pm-chat-initial-suggestions" });
      section.appendChild(el("p", { class: "pm-chat-suggestions-title", text: t.suggestionsTitle }));
      section.appendChild(buildSuggestionGrid(INITIAL_SUGGESTIONS_MAIN));

      var moreGrid = buildSuggestionGrid(INITIAL_SUGGESTIONS_MORE);
      moreGrid.hidden = true;
      var moreBtn = el("button", { type: "button", class: "pm-chat-suggestions-more-btn", text: t.showMore });
      moreBtn.addEventListener("click", function () {
        moreGrid.hidden = false;
        moreBtn.remove();
        messagesEl.scrollTop = messagesEl.scrollHeight;
      });
      section.appendChild(moreBtn);
      section.appendChild(moreGrid);

      var expertBtn = el("button", { type: "button", class: "pm-chat-expert-btn", text: t.suggestions.human });
      expertBtn.addEventListener("click", function () {
        sendMessage(t.suggestions.human, "human");
      });
      section.appendChild(expertBtn);

      return section;
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
      var wrap = el("div", { class: "pm-chat-suggestions" }, [buildSuggestionGrid(suggestions)]);
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

    // Applies a backend-resolved conversation language without a full
    // renderPanel() (which would rebuild the whole message list and
    // refocus the input on every single turn — too disruptive). Any
    // suggestion/lead-form render that happens right after this call
    // already reads the updated `t` naturally.
    function applyConversationLocale(newLocale) {
      if (newLocale !== "fr" && newLocale !== "en") return;
      if (newLocale === conversationLocale) return;
      conversationLocale = newLocale;
      t = PM_CHAT_STRINGS[conversationLocale];
      if (inputEl) {
        inputEl.setAttribute("placeholder", t.inputPlaceholder);
        inputEl.setAttribute("aria-label", t.inputPlaceholder);
      }
    }

    function sendMessage(content, suggestionId) {
      appendLocalMessage("visitor", content);
      suggestions = [];
      renderSuggestions();
      lastFailedContent = content;
      var typingRow = renderTyping();

      // Always the real interface locale (rule 2's input) — never
      // conversationLocale, which would conflate "what the backend last
      // resolved" with "what the page's own toggle currently says".
      postChat({ type: "message", content: content, locale: interfaceLocale, conversationId: conversationId, suggestionId: suggestionId, surface: "site" })
        .then(function (result) {
          typingRow.remove();
          conversationId = result.conversationId;
          applyConversationLocale(result.language);
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
          // The established conversation language, not the raw interface
          // toggle — this is only what picks the confirmation text's
          // language server-side.
          locale: conversationLocale,
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
