/* ═══════════════════════════════════════════════════════
   🌍 PUBLIC-MAP — « Ma sélection pour devis » (quote list)
   - Détecte chaque carte service et ajoute un bouton « Ajouter à ma sélection »
   - Volet latéral : services choisis (une fois chacun), montant indicatif
   - Persistance localStorage (survit aux rechargements)
   - Une seule devise par sélection (CAD ou EUR) ; HT/TTC conservé par ligne
   - Bilingue FR/EN
   - Une sélection n'est pas une commande : « Demander un devis » ouvre la
     demande de devis par e-mail avec la liste des services. Aucun paiement.
   ═══════════════════════════════════════════════════════ */

(function injectCartStyles(){
  const css = `
    /* CART BUTTON in nav */
    #cart-toggle {
      position: relative;
      background: var(--gray-100, #F1F4F8);
      border: 1px solid var(--gray-200, #E5EAF0);
      border-radius: 50%;
      width: 38px; height: 38px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; margin-right: 8px;
      transition: all .3s cubic-bezier(.2,.8,.2,1);
      font-size: 16px;
    }
    #cart-toggle:hover { transform: scale(1.1); border-color: var(--tech-blue, #1B5BFF); }
    #cart-toggle:active { transform: scale(.95); }
    #cart-count {
      position: absolute; top: -4px; right: -4px;
      background: var(--tech-blue, #1B5BFF);
      color: #fff;
      border-radius: 999px;
      min-width: 18px; height: 18px; padding: 0 5px;
      font-size: 10px; font-weight: 800;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 10px rgba(27,91,255,.4);
      animation: cartBadgePop .3s ease;
    }
    #cart-count.zero { display: none; }
    @keyframes cartBadgePop {
      from { transform: scale(0); }
      60%  { transform: scale(1.3); }
      to   { transform: scale(1); }
    }

    /* Nav over dark hero — invert cart button style */
    nav:not(.scrolled) #cart-toggle {
      background: rgba(255,255,255,.12) !important;
      border-color: rgba(255,255,255,.18) !important;
      color: #fff;
    }

    /* CART DRAWER */
    #cart-drawer {
      position: fixed;
      top: 0; right: 0; bottom: 0;
      width: 100%; max-width: 440px;
      background: #FFFFFF;
      z-index: 8800;
      display: flex; flex-direction: column;
      transform: translateX(100%);
      transition: transform .4s cubic-bezier(.4,.0,.2,1);
      box-shadow: -24px 0 60px rgba(10,37,64,.20);
    }
    #cart-drawer.open { transform: translateX(0); }
    #cart-backdrop {
      position: fixed; inset: 0;
      background: rgba(10,24,40,.55);
      z-index: 8700; opacity: 0; pointer-events: none;
      backdrop-filter: blur(4px);
      transition: opacity .3s ease;
    }
    #cart-backdrop.open { opacity: 1; pointer-events: auto; }

    .cart-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 24px 28px;
      border-bottom: 1px solid var(--gray-200, #E5EAF0);
      flex-shrink: 0;
    }
    .cart-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 24px; font-weight: 700;
      color: var(--navy, #0A2540);
    }
    .cart-close {
      background: var(--gray-100, #F1F4F8); border: none; border-radius: 50%;
      width: 34px; height: 34px; cursor: pointer; font-size: 18px;
      display: flex; align-items: center; justify-content: center;
      color: var(--navy, #0A2540);
      transition: all .2s ease;
    }
    .cart-close:hover { background: var(--tech-blue, #1B5BFF); color: #fff; transform: rotate(90deg); }

    .cart-zone-banner {
      padding: 12px 28px;
      background: var(--tech-blue-soft, #EEF2FF);
      font-size: 12px;
      color: var(--navy, #0A2540);
      display: flex; align-items: center; gap: 8px;
      border-bottom: 1px solid var(--gray-200, #E5EAF0);
    }

    .cart-body {
      flex: 1; overflow-y: auto; padding: 16px 28px;
    }
    .cart-empty {
      text-align: center; padding: 48px 16px;
      color: var(--gray-500, #4A5568);
    }
    .cart-empty-ic {
      font-size: 48px; opacity: .3; margin-bottom: 12px;
    }
    .cart-empty-h {
      font-family: 'Cormorant Garamond', serif;
      font-size: 22px; color: var(--navy, #0A2540);
      margin-bottom: 6px;
    }
    .cart-empty-p { font-size: 13px; line-height: 1.6; }

    .cart-item {
      display: grid;
      grid-template-columns: 44px 1fr auto;
      gap: 14px; padding: 16px 0;
      border-bottom: 1px solid var(--gray-200, #E5EAF0);
      align-items: start;
    }
    .cart-item:last-child { border-bottom: none; }
    .ci-icon {
      width: 44px; height: 44px;
      background: var(--tech-blue-soft, #EEF2FF);
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px;
      flex-shrink: 0;
    }
    .ci-info { min-width: 0; }
    .ci-name {
      font-weight: 600; font-size: 14px; color: var(--navy, #0A2540);
      margin-bottom: 4px; line-height: 1.3;
    }
    .ci-zone {
      font-size: 10px; color: var(--gray-500, #4A5568);
      letter-spacing: .1em; text-transform: uppercase;
    }
    .ci-right {
      text-align: right;
    }
    .ci-price {
      font-family: 'Cormorant Garamond', serif;
      font-size: 20px; font-weight: 700; color: var(--navy, #0A2540);
      line-height: 1;
    }
    .ci-remove {
      background: none; border: none; cursor: pointer;
      color: var(--gray-500, #4A5568); font-size: 11px;
      margin-top: 8px; padding: 0;
      transition: color .2s ease;
    }
    .ci-remove:hover { color: #DC2626; text-decoration: underline; }

    .cart-footer {
      padding: 24px 28px;
      border-top: 1px solid var(--gray-200, #E5EAF0);
      background: var(--gray-50, #F8FAFC);
      flex-shrink: 0;
    }
    .cart-totals { margin-bottom: 16px; }
    .cart-line {
      display: flex; justify-content: space-between;
      font-size: 13px; color: var(--gray-500, #4A5568);
      margin-bottom: 6px;
    }
    .cart-line.total {
      font-size: 17px; font-weight: 700; color: var(--navy, #0A2540);
      padding-top: 12px;
      border-top: 1px solid var(--gray-200, #E5EAF0);
      margin-top: 12px;
    }
    .cart-line.total .amount {
      font-family: 'Cormorant Garamond', serif;
      font-size: 28px;
    }
    .cart-line.cart-note { display: block; font-size: 11.5px; line-height: 1.45; }
    .cart-checkout {
      width: 100%;
      background: var(--tech-blue, #1B5BFF);
      color: #fff; border: none;
      padding: 16px; border-radius: 8px;
      font-family: 'Outfit', sans-serif; font-size: 14px; font-weight: 700;
      letter-spacing: .04em; text-transform: uppercase;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(27,91,255,.35);
      transition: all .25s ease;
      display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    .cart-checkout:hover {
      background: var(--tech-blue-deep, #0E3FD8);
      transform: translateY(-2px);
      box-shadow: 0 12px 32px rgba(27,91,255,.45);
    }
    .cart-checkout:disabled {
      background: var(--gray-200, #E5EAF0); color: var(--gray-500, #4A5568);
      cursor: not-allowed; box-shadow: none; transform: none;
    }
    .cart-secure {
      text-align: center; font-size: 11px; color: var(--gray-500, #4A5568);
      margin-top: 12px;
    }

    /* "ADD TO CART" mini-button injected on service cards */
    .btn-cart {
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      background: #FFFFFF;
      color: var(--navy, #0A2540);
      border: 1.5px solid var(--gray-200, #E5EAF0);
      padding: 12px 18px; border-radius: 8px;
      font-family: 'Outfit', sans-serif; font-size: 12px; font-weight: 700;
      cursor: pointer; letter-spacing: .04em; text-transform: uppercase;
      transition: all .25s ease;
      white-space: nowrap;
    }
    .btn-cart .cart-ico {
      width: 22px; height: 22px;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 50%;
      background: var(--tech-blue-soft, #EEF2FF);
      box-shadow: inset 0 0 0 1px rgba(27,91,255,.14);
      font-size: 13px;
      line-height: 1;
      flex-shrink: 0;
    }
    .btn-cart:hover {
      border-color: var(--tech-blue, #1B5BFF);
      color: var(--tech-blue, #1B5BFF);
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(27,91,255,.18);
    }
    .btn-cart.added {
      background: #10B981; color: #fff; border-color: #10B981;
    }
    .btn-cart.added .cart-ico {
      background: rgba(255,255,255,.18);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.28);
    }
    .g-addon-card .btn-cart {
      width: 100%;
      min-height: 43px;
    }

    /* FLY-TO-CART animation */
    .fly-clone {
      position: fixed; z-index: 9500;
      pointer-events: none;
      background: var(--tech-blue, #1B5BFF); color: #fff;
      width: 40px; height: 40px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px;
      box-shadow: 0 8px 24px rgba(27,91,255,.5);
      transition: all .8s cubic-bezier(.5,-0.3,.8,.3);
    }

    /* Toast notification */
    #cart-toast {
      position: fixed; bottom: 30px; left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: var(--navy, #0A2540); color: #fff;
      padding: 14px 26px; border-radius: 10px;
      font-size: 14px; font-weight: 600;
      box-shadow: 0 12px 40px rgba(10,37,64,.25);
      z-index: 9100;
      transition: transform .4s cubic-bezier(.2,.8,.2,1);
      display: flex; align-items: center; gap: 10px;
    }
    #cart-toast.show { transform: translateX(-50%) translateY(0); }

    /* Responsive */
    @media (max-width: 768px) {
      #cart-fab {
        bottom: max(16px, env(safe-area-inset-bottom));
        right: max(16px, env(safe-area-inset-right));
      }
      #cart-drawer { max-width: 100%; }
    }
    @media (max-width: 520px) {
      .cart-header, .cart-zone-banner, .cart-body, .cart-footer {
        padding-left: 20px; padding-right: 20px;
      }
      #cart-toast {
        left: 16px; right: 16px;
        transform: translateX(0) translateY(120%);
        width: auto;
      }
      #cart-toast.show { transform: translateX(0) translateY(0); }
    }
  `;
  const s = document.createElement('style');
  s.id = 'cart-style';
  s.textContent = css;
  document.head.appendChild(s);
})();

