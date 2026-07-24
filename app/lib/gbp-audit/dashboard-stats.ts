const DAY_MS = 24 * 60 * 60 * 1000;

export const DASHBOARD_PERIOD_OPTIONS = [7, 14, 30, 90] as const;
export type DashboardPeriodDays = (typeof DASHBOARD_PERIOD_OPTIONS)[number];

export function isDashboardPeriodDays(value: unknown): value is DashboardPeriodDays {
  return DASHBOARD_PERIOD_OPTIONS.includes(value as DashboardPeriodDays);
}

/** Cutoff for the dashboard's "audits over time" query — kept out of app/admin/audit/page.tsx so the impure Date.now() call isn't inside a component body. */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

export function buildAuditsOverTimeSeries(rows: { createdAt: Date }[], days: number): { date: string; count: number }[] {
  const byDay = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY_MS);
    byDay.set(d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }), 0);
  }
  for (const row of rows) {
    const key = new Date(row.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  return Array.from(byDay.entries()).map(([date, count]) => ({ date, count }));
}
