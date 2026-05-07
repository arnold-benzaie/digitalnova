/* ═══════════════════════════════════════════════════════
   DIGITALNOVA — Theme switcher (Dark/Light) + extra animations
   ═══════════════════════════════════════════════════════ */

(function injectThemeStyles(){
  const css = `
    /* ─── THEME VARIABLES ─── */
    :root {
      /* DARK theme is default (current site style) */
      --t-bg: #FAFAF8;
      --t-bg-deep: #080808;
      --t-text: #080808;
      --t-text-muted: #6B6B6B;
      --t-card: #FFFFFF;
      --t-card-border: #E2DDD8;
      --t-section-light: #F8FAFE;
      --t-section-white: #FFFFFF;
      --t-nav-bg: rgba(8,8,8,.97);
      --t-nav-text: rgba(255,255,255,.6);
      --t-nav-text-active: #FAFAF8;
      --t-footer-bg: #050505;
      --t-footer-text: rgba(255,255,255,.3);
      --t-shadow: rgba(0,0,0,.06);
      --t-shadow-strong: rgba(0,0,0,.25);
      --t-input-bg: #FAFAFA;
      --t-input-border: #E0E0E0;
    }

    /* LIGHT theme overrides (only changes the nav + footer + hero text contrast) */
    body.theme-light {
      --t-nav-bg: rgba(255,255,255,.96);
      --t-nav-text: rgba(20,20,20,.7);
      --t-nav-text-active: #080808;
      --t-footer-bg: #F4F1ED;
      --t-footer-text: rgba(20,20,20,.55);
    }

    /* TRUE DARK theme — flips white sections to dark */
    body.theme-dark {
      --t-bg: #0A0A0A;
      --t-bg-deep: #000000;
      --t-text: #F5F5F0;
      --t-text-muted: #B8B8B5;
      --t-card: #161616;
      --t-card-border: rgba(255,255,255,.08);
      --t-section-light: #0E0E10;
      --t-section-white: #121212;
      --t-shadow: rgba(0,0,0,.5);
      --t-shadow-strong: rgba(0,0,0,.7);
      --t-input-bg: #1A1A1A;
      --t-input-border: rgba(255,255,255,.1);
    }

    /* SMOOTH theme transition */
    body, body * {
      transition: background-color .5s ease, color .4s ease, border-color .4s ease, box-shadow .4s ease;
    }

    /* === DARK THEME APPLICATION (when body.theme-dark) === */
    body.theme-dark { background: var(--t-bg); color: var(--t-text); }
    body.theme-dark .zone-section,
    body.theme-dark .services-panel-inner,
    body.theme-dark .certs-sec,
    body.theme-dark .pay-sec,
    body.theme-dark .faq-sec,
    body.theme-dark .reviews-sec,
    body.theme-dark .cred-sec,
    body.theme-dark .seo-sec,
    body.theme-dark .google-sec,
    body.theme-dark .ghero,
    body.theme-dark .g-features,
    body.theme-dark .g-pricing,
    body.theme-dark .g-process,
    body.theme-dark .maps-sec,
    body.theme-dark .contact-block {
      background: var(--t-section-light) !important;
      color: var(--t-text);
    }
    body.theme-dark .srv-card,
    body.theme-dark .g-feat-card,
    body.theme-dark .g-price-card,
    body.theme-dark .rev-card,
    body.theme-dark .cert-card,
    body.theme-dark .cred-glass,
    body.theme-dark .stripe-wrap,
    body.theme-dark .map-feat,
    body.theme-dark .contact-card,
    body.theme-dark .faq-it,
    body.theme-dark .floating-card,
    body.theme-dark .reg-row,
    body.theme-dark .c-badge,
    body.theme-dark .review-card-3d {
      background: var(--t-card) !important;
      color: var(--t-text);
      border-color: var(--t-card-border) !important;
    }
    body.theme-dark .srv-name, body.theme-dark .g-feat-name, body.theme-dark .g-price-title,
    body.theme-dark .rev-name, body.theme-dark .cert-name, body.theme-dark .cred-head,
    body.theme-dark .map-feat-h, body.theme-dark .contact-h, body.theme-dark .faq-qt,
    body.theme-dark .ghero-title, body.theme-dark .g-feat-title, body.theme-dark .sw-title,
    body.theme-dark .reg-info h5, body.theme-dark .nl-title, body.theme-dark .szh-title,
    body.theme-dark .zt-name, body.theme-dark .sf-label, body.theme-dark .m-label {
      color: var(--t-text) !important;
    }
    body.theme-dark .srv-desc, body.theme-dark .g-feat-desc, body.theme-dark .g-price-desc,
    body.theme-dark .rev-text, body.theme-dark .cert-desc, body.theme-dark .map-feat-d,
    body.theme-dark .contact-d, body.theme-dark .ghero-sub, body.theme-dark .g-feat-sub,
    body.theme-dark .sec-sub, body.theme-dark .g-step-desc, body.theme-dark .reg-info p,
    body.theme-dark .addr-txt, body.theme-dark .zt-desc, body.theme-dark .fc-label {
      color: var(--t-text-muted) !important;
    }
    body.theme-dark .srv-top, body.theme-dark .srv-bottom { background: var(--t-card) !important; }
    body.theme-dark .srv-bottom { border-top-color: var(--t-card-border) !important; }
    body.theme-dark .m-inp, body.theme-dark .sf-inp, body.theme-dark .nl-inp,
    body.theme-dark .sf-stripe-el, body.theme-dark .m-stripe-el {
      background: var(--t-input-bg) !important;
      color: var(--t-text);
      border-color: var(--t-input-border) !important;
    }

    /* === LIGHT THEME APPLICATION (when body.theme-light) === */
    body.theme-light .hero-bg {
      background: linear-gradient(140deg,#F4F1ED 0%,#FFE8E5 45%,#FFF6E8 100%) !important;
    }
    body.theme-light .hero-h1, body.theme-light .hero-sub, body.theme-light .kpi-n,
    body.theme-light .kpi-l, body.theme-light .fc-label, body.theme-light .fc-val,
    body.theme-light .fc-sub, body.theme-light .hero-pre {
      color: #1A1A1A !important;
    }
    body.theme-light .hero-h1 .stroke {
      -webkit-text-stroke-color: rgba(20,20,20,.4) !important;
    }
    body.theme-light .hero-sub { color: rgba(20,20,20,.6) !important; }
    body.theme-light .kpi-l, body.theme-light .fc-label, body.theme-light .fc-sub {
      color: rgba(20,20,20,.5) !important;
    }
    body.theme-light .floating-card {
      background: rgba(255,255,255,.6) !important;
      border-color: rgba(20,20,20,.08) !important;
      backdrop-filter: blur(12px);
    }
    body.theme-light .hero-pre {
      background: rgba(213,43,30,.08) !important;
      border-color: rgba(213,43,30,.2) !important;
    }
    body.theme-light nav { background: var(--t-nav-bg) !important; }
    body.theme-light nav.scrolled { background: rgba(255,255,255,.97) !important; box-shadow: 0 1px 0 rgba(0,0,0,.06); }
    body.theme-light .nav-brand, body.theme-light .nav-brand span { color: #1A1A1A; }
    body.theme-light .nav-brand span { color: var(--rouge); }
    body.theme-light .nav-center a { color: var(--t-nav-text) !important; }
    body.theme-light .nav-center a:hover { color: var(--t-nav-text-active) !important; }
    body.theme-light .zone-toggle, body.theme-light #lang-toggle {
      background: rgba(20,20,20,.06) !important;
      border-color: rgba(20,20,20,.1) !important;
    }
    body.theme-light .zone-btn { color: rgba(20,20,20,.55) !important; }
    body.theme-light footer { background: var(--t-footer-bg) !important; }
    body.theme-light footer * { color: rgba(20,20,20,.55) !important; }
    body.theme-light .ft-brand-name { color: var(--rouge) !important; }
    body.theme-light .ft-brand-sub { color: rgba(20,20,20,.4) !important; }
    body.theme-light .fc h5 { color: rgba(20,20,20,.7) !important; }
    body.theme-light .fc a { color: rgba(20,20,20,.5) !important; }
    body.theme-light .fc a:hover { color: var(--rouge) !important; }
    body.theme-light .foot-bot { border-top-color: rgba(20,20,20,.08) !important; }
    body.theme-light #loader { background: #F4F1ED; }
    body.theme-light .ld-name { color: #1A1A1A; }
    body.theme-light .ld-sub { color: rgba(20,20,20,.4); }

    /* ─── THEME TOGGLE BUTTON ─── */
    #theme-toggle {
      background: rgba(255,255,255,.08);
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 50%;
      width: 38px; height: 38px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; margin-right: 8px;
      transition: all .3s cubic-bezier(.2,.8,.2,1);
      position: relative; overflow: hidden;
    }
    #theme-toggle:hover { transform: rotate(180deg) scale(1.1); }
    #theme-toggle .icon-sun, #theme-toggle .icon-moon {
      position: absolute; font-size: 16px;
      transition: transform .5s cubic-bezier(.4,0,.2,1), opacity .3s ease;
    }
    /* Default (auto) shows moon */
    #theme-toggle .icon-sun { transform: scale(0) rotate(180deg); opacity: 0; }
    #theme-toggle .icon-moon { transform: scale(1) rotate(0); opacity: 1; }
    body.theme-light #theme-toggle .icon-sun { transform: scale(1) rotate(0); opacity: 1; }
    body.theme-light #theme-toggle .icon-moon { transform: scale(0) rotate(-180deg); opacity: 0; }
    body.theme-light #theme-toggle {
      background: rgba(20,20,20,.08); border-color: rgba(20,20,20,.12);
    }

    /* ─── EXTRA ANIMATIONS (more coverage) ─── */
    @keyframes slideUpReveal { from{opacity:0;transform:translateY(60px) rotateX(15deg)} to{opacity:1;transform:translateY(0) rotateX(0)} }
    @keyframes scaleIn { from{opacity:0;transform:scale(.7) rotate(-3deg)} to{opacity:1;transform:scale(1) rotate(0)} }
    @keyframes textWave { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }

    /* Section transitions */
    section, .sec, .google-sec, .seo-sec, .reviews-sec, .cred-sec, .faq-sec,
    .pay-sec, .nl-sec, .maps-sec, .ribbon, .zone-section {
      position: relative;
    }

    /* Wave hover on sec-tag */
    .sec-tag {
      transition: transform .3s ease, box-shadow .3s ease;
    }
    .sec-tag:hover { transform: scale(1.08); box-shadow: 0 8px 24px rgba(213,43,30,.2); }

    /* Hover scale on icons */
    .srv-icon-wrap, .cert-icon-wrap, .map-feat-ic, .contact-ic, .g-price-icon, .rc-google-g {
      transition: transform .4s cubic-bezier(.2,.8,.2,1);
    }
    .srv-card:hover .srv-icon-wrap, .cert-card:hover .cert-icon-wrap,
    .map-feat:hover .map-feat-ic, .contact-card:hover .contact-ic,
    .g-price-card:hover .g-price-icon {
      transform: rotate(-8deg) scale(1.15);
    }

    /* Wiggle CTA after delay */
    @keyframes ctaWiggle {
      0%,90%,100% { transform: rotate(0); }
      92% { transform: rotate(3deg); }
      94% { transform: rotate(-3deg); }
      96% { transform: rotate(2deg); }
      98% { transform: rotate(-1deg); }
    }
    .nav-cta { animation: ctaWiggle 6s ease-in-out infinite, pulseGlow 3.5s ease-in-out infinite; }

    /* Avatar bounce on review hover */
    .rev-card .rev-av { transition: transform .4s cubic-bezier(.2,.8,.2,1); }
    .rev-card:hover .rev-av { transform: scale(1.15) rotate(-5deg); }

    /* Faq icon spin */
    .faq-it .faq-ic { transition: transform .4s cubic-bezier(.4,2,.4,1); }

    /* Score bar animated stripes */
    @keyframes barStripe {
      0% { background-position: 0 0; }
      100% { background-position: 30px 0; }
    }
    .bar-f {
      background-image: linear-gradient(45deg, rgba(255,255,255,.1) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.1) 50%, rgba(255,255,255,.1) 75%, transparent 75%);
      background-size: 30px 30px;
      animation: barStripe 1.5s linear infinite;
    }

    /* Number ticker pulse */
    .kpi-n { transition: transform .3s ease; }
    .kpi:hover .kpi-n { transform: scale(1.1); color: var(--rouge); }

    /* Tilt and brighten on flag hover */
    img[src*="flagcdn"] { transition: transform .35s cubic-bezier(.2,.8,.2,1), filter .35s ease; }
    img[src*="flagcdn"]:hover { transform: scale(1.4) rotate(5deg); filter: brightness(1.15) drop-shadow(0 4px 12px rgba(0,0,0,.3)); }

    /* Footer columns slide on hover */
    .fc { transition: transform .35s ease; }
    .fc:hover { transform: translateY(-4px); }

    /* Newsletter input glow on focus */
    .nl-inp:focus { box-shadow: 0 0 0 4px rgba(255,255,255,.3); }

    /* Animated section title gradient on hover */
    .sec-h em {
      transition: filter .3s ease;
    }
    .sec-h:hover em {
      filter: brightness(1.2) saturate(1.3);
    }

    /* Mouse trail */
    .mouse-trail {
      position: fixed;
      width: 8px; height: 8px; border-radius: 50%;
      pointer-events: none; z-index: 9498;
      background: radial-gradient(circle, rgba(213,43,30,.7), rgba(232,184,75,.4) 70%, transparent);
      box-shadow: 0 0 12px rgba(213,43,30,.6);
      transform: translate(-50%,-50%);
      transition: opacity .8s ease;
    }
    body.theme-light .mouse-trail {
      background: radial-gradient(circle, rgba(213,43,30,.4), rgba(232,184,75,.25) 70%, transparent);
    }

    /* Theme switch flash effect */
    @keyframes themeFlash {
      0% { opacity: 0; transform: scale(0); }
      30% { opacity: 1; transform: scale(1.5); }
      100% { opacity: 0; transform: scale(3); }
    }
    .theme-flash {
      position: fixed; pointer-events: none; z-index: 9999;
      width: 60px; height: 60px; border-radius: 50%;
      background: radial-gradient(circle, rgba(232,184,75,.8), transparent 70%);
      animation: themeFlash .8s ease-out forwards;
    }
  `;
  const s = document.createElement('style');
  s.id = 'theme-extra-style';
  s.textContent = css;
  document.head.appendChild(s);
})();

