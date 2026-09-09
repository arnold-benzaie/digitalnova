import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getClientStageOptions, getTaskStatusOptions } from "@/components/crm/badges";

/**
 * PHASE EMPLOYEE-OPS (Slice 2) — presentation helpers shared by the
 * components/employee/* sections of /admin/crm/my-work.
 *
 * The "My Work" sections deliberately never link to a per-prospect route
 * by id: no client / task / interaction UUID may reach the rendered
 * markup (mission §"Do not render"). A prospect link therefore points at
 * the existing /admin/crm/clients list pre-filtered by the prospect's
 * NAME (its `?q=` param), which carries the operator to the same place
 * without exposing an identifier.
 */
export function prospectSearchHref(name: string): string {
  return `/admin/crm/clients?q=${encodeURIComponent(name)}`;
}

function labelFrom(options: ReadonlyArray<{ value: string; label: string }>, value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export function stageLabel(stage: string, locale: Locale): string {
  return labelFrom(getClientStageOptions(locale), stage);
}

export function taskStatusLabel(status: string, locale: Locale): string {
  return labelFrom(getTaskStatusOptions(locale), status);
}

export function interactionTypeLabel(type: string, locale: Locale): string {
  return labelFrom(dictionaries[locale].crm.interactions.typeOptions, type);
}
