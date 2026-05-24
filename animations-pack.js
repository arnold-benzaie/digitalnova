/* ═══════════════════════════════════════════════════════
   🌍 Global Visibility — Full Animation Pack
   Additive animations on every section / element
   ═══════════════════════════════════════════════════════ */

(function injectGlobalAnimStyles(){
  const css = `
    /* ─── REVEAL ANIMATIONS ─── */
    @keyframes fadeInUp { from{opacity:0;transform:translateY(40px)} to{opacity:1;transform:translateY(0)} }
    @keyframes fadeInDown { from{opacity:0;transform:translateY(-40px)} to{opacity:1;transform:translateY(0)} }
    @keyframes fadeInLeft { from{opacity:0;transform:translateX(-40px)} to{opacity:1;transform:translateX(0)} }
    @keyframes fadeInRight { from{opacity:0;transform:translateX(40px)} to{opacity:1;transform:translateX(0)} }
    @keyframes zoomIn { from{opacity:0;transform:scale(.85)} to{opacity:1;transform:scale(1)} }
    @keyframes flipIn { from{opacity:0;transform:perspective(800px) rotateY(-30deg) scale(.9)} to{opacity:1;transform:perspective(800px) rotateY(0) scale(1)} }
    @keyframes blurIn { from{opacity:0;filter:blur(12px)} to{opacity:1;filter:blur(0)} }

    .anim{opacity:0;will-change:transform,opacity;}
    .anim.in{animation-duration:.9s;animation-fill-mode:forwards;animation-timing-function:cubic-bezier(.2,.7,.2,1);}
    .anim-up.in{animation-name:fadeInUp;}
    .anim-down.in{animation-name:fadeInDown;}
    .anim-left.in{animation-name:fadeInLeft;}
    .anim-right.in{animation-name:fadeInRight;}
    .anim-zoom.in{animation-name:zoomIn;}
    .anim-flip.in{animation-name:flipIn;animation-duration:1.1s;}
    .anim-blur.in{animation-name:blurIn;}

    /* Stagger children */
    .stagger > *{opacity:0;transform:translateY(20px);transition:opacity .7s ease, transform .7s cubic-bezier(.2,.7,.2,1);}
    .stagger.in > *{opacity:1;transform:none;}
    .stagger.in > *:nth-child(1){transition-delay:.05s}
    .stagger.in > *:nth-child(2){transition-delay:.12s}
    .stagger.in > *:nth-child(3){transition-delay:.19s}
    .stagger.in > *:nth-child(4){transition-delay:.26s}
    .stagger.in > *:nth-child(5){transition-delay:.33s}
    .stagger.in > *:nth-child(6){transition-delay:.40s}
    .stagger.in > *:nth-child(7){transition-delay:.47s}
    .stagger.in > *:nth-child(8){transition-delay:.54s}
    .stagger.in > *:nth-child(n+9){transition-delay:.6s}

    /* ─── ATTENTION / IDLE ANIMATIONS ─── */
    @keyframes pulseGlow {
      0%,100% { box-shadow: 0 0 0 0 rgba(213,43,30,.5); }
      50%     { box-shadow: 0 0 0 14px rgba(213,43,30,0); }
    }
    .nav-cta, .btn-red, .g-btn-primary, .btn-order, .sf-submit, .m-submit {
      animation: pulseGlow 3.5s ease-in-out infinite;
    }
    body.eu-active .nav-cta, body.eu-active .btn-red {
      animation: pulseGlowEU 3.5s ease-in-out infinite;
    }
    @keyframes pulseGlowEU {
      0%,100% { box-shadow: 0 0 0 0 rgba(0,51,153,.5); }
      50%     { box-shadow: 0 0 0 14px rgba(0,51,153,0); }
    }

    @keyframes wiggle {
      0%,100% { transform: rotate(0); }
      25% { transform: rotate(-3deg); }
      75% { transform: rotate(3deg); }
    }
    .srv-badge, .g-pop-badge, .badge-hot, .badge-new, .badge-best {
      animation: wiggle 2.4s ease-in-out infinite;
      transform-origin: center;
    }

    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    .sec-h em, .hero-h1 em, .ghero-title em, .nav-brand span, .ft-brand-name {
      background: linear-gradient(90deg,
        currentColor 0%,
        currentColor 40%,
        rgba(255,215,0,.95) 50%,
        currentColor 60%,
        currentColor 100%);
      background-size: 200% auto;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: shimmer 4s linear infinite;
    }

    /* ─── BACKGROUND GRADIENT ANIMATION (excluded score-block — too distracting) ─── */
    @keyframes gradShift {
      0%,100% { background-position: 0% 50%; }
      50%     { background-position: 100% 50%; }
    }
    .ribbon, .nl-sec {
      background-size: 200% 200% !important;
      animation: gradShift 8s ease infinite;
    }

    /* ─── HOVER LIFT ON CARDS / BUTTONS (floating-card kept calm) ─── */
    .reg-row, .c-badge, .tchip, .s-chip, .kpi, .rib-item,
    .fc a, .foot-legal a, .nav-center a, .zone-tab, .lang-btn, .zone-btn {
      transition: transform .3s cubic-bezier(.2,.8,.2,1), color .3s ease, background .3s ease, border-color .3s ease, box-shadow .3s ease;
    }
    /* Floating card: very subtle hover — no scale, just light lift */
    .floating-card { transition: transform .35s ease, box-shadow .35s ease; }
    .floating-card:hover { transform: translateY(-3px); box-shadow: 0 12px 30px rgba(0,0,0,.18); }
    .reg-row:hover { transform: translateX(4px); }
    .c-badge:hover, .tchip:hover { transform: translateY(-3px) scale(1.06); }
    .kpi:hover { transform: translateY(-4px); }
    .rib-item:hover { transform: scale(1.1); color: #fff !important; }
    .fc a:hover, .foot-legal a:hover { transform: translateX(3px); }

    /* Animated underline on nav + footer links */
    .nav-center a, .fc a, .foot-legal a { position: relative; }
    .nav-center a::after, .fc a::after, .foot-legal a::after {
      content: ""; position: absolute; left: 0; bottom: -3px;
      width: 100%; height: 1px;
      background: var(--rouge);
      transform: scaleX(0); transform-origin: right;
      transition: transform .35s cubic-bezier(.2,.8,.2,1);
    }
    .nav-center a:hover::after, .fc a:hover::after, .foot-legal a:hover::after {
      transform: scaleX(1); transform-origin: left;
    }

    /* ─── INPUT FOCUS GLOW ─── */
    .m-inp:focus, .sf-inp:focus, .nl-inp:focus {
      border-color: var(--rouge) !important;
      box-shadow: 0 0 0 4px rgba(213,43,30,.15), 0 0 20px rgba(213,43,30,.2);
      transform: translateY(-1px);
    }

    /* ─── IMAGE / FLAG ZOOM ─── */
    .hero-pre img, .rib-item img, .ft-flags img, .reg-flag, .zt-flag, .szh-flag, .zone-btn img, .lang-btn img {
      transition: transform .35s ease, filter .35s ease;
    }
    .hero-pre img:hover, .rib-item img:hover, .ft-flags img:hover,
    .reg-flag:hover, .zt-flag:hover, .szh-flag:hover, .zone-btn img:hover {
      transform: scale(1.25) rotate(2deg);
      filter: drop-shadow(0 4px 10px rgba(0,0,0,.3));
    }

    /* ─── SECTION FADE EDGES ─── */
    .sec, .google-sec, .seo-sec, .reviews-sec, .cred-sec, .faq-sec, .pay-sec, .nl-sec {
      position: relative; overflow: visible;
    }

    /* Section title animated underline */
    .sec-h, .ghero-title, .g-feat-title, .nl-title {
      position: relative; display: inline-block;
    }
    .sec-h::after, .ghero-title::after {
      content: ""; position: absolute; left: 0; bottom: -10px;
      height: 3px; width: 0;
      background: linear-gradient(90deg, var(--rouge), var(--or2));
      border-radius: 3px;
      transition: width 1.2s cubic-bezier(.2,.8,.2,1) .3s;
    }
    .sec-h.in::after, .ghero-title.in::after { width: 80px; }

    /* ─── FAQ animated open ─── */
    .faq-it { transition: transform .3s ease, box-shadow .3s ease, border-color .3s ease; }
    .faq-it:hover { transform: translateX(4px); box-shadow: 0 8px 24px rgba(213,43,30,.08); }
    .faq-it.open { box-shadow: 0 12px 32px rgba(213,43,30,.12); border-color: rgba(213,43,30,.3); }

    /* ─── SCORE BAR FILL ANIM ─── */
    .bar-f { transition: width 1.4s cubic-bezier(.2,.8,.2,1); }

    /* ─── REVIEW STARS — calm, only on rev-card hover, score block kept still ─── */
    @keyframes starTwinkle {
      0%,100% { transform: scale(1); }
      50%     { transform: scale(1.08); filter: drop-shadow(0 0 4px rgba(245,166,35,.5)); }
    }
    .rev-stars { display: inline-block; }
    .rev-card:hover .rev-stars {
      animation: starTwinkle 1.6s ease-in-out infinite;
    }

    /* ─── KPI / number glow on reveal ─── */
    @keyframes numberGlow {
      0% { text-shadow: 0 0 0 transparent; }
      50% { text-shadow: 0 0 30px rgba(232,184,75,.6), 0 0 60px rgba(213,43,30,.3); }
      100% { text-shadow: 0 0 0 transparent; }
    }
    .kpi-n.counted { animation: numberGlow 1.4s ease-out; }

    /* ─── BACKGROUND PARTICLES (subtle dots floating) ─── */
    #bg-particles {
      position: fixed; inset: 0; pointer-events: none; z-index: 1;
      overflow: hidden;
    }
    #bg-particles span {
      position: absolute; bottom: -20px;
      width: 4px; height: 4px; border-radius: 50%;
      background: rgba(213,43,30,.4);
      animation: floatUp linear infinite;
      box-shadow: 0 0 6px rgba(232,184,75,.5);
    }
    @keyframes floatUp {
      0% { transform: translateY(0) translateX(0); opacity: 0; }
      10% { opacity: 1; }
      90% { opacity: .8; }
      100% { transform: translateY(-110vh) translateX(80px); opacity: 0; }
    }

    /* ─── MAGNETIC button effect ─── */
    .magnetic { transition: transform .25s cubic-bezier(.2,.8,.2,1); }

    /* ─── Loading bar shimmer on footer ─── */
    @keyframes footerLine {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    .foot-bot {
      position: relative;
    }
    .foot-bot::before {
      content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg, transparent, var(--rouge), var(--or2), var(--rouge), transparent);
      background-size: 200% auto;
      animation: footerLine 4s linear infinite;
    }

    /* ─── Smooth color cycle on certif rainbow ─── */
    @keyframes certPulse {
      0%,100% { transform: scale(1); }
      50%     { transform: scale(1.05); }
    }
    .cert-card:hover .cert-icon-wrap { animation: certPulse 1s ease-in-out infinite; }

    /* ─── Cursor sparkle reduced near buttons (visual hint) ─── */
    button, a, [onclick] { cursor: pointer; }

    /* ─── Smooth scroll for anchor links already on html ─── */

    @media (prefers-reduced-motion: reduce) {
      .anim, .stagger > * { opacity: 1 !important; transform: none !important; }
      *, *::before, *::after {
        animation-duration: .01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: .01ms !important;
      }
    }
  `;
  const s = document.createElement('style');
  s.id = 'anim-pack-style';
  s.textContent = css;
  document.head.appendChild(s);
})();

