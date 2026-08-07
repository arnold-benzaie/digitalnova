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

  var isEnglish = (navigator.language || "").toLowerCase().indexOf("en") === 0;
  var copy = isEnglish
    ? {
        text: "We use cookies to measure site traffic (Google Analytics). No personal data is collected in these events.",
        accept: "Accept",
        reject: "Reject",
        link: "Privacy policy",
      }
    : {
        text: "Nous utilisons des cookies pour mesurer l'audience du site (Google Analytics). Aucune donnée personnelle n'est collectée dans ces événements.",
        accept: "Accepter",
        reject: "Refuser",
        link: "Politique de confidentialité",
      };

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
    text.textContent = copy.text + " ";
    var link = document.createElement("a");
    link.href = "/privacy";
    link.textContent = copy.link;
    link.style.cssText = "color:#7ab8ff;text-decoration:underline;";
    text.appendChild(link);

    var actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:10px;flex:0 0 auto;";

    var rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.textContent = copy.reject;
    rejectBtn.style.cssText =
      "padding:9px 18px;border-radius:8px;border:1px solid rgba(255,255,255,0.35);background:transparent;color:#fff;cursor:pointer;font-size:14px;";

    var acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.textContent = copy.accept;
    acceptBtn.style.cssText =
      "padding:9px 18px;border-radius:8px;border:none;background:#0039e4;color:#fff;cursor:pointer;font-weight:600;font-size:14px;";

    function dismiss(granted) {
      applyChoice(granted);
      bar.remove();
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