/* ─── THEME SWITCHER ─── */
(function themeSwitcher(){
  function setTheme(theme){
    document.body.classList.remove('theme-dark','theme-light');
    if(theme === 'dark') document.body.classList.add('theme-dark');
    else if(theme === 'light') document.body.classList.add('theme-light');
    localStorage.setItem('digitalnova-theme', theme);

    // Flash effect at toggle button
    const btn = document.getElementById('theme-toggle');
    if(btn){
      const r = btn.getBoundingClientRect();
      const flash = document.createElement('div');
      flash.className = 'theme-flash';
      flash.style.cssText = `left:${r.left + r.width/2 - 30}px;top:${r.top + r.height/2 - 30}px;`;
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 800);
    }
  }

  function nextTheme(current){
    if(current === 'auto' || !current) return 'dark';
    if(current === 'dark') return 'light';
    return 'auto';
  }

  function applyAuto(){
    document.body.classList.remove('theme-dark','theme-light');
  }

  window.addEventListener('DOMContentLoaded', () => {
    const navRight = document.querySelector('.nav-right');
    if(!navRight) return;
    const btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.title = 'Changer de thème';
    btn.setAttribute('aria-label','Toggle theme');
    btn.innerHTML = '<span class="icon-moon">🌙</span><span class="icon-sun">☀️</span>';
    navRight.insertBefore(btn, navRight.firstChild);

    btn.addEventListener('click', () => {
      const current = localStorage.getItem('digitalnova-theme') || 'auto';
      const next = nextTheme(current);
      if(next === 'auto') applyAuto();
      else setTheme(next);
      localStorage.setItem('digitalnova-theme', next);
    });

    // Restore saved theme
    const saved = localStorage.getItem('digitalnova-theme');
    if(saved === 'dark' || saved === 'light') setTheme(saved);
  });
})();

/* ─── MOUSE TRAIL (subtle) ─── */
(function mouseTrail(){
  const dots = [];
  const N = 12;
  for(let i=0;i<N;i++){
    const d = document.createElement('div');
    d.className = 'mouse-trail';
    d.style.opacity = (1 - i/N).toString();
    d.style.transform = `translate(-50%,-50%) scale(${1 - i/N*0.7})`;
    document.body.appendChild(d);
    dots.push({el:d, x:0, y:0});
  }
  let mx = 0, my = 0;
  document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; }, {passive:true});
  function tick(){
    let px = mx, py = my;
    dots.forEach((d, i) => {
      d.x += (px - d.x) * 0.35;
      d.y += (py - d.y) * 0.35;
      d.el.style.left = d.x + 'px';
      d.el.style.top  = d.y + 'px';
      px = d.x; py = d.y;
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
