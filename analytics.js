// Single source of truth for PUBLIC-MAP's Google Analytics 4 setup.
// Every page includes exactly one line — <script src="/analytics.js" async></script> —
// instead of repeating the gtag.js snippet and measurement ID per page.
// Automatic pageview tracking is GA4's default behavior on gtag('config', ...);
// no extra code is needed for it.
(function () {
  var GA_MEASUREMENT_ID = "G-DSRTDWQ0P2";

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    dataLayer.push(arguments);
  }
  window.gtag = gtag;

  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID);

  var script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_MEASUREMENT_ID;
  document.head.appendChild(script);
})();
