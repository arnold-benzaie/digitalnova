(function () {
  "use strict";

  const projects = Array.isArray(window.PUBLIC_MAP_PROJECTS)
    ? window.PUBLIC_MAP_PROJECTS
    : [];
  const root = document.getElementById("projects");
  if (!root) return;

  const filtersHost = root.querySelector("[data-project-filters]");
  const grid = root.querySelector("[data-project-grid]");
  const dialog = document.getElementById("pm-project-dialog");
  const dialogImage = dialog?.querySelector("[data-dialog-image]");
  const dialogCategory = dialog?.querySelector("[data-dialog-category]");
  const dialogTitle = dialog?.querySelector("[data-dialog-title]");
  const dialogDescription = dialog?.querySelector("[data-dialog-description]");
  const dialogServices = dialog?.querySelector("[data-dialog-services]");
  const dialogClose = dialog?.querySelector("[data-dialog-close]");

  const filterLabels = Object.freeze({
    all: { fr: "Tous", en: "All" },
    "seo-local": { fr: "SEO local", en: "Local SEO" },
    "google-business": { fr: "Google Business", en: "Google Business" },
    "sites-web": { fr: "Sites web", en: "Websites" },
    "google-ads": { fr: "Google Ads", en: "Google Ads" },
    automation: { fr: "Automatisation", en: "Automation" },
    reporting: { fr: "Analyse", en: "Analytics" }
  });

  let activeFilter = "all";
  let lastTrigger = null;
  let currentProject = null;
  let revealObserver = null;

  function getLanguage() {
    return document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "fr";
  }

  function localize(value) {
    if (typeof value === "string") return value;
    return value?.[getLanguage()] || value?.fr || "";
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (typeof text === "string") element.textContent = text;
    return element;
  }

  function updateStaticCopy() {
    const language = getLanguage();
    root.querySelectorAll("[data-pm-fr][data-pm-en]").forEach((element) => {
      element.textContent = element.dataset[`pm${language === "en" ? "En" : "Fr"}`];
    });
    if (dialogClose) {
      dialogClose.setAttribute("aria-label", language === "en" ? "Close project details" : "Fermer le détail du projet");
    }
  }

  function createFilters() {
    if (!filtersHost) return;
    filtersHost.replaceChildren();
    Object.entries(filterLabels).forEach(([filter, labels]) => {
      const button = makeElement("button", "pm-project-filter", labels[getLanguage()]);
      button.type = "button";
      button.dataset.filter = filter;
      button.setAttribute("aria-pressed", String(filter === activeFilter));
      button.addEventListener("click", () => {
        activeFilter = filter;
        filtersHost.querySelectorAll("button").forEach((item) => {
          item.setAttribute("aria-pressed", String(item.dataset.filter === activeFilter));
        });
        renderCards();
      });
      filtersHost.appendChild(button);
    });
  }

  function observeCards() {
    const cards = grid?.querySelectorAll(".pm-project-card") || [];
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      cards.forEach((card) => card.classList.add("is-visible"));
      return;
    }
    revealObserver?.disconnect();
    revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: .14 });
    cards.forEach((card, index) => {
      card.style.transitionDelay = `${Math.min(index * 65, 260)}ms`;
      revealObserver.observe(card);
    });
  }

  function openProject(project, trigger) {
    if (!dialog || !dialogImage || !dialogCategory || !dialogTitle || !dialogDescription || !dialogServices) return;
    lastTrigger = trigger;
    currentProject = project;
    dialogImage.src = project.image;
    dialogImage.alt = localize(project.alt);
    dialogCategory.textContent = `${localize(project.category)} · ${getLanguage() === "en" ? "PUBLIC-MAP demonstration" : "Démonstration PUBLIC-MAP"}`;
    dialogTitle.textContent = localize(project.title);
    dialogDescription.textContent = localize(project.details);
    dialogServices.replaceChildren();
    project.services.forEach((service) => {
      dialogServices.appendChild(makeElement("li", "", localize(service)));
    });
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      window.requestAnimationFrame(() => dialogClose?.focus());
    }
  }

  function closeProject() {
    if (!dialog) return;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  function createCard(project) {
    const article = makeElement("article", "pm-project-card");
    article.dataset.projectId = project.id;

    const mediaButton = makeElement("button", "pm-project-media-button");
    mediaButton.type = "button";
    mediaButton.setAttribute("aria-label", `${getLanguage() === "en" ? "View details:" : "Voir le détail :"} ${localize(project.title)}`);
    const image = makeElement("img", "pm-project-media");
    image.src = project.image;
    image.alt = localize(project.alt);
    image.loading = "lazy";
    image.decoding = "async";
    image.width = 800;
    image.height = 500;
    mediaButton.appendChild(image);
    mediaButton.addEventListener("click", () => openProject(project, mediaButton));

    const body = makeElement("div", "pm-project-card-body");
    const meta = makeElement("div", "pm-project-meta");
    meta.append(
      makeElement("span", "pm-project-category", localize(project.category)),
      makeElement("span", "pm-project-demo", getLanguage() === "en" ? "PUBLIC-MAP demonstration" : "Démonstration PUBLIC-MAP")
    );
    const title = makeElement("h3", "pm-project-card-title", localize(project.title));
    const description = makeElement("p", "pm-project-card-description", localize(project.description));
    const detailButton = makeElement(
      "button",
      "pm-project-detail-button",
      getLanguage() === "en" ? "View the demonstration" : "Voir la démonstration"
    );
    detailButton.type = "button";
    detailButton.addEventListener("click", () => openProject(project, detailButton));
    body.append(meta, title, description, detailButton);
    article.append(mediaButton, body);
    return article;
  }

  function renderCards() {
    if (!grid) return;
    const visibleProjects = activeFilter === "all"
      ? projects
      : projects.filter((project) => project.filter === activeFilter);
    grid.replaceChildren();
    if (!visibleProjects.length) {
      grid.appendChild(makeElement(
        "p",
        "pm-project-empty",
        getLanguage() === "en" ? "No demonstration is available in this category yet." : "Aucune démonstration n’est encore disponible dans cette catégorie."
      ));
      return;
    }
    const fragment = document.createDocumentFragment();
    visibleProjects.forEach((project) => fragment.appendChild(createCard(project)));
    grid.appendChild(fragment);
    observeCards();
  }

  function refreshLanguage() {
    updateStaticCopy();
    createFilters();
    renderCards();
    if (currentProject && dialog?.open) openProject(currentProject, lastTrigger);
  }

  dialogClose?.addEventListener("click", closeProject);
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) closeProject();
  });
  dialog?.addEventListener("close", () => {
    lastTrigger?.focus();
    currentProject = null;
  });

  document.addEventListener("digitalnova:language-updated", refreshLanguage);
  new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.attributeName === "lang")) refreshLanguage();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  refreshLanguage();
})();
