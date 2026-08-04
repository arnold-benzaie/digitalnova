"use client";

import { useState, useTransition } from "react";
import { saveFinding, updateFindingCorrectionStatus } from "@/lib/actions/gbp-audit-findings";
import {
  GBP_CORRECTION_STATUSES,
  GBP_FINDING_RESULTS,
  GBP_SEVERITIES,
  getCorrectionStatusLabel,
  getFindingResultLabel,
  getSeverityLabel,
  type GbpAuditCheckDefinition,
} from "@/lib/gbp-audit/checklist";
import { Field, Input, Select, Textarea } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";
import { correctionStatusTone, findingResultTone, SEMANTIC_DOT } from "@/lib/gbp-audit/status-colors";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export type FindingState = {
  id: string | null;
  result: string;
  severity: string | null;
  explanation: string | null;
  source: string | null;
  recommendation: string | null;
  ownerName: string | null;
  etaDays: number | null;
  correctionStatus: string;
  evidenceCount: number;
};

const EMPTY: FindingState = {
  id: null,
  result: "not_verifiable",
  severity: null,
  explanation: null,
  source: null,
  recommendation: null,
  ownerName: null,
  etaDays: null,
  correctionStatus: "detected",
  evidenceCount: 0,
};

export function FindingRow({
  auditId,
  sectionCode,
  check,
  initial,
  locale = "fr",
}: {
  auditId: string;
  sectionCode: string;
  check: GbpAuditCheckDefinition;
  initial: FindingState | null;
  locale?: Locale;
}) {
  const t = dictionaries[locale].auditModule.findingRow;
  const resultLabel = getFindingResultLabel(locale);
  const severityLabel = getSeverityLabel(locale);
  const correctionStatusLabel = getCorrectionStatusLabel(locale);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<FindingState>(initial ?? EMPTY);
  const [state, setState] = useState<FindingState>(initial ?? EMPTY);
  const [isPending, startTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);
  const [isStatusPending, startStatusTransition] = useTransition();

  const dirty = JSON.stringify(state) !== JSON.stringify(saved);
  const isSaved = justSaved || (!dirty && Boolean(state.id));

  function save() {
    startTransition(async () => {
      try {
        const result = await saveFinding({
          auditId,
          sectionCode,
          checkKey: check.key,
          result: state.result,
          severity: state.severity,
          explanation: state.explanation,
          source: state.source,
          recommendation: state.recommendation,
          ownerName: state.ownerName,
          etaDays: state.etaDays,
        });
        const withId = { ...state, id: result.findingId };
        setSaved(withId);
        setState(withId);
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
      } catch (err) {
        toast.error(t.saveError, err instanceof Error ? err.message : undefined);
      }
    });
  }

  function changeCorrectionStatus(status: string) {
    if (!state.id) return;
    const findingId = state.id;
    startStatusTransition(async () => {
      try {
        await updateFindingCorrectionStatus(findingId, auditId, status);
        setSaved((s) => ({ ...s, correctionStatus: status }));
        setState((s) => ({ ...s, correctionStatus: status }));
        toast.success(t.correctionStatusUpdated);
      } catch (err) {
        toast.error(t.correctionStatusUpdateError, err instanceof Error ? err.message : undefined);
      }
    });
  }

  return (
    <div className="rounded-lg border border-pm-gris-2 bg-white transition-shadow">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`${check.key}-panel`}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-noir/20 focus-visible:ring-inset"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${SEMANTIC_DOT[findingResultTone(state.result)]}`} aria-hidden="true" />
          <span className="truncate text-sm font-medium text-pm-noir">{check.label}</span>
          {state.evidenceCount > 0 && (
            <span className="shrink-0 rounded-full bg-pm-gris-2/50 px-2 py-0.5 text-[10px] text-pm-gris">{t.evidenceCount(state.evidenceCount)}</span>
          )}
          {dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pm-or" title={t.unsavedChanges} aria-label={t.unsavedChanges} />}
        </div>
        <span className="shrink-0 text-xs text-pm-gris">{resultLabel[state.result as keyof typeof resultLabel] ?? t.resultFallback}</span>
      </button>

      {open && (
        <div id={`${check.key}-panel`} className="animate-panel-in border-t border-pm-gris-2 p-4">
          <p className="mb-3 text-xs text-pm-gris">{check.guidance}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t.result} htmlFor={`${check.key}-result`}>
              <Select id={`${check.key}-result`} value={state.result} onChange={(e) => setState((s) => ({ ...s, result: e.target.value }))}>
                {GBP_FINDING_RESULTS.map((r) => (
                  <option key={r} value={r}>{resultLabel[r]}</option>
                ))}
              </Select>
            </Field>
            <Field label={t.severity} htmlFor={`${check.key}-severity`}>
              <Select id={`${check.key}-severity`} value={state.severity ?? ""} onChange={(e) => setState((s) => ({ ...s, severity: e.target.value || null }))}>
                <option value="">—</option>
                {GBP_SEVERITIES.map((sev) => (
                  <option key={sev} value={sev}>{severityLabel[sev]}</option>
                ))}
              </Select>
            </Field>
            <Field label={t.explanation} className="sm:col-span-2" htmlFor={`${check.key}-explanation`}>
              <Textarea id={`${check.key}-explanation`} rows={2} value={state.explanation ?? ""} onChange={(e) => setState((s) => ({ ...s, explanation: e.target.value || null }))} />
            </Field>
            <Field label={t.source} htmlFor={`${check.key}-source`}>
              <Input id={`${check.key}-source`} value={state.source ?? ""} onChange={(e) => setState((s) => ({ ...s, source: e.target.value || null }))} />
            </Field>
            <Field label={t.owner} htmlFor={`${check.key}-owner`}>
              <Input id={`${check.key}-owner`} value={state.ownerName ?? ""} onChange={(e) => setState((s) => ({ ...s, ownerName: e.target.value || null }))} />
            </Field>
            <Field label={t.recommendation} className="sm:col-span-2" htmlFor={`${check.key}-recommendation`}>
              <Textarea id={`${check.key}-recommendation`} rows={2} value={state.recommendation ?? ""} onChange={(e) => setState((s) => ({ ...s, recommendation: e.target.value || null }))} />
            </Field>
            <Field label={t.etaDays} htmlFor={`${check.key}-eta`}>
              <Input
                id={`${check.key}-eta`}
                type="number"
                min={0}
                value={state.etaDays ?? ""}
                onChange={(e) => setState((s) => ({ ...s, etaDays: e.target.value ? parseInt(e.target.value, 10) : null }))}
              />
            </Field>
            {state.result !== "compliant" && state.result !== "not_applicable" && (
              <Field
                label={t.correctionStatus}
                htmlFor={`${check.key}-correction-status`}
                hint={!state.id ? t.correctionStatusHint : undefined}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${SEMANTIC_DOT[correctionStatusTone(state.correctionStatus)]}`}
                    aria-hidden="true"
                  />
                  <Select
                    id={`${check.key}-correction-status`}
                    value={state.correctionStatus}
                    disabled={!state.id || isStatusPending}
                    onChange={(e) => changeCorrectionStatus(e.target.value)}
                  >
                    {GBP_CORRECTION_STATUSES.map((s) => (
                      <option key={s} value={s}>{correctionStatusLabel[s]}</option>
                    ))}
                  </Select>
                </div>
              </Field>
            )}
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button size="sm" loading={isPending} disabled={!dirty && !isPending} onClick={save}>
              {t.save}
            </Button>
            {isSaved && !isPending && (
              <span className="flex items-center gap-1 text-xs font-medium text-emerald-600">
                <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
                {t.saved}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
