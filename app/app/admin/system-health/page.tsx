import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { systemHealthChecks } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { AdminPageHero, panelClass, panelTitleClass } from "@/components/admin/page-hero";
import { KpiCard } from "@/components/gbp-audit/ui/kpi-card";

const RECENT_CHECKS_LIMIT = 30;

/** Admin/staff only — never shown to clients, never linked from any
 * client-facing page. Reads only; this page performs no mutation. */
export default async function SystemHealthPage() {
  await requireStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].systemHealth;

  const since24h = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);

  const [latest, checks24h, recentChecks, lastRecovery] = await Promise.all([
    db.select().from(systemHealthChecks).where(eq(systemHealthChecks.service, "database")).orderBy(desc(systemHealthChecks.createdAt)).limit(1),
    db
      .select()
      .from(systemHealthChecks)
      .where(and(eq(systemHealthChecks.service, "database"), gte(systemHealthChecks.createdAt, since24h))),
    db
      .select()
      .from(systemHealthChecks)
      .where(eq(systemHealthChecks.service, "database"))
      .orderBy(desc(systemHealthChecks.createdAt))
      .limit(RECENT_CHECKS_LIMIT),
    db
      .select({ createdAt: systemHealthChecks.createdAt })
      .from(systemHealthChecks)
      .where(and(eq(systemHealthChecks.service, "database"), eq(systemHealthChecks.status, "healthy"), isNotNull(systemHealthChecks.alertSentAt)))
      .orderBy(desc(systemHealthChecks.createdAt))
      .limit(1),
  ]);

  const current = latest[0];
  const emaxconnCount = checks24h.filter((c) => c.errorCategory === "connection_exhausted").length;
  const failedCount = checks24h.filter((c) => c.status !== "healthy").length;

  const statusTone = current?.status === "healthy" ? "good" : current?.status === "degraded" ? "warm" : current ? "bad" : "neutral";
  const statusLabel = current
    ? current.status === "healthy"
      ? t.statusHealthy
      : current.status === "degraded"
        ? t.statusDegraded
        : t.statusUnhealthy
    : t.noCheckYet;

  const statusBadgeClass: Record<string, string> = {
    healthy: "bg-pm-g-green/10 text-pm-g-green",
    degraded: "bg-pm-or/10 text-pm-or",
    unhealthy: "bg-pm-rouge/10 text-pm-rouge-2",
  };

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label={t.currentStatus} value={statusLabel} tone={statusTone} />
        <KpiCard label={t.lastCheck} value={current ? formatDateTime(current.createdAt, locale) : "—"} tone="neutral" />
        <KpiCard label={t.currentLatency} value={current?.latencyMs != null ? `${current.latencyMs}ms` : "—"} tone="neutral" />
        <KpiCard label={t.incidents24h} value={failedCount} tone={failedCount > 0 ? "warm" : "good"} />
        <KpiCard label={t.emaxconnCount} value={emaxconnCount} tone={emaxconnCount > 0 ? "bad" : "good"} />
        <KpiCard label={t.lastRecovery} value={lastRecovery[0] ? formatDateTime(lastRecovery[0].createdAt, locale) : t.neverRecovered} tone="neutral" />
      </div>

      <div className={`${panelClass} mt-6`}>
        <h2 className={panelTitleClass}>{t.recentChecksTitle}</h2>
        {recentChecks.length === 0 ? (
          <p className="mt-3 text-sm text-pm-gris">{t.noCheckYet}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-3 py-2">{t.columnTime}</th>
                  <th className="px-3 py-2">{t.columnStatus}</th>
                  <th className="px-3 py-2">{t.columnLatency}</th>
                  <th className="px-3 py-2">{t.columnError}</th>
                </tr>
              </thead>
              <tbody>
                {recentChecks.map((check) => (
                  <tr key={check.id} className="border-t border-pm-gris-2">
                    <td className="px-3 py-2 text-pm-gris">{formatDateTime(check.createdAt, locale)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusBadgeClass[check.status] ?? "bg-pm-gris-2/60 text-pm-gris"}`}>
                        {check.status === "healthy" ? t.statusHealthy : check.status === "degraded" ? t.statusDegraded : t.statusUnhealthy}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-pm-noir">{check.latencyMs != null ? `${check.latencyMs}ms` : t.noError}</td>
                    <td className="px-3 py-2 text-pm-gris">{check.errorCategory ?? t.noError}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
