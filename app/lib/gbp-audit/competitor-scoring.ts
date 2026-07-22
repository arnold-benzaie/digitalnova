export type ComparableProfile = {
  rating: number | null; // basis points, 450 = 4.5
  reviewCount: number | null;
  photoCount: number | null;
  postsRecent: boolean | null;
};

export type MetricComparison = {
  metric: "rating" | "reviewCount" | "photoCount" | "postsRecent";
  ours: number | boolean | null;
  theirs: number | boolean | null;
  verdict: "ahead" | "behind" | "tied" | "unknown";
};

export type CompetitorComparison = {
  metrics: MetricComparison[];
  overallVerdict: "ahead" | "behind" | "tied" | "unknown";
  aheadCount: number;
  behindCount: number;
};

function compareNumber(ours: number | null, theirs: number | null): MetricComparison["verdict"] {
  if (ours === null || theirs === null) return "unknown";
  if (ours > theirs) return "ahead";
  if (ours < theirs) return "behind";
  return "tied";
}

function compareBoolean(ours: boolean | null, theirs: boolean | null): MetricComparison["verdict"] {
  if (ours === null || theirs === null) return "unknown";
  if (ours === theirs) return "tied";
  return ours ? "ahead" : "behind";
}

/** Compares our business's current profile numbers against one competitor's, metric by metric, plus an overall verdict. */
export function compareToCompetitor(ours: ComparableProfile, theirs: ComparableProfile): CompetitorComparison {
  const metrics: MetricComparison[] = [
    { metric: "rating", ours: ours.rating, theirs: theirs.rating, verdict: compareNumber(ours.rating, theirs.rating) },
    { metric: "reviewCount", ours: ours.reviewCount, theirs: theirs.reviewCount, verdict: compareNumber(ours.reviewCount, theirs.reviewCount) },
    { metric: "photoCount", ours: ours.photoCount, theirs: theirs.photoCount, verdict: compareNumber(ours.photoCount, theirs.photoCount) },
    { metric: "postsRecent", ours: ours.postsRecent, theirs: theirs.postsRecent, verdict: compareBoolean(ours.postsRecent, theirs.postsRecent) },
  ];

  const known = metrics.filter((m) => m.verdict !== "unknown");
  const aheadCount = known.filter((m) => m.verdict === "ahead").length;
  const behindCount = known.filter((m) => m.verdict === "behind").length;

  let overallVerdict: CompetitorComparison["overallVerdict"] = "unknown";
  if (known.length > 0) {
    if (aheadCount > behindCount) overallVerdict = "ahead";
    else if (behindCount > aheadCount) overallVerdict = "behind";
    else overallVerdict = "tied";
  }

  return { metrics, overallVerdict, aheadCount, behindCount };
}
