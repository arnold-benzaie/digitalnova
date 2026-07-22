export type GbpLocation = {
  googleLocationId: string;
  name: string;
  address: string;
  category: string;
  phone?: string;
  websiteUrl?: string;
};

export type GbpDailyMetric = {
  date: string; // ISO date (YYYY-MM-DD)
  views: number;
  calls: number;
  directionRequests: number;
  websiteClicks: number;
};

export type GbpReview = {
  googleReviewId: string;
  authorName: string;
  rating: number;
  comment: string;
  publishedAt: string; // ISO datetime
};

export interface GbpProvider {
  listLocations(): Promise<GbpLocation[]>;
  getMetrics(googleLocationId: string, days: number): Promise<GbpDailyMetric[]>;
  getReviews(googleLocationId: string): Promise<GbpReview[]>;
  /** Posts an owner reply to a review. Real Google Business Profile API:
   * PUT accounts/{}/locations/{}/reviews/{}/reply — see
   * https://developers.google.com/my-business/reference/rest when wiring a
   * real provider; the mock just accepts anything. */
  replyToReview(googleReviewId: string, replyText: string): Promise<void>;
}