/* ─── CART STATE ─── */
const CART = {
  items: [],
  resetMixedOnLoad: false,
  load(){
    try {
      const raw = localStorage.getItem('digitalnova-cart');
      this.items = (raw ? JSON.parse(raw) : []).map(item => ({ ...item, qty: 1 }));
      const zones = new Set(this.items.map(item => item.zone).filter(zone => zone === 'ca' || zone === 'eu'));
      if(zones.size > 1){
        this.items = [];
        this.resetMixedOnLoad = true;
        this.save();
      }
    } catch(e) { this.items = []; }
  },
  save(){
    localStorage.setItem('digitalnova-cart', JSON.stringify(this.items));
  },
  add(item){
    const currentZone = this.items[0]?.zone;
    if(currentZone && currentZone !== item.zone) return false;
    if(this.items.some(i => i.id === item.id && i.zone === item.zone)) return 'exists';
    this.items.push({ ...item, qty: 1 });
    this.save();
    return true;
  },
  remove(id, zone){
    this.items = this.items.filter(i => !(i.id === id && i.zone === zone));
    this.save();
  },
  total(){
    return this.items.reduce((s,i) => s + i.price, 0);
  },
  count(){
    return this.items.length;
  },
  clear(){
    this.items = []; this.save();
  }
};

