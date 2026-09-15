"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import {
  addWorkforceMemberFromForm,
  inviteWorkforceMemberFromForm,
  type AssignableUser,
  type WorkforceAddErrorCode,
  type WorkforceInviteErrorCode,
} from "@/lib/actions/workforce-ui";
import type { ListedWorkforceRole } from "@/lib/actions/workforce";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { heroPrimaryButtonClass } from "@/components/admin/page-hero";

/** Structural (plain `string`, not the literal-French-typed dictionary) so
 * either locale's `workforce` slice is accepted — same pattern as
 * components/app-sidebar-nav.tsx's NavDict. */
type WorkforceErrorDict = {
  errorDuplicate: string;
  errorInvalidUser: string;
  errorInvalidRole: string;
  errorGeneric: string;
};
type ExistingUserFormError = WorkforceAddErrorCode | "GENERIC";

type WorkforceInviteErrorDict = {
  inviteErrorInvalidEmail: string;
  inviteErrorInvalidRole: string;
  inviteErrorSelfInvite: string;
  inviteErrorOwnerTarget: string;
  inviteErrorAlreadyMember: string;
  inviteErrorAlreadyPending: string;
  inviteErrorGeneric: string;
};
type InviteFormError = WorkforceInviteErrorCode | "GENERIC";

/**
 * Roles either dialog tab may offer. Typed `ListedWorkforceRole`
 * (Exclude<StaffRole,"OWNER">) so a stray "OWNER" fails `tsc`; the server
 * (addWorkforceMemberFromForm/inviteWorkforceMemberFromForm + their R2B/
 * WORKFORCE INVITATION V1 core) re-validates every submitted value.
 */
export const WORKFORCE_ROLE_OPTIONS: readonly ListedWorkforceRole[] = ["ADMIN", "MANAGER", "EMPLOYEE"];

/**
 * Pure: map a stable error code (or "GENERIC" / null) to localized copy.
 * Exported + side-effect-free so the branching is unit-tested directly —
 * this repo has no act()-capable React test harness (see
 * components/app-sidebar-nav.test.mjs).
 */
export function workforceAddErrorMessage(error: ExistingUserFormError | null, t: WorkforceErrorDict): string | null {
  switch (error) {
    case "DUPLICATE":
      return t.errorDuplicate;
    case "INVALID_USER":
      return t.errorInvalidUser;
    case "INVALID_ROLE":
      return t.errorInvalidRole;
    case "GENERIC":
      return t.errorGeneric;
    default:
      return null;
  }
}

/** Same shape as workforceAddErrorMessage() above, for the invite-by-email
 * tab's own stable error codes (WORKFORCE INVITATION V1). */
export function workforceInviteErrorMessage(error: InviteFormError | null, t: WorkforceInviteErrorDict): string | null {
  switch (error) {
    case "INVALID_EMAIL":
      return t.inviteErrorInvalidEmail;
    case "INVALID_ROLE":
      return t.inviteErrorInvalidRole;
    case "SELF_INVITE_NOT_ALLOWED":
      return t.inviteErrorSelfInvite;
    case "OWNER_TARGET":
      return t.inviteErrorOwnerTarget;
    case "ALREADY_WORKFORCE_MEMBER":
      return t.inviteErrorAlreadyMember;
    case "INVITATION_ALREADY_PENDING":
      return t.inviteErrorAlreadyPending;
    case "GENERIC":
      return t.inviteErrorGeneric;
    default:
      return null;
  }
}

/**
 * Pure: given the wrapper's result, decide the post-submit UI effects.
 *  - success (`undefined`)  -> clear error, close dialog, refresh
 *  - DUPLICATE              -> show inline error AND refresh (a concurrent
 *                             add made the picker stale) but keep the
 *                             dialog open
 *  - other error codes      -> show inline error only
 */
export function applyWorkforceAddResult(
  result: { error: WorkforceAddErrorCode } | undefined,
  actions: { setError: (e: ExistingUserFormError | null) => void; close: () => void; refresh: () => void },
): void {
  if (result?.error) {
    actions.setError(result.error);
    if (result.error === "DUPLICATE") actions.refresh();
    return;
  }
  actions.setError(null);
  actions.close();
  actions.refresh();
}

