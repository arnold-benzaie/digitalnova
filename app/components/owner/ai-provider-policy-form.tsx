"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRadarAiProviderPolicyAction, resetRadarAiProviderPolicyAction, type RadarAiPolicyErrorCode } from "@/lib/actions/radar-ai-policy-ui";
import { POLICY_CONFIGURABLE_PROVIDER_IDS, type PolicyConfigurableProviderId, type ProviderPolicy } from "@/lib/radar-intelligence/provider-policy";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";
import { Field, Select } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";

/**
 * RADAR INTELLIGENCE V2.1 — Phase C/D — the OWNER-only provider-policy
 * settings form (/admin/owner/ai-providers).
 *
 * PRESENTATION + client-side pre-validation only. Every mutation goes
 * through the requireStaffMember("RADAR_AI_POLICY_MANAGE")-gated wrappers
 * in lib/actions/radar-ai-policy-ui.ts, which delegate to the
 * authoritative Phase B/D validation (validateProviderPolicyCandidate) —
 * this component cannot bypass a single server-side check. Client
 * validation exists only to prevent an obviously-invalid submission from
 * ever reaching the network; the server remains the single source of
 * truth and is re-checked on every save regardless of what this component
 * thinks is valid.
 *
 * `mode` stays fixed at "AUTO" — never rendered as an editable control:
 * resolveProviderPolicy() never actually reads `mode` (provider-policy.ts),
 * so exposing a "Manual" control here would be a control with zero real
 * effect — a fake feature this mission explicitly forbids presenting as
 * active. `allowUserSelection` / `userSelectableProviders` (Phase D), in
 * contrast, are NOW live/interactive here — Phase D wired a real,
 * per-request selector into the RADAR advisory surface
 * (components/crm/radar-intelligence-advisory.tsx) that these settings
 * actually control.
 */

export type ProviderStatusBadge = "CONFIGURED" | "NOT_CONFIGURED" | "UNKNOWN";

const PROVIDER_DISPLAY_KEYS: Record<PolicyConfigurableProviderId, "providerAnthropic" | "providerOpenAi"> = {
  anthropic: "providerAnthropic",
  openai: "providerOpenAi",
};

/** Canonical fixed order used only to derive the two-provider fallback
 * display — Phase E (a third+ provider) will need real reordering UI;
 * with exactly two providers today, the order is fully implied once the
 * default is known, so no separate editable list is built (mission:
 * "do not overbuild drag-and-drop unless already trivial"). */
const CANONICAL_ORDER: readonly PolicyConfigurableProviderId[] = POLICY_CONFIGURABLE_PROVIDER_IDS;

/** Pure: the fallback chain shown to the OWNER — every OTHER enabled
 * provider, in canonical order, after the default. Exported for testing. */
export function deriveFallbackOrder(
  enabledProviders: readonly PolicyConfigurableProviderId[],
  defaultProvider: PolicyConfigurableProviderId | null,
): PolicyConfigurableProviderId[] {
  const enabledSet = new Set(enabledProviders);
  const rest = CANONICAL_ORDER.filter((id) => enabledSet.has(id) && id !== defaultProvider);
  const head = defaultProvider && enabledSet.has(defaultProvider) ? [defaultProvider] : [];
  return [...head, ...rest];
}

export type FormState = {
  enabledProviders: PolicyConfigurableProviderId[];
  defaultProvider: PolicyConfigurableProviderId | null;
  fallbackEnabled: boolean;
  /** RADAR INTELLIGENCE V2.1 Phase D — the master switch for exposing a
   * per-request provider selector to users at all. */
  allowUserSelection: boolean;
  /** Subset of enabledProviders a user may explicitly request — always
   * checked in ADDITION to enabledProviders server-side, never instead
   * of it (provider-policy.ts). */
  userSelectableProviders: PolicyConfigurableProviderId[];
};

export type FormValidationError =
  | "errAtLeastOneEnabled"
  | "errDefaultMustBeEnabled"
  | "errSelectableMustBeEnabled"
  | "errAllowSelectionRequiresSelectable";

/** Pure: client-side validation-error KEYS (into the dictionary) for the
 * current form state — a strict SUBSET of what the server itself checks,
 * used only to disable Save / show inline hints. Exported for testing. */