/* ─── i18n helpers ─── */
const isEN = () => document.documentElement.lang === 'en';
const t = (fr, en) => isEN() ? en : fr;

function getCurrency(){
  // detect zone from active class
  const euActive = document.body.classList.contains('eu-active');
  return euActive ? { code: 'EUR', symbol: '€', position: 'after' }
                  : { code: 'CAD', symbol: '$', position: 'before' };
}
function fmt(price, cur){
  cur = cur || getCurrency();
  const n = new Intl.NumberFormat(isEN() ? 'en-CA' : 'fr-CA', {minimumFractionDigits:0, maximumFractionDigits:2}).format(price);
  return cur.position === 'before' ? `${cur.symbol}${n} ${cur.code}` : `${n} ${cur.symbol}`;
}

/* ─── Parse price from service card ─── */
function parsePrice(card){
  const priceEl = card.querySelector('.srv-price-main, .g-price-amount');
  if(!priceEl) return null;
  const txt = priceEl.textContent.replace(/\s/g, '');
  const match = txt.match(/[\d,.]+/);
  if(!match) return null;
  const num = parseFloat(match[0].replace(/[,.](?=\d{3}\b)/g, '').replace(',', '.'));
  return isFinite(num) ? num : null;
}

function priceUnit(card){
  // Read the language-independent value (data-*-currency) when the card has one.
  const dataCur = card.dataset[getCardZone(card) + 'Currency'];
  if(dataCur) return dataCur.replace('€', '').trim() || 'HT';
  const cur = card.querySelector('.amount-cur')?.textContent.trim();
  if(cur) return cur;
  const main = card.querySelector('.srv-price-main')?.textContent || '';
  const m = main.match(/(CAD|HT|TTC)(\s*\/\s*an)?/);
  return m ? m[0].replace(/\s+/g, '') : '';
}
function taxBasis(unit){ return String(unit || '').replace(/\/.*$/, '').trim(); }
// Same tax/period markers as the offer cards, in the active language, so a line
// always matches the price shown on its card. The stored unit stays French.
function unitLabel(unit){
  const u = String(unit || '');
  if(isEN() && u === 'HT/TTC') return 'excl./incl. VAT';
  return isEN() ? u.replace(/\bHT\b/, 'excl. VAT').replace(/\bTTC\b/, 'incl. VAT').replace('/an', '/year') : u;
}
function lineAmount(item){
  const cur = item.zone === 'eu' ? {code:'EUR',symbol:'€',position:'after'} : {code:'CAD',symbol:'$',position:'before'};
  const base = fmt(item.price, cur);
  if(item.zone === 'eu') return item.unit ? `${base} ${unitLabel(item.unit)}` : base;
  return item.unit && item.unit.includes('/') ? base + unitLabel(item.unit.replace('CAD', '')) : base;
}

