/* ═══════════════════════════════════════════════
   🌍 PUBLIC-MAP — Sparkle cursor + FR/EN translation
   ═══════════════════════════════════════════════ */

/* ─── SPARKLE / STAR CURSOR EFFECT ─── */
(function sparkleCursor(){
  const finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enableDecorativeSparkles = document.documentElement.dataset.sparkles === 'on';
  if(!enableDecorativeSparkles || window.innerWidth <= 1180 || !finePointer || reducedMotion) return;

  const colors = ['#B87333','#D4A95C','#E5C078','#EFE5D0','#F5C97E'];
  const sparkles = [];
  const MAX = 60;
  let lastSpawn = 0;

  function spawn(x, y){
    const now = performance.now();
    if(now - lastSpawn < 18) return;
    lastSpawn = now;

    const el = document.createElement('div');
    el.className = 'spark';
    const size = 6 + Math.random()*10;
    const color = colors[Math.floor(Math.random()*colors.length)];
    const dx = (Math.random()-0.5) * 80;
    const dy = (Math.random()-0.5) * 80 - 20;
    const rot = Math.random()*360;
    el.style.cssText = `
      position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;
      pointer-events:none;z-index:9500;
      background:${color};
      clip-path:polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%);
      transform:translate(-50%,-50%) rotate(${rot}deg) scale(1);
      filter:drop-shadow(0 0 6px ${color});
      transition:transform 900ms cubic-bezier(.2,.7,.3,1), opacity 900ms ease-out;
      opacity:1;
    `;
    document.body.appendChild(el);
    requestAnimationFrame(()=>{
      el.style.transform = `translate(${dx-50}%,${dy-50}%) rotate(${rot+180}deg) scale(0)`;
      el.style.opacity = '0';
    });
    setTimeout(()=>el.remove(), 950);
  }

  document.addEventListener('mousemove', e => {
    spawn(e.clientX, e.clientY);
  }, {passive:true});

  document.addEventListener('click', e => {
    for(let i=0;i<14;i++){
      setTimeout(()=>spawn(e.clientX + (Math.random()-0.5)*30, e.clientY + (Math.random()-0.5)*30), i*15);
    }
  });
})();


