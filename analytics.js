// Single source of truth for PUBLIC-MAP's Google Analytics 4 setup.
// Every page includes exactly one line — <script src="/analytics.js" async></script> —
// instead of repeating the gtag.js snippet and measurement ID per page.
// Automatic pageview tracking is GA4's default behavior on gtag('config', ...);
// no extra code is needed for it. No custom event parameters are sent anywhere
// in this file, so no email/name/phone/PII risk exists in what this code collects.
//
// Consent Mode v2: analytics_storage (and the ad_* signals, declared for
// completeness even though this site sends no ad data) default to "denied"
// until the visitor makes an explicit choice via the bottom banner this file
// also renders — no separate consent-banner script/tag needed. Until
// granted, GA4 receives cookieless, non-personalized pings only; no _ga
// cookie is set. The choice is remembered in localStorage so returning
// visitors aren't asked again.
(function () {
  var GA_MEASUREMENT_ID = "G-DSRTDWQ0P2";
  var CONSENT_KEY = "pm_consent";

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    dataLayer.push(arguments);
  }
  window.gtag = gtag;

  gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500,
  });

  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID);

  var gtagScript = document.createElement("script");
  gtagScript.async = true;
  gtagScript.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_MEASUREMENT_ID;
  document.head.appendChild(gtagScript);

  function storedChoice() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (e) {
      return null;
    }
  }

  function applyChoice(granted) {
    try {
      localStorage.setItem(CONSENT_KEY, granted ? "granted" : "denied");
    } catch (e) {}
    gtag("consent", "update", { analytics_storage: granted ? "granted" : "denied" });
  }

  var existing = storedChoice();
  if (existing === "granted") applyChoice(true);
  if (existing === "denied") applyChoice(false);

  if (existing) return; // already decided on a prior visit — no banner needed

  // Reuses the site's own FR/EN system rather than a second one: both the
  // homepage (i18n-sparkles.js) and the legal pages (their own inline
  // toggle) already persist the active language under this exact
  // localStorage key, regardless of which of the two implementations is
  // present on a given page.
  var SITE_LANG_KEY = "digitalnova-lang";
  var COPY = {
    fr: {
      text: "Nous utilisons des cookies pour mesurer le trafic du site avec Google Analytics. Aucune donnée personnelle n'est collectée dans ces événements.",
      accept: "Accepter",
      reject: "Refuser",
      link: "Politique de confidentialité",
    },
    en: {
      text: "We use cookies to measure site traffic with Google Analytics. No personal data is collected in these events.",
      accept: "Accept",
      reject: "Reject",
      link: "Privacy policy",
    },
  };

  function currentSiteLang() {
    var saved;
    try {
      saved = localStorage.getItem(SITE_LANG_KEY);
    } catch (e) {
      saved = null;
    }
    return saved === "en" ? "en" : "fr"; // same default as both existing toggles
  }

  function renderBanner() {
    var bar = document.createElement("div");
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Cookie consent");
    bar.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;" +
      "background:#061425;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;" +
      "padding:16px 20px;display:flex;flex-wrap:wrap;gap:12px 16px;align-items:center;justify-content:center;" +
      "box-shadow:0 -4px 20px rgba(0,0,0,0.25);font-size:14px;line-height:1.5;";

    var text = document.createElement("span");
    text.style.cssText = "flex:1 1 320px;min-width:200px;";
    var link = document.createElement("a");
    link.href = "/privacy";
    link.style.cssText = "color:#7ab8ff;text-decoration:underline;";

    var actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:10px;flex:0 0 auto;";

    var rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.style.cssText =
      "padding:9px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.35);background:transparent;color:#fff;cursor:pointer;font-size:14px;";

    var acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.style.cssText =
      "padding:9px 18px;border-radius:8px;border:none;background:#0039e4;color:#fff;cursor:pointer;font-weight:600;font-size:14px;";

    function applyCopy() {
      var t = COPY[currentSiteLang()];
      text.textContent = t.text + " ";
      link.textContent = t.link;
      text.appendChild(link);
      rejectBtn.textContent = t.reject;
      acceptBtn.textContent = t.accept;
    }
    applyCopy();

    function dismiss(granted) {
      applyChoice(granted);
      bar.remove();
      document.removeEventListener("click", onPossibleLangClick, true);
      document.removeEventListener("digitalnova:language-updated", applyCopy);
    }
    rejectBtn.addEventListener("click", function () {
      dismiss(false);
    });
    acceptBtn.addEventListener("click", function () {
      dismiss(true);
    });

    actions.appendChild(rejectBtn);
    actions.appendChild(acceptBtn);
    bar.appendChild(text);
    bar.appendChild(actions);

    // Language change never resets the consent choice — this only
    // updates the banner's own displayed text, and only while it's
    // still on screen (pre-decision). Two hooks, since the site's two
    // toggle implementations don't share one signal: i18n-sparkles.js
    // (homepage) dispatches this event; the legal pages' inline toggle
    // doesn't, so a delegated click listener on any [data-lang] control
    // covers both without assuming either page's exact markup.
    function onPossibleLangClick(e) {
      if (e.target && e.target.closest && e.target.closest("[data-lang]")) {
        // Deferred: this runs in the bubble phase, which can still fire
        // before the site's own click handler (registration order isn't
        // guaranteed across independent scripts) — setTimeout(0) waits
        // until that handler's synchronous work (including its
        // localStorage write) has actually finished.
        setTimeout(applyCopy, 0);
      }
    }
    document.addEventListener("digitalnova:language-updated", applyCopy);
    document.addEventListener("click", onPossibleLangClick);

    if (document.body) {
      document.body.appendChild(bar);
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        document.body.appendChild(bar);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderBanner);
  } else {
    renderBanner();
  }
})();
