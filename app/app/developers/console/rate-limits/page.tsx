import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getApiKeyUsageWindows, getOrgPlanSummary, listApiKeysForOrg } from "@/lib/developer-console/queries";
import { FadeIn } from "@/components/developer-portal/motion/fade-in";

function nextWindowReset(windowSeconds: number): string {
  const windowMs = windowSeconds * 1000;
  const nowMs = Date.now();
  const resetMs = Math.ceil(nowMs / windowMs) * windowMs;
  return new Date(resetMs).toISOString();
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const barClass = pct >= 90 ? "bg-destructive" : pct >= 70 ? "bg-pm-or" : "bg-pm-g-green";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * Rate Limits page (Stage 4 of the developer-platform plan) — surfaces
 * real, already-tracked usage (lib/api-v1/rate-limit.ts's fixed-window
 * counters, same source as the X-RateLimit and X-Quota response headers)
 * per active key, per organization-wide plan. Only the two windows that
 * actually exist today (minute, day) — no fabricated "per hour" tier.
 */
export default async function DeveloperConsoleRateLimitsPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const t = dictionaries[locale].developerConsole.rateLimits;

  const [planSummary, keys] = await Promise.all([getOrgPlanSummary(session.organizationId), listApiKeysForOrg(session.organizationId)]);
  const activeKeys = keys.filter((key) => key.status === "active");
  const usageByKeyId = new Map(
    await Promise.all(
      activeKeys.map(async (key) => [key.id, await getApiKeyUsageWindows(key.id, session.organizationId, planSummary.limits)] as const),
    ),
  );

  const minuteReset = nextWindowReset(60);
  const dayReset = nextWindowReset(86_400);

  return (
    <FadeIn className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      {activeKeys.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="font-serif text-lg font-semibold text-foreground">{t.empty}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {activeKeys.map((key) => {
            const usage = usageByKeyId.get(key.id);
            if (!usage) return null;
            return (
              <div key={key.id} className="rounded-2xl border border-border bg-card p-5">
                <p className="font-serif text-lg font-semibold text-foreground">{key.name || `${t.unnamedKey} (${key.keyPrefix})`}</p>
                <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-muted-foreground">{t.perMinute}</span>
                      <span className="font-mono text-foreground">
                        {usage.perMinute.used} / {usage.perMinute.limit}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <UsageBar used={usage.perMinute.used} limit={usage.perMinute.limit} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.remaining}: {usage.perMinute.remaining} · {t.resetsAt} {new Date(minuteReset).toLocaleTimeString(locale)}
                    </p>
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-muted-foreground">{t.perDay}</span>
                      <span className="font-mono text-foreground">
                        {usage.perDay.used} / {usage.perDay.limit}
                      </span>
                    </div>
                    <div className="mt-1.5">
                      <UsageBar used={usage.perDay.used} limit={usage.perDay.limit} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t.remaining}: {usage.perDay.remaining} · {t.resetsAt} {new Date(dayReset).toLocaleString(locale)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </FadeIn>
  );
}