function getCardZone(card){
  if(card.classList.contains('dyn-price-card')){
    return document.body.classList.contains('eu-active') ? 'eu' : 'ca';
  }
  return card.closest('.services-panel')?.id === 'panel-eu' ? 'eu' : 'ca';
}

function syncCartButton(card, cartBtn, idx){
  const price = parsePrice(card);
  if(price == null) return false;
  const nameEl = card.querySelector('.srv-name, .g-price-title');
  const name = nameEl ? nameEl.textContent.trim() : `Service ${idx+1}`;
  const iconEl = card.querySelector('.srv-icon-wrap, .g-price-icon');
  const icon = iconEl ? iconEl.textContent.trim() : '📦';
  const zone = getCardZone(card);
  const id = `${zone}-${name.replace(/\s+/g,'-').toLowerCase().slice(0,40)}`;
  cartBtn.dataset.id = id;
  cartBtn.dataset.name = name;
  cartBtn.dataset.icon = icon;
  cartBtn.dataset.price = price;
  cartBtn.dataset.zone = zone;
  cartBtn.dataset.unit = priceUnit(card);
  return true;
}

/* ─── Recommended two-service offers ─── */
window.addOfferPairToCart = function(pairId){
  const pair = document.querySelector(`[data-offer-pair="${pairId}"]`);
  const offerIds = pair?.dataset.offerIds?.split(',').map(id => id.trim()).filter(Boolean) || [];
  const zone = document.body.classList.contains('eu-active') ? 'eu' : 'ca';
  let added = 0;

  offerIds.forEach((offerId, idx) => {
    const card = document.querySelector(`[data-offer-id="${offerId}"]`);
    const price = card ? parsePrice(card) : null;
    const nameEl = card?.querySelector('.g-price-title');
    const iconEl = card?.querySelector('.g-addon-icon, .g-price-icon');
    if(!card || price == null || !nameEl) return;

    const name = nameEl.textContent.trim();
    const id = `${zone}-${name.replace(/\s+/g,'-').toLowerCase().slice(0,40)}`;
    if(CART.items.some(item => item.id === id && item.zone === zone)) return;

    const wasAdded = CART.add({
      id,
      name,
      icon: iconEl?.textContent.trim() || '📦',
      price,
      zone,
      unit: priceUnit(card)
    });
    if(wasAdded === true) added += 1;
  });

  renderCart();
  if(added){
    showToast(t(`✓ ${added} services ajoutés à votre sélection pour devis`, `✓ ${added} services added to your quote list`));
    openCart();
  } else if(CART.items.length && CART.items[0].zone !== zone) {
    showToast(t('Votre sélection contient déjà des services dans une autre devise. Videz-la avant de changer de région.','Your quote list already contains services in another currency. Empty it before changing region.'));
    openCart();
  } else {
    showToast(t('Ces services sont déjà dans votre sélection','These services are already in your quote list'));
  }
};