export function validateFormState(state: FormState): FormValidationError[] {
  const errors: FormValidationError[] = [];
  if (state.enabledProviders.length === 0) errors.push("errAtLeastOneEnabled");
  if (state.defaultProvider !== null && !state.enabledProviders.includes(state.defaultProvider)) {
    errors.push("errDefaultMustBeEnabled");
  }
  // RADAR INTELLIGENCE V2.1 Phase D — rules 1/5/6 (mission "OWNER POLICY
  // — ACTIVATE PHASE D CONTROLS"): a selectable provider must also be
  // enabled, and turning selection ON requires at least one selectable
  // provider — a "live" selector with zero options is self-contradictory
  // (mirrors validateProviderPolicyCandidate's own new rule).
  if (!state.userSelectableProviders.every((id) => state.enabledProviders.includes(id))) {
    errors.push("errSelectableMustBeEnabled");
  }
  if (state.allowUserSelection && state.userSelectableProviders.length === 0) {
    errors.push("errAllowSelectionRequiresSelectable");
  }
  return errors;
}

/** Pure: builds the exact ProviderPolicy-shaped candidate this UI
 * submits — `mode` stays fixed "AUTO" (never editable; see this file's
 * own docstring for why). Exported for testing. */
export function buildCandidate(state: FormState): ProviderPolicy {
  const fallbackOrder = deriveFallbackOrder(state.enabledProviders, state.defaultProvider);
  return {
    mode: "AUTO",
    defaultProvider: state.defaultProvider,
    fallbackOrder,
    enabledProviders: [...state.enabledProviders],
    userSelectableProviders: [...state.userSelectableProviders],
    allowUserSelection: state.allowUserSelection,
    fallbackEnabled: state.fallbackEnabled,
  };
}

function policyToFormState(policy: ProviderPolicy): FormState {
  const isConfigurable = (id: string): id is PolicyConfigurableProviderId => (POLICY_CONFIGURABLE_PROVIDER_IDS as readonly string[]).includes(id);
  const enabled = policy.enabledProviders.filter(isConfigurable);
  const defaultProvider =
    policy.defaultProvider && enabled.includes(policy.defaultProvider as PolicyConfigurableProviderId)
      ? (policy.defaultProvider as PolicyConfigurableProviderId)
      : null;
  // Defensive: only ever surface a selectable provider that is BOTH a
  // known id AND currently enabled — a stored policy could in principle
  // have selectable-but-since-disabled entries (rule 4: "may remain
  // stored" when allowUserSelection was off); this form never presents
  // that as a valid-looking checked box.
  const userSelectableProviders = policy.userSelectableProviders.filter((id): id is PolicyConfigurableProviderId => isConfigurable(id) && enabled.includes(id));
  return { enabledProviders: enabled, defaultProvider, fallbackEnabled: policy.fallbackEnabled, allowUserSelection: policy.allowUserSelection, userSelectableProviders };
}

/** Structural (plain `string`) so either locale's `aiProviderPolicy` slice
 * is accepted — same pattern as admin-lifecycle-actions.tsx's AdminGovErrorDict. */
type AiPolicyErrorDict = { errGeneric: string };

function errorMessageFor(code: RadarAiPolicyErrorCode | null, t: AiPolicyErrorDict): string | null {
  if (code === "INVALID_POLICY") return t.errGeneric;
  return null;
}

