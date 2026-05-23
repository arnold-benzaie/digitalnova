/* ═══════════════════════════════════════════════════════
   DIGITALNOVA — Hero cinematic immersion layer
   Seamless loop · Matrix code · World connections · Ambient particles
   Apple/Tesla-tier feel
   ═══════════════════════════════════════════════════════ */

(function injectCinematicStyles(){
  const css = `
    /* ─── SEAMLESS LOOP via crossfading dual video ─── */
    .hero-video-stack { position: absolute; inset: 0; z-index: 1; overflow: hidden; }
    .hero-video-stack video {
      position: absolute; inset: 0; width: 100%; height: 100%;
      object-fit: cover;
      transform: scale(1.08);
      transform-origin: center center;
      filter: saturate(1.18) contrast(1.10) brightness(.88);
      will-change: opacity, transform;
      transition: opacity 1.4s ease-in-out;
    }
    .hero-video-stack video.fading-out { opacity: 0; }
    .hero-video-stack video.fading-in { opacity: .82; }

    /* Camera dolly — slow drift + zoom (gives 30s perceived cycle on a 10s video) */
    @keyframes camDolly {
      0%   { transform: scale(1.06) translate(0,0); }
      25%  { transform: scale(1.09) translate(-1.2%,.6%); }
      50%  { transform: scale(1.12) translate(.8%,-.8%); }
      75%  { transform: scale(1.08) translate(-.6%,1%); }
      100% { transform: scale(1.06) translate(0,0); }
    }
    .hero-video-stack video.cam-anim {
      animation: camDolly 30s ease-in-out infinite;
    }

    /* ─── MATRIX RAIN CODE OVERLAY ─── */
    .hero-matrix {
      position: absolute; inset: 0; z-index: 4;
      pointer-events: none; overflow: hidden;
      opacity: .22;
      mix-blend-mode: screen;
      mask-image: radial-gradient(ellipse at 80% 20%, black 0%, transparent 60%);
      -webkit-mask-image: radial-gradient(ellipse at 80% 20%, black 0%, transparent 60%);
    }
    .matrix-col {
      position: absolute; top: -10%;
      font-family: 'Courier New', monospace;
      font-size: 14px; line-height: 1.4;
      color: rgba(255,180,80,.9);
      text-shadow: 0 0 8px rgba(232,140,75,.7);
      writing-mode: vertical-rl;
      animation: matrixRain linear infinite;
      white-space: nowrap;
    }
    @keyframes matrixRain {
      0% { transform: translateY(-100%); opacity: 0; }
      8% { opacity: 1; }
      92% { opacity: 1; }
      100% { transform: translateY(120vh); opacity: 0; }
    }

    /* ─── WORLD CONNECTIONS SVG (Montréal·Paris·Londres·Bruxelles) ─── */
    .hero-network {
      position: absolute; inset: 0; z-index: 4;
      pointer-events: none;
      opacity: .55;
      mix-blend-mode: screen;
    }
    .hero-network svg { width: 100%; height: 100%; }
    .net-dot {
      fill: #FFD580;
      filter: drop-shadow(0 0 6px rgba(255,200,100,.9));
      animation: dotPulse 3s ease-in-out infinite;
    }
    @keyframes dotPulse {
      0%,100% { r: 4; opacity: .9; }
      50% { r: 6; opacity: 1; }
    }
    .net-line {
      fill: none;
      stroke: url(#netGrad);
      stroke-width: 1.2;
      stroke-dasharray: 6 8;
      animation: lineDash 4s linear infinite;
    }
    @keyframes lineDash {
      to { stroke-dashoffset: -56; }
    }
    .net-pulse {
      fill: #FFE066;
      filter: drop-shadow(0 0 10px rgba(255,220,120,1));
      animation: pulseTravel 6s linear infinite;
      r: 3;
    }
    .net-label {
      font: 600 10px 'Outfit', sans-serif;
      fill: rgba(255,220,180,.85);
      letter-spacing: .15em;
      text-transform: uppercase;
      text-shadow: 0 0 6px rgba(0,0,0,.8);
      filter: drop-shadow(0 0 4px rgba(0,0,0,.9));
    }

    /* ─── AMBIENT LIGHT PARTICLES (dust/specks floating) ─── */
    .hero-dust {
      position: absolute; inset: 0; z-index: 4;
      pointer-events: none; overflow: hidden;
      mix-blend-mode: screen;
    }
    .dust-mote {
      position: absolute;
      width: 3px; height: 3px; border-radius: 50%;
      background: radial-gradient(circle, rgba(255,210,150,.9), rgba(255,180,100,.3) 50%, transparent);
      box-shadow: 0 0 6px rgba(255,200,140,.6);
      animation: dustDrift linear infinite;
    }
    @keyframes dustDrift {
      0%   { transform: translate(0,100vh) scale(.5); opacity: 0; }
      10%  { opacity: .8; }
      90%  { opacity: .6; }
      100% { transform: translate(40px,-10vh) scale(1.2); opacity: 0; }
    }

    /* ─── COFFEE STEAM / VAPOR (subtle ribbons) ─── */
    .hero-steam {
      position: absolute; bottom: 0; left: 30%; width: 200px; height: 300px;
      z-index: 4; pointer-events: none;
      opacity: .25; mix-blend-mode: screen;
    }
    .steam-wisp {
      position: absolute; bottom: 0; left: 50%;
      width: 14px; height: 120px;
      background: linear-gradient(180deg, transparent, rgba(255,220,180,.7) 60%, transparent);
      filter: blur(6px);
      transform-origin: 50% 100%;
      animation: steamRise 7s ease-in-out infinite;
    }
    @keyframes steamRise {
      0%   { transform: translateX(0) translateY(0) scale(.6,1) rotate(0deg); opacity: 0; }
      20%  { opacity: .9; }
      60%  { transform: translateX(20px) translateY(-80px) scale(1.4,1.3) rotate(8deg); opacity: .6; }
      100% { transform: translateX(40px) translateY(-160px) scale(2.2,1.5) rotate(-4deg); opacity: 0; }
    }

    /* ─── LIGHT SCAN — horizontal light bar drift ─── */
    .hero-scan {
      position: absolute; inset: 0; z-index: 4;
      pointer-events: none; overflow: hidden;
      mix-blend-mode: screen;
    }
    .scan-bar {
      position: absolute; left: -20%; top: 30%;
      width: 140%; height: 80px;
      background: linear-gradient(90deg,
        transparent,
        rgba(255,180,80,.18) 40%,
        rgba(255,220,120,.28) 50%,
        rgba(255,180,80,.18) 60%,
        transparent);
      filter: blur(20px);
      animation: scanSweep 14s linear infinite;
      transform: rotate(-2deg);
    }
    @keyframes scanSweep {
      0%   { transform: translateX(-30%) rotate(-2deg); opacity: 0; }
      10%  { opacity: 1; }
      90%  { opacity: 1; }
      100% { transform: translateX(60%) rotate(-2deg); opacity: 0; }
    }

    /* ─── LENS FLARE — corner spark ─── */
    .hero-flare {
      position: absolute; top: 12%; right: 18%;
      width: 320px; height: 320px;
      z-index: 4; pointer-events: none;
      background: radial-gradient(circle,
        rgba(255,230,180,.4) 0%,
        rgba(255,160,80,.15) 25%,
        transparent 60%);
      filter: blur(20px);
      mix-blend-mode: screen;
      animation: flareBreath 9s ease-in-out infinite;
    }
    @keyframes flareBreath {
      0%,100% { opacity: .6; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.15); }
    }

    /* Hide old single video — replaced by stack */
    .hero-video-background > .hero-video:not(.cin-keep) {
      display: none !important;
    }

    @media (max-width: 768px) {
      .hero-matrix, .hero-steam, .hero-flare { display: none; }
      .hero-network { opacity: .35; }
      .hero-video-stack video { animation: none; transform: scale(1.1); }
    }

    @media (prefers-reduced-motion: reduce) {
      .hero-video-stack video, .matrix-col, .dust-mote, .steam-wisp,
      .scan-bar, .hero-flare, .net-line, .net-pulse, .net-dot {
        animation: none !important;
      }
    }
  `;
  const s = document.createElement('style');
  s.id = 'hero-cinematic-style';
  s.textContent = css;
  document.head.appendChild(s);
})();