/* ─── Inject "Add to cart" button on every service card ─── */
function injectCartButtons(){
  // Legacy service cards, main packages and add-on pricing cards.
  document.querySelectorAll('.srv-card, .g-price-card, .g-addon-card').forEach((card, idx) => {
    const orderBtn = card.querySelector('.btn-order, .g-price-btn');
    if(!orderBtn) return;
    let cartBtn = card.querySelector('.btn-cart');
    if(cartBtn){
      if(card.classList.contains('g-addon-card')){
        orderBtn.style.marginRight = '0';
        orderBtn.style.marginBottom = '10px';
      }
      syncCartButton(card, cartBtn, idx);
      return;
    }
    cartBtn = document.createElement('button');
    cartBtn.type = 'button';
    cartBtn.className = 'btn-cart';
    cartBtn.innerHTML = `<span class="cart-ico" aria-hidden="true">📋</span><span>${t('Ajouter à ma sélection','Add to quote list')}</span>`;
    if(!syncCartButton(card, cartBtn, idx)) return;
    card.dataset.cartReady = '1';

    cartBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = cartBtn.dataset.id;
      const name = cartBtn.dataset.name;
      const icon = cartBtn.dataset.icon;
      const price = Number(cartBtn.dataset.price);
      const zone = cartBtn.dataset.zone;
      const unit = cartBtn.dataset.unit;
      const wasAdded = CART.add({ id, name, icon, price, zone, unit });
      if(wasAdded === 'exists'){
        showToast(t('Ce service est déjà dans votre sélection','This service is already in your quote list'));
        openCart();
        return;
      }
      if(!wasAdded){
        showToast(t('Une seule devise est autorisée par sélection. Videz la sélection avant de changer de région.','Only one currency is allowed per quote list. Empty the list before changing region.'));
        openCart();
        return;
      }
      renderCart();
      flyToCart(cartBtn);
      cartBtn.classList.add('added');
      cartBtn.innerHTML = `<span class="cart-ico" aria-hidden="true">✓</span><span>${t('Ajouté','Added')}</span>`;
      setTimeout(() => {
        cartBtn.classList.remove('added');
        cartBtn.innerHTML = `<span class="cart-ico" aria-hidden="true">📋</span><span>${t('Ajouter à ma sélection','Add to quote list')}</span>`;
      }, 1500);
      showToast(`✓ ${name} ${t('ajouté à votre sélection pour devis','added to your quote list')}`);
    });

    // Insert next to the order button
    orderBtn.parentNode.insertBefore(cartBtn, orderBtn.nextSibling);
    if(card.classList.contains('g-addon-card')){
      orderBtn.style.marginRight = '0';
      orderBtn.style.marginBottom = '10px';
    } else {
      orderBtn.style.marginRight = '8px';
    }
  });
}

/* ─── Fly to cart animation ─── */
function flyToCart(srcEl){
  const cartBtn = document.getElementById('cart-toggle');
  if(!cartBtn) return;
  const r1 = srcEl.getBoundingClientRect();
  const r2 = cartBtn.getBoundingClientRect();
  const clone = document.createElement('div');
  clone.className = 'fly-clone';
  clone.textContent = '🛒';
  clone.style.left = (r1.left + r1.width/2 - 20) + 'px';
  clone.style.top  = (r1.top  + r1.height/2 - 20) + 'px';
  document.body.appendChild(clone);
  requestAnimationFrame(() => {
    clone.style.left = (r2.left + r2.width/2 - 20) + 'px';
    clone.style.top  = (r2.top  + r2.height/2 - 20) + 'px';
    clone.style.transform = 'scale(.3) rotate(720deg)';
    clone.style.opacity = '0';
  });
  setTimeout(() => clone.remove(), 800);
}

