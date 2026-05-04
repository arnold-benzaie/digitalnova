/* ═══════════════════════════════════════════════════════
   DIGITALNOVA — Ultra-realistic 3D animations
   ═══════════════════════════════════════════════════════ */

(function inject3DStyles(){
  const css = `
    /* Global perspective for 3D children */
    body { perspective: 1400px; perspective-origin: 50% 30%; }

    /* 3D tilt cards */
    .tilt-3d {
      transform-style: preserve-3d;
      transition: transform .25s cubic-bezier(.2,.8,.2,1), box-shadow .3s ease;
      will-change: transform;
      position: relative;
    }
    .tilt-3d::after{
      content:"";
      position:absolute;inset:0;border-radius:inherit;pointer-events:none;
      background:radial-gradient(circle at var(--mx,50%) var(--my,50%),
        rgba(255,255,255,.18) 0%, rgba(255,255,255,0) 45%);
      opacity:0;transition:opacity .3s ease;
      mix-blend-mode:screen;
    }
    .tilt-3d:hover::after{opacity:1;}
    .tilt-3d > *{ transform: translateZ(40px); transition:transform .25s ease; }

    /* 3D depth shadow */
    .depth-3d {
      transition: transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .35s ease;
      transform-style: preserve-3d;
    }
    .depth-3d:hover {
      transform: translateY(-8px) translateZ(20px) rotateX(2deg);
      box-shadow: 0 30px 60px -12px rgba(0,0,0,.35), 0 18px 36px -18px rgba(213,43,30,.4);
    }

    /* Add depth to existing floating cards — keep original float1/float2/float3 animations */
    .floating-card { transform-style: preserve-3d; }

    /* 3D rotating brand logo on hover */
    .nav-brand {
      display: inline-block;
      transform-style: preserve-3d;
      transition: transform .8s cubic-bezier(.2,.8,.2,1);
    }
    .nav-brand:hover {
      transform: rotateY(360deg) scale(1.05);
    }

    /* 3D button press — additive, doesn't override original :hover transitions */
    .btn-red, .btn-order, .nav-cta, .g-btn-primary, .sf-submit, .m-submit {
      transform-style: preserve-3d;
    }
    .btn-red:active, .btn-order:active, .nav-cta:active, .g-btn-primary:active {
      transform: translateY(0) translateZ(0) rotateX(2deg) scale(.98);
    }

    /* Parallax scroll layers */
    .parallax-layer {
      transition: transform .15s linear;
      will-change: transform;
    }

    /* 3D star burst at click */
    .burst-3d {
      position: fixed; pointer-events: none; z-index: 9499;
      width: 0; height: 0;
    }
    .burst-3d span {
      position: absolute; top:0; left:0;
      width: 14px; height: 14px;
      background: radial-gradient(circle at 30% 30%, #FFE066, #D52B1E 60%, transparent 70%);
      border-radius: 50%;
      transform-origin: center;
      filter: drop-shadow(0 0 8px rgba(232,184,75,.7));
    }

    /* Card glow pulse 3D */
    @keyframes glow3d {
      0%,100% { box-shadow: 0 10px 30px rgba(213,43,30,.15), 0 0 0 rgba(232,184,75,0); }
      50%     { box-shadow: 0 20px 50px rgba(213,43,30,.35), 0 0 40px rgba(232,184,75,.2); }
    }
    .srv-card, .g-price-card, .rev-card, .cred-glass, .stripe-wrap {
      transform-style: preserve-3d;
      transition: transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .35s ease, border-color .3s ease;
    }
    .srv-card:hover, .g-price-card:hover, .rev-card:hover, .cred-glass:hover {
      transform: translateY(-10px) rotateX(3deg) scale(1.02);
      box-shadow: 0 35px 70px -20px rgba(0,0,0,.4), 0 0 30px rgba(213,43,30,.2);
    }

    /* Hero h1 — 3D extruded look */
    .hero-h1 {
      transform-style: preserve-3d;
      text-shadow:
        0 1px 0 rgba(255,255,255,.05),
        0 2px 0 rgba(0,0,0,.4),
        0 4px 0 rgba(0,0,0,.3),
        0 8px 18px rgba(213,43,30,.25),
        0 18px 40px rgba(0,0,0,.5);
      transition: transform .5s ease;
    }

    /* Smooth 3D scroll reveal */
    .rv, .rv-l, .rv-r {
      transform-style: preserve-3d;
    }
    .rv:not(.on)   { transform: translateY(60px) translateZ(-100px) rotateX(15deg); }
    .rv-l:not(.on) { transform: translateX(-60px) translateZ(-80px) rotateY(-15deg); }
    .rv-r:not(.on) { transform: translateX(60px)  translateZ(-80px) rotateY(15deg);  }

    /* Reduced motion respect */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important; }
    }
  `;
  const s = document.createElement('style');
  s.id = 'effects3d-style';
  s.textContent = css;
  document.head.appendChild(s);
})();

