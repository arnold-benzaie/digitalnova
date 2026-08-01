export type AuditIssue = {
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
  recommendation: string;
};

export type AuditResult = {
  score: number;
  summary: string;
  issues: AuditIssue[];
};

export type AuditInput = {
  locationName: string;
  /** Average per location per day (already normalized by day count × location count). */
  metrics: { views: number; calls: number; directionRequests: number };
  reviewCount: number;
  averageRating: number;
};

export type OnboardingSummary = { summary: string; nextStep: string };

export interface AIProvider {
  generateAudit(input: AuditInput): Promise<AuditResult>;
  summarizeOnboarding(answers: Record<string, string>): Promise<OnboardingSummary>;
}