/* ─── Toast ─── */
let toastTimer;
function showToast(msg){
  let toast = document.getElementById('cart-toast');
  if(!toast){
    toast = document.createElement('div');
    toast.id = 'cart-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

/* ─── Render cart drawer ─── */
function renderCart(){
  const count = CART.count();
  const badge = document.getElementById('cart-count');
  if(badge){
    badge.textContent = count;
    badge.classList.toggle('zero', count === 0);
  }
  const body = document.getElementById('cart-body');
  const footer = document.getElementById('cart-footer');
  if(!body) return;

  if(CART.items.length === 0){
    body.innerHTML = `
      <div class="cart-empty">
        <div class="cart-empty-ic">📋</div>
        <div class="cart-empty-h">${t('Votre sélection est vide','Your quote list is empty')}</div>
        <div class="cart-empty-p">${t('Ajoutez des services pour préparer une demande de devis','Add services to prepare a quote request')}</div>
      </div>`;
    footer.style.display = 'none';
    return;
  }
  footer.style.display = 'block';

  const cur = getCurrency();
  body.innerHTML = CART.items.map(i => `
    <div class="cart-item" data-id="${i.id}" data-zone="${i.zone}">
      <div class="ci-icon">${i.icon}</div>
      <div class="ci-info">
        <div class="ci-name">${i.name}</div>
        <div class="ci-zone">${i.zone === 'eu' ? '🇪🇺 ' + t('Zone Europe','Europe Zone') : '🇨🇦 ' + t('Zone Canada','Canada Zone')}</div>
      </div>
      <div class="ci-right">
        <div class="ci-price">${lineAmount(i)}</div>
        <button class="ci-remove" data-act="rm">${t('Retirer','Remove')}</button>
      </div>
    </div>`).join('');

  // One list = one region/currency. CART.add rejects cross-zone items.
  // The amount is only the sum of the displayed prices: taxes, one-time vs
  // annual billing and the final amount are set by the written quote.
  const zone = CART.items[0].zone;
  const total = CART.total();
  const bases = [...new Set(CART.items.map(i => taxBasis(i.unit)))];
  const periods = [...new Set(CART.items.map(i => String(i.unit || '').includes('/') ? 'an' : 'once'))];
  const rawBasis = zone === 'eu' ? (bases.length === 1 && bases[0] ? bases[0] : 'HT/TTC') : 'CAD';
  const basis = unitLabel(rawBasis);
  const totalLabel = zone === 'eu' ? `${fmt(total, {code:'EUR',symbol:'€',position:'after'})} ${basis}` : fmt(total, {code:'CAD',symbol:'$',position:'before'});
  const mixed = (zone === 'eu' && bases.length > 1) || periods.length > 1;
  const totalsHtml = `
    <div class="cart-totals">
      <div class="cart-line total">
        <span>${t('Montant indicatif','Indicative amount')}</span>
        <span class="amount">${totalLabel}</span>
      </div>
      <div class="cart-line"><span>${t('Taxes et montant final','Taxes and final amount')}</span><span>${t('Confirmés dans le devis','Confirmed in the quote')}</span></div>
      ${mixed ? `<div class="cart-line cart-note">${t('Simple addition des prix affichés, qui mélangent des montants HT/TTC ou uniques/annuels.','Simple sum of the displayed prices, which mix excl./incl. tax or one-time/annual amounts.')}</div>` : ''}
    </div>
    <button class="cart-checkout" id="cart-checkout">
      📋 ${t('Demander un devis','Request a quote')} →
    </button>
    <div class="cart-secure">${t('Cette sélection n’est pas une commande · Devis personnalisé · Paiement après validation du devis','This list is not an order · Personalized quote · Payment after quote approval')}</div>
  `;
  footer.innerHTML = totalsHtml;

  // Wire up remove buttons
  body.querySelectorAll('.cart-item').forEach(row => {
    const id = row.dataset.id, zone = row.dataset.zone;
    row.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        const item = CART.items.find(i => i.id === id && i.zone === zone);
        if(!item) return;
        if(act === 'rm')  CART.remove(id, zone);
        renderCart();
      });
    });
  });

  // Checkout
  const checkoutBtn = document.getElementById('cart-checkout');
  if(checkoutBtn){
    checkoutBtn.addEventListener('click', () => {
      // Open the quote request with the list of selected services.
      if(typeof window.openModal === 'function'){
        window.openModal(
          t('Ma sélection pour devis','My quote list') + ' — ' + CART.count() + ' ' + t('service(s)','service(s)'),
          total,
          total,
          zone,
          rawBasis,
          CART.items.map(i => ({ name: i.name, amount: lineAmount(i) }))
        );
      } else {
        alert(t('Montant indicatif : ','Indicative amount: ') + totalLabel);
      }
      closeCart();
    });
  }
}

