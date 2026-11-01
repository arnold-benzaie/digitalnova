// Single source of truth for PUBLIC-MAP's Google Analytics 4 setup.
// Every page includes exactly one line — <script src="/analytics.js" async></script> —
// instead of repeating the gtag.js snippet and measurement ID per page.
// Automatic pageview tracking is GA4's default behavior on gtag('config', ...);
// no extra code is needed for it. No custom event parameters are sent anywhere
// in this file, so no email/name/phone/PII risk exists in what this code collects.
//
// Consent: gtag.js is NOT loaded until the visitor clicks "Accept" in the
// bottom banner this file renders. Before a choice, or after "Reject",
// nothing is sent to Google Analytics (no cookie, no cookieless ping).
// The choice is remembered in localStorage so returning visitors aren't
// asked again, and it can be changed at any time from the "Manage cookies"
// link this file adds to the page footer (or any [data-pm-cookie-settings]
// element): withdrawing consent stops measurement on the current page and
// deletes this site's Google Analytics cookies.
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
  });
  function storedChoice() {
    try {
      return localStorage.getItem(CONSENT_KEY);
    } catch (e) {
      return null;
    }
  }
  var gaLoaded = false;
  function loadAnalytics() {
    window["ga-disable-" + GA_MEASUREMENT_ID] = false;
    gtag("consent", "update", { analytics_storage: "granted" });
    if (gaLoaded) return;
    gaLoaded = true;
    gtag("js", new Date());
    gtag("config", GA_MEASUREMENT_ID);
    var gtagScript = document.createElement("script");
    gtagScript.async = true;
    gtagScript.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_MEASUREMENT_ID;
    document.head.appendChild(gtagScript);
  }
  // Removes _ga, _ga_<id>, _gid and _gat* on this host and its parent domains
  // (GA4 sets them on the widest domain it can).
  function clearAnalyticsCookies() {
    var names = document.cookie.split(";").map(function (c) {
      return c.split("=")[0].trim();
    }).filter(function (n) {
      return n === "_ga" || n.indexOf("_ga_") === 0 || n === "_gid" || n.indexOf("_gat") === 0;
    });
    var parts = location.hostname.split(".");
    var domains = [""];
    for (var i = 0; i < parts.length - 1; i++) domains.push("." + parts.slice(i).join("."));
    names.forEach(function (n) {
      domains.forEach(function (d) {
        document.cookie = n + "=; Max-Age=0; path=/" + (d ? "; domain=" + d : "");
      });
    });
  }
  function applyChoice(granted) {
    try {
      localStorage.setItem(CONSENT_KEY, granted ? "granted" : "denied");
    } catch (e) {}
    if (granted) {
      loadAnalytics();
    } else {
      window["ga-disable-" + GA_MEASUREMENT_ID] = true;
      gtag("consent", "update", { analytics_storage: "denied" });
      clearAnalyticsCookies();
    }
  }
  var existing = storedChoice();
  if (existing === "granted") loadAnalytics();
  if (existing === "denied") clearAnalyticsCookies();

  // Reuses the site's own FR/EN system rather than a second one: both the
  // homepage (i18n-sparkles.js) and the legal pages (their own inline
  // toggle) already persist the active language under this exact
  // localStorage key, regardless of which of the two implementations is
  // present on a given page.
  var SITE_LANG_KEY = "digitalnova-lang";
  var COPY = {
    fr: {
      text: "Avec votre accord, nous utilisons des cookies Google Analytics pour mesurer l’audience du site. Sans accord, aucune mesure n’est envoyée à Google Analytics. Le contenu saisi dans les formulaires ne lui est jamais transmis. Vous pouvez changer d’avis à tout moment avec « Gérer les cookies » en bas de page.",
      accept: "Accepter",
      reject: "Refuser",
      link: "Politique de confidentialité",
      manage: "Gérer les cookies",
      granted: "Choix actuel : accepté.",
      denied: "Choix actuel : refusé.",
      region: "Choix concernant les cookies",
    },
    en: {
      text: "With your consent, we use Google Analytics cookies to measure site traffic. Without consent, no measurement is sent to Google Analytics. What you type in forms is never sent to it. You can change your mind at any time with “Manage cookies” at the bottom of the page.",
      accept: "Accept",
      reject: "Reject",
      link: "Privacy policy",
      manage: "Manage cookies",
      granted: "Current choice: accepted.",
      denied: "Current choice: rejected.",
      region: "Cookie choice",
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

  var openBar = null;
  function renderBanner() {
    if (openBar) return;
    var bar = document.createElement("div");
    bar.id = "pm-cookie-banner";
    bar.setAttribute("role", "region");
    bar.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;" +
      "background:#061425;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;" +
      "padding:16px 20px;display:flex;flex-wrap:wrap;gap:12px 16px;align-items:center;justify-content:center;" +
      "box-shadow:0 -4px 20px rgba(0,0,0,0.25);font-size:14px;line-height:1.5;";

    var text = document.createElement("span");
    text.style.cssText = "flex:1 1 320px;min-width:200px;";
    var status = document.createElement("strong");
    status.style.cssText = "display:block;margin-top:4px;font-weight:600;";
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
      var choice = storedChoice();
      bar.setAttribute("aria-label", t.region);
      text.textContent = t.text + " ";
      link.textContent = t.link;
      text.appendChild(link);
      status.textContent = choice === "granted" ? t.granted : choice === "denied" ? t.denied : "";
      if (status.textContent) text.appendChild(status);
      rejectBtn.textContent = t.reject;
      acceptBtn.textContent = t.accept;
    }
    applyCopy();

    function dismiss(granted) {
      applyChoice(granted);
      bar.remove();
      openBar = null;
      document.removeEventListener("click", onPossibleLangClick);
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
    // still on screen. Two hooks, since the site's two toggle
    // implementations don't share one signal: i18n-sparkles.js
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

    openBar = bar;
    document.body.appendChild(bar);
  }

  // "Manage cookies": a link added next to the footer's privacy link, plus
  // any element marked [data-pm-cookie-settings] (e.g. on the privacy page).
  function addManageLink() {
    var footer = document.querySelector("footer");
    if (!footer || footer.querySelector("[data-pm-cookie-settings]")) return;
    var privacy = footer.querySelector('a[href="/privacy"]');
    var manage = document.createElement("a");
    manage.href = "#";
    manage.setAttribute("role", "button");
    manage.setAttribute("data-pm-cookie-settings", "");
    if (privacy && privacy.className) manage.className = privacy.className;
    (privacy ? privacy.parentNode : footer).appendChild(manage);
  }
  function refreshManageLabels() {
    var label = COPY[currentSiteLang()].manage;
    var nodes = document.querySelectorAll("[data-pm-cookie-settings]");
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].hasAttribute("data-pm-keep-text")) nodes[i].textContent = label;
    }
  }
  function init() {
    addManageLink();
    refreshManageLabels();
    document.addEventListener("click", function (e) {
      var trigger = e.target && e.target.closest && e.target.closest("[data-pm-cookie-settings]");
      if (trigger) {
        e.preventDefault();
        renderBanner();
      } else if (e.target && e.target.closest && e.target.closest("[data-lang]")) {
        setTimeout(refreshManageLabels, 0);
      }
    });
    document.addEventListener("digitalnova:language-updated", refreshManageLabels);
    if (!storedChoice()) renderBanner(); // first visit: ask once
  }
  window.pmCookieConsent = { open: renderBanner, choice: storedChoice };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
