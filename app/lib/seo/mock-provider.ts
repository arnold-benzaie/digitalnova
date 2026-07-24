import type {
  SeoAnalyticsSnapshot,
  SeoKeywordRanking,
  SeoProvider,
  SeoSearchConsoleSnapshot,
  SeoTechnicalAuditResult,
  SeoTechnicalIssue,
} from "./types";

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) % 233280;
  }
  return hash || 1;
}

function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

/**
 * Stands in for a real crawler + PageSpeed/Search Console/Analytics API
 * client. No Google Search Console / Analytics credentials exist yet
 * (GOOGLE_CLIENT_ID/SECRET are still placeholders — see README), so every
 * method here returns deterministic, seeded-per-URL data instead of
 * crawling the real site or calling a real Google API. Data is stable per
 * URL (and per URL+keyword) so repeated audits/checks stay consistent.
 */
export class MockSeoProvider implements SeoProvider {
  async runTechnicalAudit(url: string): Promise<SeoTechnicalAuditResult> {
    const rand = seededRandom(hashSeed(url));
    const issues: SeoTechnicalIssue[] = [];
    let score = 100;

    const hasTitle = rand() > 0.15;
    const titleTooLong = hasTitle && rand() > 0.7;
    const hasMetaDescription = rand() > 0.25;
    const h1Roll = rand();
    const h1Count = h1Roll > 0.85 ? 0 : h1Roll > 0.7 ? 2 : 1;
    const indexable = rand() > 0.1;
    const sitemapFound = rand() > 0.2;
    const robotsTxtFound = rand() > 0.15;

    let pageTitle: string | null = null;
    if (!hasTitle) {
      score -= 15;
      issues.push({
        category: "metadata",
        title: "Balise <title> manquante",
        description: "Aucune balise <title> détectée sur la page d'accueil.",
        priority: "high",
        recommendation: "Ajouter un titre unique et descriptif (50-60 caractères) sur chaque page.",
      });
    } else {
      pageTitle = titleTooLong
        ? "Un titre bien trop long qui dépasse largement la limite recommandée par les moteurs de recherche"
        : "Titre de la page — exemple optimisé";
      if (titleTooLong) {
        score -= 5;
        issues.push({
          category: "metadata",
          title: "Titre trop long",
          description: "Le titre dépasse 60 caractères et sera tronqué dans les résultats de recherche.",
          priority: "medium",
          recommendation: "Raccourcir le titre à 50-60 caractères en gardant les mots-clés principaux au début.",
        });
      }
    }

    let metaDescription: string | null = null;
    if (!hasMetaDescription) {
      score -= 10;
      issues.push({
        category: "metadata",
        title: "Meta description manquante",
        description: "Aucune meta description détectée — Google génère un extrait automatique moins engageant.",
        priority: "medium",
        recommendation: "Rédiger une meta description unique de 120-155 caractères par page.",
      });
    } else {
      metaDescription = "Exemple de meta description optimisée pour le référencement naturel.";
    }

    if (h1Count === 0) {
      score -= 10;
      issues.push({
        category: "headings",
        title: "Aucun H1 détecté",
        description: "La page ne contient aucun titre H1.",
        priority: "medium",
        recommendation: "Ajouter un H1 unique résumant le sujet principal de la page.",
      });
    } else if (h1Count > 1) {
      score -= 5;
      issues.push({
        category: "headings",
        title: "Plusieurs balises H1",
        description: `${h1Count} balises H1 détectées sur la même page.`,
        priority: "low",
        recommendation: "Ne conserver qu'un seul H1 par page et utiliser des H2/H3 pour la hiérarchie.",
      });
    }

    if (!indexable) {
      score -= 30;
      issues.push({
        category: "indexability",
        title: "Page non indexable",
        description: "Une balise noindex ou une règle robots empêche l'indexation de cette page.",
        priority: "high",
        recommendation: "Retirer la balise noindex si l'indexation est souhaitée et vérifier robots.txt.",
      });
    }

    if (!sitemapFound) {
      score -= 10;
      issues.push({
        category: "sitemap",
        title: "sitemap.xml introuvable",
        description: "Aucun fichier sitemap.xml détecté à la racine du site.",
        priority: "medium",
        recommendation: "Générer un sitemap.xml et le déclarer dans Google Search Console.",
      });
    }

    if (!robotsTxtFound) {
      score -= 5;
      issues.push({
        category: "robots",
        title: "robots.txt introuvable",
        description: "Aucun fichier robots.txt détecté à la racine du site.",
        priority: "low",
        recommendation: "Ajouter un robots.txt pour contrôler explicitement le crawl.",
      });
    }

    if (issues.length === 0) {
      issues.push({
        category: "performance",
        title: "Bonnes pratiques de base respectées",
        description: "Aucun problème technique majeur détecté sur cette page.",
        priority: "low",
        recommendation: "Continuer à surveiller les Core Web Vitals et la fraîcheur du contenu.",
      });
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      summary: `Audit technique généré automatiquement (données simulées) pour ${url}.`,
      pageTitle,
      metaDescription,
      h1Count,
      indexable,
      sitemapFound,
      robotsTxtFound,
      issues,
    };
  }

  async checkKeywordRankings(url: string, keywords: string[]): Promise<SeoKeywordRanking[]> {
    return keywords.map((keyword) => {
      const rand = seededRandom(hashSeed(`${url}:${keyword}`));
      const found = rand() > 0.2;
      return {
        keyword,
        position: found ? Math.round(1 + rand() * 99) : null,
        searchEngine: "google",
      };
    });
  }

  async fetchSearchConsoleSnapshot(url: string): Promise<SeoSearchConsoleSnapshot> {
    const rand = seededRandom(hashSeed(`gsc:${url}`));
    const impressions = Math.round(500 + rand() * 4000);
    const clicks = Math.round(impressions * (0.01 + rand() * 0.06));
    return {
      impressions,
      clicks,
      averagePosition: Math.round((5 + rand() * 40) * 10) / 10,
      ctrPercent: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : 0,
    };
  }

  async fetchAnalyticsSnapshot(url: string): Promise<SeoAnalyticsSnapshot> {
    const rand = seededRandom(hashSeed(`ga:${url}`));
    return {
      sessions: Math.round(200 + rand() * 1500),
      pageviews: Math.round(400 + rand() * 3000),
      bounceRatePercent: Math.round((30 + rand() * 40) * 10) / 10,
      avgSessionSeconds: Math.round(30 + rand() * 180),
    };
  }
}