/* ─── Labels of the nav button and drawer (follow the active language) ─── */
function renderCartChrome(){
  const toggle = document.getElementById('cart-toggle');
  if(toggle){
    toggle.title = t('Ma sélection pour devis','My quote list');
    toggle.setAttribute('aria-label', t('Ma sélection pour devis','My quote list'));
  }
  const drawer = document.getElementById('cart-drawer');
  if(!drawer) return;
  drawer.setAttribute('aria-label', t('Ma sélection pour devis','My quote list'));
  drawer.querySelector('.cart-title').textContent = '📋 ' + t('Ma sélection pour devis','My quote list');
  drawer.querySelector('.cart-close').setAttribute('aria-label', t('Fermer','Close'));
  drawer.querySelector('.cart-zone-banner').textContent = '📍 ' + t('Une seule devise par sélection','One currency per list') + ' · CAD 🇨🇦 · EUR 🇪🇺';
}

/* ─── Open/close drawer ─── */
function openCart(){
  document.getElementById('cart-drawer').classList.add('open');
  document.getElementById('cart-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeCart(){
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('cart-backdrop').classList.remove('open');
  document.body.style.overflow = '';
}

/* ─── Init ─── */
window.addEventListener('DOMContentLoaded', () => {
  CART.load();
  if(CART.resetMixedOnLoad){
    showToast(t('Une ancienne sélection mélangeait CAD et EUR : elle a été vidée pour éviter un montant incorrect.','A previous quote list mixed CAD and EUR, so it was cleared to prevent an incorrect amount.'));
  }

  // Cart button in nav
  const navRight = document.querySelector('.nav-right');
  if(navRight){
    const btn = document.createElement('button');
    btn.id = 'cart-toggle';
    btn.innerHTML = '📋<span id="cart-count" class="zero">0</span>';
    btn.addEventListener('click', openCart);
    navRight.insertBefore(btn, navRight.firstChild);
  }

  // Backdrop + drawer
  const backdrop = document.createElement('div');
  backdrop.id = 'cart-backdrop';
  backdrop.addEventListener('click', closeCart);
  document.body.appendChild(backdrop);

  const drawer = document.createElement('div');
  drawer.id = 'cart-drawer';
  drawer.innerHTML = `
    <div class="cart-header">
      <div class="cart-title"></div>
      <button class="cart-close">×</button>
    </div>
    <div class="cart-zone-banner"></div>
    <div class="cart-body" id="cart-body"></div>
    <div class="cart-footer" id="cart-footer"></div>
  `;
  document.body.appendChild(drawer);
  drawer.querySelector('.cart-close').addEventListener('click', closeCart);
  renderCartChrome();

  // ESC to close
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape') closeCart();
  });

  // Inject buttons on service cards (also re-inject after language toggle)
  setTimeout(injectCartButtons, 300);
  document.addEventListener('digitalnova:pricing-updated', injectCartButtons);
  const observer = new MutationObserver(() => injectCartButtons());
  observer.observe(document.body, {childList: true, subtree: true});

  // Re-render the list and its labels when the language changes
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.addEventListener('click', () => setTimeout(() => { renderCartChrome(); renderCart(); }, 200));
  });
  document.addEventListener('digitalnova:language-updated', () => { renderCartChrome(); renderCart(); });

  renderCart();
});