/* ─── FR/EN TRANSLATION SYSTEM ─── */
const T = {
  // Meta / title
  "🌍 PUBLIC-MAP CANADA INC. — La Référence du Marketing Digital":"🌍 PUBLIC-MAP CANADA INC. — The Reference in Digital Marketing",
  "Chargement de la plateforme…":"Loading the platform…",

  // Navigation
  "Services":"Services",
  "Avis Clients":"Reviews",
  "Contact":"Contact",
  "Canada":"Canada",
  "Europe":"Europe",
  "Demander un devis →":"Request a quote →",
  "FR":"FR","EN":"EN",

  // Hero
  "Visibilité internationale — partout dans le monde":"International visibility — worldwide",
  "Le Marketing":"Marketing",
  "Digital":"Digital",
  "Sans Limites":"Without Limits",
  "Votre visibilité":"Your visibility",
  "partout dans le monde":"worldwide",
  "Découvrez nos services":"Discover our services",
  "Nous contacter →":"Contact us →",
  "Professionnels Certifiés":"Certified Professionals",
  "Service 5 Étoiles":"5-Star Service",
  "Support 24/7":"24/7 Support",
  "🌍 PUBLIC-MAP — Google Business Profile, SEO local et avis Google pour attirer plus de clients partout dans le monde.":"🌍 PUBLIC-MAP — Google Business Profile, local SEO and Google reviews to attract more customers worldwide.",
  "🚀 Demander un devis":"🚀 Request a quote",
  "Voir les témoignages →":"See testimonials →",
  "Clients actifs":"Active clients",
  "Ans d'expérience":"Years of experience",
  "% Satisfaction":"% Satisfaction",
  "ROI Moyen Client — 6 mois":"Average Client ROI — 6 months",
  "Retour sur investissement":"Return on investment",
  "Croissance SEO":"SEO Growth",
  "Trafic organique en 90 jours":"Organic traffic in 90 days",
  "Présence Internationale":"International Presence",
  "18 Pays":"18 Countries",
  "Canada · France · Belgique · Suisse…":"Canada · France · Belgium · Switzerland…",

  // Trust ribbon
  "🇨🇦 Corporations Canada":"🇨🇦 Corporations Canada",
  "🇫🇷 Registre France INPI":"🇫🇷 France INPI Register",
  "🏆 Google Premier Partner":"🏆 Google Premier Partner",
  "⭐ 4.9/5 · 527 Avis Google":"⭐ 4.9/5 · 527 Google Reviews",
  "📲 QR Code + NFC":"📲 QR Code + NFC",
  "📋 Devis personnalisé":"📋 Personalized quote",

  // Google section
  "CERTIFIÉ PAR":"CERTIFIED BY",
  "Premier Partner":"Premier Partner",
  "Local SEO Certified":"Local SEO Certified",
  "SEO for Growth":"SEO for Growth",
  "Certified Organic SEO":"Certified Organic SEO",
  "Google Ads Certified":"Google Ads Certified",
  "Google Analytics 4":"Google Analytics 4",
  "Partenaire Officiel Certifié":"Official Certified Partner",
  "Boostez vos avis":"Boost your reviews",
  "Google 5 étoiles":"5-star Google",
  "QR Code & NFC":"QR Code & NFC",
  "Vos clients laissent un avis Google ⭐⭐⭐⭐⭐ en":"Your clients leave a 5-star Google review in",
  "10 secondes":"10 seconds",
  "— 1 scan ou 1 tapotement NFC. Plus d'avis = 1ère position = plus de clients.":"— 1 scan or 1 NFC tap. More reviews = #1 position = more customers.",
  "· 527 avis Google vérifiés":"· 527 verified Google reviews",
  "🚀 Demander un devis — $1 000 CAD":"🚀 Request a quote — $1,000 CAD",
  "🇪🇺 Europe — 219 € HT":"🇪🇺 Europe — €219 excl. tax",
  "Google Premier":"Google Premier",
  "Local SEO":"Local SEO",
  "Organic SEO":"Organic SEO",
  "Google Ads":"Google Ads",

  // Dashboard
  "🌍 PUBLIC-MAP — Dashboard Marketing Canada & Europe":"🌍 PUBLIC-MAP — Marketing Dashboard Canada & Europe",
  "SEO Traffic":"SEO Traffic",
  "×4.8 ROI":"×4.8 ROI",
  "Retour invest.":"ROI",
  "4.9★ Google":"4.9★ Google",
  "527 avis":"527 reviews",
  "CA + EU":"CA + EU",
  "Trafic":"Traffic",
  "Conversions":"Conversions",
  "SEO Expert":"SEO Expert",
  "Ads":"Ads",
  "Analytics":"Analytics",
  "Ads Expert":"Ads Expert",
  "🌍 PUBLIC-MAP Dashboard":"🌍 PUBLIC-MAP Dashboard",
  "SEO Rankings":"SEO Rankings",
  "#1 Google.ca":"#1 Google.ca",
  "#2 Québec":"#2 Quebec",
  "#3 Toronto":"#3 Toronto",
  "QR Code":"QR Code",
  "📡 NFC Activé":"📡 NFC Active",
  "+280% de trafic !":"+280% traffic!",
  "SEO National Canada":"National SEO Canada",
  "En seulement 3 mois 🚀":"In just 3 months 🚀",
  "Partner Team — 🌍 PUBLIC-MAP CANADA INC.":"Partner Team — 🌍 PUBLIC-MAP CANADA INC.",
  "✓ Certifié":"✓ Certified",

  // Service intro
  "Ce que comprend notre service":"What our service includes",
  "· QR Code · NFC · Business Profile":"· QR Code · NFC · Business Profile",
  "Trois outils puissants, une seule mission : plus d'avis 5 étoiles, plus de visibilité, plus de clients.":"Three powerful tools, one mission: more 5-star reviews, more visibility, more customers.",

  // 3 features
  "📲 Cartes QR Code Google":"📲 Google QR Code Cards",
  "Cartes physiques premium (plastique/métal) ou numériques avec votre QR Code unique. Vos clients scannent → avis Google en 10 secondes.":"Premium physical (plastic/metal) or digital cards with your unique QR Code. Customers scan → Google review in 10 seconds.",
  "Redirige directement vers votre fiche Google":"Redirects directly to your Google listing",
  "Version imprimée ou numérique (PNG/SVG)":"Printed or digital version (PNG/SVG)",
  "Intégrable site web, réseaux sociaux & email":"Integrable in website, social networks & email",
  "Compatible 100% iPhone & Android":"100% iPhone & Android compatible",
  "Boost immédiat du classement Google":"Immediate boost to Google ranking",
  "📡 Puce NFC — 1 Tapotement":"📡 NFC Chip — 1 Tap",
  "Technologie NFC intégrée à votre carte ou plaquette. Le client approche son téléphone → fiche Google s'ouvre instantanément. Zéro scan.":"NFC technology integrated in your card or plate. Customer brings phone close → Google listing opens instantly. Zero scan.",
  "Déclenche l'avis Google en 0,5 seconde":"Triggers Google review in 0.5 seconds",
  "Compatible iPhone (iOS 13+) & Android":"Compatible iPhone (iOS 13+) & Android",
  "Aucune application à installer":"No app to install",
  "Puce reprogrammable à tout moment":"Chip reprogrammable any time",
  "Idéal restaurants, boutiques, cliniques":"Ideal for restaurants, shops, clinics",
  "🏢 Google Business Profile IA":"🏢 Google Business Profile AI",
  "Création + optimisation complète de votre fiche Google My Business avec mots-clés SEO stratégiques. Réponses automatiques aux avis par IA.":"Complete creation + optimization of your Google My Business listing with strategic SEO keywords. AI-powered automatic review replies.",
  "Création ou reprise de votre fiche GMB":"Creation or takeover of your GMB listing",
  "Description + mots-clés SEO optimisés":"Description + optimized SEO keywords",
  "Réponses IA aux avis positifs & négatifs":"AI replies to positive & negative reviews",
  "Photos, horaires, services configurés":"Photos, hours, services configured",
  "Vérification Google incluse":"Google verification included",

  // Process
  "Un processus":"A simple",
  "simple":"and effective",
  "et efficace":"process",
  "Opérationnel en moins de 48h":"Operational in less than 48h",
  "Vous commandez":"You order",
  "Choisissez votre pack Canada ou Europe et préparez votre demande de devis en 2 minutes.":"Choose your Canada or Europe pack and prepare your quote request in 2 minutes.",
  "Nous configurons":"We configure",
  "Votre QR Code unique est créé et la puce NFC est programmée avec votre fiche Google sous 24h.":"Your unique QR Code is created and the NFC chip is programmed with your Google listing within 24h.",
  "Vous recevez":"You receive",
  "Carte physique livrée + kit numérique (PNG, SVG) par email. Votre fiche Google est optimisée et vérifiée.":"Physical card delivered + digital kit (PNG, SVG) by email. Your Google listing is optimized and verified.",
  "Les avis arrivent":"Reviews arrive",
  "Posez la carte à votre caisse. Vos clients scannent ou tapotent — avis 5 étoiles en 10 secondes !":"Place the card at your checkout. Customers scan or tap — 5-star reviews in 10 seconds!",

  // Pricing
  "Business Profile — Nos Offres":"Business Profile — Our Offers",
  "Une solution pour":"A solution for",
  "chaque besoin":"every need",
  "Prix en Dollar Canadien · Équivalent Euro disponible sur demande":"Prices in Canadian Dollars · Euro equivalent available on request",
  "Pack Starter":"Starter Pack",
  "QR Code + NFC":"QR Code + NFC",
  "Idéal pour démarrer rapidement":"Ideal to start quickly",
  "CAD":"CAD",
  "activation unique · · Accès à vie inclus":"one-time activation · Lifetime access included",
  "Carte QR Code physique (plastique)":"Physical QR Code card (plastic)",
  "Puce NFC programmée":"Programmed NFC chip",
  "QR Code numérique (PNG/SVG)":"Digital QR Code (PNG/SVG)",
  "Création fiche Google Business":"Google Business listing creation",
  "Tableau de bord suivi des avis":"Review tracking dashboard",
  "Support email 48h":"Email support 48h",
  "Demander un devis — $1 000 CAD →":"Request a quote — $1,000 CAD →",
  "⭐ POPULAIRE":"⭐ POPULAR",
  "Pack Pro":"Pro Pack",
  "QR + NFC + GMB Optimisé":"QR + NFC + Optimized GMB",
  "Le plus choisi par nos clients":"Most chosen by our clients",
  "Tout le Pack Starter +":"Everything in Starter Pack +",
  "Carte NFC métal premium":"Premium metal NFC card",
  "Optimisation GMB complète + SEO":"Full GMB optimization + SEO",
  "Réponses IA aux avis (positifs/négatifs)":"AI replies to reviews (positive/negative)",
  "Posts Google hebdomadaires":"Weekly Google posts",
  "Rapport annuel + support 1 an":"Annual report + 1-year support",
  "Demander un devis — $1 500 CAD →":"Request a quote — $1,500 CAD →",
  "SEO National":"National SEO",
  "Dominez Google Canada":"Dominate Google Canada",
  "Référencement national complet":"Complete national SEO",
  "CAD/an":"CAD/yr",
  "paiement annuel · Renouvellement libre":"annual payment · Free renewal",
  "Audit SEO complet (200+ points)":"Full SEO audit (200+ points)",
  "60 mots-clés ciblés national":"60 national targeted keywords",
  "Netlinking Premium DA50+ Canada":"Premium Netlinking DA50+ Canada",
  "8 articles SEO optimisés · inclus 1 an":"8 optimized SEO articles · 1 year included",
  "Pack QR Code + NFC inclus":"QR Code + NFC pack included",
  "Dashboard positions en temps réel":"Real-time position dashboard",
  "Demander un devis — $2 500 CAD/an →":"Request a quote — $2,500 CAD/yr →",
  "🇪🇺 Zone Europe — Prix en Euro HT":"🇪🇺 Europe Zone — Prices in Euros excl. tax",
  "Starter : 219 € · Pro : 369 € · SEO National : 439 €/an · Conformité RGPD · Bureau Paris":"Starter: €219 · Pro: €369 · National SEO: €439/yr · GDPR compliant · Paris office",
  "Starter 219 €":"Starter €219",
  "Pro 369 €":"Pro €369",
  "SEO 439 €/an":"SEO €439/yr",

  // SEO National section
  "🔍 Référencement National":"🔍 National SEO",
  "Comment le SEO National":"How National SEO",
  "propulse votre business":"propels your business",
  "en 1ère page":"to the 1st page",
  "Tout comprendre en 2 minutes — de la recherche de mots-clés aux résultats mesurables":"Everything explained in 2 minutes — from keyword research to measurable results",
  "C'est quoi le SEO National ?":"What is National SEO?",
  "Le":"The",
  "référencement naturel national":"national organic SEO",
  "consiste à positionner votre site en":"consists of ranking your site on the",
  "1ère page Google":"1st Google page",
  "sur tout le Canada ou toute l'Europe — pas seulement dans votre ville.":"across all of Canada or Europe — not just in your city.",
  "Quand un client cherche":"When a client searches for",
  "\"agence marketing Québec\"":"\"marketing agency Quebec\"",
  "ou":"or",
  "\"boutique en ligne Canada\"":"\"online store Canada\"",
  "— votre site doit apparaître":"— your site must appear",
  "avant vos concurrents":"before your competitors",
  "💡 Statistique clé":"💡 Key statistic",
  "75% des internautes":"75% of users",
  "ne cliquent jamais au-delà de la 1ère page. Être #1 vs #10 = ×":"never click past the 1st page. Being #1 vs #10 = ×",
  "10 fois":"10 times",
  "plus de visites.":"more visits.",
  "Audit + 60 mots-clés ciblés":"Audit + 60 targeted keywords",
  "Analyse 200+ facteurs SEO de votre site":"Analysis of 200+ SEO factors on your site",
  "Optimisation technique complète":"Complete technical optimization",
  "Vitesse, mobile, Schema.org, balises meta":"Speed, mobile, Schema.org, meta tags",
  "8 articles SEO optimisés · 1 an":"8 optimized SEO articles · 1 year",
  "Contenu qui classe ET qui convertit":"Content that ranks AND converts",
  "Liens d'autorité depuis sites canadiens réputés":"Authority links from reputable Canadian sites",
  "Les 3 types de mots-clés SEO :":"The 3 types of SEO keywords:",
  "Mots-clés Principaux":"Main Keywords",
  "Volume élevé":"High volume",
  "Termes généraux très recherchés comme":"Highly searched general terms like",
  "\"agence marketing Canada\"":"\"marketing agency Canada\"",
  "\"création site web Montréal\"":"\"website creation Montreal\"",
  ". Très compétitifs — résultats en 6-12 mois d'effort SEO. Fort trafic quand atteint.":". Very competitive — results in 6-12 months of SEO effort. High traffic when achieved.",
  "Mots-clés Longue Traîne":"Long-Tail Keywords",
  "Conversion ×3":"Conversion ×3",
  "Phrases précises à haute intention d'achat :":"Precise phrases with high purchase intent:",
  "\"agence SEO certifiée Google Montréal\"":"\"Google certified SEO agency Montreal\"",
  ". Moins compétitifs, résultats en 4-8 semaines. Taux de conversion 3× supérieur aux mots généraux.":". Less competitive, results in 4-8 weeks. Conversion rate 3× higher than general terms.",
  "Mots-clés Géo-ciblés":"Geo-Targeted Keywords",
  "ROI rapide":"Fast ROI",
  "Service + lieu :":"Service + location:",
  "\"comptable Toronto\"":"\"accountant Toronto\"",
  "\"dentiste Montréal\"":"\"dentist Montreal\"",
  "\"avocat Paris 8e\"":"\"lawyer Paris 8th\"",
  ". Idéal pour conquérir simultanément local ET national. Premières positions souvent en moins de 30 jours.":". Ideal to conquer local AND national simultaneously. First positions often in less than 30 days.",
  "📊 Nos résultats moyens clients :":"📊 Our average client results:",
  "Trafic en 90j":"Traffic in 90 days",
  "ROI moyen 6 mois":"Avg ROI 6 months",
  "90j":"90d",
  "Garantie résultats":"Results guarantee",
  "Position visée":"Target position",

  // Zone tabs
  "🇨🇦 Canada":"🇨🇦 Canada",
  "Services en Dollar Canadien — Marché Nord-Américain":"Services in Canadian Dollars — North American Market",
  "$ CAD":"$ CAD",
  "🇪🇺 Europe":"🇪🇺 Europe",
  "Services en Euro — Marchés Français, Belge, Suisse & EU":"Services in Euros — French, Belgian, Swiss & EU Markets",
  "€ EUR":"€ EUR",

  // Canada services
  "Services — Zone Canada 🇨🇦":"Services — Canada Zone 🇨🇦",
  "Prix en Dollar Canadien · Équipe disponible EST/PST · Support 7j/7":"Prices in Canadian Dollars · Team available EST/PST · 7-day support",
  "$ Dollars Canadiens":"$ Canadian Dollars",
  "🔥 Populaire":"🔥 Popular",
  "Référencement Naturel":"Organic SEO",
  "Pack SEO Prestige Canada":"Prestige SEO Pack Canada",
  "Dominez Google.ca et Bing Canada. Audit complet, optimisation technique, création de contenu ciblé marché canadien et netlinking premium DA50+. Résultats mesurables sous 90 jours — garantie remboursement incluse.":"Dominate Google.ca and Bing Canada. Full audit, technical optimization, content creation targeted to the Canadian market and premium DA50+ netlinking. Measurable results within 90 days — money-back guarantee included.",
  "Audit SEO technique complet (200+ points)":"Full technical SEO audit (200+ points)",
  "60 mots-clés ciblés Canada (FR & EN)":"60 keywords targeting Canada (FR & EN)",
  "Rédaction 8 articles SEO · inclus 1 an":"8 SEO articles written · 1 year included",
  "Rapport de performance trimestriel":"Quarterly performance report",
  "Support dédié 7j/7 — Réponse sous 2h":"Dedicated 7-day support — Response in 2h",
  "paiement unique · À vie":"one-time payment · Lifetime",
  "Demander un devis":"Request a quote",
  "✨ Nouveau":"✨ New",
  "Réseaux Sociaux":"Social Networks",
  "Gestion Médias Sociaux Élite":"Elite Social Media Management",
  "Stratégie éditoriale complète, création graphique sur mesure et gestion de communauté pour Instagram, Facebook, LinkedIn et TikTok. Croissance organique garantie dès la 2e semaine.":"Complete editorial strategy, custom graphic creation and community management for Instagram, Facebook, LinkedIn and TikTok. Organic growth guaranteed from week 2.",
  "30 publications créatives · inclus 1 an":"30 creative publications · 1 year included",
  "Stories, Reels & TikToks inclus":"Stories, Reels & TikToks included",
  "Community management quotidien":"Daily community management",
  "Campagnes Meta Ads optimisées":"Optimized Meta Ads campaigns",
  "Tableau de bord analytique live":"Live analytics dashboard",
  "Calendrier éditorial personnalisé":"Custom editorial calendar",
  "paiement unique · Accès à vie":"one-time payment · Lifetime access",
  "Création Web":"Web Design",
  "Site Vitrine Premium Canada":"Premium Showcase Site Canada",
  "Conception d'un site web professionnel sur mesure, 100% responsive, optimisé SEO dès le lancement. Hébergement canadien haute-disponibilité, SSL inclus et panneau d'administration intuitif.":"Design of a custom professional website, 100% responsive, SEO-optimized from launch. High-availability Canadian hosting, SSL included and intuitive admin panel.",
  "Design sur mesure — identité de marque":"Custom design — brand identity",
  "Jusqu'à 15 pages optimisées SEO":"Up to 15 SEO-optimized pages",
  "Formulaires, live chat & CRM":"Forms, live chat & CRM",
  "Hébergement Canada 1 an offert":"Canada hosting 1 year free",
  "Certificat SSL + sauvegarde auto":"SSL certificate + auto backup",
  "Formation complète de 4h incluse":"4h complete training included",
  "paiement unique · Livraison 3 semaines":"one-time payment · Delivery 3 weeks",
  "⭐ Best-Seller":"⭐ Best-Seller",
  "Commerce en Ligne":"E-Commerce",
  "Boutique E-Commerce Clé en Main":"Turnkey E-Commerce Store",
  "Votre boutique en ligne professionnelle, prête à vendre au Canada et partout dans le monde. Intégration Lemon Squeezy pour paiements sécurisés, gestion des stocks automatisée, multi-langues et multi-devises.":"Your professional online store, ready to sell in Canada and worldwide. Lemon Squeezy integration for secure payments, automated inventory, multi-language and multi-currency.",
  "Jusqu'à 200 produits configurés":"Up to 200 products configured",
  "Intégration Lemon Squeezy — cartes internationales":"Lemon Squeezy integration — international cards",
  "Multi-devises CAD / USD / EUR":"Multi-currency CAD / USD / EUR",
  "Gestion stocks et commandes auto":"Automated stock and order management",
  "Interface admin intuitive":"Intuitive admin interface",
  "Formation + support 1 an offert":"Training + 1-year support free",
  "paiement unique · Livraison 4 semaines":"one-time payment · Delivery 4 weeks",
  "Publicité Digitale":"Digital Advertising",
  "Campagnes Google Ads Pro":"Pro Google Ads Campaigns",
  "Gestion complète de vos campagnes Google Search, Display et YouTube. Ciblage précis du marché canadien, A/B testing continu, optimisation du coût par acquisition et ROI maximal garanti dès J+3.":"Complete management of your Google Search, Display and YouTube campaigns. Precise Canadian market targeting, continuous A/B testing, cost-per-acquisition optimization and maximum ROI guaranteed from D+3.",
  "Setup + audit compte existant":"Setup + audit of existing account",
  "Ciblage géo Canada (provinces)":"Geo-targeting Canada (provinces)",
  "A/B testing des annonces":"A/B testing of ads",
  "Optimisation budget hebdomadaire":"Weekly budget optimization",
  "Rapports ROI bihebdomadaires":"Bi-weekly ROI reports",
  "Accès tableau de bord temps réel":"Real-time dashboard access",
  "trimestriel · Budget ads en sus":"quarterly · Ad budget extra",
  "Stratégie & Conseil":"Strategy & Consulting",
  "Audit & Stratégie 360° Canada":"360° Audit & Strategy Canada",
  "Analyse exhaustive de votre présence numérique sur le marché canadien. Rapport d'audit complet, benchmarking concurrentiel, plan d'action sur 12 mois chiffré et accompagnement annuel personnalisé.":"Exhaustive analysis of your digital presence in the Canadian market. Full audit report, competitive benchmarking, 12-month action plan with budget and personalized annual coaching.",
  "Audit SEO, web, social complet":"Full SEO, web, social audit",
  "Analyse 5 concurrents directs":"Analysis of 5 direct competitors",
  "Plan stratégique annuel chiffré":"Annual strategic plan with budget",
  "4 sessions coaching visio incluses":"4 video coaching sessions included",
  "Dashboard live accès permanent":"Live dashboard permanent access",
  "Rapport PDF 60+ pages livré":"60+ page PDF report delivered",
  "paiement unique · Livraison 10j":"one-time payment · Delivery 10 days",

  // Europe services
  "Services — Zone Europe 🇪🇺":"Services — Europe Zone 🇪🇺",
  "Prix en Euro · Conformité RGPD · Équipe Paris · Support 7j/7":"Prices in Euros · GDPR compliant · Paris team · 7-day support",
  "€ Euros — Marché Européen":"€ Euros — European Market",
  "Pack SEO Premium Europe":"Premium SEO Pack Europe",
  "Positionnez-vous en tête de Google.fr, Google.be, Google.ch et les moteurs européens. Stratégie de contenu francophone, netlinking premium européen et optimisation technique RGPD-compliant.":"Position yourself at the top of Google.fr, Google.be, Google.ch and European engines. French-language content strategy, premium European netlinking and GDPR-compliant technical optimization.",
  "Audit SEO technique + RGPD compliance":"Technical SEO audit + GDPR compliance",
  "60 mots-clés ciblés marché EU":"60 keywords targeting EU market",
  "Netlinking Premium DA50+ Europe":"Premium Netlinking DA50+ Europe",
  "8 articles SEO FR/EN/DE · inclus 1 an":"8 SEO articles FR/EN/DE · 1 year included",
  "Rapport annuel + KPIs UE":"Annual report + EU KPIs",
  "Support Paris — CET/CEST":"Paris support — CET/CEST",
  "paiement unique · À vie · TVA selon pays":"one-time payment · Lifetime · VAT per country",
  "Community Management Europe":"Community Management Europe",
  "Stratégie éditoriale adaptée aux codes culturels européens (France, Belgique, Suisse). Publications multilingues, gestion de crise, influence marketing et publicités Meta ciblées zones EU.":"Editorial strategy adapted to European cultural codes (France, Belgium, Switzerland). Multilingual publications, crisis management, influencer marketing and EU-targeted Meta ads.",
  "30 publications FR/EN · inclus 1 an":"30 publications FR/EN · 1 year included",
  "Stories, Reels & contenu viral EU":"Stories, Reels & EU viral content",
  "Meta Ads ciblage UE précis":"Meta Ads precise EU targeting",
  "Veille concurrentielle Europe":"European competitive intelligence",
  "Calendrier éditorial saisonnier EU":"EU seasonal editorial calendar",
  "Site Web Professionnel Europe":"Professional Website Europe",
  "Site web sur mesure, conforme RGPD, hébergé en Europe (datacenter France). Mentions légales, politique de confidentialité et gestion des cookies incluses. Livraison clé en main en 3 semaines.":"Custom website, GDPR compliant, hosted in Europe (France datacenter). Legal notices, privacy policy and cookie management included. Turnkey delivery in 3 weeks.",
  "Design sur mesure — charte graphique":"Custom design — visual identity",
  "15 pages + blog intégré":"15 pages + integrated blog",
  "100% RGPD compliant":"100% GDPR compliant",
  "Hébergement France 1 an offert":"France hosting 1 year free",
  "Mentions légales + CGV rédigées":"Legal notices + terms drafted",
  "Formation 4h + support 1 an":"4h training + 1-year support",
  "paiement unique · 30% acompte":"one-time payment · 30% deposit",
  "E-Commerce Europe Clé en Main":"Turnkey Europe E-Commerce",
  "Boutique en ligne conforme aux normes européennes (RGPD, TVA intracommunautaire, Directive consommateurs). Paiements Lemon Squeezy, gestion multi-pays, livraison Europe automatisée.":"Online store compliant with European standards (GDPR, intra-community VAT, Consumer Directive). Lemon Squeezy payments, multi-country management, automated Europe delivery.",
  "200 produits configurés":"200 products configured",
  "Lemon Squeezy — cartes EU acceptées":"Lemon Squeezy — EU cards accepted",
  "TVA intracommunautaire automatique":"Automatic intra-community VAT",
  "Livraison multi-pays EU configurée":"Multi-country EU delivery configured",
  "CGV + politique retours EU incluses":"Terms + EU return policy included",
  "Google Ads Europe Pro":"Google Ads Europe Pro",
  "Gestion de campagnes Google Ads ciblées sur les marchés européens francophones et anglophones. Conformité politique publicitaire européenne, RGPD ads et optimisation du CPA marché EU.":"Management of Google Ads campaigns targeting French- and English-speaking European markets. EU advertising policy compliance, GDPR ads and EU market CPA optimization.",
  "Ciblage France, Belgique, Suisse":"Targeting France, Belgium, Switzerland",
  "Campagnes conformes RGPD":"GDPR-compliant campaigns",
  "A/B testing annonces FR/EN":"A/B testing ads FR/EN",
  "Optimisation CPA marché UE":"EU market CPA optimization",
  "Lien compte Google Ads inclus":"Google Ads account link included",
  "Audit & Stratégie Europe 360°":"360° Audit & Strategy Europe",
  "Audit complet de votre présence numérique sur les marchés européens. Benchmarking concurrentiel France/Belgique/Suisse, plan d'action 12 mois et accompagnement annuel avec expert dédié Paris.":"Full audit of your digital presence in European markets. Competitive benchmarking France/Belgium/Switzerland, 12-month action plan and annual coaching with dedicated Paris expert.",
  "Audit SEO + RGPD + Social EU":"SEO + GDPR + Social EU audit",
  "Benchmarking 5 concurrents EU":"Benchmarking 5 EU competitors",
  "Plan stratégique annuel EU":"EU annual strategic plan",
  "4 sessions visio expert Paris":"4 Paris expert video sessions",
  "Tableau de bord EU accès permanent":"EU dashboard permanent access",
  "Rapport 60+ pages en français":"60+ page report in French",

  // Card section
  "📲 CARTE PHYSIQUE PREMIUM":"📲 PREMIUM PHYSICAL CARD",
  "Votre carte":"Your",
  "Google Reviews":"Google Reviews card",
  "Carte plastique noire mat premium — vos clients scannent ou tapotent et laissent un avis Google ⭐⭐⭐⭐⭐ en":"Premium matte black plastic card — your clients scan or tap and leave a 5-star Google review in",
  ". Livraison sous 5 jours ouvrables.":". Delivery within 5 business days.",
  "Review us on":"Review us on",
  "Reviews":"Reviews",
  "🌍 public-map.com · Google Reviews":"🌍 public-map.com · Google Reviews",
  "VOTRE LOGO":"YOUR LOGO",
  "1 Scan = 1 Avis":"1 Scan = 1 Review",
  "Le client scanne le QR Code avec son iPhone ou Android — redirigé vers votre fiche Google Reviews en 2 secondes.":"Customer scans the QR Code with iPhone or Android — redirected to your Google Reviews page in 2 seconds.",
  "1 Tapotement NFC":"1 NFC Tap",
  "Puce NFC intégrée dans la carte — approchez le téléphone, la fiche Google s'ouvre instantanément. Zéro application requise.":"NFC chip integrated in the card — bring phone close, Google listing opens instantly. No app required.",
  "Carte Plastique Noire Mat":"Matte Black Plastic Card",
  "Format carte de crédit. Fond noir mat premium, anneau Google 4 couleurs, votre logo personnalisé. Livraison 5 jours.":"Credit card size. Premium matte black background, 4-color Google ring, your custom logo. 5-day delivery.",
  "📦 INCLUS DANS CHAQUE PACK GOOGLE":"📦 INCLUDED IN EVERY GOOGLE PACK",
  "Carte Google Reviews QR Code + NFC":"Google Reviews QR Code + NFC card",
  "Personnalisée avec votre logo · Fond noir mat · Anneau Google 4 couleurs · Canada & Europe":"Personalized with your logo · Matte black · 4-color Google ring · Canada & Europe",
  "🇨🇦 Demander un devis — $1 000 CAD":"🇨🇦 Request a quote — $1,000 CAD",

  // Reviews
  "⭐ Témoignages Vérifiés":"⭐ Verified Testimonials",
  "Ce que disent":"What our",
  "nos clients":"clients say",
  "Avis authentiques vérifiés Google — clients réels du Canada et d'Europe.":"Authentic Google-verified reviews — real clients from Canada and Europe.",
  "527 avis Google":"527 Google reviews",
  "Basé sur 527 avis Google vérifiés":"Based on 527 verified Google reviews",
  "\"L'agence la plus transparente et la plus efficace avec laquelle j'ai travaillé au Canada et en Europe.\"":"\"The most transparent and effective agency I've worked with in Canada and Europe.\"",
  "Marie-Claude Tremblay":"Marie-Claude Tremblay",
  "Montréal, Québec 🇨🇦":"Montreal, Quebec 🇨🇦",
  "🌍 PUBLIC-MAP a transformé ma présence en ligne en seulement 4 mois. Mon trafic a augmenté de 280% et mes ventes ont doublé. L'équipe est professionnelle, réactive et vraiment à l'écoute. Le meilleur investissement de ma carrière d'entrepreneur !":"🌍 PUBLIC-MAP transformed my online presence in just 4 months. My traffic grew 280% and my sales doubled. The team is professional, responsive and truly attentive. Best investment of my entrepreneurial career!",
  "Il y a 2 semaines · Avis vérifié Google ✓":"2 weeks ago · Google verified review ✓",
  "Jean-François Bouchard":"Jean-François Bouchard",
  "Québec City 🇨🇦":"Quebec City 🇨🇦",
  "Mon e-commerce livré 5 jours avant le délai prévu et il dépasse toutes mes attentes. Le parcours de devis est clair, la formation était excellente. Chiffre d'affaires en ligne multiplié par 3 en 6 mois. Je recommande sans réserve !":"My e-commerce was delivered 5 days early and exceeds all my expectations. The quote process is clear, training was excellent. Online revenue multiplied by 3 in 6 months. I recommend without reservation!",
  "Boutique E-Commerce Canada":"E-Commerce Store Canada",
  "Il y a 1 mois · Avis vérifié Google ✓":"1 month ago · Google verified review ✓",
  "Sophie Larivière":"Sophie Larivière",
  "Toronto, Ontario 🇨🇦":"Toronto, Ontario 🇨🇦",
  "J'ai testé 4 agences avant 🌍 PUBLIC-MAP — aucune comparaison possible. Ici, résultats mesurables, rapports transparents et stratégie à long terme. Mon ROI Google Ads est passé de 1.5x à 4.2x en 3 mois seulement. Absolument exceptionnel.":"I tested 4 agencies before 🌍 PUBLIC-MAP — no comparison possible. Here, measurable results, transparent reports and long-term strategy. My Google Ads ROI went from 1.5x to 4.2x in just 3 months. Absolutely exceptional.",
  "Google Ads Pro Canada":"Google Ads Pro Canada",
  "Il y a 3 semaines · Avis vérifié Google ✓":"3 weeks ago · Google verified review ✓",
  "Pierre-Antoine Moreau":"Pierre-Antoine Moreau",
  "Paris, France 🇫🇷":"Paris, France 🇫🇷",
  "Je craignais de travailler avec une agence canadienne depuis Paris. Le bureau 🌍 PUBLIC-MAP France a dissipé toutes mes craintes. Maîtrise parfaite du marché francophone européen. Résultats : +190% de leads qualifiés en 5 mois. Impressionnant.":"I was worried about working with a Canadian agency from Paris. The 🌍 PUBLIC-MAP France office dispelled all my fears. Perfect mastery of the European French-speaking market. Results: +190% qualified leads in 5 months. Impressive.",
  "Il y a 6 semaines · Avis vérifié Google ✓":"6 weeks ago · Google verified review ✓",
  "Lucie Gagnon":"Lucie Gagnon",
  "Vancouver, C.-B. 🇨🇦":"Vancouver, B.C. 🇨🇦",
  "L'audit 360° a révélé des opportunités que personne d'autre n'avait identifiées. Plan d'action clair, budgets réalistes, expert dédié et chaleureux. 🌍 PUBLIC-MAP est le partenaire idéal pour toute PME qui veut croître vite et durablement.":"The 360° audit revealed opportunities no one else had identified. Clear action plan, realistic budgets, dedicated and warm expert. 🌍 PUBLIC-MAP is the ideal partner for any SME that wants to grow fast and sustainably.",
  "Il y a 2 mois · Avis vérifié Google ✓":"2 months ago · Google verified review ✓",
  "Nicolas Blanchard":"Nicolas Blanchard",
  "Bruxelles, Belgique 🇧🇪":"Brussels, Belgium 🇧🇪",
  "La seule agence opérationnelle simultanément au Canada et en Europe que j'ai trouvée. Résultats concrets, facturation en euros, équipe francophone, conformité RGPD totale. Mon site EU est parfait et mon référencement explose. Merci 🌍 PUBLIC-MAP !":"The only agency operating simultaneously in Canada and Europe I found. Concrete results, billing in euros, French-speaking team, total GDPR compliance. My EU site is perfect and my SEO is exploding. Thanks 🌍 PUBLIC-MAP!",
  "Site Web Europe + SEO":"Website Europe + SEO",
  "Il y a 5 semaines · Avis vérifié Google ✓":"5 weeks ago · Google verified review ✓",

  // Leave a review
  "⭐ Visibilité Google":"⭐ Google Visibility",
  "Aidez-nous à gagner":"Help us gain",
  "plus de visibilité":"more visibility",
  "Un avis client réel aide PUBLIC-MAP à renforcer sa crédibilité sur Google, rassure les futurs clients et améliore la confiance autour de nos services Canada & Europe.":"A real client review helps PUBLIC-MAP strengthen its credibility on Google, reassure future clients, and improve trust around our Canada & Europe services.",
  "Meilleur référencement local":"Better local ranking",
  "Les avis réguliers aident une fiche Google Business à paraître plus active et plus fiable.":"Regular reviews help a Google Business listing look more active and more trustworthy.",
  "Preuve sociale plus forte":"Stronger social proof",
  "Un commentaire concret rassure mieux qu'une simple note étoilée.":"A concrete comment reassures better than a simple star rating.",
  "Processus simple":"Simple process",
  "Le client prépare son avis ici, puis l'envoie par courriel ou le publie sur Google.":"The client prepares the review here, then sends it by email or publishes it on Google.",
  "Laisser un commentaire":"Leave a comment",
  "Votre avis nous aide à améliorer nos services et à développer notre présence sur Google.":"Your review helps us improve our services and grow our presence on Google.",
  "Votre nom":"Your name",
  "Prénom Nom":"First Last",
  "Entreprise":"Company",
  "Nom de votre entreprise":"Your company name",
  "Email du client":"Client email",
  "client@entreprise.com":"client@company.com",
  "Service utilisé":"Service used",
  "Google Business Profile":"Google Business Profile",
  "SEO Local":"Local SEO",
  "Site Web":"Website",
  "Stratégie 360°":"360° Strategy",
  "Note":"Rating",
  "★★★★★ 5 étoiles":"★★★★★ 5 stars",
  "★★★★☆ 4 étoiles":"★★★★☆ 4 stars",
  "★★★☆☆ 3 étoiles":"★★★☆☆ 3 stars",
  "★★☆☆☆ 2 étoiles":"★★☆☆☆ 2 stars",
  "★☆☆☆☆ 1 étoile":"★☆☆☆☆ 1 star",
  "Votre commentaire":"Your comment",
  "Expliquez votre expérience, le service reçu, le résultat obtenu et ce que vous avez apprécié.":"Explain your experience, the service received, the result achieved, and what you appreciated.",
  "📩 Envoyer mon avis":"📩 Send my review",
  "🌍 Publier sur Google":"🌍 Publish on Google",
  "Les avis sont vérifiés manuellement avant publication. Le bouton Google sera activé dès que le lien Google Business Profile sera configuré.":"Reviews are manually checked before publication. The Google button will be enabled as soon as the Google Business Profile link is configured.",
  "Merci ! Votre avis a été envoyé et sera publié après validation.":"Thank you! Your review has been sent and will be published after approval.",
  "Conseil : pour booster la visibilité, l'avis le plus puissant est celui publié directement sur la fiche Google Business Profile.":"Tip: to boost visibility, the most powerful review is the one published directly on the Google Business Profile.",

  "Certifications":"Certifications",
  "Officielles":"Official",
  "Années":"Years",
  "d'Expertise":"of Expertise",
  "Avis Google":"Google Reviews",
  "Vérifiés ★ 4.9":"Verified ★ 4.9",
  "Pays":"Countries",

  // Credibility
  "🌍 PUBLIC-MAP CANADA INC.":"🌍 PUBLIC-MAP CANADA INC.",
  "Société Officiellement Enregistrée":"Officially Registered Company",
  "Corporations Canada":"Corporations Canada",
  "Registre fédéral canadien · Numéro sur demande":"Canadian federal register · Number on request",
  "INPI France / KBIS":"INPI France / KBIS",
  "Présence commerciale · SIRET disponible":"Commercial presence · SIRET available",
  "Conformité Européenne":"European Compliance",
  "RGPD · TVA intracommunautaire · e-Commerce EU":"GDPR · Intra-community VAT · EU e-Commerce",
  "Siège Social — Canada":"Head Office — Canada",
  "1000 De La Gauchetière O., Bureau 2400":"1000 De La Gauchetière W., Suite 2400",
  "Montréal, Québec H3B 4W5":"Montreal, Quebec H3B 4W5",
  "Contact : contact@public-map.com":"Contact: contact@public-map.com",
  "Bureau Europe — Paris":"Europe Office — Paris",
  "25 Rue de la Paix, 2e étage":"25 Rue de la Paix, 2nd floor",
  "75002 Paris, France":"75002 Paris, France",
  "Transparence Totale":"Total Transparency",
  "Votre sécurité,":"Your security,",
  "notre priorité":"our priority",
  "🌍 PUBLIC-MAP CANADA INC. est la seule agence de marketing digital officiellement enregistrée au Canada ET en France — vérifiable publiquement en quelques clics.":"🌍 PUBLIC-MAP CANADA INC. is the only digital marketing agency officially registered in both Canada AND France — publicly verifiable in just a few clicks.",
  "🔒 Aucune donnée bancaire":"🔒 No banking data",
  "🛡️ ISO 27001":"🛡️ ISO 27001",
  "📋 RGPD Compliant":"📋 GDPR Compliant",
  "📋 Devis détaillé":"📋 Detailed quote",
  "⭐ 4.9/5 Google":"⭐ 4.9/5 Google",
  "✅ Société Vérifiable":"✅ Verifiable Company",
  "🌍 18 Pays Desservis":"🌍 18 Countries Served",
  "Demander un devis →":"Request a quote →",
  "Vérifiez notre enregistrement sur corporations.canada.ca":"Verify our registration on corporations.canada.ca",

  // Certifications
  "Certifications Officielles":"Official Certifications",
  "Notre expertise,":"Our expertise,",
  "certifiée et reconnue":"certified and recognized",
  "🌍 PUBLIC-MAP CANADA INC. détient des certifications officielles délivrées par Google et les plus grandes autorités du SEO mondial. Chaque certification est le résultat d'examens rigoureux et d'une expertise terrain prouvée.":"🌍 PUBLIC-MAP CANADA INC. holds official certifications issued by Google and leading global SEO authorities. Every certification reflects rigorous exams and proven field expertise.",
  "Nos Certifications":"Our Certifications",
  "Digital Marketing Master Licensed":"Digital Marketing Master Licensed",
  "CSS3 Developer Certification":"CSS3 Developer Certification",
  "HTML5 Developer Certification":"HTML5 Developer Certification",
  "SEO for Growth Certified Consultant":"SEO for Growth Certified Consultant",
  "Google Certification":"Google Certification",
  "Certification officielle Google":"Official Google Certification",
  "Marketing Platform":"Marketing Platform",
  "Local SEO Certified":"Local SEO Certified",
  "Certification individuelle":"Individual certification",
  "SEO Local — Expert vérifié":"Local SEO — Verified Expert",
  "SEO Expert Certification":"SEO Expert Certification",
  "Search Engine Optimization":"Search Engine Optimization",
  "Expert — Certified Professional":"Expert — Certified Professional",

  // FAQ
  "🛡️ Confiance & Transparence":"🛡️ Trust & Transparency",
  "Questions fréquentes —":"FAQ —",
  "Toutes les réponses":"All the answers",
  "Nous répondons à chaque doute avec transparence et précision.":"We answer every doubt with transparency and precision.",
  "🤔 🌍 PUBLIC-MAP est-elle une vraie entreprise enregistrée ?":"🤔 Is 🌍 PUBLIC-MAP a real registered company?",
  "Oui, à 100%.":"Yes, 100%.",
  "Consultable sur corporations.canada.ca (Canada) et via l'INPI en France. Notre numéro d'entreprise est communiqué sur simple demande. Zéro opacité.":"Searchable on corporations.canada.ca (Canada) and via INPI in France. Our business number is provided on simple request. Zero opacity.",
  "📋 Comment recevoir mon devis ?":"📋 How do I receive my quote?",
  "Aucune donnée bancaire n'est demandée.":"No banking data is requested.",
  "Choisissez votre service, préparez votre courriel et envoyez votre demande depuis votre propre messagerie. Notre équipe vous recontacte pour confirmer le périmètre et les modalités.":"Choose your service, prepare your email and send your request from your own mailbox. Our team will contact you to confirm scope and terms.",
  "📈 Quelle garantie si je ne vois pas de résultats ?":"📈 What guarantee if I see no results?",
  "Garantie résultats 90 jours":"90-day results guarantee",
  "sur le Pack SEO. Objectifs non atteints = remboursement intégral, sans question. Rapport de performance trimestriel transparent pour chaque service.":"on the SEO Pack. Targets not met = full refund, no questions. Transparent quarterly performance report for every service.",
  "🇪🇺 Je suis en Europe — comment ça fonctionne ?":"🇪🇺 I'm in Europe — how does it work?",
  "Notre bureau Paris":"Our Paris office",
  "assure le suivi en heure européenne. Facturation en euros, contrats conformes RGPD, équipe francophone dédiée. Identique à une agence locale parisienne.":"handles follow-up in European time. Billing in euros, GDPR-compliant contracts, dedicated French-speaking team. Identical to a local Paris agency.",
  "🔒 Puis-je annuler à tout moment ?":"🔒 Can I cancel at any time?",
  "Oui, 30 jours de préavis suffit.":"Yes, 30 days notice is enough.",
  "Aucun engagement longue durée, aucune pénalité. Pour les projets uniques : 30% d'acompte au démarrage, solde à la livraison validée.":"No long-term commitment, no penalty. For one-off projects: 30% deposit at start, balance on validated delivery.",
  "⏱️ En combien de temps verrai-je des résultats ?":"⏱️ How long until I see results?",
  "SEO :":"SEO:",
  "4-8 semaines premiers signaux, 3-6 mois résultats majeurs.":"4-8 weeks first signals, 3-6 months major results.",
  "Google Ads :":"Google Ads:",
  "dès 72h.":"from 72h.",
  "Réseaux Sociaux :":"Social Networks:",
  "croissance mesurable dès la 2e semaine. Dashboard temps réel inclus.":"measurable growth from week 2. Real-time dashboard included.",
  "🏆 Comment vérifier vos certifications Google ?":"🏆 How to verify your Google certifications?",
  "Recherchez \"🌍 PUBLIC-MAP CANADA\" sur":"Search \"🌍 PUBLIC-MAP CANADA\" on",
  ". Les autres accréditations techniques sont vérifiables sur demande. Liens envoyés sous 10 minutes.":". Other technical accreditations are verifiable on request. Links sent within 10 minutes.",
  "📞 Qui sera mon interlocuteur dédié ?":"📞 Who will be my dedicated contact?",
  "Un Chef de Projet dédié":"A dedicated Project Manager",
  "— joignable par email et formulaire sécurisé. Réponse garantie sous 2h. Pas de centre d'appels, pas de robot.":"— reachable by email and secure form. Response guaranteed within 2h. No call center, no bot.",

  // Quote request
  "Parlons de votre":"Let's discuss your",
  "projet":"project",
  "Choisissez votre service et préparez votre demande. Après validation du devis, le paiement sécurisé se fera via Lemon Squeezy.":"Choose your service and prepare your request. After quote approval, secure payment will be handled via Lemon Squeezy.",
  "Site Web":"Website",
  "Réseaux Sociaux":"Social Media",
  "Aucune donnée bancaire":"No banking data",
  "Échange humain":"Human support",
  "Réponse sous 2h":"Reply within 2h",
  "🍋 Paiement Lemon Squeezy":"🍋 Lemon Squeezy payment",
  "🍋 Préparer votre demande":"🍋 Prepare your request",
  "LEMON SQUEEZY":"LEMON SQUEEZY",
  "Votre courriel":"Your email",
  "Votre nom":"Your name",
  "Entreprise":"Company",
  "Téléphone":"Phone",
  "Votre numéro":"Your number",
  "Envoyer ma demande par courriel →":"Email my request →",
  "🔒 Paiement sécurisé via Lemon Squeezy":"🔒 Secure payment via Lemon Squeezy",
  "Lien envoyé après validation du devis":"Link sent after quote approval",

  // Newsletter
  "Rejoignez 1 000 000+":"Join 1,000,000+",
  "abonnés professionnels":"professional subscribers",
  "Conseils exclusifs marketing digital, tendances Canada & Europe, offres membres réservées.":"Exclusive digital marketing tips, Canada & Europe trends, members-only offers.",
  "S'inscrire →":"Subscribe →",
  "Désinscription libre · RGPD & LPRPDE compliant":"Free unsubscribe · GDPR & PIPEDA compliant",

  // Footer
  "Solution pour développer votre visibilité locale":"Solution for growing your local visibility",
  "Montréal, Canada":"Montreal, Canada",
  "Paris, France":"Paris, France",
  "Bureaux CA + Europe":"CA + Europe offices",
  "Ouvert : Lundi à Vendredi 09H - 17H":"Open: Monday to Friday 09:00 - 17:00",
  "Copyright © 2026 PUBLIC-MAP CANADA INC. Tous droits réservés.":"Copyright © 2026 PUBLIC-MAP CANADA INC. All rights reserved.",
  "SEO & Référencement":"SEO & Search",
  "E-Commerce":"E-Commerce",
  "Stratégie 360°":"360° Strategy",
  "Entreprise":"Company",
  "À propos":"About",
  "Notre équipe":"Our team",
  "Blog":"Blog",
  "Carrières":"Careers",
  "Presse":"Press",
  "Légal":"Legal",
  "Mentions légales":"Legal notices",
  "CGV / CGU":"Terms of Service",
  "Politique RGPD":"GDPR Policy",
  "Cookies":"Cookies",
  "Remboursements":"Refunds",
  "© 2026":"© 2026",
  "— Tous droits réservés · Enregistrée au Canada · Présence Europe":"— All rights reserved · Registered in Canada · Europe presence",
  "Confidentialité":"Privacy",
  "CGV":"Terms",

  // Maps section
  "📍 Google Maps Business":"📍 Google Maps Business",
  "Placez votre entreprise":"Put your business",
  "sur la carte":"on the map",
  "Permettez à vos potentiels clients de retrouver votre entreprise en ligne — sur Google Maps, Apple Plans et Bing Maps simultanément.":"Let your potential customers find your business online — on Google Maps, Apple Maps and Bing Maps simultaneously.",
  "📍 Montréal":"📍 Montreal",
  "📍 Paris":"📍 Paris",
  "📍 Toronto":"📍 Toronto",
  "Google Maps":"Google Maps",
  "Fiche optimisée pour apparaître sur Google Maps lors d'une recherche locale.":"Optimized listing to appear on Google Maps during local searches.",
  "Apple Plans":"Apple Maps",
  "Présence simultanée sur Apple Maps pour tous les utilisateurs iOS et Mac.":"Simultaneous presence on Apple Maps for all iOS and Mac users.",
  "Statistiques en direct":"Live Statistics",
  "Vues, recherches, itinéraires demandés — tout est traqué et optimisé.":"Views, searches, directions requested — everything is tracked and optimized.",
  "Géo-ciblage SEO":"SEO Geo-targeting",
  "Mots-clés géolocalisés pour dominer votre quartier, ville et région.":"Geolocated keywords to dominate your neighborhood, city and region.",

  // Contact block
  "Contactez-":"Contact",
  "nous":"us",
  "Veuillez contacter notre service technique par mail. Réponse rapide assurée. Permettez-nous de rester en contact avec vous et de répondre à vos questions.":"Please contact our technical service by email. Quick response guaranteed. Let us stay in touch with you and answer your questions.",
  "Email":"Email",
  "Support client":"Client support",
  "Réponse par email sous 2h":"Reply by email within 2h",
  "Demande de devis":"Quote request",
  "Formulaire sécurisé sans téléphone public":"Secure form with no public phone number",
  "Support par email":"Email support",
  "Réponse sous 2h ouvrées":"Reply within 2 business hours",
  "Assistance":"Support",

  // Modal
  "Fermer":"Close",
  "Service":"Service",
  "Zone Canada 🇨🇦":"Canada Zone 🇨🇦",
  "Envoyer ma demande par courriel":"Email my request",
  "🔒 Paiement Lemon Squeezy sécurisé":"🔒 Secure Lemon Squeezy payment",
  "Devis sans engagement":"No-obligation quote"
};