/** Same shape as applyWorkforceAddResult() above, for the invite-by-email
 * tab. INVITATION_ALREADY_PENDING also refreshes (a concurrent invite may
 * have just been sent), same rationale as DUPLICATE above. */
export function applyWorkforceInviteResult(
  result: { error: WorkforceInviteErrorCode } | undefined,
  actions: { setError: (e: InviteFormError | null) => void; close: () => void; refresh: () => void },
): void {
  if (result?.error) {
    actions.setError(result.error);
    if (result.error === "INVITATION_ALREADY_PENDING") actions.refresh();
    return;
  }
  actions.setError(null);
  actions.close();
  actions.refresh();
}

type DialogTab = "invite" | "existing";

export function AddWorkforceMemberForm({
  assignableUsers,
  hasMore,
  locale = "fr",
  initialTab = "invite",
}: {
  assignableUsers: AssignableUser[];
  hasMore: boolean;
  locale?: Locale;
  /** Which tab is active on first render. Defaults to "invite" (the
   * headline WORKFORCE INVITATION V1 capability) — exposed as a prop
   * (rather than hardcoded useState("invite")) so a static-markup test can
   * deterministically render either tab; this repo has no act()-capable
   * React harness to simulate a real tab-click (see
   * components/app-sidebar-nav.test.mjs). */
  initialTab?: DialogTab;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const existingFormRef = useRef<HTMLFormElement>(null);
  const inviteFormRef = useRef<HTMLFormElement>(null);
  const [tab, setTab] = useState<DialogTab>(initialTab);
  const [isPending, startTransition] = useTransition();
  const [existingError, setExistingError] = useState<ExistingUserFormError | null>(null);
  const [inviteError, setInviteError] = useState<InviteFormError | null>(null);
  const t = dictionaries[locale].workforce;
  const noEligibleUsers = assignableUsers.length === 0;
  const existingErrorMessage = workforceAddErrorMessage(existingError, t);
  const inviteErrorMessage = workforceInviteErrorMessage(inviteError, t);

  const roleLabel: Record<ListedWorkforceRole, string> = {
    ADMIN: t.roleAdmin,
    MANAGER: t.roleManager,
    EMPLOYEE: t.roleEmployee,
  };

  function openDialog() {
    setExistingError(null);
    setInviteError(null);
    setTab("invite");
    dialogRef.current?.showModal();
  }
  function closeDialog() {
    dialogRef.current?.close();
    existingFormRef.current?.reset();
    inviteFormRef.current?.reset();
    setExistingError(null);
    setInviteError(null);
  }
  function switchTab(next: DialogTab) {
    setTab(next);
    setExistingError(null);
    setInviteError(null);
  }

  return (
    <div>
      <button type="button" onClick={openDialog} className={heroPrimaryButtonClass}>
        {t.addMemberButton}
      </button>

      <dialog
        ref={dialogRef}
        onCancel={closeDialog}
        aria-labelledby="add-workforce-member-title"
        className="w-full max-w-md rounded-2xl border border-pm-gris-2 bg-white p-0 text-left text-pm-noir shadow-xl backdrop:bg-pm-noir/40"
      >
        <div className="flex flex-col gap-4 p-6">
          <div>
            <h2 id="add-workforce-member-title" className="font-serif text-xl font-semibold text-pm-noir">
              {t.addMemberTitle}
            </h2>
          </div>

          {/* Two clearly separated entry points — never a single ambiguous
              field mixing "pick an existing user" with "type an email".
              role="tablist" only for a11y labeling; each tab renders its
              own independent <form> with its own submit handler below. */}
          <div role="tablist" aria-label={t.addMemberTitle} className="flex gap-1 rounded-lg bg-pm-gris-2/40 p-1">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "invite"}
              onClick={() => switchTab("invite")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                tab === "invite" ? "bg-white text-pm-noir shadow-sm" : "text-pm-gris"
              }`}
            >
              {t.tabInviteEmail}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "existing"}
              onClick={() => switchTab("existing")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                tab === "existing" ? "bg-white text-pm-noir shadow-sm" : "text-pm-gris"
              }`}
            >
              {t.tabExistingUser}
            </button>
          </div>

          {tab === "invite" ? (
            <form
              ref={inviteFormRef}
              className="flex flex-col gap-4"
              aria-busy={isPending}
              action={(formData) =>
                startTransition(async () => {
                  setInviteError(null);
                  try {
                    const result = await inviteWorkforceMemberFromForm(formData);
                    applyWorkforceInviteResult(result, { setError: setInviteError, close: closeDialog, refresh: () => router.refresh() });
                  } catch (err) {
                    unstable_rethrow(err);
                    setInviteError("GENERIC");
                  }
                })
              }
            >
              <p className="text-sm text-pm-gris">{t.inviteDescription}</p>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="invite-email" className="text-xs font-medium uppercase tracking-wide text-pm-gris">
                  {t.inviteEmailLabel}
                </label>
                <input
                  id="invite-email"
                  name="email"
                  type="email"
                  required
                  placeholder={t.inviteEmailPlaceholder}
                  className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="invite-role" className="text-xs font-medium uppercase tracking-wide text-pm-gris">
                  {t.selectRoleLabel}
                </label>
                <select
                  id="invite-role"
                  name="role"
                  defaultValue="EMPLOYEE"
                  className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
                >
                  {WORKFORCE_ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel[r]}
                    </option>
                  ))}
                </select>
              </div>

              {inviteErrorMessage && (
                <p role="alert" className="text-sm text-pm-rouge">
                  {inviteErrorMessage}
                </p>
              )}

              <div className="mt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={isPending}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-pm-gris transition hover:text-pm-noir disabled:opacity-50"
                >
                  {dictionaries[locale].common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
                >
                  {isPending ? t.inviteSubmitting : t.inviteSubmitButton}
                </button>
              </div>
            </form>
          ) : (
            <form
              ref={existingFormRef}
              className="flex flex-col gap-4"
              aria-busy={isPending}
              action={(formData) =>
                startTransition(async () => {
                  setExistingError(null);
                  try {
                    const result = await addWorkforceMemberFromForm(formData);
                    applyWorkforceAddResult(result, { setError: setExistingError, close: closeDialog, refresh: () => router.refresh() });
                  } catch (err) {
                    unstable_rethrow(err);
                    setExistingError("GENERIC");
                  }
                })
              }
            >
              <p className="text-sm text-pm-gris">{t.addMemberDescription}</p>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="workforce-user" className="text-xs font-medium uppercase tracking-wide text-pm-gris">
                  {t.selectUserLabel}
                </label>
                <select
                  id="workforce-user"
                  name="userId"
                  required
                  defaultValue=""
                  disabled={noEligibleUsers}
                  className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 disabled:opacity-50"
                >
                  <option value="" disabled>
                    {t.selectUserPlaceholder}
                  </option>
                  {assignableUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
                </select>
                {noEligibleUsers && <p className="text-xs text-pm-gris">{t.errorNoEligibleUsers}</p>}
                {!noEligibleUsers && hasMore && <p className="text-xs text-pm-gris">{t.eligibleUsersLimited}</p>}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="workforce-role" className="text-xs font-medium uppercase tracking-wide text-pm-gris">
                  {t.selectRoleLabel}
                </label>
                <select
                  id="workforce-role"
                  name="role"
                  defaultValue="EMPLOYEE"
                  className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
                >
                  {WORKFORCE_ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel[r]}
                    </option>
                  ))}
                </select>
              </div>

              {existingErrorMessage && (
                <p role="alert" className="text-sm text-pm-rouge">
                  {existingErrorMessage}
                </p>
              )}

              <div className="mt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={isPending}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-pm-gris transition hover:text-pm-noir disabled:opacity-50"
                >
                  {dictionaries[locale].common.cancel}
                </button>
                <button
                  type="submit"
                  disabled={isPending || noEligibleUsers}
                  className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? t.submitting : t.submitButton}
                </button>
              </div>
            </form>
          )}
        </div>
      </dialog>
    </div>
  );
}
