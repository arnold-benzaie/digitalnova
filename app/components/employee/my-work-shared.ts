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

/**
 * Deep link to the canonical client-detail route — the ONE place in the My
 * Work UI where a client id appears, and only inside an href to the
 * established, self-guarded `/admin/crm/clients/[id]` navigation model
 * (mission §11). Used for the "add a follow-up" / "add an interaction"
 * shortcuts so the operator lands on the existing secure authoring
 * workflow instead of a duplicated form. `section` targets an on-page
 * anchor ("suivis" for the follow-up section).
 */
export function clientDetailHref(clientId: string, section?: string): string {
  return `/admin/crm/clients/${clientId}${section ? `#${section}` : ""}`;
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
