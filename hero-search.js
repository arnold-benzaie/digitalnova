/* ═══════════════════════════════════════════════════════════════
   PUBLIC-MAP — Hero search-bar typewriter (visual only, isolated)
   Types realistic Google queries in the decorative hero search field.
   Reads the active language live so it stays in sync with FR/EN toggle.
   Does not touch any existing logic; safe to remove at any time.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  var field = document.querySelector('.hero-searchbar .hsb-field');
  if (!field) return;
  var QUERIES = {
    fr: [
      'restaurant près de moi',
      'hôtel bord de mer',
      'garagiste ouvert maintenant',
      'dentiste en urgence',
      'meilleur café du quartier',
      'agent immobilier près de moi'
    ],
    en: [
      'restaurant near me',
      'seaside hotel',
      'garage open now',
      'emergency dentist',
      'best coffee nearby',
      'real estate agent near me'
    ]
  };

  function lang() {
    var active = document.querySelector('.lang-btn.active, .lang-btn[aria-pressed="true"]');
    if (active && /en/i.test(active.textContent)) return 'en';
    if ((document.documentElement.lang || '').toLowerCase().indexOf('en') === 0) return 'en';
    return 'fr';
  }

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    var still = function () { field.textContent = QUERIES[lang()][0]; };
    still();
    document.addEventListener('digitalnova:language-updated', still);
    return;
  }

  var caret = document.createElement('span');
  caret.className = 'hsb-caret';

  var qi = 0, ci = 0, deleting = false;

  function render(text) {
    field.textContent = text;
    field.appendChild(caret);
  }

  function tick() {
    var list = QUERIES[lang()] || QUERIES.fr;
    if (qi >= list.length) qi = 0;
    var full = list[qi];

    if (!deleting) {
      ci++;
      render(full.slice(0, ci));
      if (ci >= full.length) { deleting = true; return setTimeout(tick, 1500); }
      return setTimeout(tick, 55 + Math.random() * 45);
    } else {
      ci--;
      render(full.slice(0, ci));
      if (ci <= 0) { deleting = false; qi++; return setTimeout(tick, 320); }
      return setTimeout(tick, 28);
    }
  }

  render('');
  setTimeout(tick, 600);
})();
