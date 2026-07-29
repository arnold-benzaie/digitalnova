import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { INTEGRATION_SCOPES } from "@/lib/integrations/governance";
import { getApiKeyUsageWindows, getIntegrationForOrg, getOrgPlanSummary, listApiKeysForOrg } from "@/lib/developer-console/queries";
import { IntegrationCard } from "@/components/developer-console/integration-card";
import { PlanCard } from "@/components/developer-console/plan-card";
import { ApiKeysManager, type DeveloperApiKeyRow } from "@/components/developer-console/api-keys-manager";
import { FadeIn } from "@/components/developer-portal/motion/fade-in";

export default async function DeveloperConsoleDashboardPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const t = dictionaries[locale].developerConsole.dashboard;

  const [integration, planSummary, keys] = await Promise.all([
    getIntegrationForOrg(session.organizationId),
    getOrgPlanSummary(session.organizationId),
    listApiKeysForOrg(session.organizationId),
  ]);

  const activeKeys = keys.filter((key) => key.status === "active");
  const usageByKeyId = new Map(
    await Promise.all(
      activeKeys.map(async (key) => [key.id, await getApiKeyUsageWindows(key.id, session.organizationId, planSummary.limits)] as const),
    ),
  );

  const rows: DeveloperApiKeyRow[] = keys.map((key) => ({
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    scopes: key.scopes,
    status: key.status,
    lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
    lastUsedIp: key.lastUsedIp,
    expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
    createdAt: key.createdAt.toISOString(),
    usage: usageByKeyId.get(key.id) ?? {
      perMinute: { limit: planSummary.limits.requestsPerMinute, used: 0, remaining: planSummary.limits.requestsPerMinute },
      perDay: { limit: planSummary.limits.requestsPerDay, used: 0, remaining: planSummary.limits.requestsPerDay },
    },
  }));

  return (
    <FadeIn className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle(session.organizationName)}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <IntegrationCard
          integration={integration ? { name: integration.name, status: integration.status, createdAt: integration.createdAt.toISOString() } : null}
          locale={locale}
        />
        <PlanCard summary={planSummary} locale={locale} />
      </div>

      <ApiKeysManager initialKeys={rows} scopes={INTEGRATION_SCOPES} locale={locale} />
    </FadeIn>
  );
}
