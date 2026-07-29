/**
 * `/developers` — the public developer portal (Stage 1: static docs +
 * rendered OpenAPI reference only; no Console/Playground/SDKs yet — see
 * the architecture plan). Grows across many future stages the same way
 * `integrations.ts` grows across its stages: every stage's copy lives
 * under this one domain key, added incrementally as each stage ships.
 * Technical facts here (scopes, error codes, plan limits, header names)
 * must always match the real source of truth (lib/api-v1/*, lib/billing/
 * api-limits.ts, lib/integrations/governance.ts) — never invent a
 * capability that doesn't exist yet.
 */
export const developers = {
  fr: {
    meta: {
      title: "PUBLIC-MAP for Developers",
      description: "Documentation, référence OpenAPI et guides pour intégrer l'API publique PUBLIC-MAP.",
    },
    header: {
      brand: "PUBLIC-MAP",
      brandSuffix: "Developers",
      nav: { docs: "Documentation", reference: "Référence API", roadmap: "Roadmap", security: "Sécurité" },
      console: "Console",
      soonBadge: "Bientôt",
      backToApp: "Retour à l'application",
    },
    footer: {
      tagline: "L'API publique de PUBLIC-MAP — pour n8n, Make, Zapier, Airtable, vos applications internes et tout client HTTP standard.",
      columns: {
        documentation: { title: "Documentation", quickstart: "Quick Start", authentication: "Authentification", errors: "Erreurs fréquentes", faq: "FAQ" },
        api: { title: "API", reference: "Référence OpenAPI", rateLimits: "Limites & quotas", security: "Sécurité" },
        project: { title: "Projet", roadmap: "Roadmap publique", changelog: "Changelog", versioning: "Versionnement & dépréciation" },
      },
      copyright: (year: number) => `© ${year} PUBLIC-MAP. Tous droits réservés.`,
    },
    landing: {
      eyebrow: "API publique",
      title: "Construisez sur PUBLIC-MAP",
      subtitle:
        "Une API REST simple, versionnée et sécurisée pour connecter PUBLIC-MAP à n8n, Make, Zapier, Airtable, Retool, Bubble, vos applications internes ou tout client HTTP standard.",
      ctaPrimary: "Commencer avec le Quick Start",
      ctaSecondary: "Explorer la référence API",
      features: [
        {
          title: "Authentification par clé API",
          description: "Une clé par intégration, des permissions explicites (scopes), révocable et expirable à tout moment.",
        },
        {
          title: "Isolation stricte par organisation",
          description: "Chaque requête est automatiquement limitée aux données de votre organisation — jamais celles d'une autre.",
        },
        {
          title: "Idempotence intégrée",
          description: "Un en-tête Idempotency-Key sur les routes d'écriture pour retenter une requête en toute sécurité.",
        },
        {
          title: "Limites transparentes",
          description: "Des en-têtes X-RateLimit-* et X-Quota-* sur chaque réponse pour toujours savoir où vous en êtes.",
        },
      ],
      quickLinksTitle: "Pour commencer",
      quickLinks: {
        quickstart: { title: "Quick Start", description: "Votre première requête en moins de 5 minutes." },
        reference: { title: "Référence API", description: "La spécification OpenAPI complète, interactive." },
        authentication: { title: "Authentification", description: "Comment créer et utiliser une clé API." },
      },
      statusNote:
        "Ce portail est en construction progressive. Les SDK, les collections Postman/Bruno/Insomnia, la Console développeur en self-service (clés API, webhooks) et les templates n8n/Make/Airtable/Zapier sont maintenant disponibles — voir la roadmap pour la suite.",
    },
    docsNav: {
      guidesGroup: "Guides",
      guides: {
        quickstart: "Quick Start",
        authentication: "Authentification",
        pagination: "Pagination & filtres",
        idempotency: "Idempotence",
        rateLimits: "Limites & quotas",
        errors: "Erreurs fréquentes",
        faq: "FAQ",
        sdkUsage: "Utilisation des SDK",
        examples: "Exemples de code",
        webhooks: "Webhooks",
      },
      resourcesGroup: "Ressources",
      resources: {
        sdk: "SDK",
        collections: "Collections API",
        console: "Console développeur",
        n8nTemplates: "Templates n8n",
        makeScenarios: "Scénarios Make",
        airtableScripts: "Scripts Airtable",
        zapierApp: "Intégration Zapier",
      },
      policiesGroup: "Politiques",
      policies: {
        versioning: "Versionnement & dépréciation",
        changelog: "Changelog",
        oauth: "OAuth (conception future)",
      },
      designNotesGroup: "Notes de conception",
      designNotes: {
        eventCatalog: "Catalogue d'événements",
      },
      soonGroup: "À venir",
      soon: {
        explorer: "API Explorer",
        templates: "Templates Zapier",
        marketplace: "Marketplace d'intégrations",
      },
    },
    docsIndex: {
      title: "Documentation",
      subtitle: "Guides pratiques pour intégrer l'API publique PUBLIC-MAP.",
      cards: {
        quickstart: { title: "Quick Start", description: "Créez une clé, faites votre première requête, lisez la réponse." },
        authentication: { title: "Authentification", description: "Format des clés, en-têtes acceptés, scopes disponibles." },
        pagination: { title: "Pagination & filtres", description: "Curseur, limite, dates, recherche." },
        idempotency: { title: "Idempotence", description: "Retentez une requête d'écriture sans créer de doublon." },
        rateLimits: { title: "Limites & quotas", description: "Requêtes par minute, quota journalier, en-têtes de suivi." },
        errors: { title: "Erreurs fréquentes", description: "Tous les codes d'erreur, leur statut HTTP, comment les corriger." },
        faq: { title: "FAQ", description: "Questions fréquemment posées par les intégrateurs." },
        sdkUsage: { title: "Utilisation des SDK", description: "Installer, initialiser et utiliser les SDK officiels." },
        examples: { title: "Exemples de code", description: "curl, JavaScript, TypeScript et Python côte à côte." },
        webhooks: { title: "Webhooks", description: "Comment fonctionnent les événements sortants — gestion en self-service disponible dans la Console." },
      },
    },
    quickstart: {
      title: "Quick Start",
      subtitle: "De zéro à votre première requête réussie.",
      steps: {
        step1: {
          title: "1. Obtenez une clé API",
          body: "Créez votre clé API en libre-service depuis la Console développeur (lien « Console » en haut de cette page) : choisissez les scopes (permissions) dont vous avez besoin, et la clé est générée immédiatement pour votre organisation.",
          note: "La clé n'est affichée qu'une seule fois à sa création — conservez-la immédiatement dans un gestionnaire de secrets.",
        },
        step2: {
          title: "2. Faites votre première requête",
          body: "Toute requête à /api/v1 doit porter la clé dans l'en-tête Authorization. Un appel à /api/v1/ping ne nécessite aucun scope particulier et confirme que l'authentification fonctionne.",
        },
        step3: {
          title: "3. Lisez la réponse",
          body: "Chaque réponse JSON a la forme {\"data\": ...}. Chaque réponse — succès ou erreur — porte un en-tête X-Request-Id à fournir si vous nous contactez au sujet d'une requête précise.",
        },
        step4: {
          title: "4. Essayez une route réelle",
          body: "Avec le scope audits:read, listez les audits de votre organisation. Les résultats sont paginés par curseur — voir le guide Pagination & filtres.",
        },
        step5: {
          title: "5. Suite",
          body: "Consultez Authentification pour le détail des scopes, Limites & quotas pour éviter les 429, et Erreurs fréquentes pour interpréter les réponses en échec.",
        },
      },
      curl: {
        ping: 'curl https://app.public-map.com/api/v1/ping \\\n  -H "Authorization: Bearer pm_live_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
        pingResponse: '{\n  "data": {\n    "pong": true,\n    "organizationId": "…",\n    "scopes": ["audits:read"]\n  }\n}',
        audits: 'curl "https://app.public-map.com/api/v1/audits?limit=5" \\\n  -H "Authorization: Bearer pm_live_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
      },
    },
    authentication: {
      title: "Authentification",
      subtitle: "Comment PUBLIC-MAP vérifie chaque requête à /api/v1.",
      sections: {
        headers: {
          title: "En-têtes acceptés",
          body: "Deux en-têtes sont acceptés pour présenter votre clé ; Authorization: Bearer est prioritaire si les deux sont fournis.",
          rows: [
            { name: "Authorization: Bearer <clé>", description: "Méthode recommandée." },
            { name: "X-Api-Key: <clé>", description: "Solution de repli pour les outils qui ne permettent pas de personnaliser l'en-tête Authorization (certains outils no-code)." },
          ],
        },
        format: {
          title: "Format de la clé",
          body: "pm_{environnement}_{identifiant}_{secret} — l'environnement est live ou test. Le préfixe (pm_live_… ou pm_test_…, jusqu'à l'identifiant) n'est pas secret et peut apparaître dans vos journaux ; le secret qui suit ne doit jamais être journalisé ni committé.",
        },
        scopes: {
          title: "Scopes (permissions)",
          body: "Chaque clé porte une liste explicite de scopes. Une requête sur une route nécessitant un scope que la clé ne possède pas reçoit une erreur FORBIDDEN_SCOPE (403).",
          rows: [
            { scope: "audits:read", description: "Lecture des audits (GET /audits, GET /audits/:id)." },
            { scope: "reports:read", description: "Lecture des rapports (GET /reports, GET /reports/:id)." },
            { scope: "clients:read", description: "Lecture des clients CRM (GET /clients, GET /clients/:id)." },
            { scope: "clients:update", description: "Modification d'un client (PATCH /clients/:id)." },
            { scope: "tasks:create", description: "Création de tâches (POST /tasks)." },
            { scope: "interactions:create", description: "Création d'interactions (POST /interactions)." },
          ],
        },
        isolation: {
          title: "Isolation par organisation",
          body: "L'organisation associée à une requête est toujours dérivée de la clé elle-même, jamais d'un paramètre fourni par l'appelant. Aucune donnée d'une autre organisation n'est jamais accessible, quel que soit l'identifiant demandé.",
        },
        lifecycle: {
          title: "Cycle de vie d'une clé",
          body: "Une clé peut être active, révoquée ou expirée. Une clé révoquée ou expirée est rejetée immédiatement (API_KEY_REVOKED ou API_KEY_EXPIRED, 401), même si le secret présenté est correct.",
        },
      },
    },
    pagination: {
      title: "Pagination & filtres",
      subtitle: "Les listes (GET /audits, /reports, /clients) sont paginées par curseur, pas par numéro de page.",
      sections: {
        cursor: {
          title: "Curseur",
          body: "Chaque page renvoie pagination.nextCursor. Passez-le tel quel comme paramètre cursor pour obtenir la page suivante. nextCursor vaut null sur la dernière page. Le curseur est opaque — ne pas tenter de le décoder ou de le construire soi-même.",
        },
        limit: {
          title: "Taille de page",
          body: "Paramètre limit, entre 1 et 100, 20 par défaut. Une valeur hors de cet intervalle est rejetée avec VALIDATION_ERROR (400).",
        },
        filters: {
          title: "Filtres disponibles",
          rows: [
            { name: "from / to", description: "Bornes ISO 8601 sur la date de création." },
            { name: "q", description: "Recherche texte (résumé d'audit, ou nom/contact/email pour les clients)." },
            { name: "stage", description: "Sur GET /clients uniquement : lead, prospect, client ou churned." },
          ],
        },
      },
    },
    idempotency: {
      title: "Idempotence",
      subtitle: "Retentez une requête d'écriture (POST /tasks, POST /interactions) sans risquer de créer un doublon.",
      sections: {
        howItWorks: {
          title: "Fonctionnement",
          body: "Fournissez un en-tête Idempotency-Key sur votre requête. Une répétition avec la même clé et le même corps renvoie exactement la même ressource (même statut, même contenu) sans en créer une nouvelle. Une répétition avec la même clé mais un corps différent est rejetée avec IDEMPOTENCY_KEY_CONFLICT (409) — jamais fusionnée ni écrasée silencieusement.",
        },
        scope: {
          title: "Portée",
          body: "Une clé d'idempotence est propre à votre intégration et à la route appelée : la même chaîne utilisée sur deux routes différentes n'entre jamais en collision.",
        },
        recommendation: {
          title: "Recommandation",
          body: "Optionnel mais fortement recommandé pour toute requête d'écriture déclenchée automatiquement (workflow n8n/Make/Zapier, retry applicatif) — une clé stable par événement métier (ex. un identifiant de ligne source) protège contre les doubles envois.",
        },
      },
    },
    rateLimits: {
      title: "Limites & quotas",
      subtitle: "Deux limites indépendantes protègent l'API — l'une par clé, l'autre par organisation.",
      sections: {
        perMinute: {
          title: "Débit par minute (par clé API)",
          body: "Une clé qui dépasse son budget par minute reçoit RATE_LIMITED (429) avec un en-tête Retry-After indiquant le délai avant réessai. Ce budget protège contre une clé isolée qui enverrait trop de requêtes trop vite — il est indépendant du palier d'abonnement.",
        },
        perDay: {
          title: "Quota journalier (par organisation)",
          body: "Cumulé sur toutes les clés API de votre organisation. Au-delà, QUOTA_EXCEEDED (429). Le quota dépend du palier d'abonnement de votre organisation.",
        },
        headers: {
          title: "En-têtes de suivi",
          body: "Présents sur chaque réponse, succès ou erreur — vous n'avez jamais besoin d'un appel séparé pour connaître votre consommation.",
          rows: [
            { name: "X-RateLimit-Limit / -Remaining / -Reset", description: "Budget par minute — restant et horodatage Unix de réinitialisation." },
            { name: "X-Quota-Limit / -Remaining / -Reset", description: "Quota journalier — restant et horodatage Unix de réinitialisation." },
            { name: "Retry-After", description: "Présent uniquement sur une réponse 429 — secondes à attendre avant de réessayer." },
          ],
        },
        plans: {
          title: "Limites par palier",
          body: "Une organisation sans abonnement actif (ou en past_due/canceled) reste utilisable avec un palier gratuit limité.",
          rows: [
            { plan: "Free (implicite)", perMinute: "30 requêtes/min", perDay: "1 000 requêtes/jour" },
            { plan: "Starter", perMinute: "60 requêtes/min", perDay: "5 000 requêtes/jour" },
            { plan: "Pro", perMinute: "120 requêtes/min", perDay: "20 000 requêtes/jour" },
            { plan: "Agency", perMinute: "300 requêtes/min", perDay: "100 000 requêtes/jour" },
          ],
        },
      },
    },
    errors: {
      title: "Erreurs fréquentes",
      subtitle: "Toute erreur suit la même forme : {\"error\": {\"code\", \"message\", \"requestId\"}}.",
      intro:
        "Le code est stable et prévu pour être testé par votre intégration (if (error.code === \"...\")) ; le message est destiné à un humain et peut évoluer ; requestId identifie la requête si vous contactez le support.",
      columns: { code: "Code", status: "Statut HTTP", meaning: "Signification" },
      rows: [
        { code: "MISSING_API_KEY", status: "401", meaning: "Aucune clé fournie (ni Authorization: Bearer, ni X-Api-Key)." },
        { code: "MALFORMED_API_KEY", status: "401", meaning: "La clé fournie n'a pas le format attendu." },
        { code: "INVALID_API_KEY", status: "401", meaning: "Clé introuvable ou secret incorrect." },
        { code: "API_KEY_REVOKED", status: "401", meaning: "Cette clé a été révoquée." },
        { code: "API_KEY_EXPIRED", status: "401", meaning: "Cette clé a expiré." },
        { code: "INTEGRATION_INACTIVE", status: "401", meaning: "L'intégration propriétaire de la clé n'est plus active." },
        { code: "INTEGRATION_EXPIRED", status: "401", meaning: "L'intégration propriétaire de la clé a expiré." },
        { code: "FORBIDDEN_SCOPE", status: "403", meaning: "La clé ne porte pas le scope requis par cette route." },
        { code: "SERVICE_NOT_CONFIGURED", status: "503", meaning: "L'API n'est pas configurée sur cet environnement (ne devrait jamais survenir en production)." },
        { code: "VALIDATION_ERROR", status: "400", meaning: "Paramètre ou corps de requête invalide — voir message pour le détail." },
        { code: "NOT_FOUND", status: "404", meaning: "Ressource inexistante, ou appartenant à une autre organisation (volontairement indiscernable)." },
        { code: "IDEMPOTENCY_KEY_CONFLICT", status: "409", meaning: "Idempotency-Key déjà utilisée avec un corps de requête différent." },
        { code: "RATE_LIMITED", status: "429", meaning: "Débit par minute dépassé — voir Retry-After." },
        { code: "QUOTA_EXCEEDED", status: "429", meaning: "Quota journalier de l'organisation dépassé — voir Retry-After." },
        { code: "INTERNAL_ERROR", status: "500", meaning: "Erreur inattendue côté serveur — aucun détail interne n'est jamais inclus." },
      ],
    },
    faq: {
      title: "FAQ",
      subtitle: "Questions fréquemment posées par les intégrateurs.",
      items: [
        {
          q: "L'API est-elle versionnée ?",
          a: "Oui — le préfixe /api/v1 est stable. Une future /api/v2 ne remplacera jamais /api/v1 sans période de transition annoncée (voir la Roadmap).",
        },
        {
          q: "Existe-t-il un environnement de test ?",
          a: "Le format de clé distingue déjà pm_live_… et pm_test_…. Un vrai bac à sable public (avec données de démonstration) fait partie des prochaines étapes.",
        },
        {
          q: "Puis-je créer/gérer mes clés moi-même ?",
          a: "Oui — la Console développeur (lien « Console » en haut de cette page) permet de créer, renommer, faire pivoter et révoquer vos clés en libre-service, sans passer par un administrateur PUBLIC-MAP.",
        },
        {
          q: "Proposez-vous des SDK officiels ?",
          a: "Pas encore — TypeScript/JavaScript et Python sont prévus dans une prochaine étape, générés depuis la spécification OpenAPI publiée sur ce portail.",
        },
        {
          q: "Puis-je recevoir des événements en temps réel (webhooks) ?",
          a: "Oui — créez et gérez vos endpoints webhooks en self-service depuis la Console (créer un endpoint, choisir les événements, consulter l'historique des livraisons), avec vérification de signature HMAC-SHA256. Voir le guide Webhooks.",
        },
        {
          q: "Quelles méthodes HTTP sont supportées ?",
          a: "GET pour la lecture, POST pour la création (tâches, interactions), PATCH pour la mise à jour partielle d'un client. Aucune méthode DELETE n'est exposée aujourd'hui.",
        },
        {
          q: "Comment signaler un problème de sécurité ?",
          a: "Contactez votre interlocuteur PUBLIC-MAP directement — voir la page Sécurité pour le détail du modèle de sécurité de l'API.",
        },
      ],
    },
    reference: {
      title: "Référence API",
      subtitle: "La spécification OpenAPI 3.1 complète de /api/v1 — interactive, toujours synchronisée avec l'implémentation.",
      openLabel: "Ouvrir la référence interactive",
      specLinkLabel: "Télécharger la spécification (YAML)",
      specJsonLinkLabel: "Télécharger la spécification (JSON)",
      note: "La référence s'ouvre en plein écran pour une lecture confortable ; utilisez le lien « Retour » qu'elle affiche pour revenir au portail.",
    },
    sdkUsage: {
      title: "Utilisation des SDK",
      subtitle: "Comment installer, initialiser et utiliser les SDK officiels TypeScript/JavaScript et Python.",
      sections: {
        intro: {
          title: "Un seul package TypeScript/JavaScript",
          body: "Le SDK @public-map/sdk sert à la fois les projets TypeScript (types générés depuis la spécification OpenAPI) et JavaScript (le même package, compilé, sans étape de build nécessaire). Le SDK Python (public-map-sdk) est un package distinct, avec ses propres modèles typés.",
        },
        sourceOfTruth: {
          title: "Généré depuis l'OpenAPI (TypeScript)",
          body: "Les types de requête/réponse du SDK TypeScript sont générés automatiquement depuis lib/api-v1/openapi.yaml (via openapi-typescript) — jamais dupliqués à la main. Le SDK Python, lui, maintient ses modèles manuellement pour cette première version ; voir son README pour le détail de cette asymétrie assumée.",
        },
        install: {
          title: "Installation",
          body: "Les deux SDK sont en pré-publication (0.1.0) — pas encore publiés sur npm/PyPI. Les commandes ci-dessous sont celles qui fonctionneront une fois la publication faite.",
        },
        initialize: { title: "Initialisation" },
        errorHandling: {
          title: "Gestion des erreurs",
          body: "Chaque SDK expose une classe d'erreur dédiée (PublicMapApiError) avec les mêmes champs que le guide Erreurs fréquentes : code, message, un identifiant de requête, et — pour les 429 — un délai avant réessai.",
        },
        pagination: {
          title: "Pagination",
          body: "Chaque SDK expose un utilitaire paginate() qui parcourt automatiquement toutes les pages d'une liste, curseur par curseur — voir le guide Pagination & filtres pour le fonctionnement du curseur lui-même.",
        },
      },
    },
    examples: {
      title: "Exemples de code",
      subtitle: "Les mêmes opérations courantes en curl, JavaScript, TypeScript et Python.",
      tabs: { curl: "curl", javascript: "JavaScript", typescript: "TypeScript", python: "Python" },
      scenarios: {
        ping: { title: "Vérifier une clé API" },
        listAudits: { title: "Lister les audits (pagination)" },
        createTask: { title: "Créer une tâche (idempotence)" },
        handleError: { title: "Gérer une erreur 429" },
      },
    },
    webhooksGuide: {
      title: "Webhooks",
      subtitle: "Comment PUBLIC-MAP notifie vos systèmes d'un événement — vue d'ensemble.",
      selfServiceNotice: "La gestion complète en self-service de vos endpoints (créer un endpoint, choisir les événements, consulter l'historique des livraisons) est disponible dans la Console, ainsi que le test ad-hoc de webhooks et la vérification de signature (Outils Webhooks, lien ci-dessous). Cette page décrit le fonctionnement général du système.",
      consoleToolsLink: "Ouvrir les Outils Webhooks de la Console →",
      sections: {
        overview: {
          title: "Principe",
          body: "Un webhook est une notification HTTP POST envoyée par PUBLIC-MAP vers une URL que vous contrôlez, dès qu'un événement pertinent se produit — plutôt que d'interroger l'API en boucle pour détecter un changement.",
        },
        signing: {
          title: "Signature",
          body: "Chaque livraison est signée par HMAC-SHA256 avec un secret propre à votre endpoint, pour que vous puissiez vérifier que la requête provient bien de PUBLIC-MAP avant de la traiter. Le détail exact des en-têtes de signature sera publié avec la gestion en self-service.",
        },
        retry: {
          title: "Nouvelle tentative automatique",
          body: "Une livraison qui échoue (endpoint indisponible, erreur serveur) est retentée automatiquement selon un plan de délais croissants, jusqu'à un nombre maximal de tentatives, avant d'être marquée abandonnée.",
        },
        history: {
          title: "Historique",
          body: "Chaque tentative de livraison est journalisée (statut, code de réponse, durée) — consultable aujourd'hui par le personnel PUBLIC-MAP, bientôt directement par vous en self-service.",
        },
      },
    },
    sdkPage: {
      title: "SDK officiels",
      subtitle: "TypeScript, JavaScript et Python — générés et testés à partir de la même spécification OpenAPI.",
      preReleaseNotice: "Pré-publication (0.1.0) — pas encore publiés sur npm ou PyPI.",
      typescript: {
        title: "TypeScript / JavaScript",
        description: "Un seul package (@public-map/sdk) sert les deux : types complets pour TypeScript, JavaScript pur pour tout le reste — aucun outil de build requis côté consommateur.",
        install: "npm install @public-map/sdk",
      },
      python: {
        title: "Python",
        description: "public-map-sdk — typé via dataclasses et Literal, HTTP synchrone via httpx.",
        install: "pip install public-map-sdk",
      },
      readMore: "Voir le guide Utilisation des SDK →",
    },
    collectionsPage: {
      title: "Collections API",
      subtitle: "Postman, Bruno et Insomnia — générées depuis la même spécification OpenAPI, jamais maintenues à la main.",
      items: {
        postman: { title: "Postman", description: "Collection v2.1 complète — dossiers par ressource, authentification, exemples de réponse.", download: "Télécharger la collection Postman" },
        bruno: { title: "Bruno", description: "Un fichier .bru par requête, plus un environnement de production préconfiguré.", download: "Télécharger les fichiers Bruno" },
        insomnia: { title: "Insomnia", description: "Export v4 complet, prêt à importer.", download: "Télécharger la collection Insomnia" },
      },
      setVariable: "Après import, renseignez la variable bearerToken avec votre clé API.",
      alternativeNote: "Les trois outils savent aussi importer une spécification OpenAPI directement — vous pouvez toujours pointer l'un d'eux vers /developers/openapi.yaml plutôt que d'utiliser ces collections prêtes à l'emploi.",
    },
    n8nTemplatesPage: {
      title: "Templates n8n",
      subtitle: "10 workflows d'action prêts à importer — un par opération réelle de /api/v1, générés depuis la même spécification OpenAPI que les collections API.",
      noTriggerNotice: "Ces templates démarrent tous par un déclencheur manuel (vous cliquez sur « Exécuter le workflow ») — aucun ne réagit automatiquement à un événement PUBLIC-MAP : le catalogue d'événements ne le permet pas encore pour un domaine client (voir la note de conception du catalogue d'événements).",
      setupTitle: "Avant d'importer",
      setupSteps: [
        "Définissez la variable d'environnement PUBLIC_MAP_BASE_URL sur votre instance n8n (ex. https://app.public-map.com/api/v1).",
        "Définissez PUBLIC_MAP_API_KEY avec une vraie clé API créée depuis la Console développeur.",
        "Aucune clé n'est jamais intégrée dans un fichier téléchargé — chaque template la lit depuis l'environnement n8n au moment de l'exécution.",
      ],
      downloadAll: "Tous les fichiers sont aussi disponibles dans templates/n8n/ du dépôt.",
    },
    makeScenariosPage: {
      title: "Scénarios Make",
      subtitle: "10 scénarios d'action prêts à importer — un par opération réelle de /api/v1, générés depuis la même spécification OpenAPI que les templates n8n et les collections API.",
      noTriggerNotice: "Ces scénarios contiennent un seul module HTTP, exécutable manuellement (« Exécuter une fois ») — aucun ne réagit automatiquement à un événement PUBLIC-MAP : le catalogue d'événements ne le permet pas encore pour un domaine client (voir la note de conception du catalogue d'événements).",
      setupTitle: "Avant d'importer",
      setupSteps: [
        "Ouvrez le module HTTP et remplacez YOUR_PUBLIC_MAP_API_KEY dans l'en-tête Authorization par une vraie clé API créée depuis la Console développeur.",
        "Aucune clé n'est jamais intégrée dans un fichier téléchargé — Make n'a pas d'équivalent aux variables d'environnement de n8n au niveau d'un blueprint ; voir templates/make/README.md pour l'explication technique complète.",
        "Remplacez tout espace réservé du type YOUR_ID dans l'URL par une vraie valeur avant d'exécuter le scénario.",
      ],
      downloadAll: "Tous les fichiers sont aussi disponibles dans templates/make/ du dépôt.",
    },
    airtableScriptsPage: {
      title: "Scripts Airtable",
      subtitle: "10 scripts d'action pour l'action d'automatisation « Exécuter un script » d'Airtable — un par opération réelle de /api/v1, générés depuis la même spécification OpenAPI que les templates n8n et les scénarios Make.",
      noImportNotice: "Airtable n'a aucun mécanisme d'import de fichier pour les automatisations, contrairement à n8n et Make. Ouvrez un script ci-dessous, copiez son contenu, et collez-le dans l'éditeur de code de l'étape « Exécuter un script » — voir templates/airtable/README.md pour le détail complet des différences avec n8n et Make, notamment sur le déclencheur à utiliser (jamais un déclencheur webhook).",
      setupTitle: "Avant de coller un script",
      setupSteps: [
        "Créez une automatisation Airtable avec un déclencheur qui ne dépend jamais d'un événement PUBLIC-MAP — par exemple « Quand un bouton est cliqué » (le plus simple pour tester) ou « À une heure planifiée ».",
        "Ajoutez une étape « Exécuter un script », collez le contenu du fichier, puis définissez la variable d'entrée apiKey avec une vraie clé API créée depuis la Console développeur — jamais dans le code du script lui-même.",
        "Renseignez toute autre variable d'entrée mentionnée dans l'en-tête du script (ex. id, clientId) depuis un champ de votre table ou une étape précédente.",
      ],
      downloadAll: "Tous les fichiers sont aussi disponibles dans templates/airtable/ du dépôt.",
    },
    zapierAppPage: {
      title: "Intégration Zapier",
      subtitle: "Un vrai connecteur Zapier Platform (3 déclencheurs, 3 recherches, 3 actions) — validé par l'outil officiel Zapier, en préparation pour une future soumission.",
      notPublishedNotice: "Cette intégration n'est pas encore publiée sur Zapier — elle vit dans zapier/ du dépôt, prête pour zapier push une fois un compte développeur Zapier réel disponible. Voir zapier/README.md pour le détail complet.",
      triggersTitle: "Déclencheurs",
      triggersAvailableTitle: "Disponibles dès aujourd'hui (par sondage)",
      triggersAvailable: [
        "Nouvel audit — sonde GET /audits",
        "Nouveau client — sonde GET /clients",
        "Nouveau rapport — sonde GET /reports",
      ],
      triggersImpossibleTitle: "Explicitement impossibles à ce stade",
      triggersImpossibleNotice: "Aucun déclencheur instantané (webhook) n'existe : cela demande un événement client dans le catalogue d'événements, qui ne contient aujourd'hui qu'un seul événement strictement interne (user.pending.created). Aucune solution de contournement n'a été inventée pour cette limitation — voir la note de conception du catalogue d'événements.",
      searchesTitle: "Recherches",
      searches: ["Trouver un audit par ID", "Trouver un client par ID", "Trouver un rapport par ID"],
      createsTitle: "Actions",
      creates: [
        "Créer une tâche (avec clé d'idempotence)",
        "Logger une interaction (avec clé d'idempotence)",
        "Mettre à jour un client",
      ],
      validationTitle: "Validation réelle déjà exécutée",
      validationNotice: "Validé avec l'outil officiel zapier-platform-cli : 25 vérifications réussies, 0 échec, 0 avertissement bloquant pour la publication. Voir zapier/README.md pour le détail complet.",
      nextStepsTitle: "Ce qui reste à faire uniquement sur la plateforme officielle Zapier",
      nextSteps: [
        "Enregistrement de l'application (zapier register) — nécessite un vrai compte développeur Zapier",
        "Publication du code (zapier push)",
        "Configuration développeur dans le tableau de bord Zapier (icône, catégorie, description publique)",
        "Revue humaine et publication dans l'App Directory public de Zapier",
      ],
    },
    roadmap: {
      title: "Roadmap publique",
      subtitle: "Ce qui est déjà livré, et ce qui arrive — sans engagement de date.",
      shippedTitle: "Déjà livré",
      shipped: [
        "Authentification par clé API, scopes, isolation stricte par organisation",
        "Lecture des audits, rapports et clients ; création de tâches et d'interactions",
        "Pagination par curseur, filtres par date et recherche texte",
        "Idempotence sur les routes d'écriture (Idempotency-Key)",
        "Limites de débit et quotas par palier d'abonnement, avec en-têtes de suivi",
        "Spécification OpenAPI 3.1 complète et ce portail développeur",
        "SDK officiels TypeScript/JavaScript et Python (pré-publication)",
        "Collections Postman, Bruno et Insomnia, générées depuis l'OpenAPI",
        "Console développeur en self-service (clés API, quotas, journal d'activité, membres)",
        "Playground / API Explorer, génération de code (cURL, JS, TS, Python, PHP, Go)",
        "Outils de test webhooks, vérification de signature, inspecteur de clé API",
        "Gestion complète en self-service des endpoints webhooks (création, abonnements, secrets, relecture)",
        "Politique de versionnement & dépréciation, changelog public, note de conception OAuth",
        "Note de conception pour l'extension du catalogue d'événements",
        "10 templates d'action n8n (un par opération /api/v1), sans déclencheur tant que le catalogue d'événements n'est pas étendu",
        "10 scénarios d'action Make, même périmètre que les templates n8n",
        "10 scripts d'action Airtable (pour l'étape « Exécuter un script »), même périmètre — pas encore une Extension Airtable packagée",
        "Intégration Zapier (3 déclencheurs par sondage, 3 recherches, 3 actions), validée par l'outil officiel Zapier — pas encore publiée sur l'App Directory",
      ],
      upcomingTitle: "À venir",
      upcoming: [
        "Extension réelle du catalogue d'événements (au-delà de user.pending.created) — débloquerait des déclencheurs instantanés Zapier",
        "Extension Airtable packagée (Marketplace) — au-delà des scripts d'action déjà livrés",
        "Soumission et publication de l'intégration Zapier sur l'App Directory",
        "Marketplace d'intégrations",
        "Dashboard d'usage et d'observabilité pour /api/v1",
      ],
      disclaimer: "Cette roadmap reflète l'ordre de priorité actuel et peut évoluer sans préavis.",
    },
    security: {
      title: "Sécurité",
      subtitle: "Comment PUBLIC-MAP protège l'API publique — vue d'ensemble destinée aux intégrateurs.",
      sections: {
        keys: {
          title: "Clés API",
          body: "Une clé n'est jamais stockée en clair côté serveur — seul un hachage est conservé. Elle n'est affichée en clair qu'une seule fois, au moment de sa création.",
        },
        isolation: {
          title: "Isolation par organisation",
          body: "L'organisation d'une requête est toujours dérivée de la clé authentifiée elle-même — jamais d'un identifiant fourni par l'appelant. Une tentative d'accès à une ressource d'une autre organisation reçoit la même réponse « introuvable » qu'une ressource qui n'existe pas, pour ne jamais révéler ce qui existe ailleurs.",
        },
        transport: {
          title: "Transport",
          body: "Toute requête doit être effectuée en HTTPS. Aucune clé ni donnée sensible n'est jamais journalisée en clair côté PUBLIC-MAP.",
        },
        limits: {
          title: "Limites de débit et quotas",
          body: "Chaque clé et chaque organisation sont soumises à des limites de débit — voir Limites & quotas.",
        },
        disclosure: {
          title: "Signaler une vulnérabilité",
          body: "Si vous pensez avoir identifié une faille de sécurité concernant l'API, contactez votre interlocuteur PUBLIC-MAP directement plutôt que de la divulguer publiquement.",
        },
      },
    },
    versioningPolicy: {
      title: "Versionnement & dépréciation",
      subtitle: "Comment PUBLIC-MAP fait évoluer son API publique — politique en brouillon, soumise à revue interne.",
      draftNotice: "Ce document est un brouillon de politique soumis à revue interne. Aucune transition de version majeure n'a encore eu lieu ; les engagements ci-dessous décrivent une intention, pas encore un contrat définitif.",
      sections: {
        scheme: {
          title: "Schéma de versionnement",
          body: "L'API est versionnée dans son chemin d'URL (/api/v1). Le champ « version » de la spécification OpenAPI (actuellement 1.4.0) suit une numérotation sémantique et ne s'incrémente que pour des évolutions non cassantes à l'intérieur de v1 — un changement cassant justifierait un nouveau préfixe de chemin (/api/v2), jamais une modification silencieuse de v1.",
        },
        nonBreaking: {
          title: "Changements non cassants",
          body: "Considérés non cassants et publiables sans préavis : ajout d'un nouvel endpoint, ajout d'un champ optionnel à une réponse existante, ajout d'une nouvelle valeur à une énumération déjà documentée comme extensible, ajout d'un nouvel en-tête de réponse.",
        },
        breaking: {
          title: "Changements cassants",
          body: "Considérés cassants, et donc exclus de v1 : suppression ou renommage d'un champ, changement de type d'un champ existant, suppression d'un endpoint, changement du comportement par défaut d'un paramètre existant, durcissement d'une validation qui rejetterait des requêtes aujourd'hui acceptées.",
        },
        deprecation: {
          title: "Politique de dépréciation (brouillon)",
          body: "Intention proposée : un champ, un endpoint ou un scope déprécié resterait fonctionnel au moins 90 jours après son annonce dans le changelog, avant toute suppression. Cette durée et le mécanisme de signalement (en-tête de réponse dédié, mention dans la documentation) restent à valider avant la première dépréciation réelle — aucune n'a eu lieu à ce jour.",
        },
        communication: {
          title: "Communication des changements",
          body: "Tout changement — cassant ou non — est annoncé dans le changelog public avant d'être déployé en production. Les changements non cassants peuvent être publiés directement ; les changements cassants suivraient la période de préavis ci-dessus.",
        },
      },
      changelogLink: "Voir le changelog →",
    },
    changelog: {
      title: "Changelog",
      subtitle: "Historique des évolutions de l'écosystème développeur PUBLIC-MAP — API, portail, SDKs, Console.",
      note: "Ce changelog documente le programme de construction de l'écosystème développeur (portail, SDKs, Console, Playground, webhooks). Les horodatages précis par entrée ne sont pas encore suivis avant cette étape ; l'ordre reflète la séquence réelle de livraison, la plus récente en premier. La version de la spécification OpenAPI (actuellement 1.4.0) est indiquée séparément quand elle est directement concernée.",
      entries: [
        {
          label: "Politiques de cycle de vie & changelog",
          items: [
            "Politique de versionnement et de dépréciation (brouillon pour revue)",
            "Changelog public",
            "Note de conception pour un futur fournisseur OAuth (non implémenté)",
          ],
        },
        {
          label: "Webhooks en self-service",
          items: [
            "Gestion complète des endpoints webhooks dans la Console : création, modification, suppression, activation/désactivation",
            "Abonnement aux événements, rotation des secrets, historique des livraisons avec détail des tentatives",
            "Relecture (replay) d'une livraison échouée, abandonnée ou ignorée",
            "Planification du worker de livraison (cron toutes les 5 minutes)",
          ],
        },
        {
          label: "Environnement de développement interactif",
          items: [
            "Playground / API Explorer intégré à la Console, avec injection sécurisée de clé API côté navigateur",
            "Génération automatique de requêtes en cURL, JavaScript, TypeScript, Python, PHP et Go",
            "Outil de test de webhooks ad hoc et vérificateur de signature HMAC",
            "Inspecteur de format de clé API",
          ],
        },
        {
          label: "Console développeur",
          items: [
            "Gestion en self-service des clés API : création, rotation, révocation, renommage, scopes",
            "Tableau de bord (intégration, palier, quotas), journal d'activité, liste des membres",
          ],
        },
        {
          label: "SDKs & outillage client",
          items: [
            "SDK officiels TypeScript/JavaScript et Python",
            "Collections Postman, Bruno et Insomnia générées depuis la spécification OpenAPI",
            "Guides d'utilisation des SDK et exemples de code",
          ],
        },
        {
          label: "Lancement du portail développeur",
          items: [
            "Documentation, Quick Start, guides d'authentification, pagination, idempotence, limites & quotas, erreurs, FAQ",
            "Référence OpenAPI interactive",
            "Roadmap publique et page sécurité",
          ],
        },
      ],
    },
    oauthDesign: {
      title: "OAuth — note de conception",
      subtitle: "Une piste d'authentification déléguée pour l'API publique — conception uniquement, rien de ce qui suit n'est implémenté aujourd'hui.",
      notImplementedNotice: "Aucune route, aucun écran et aucun jeton décrits ici n'existent dans le produit actuel. L'authentification en vigueur reste exclusivement la clé API (voir le guide Authentification). Ce document sert de base de discussion avant tout développement.",
      sections: {
        why: {
          title: "Pourquoi envisager OAuth",
          body: "Les clés API conviennent à une intégration installée par un administrateur pour son organisation. OAuth (flux « authorization code » avec PKCE) deviendrait pertinent si un tiers — une application publiée par un partenaire, par exemple — doit se connecter au nom de plusieurs organisations clientes différentes, chacune consentant explicitement, sans jamais partager une clé API entre elles.",
        },
        rolesReversal: {
          title: "PUBLIC-MAP comme fournisseur, pas comme client",
          body: "lib/google/oauth.ts implémente PUBLIC-MAP en tant que client OAuth (consommateur de l'API Google). Ce document envisage l'inverse : PUBLIC-MAP deviendrait fournisseur OAuth, émettant ses propres jetons pour des applications tierces — un rôle structurellement différent (écran de consentement, registre de clients, jetons à révoquer), qui ne réutilise aucun code de ce fichier au-delà de l'inspiration stylistique.",
        },
        scopes: {
          title: "Portées (scopes)",
          body: "Réutiliserait directement le même catalogue fermé que les clés API (lib/integrations/governance.ts) — audits:read, reports:read, clients:read, clients:update, tasks:create, interactions:create — pour qu'une organisation cliente accorde exactement les mêmes permissions granulaires via un consentement OAuth qu'aujourd'hui via une clé API, sans dupliquer le modèle de permissions.",
        },
        flow: {
          title: "Flux envisagé",
          steps: [
            "L'application tierce redirige l'utilisateur vers un écran d'autorisation PUBLIC-MAP, avec les scopes demandés",
            "L'utilisateur, membre d'une organisation cliente, choisit l'organisation au nom de laquelle il consent et approuve (ou refuse) les scopes demandés",
            "PUBLIC-MAP redirige vers l'application tierce avec un code d'autorisation à usage unique",
            "L'application tierce échange ce code contre un jeton d'accès (courte durée) et un jeton de rafraîchissement, via un échange serveur-à-serveur avec PKCE",
            "Chaque requête /api/v1 authentifiée par jeton OAuth est scopée à l'organisation ayant consenti — jamais à une autre — exactement comme une clé API aujourd'hui",
          ],
        },
        revocation: {
          title: "Révocation",
          body: "Un membre de l'organisation cliente pourrait révoquer un consentement OAuth à tout moment depuis la Console développeur, par analogie directe avec la révocation d'une clé API existante, invalidant immédiatement les jetons d'accès et de rafraîchissement associés.",
        },
        openQuestions: {
          title: "Questions ouvertes avant implémentation",
          items: [
            "Registre des applications tierces : auto-inscription ou validation manuelle par PUBLIC-MAP ?",
            "Durée de vie des jetons d'accès et politique de rotation des jetons de rafraîchissement",
            "Écran de consentement : réutiliser l'interface Clerk existante ou construire un écran dédié ?",
            "Faut-il un scope distinct pour distinguer un accès délégué (OAuth) d'un accès direct (clé API) dans les journaux d'audit ?",
          ],
        },
      },
    },
    eventCatalogDesign: {
      title: "Catalogue d'événements — note de conception",
      subtitle: "Quels nouveaux événements ajouter pour que les futurs templates n8n / Make / Zapier soient réellement utiles — conception uniquement, rien n'est implémenté.",
      notImplementedNotice: "Aucun des événements ci-dessous n'existe dans lib/integrations/governance.ts aujourd'hui. Le catalogue réel ne contient qu'un seul événement, user.pending.created, strictement interne. Ce document propose des candidats et leurs modalités techniques ; leur implémentation reste une décision et un travail à part, non commencés ici.",
      sections: {
        context: {
          title: "Pourquoi étendre le catalogue",
          body: "Un seul événement interne suffit pour notifier le personnel PUBLIC-MAP d'une inscription en attente, mais ne permet aucun scénario d'automatisation orienté client (« quand un audit est créé, ajoute une ligne dans mon tableur » côté n8n/Make/Zapier). Les futurs templates d'intégration ont besoin d'au moins quelques déclencheurs réels côté client pour avoir une utilité concrète — c'est le prérequis que cette note cherche à satisfaire, sans construire les templates eux-mêmes.",
        },
        orgScopingWarning: {
          title: "Contrainte technique impérative : le rattachement à l'organisation cliente",
          body: "Vérifié pendant la Stage 5 : la répartition des événements vers les endpoints (lib/integrations/outbox.ts, fanOutEvent) exige une correspondance exacte entre l'organizationId de l'événement et celui de l'intégration abonnée. user.pending.created est rattaché à l'organisation interne PUBLIC-MAP — c'est précisément pourquoi un endpoint self-service créé par un client ne le reçoit jamais aujourd'hui. Tout nouvel événement orienté client devra être mis en file avec l'organizationId réel du client concerné — jamais null, jamais l'organisation interne — sous peine de ne jamais atteindre le moindre endpoint self-service.",
        },
        existingInfra: {
          title: "Infrastructure déjà en place, à réutiliser telle quelle",
          body: "enqueueIntegrationEvent (lib/integrations/outbox.ts) est déjà générique et prêt à recevoir de nouveaux types d'événements sans aucune modification. Un nouvel événement ne demanderait qu'une entrée dans INTEGRATION_EVENT_CATALOG (type, version, champs autorisés, indicateur de données personnelles) et un seul appel à enqueueIntegrationEvent ajouté à l'action serveur existante qui déclenche l'événement — jamais une réécriture du moteur de livraison (signature, retries, historique, self-service, tout reste inchangé).",
        },
        separateAuditSystem: {
          title: "Hors périmètre de cette proposition : le workflow d'audit GBP",
          body: "Le workflow complet d'audit GBP (lib/actions/gbp-audit.ts, statuts de gbpAudits) vit dans une base de données Supabase séparée (db/audit-schema.ts) et dispose déjà de son propre mécanisme de webhook indépendant (lib/gbp-audit/webhooks.ts — une URL n8n unique, non signée, non multi-tenant). Le relier au moteur universel lib/integrations/ demanderait un pont technique entre deux bases de données distinctes : un problème de conception à part entière, volontairement exclu d'ici pour rester dans le périmètre restreint de cette étape.",
        },
        candidatesTitle: "Événements candidats proposés",
        candidatesColumns: { event: "Événement", trigger: "Déclencheur réel existant", fields: "Champs proposés", notes: "Notes" },
        candidates: [
          { event: "client.created", trigger: "lib/actions/crm-clients.ts — createClient", fields: "clientId, name, stage, source", notes: "Organisation dérivée de crmClients.organizationId — doit être non nul pour atteindre un endpoint." },
          { event: "client.stage_changed", trigger: "lib/actions/crm-clients.ts — updateClientStage", fields: "clientId, previousStage, stage", notes: "Utile pour synchroniser un pipeline externe (tableur, CRM tiers)." },
          { event: "task.created", trigger: "lib/actions/crm-tasks.ts — createTask", fields: "taskId, clientId, title, dueDate", notes: "Symétrique de POST /api/v1/tasks, déjà existant en écriture." },
          { event: "task.completed", trigger: "lib/actions/crm-tasks.ts — updateTaskStatus (status devient \"done\")", fields: "taskId, clientId, title", notes: "Ne se déclenche que sur la transition vers \"done\", pas à chaque changement de statut." },
          { event: "interaction.created", trigger: "lib/actions/crm-interactions.ts — createInteraction", fields: "interactionId, clientId, type", notes: "\"summary\" (texte libre) volontairement exclu par défaut — risque de données personnelles, à trancher avant implémentation." },
          { event: "subscription.status_changed", trigger: "lib/actions/billing.ts + app/api/webhooks/fastspring/route.ts", fields: "plan, previousStatus, status", notes: "P1 — touche la facturation ; faut-il exposer priceEuros ? Nécessite sa propre revue." },
        ],
        namingAndVersioning: {
          title: "Convention de nommage et de version",
          body: "Suit le seul précédent existant : {domaine}.{transition_au_participe_passé} (ex. client.created, task.completed), version 1 pour chaque nouveau type. Une entrée de catalogue est un changement de contrat revu (voir le commentaire déjà présent sur INTEGRATION_SCOPES dans governance.ts) — jamais générée ni ajoutée automatiquement.",
        },
        dataMinimization: {
          title: "Minimisation des données",
          body: "Chaque événement candidat ci-dessus ne propose que des champs déjà publics via la lecture /api/v1 correspondante (par exemple, les mêmes champs que toClientDTO pour client.*) — jamais un champ absent de l'API publique elle-même. containsPersonalData suivrait le même principe que pour user.pending.created : vrai dès qu'un champ (nom, email, résumé libre) pourrait identifier une personne.",
        },
        priority: {
          title: "Priorisation proposée",
          p0Title: "P0 — haute valeur, périmètre restreint (schéma principal uniquement)",
          p0: ["client.created", "client.stage_changed", "task.created", "task.completed", "interaction.created"],
          p1Title: "P1 — valeur réelle, nécessite une revue séparée avant toute décision",
          p1: ["subscription.status_changed"],
        },
        openQuestions: {
          title: "Questions ouvertes avant implémentation",
          items: [
            "Faut-il exposer interaction.summary (texte libre) ou seulement les métadonnées (type, date) ?",
            "subscription.status_changed doit-il exposer priceEuros, ou seulement plan/status ?",
            "Faut-il un mécanisme de rétrocompatibilité si un scope existant devait conditionner l'abonnement à un type d'événement (aujourd'hui, les abonnements webhook ne sont pas liés aux scopes des clés API) ?",
            "Le pont vers le workflow d'audit GBP (base de données séparée) mérite-t-il sa propre note de conception dédiée dans une étape future ?",
          ],
        },
      },
    },
  },
  en: {
    meta: {
      title: "PUBLIC-MAP for Developers",
      description: "Documentation, OpenAPI reference, and guides to integrate with the PUBLIC-MAP public API.",
    },
    header: {
      brand: "PUBLIC-MAP",
      brandSuffix: "Developers",
      nav: { docs: "Documentation", reference: "API Reference", roadmap: "Roadmap", security: "Security" },
      console: "Console",
      soonBadge: "Coming soon",
      backToApp: "Back to app",
    },
    footer: {
      tagline: "PUBLIC-MAP's public API — for n8n, Make, Zapier, Airtable, your internal apps, and any standard HTTP client.",
      columns: {
        documentation: { title: "Documentation", quickstart: "Quick Start", authentication: "Authentication", errors: "Common errors", faq: "FAQ" },
        api: { title: "API", reference: "OpenAPI reference", rateLimits: "Rate limits & quotas", security: "Security" },
        project: { title: "Project", roadmap: "Public roadmap", changelog: "Changelog", versioning: "Versioning & deprecation" },
      },
      copyright: (year: number) => `© ${year} PUBLIC-MAP. All rights reserved.`,
    },
    landing: {
      eyebrow: "Public API",
      title: "Build on PUBLIC-MAP",
      subtitle:
        "A simple, versioned, secure REST API to connect PUBLIC-MAP to n8n, Make, Zapier, Airtable, Retool, Bubble, your internal apps, or any standard HTTP client.",
      ctaPrimary: "Start with the Quick Start",
      ctaSecondary: "Explore the API reference",
      features: [
        {
          title: "API key authentication",
          description: "One key per integration, explicit permissions (scopes), revocable and expirable at any time.",
        },
        {
          title: "Strict organization isolation",
          description: "Every request is automatically scoped to your organization's data — never another's.",
        },
        {
          title: "Built-in idempotency",
          description: "An Idempotency-Key header on write routes so you can safely retry a request.",
        },
        {
          title: "Transparent limits",
          description: "X-RateLimit-* and X-Quota-* headers on every response so you always know where you stand.",
        },
      ],
      quickLinksTitle: "Get started",
      quickLinks: {
        quickstart: { title: "Quick Start", description: "Your first request in under 5 minutes." },
        reference: { title: "API Reference", description: "The complete, interactive OpenAPI specification." },
        authentication: { title: "Authentication", description: "How to create and use an API key." },
      },
      statusNote:
        "This portal is being built up progressively. The SDKs, Postman/Bruno/Insomnia collections, the self-service developer Console (API keys, webhooks), and the n8n/Make/Airtable/Zapier templates are all now available — see the roadmap for what's next.",
    },
    docsNav: {
      guidesGroup: "Guides",
      guides: {
        quickstart: "Quick Start",
        authentication: "Authentication",
        pagination: "Pagination & filters",
        idempotency: "Idempotency",
        rateLimits: "Rate limits & quotas",
        errors: "Common errors",
        faq: "FAQ",
        sdkUsage: "Using the SDKs",
        examples: "Code examples",
        webhooks: "Webhooks",
      },
      resourcesGroup: "Resources",
      resources: {
        sdk: "SDKs",
        collections: "API collections",
        console: "Developer Console",
        n8nTemplates: "n8n templates",
        makeScenarios: "Make scenarios",
        airtableScripts: "Airtable scripts",
        zapierApp: "Zapier integration",
      },
      policiesGroup: "Policies",
      policies: {
        versioning: "Versioning & deprecation",
        changelog: "Changelog",
        oauth: "OAuth (future design)",
      },
      designNotesGroup: "Design notes",
      designNotes: {
        eventCatalog: "Event catalog",
      },
      soonGroup: "Coming soon",
      soon: {
        explorer: "API Explorer",
        templates: "Zapier templates",
        marketplace: "Integrations marketplace",
      },
    },
    docsIndex: {
      title: "Documentation",
      subtitle: "Practical guides for integrating with the PUBLIC-MAP public API.",
      cards: {
        quickstart: { title: "Quick Start", description: "Create a key, make your first request, read the response." },
        authentication: { title: "Authentication", description: "Key format, accepted headers, available scopes." },
        pagination: { title: "Pagination & filters", description: "Cursor, limit, dates, search." },
        idempotency: { title: "Idempotency", description: "Retry a write request without creating a duplicate." },
        rateLimits: { title: "Rate limits & quotas", description: "Requests per minute, daily quota, tracking headers." },
        errors: { title: "Common errors", description: "Every error code, its HTTP status, and how to fix it." },
        faq: { title: "FAQ", description: "Questions frequently asked by integrators." },
        sdkUsage: { title: "Using the SDKs", description: "Install, initialize, and use the official SDKs." },
        examples: { title: "Code examples", description: "curl, JavaScript, TypeScript, and Python side by side." },
        webhooks: { title: "Webhooks", description: "How outbound events work — self-service management available in the Console." },
      },
    },
    quickstart: {
      title: "Quick Start",
      subtitle: "From zero to your first successful request.",
      steps: {
        step1: {
          title: "1. Get an API key",
          body: "Create your API key in self-service from the developer Console (the \"Console\" link at the top of this page): choose the scopes (permissions) you need, and the key is generated immediately for your organization.",
          note: "The key is shown only once, at creation — store it immediately in a secrets manager.",
        },
        step2: {
          title: "2. Make your first request",
          body: "Every request to /api/v1 must carry the key in the Authorization header. A call to /api/v1/ping requires no particular scope and confirms authentication is working.",
        },
        step3: {
          title: "3. Read the response",
          body: "Every JSON response has the shape {\"data\": ...}. Every response — success or error — carries an X-Request-Id header to provide if you contact us about a specific request.",
        },
        step4: {
          title: "4. Try a real route",
          body: "With the audits:read scope, list your organization's audits. Results are cursor-paginated — see the Pagination & filters guide.",
        },
        step5: {
          title: "5. Next steps",
          body: "See Authentication for the full scope list, Rate limits & quotas to avoid 429s, and Common errors to interpret failed responses.",
        },
      },
      curl: {
        ping: 'curl https://app.public-map.com/api/v1/ping \\\n  -H "Authorization: Bearer pm_live_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
        pingResponse: '{\n  "data": {\n    "pong": true,\n    "organizationId": "…",\n    "scopes": ["audits:read"]\n  }\n}',
        audits: 'curl "https://app.public-map.com/api/v1/audits?limit=5" \\\n  -H "Authorization: Bearer pm_live_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
      },
    },
    authentication: {
      title: "Authentication",
      subtitle: "How PUBLIC-MAP verifies every request to /api/v1.",
      sections: {
        headers: {
          title: "Accepted headers",
          body: "Two headers are accepted to present your key; Authorization: Bearer takes priority if both are provided.",
          rows: [
            { name: "Authorization: Bearer <key>", description: "Recommended method." },
            { name: "X-Api-Key: <key>", description: "Fallback for tools that can't customize the Authorization header (some no-code tools)." },
          ],
        },
        format: {
          title: "Key format",
          body: "pm_{environment}_{lookupId}_{secret} — environment is live or test. The prefix (pm_live_… or pm_test_…, up to the lookup id) is not secret and may appear in your logs; the secret that follows must never be logged or committed.",
        },
        scopes: {
          title: "Scopes (permissions)",
          body: "Each key carries an explicit list of scopes. A request to a route requiring a scope the key doesn't have receives a FORBIDDEN_SCOPE error (403).",
          rows: [
            { scope: "audits:read", description: "Read audits (GET /audits, GET /audits/:id)." },
            { scope: "reports:read", description: "Read reports (GET /reports, GET /reports/:id)." },
            { scope: "clients:read", description: "Read CRM clients (GET /clients, GET /clients/:id)." },
            { scope: "clients:update", description: "Update a client (PATCH /clients/:id)." },
            { scope: "tasks:create", description: "Create tasks (POST /tasks)." },
            { scope: "interactions:create", description: "Create interactions (POST /interactions)." },
          ],
        },
        isolation: {
          title: "Organization isolation",
          body: "The organization tied to a request is always derived from the key itself, never from a caller-supplied parameter. Another organization's data is never reachable, regardless of the id requested.",
        },
        lifecycle: {
          title: "Key lifecycle",
          body: "A key can be active, revoked, or expired. A revoked or expired key is rejected immediately (API_KEY_REVOKED or API_KEY_EXPIRED, 401), even if the presented secret is correct.",
        },
      },
    },
    pagination: {
      title: "Pagination & filters",
      subtitle: "List routes (GET /audits, /reports, /clients) are cursor-paginated, not page-numbered.",
      sections: {
        cursor: {
          title: "Cursor",
          body: "Every page returns pagination.nextCursor. Pass it back as the cursor parameter to get the next page. nextCursor is null on the last page. The cursor is opaque — don't attempt to decode or construct it yourself.",
        },
        limit: {
          title: "Page size",
          body: "limit parameter, 1 to 100, defaults to 20. A value outside that range is rejected with VALIDATION_ERROR (400).",
        },
        filters: {
          title: "Available filters",
          rows: [
            { name: "from / to", description: "ISO 8601 bounds on the creation date." },
            { name: "q", description: "Text search (audit summary, or client name/contact/email)." },
            { name: "stage", description: "GET /clients only: lead, prospect, client, or churned." },
          ],
        },
      },
    },
    idempotency: {
      title: "Idempotency",
      subtitle: "Retry a write request (POST /tasks, POST /interactions) without risking a duplicate.",
      sections: {
        howItWorks: {
          title: "How it works",
          body: "Send an Idempotency-Key header on your request. A retry with the same key and the same body returns the exact same resource (same status, same content) instead of creating a new one. A retry with the same key but a different body is rejected with IDEMPOTENCY_KEY_CONFLICT (409) — never silently merged or overwritten.",
        },
        scope: {
          title: "Scope",
          body: "An idempotency key is scoped to your integration and to the route called — the same string used on two different routes never collides.",
        },
        recommendation: {
          title: "Recommendation",
          body: "Optional but strongly recommended for any write request triggered automatically (an n8n/Make/Zapier workflow, an application-level retry) — a stable key per business event (e.g. a source row id) protects against double submission.",
        },
      },
    },
    rateLimits: {
      title: "Rate limits & quotas",
      subtitle: "Two independent limits protect the API — one per key, one per organization.",
      sections: {
        perMinute: {
          title: "Per-minute rate (per API key)",
          body: "A key that exceeds its per-minute budget receives RATE_LIMITED (429) with a Retry-After header indicating the delay before retrying. This budget protects against a single key sending too many requests too fast — it's independent of the subscription plan.",
        },
        perDay: {
          title: "Daily quota (per organization)",
          body: "Cumulative across every API key belonging to your organization. Beyond it, QUOTA_EXCEEDED (429). The quota depends on your organization's subscription plan.",
        },
        headers: {
          title: "Tracking headers",
          body: "Present on every response, success or error — you never need a separate call to know your consumption.",
          rows: [
            { name: "X-RateLimit-Limit / -Remaining / -Reset", description: "Per-minute budget — remaining count and Unix reset timestamp." },
            { name: "X-Quota-Limit / -Remaining / -Reset", description: "Daily quota — remaining count and Unix reset timestamp." },
            { name: "Retry-After", description: "Present only on a 429 response — seconds to wait before retrying." },
          ],
        },
        plans: {
          title: "Limits per plan",
          body: "An organization with no active subscription (or in past_due/canceled) stays usable on a limited free tier.",
          rows: [
            { plan: "Free (implicit)", perMinute: "30 requests/min", perDay: "1,000 requests/day" },
            { plan: "Starter", perMinute: "60 requests/min", perDay: "5,000 requests/day" },
            { plan: "Pro", perMinute: "120 requests/min", perDay: "20,000 requests/day" },
            { plan: "Agency", perMinute: "300 requests/min", perDay: "100,000 requests/day" },
          ],
        },
      },
    },
    errors: {
      title: "Common errors",
      subtitle: "Every error follows the same shape: {\"error\": {\"code\", \"message\", \"requestId\"}}.",
      intro:
        "The code is stable and meant to be tested by your integration (if (error.code === \"...\")); the message is for humans and may change; requestId identifies the request if you contact support.",
      columns: { code: "Code", status: "HTTP status", meaning: "Meaning" },
      rows: [
        { code: "MISSING_API_KEY", status: "401", meaning: "No key provided (neither Authorization: Bearer nor X-Api-Key)." },
        { code: "MALFORMED_API_KEY", status: "401", meaning: "The provided key isn't in the expected format." },
        { code: "INVALID_API_KEY", status: "401", meaning: "Key not found, or the secret is incorrect." },
        { code: "API_KEY_REVOKED", status: "401", meaning: "This key has been revoked." },
        { code: "API_KEY_EXPIRED", status: "401", meaning: "This key has expired." },
        { code: "INTEGRATION_INACTIVE", status: "401", meaning: "The integration owning this key is no longer active." },
        { code: "INTEGRATION_EXPIRED", status: "401", meaning: "The integration owning this key has expired." },
        { code: "FORBIDDEN_SCOPE", status: "403", meaning: "The key doesn't carry the scope this route requires." },
        { code: "SERVICE_NOT_CONFIGURED", status: "503", meaning: "The API isn't configured on this environment (should never happen in production)." },
        { code: "VALIDATION_ERROR", status: "400", meaning: "Invalid request parameter or body — see the message for detail." },
        { code: "NOT_FOUND", status: "404", meaning: "Resource doesn't exist, or belongs to another organization (deliberately indistinguishable)." },
        { code: "IDEMPOTENCY_KEY_CONFLICT", status: "409", meaning: "Idempotency-Key already used with a different request body." },
        { code: "RATE_LIMITED", status: "429", meaning: "Per-minute rate exceeded — see Retry-After." },
        { code: "QUOTA_EXCEEDED", status: "429", meaning: "Organization's daily quota exceeded — see Retry-After." },
        { code: "INTERNAL_ERROR", status: "500", meaning: "Unexpected server-side error — no internal detail is ever included." },
      ],
    },
    faq: {
      title: "FAQ",
      subtitle: "Questions frequently asked by integrators.",
      items: [
        {
          q: "Is the API versioned?",
          a: "Yes — the /api/v1 prefix is stable. A future /api/v2 will never replace /api/v1 without an announced transition period (see the Roadmap).",
        },
        {
          q: "Is there a test/sandbox environment?",
          a: "The key format already distinguishes pm_live_… from pm_test_…. A real public sandbox (with demo data) is part of upcoming stages.",
        },
        {
          q: "Can I create/manage my own keys?",
          a: "Yes — the Developer Console (the \"Console\" link at the top of this page) lets you create, rename, rotate, and revoke your own keys, no PUBLIC-MAP administrator needed.",
        },
        {
          q: "Do you offer official SDKs?",
          a: "Not yet — TypeScript/JavaScript and Python are planned for a later stage, generated from the OpenAPI specification published on this portal.",
        },
        {
          q: "Can I receive real-time events (webhooks)?",
          a: "Yes — create and manage your webhook endpoints in self-service from the Console (create an endpoint, choose events, view delivery history), with HMAC-SHA256 signature verification. See the Webhooks guide.",
        },
        {
          q: "Which HTTP methods are supported?",
          a: "GET for reads, POST for creation (tasks, interactions), PATCH for partially updating a client. No DELETE method is exposed today.",
        },
        {
          q: "How do I report a security issue?",
          a: "Contact your PUBLIC-MAP contact directly — see the Security page for the API's security model.",
        },
      ],
    },
    reference: {
      title: "API Reference",
      subtitle: "The complete OpenAPI 3.1 specification for /api/v1 — interactive, always in sync with the implementation.",
      openLabel: "Open the interactive reference",
      specLinkLabel: "Download the specification (YAML)",
      specJsonLinkLabel: "Download the specification (JSON)",
      note: "The reference opens full-screen for comfortable reading; use the “Back” link it displays to return to the portal.",
    },
    sdkUsage: {
      title: "Using the SDKs",
      subtitle: "How to install, initialize, and use the official TypeScript/JavaScript and Python SDKs.",
      sections: {
        intro: {
          title: "One TypeScript/JavaScript package",
          body: "The @public-map/sdk package serves both TypeScript projects (types generated from the OpenAPI spec) and JavaScript ones (the same package, compiled, no build step needed). The Python SDK (public-map-sdk) is a separate package, with its own typed models.",
        },
        sourceOfTruth: {
          title: "Generated from the OpenAPI spec (TypeScript)",
          body: "The TypeScript SDK's request/response types are generated automatically from lib/api-v1/openapi.yaml (via openapi-typescript) — never hand-duplicated. The Python SDK currently maintains its models by hand for this first release; see its README for that deliberate asymmetry.",
        },
        install: {
          title: "Installation",
          body: "Both SDKs are pre-release (0.1.0) — not yet published to npm/PyPI. The commands below are what will work once publishing happens.",
        },
        initialize: { title: "Initialization" },
        errorHandling: {
          title: "Error handling",
          body: "Each SDK exposes a dedicated error class (PublicMapApiError) with the same fields as the Common errors guide: a code, a message, a request id, and — for 429s — a retry delay.",
        },
        pagination: {
          title: "Pagination",
          body: "Each SDK exposes a paginate() utility that walks every page of a list automatically, cursor by cursor — see the Pagination & filters guide for how the cursor itself works.",
        },
      },
    },
    examples: {
      title: "Code examples",
      subtitle: "The same common operations in curl, JavaScript, TypeScript, and Python.",
      tabs: { curl: "curl", javascript: "JavaScript", typescript: "TypeScript", python: "Python" },
      scenarios: {
        ping: { title: "Verify an API key" },
        listAudits: { title: "List audits (pagination)" },
        createTask: { title: "Create a task (idempotency)" },
        handleError: { title: "Handle a 429 error" },
      },
    },
    webhooksGuide: {
      title: "Webhooks",
      subtitle: "How PUBLIC-MAP notifies your systems of an event — an overview.",
      selfServiceNotice: "Full self-service management of your endpoints (creating an endpoint, choosing events, viewing delivery history) is available in the Console, along with ad-hoc webhook testing and signature verification (Webhook Tools, link below). This page describes the general workings of the system.",
      consoleToolsLink: "Open the Console's Webhook Tools →",
      sections: {
        overview: {
          title: "Principle",
          body: "A webhook is an HTTP POST notification PUBLIC-MAP sends to a URL you control as soon as a relevant event happens — instead of you polling the API in a loop to detect a change.",
        },
        signing: {
          title: "Signing",
          body: "Every delivery is HMAC-SHA256 signed with a secret unique to your endpoint, so you can verify the request genuinely came from PUBLIC-MAP before acting on it. The exact signature headers will be published alongside self-service management.",
        },
        retry: {
          title: "Automatic retry",
          body: "A failed delivery (endpoint unreachable, server error) is retried automatically on an increasing delay schedule, up to a maximum number of attempts, before being marked abandoned.",
        },
        history: {
          title: "History",
          body: "Every delivery attempt is logged (status, response code, duration) — viewable today by PUBLIC-MAP staff, soon directly by you in self-service.",
        },
      },
    },
    sdkPage: {
      title: "Official SDKs",
      subtitle: "TypeScript, JavaScript, and Python — generated and tested from the same OpenAPI specification.",
      preReleaseNotice: "Pre-release (0.1.0) — not yet published to npm or PyPI.",
      typescript: {
        title: "TypeScript / JavaScript",
        description: "One package (@public-map/sdk) serves both: full types for TypeScript, plain JavaScript for everything else — no build tooling required on the consumer's side.",
        install: "npm install @public-map/sdk",
      },
      python: {
        title: "Python",
        description: "public-map-sdk — typed via dataclasses and Literal, synchronous HTTP via httpx.",
        install: "pip install public-map-sdk",
      },
      readMore: "See the Using the SDKs guide →",
    },
    collectionsPage: {
      title: "API collections",
      subtitle: "Postman, Bruno, and Insomnia — generated from the same OpenAPI specification, never hand-maintained.",
      items: {
        postman: { title: "Postman", description: "Full v2.1 collection — folders by resource, authentication, example responses.", download: "Download the Postman collection" },
        bruno: { title: "Bruno", description: "One .bru file per request, plus a preconfigured production environment.", download: "Download the Bruno files" },
        insomnia: { title: "Insomnia", description: "Full v4 export, ready to import.", download: "Download the Insomnia collection" },
      },
      setVariable: "After importing, set the bearerToken variable to your API key.",
      alternativeNote: "All three tools can also import an OpenAPI spec directly — you can always point one of them at /developers/openapi.yaml instead of using these ready-made collections.",
    },
    n8nTemplatesPage: {
      title: "n8n templates",
      subtitle: "10 ready-to-import action workflows — one per real /api/v1 operation, generated from the same OpenAPI specification as the API collections.",
      noTriggerNotice: "Every template starts with a Manual Trigger (you click \"Execute workflow\") — none of them reacts automatically to a PUBLIC-MAP event: the event catalog doesn't support that for any customer-facing domain yet (see the event catalog design note).",
      setupTitle: "Before importing",
      setupSteps: [
        "Set the PUBLIC_MAP_BASE_URL environment variable on your n8n instance (e.g. https://app.public-map.com/api/v1).",
        "Set PUBLIC_MAP_API_KEY to a real API key created from the Developer Console.",
        "No key is ever embedded in a downloaded file — every template reads it from the n8n environment at execution time.",
      ],
      downloadAll: "Every file is also available under templates/n8n/ in the repository.",
    },
    makeScenariosPage: {
      title: "Make scenarios",
      subtitle: "10 ready-to-import action scenarios — one per real /api/v1 operation, generated from the same OpenAPI specification as the n8n templates and the API collections.",
      noTriggerNotice: "Each scenario holds a single HTTP module, run manually (\"Run once\") — none of them reacts automatically to a PUBLIC-MAP event: the event catalog doesn't support that for any customer-facing domain yet (see the event catalog design note).",
      setupTitle: "Before importing",
      setupSteps: [
        "Open the HTTP module and replace YOUR_PUBLIC_MAP_API_KEY in the Authorization header with a real API key created from the Developer Console.",
        "No key is ever embedded in a downloaded file — Make has no environment-variable equivalent at the blueprint level the way n8n does; see templates/make/README.md for the full technical explanation.",
        "Replace any YOUR_ID-style placeholder in the URL with a real value before running the scenario.",
      ],
      downloadAll: "Every file is also available under templates/make/ in the repository.",
    },
    airtableScriptsPage: {
      title: "Airtable scripts",
      subtitle: "10 action scripts for Airtable's \"Run a script\" automation action — one per real /api/v1 operation, generated from the same OpenAPI specification as the n8n templates and Make scenarios.",
      noImportNotice: "Airtable has no file-import mechanism for automations, unlike n8n and Make. Open a script below, copy its contents, and paste it into the \"Run a script\" step's code editor — see templates/airtable/README.md for the full breakdown of the differences from n8n and Make, including which trigger to use (never a webhook trigger).",
      setupTitle: "Before pasting a script",
      setupSteps: [
        "Create an Airtable automation with a trigger that never depends on a PUBLIC-MAP event — e.g. \"When a button is clicked\" (simplest for testing) or \"At a scheduled time.\"",
        "Add a \"Run a script\" step, paste the file's contents, then set the apiKey input variable to a real API key created from the Developer Console — never inside the script's source itself.",
        "Fill in any other input variable mentioned in the script's header (e.g. id, clientId) from a field on your table or a previous step.",
      ],
      downloadAll: "Every file is also available under templates/airtable/ in the repository.",
    },
    zapierAppPage: {
      title: "Zapier integration",
      subtitle: "A real Zapier Platform connector (3 triggers, 3 searches, 3 actions) — validated with Zapier's own official tool, prepared for a future submission.",
      notPublishedNotice: "This integration isn't published on Zapier yet — it lives under zapier/ in the repository, ready for zapier push once a real Zapier developer account is available. See zapier/README.md for the full picture.",
      triggersTitle: "Triggers",
      triggersAvailableTitle: "Available today (by polling)",
      triggersAvailable: [
        "New Audit — polls GET /audits",
        "New Client — polls GET /clients",
        "New Report — polls GET /reports",
      ],
      triggersImpossibleTitle: "Explicitly impossible at this stage",
      triggersImpossibleNotice: "No instant (webhook) trigger exists: that requires a customer-facing event in the event catalog, which today holds exactly one, strictly internal event (user.pending.created). No workaround was invented for this limitation — see the event catalog design note.",
      searchesTitle: "Searches",
      searches: ["Find an audit by ID", "Find a client by ID", "Find a report by ID"],
      createsTitle: "Actions",
      creates: ["Create a task (with an idempotency key)", "Log an interaction (with an idempotency key)", "Update a client"],
      validationTitle: "Real validation already run",
      validationNotice: "Validated with the official zapier-platform-cli tool: 25 checks passed, 0 failed, 0 publishing-blocking warnings. See zapier/README.md for the full output.",
      nextStepsTitle: "What's left only on the official Zapier platform",
      nextSteps: [
        "Registering the app (zapier register) — requires a real Zapier developer account",
        "Pushing the code (zapier push)",
        "Developer configuration in the Zapier dashboard (icon, category, public description)",
        "Human review and publication to Zapier's public App Directory",
      ],
    },
    roadmap: {
      title: "Public roadmap",
      subtitle: "What's already shipped, and what's coming — no date commitments.",
      shippedTitle: "Already shipped",
      shipped: [
        "API key authentication, scopes, strict organization isolation",
        "Reading audits, reports, and clients; creating tasks and interactions",
        "Cursor pagination, date filters, and text search",
        "Idempotency on write routes (Idempotency-Key)",
        "Rate limits and quotas per subscription plan, with tracking headers",
        "Complete OpenAPI 3.1 specification and this developer portal",
        "Official TypeScript/JavaScript and Python SDKs (pre-release)",
        "Postman, Bruno, and Insomnia collections, generated from the OpenAPI spec",
        "Self-service developer Console (API keys, quotas, activity log, members)",
        "Playground / API Explorer, code generation (cURL, JS, TS, Python, PHP, Go)",
        "Webhook test tools, signature verification, API key inspector",
        "Full self-service webhook endpoint management (creation, subscriptions, secrets, replay)",
        "Versioning & deprecation policy, public changelog, OAuth design note",
        "Design note for expanding the event catalog",
        "10 n8n action templates (one per /api/v1 operation), no trigger until the event catalog is actually expanded",
        "10 Make action scenarios, same scope as the n8n templates",
        "10 Airtable action scripts (for the \"Run a script\" step), same scope — not yet a packaged Airtable Extension",
        "Zapier integration (3 polling triggers, 3 searches, 3 actions), validated with Zapier's official tool — not yet published to the App Directory",
      ],
      upcomingTitle: "Coming up",
      upcoming: [
        "Actually expanding the event catalog (beyond user.pending.created) — would unlock instant Zapier triggers",
        "Packaged Airtable Extension (Marketplace) — beyond the action scripts already shipped",
        "Submitting and publishing the Zapier integration to the App Directory",
        "Integrations marketplace",
        "Usage and observability dashboard for /api/v1",
      ],
      disclaimer: "This roadmap reflects current priority order and may change without notice.",
    },
    security: {
      title: "Security",
      subtitle: "How PUBLIC-MAP protects the public API — an overview for integrators.",
      sections: {
        keys: {
          title: "API keys",
          body: "A key is never stored in plaintext server-side — only a hash is kept. It's shown in plaintext exactly once, at creation.",
        },
        isolation: {
          title: "Organization isolation",
          body: "The organization behind a request is always derived from the authenticated key itself — never from a caller-supplied identifier. Attempting to access another organization's resource returns the same “not found” response as a resource that doesn't exist at all, so nothing about what exists elsewhere is ever revealed.",
        },
        transport: {
          title: "Transport",
          body: "Every request must be made over HTTPS. No key or sensitive data is ever logged in plaintext on PUBLIC-MAP's side.",
        },
        limits: {
          title: "Rate limits and quotas",
          body: "Every key and every organization are subject to rate limits — see Rate limits & quotas.",
        },
        disclosure: {
          title: "Reporting a vulnerability",
          body: "If you believe you've found a security issue with the API, contact your PUBLIC-MAP contact directly rather than disclosing it publicly.",
        },
      },
    },
    versioningPolicy: {
      title: "Versioning & deprecation",
      subtitle: "How PUBLIC-MAP evolves its public API — draft policy, submitted for internal review.",
      draftNotice: "This document is a draft policy submitted for internal review. No major version transition has happened yet; the commitments below describe an intent, not yet a binding contract.",
      sections: {
        scheme: {
          title: "Versioning scheme",
          body: "The API is versioned in its URL path (/api/v1). The OpenAPI specification's \"version\" field (currently 1.4.0) follows semantic versioning and only increments for non-breaking changes within v1 — a breaking change would warrant a new path prefix (/api/v2), never a silent change to v1.",
        },
        nonBreaking: {
          title: "Non-breaking changes",
          body: "Considered non-breaking and publishable without notice: adding a new endpoint, adding an optional field to an existing response, adding a new value to an enum already documented as extensible, adding a new response header.",
        },
        breaking: {
          title: "Breaking changes",
          body: "Considered breaking, and therefore excluded from v1: removing or renaming a field, changing an existing field's type, removing an endpoint, changing an existing parameter's default behavior, tightening validation in a way that would reject requests accepted today.",
        },
        deprecation: {
          title: "Deprecation policy (draft)",
          body: "Proposed intent: a deprecated field, endpoint, or scope would remain functional for at least 90 days after being announced in the changelog, before any removal. This window and the signaling mechanism (a dedicated response header, a documentation notice) still need validation before the first real deprecation — none has happened to date.",
        },
        communication: {
          title: "Communicating changes",
          body: "Every change — breaking or not — is announced in the public changelog before being deployed to production. Non-breaking changes may ship directly; breaking changes would follow the notice period above.",
        },
      },
      changelogLink: "See the changelog →",
    },
    changelog: {
      title: "Changelog",
      subtitle: "History of the PUBLIC-MAP developer ecosystem — API, portal, SDKs, Console.",
      note: "This changelog documents the developer-ecosystem build program (portal, SDKs, Console, Playground, webhooks). Precise per-entry timestamps aren't tracked before this stage; the order reflects the real delivery sequence, most recent first. The OpenAPI specification's own version (currently 1.4.0) is called out separately when directly relevant.",
      entries: [
        {
          label: "Lifecycle policies & changelog",
          items: [
            "Versioning and deprecation policy (draft for review)",
            "Public changelog",
            "Design note for a future OAuth provider (not implemented)",
          ],
        },
        {
          label: "Self-service webhooks",
          items: [
            "Full webhook endpoint management in the Console: create, edit, delete, enable/disable",
            "Event subscriptions, secret rotation, delivery history with per-attempt detail",
            "Replay of a failed, abandoned, or skipped delivery",
            "Delivery worker scheduling (cron every 5 minutes)",
          ],
        },
        {
          label: "Interactive development environment",
          items: [
            "Playground / API Explorer built into the Console, with secure browser-side API key injection",
            "Automatic request generation in cURL, JavaScript, TypeScript, Python, PHP, and Go",
            "Ad-hoc webhook test tool and HMAC signature verifier",
            "API key format inspector",
          ],
        },
        {
          label: "Developer Console",
          items: [
            "Self-service API key management: create, rotate, revoke, rename, scopes",
            "Dashboard (integration, plan, quotas), activity log, member list",
          ],
        },
        {
          label: "SDKs & client tooling",
          items: [
            "Official TypeScript/JavaScript and Python SDKs",
            "Postman, Bruno, and Insomnia collections generated from the OpenAPI spec",
            "SDK usage guides and code examples",
          ],
        },
        {
          label: "Developer portal launch",
          items: [
            "Documentation, Quick Start, authentication, pagination, idempotency, rate limits & quotas, errors, FAQ guides",
            "Interactive OpenAPI reference",
            "Public roadmap and security page",
          ],
        },
      ],
    },
    oauthDesign: {
      title: "OAuth — design note",
      subtitle: "A delegated-authentication path for the public API — design only, none of this is implemented today.",
      notImplementedNotice: "No route, screen, or token described here exists in the current product. Authentication today remains exclusively the API key (see the Authentication guide). This document is a discussion basis before any development starts.",
      sections: {
        why: {
          title: "Why consider OAuth",
          body: "API keys suit an integration an admin installs for their own organization. OAuth (an authorization-code flow with PKCE) would become relevant if a third party — a partner-published application, for example — needs to connect on behalf of several different customer organizations, each consenting explicitly, without ever sharing an API key between them.",
        },
        rolesReversal: {
          title: "PUBLIC-MAP as provider, not client",
          body: "lib/google/oauth.ts implements PUBLIC-MAP as an OAuth client (a consumer of Google's API). This document considers the reverse: PUBLIC-MAP becoming an OAuth provider, issuing its own tokens to third-party applications — a structurally different role (a consent screen, a client registry, tokens to revoke) that reuses no code from that file beyond stylistic inspiration.",
        },
        scopes: {
          title: "Scopes",
          body: "Would directly reuse the same closed catalog as API keys (lib/integrations/governance.ts) — audits:read, reports:read, clients:read, clients:update, tasks:create, interactions:create — so a customer organization grants exactly the same granular permissions via OAuth consent as it does today via an API key, without duplicating the permission model.",
        },
        flow: {
          title: "Envisioned flow",
          steps: [
            "The third-party app redirects the user to a PUBLIC-MAP authorization screen, with the requested scopes",
            "The user, a member of a customer organization, picks which organization they're consenting on behalf of and approves (or denies) the requested scopes",
            "PUBLIC-MAP redirects back to the third-party app with a single-use authorization code",
            "The third-party app exchanges that code for a short-lived access token and a refresh token, via a server-to-server exchange with PKCE",
            "Every /api/v1 request authenticated with an OAuth token is scoped to the consenting organization — never another one — exactly like an API key today",
          ],
        },
        revocation: {
          title: "Revocation",
          body: "A member of the customer organization could revoke an OAuth consent at any time from the Developer Console, by direct analogy with revoking an existing API key, immediately invalidating the associated access and refresh tokens.",
        },
        openQuestions: {
          title: "Open questions before implementation",
          items: [
            "Third-party app registry: self-service sign-up or manual review by PUBLIC-MAP?",
            "Access token lifetime and refresh-token rotation policy",
            "Consent screen: reuse the existing Clerk UI or build a dedicated screen?",
            "Should a distinct scope mark delegated (OAuth) access apart from direct (API key) access in audit logs?",
          ],
        },
      },
    },
    eventCatalogDesign: {
      title: "Event catalog — design note",
      subtitle: "Which new events to add so future n8n / Make / Zapier templates are genuinely useful — design only, nothing here is implemented.",
      notImplementedNotice: "None of the events below exist in lib/integrations/governance.ts today. The real catalog holds exactly one event, user.pending.created, strictly internal. This document proposes candidates and their technical shape; implementing them remains a separate decision and a separate piece of work, not started here.",
      sections: {
        context: {
          title: "Why expand the catalog",
          body: "A single internal event is enough to notify PUBLIC-MAP staff of a pending sign-up, but supports no customer-facing automation scenario at all (\"when an audit is created, add a row to my spreadsheet\" on the n8n/Make/Zapier side). Future integration templates need at least a few real customer-facing triggers to be genuinely useful — that's the prerequisite this note aims to satisfy, without building the templates themselves.",
        },
        orgScopingWarning: {
          title: "Hard technical constraint: binding to the customer organization",
          body: "Verified during Stage 5: routing events to endpoints (lib/integrations/outbox.ts, fanOutEvent) requires an exact match between the event's organizationId and the subscribed integration's — user.pending.created is bound to PUBLIC-MAP's internal organization, which is exactly why a self-service endpoint created by a customer never receives it today. Any new customer-facing event MUST be enqueued with the real organizationId of the customer concerned — never null, never the internal organization — or it will never reach a single self-service endpoint.",
        },
        existingInfra: {
          title: "Infrastructure already in place, reused as-is",
          body: "enqueueIntegrationEvent (lib/integrations/outbox.ts) is already generic and ready to accept new event types with zero changes. A new event would only need one entry in INTEGRATION_EVENT_CATALOG (type, version, allowed fields, personal-data flag) and a single enqueueIntegrationEvent call added to the existing server action that triggers it — never a rewrite of the delivery engine (signing, retries, history, self-service — all stay untouched).",
        },
        separateAuditSystem: {
          title: "Out of scope for this proposal: the GBP Audit workflow",
          body: "The full GBP Audit workflow (lib/actions/gbp-audit.ts, gbpAudits statuses) lives in a separate Supabase database (db/audit-schema.ts) and already has its own independent webhook mechanism (lib/gbp-audit/webhooks.ts — a single, unsigned, non-multi-tenant n8n URL). Bridging it into the universal lib/integrations/ engine would require a technical bridge between two distinct databases — a design problem of its own, deliberately excluded here to stay within this stage's narrow scope.",
        },
        candidatesTitle: "Proposed candidate events",
        candidatesColumns: { event: "Event", trigger: "Real existing trigger", fields: "Proposed fields", notes: "Notes" },
        candidates: [
          { event: "client.created", trigger: "lib/actions/crm-clients.ts — createClient", fields: "clientId, name, stage, source", notes: "Organization derived from crmClients.organizationId — must be non-null to reach any endpoint." },
          { event: "client.stage_changed", trigger: "lib/actions/crm-clients.ts — updateClientStage", fields: "clientId, previousStage, stage", notes: "Useful for syncing an external pipeline (spreadsheet, third-party CRM)." },
          { event: "task.created", trigger: "lib/actions/crm-tasks.ts — createTask", fields: "taskId, clientId, title, dueDate", notes: "Mirrors POST /api/v1/tasks, already available for writes." },
          { event: "task.completed", trigger: "lib/actions/crm-tasks.ts — updateTaskStatus (status becomes \"done\")", fields: "taskId, clientId, title", notes: "Only fires on the transition to \"done\", not on every status change." },
          { event: "interaction.created", trigger: "lib/actions/crm-interactions.ts — createInteraction", fields: "interactionId, clientId, type", notes: "\"summary\" (free text) deliberately excluded by default — personal-data risk, to be decided before implementation." },
          { event: "subscription.status_changed", trigger: "lib/actions/billing.ts + app/api/webhooks/fastspring/route.ts", fields: "plan, previousStatus, status", notes: "P1 — touches billing; should priceEuros be exposed? Needs its own review." },
        ],
        namingAndVersioning: {
          title: "Naming and versioning convention",
          body: "Follows the one existing precedent: {domain}.{past-tense-transition} (e.g. client.created, task.completed), version 1 for every new type. A catalog entry is a reviewed contract change (see the existing comment on INTEGRATION_SCOPES in governance.ts) — never generated or added automatically.",
        },
        dataMinimization: {
          title: "Data minimization",
          body: "Every candidate event above proposes only fields already public through the matching /api/v1 read (e.g. the same fields as toClientDTO for client.*) — never a field absent from the public API itself. containsPersonalData would follow the same principle already used for user.pending.created: true as soon as a field (name, email, free-text summary) could identify a person.",
        },
        priority: {
          title: "Proposed prioritization",
          p0Title: "P0 — high value, narrow scope (main schema only)",
          p0: ["client.created", "client.stage_changed", "task.created", "task.completed", "interaction.created"],
          p1Title: "P1 — real value, needs a separate review before any decision",
          p1: ["subscription.status_changed"],
        },
        openQuestions: {
          title: "Open questions before implementation",
          items: [
            "Should interaction.summary (free text) be exposed, or only metadata (type, date)?",
            "Should subscription.status_changed expose priceEuros, or only plan/status?",
            "Would a backward-compatibility mechanism be needed if an existing scope were ever meant to gate a webhook event subscription (today, webhook subscriptions aren't tied to API key scopes)?",
            "Does bridging to the GBP Audit workflow (separate database) deserve its own dedicated design note in a future stage?",
          ],
        },
      },
    },
  },
} as const;