export function AiProviderPolicyForm({
  initialPolicy,
  updatedAt,
  providerStatus,
  locale,
}: {
  initialPolicy: ProviderPolicy;
  updatedAt: string | null;
  providerStatus: Partial<Record<PolicyConfigurableProviderId, ProviderStatusBadge>>;
  locale: Locale;
}) {
  const t = dictionaries[locale].aiProviderPolicy;
  const router = useRouter();
  const { confirm, dialog } = useConfirmDialog(locale);

  const [state, setState] = useState<FormState>(() => policyToFormState(initialPolicy));
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<"save" | "reset" | null>(null);
  const [errorCode, setErrorCode] = useState<RadarAiPolicyErrorCode | null>(null);
  const [savedHint, setSavedHint] = useState<"saved" | "reset" | null>(null);

  const clientErrors = useMemo(() => validateFormState(state), [state]);
  const fallbackOrder = useMemo(() => deriveFallbackOrder(state.enabledProviders, state.defaultProvider), [state]);
  const canSave = clientErrors.length === 0 && !isPending;

  function toggleEnabled(id: PolicyConfigurableProviderId, next: boolean) {
    setSavedHint(null);
    setErrorCode(null);
    setState((prev) => {
      const enabledProviders = next ? [...new Set([...prev.enabledProviders, id])] : prev.enabledProviders.filter((p) => p !== id);
      // If the current default is being disabled, fall back to
      // Automatic rather than leaving an invalid selection in the form.
      const defaultProvider = prev.defaultProvider && !enabledProviders.includes(prev.defaultProvider) ? null : prev.defaultProvider;
      // RADAR INTELLIGENCE V2.1 Phase D — a disabled provider can never
      // stay selectable in the form either (rule 6): drop it from
      // userSelectableProviders in the SAME state update, so the two
      // controls never disagree even for one render.
      const userSelectableProviders = enabledProviders.includes(id) ? prev.userSelectableProviders : prev.userSelectableProviders.filter((p) => p !== id);
      return { ...prev, enabledProviders, defaultProvider, userSelectableProviders };
    });
  }

  function toggleSelectable(id: PolicyConfigurableProviderId, next: boolean) {
    setSavedHint(null);
    setErrorCode(null);
    setState((prev) => ({
      ...prev,
      userSelectableProviders: next ? [...new Set([...prev.userSelectableProviders, id])] : prev.userSelectableProviders.filter((p) => p !== id),
    }));
  }

  function toggleAllowUserSelection(next: boolean) {
    setSavedHint(null);
    setErrorCode(null);
    // Turning selection OFF deliberately keeps whatever was already
    // selected (mission rule 4: "may remain stored") — re-enabling later
    // restores the OWNER's previous choice without re-selecting.
    setState((prev) => ({ ...prev, allowUserSelection: next }));
  }

  function handleSave() {
    setErrorCode(null);
    startTransition(async () => {
      setPendingAction("save");
      const result = await saveRadarAiProviderPolicyAction(buildCandidate(state));
      setPendingAction(null);
      if (result.ok) {
        setSavedHint("saved");
        setState(policyToFormState(result.policy));
        router.refresh();
      } else {
        setErrorCode(result.error);
      }
    });
  }

  async function handleReset() {
    const ok = await confirm({ title: t.resetConfirmTitle, description: t.resetConfirmBody, confirmLabel: t.resetConfirmLabel });
    if (!ok) return;
    setErrorCode(null);
    startTransition(async () => {
      setPendingAction("reset");
      const result = await resetRadarAiProviderPolicyAction();
      setPendingAction(null);
      if (result.ok) {
        setSavedHint("reset");
        setState(policyToFormState(result.policy));
        router.refresh();
      } else {
        setErrorCode(result.error);
      }
    });
  }

  const errorMessage = errorMessageFor(errorCode, t);

  return (
    <div className="flex flex-col gap-6" aria-busy={isPending}>
      {dialog}

      <div className="rounded-xl border border-pm-gris-2 bg-pm-g-blue/5 p-4 text-sm text-pm-noir">
        <p>{t.infoDeterministic}</p>
        <p>{t.infoOptional}</p>
        <p>{t.infoSecrets}</p>
        <p>{t.infoScope}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-pm-noir">{t.sectionProviders}</h2>
        {POLICY_CONFIGURABLE_PROVIDER_IDS.map((id) => {
          const status = providerStatus[id] ?? "UNKNOWN";
          const statusLabel = status === "CONFIGURED" ? t.statusConfigured : status === "NOT_CONFIGURED" ? t.statusNotConfigured : t.statusUnknown;
          return (
            <label key={id} className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-pm-gris-2 p-3">
              <div>
                <p className="text-sm font-medium text-pm-noir">{t[PROVIDER_DISPLAY_KEYS[id]]}</p>
                <p className="text-xs text-pm-gris">{statusLabel}</p>
              </div>
              <span className="flex items-center gap-2">
                <span className="text-xs text-pm-gris">{t.enabledLabel}</span>
                <input
                  type="checkbox"
                  checked={state.enabledProviders.includes(id)}
                  disabled={isPending}
                  onChange={(e) => toggleEnabled(id, e.target.checked)}
                  className="h-5 w-5 shrink-0 rounded border-pm-gris-2 accent-pm-bleu-eu"
                />
              </span>
            </label>
          );
        })}
        {clientErrors.includes("errAtLeastOneEnabled") && (
          <p role="alert" className="text-xs font-medium text-pm-rouge">
            {t.errAtLeastOneEnabled}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-pm-noir">{t.sectionRouting}</h2>

        <Field label={t.modeLabel}>
          <p className="rounded-lg border border-pm-gris-2 bg-pm-gris-2/10 px-3 py-2 text-sm text-pm-gris">{t.modeAutomatic}</p>
        </Field>

        <Field label={t.defaultProviderLabel} error={clientErrors.includes("errDefaultMustBeEnabled") ? t.errDefaultMustBeEnabled : undefined}>
          <Select
            value={state.defaultProvider ?? ""}
            disabled={isPending}
            onChange={(e) => {
              setSavedHint(null);
              const value = e.target.value;
              setState((prev) => ({ ...prev, defaultProvider: value === "" ? null : (value as PolicyConfigurableProviderId) }));
            }}
          >
            <option value="">{t.defaultProviderAutoHint}</option>
            {state.enabledProviders.map((id) => (
              <option key={id} value={id}>
                {t[PROVIDER_DISPLAY_KEYS[id]]}
              </option>
            ))}
          </Select>
        </Field>

        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="text-sm text-pm-noir">{t.fallbackEnabledLabel}</span>
          <input
            type="checkbox"
            checked={state.fallbackEnabled}
            disabled={isPending}
            onChange={(e) => {
              setSavedHint(null);
              setState((prev) => ({ ...prev, fallbackEnabled: e.target.checked }));
            }}
            className="h-5 w-5 shrink-0 rounded border-pm-gris-2 accent-pm-bleu-eu"
          />
        </label>

        <Field label={t.fallbackOrderLabel} hint={t.fallbackOrderHint}>
          <p className="rounded-lg border border-pm-gris-2 bg-pm-gris-2/10 px-3 py-2 text-sm text-pm-gris">
            {fallbackOrder.length > 0 ? fallbackOrder.map((id) => t[PROVIDER_DISPLAY_KEYS[id]]).join(" → ") : "—"}
          </p>
        </Field>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-pm-gris-2 p-4">
        <h2 className="text-sm font-semibold text-pm-noir">{t.sectionUserSelection}</h2>
        <p className="text-xs text-pm-gris">{t.userSelectionNote}</p>
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="text-sm text-pm-noir">{t.allowUserSelectionLabel}</span>
          <input
            type="checkbox"
            checked={state.allowUserSelection}
            disabled={isPending}
            onChange={(e) => toggleAllowUserSelection(e.target.checked)}
            className="h-5 w-5 shrink-0 rounded border-pm-gris-2 accent-pm-bleu-eu"
          />
        </label>
        {clientErrors.includes("errAllowSelectionRequiresSelectable") && (
          <p role="alert" className="text-xs font-medium text-pm-rouge">
            {t.errAllowSelectionRequiresSelectable}
          </p>
        )}
        <div>
          <p className="mb-1 text-xs text-pm-gris">{t.selectableProvidersLabel}</p>
          <div className="flex gap-4">
            {POLICY_CONFIGURABLE_PROVIDER_IDS.map((id) => {
              const enabled = state.enabledProviders.includes(id);
              return (
                <label key={id} className={`flex items-center gap-2 text-sm text-pm-noir ${enabled ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                  <input
                    type="checkbox"
                    checked={state.userSelectableProviders.includes(id)}
                    disabled={isPending || !enabled}
                    onChange={(e) => toggleSelectable(id, e.target.checked)}
                    className="h-4 w-4 rounded border-pm-gris-2 accent-pm-bleu-eu"
                  />
                  {t[PROVIDER_DISPLAY_KEYS[id]]}
                </label>
              );
            })}
          </div>
          {clientErrors.includes("errSelectableMustBeEnabled") && (
            <p role="alert" className="mt-1 text-xs font-medium text-pm-rouge">
              {t.errSelectableMustBeEnabled}
            </p>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="primary" size="md" disabled={!canSave} loading={isPending && pendingAction === "save"} onClick={handleSave}>
          {isPending && pendingAction === "save" ? t.savingButton : t.saveButton}
        </Button>
        <Button type="button" variant="danger" size="md" disabled={isPending} loading={isPending && pendingAction === "reset"} onClick={handleReset}>
          {t.resetButton}
        </Button>
        {savedHint === "saved" && <span className="text-xs text-pm-gris">{t.savedHint}</span>}
        {savedHint === "reset" && <span className="text-xs text-pm-gris">{t.resetHint}</span>}
        {errorMessage && (
          <p role="alert" className="text-xs font-medium text-pm-rouge">
            {errorMessage}
          </p>
        )}
      </div>

      <p className="text-xs text-pm-gris">
        {t.lastUpdatedLabel}: {updatedAt ? formatDateTime(updatedAt, locale) : t.lastUpdatedNever}
      </p>
      {updatedAt === null && <p className="text-xs text-pm-gris">{t.usingDefaultBadge}</p>}
    </div>
  );
}
