(function () {
  "use strict";

  const copy = (fr, en) => Object.freeze({ fr, en });

  window.PUBLIC_MAP_PROJECTS = Object.freeze([
    Object.freeze({
      id: "google-business-workspace",
      filter: "google-business",
      category: copy("Google Business Profile", "Google Business Profile"),
      title: copy("Espace de pilotage Google Business", "Google Business management workspace"),
      description: copy(
        "Prototype d’un espace clair pour organiser les informations d’établissement, les contenus locaux et les prochaines optimisations.",
        "Prototype of a clear workspace for organising business information, local content and upcoming optimisations."
      ),
      details: copy(
        "Cette démonstration illustre une méthode de travail : centraliser les informations essentielles, vérifier leur cohérence et préparer un calendrier d’amélioration. Elle ne représente pas les données d’un client réel.",
        "This demonstration illustrates a working method: centralising essential information, checking consistency and preparing an improvement schedule. It does not represent real client data."
      ),
      image: "assets/images/projects/google-business-profile.svg",
      alt: copy(
        "Démonstration d’un espace de gestion Google Business Profile PUBLIC-MAP",
        "Demonstration of a PUBLIC-MAP Google Business Profile management workspace"
      ),
      services: [
        copy("Cohérence des informations", "Information consistency"),
        copy("Planification locale", "Local planning"),
        copy("Suivi des actions", "Action tracking")
      ]
    }),
    Object.freeze({
      id: "local-seo-audit",
      filter: "seo-local",
      category: copy("SEO local", "Local SEO"),
      title: copy("Audit de présence locale", "Local presence audit"),
      description: copy(
        "Maquette d’un audit qui structure les priorités techniques, les pages locales et les opportunités de contenu.",
        "Mock-up of an audit that structures technical priorities, local pages and content opportunities."
      ),
      details: copy(
        "La vue présente un exemple de restitution sans score commercial, pour montrer comment les observations peuvent être classées par thème et transformées en plan d’action.",
        "The view presents a sample report without commercial scores, showing how observations can be grouped by topic and turned into an action plan."
      ),
      image: "assets/images/projects/local-seo.svg",
      alt: copy(
        "Démonstration d’un audit SEO local organisé par priorités",
        "Demonstration of a local SEO audit organised by priority"
      ),
      services: [
        copy("Audit technique", "Technical audit"),
        copy("Pages géolocalisées", "Location pages"),
        copy("Plan de contenu", "Content plan")
      ]
    }),
    Object.freeze({
      id: "responsive-showcase",
      filter: "sites-web",
      category: copy("Création de sites web", "Website creation"),
      title: copy("Vitrine digitale responsive", "Responsive digital showcase"),
      description: copy(
        "Concept de site vitrine pensé pour présenter une activité avec clarté sur ordinateur, tablette et mobile.",
        "Website concept designed to present a business clearly across desktop, tablet and mobile."
      ),
      details: copy(
        "Cette démonstration met l’accent sur la hiérarchie du contenu, la lisibilité mobile, les appels à l’action et une base technique sobre.",
        "This demonstration focuses on content hierarchy, mobile readability, calls to action and a lean technical foundation."
      ),
      image: "assets/images/projects/website-creation.svg",
      alt: copy(
        "Démonstration d’un site web PUBLIC-MAP sur plusieurs formats d’écran",
        "Demonstration of a PUBLIC-MAP website across multiple screen sizes"
      ),
      services: [
        copy("UX responsive", "Responsive UX"),
        copy("Développement web", "Web development"),
        copy("Optimisation technique", "Technical optimisation")
      ]
    }),
    Object.freeze({
      id: "ads-campaign-structure",
      filter: "google-ads",
      category: copy("Google Ads", "Google Ads"),
      title: copy("Structure de campagne publicitaire", "Advertising campaign structure"),
      description: copy(
        "Exemple d’organisation d’une campagne par intention, groupes d’annonces et étapes de contrôle budgétaire.",
        "Example of a campaign organised by intent, ad groups and budget-control stages."
      ),
      details: copy(
        "Le visuel présente une architecture de travail générique. Aucun budget, résultat ou compte publicitaire réel n’est affiché.",
        "The visual presents a generic working structure. No real budget, result or advertising account is displayed."
      ),
      image: "assets/images/projects/google-ads.svg",
      alt: copy(
        "Démonstration de structure de campagne Google Ads sans données client",
        "Demonstration of a Google Ads campaign structure without client data"
      ),
      services: [
        copy("Architecture de campagne", "Campaign architecture"),
        copy("Mots-clés", "Keywords"),
        copy("Contrôle budgétaire", "Budget control")
      ]
    }),
    Object.freeze({
      id: "n8n-lead-workflow",
      filter: "automation",
      category: copy("Automatisation n8n", "n8n automation"),
      title: copy("Flux de qualification des demandes", "Request qualification workflow"),
      description: copy(
        "Démonstration d’un flux reliant un formulaire, une étape de validation et des actions de suivi à configurer.",
        "Demonstration of a workflow connecting a form, a validation step and follow-up actions to configure."
      ),
      details: copy(
        "Le scénario est volontairement non connecté. Il montre les étapes possibles d’une future automatisation sans prétendre envoyer des données ni des notifications.",
        "The scenario is intentionally disconnected. It shows possible steps for a future automation without claiming to send data or notifications."
      ),
      image: "assets/images/projects/n8n-automation.svg",
      alt: copy(
        "Démonstration d’un workflow d’automatisation n8n PUBLIC-MAP",
        "Demonstration of a PUBLIC-MAP n8n automation workflow"
      ),
      services: [
        copy("Cartographie du flux", "Workflow mapping"),
        copy("Validation des données", "Data validation"),
        copy("Préparation CRM", "CRM preparation")
      ]
    }),
    Object.freeze({
      id: "reporting-dashboard",
      filter: "reporting",
      category: copy("Analyse et reporting", "Analytics and reporting"),
      title: copy("Tableau de bord de suivi", "Monitoring dashboard"),
      description: copy(
        "Modèle de reporting qui rassemble des indicateurs, des observations et les prochaines actions dans une vue lisible.",
        "Reporting model that brings indicators, observations and next actions together in a readable view."
      ),
      details: copy(
        "Les graphiques sont purement illustratifs et ne contiennent aucun chiffre de performance. La démonstration porte sur la présentation et la méthode de lecture.",
        "The charts are purely illustrative and contain no performance figures. The demonstration focuses on presentation and reading method."
      ),
      image: "assets/images/projects/reporting.svg",
      alt: copy(
        "Démonstration d’un tableau de bord de reporting sans chiffres de performance",
        "Demonstration of a reporting dashboard without performance figures"
      ),
      services: [
        copy("Organisation des indicateurs", "Metric organisation"),
        copy("Lecture des tendances", "Trend review"),
        copy("Plan d’action", "Action plan")
      ]
    })
  ]);
})();