/* ─── INTERSECTION OBSERVER → reveal on scroll ─── */
(function reveal(){
  const init = () => {
    // Auto-tag elements with reveal classes by selector
    const map = [
      ['.sec-h, .ghero-title, .g-feat-title, .nl-title, .seo-explain h3', 'anim anim-up'],
      ['.sec-sub, .ghero-sub, .g-feat-sub, .nl-sub, .ft-desc', 'anim anim-up'],
      ['.srv-card, .g-price-card, .rev-card, .cert-card, .g-feat-card, .reg-row, .c-badge, .tchip, .kpi, .faq-it, .g-step', 'anim anim-zoom'],
      ['.cred-glass, .stripe-wrap, .review-card-3d, .seo-explain', 'anim anim-flip'],
      ['.score-block, .ribbon', 'anim anim-blur'],
      ['.hero-pre, .hero-h1, .hero-sub, .hero-btns, .hero-kpis', 'anim anim-up'],
      ['.srv-grid, .g-feat-grid, .g-price-grid, .rev-grid, .certs-grid, .faq-list, .cards-wrap, .seo-kw-cards, .g-steps, .foot-top', 'stagger']
    ];
    map.forEach(([sel, cls]) => {
      document.querySelectorAll(sel).forEach(el => {
        cls.split(' ').forEach(c => el.classList.add(c));
      });
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if(e.isIntersecting){
          e.target.classList.add('in');
          // Animate score bars
          if(e.target.classList.contains('score-block')){
            e.target.querySelectorAll('.bar-f').forEach(b => {
              const w = b.style.width || b.getAttribute('data-w');
              if(w){ b.style.width = '0'; setTimeout(()=>b.style.width = w, 50); }
            });
          }
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });

    document.querySelectorAll('.anim, .stagger').forEach(el => io.observe(el));
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ─── COUNTER ANIMATION on KPIs ─── */
(function counters(){
  const init = () => {
    const els = document.querySelectorAll('[data-count]');
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if(!e.isIntersecting) return;
        const el = e.target;
        const target = parseInt(el.dataset.count, 10);
        if(isNaN(target)) return;
        let cur = 0;
        const dur = 1600;
        const t0 = performance.now();
        const step = (t) => {
          const p = Math.min(1, (t - t0)/dur);
          const eased = 1 - Math.pow(1-p, 3);
          cur = Math.round(target * eased);
          el.textContent = cur;
          if(p < 1) requestAnimationFrame(step);
          else { el.textContent = target; el.classList.add('counted'); }
        };
        requestAnimationFrame(step);
        io.unobserve(el);
      });
    }, { threshold: 0.4 });
    els.forEach(el => io.observe(el));
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ─── MAGNETIC effect on key buttons ─── */
(function magnetic(){
  const SEL = '.btn-red, .nav-cta, .g-btn-primary, .btn-order, .sf-submit, .m-submit, .nl-btn';
  const init = () => {
    document.querySelectorAll(SEL).forEach(btn => {
      btn.classList.add('magnetic');
      btn.addEventListener('mousemove', e => {
        const r = btn.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width/2) * 0.25;
        const y = (e.clientY - r.top - r.height/2) * 0.25;
        btn.style.transform = `translate(${x}px, ${y}px)`;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = '';
      });
    });
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ─── BACKGROUND FLOATING PARTICLES ─── */
(function bgParticles(){
  const init = () => {
    const wrap = document.createElement('div');
    wrap.id = 'bg-particles';
    document.body.appendChild(wrap);
    const N = 22;
    for(let i=0;i<N;i++){
      const s = document.createElement('span');
      const dur = 14 + Math.random()*18;
      const delay = Math.random()*-dur;
      const left = Math.random()*100;
      const size = 2 + Math.random()*4;
      const isGold = Math.random() > 0.55;
      s.style.cssText = `left:${left}%;width:${size}px;height:${size}px;
        animation-duration:${dur}s;animation-delay:${delay}s;
        background:${isGold?'rgba(232,184,75,.55)':'rgba(213,43,30,.45)'};
        box-shadow:0 0 ${size*2}px ${isGold?'rgba(232,184,75,.6)':'rgba(213,43,30,.5)'};`;
      wrap.appendChild(s);
    }
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ─── TYPEWRITER on hero pre-title (one-shot) ─── */
(function typewriter(){
  const init = () => {
    const target = document.querySelector('.hero-pre');
    if(!target) return;
    const txt = target.innerText;
    // Only animate text node, not images
    const imgs = target.querySelectorAll('img');
    const lastImg = imgs[imgs.length-1];
    if(!lastImg) return;
    let textNode = null;
    target.childNodes.forEach(n => { if(n.nodeType === 3 && n.nodeValue.trim()) textNode = n; });
    if(!textNode) return;
    const full = textNode.nodeValue;
    textNode.nodeValue = '';
    let i = 0;
    const tick = () => {
      if(i <= full.length){
        textNode.nodeValue = full.slice(0, i);
        i++;
        setTimeout(tick, 30);
      }
    };
    setTimeout(tick, 1400);
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
