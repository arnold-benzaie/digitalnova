import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { getRadarAiProviderPolicyPageData } from "@/lib/actions/radar-ai-policy-ui";
import { getRadarIntelligenceProviderStatus } from "@/lib/radar-intelligence/provider-status";
import { POLICY_CONFIGURABLE_PROVIDER_IDS, type PolicyConfigurableProviderId } from "@/lib/radar-intelligence/provider-policy";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero } from "@/components/admin/page-hero";
import { AiProviderPolicyForm, type ProviderStatusBadge } from "@/components/owner/ai-provider-policy-form";

/**
 * RADAR INTELLIGENCE V2.1 — Phase C — the OWNER-only AI provider policy
 * settings page.
 *
 * Authorization is the FIRST statement, before any data read or render,
 * and is the ONLY thing that decides access:
 * requireStaffMember("RADAR_AI_POLICY_MANAGE") — granted only to OWNER
 * (lib/rbac/permissions.ts), so ADMIN / MANAGER / EMPLOYEE, a caller with
 * no staff_members row, a suspended OWNER, and a membership scoped to a
 * non-internal workspace are all redirected to /admin by
 * requireStaffMember's existing contract. The sidebar's `canManageAiPolicy`
 * signal plays no part here.
 *
 * Reads the policy through getRadarAiProviderPolicyPageData() (Phase C's
 * thin wrapper over the Phase B action) — never a direct DB call from this
 * page, and never a write on render: an empty `radar_ai_provider_policy`
 * table renders the effective DEFAULT_PROVIDER_POLICY without ever
 * inserting a row (see provider-policy-store.ts's fail-closed read
 * contract). Provider technical status (getRadarIntelligenceProviderStatus)
 * is SYSTEM_ADMIN-gated internally — safe to call here because OWNER
 * already holds SYSTEM_ADMIN (lib/rbac/permissions.ts), so this never
 * expands that diagnostic's exposure to a role that didn't already have
 * it; only the non-secret `configured` boolean is surfaced, never a key,
 * env value, or raw error.
 */
export default async function AiProvidersOwnerPage() {
  await requireStaffMember("RADAR_AI_POLICY_MANAGE");

  const [{ policy, updatedAt }, status, locale] = await Promise.all([
    getRadarAiProviderPolicyPageData(),
    getRadarIntelligenceProviderStatus(),
    getLocale(),
  ]);
  const t = dictionaries[locale].aiProviderPolicy;

  const providerStatus: Partial<Record<PolicyConfigurableProviderId, ProviderStatusBadge>> = {};
  for (const id of POLICY_CONFIGURABLE_PROVIDER_IDS) {
    const entry = status.providers.find((p) => p.provider === id);
    providerStatus[id] = entry?.configured === undefined ? "UNKNOWN" : entry.configured ? "CONFIGURED" : "NOT_CONFIGURED";
  }

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />
      <AiProviderPolicyForm initialPolicy={policy} updatedAt={updatedAt} providerStatus={providerStatus} locale={locale} />
    </>
  );
}