/* ─── TILT 3D ON CARDS — excludes .floating-card to preserve original float anim ─── */
(function tilt3D(){
  const SELECTOR = '.srv-card, .g-price-card, .rev-card, .cred-glass, .stripe-wrap, .review-card-3d, .g-feat-card, .cert-card';
  const MAX_TILT = 12;

  function attach(el){
    if(el.dataset.tilt3d) return;
    el.dataset.tilt3d = '1';
    el.classList.add('tilt-3d');

    let rect, raf;
    const update = (e) => {
      if(!rect) rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const rx = (0.5 - y) * MAX_TILT * 2;
      const ry = (x - 0.5) * MAX_TILT * 2;
      el.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(20px) scale(1.03)`;
      el.style.setProperty('--mx', (x*100)+'%');
      el.style.setProperty('--my', (y*100)+'%');
    };

    el.addEventListener('mouseenter', () => { rect = el.getBoundingClientRect(); });
    el.addEventListener('mousemove', (e) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => update(e));
    });
    el.addEventListener('mouseleave', () => {
      cancelAnimationFrame(raf);
      el.style.transform = '';
      rect = null;
    });
  }

  function init(){
    document.querySelectorAll(SELECTOR).forEach(attach);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Re-attach for dynamically added content
  new MutationObserver(init).observe(document.body, {childList:true, subtree:true});
})();

/* ─── PARALLAX SCROLL — only on hero bg layers, only while hero visible ─── */
(function parallax(){
  const layers = [];
  const init = () => {
    document.querySelectorAll('.hero-glow, .hero-map').forEach((el) => {
      const speed = el.classList.contains('hero-glow') ? -0.25 : -0.12;
      layers.push({el, speed});
      el.classList.add('parallax-layer');
    });
  };

  let ticking = false;
  window.addEventListener('scroll', () => {
    if(ticking) return;
    const hero = document.querySelector('.hero');
    if(!hero) return;
    const heroBottom = hero.offsetTop + hero.offsetHeight;
    if(window.scrollY > heroBottom) return; // stop once scrolled past hero
    ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY;
      layers.forEach(({el, speed}) => {
        el.style.transform = `translate3d(0, ${y * speed}px, 0)`;
      });
      ticking = false;
    });
  }, {passive:true});

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ─── 3D STAR-BURST ON CLICK (8 directions) ─── */
(function burst3D(){
  document.addEventListener('click', e => {
    if(e.target.closest('button, a, .lang-btn, .zone-btn, input')) {
      const burst = document.createElement('div');
      burst.className = 'burst-3d';
      burst.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;`;
      const N = 12;
      for(let i=0;i<N;i++){
        const span = document.createElement('span');
        const angle = (i/N) * Math.PI * 2;
        const dist = 60 + Math.random()*40;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        const dz = (Math.random()-0.5) * 100;
        span.style.transform = 'translate3d(-50%,-50%,0) scale(1)';
        span.style.transition = 'transform 700ms cubic-bezier(.2,.7,.3,1), opacity 700ms ease-out';
        burst.appendChild(span);
        requestAnimationFrame(() => {
          span.style.transform = `translate3d(${dx-7}px, ${dy-7}px, ${dz}px) scale(0) rotate(${360*Math.random()}deg)`;
          span.style.opacity = '0';
        });
      }
      document.body.appendChild(burst);
      setTimeout(() => burst.remove(), 750);
    }
  }, true);
})();

/* ─── HERO H1 — mouse-follow 3D rotation ─── */
(function heroParallax(){
  const init = () => {
    const h1 = document.querySelector('.hero-h1');
    if(!h1) return;
    const hero = document.querySelector('.hero');
    if(!hero) return;
    hero.addEventListener('mousemove', e => {
      const r = hero.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      h1.style.transform = `perspective(1200px) rotateY(${x*8}deg) rotateX(${-y*6}deg) translateZ(20px)`;
    });
    hero.addEventListener('mouseleave', () => {
      h1.style.transform = '';
    });
  };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
