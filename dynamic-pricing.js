/* ═══════════════════════════════════════════════════════
   DIGITALNOVA — Dynamic Pricing by Zone
   Swaps prices/currencies/labels based on body.eu-active
   ═══════════════════════════════════════════════════════ */

(function dynamicPricing(){
  function getZone(){
    return document.body.classList.contains('eu-active') ? 'eu' : 'ca';
  }

  function fmtAmount(amount, currency){
    // CAD: "$299 CAD" · EU: "299 € HT"
    if(currency.startsWith('€') || currency === 'EUR' || currency.includes('€')){
      return { num: amount + ' €', cur: currency.replace('€','').trim() || 'HT' };
    }
    return { num: '$' + amount, cur: currency };
  }

  function syncCard(card, zone){
    const amount = card.dataset[zone + 'Amount'];
    const currency = card.dataset[zone + 'Currency'];
    const period = card.dataset[zone + 'Period'];
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
      const bonus = card.dataset[zone + 'FeatBonus'];
      if(bonus) li.textContent = bonus;
    });
    card.querySelectorAll('.feat-region-articles').forEach(li => {
      const txt = card.dataset[zone + 'FeatArticles'];
      if(txt) li.textContent = txt;
    });

    // Update button label
    if(btn){
      const label = zone === 'eu' ? `Commander ${amount} € HT →` : `Commander $${amount} CAD →`;
      btn.textContent = label;
    }

    // Update green title for pack 3 if title attribute exists
    const titleEl = card.querySelector('.g-price-title');
    const titleAttr = card.dataset[zone + 'Title'];
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
      flag.textContent = '🇪🇺';
      title.style.color = '#003399';
      title.textContent = 'Affichage en Euro HT (EUR)';
      sub.textContent = 'Conformité RGPD · Bureau Paris CET · Facturation en euros · Cliquez sur Canada pour basculer en CAD';
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
      sub.textContent = 'Bureau Montréal · Support EST/PST 7j/7 · Cliquez sur Europe pour basculer en EUR';
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
  }

  // Open Stripe modal with current-zone values pulled from the card
  window.openDynModal = function(btn){
    const card = btn.closest('.dyn-price-card');
    if(!card) return;
    const zone = getZone();
    const amount = card.dataset[zone + 'Amount'];
    const modalLabel = card.dataset[zone + 'Modal'] || 'Service';
    if(typeof window.openModal === 'function'){
      window.openModal(modalLabel, amount, amount, zone);
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
    syncAll();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
