/* ═══════════════════════════════════════════════════════
   DIGITALNOVA — Dynamic Pricing by Zone
   Swaps prices/currencies/labels based on body.eu-active
   ═══════════════════════════════════════════════════════ */

(function dynamicPricing(){
  function getZone(){
    return document.body.classList.contains('eu-active') ? 'eu' : 'ca';
  }

  function zoneText(card, zone, key){
    const isEnglish = document.documentElement.lang === 'en';
    const enKey = zone + key + 'En';
    const baseKey = zone + key;
    return (isEnglish && card.dataset[enKey]) ? card.dataset[enKey] : card.dataset[baseKey];
  }

  function fmtAmount(amount, currency){
    const locale = document.documentElement.lang === 'en' ? 'en-CA' : 'fr-CA';
    const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(amount));
    // CAD: "$1 000 CAD" · EU: "219 € HT" or "255 € TTC"
    if(currency.startsWith('€') || currency === 'EUR' || currency.includes('€')){
      return { num: formatted + ' €', cur: currency.replace('€','').trim() || 'HT' };
    }
    return { num: '$' + formatted, cur: currency };
  }

  function syncCard(card, zone){
    const amount = card.dataset[zone + 'Amount'];
    const currency = card.dataset[zone + 'Currency'];
    const period = zoneText(card, zone, 'Period') || card.dataset[zone + 'Period'];
    if(!amount) return;

    const numEl = card.querySelector('.amount-num');
    const curEl = card.querySelector('.amount-cur');
    const perEl = card.querySelector('.g-price-period');
    const btn   = card.querySelector('.g-price-btn');

    const f = fmtAmount(amount, currency);
    if(numEl) numEl.textContent = f.num;
    if(curEl) curEl.textContent = f.cur;
    if(perEl && period) perEl.textContent = period;

    // Regional bonus features
    card.querySelectorAll('.feat-region-bonus').forEach(li => {
      const bonus = zoneText(card, zone, 'FeatBonus');
      if(bonus) li.textContent = bonus;
    });
    card.querySelectorAll('.feat-region-articles').forEach(li => {
      const txt = zoneText(card, zone, 'FeatArticles');
      if(txt) li.textContent = txt;
    });

    // Update button label
    if(btn){
      const isEnglish = document.documentElement.lang === 'en';
      const locale = isEnglish ? 'en-CA' : 'fr-CA';
      const formatted = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(amount));
      const action = isEnglish ? 'Request a quote' : 'Demander un devis';
      const suffix = f.cur || (zone === 'eu' ? (isEnglish ? 'excl. tax' : 'HT') : 'CAD');
      const label = zone === 'eu' ? `${action} — ${formatted} € ${suffix} →` : `${action} — $${formatted} ${suffix} →`;
      btn.textContent = label;
    }

    // Update optional text fields when a pack needs zone-specific copy
    const nameEl = card.querySelector('.g-price-name');
    const nameAttr = zoneText(card, zone, 'Name');
    if(nameEl && nameAttr) nameEl.textContent = nameAttr;

    const descEl = card.querySelector('.g-price-desc');
    const descAttr = zoneText(card, zone, 'Desc');
    if(descEl && descAttr) descEl.textContent = descAttr;

    // Update title if title attribute exists
    const titleEl = card.querySelector('.g-price-title');
    const titleAttr = zoneText(card, zone, 'Title');
    if(titleEl && titleAttr) titleEl.textContent = titleAttr;
  }

  function syncSwitcherBanner(zone){
    const flag = document.getElementById('price-zone-flag');
    const title = document.getElementById('price-zone-title');
    const sub = document.getElementById('price-zone-sub');
    const qbCa = document.getElementById('qb-ca');
    const qbEu = document.getElementById('qb-eu');
    if(!flag || !title || !sub) return;

    if(zone === 'eu'){
      flag.textContent = '🇫🇷/🇪🇺';
      title.style.color = '#003399';
      title.textContent = 'Affichage en Euro (EUR)';
      sub.textContent = 'Conformité RGPD · Bureau Paris CET · TVA selon l’offre · Cliquez sur Canada pour basculer en CAD';
      if(qbCa){
        qbCa.style.background = '#fff';
        qbCa.style.color = '#1B5BFF';
        qbCa.style.border = '1.5px solid #1B5BFF';
      }
      if(qbEu){
        qbEu.style.background = '#003399';
        qbEu.style.color = '#fff';
        qbEu.style.border = 'none';
      }
    } else {
      flag.textContent = '🇨🇦';
      title.style.color = '#1B5BFF';
      title.textContent = 'Affichage en Dollar Canadien (CAD)';
      sub.textContent = 'Bureau Montréal · Support jours ouvrés EST/PST · Cliquez sur Europe pour basculer en EUR';
      if(qbCa){
        qbCa.style.background = '#1B5BFF';
        qbCa.style.color = '#fff';
        qbCa.style.border = 'none';
      }
      if(qbEu){
        qbEu.style.background = '#fff';
        qbEu.style.color = '#003399';
        qbEu.style.border = '1.5px solid #003399';
      }
    }
  }

  function syncAll(){
    const zone = getZone();
    document.querySelectorAll('.dyn-price-card').forEach(card => syncCard(card, zone));
    syncSwitcherBanner(zone);
    document.dispatchEvent(new CustomEvent('digitalnova:pricing-updated'));
  }

  // Open the quote modal with current-zone values pulled from the card
  window.openDynModal = function(btn){
    const card = btn.closest('.dyn-price-card');
    if(!card) return;
    const zone = getZone();
    const amount = card.dataset[zone + 'Amount'];
    const currency = card.dataset[zone + 'Currency'];
    const f = fmtAmount(amount, currency || (zone === 'eu' ? '€ HT' : 'CAD'));
    const modalLabel = zoneText(card, zone, 'Modal') || 'Service';
    if(typeof window.openModal === 'function'){
      window.openModal(modalLabel, amount, amount, zone, f.cur);
    }
  };

  // Watch for body class changes (when setZone toggles eu-active)
  const observer = new MutationObserver(muts => {
    muts.forEach(m => {
      if(m.attributeName === 'class') syncAll();
    });
  });

  function init(){
    observer.observe(document.body, { attributes: true });
    document.addEventListener('digitalnova:language-updated', syncAll);
    syncAll();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
