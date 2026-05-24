/* ═══════════════════════════════════════════════════════
   DIGITALNOVA — Premium Certifications Animation System (JS)
   - Tag the right DOM elements with helper classes
   - IntersectionObserver scroll reveal (staggered)
   - 3D tilt on main badges (mouse-follow parallax)
   - Sparkle particles burst on hover
   - Reduced-motion respected
   ═══════════════════════════════════════════════════════ */

(function premiumCerts(){
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function init(){
    const section = document.getElementById('certifications');
    if(!section) return;

    /* ─── 1. Tag elements with helper classes ─── */
    // Main badges grid
    const badgesGrid = section.querySelector('.cert-badges-grid');
    if(badgesGrid){
      badgesGrid.querySelectorAll(':scope > div').forEach((cell, i) => {
        cell.classList.add('cert-reveal');
        cell.style.transitionDelay = (i * 0.15) + 's';
      });
    }

    // Accreditations card (large pill-bar)
    const accredCard = section.querySelector('.cert-accred-bar') ||
                       section.querySelector('[style*="background:#F8FAFE"][style*="border-radius:18px"]');
    if(accredCard){
      accredCard.classList.add('cert-accred-card');
      // The flex row that contains the small chips
      const chipRow = accredCard.querySelector('div[style*="display:flex"][style*="flex-wrap"]');
      if(chipRow){
        chipRow.classList.add('cert-section-chip-grid');
        chipRow.querySelectorAll(':scope > div').forEach((chip, i) => {
          chip.classList.add('cert-reveal');
          chip.style.transitionDelay = (0.3 + i * 0.06) + 's';
        });
      }
    }

    // Title + intro paragraph cinematic reveal
    const title = section.querySelector('.sec-h, h2');
    if(title){
      // wrap em-tags in shine class
      title.classList.add('cert-reveal');
      const em = title.querySelector('em');
      if(em) em.classList.add('cert-title-reveal');
    }
    section.querySelectorAll('.sec-sub, .sec-tag').forEach((el, i) => {
      el.classList.add('cert-reveal');
      el.style.transitionDelay = (0.1 + i * 0.1) + 's';
    });

    /* ─── 2. Scroll-reveal observer ─── */
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if(e.isIntersecting){
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -80px 0px' });
    section.querySelectorAll('.cert-reveal').forEach(el => io.observe(el));

    /* ─── 3. 3D tilt on main badges ─── */
    if(!reducedMotion && badgesGrid){
      badgesGrid.querySelectorAll(':scope > div').forEach(cell => {
        const inner = cell.querySelector(':scope > div');
        if(!inner) return;
        inner.style.transformStyle = 'preserve-3d';

        let rect, raf;
        const onMove = (e) => {
          if(!rect) rect = cell.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = (e.clientY - rect.top) / rect.height;
          const rx = (0.5 - y) * 14;
          const ry = (x - 0.5) * 14;
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            inner.style.transform =
              `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(28px) scale(1.04)`;
          });
        };
        const onEnter = () => { rect = cell.getBoundingClientRect(); };
        const onLeave = () => {
          cancelAnimationFrame(raf);
          inner.style.transition = 'transform .8s cubic-bezier(.2,.8,.2,1)';
          inner.style.transform = '';
          setTimeout(() => { inner.style.transition = ''; }, 800);
          rect = null;
        };
        cell.addEventListener('mouseenter', onEnter);
        cell.addEventListener('mousemove', onMove);
        cell.addEventListener('mouseleave', onLeave);
      });
    }

    /* ─── 4. Sparkle particles on hover ─── */
    if(!reducedMotion && badgesGrid){
      badgesGrid.querySelectorAll(':scope > div').forEach((cell, idx) => {
        const colors = [
          ['rgba(217,50,47,1)', 'rgba(255,150,80,.6)'],     // red badge
          ['rgba(27,91,255,1)', 'rgba(120,180,255,.6)'],    // blue badge
          ['rgba(46,157,176,1)','rgba(120,220,230,.6)']     // teal badge
        ][idx] || ['rgba(255,215,100,1)', 'rgba(255,180,80,.6)'];

        const partsWrap = document.createElement('div');
        partsWrap.className = 'cert-particles';
        cell.appendChild(partsWrap);

        let sparking = null;
        function spark(){
          const N = 6;
          for(let i = 0; i < N; i++){
            const s = document.createElement('span');
            s.className = 'spark';
            const angle = (Math.random() * Math.PI * 2);
            const dist = 60 + Math.random() * 80;
            const size = 3 + Math.random() * 4;
            s.style.cssText = `
              width:${size}px;height:${size}px;
              left:50%;top:50%;
              background:radial-gradient(circle,${colors[0]},${colors[1]} 60%,transparent);
              filter:drop-shadow(0 0 8px ${colors[0]});
              transition:transform 900ms cubic-bezier(.2,.7,.3,1), opacity 900ms ease-out;
              transform:translate(-50%,-50%) scale(.3);
              opacity:1;
            `;
            partsWrap.appendChild(s);
            requestAnimationFrame(() => {
              s.style.transform = `translate(calc(-50% + ${Math.cos(angle)*dist}px), calc(-50% + ${Math.sin(angle)*dist}px)) scale(1) rotate(${Math.random()*360}deg)`;
              s.style.opacity = '0';
            });
            setTimeout(() => s.remove(), 950);
          }
        }
        cell.addEventListener('mouseenter', () => {
          if(sparking) clearInterval(sparking);
          spark();
          sparking = setInterval(spark, 700);
        });
        cell.addEventListener('mouseleave', () => {
          if(sparking){ clearInterval(sparking); sparking = null; }
        });
      });
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
