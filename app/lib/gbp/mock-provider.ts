import type { GbpDailyMetric, GbpLocation, GbpProvider, GbpReview } from "./types";

const MOCK_LOCATIONS: GbpLocation[] = [
  {
    googleLocationId: "mock-loc-paris",
    name: "Public Maps — Paris Centre",
    address: "12 rue de Rivoli, 75004 Paris",
    category: "Agence de marketing",
  },
  {
    googleLocationId: "mock-loc-lyon",
    name: "Public Maps — Lyon Part-Dieu",
    address: "8 cours Lafayette, 69003 Lyon",
    category: "Agence de marketing",
  },
];

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
 * Stands in for the real Google Business Profile API client. No real
 * Google OAuth credentials or API access exist yet (empty
 * GOOGLE_CLIENT_ID/SECRET, API access request not filed — see README).
 * Data here is deterministic per location so repeated syncs stay stable.
 */
export class MockGbpProvider implements GbpProvider {
  async listLocations(): Promise<GbpLocation[]> {
    return MOCK_LOCATIONS;
  }

  async getMetrics(googleLocationId: string, days: number): Promise<GbpDailyMetric[]> {
    const rand = seededRandom(hashSeed(googleLocationId));
    const metrics: GbpDailyMetric[] = [];
    const today = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - i);
      metrics.push({
        date: date.toISOString().slice(0, 10),
        views: Math.round(80 + rand() * 60),
        calls: Math.round(4 + rand() * 8),
        directionRequests: Math.round(10 + rand() * 15),
        websiteClicks: Math.round(15 + rand() * 20),
      });
    }

    return metrics;
  }

  async getReviews(googleLocationId: string): Promise<GbpReview[]> {
    return [
      {
        googleReviewId: `${googleLocationId}-review-1`,
        authorName: "Camille D.",
        rating: 5,
        comment: "Excellent accompagnement, très réactifs !",
        publishedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      },
      {
        googleReviewId: `${googleLocationId}-review-2`,
        authorName: "Karim B.",
        rating: 4,
        comment: "Bon service, quelques délais de réponse.",
        publishedAt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      },
      {
        googleReviewId: `${googleLocationId}-review-3`,
        authorName: "Sophie L.",
        rating: 5,
        comment: "Équipe très professionnelle, je recommande.",
        publishedAt: new Date(Date.now() - 21 * 86_400_000).toISOString(),
      },
    ];
  }
}