/* ═══════════════════════════════════════════════════════
   1. SEAMLESS LOOP + 5-MINUTE CINEMATIC SCENE DIRECTOR
   10 distinct "scenes" with unique filter + framing + grading
   Each scene runs ~30s — total 5 min cycle from a single 10s clip
   ═══════════════════════════════════════════════════════ */
(function cinematicDirector(){
  // 10 unique scenes — each feels like a different shot in a film
  const SCENES = [
    { // 0. Golden hour — warm intro
      name: 'golden-hour',
      filter: 'saturate(1.25) contrast(1.10) brightness(.95) sepia(.08) hue-rotate(-8deg)',
      transform: 'scale(1.06) translate(0, 0)',
      rate: 0.75,
      tint: 'rgba(255,180,80,.08)'
    },
    { // 1. Tight close-up — high contrast
      name: 'close-up',
      filter: 'saturate(1.20) contrast(1.20) brightness(.85)',
      transform: 'scale(1.22) translate(-3%, 2%)',
      rate: 0.55,
      tint: 'rgba(0,0,0,.15)'
    },
    { // 2. Cool blue — Paris dusk
      name: 'blue-hour',
      filter: 'saturate(1.15) contrast(1.08) brightness(.90) hue-rotate(8deg)',
      transform: 'scale(1.10) translate(2%, -1%)',
      rate: 0.7,
      tint: 'rgba(60,90,160,.10)'
    },
    { // 3. Wide pan — establishing shot
      name: 'wide-pan',
      filter: 'saturate(1.10) contrast(1.05) brightness(.92)',
      transform: 'scale(1.04) translate(-2%, 0)',
      rate: 0.65,
      tint: 'rgba(20,20,20,.08)'
    },
    { // 4. Vintage film grain feel
      name: 'vintage',
      filter: 'saturate(.85) contrast(1.15) brightness(.88) sepia(.20)',
      transform: 'scale(1.08) translate(1%, 1%)',
      rate: 0.6,
      tint: 'rgba(180,140,80,.10)'
    },
    { // 5. Bright corporate — daytime energy
      name: 'corporate',
      filter: 'saturate(1.30) contrast(1.06) brightness(1.02)',
      transform: 'scale(1.07) translate(0, -1%)',
      rate: 0.8,
      tint: 'rgba(255,255,255,.04)'
    },
    { // 6. Cinematic noir — dramatic shadow
      name: 'noir',
      filter: 'saturate(.65) contrast(1.30) brightness(.78)',
      transform: 'scale(1.14) translate(-1%, -2%)',
      rate: 0.6,
      tint: 'rgba(0,0,30,.18)'
    },
    { // 7. Warm reds — DIGITALNOVA brand mood
      name: 'brand-red',
      filter: 'saturate(1.40) contrast(1.10) brightness(.92) hue-rotate(-15deg)',
      transform: 'scale(1.09) translate(0, 0)',
      rate: 0.7,
      tint: 'rgba(213,43,30,.10)'
    },
    { // 8. Slow dolly-in — anticipation
      name: 'dolly-in',
      filter: 'saturate(1.15) contrast(1.12) brightness(.90)',
      transform: 'scale(1.18) translate(0, 1%)',
      rate: 0.5,
      tint: 'rgba(40,20,10,.10)'
    },
    { // 9. Final hero — full bright cinematic
      name: 'hero-finale',
      filter: 'saturate(1.20) contrast(1.10) brightness(.95)',
      transform: 'scale(1.06) translate(0, 0)',
      rate: 0.75,
      tint: 'rgba(232,140,75,.08)'
    }
  ];

  const SCENE_DURATION = 30; // seconds per scene → 10 scenes × 30s = 5 minutes

  function init(){
    const oldVideo = document.getElementById('heroVideo');
    if(!oldVideo) return;
    const heroBg = document.querySelector('.hero-video-background');
    if(!heroBg) return;

    const src = oldVideo.querySelector('source').src;

    // Create stack wrapper
    const stack = document.createElement('div');
    stack.className = 'hero-video-stack';

    // Color-grade tint overlay (changes per scene)
    const tintLayer = document.createElement('div');
    tintLayer.id = 'sceneTint';
    tintLayer.style.cssText = `position:absolute;inset:0;z-index:2;pointer-events:none;transition:background 2.5s ease;mix-blend-mode:multiply;`;
    heroBg.appendChild(tintLayer);

    // Scene indicator (subtle film-style chapter marker, bottom-left)
    const indicator = document.createElement('div');
    indicator.id = 'sceneIndicator';
    indicator.style.cssText = `position:absolute;bottom:30px;left:56px;z-index:6;pointer-events:none;
      font-family:'Courier New',monospace;font-size:10px;letter-spacing:.3em;
      color:rgba(255,200,150,.45);text-transform:uppercase;
      transition:opacity 1.2s ease, color 1.5s ease;
      mix-blend-mode:screen;`;
    indicator.textContent = '';
    heroBg.appendChild(indicator);

    // Create two videos for crossfade
    const mkVid = (id) => {
      const v = document.createElement('video');
      v.id = id;
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('playsinline','');
      v.setAttribute('webkit-playsinline','');
      const s = document.createElement('source');
      s.src = src; s.type = 'video/mp4';
      v.appendChild(s);
      return v;
    };

    const vA = mkVid('heroVidA');
    const vB = mkVid('heroVidB');
    vA.style.cssText += 'opacity:.82;';
    vB.style.opacity = '0';

    stack.appendChild(vA);
    stack.appendChild(vB);
    heroBg.insertBefore(stack, heroBg.children[1]);
    oldVideo.style.display = 'none';

    // Apply scene look to a video element
    function applyScene(vid, scene){
      vid.style.transition = 'filter 2.5s ease, transform 30s ease-in-out, opacity 1.4s ease-in-out';
      vid.style.filter = scene.filter;
      vid.style.transform = scene.transform;
      vid.playbackRate = scene.rate;
    }

    // Director: change scene every SCENE_DURATION seconds
    let sceneIdx = 0;
    let startTime = performance.now();
    function setScene(idx){
      const scene = SCENES[idx % SCENES.length];
      applyScene(vA, scene);
      applyScene(vB, scene);
      tintLayer.style.background = scene.tint;
      // Subtle chapter indicator
      indicator.style.opacity = '0';
      setTimeout(() => {
        const num = String(idx + 1).padStart(2, '0');
        indicator.textContent = `Scene ${num} / 10 · ${scene.name}`;
        indicator.style.opacity = '.7';
      }, 400);
      setTimeout(() => { indicator.style.opacity = '0'; }, 5000);
    }
    setScene(0);

    // Crossfade loop (every video iteration) + scene change tracker
    const CROSSFADE = 1.4;
    let active = vA, idle = vB;
    let lastSceneChange = startTime;

    function loop(){
      const now = performance.now();
      // Scene change check
      if((now - lastSceneChange) / 1000 >= SCENE_DURATION){
        sceneIdx = (sceneIdx + 1) % SCENES.length;
        setScene(sceneIdx);
        lastSceneChange = now;
      }
      // Video crossfade check
      const dur = active.duration;
      if(isFinite(dur) && active.currentTime >= dur - CROSSFADE){
        idle.currentTime = 0;
        idle.play().catch(()=>{});
        idle.style.opacity = '.82';
        active.style.opacity = '0';
        [active, idle] = [idle, active];
      }
      requestAnimationFrame(loop);
    }

    vA.addEventListener('loadeddata', () => {
      vA.play().catch(()=>{});
      requestAnimationFrame(loop);
    });

    // Hover on hero → pause scene rotation (user is reading)
    let hovering = false;
    heroBg.addEventListener('mouseenter', () => { hovering = true; });
    heroBg.addEventListener('mouseleave', () => {
      if(hovering){ lastSceneChange = performance.now(); hovering = false; }
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ─── 2. MATRIX RAIN ─── */
(function matrixRain(){
  function init(){
    const heroBg = document.querySelector('.hero-video-background');
    if(!heroBg) return;
    const layer = document.createElement('div');
    layer.className = 'hero-matrix';
    const chars = 'アイウエオカキクケコ01';
    const N = 18;
    for(let i=0;i<N;i++){
      const col = document.createElement('div');
      col.className = 'matrix-col';
      col.style.left = (Math.random()*100) + '%';
      col.style.animationDuration = (8 + Math.random()*10) + 's';
      col.style.animationDelay = (-Math.random()*10) + 's';
      let txt = '';
      const len = 20 + Math.floor(Math.random()*30);
      for(let j=0;j<len;j++) txt += chars[Math.floor(Math.random()*chars.length)];
      col.textContent = txt;
      col.style.opacity = (.4 + Math.random()*.6).toString();
      layer.appendChild(col);
    }
    heroBg.appendChild(layer);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ─── 3. WORLD NETWORK — REMOVED (user feedback: too distracting) ─── */
/* Cleanup any existing network overlay from previous load */
(function removeWorldNetwork(){
  function cleanup(){
    document.querySelectorAll('.hero-network').forEach(el => el.remove());
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cleanup);
  else cleanup();
})();

/* ─── 4. AMBIENT DUST PARTICLES ─── */
(function dust(){
  function init(){
    const heroBg = document.querySelector('.hero-video-background');
    if(!heroBg) return;
    const layer = document.createElement('div');
    layer.className = 'hero-dust';
    const N = 25;
    for(let i=0;i<N;i++){
      const d = document.createElement('div');
      d.className = 'dust-mote';
      d.style.left = (Math.random()*100) + '%';
      const size = 1 + Math.random()*4;
      d.style.width = d.style.height = size + 'px';
      const dur = 14 + Math.random()*16;
      d.style.animationDuration = dur + 's';
      d.style.animationDelay = (-Math.random()*dur) + 's';
      layer.appendChild(d);
    }
    heroBg.appendChild(layer);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ─── 5. COFFEE STEAM ─── */
(function steam(){
  function init(){
    const heroBg = document.querySelector('.hero-video-background');
    if(!heroBg) return;
    const layer = document.createElement('div');
    layer.className = 'hero-steam';
    const N = 4;
    for(let i=0;i<N;i++){
      const w = document.createElement('div');
      w.className = 'steam-wisp';
      w.style.left = (40 + i*8) + '%';
      w.style.animationDelay = (i*1.3) + 's';
      w.style.animationDuration = (6 + Math.random()*3) + 's';
      layer.appendChild(w);
    }
    heroBg.appendChild(layer);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ─── 6. LIGHT SCAN + LENS FLARE ─── */
(function scanAndFlare(){
  function init(){
    const heroBg = document.querySelector('.hero-video-background');
    if(!heroBg) return;
    const scan = document.createElement('div');
    scan.className = 'hero-scan';
    scan.innerHTML = '<div class="scan-bar"></div>';
    heroBg.appendChild(scan);

    const flare = document.createElement('div');
    flare.className = 'hero-flare';
    heroBg.appendChild(flare);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
