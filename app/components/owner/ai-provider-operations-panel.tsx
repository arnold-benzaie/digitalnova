"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRadarAiProviderModelAction, type RadarAiModelErrorCode } from "@/lib/actions/radar-ai-provider-ops-ui";
import type { ProviderOperationsStatus } from "@/lib/actions/radar-ai-provider-ops";
import type { CredentialOperationsCapability } from "@/lib/radar-intelligence/credential-operations";
import { POLICY_CONFIGURABLE_PROVIDER_IDS, type PolicyConfigurableProviderId } from "@/lib/radar-intelligence/provider-policy";
import type { ProviderModelDefinition } from "@/lib/radar-intelligence/model-catalog";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { Field, Select } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";

/**
 * RADAR INTELLIGENCE V2.1 — Phase E — the OWNER-only "Provider
 * operations" panel (/admin/owner/ai-providers): safe credential STATUS
 * (never the credential itself) and MODEL selection, kept as a SEPARATE
 * section from AiProviderPolicyForm's ROUTING policy — the four concepts
 * (enablement / credential / model / routing) never mix in this UI, only
 * model selection is ever mutated from here.
 *
 * Every mutation goes through the requireStaffMember("RADAR_AI_POLICY_MANAGE")
 * -gated wrapper in lib/actions/radar-ai-provider-ops-ui.ts, which
 * delegates to the authoritative model-catalog validation
 * (isKnownModelId) — this component cannot submit an arbitrary model id;
 * the <select> options are built exclusively from the server-provided
 * catalog.
 *
 * `credentialStatus` never renders anything but "Configured" /
 * "Not configured" — no key, no prefix, no length, no hash. Credential
 * rotation renders fixed, non-interactive text (no button at all) when
 * `credentialOperationsCapability === "external-only"`, per this
 * mission's explicit "no dead fake functionality" rule.
 */

const PROVIDER_LABELS: Record<PolicyConfigurableProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export function AiProviderOperationsPanel({
  initialStatus,
  modelCatalog,
  credentialOperationsCapability,
  locale,
}: {
  initialStatus: ProviderOperationsStatus[];
  modelCatalog: Record<PolicyConfigurableProviderId, ProviderModelDefinition[]>;
  credentialOperationsCapability: CredentialOperationsCapability;
  locale: Locale;
}) {
  const t = dictionaries[locale].aiProviderOperations;
  const router = useRouter();

  const [status, setStatus] = useState<ProviderOperationsStatus[]>(initialStatus);
  const [selectedModel, setSelectedModel] = useState<Partial<Record<PolicyConfigurableProviderId, string>>>({});
  const [isPending, startTransition] = useTransition();
  const [pendingProvider, setPendingProvider] = useState<PolicyConfigurableProviderId | null>(null);
  const [errorByProvider, setErrorByProvider] = useState<Partial<Record<PolicyConfigurableProviderId, RadarAiModelErrorCode>>>({});
  const [savedProvider, setSavedProvider] = useState<PolicyConfigurableProviderId | null>(null);

  function statusFor(id: PolicyConfigurableProviderId): ProviderOperationsStatus | undefined {
    return status.find((s) => s.providerId === id);
  }

  function currentModelValue(id: PolicyConfigurableProviderId): string {
    return selectedModel[id] ?? statusFor(id)?.model ?? "";
  }

  function handleSave(id: PolicyConfigurableProviderId) {
    const modelId = currentModelValue(id);
    if (!modelId) return;
    setSavedProvider(null);
    setErrorByProvider((prev) => ({ ...prev, [id]: undefined }));
    startTransition(async () => {
      setPendingProvider(id);
      const result = await saveRadarAiProviderModelAction(id, modelId);
      setPendingProvider(null);
      if (result.ok) {
        setStatus(result.status);
        setSelectedModel((prev) => ({ ...prev, [id]: undefined }));
        setSavedProvider(id);
        router.refresh();
      } else {
        setErrorByProvider((prev) => ({ ...prev, [id]: result.error }));
      }
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-pm-gris-2 p-4">
      <div>
        <h2 className="text-sm font-semibold text-pm-noir">{t.sectionTitle}</h2>
        <p className="text-xs text-pm-gris">{t.sectionSubtitle}</p>
      </div>

      {POLICY_CONFIGURABLE_PROVIDER_IDS.map((id) => {
        const s = statusFor(id);
        const catalog = modelCatalog[id] ?? [];
        const operationalLabel =
          s?.operationalState === "ready"
            ? t.operationalStateReady
            : s?.operationalState === "configuration_issue"
              ? t.operationalStateConfigurationIssue
              : t.operationalStateUnknown;
        const error = errorByProvider[id];

        return (
          <div key={id} className="flex flex-col gap-2 rounded-lg border border-pm-gris-2 p-3">
            <p className="text-sm font-medium text-pm-noir">{PROVIDER_LABELS[id]}</p>

            <div className="grid grid-cols-2 gap-2 text-xs text-pm-gris sm:grid-cols-4">
              <span>
                {t.credentialLabel}: {s?.credentialStatus === "configured" ? t.credentialConfigured : t.credentialNotConfigured}
              </span>
              <span>
                {t.enabledLabel}: {s?.enabled ? t.enabledYes : t.enabledNo}
              </span>
              <span>
                {t.operationalStateLabel}: {operationalLabel}
              </span>
            </div>

            <Field label={t.modelLabel} hint={s?.modelIsOverridden ? t.modelOverriddenHint : undefined}>
              <Select
                value={currentModelValue(id)}
                disabled={isPending}
                onChange={(e) => {
                  setSavedProvider(null);
                  setErrorByProvider((prev) => ({ ...prev, [id]: undefined }));
                  setSelectedModel((prev) => ({ ...prev, [id]: e.target.value }));
                }}
              >
                {catalog.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="flex items-center gap-3">
              <Button type="button" variant="primary" size="sm" disabled={isPending} loading={isPending && pendingProvider === id} onClick={() => handleSave(id)}>
                {isPending && pendingProvider === id ? t.savingModelButton : t.saveModelButton}
              </Button>
              {savedProvider === id && <span className="text-xs text-pm-gris">{t.modelSavedHint}</span>}
              {error && (
                <p role="alert" className="text-xs font-medium text-pm-rouge">
                  {t.errInvalidModelUpdate}
                </p>
              )}
            </div>
          </div>
        );
      })}

      <div className="rounded-lg border border-pm-gris-2 bg-pm-gris-2/10 p-3">
        <p className="text-xs font-medium text-pm-noir">{t.credentialOperationsTitle}</p>
        {credentialOperationsCapability === "external-only" && <p className="text-xs text-pm-gris">{t.credentialOperationsExternalOnly}</p>}
      </div>
    </section>
  );
}