let CURRENT_LANG = 'fr';
const ORIGINAL_TEXT = new WeakMap();

function walkAndTranslate(targetLang){
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node){
      if(!node.parentElement) return NodeFilter.FILTER_REJECT;
      const tag = node.parentElement.tagName;
      if(tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
      if(node.parentElement.closest('#lang-toggle')) return NodeFilter.FILTER_REJECT;
      const txt = node.nodeValue.trim();
      if(!txt) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  let n;
  while((n = walker.nextNode())) nodes.push(n);

  nodes.forEach(node => {
    if(!ORIGINAL_TEXT.has(node)){
      ORIGINAL_TEXT.set(node, node.nodeValue);
    }
    const original = ORIGINAL_TEXT.get(node);
    const trimmed = original.trim();
    if(targetLang === 'en' && T[trimmed]){
      node.nodeValue = original.replace(trimmed, T[trimmed]);
    } else {
      node.nodeValue = original;
    }
  });

  // Translate placeholders, alt, title, value attributes
  document.querySelectorAll('[placeholder]').forEach(el => {
    if(!el.dataset.origPlaceholder) el.dataset.origPlaceholder = el.placeholder;
    const orig = el.dataset.origPlaceholder.trim();
    el.placeholder = (targetLang === 'en' && T[orig]) ? T[orig] : el.dataset.origPlaceholder;
  });
  document.querySelectorAll('button, input[type=submit]').forEach(el => {
    if(el.tagName === 'INPUT' && el.value){
      if(!el.dataset.origValue) el.dataset.origValue = el.value;
      const o = el.dataset.origValue.trim();
      el.value = (targetLang === 'en' && T[o]) ? T[o] : el.dataset.origValue;
    }
  });

  // Update <title>
  if(targetLang === 'en') document.title = T["🌍 PUBLIC-MAP CANADA INC. — La Référence du Marketing Digital"] || document.title;
  else document.title = "🌍 PUBLIC-MAP CANADA INC. — La Référence du Marketing Digital";

  document.documentElement.lang = targetLang;
  CURRENT_LANG = targetLang;
  localStorage.setItem('digitalnova-lang', targetLang);
}

function setLang(lang){
  walkAndTranslate(lang);
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
  document.dispatchEvent(new CustomEvent('digitalnova:language-updated'));
}
// EXPOSE globally for inline onclick to work on all devices (mobile included)
window.setLang = setLang;

// Inject language toggle into nav
window.addEventListener('DOMContentLoaded', () => {
  const navRight = document.querySelector('.nav-right');
  if(navRight){
    const toggle = document.createElement('div');
    toggle.id = 'lang-toggle';
    toggle.style.cssText = 'display:flex;background:rgba(255,255,255,.08);border-radius:24px;padding:3px;border:1px solid rgba(255,255,255,.1);margin-right:8px;';
    toggle.innerHTML = `
      <button class="lang-btn active" data-lang="fr" onclick="setLang('fr')" style="padding:6px 12px;border-radius:20px;border:none;background:var(--rouge);color:#fff;font-family:'Outfit',sans-serif;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.08em;">FR</button>
      <button class="lang-btn" data-lang="en" onclick="setLang('en')" style="padding:6px 12px;border-radius:20px;border:none;background:transparent;color:rgba(255,255,255,.5);font-family:'Outfit',sans-serif;font-size:11px;font-weight:700;cursor:pointer;letter-spacing:.08em;">EN</button>
    `;
    navRight.insertBefore(toggle, navRight.firstChild);

    // Style for active state
    const style = document.createElement('style');
    style.textContent = `
      .lang-btn{transition:all .25s;}
      .lang-btn.active{background:var(--rouge)!important;color:#fff!important;box-shadow:0 4px 14px rgba(213,43,30,.4);}
      body.eu-active .lang-btn.active{background:var(--bleu-eu)!important;box-shadow:0 4px 14px rgba(0,51,153,.4);}
    `;
    document.head.appendChild(style);
  }

  // Restore saved language
  const saved = localStorage.getItem('digitalnova-lang');
  if(saved === 'en') setLang('en');
});
