"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { addWorkforceMemberFromForm, type AssignableUser, type WorkforceAddErrorCode } from "@/lib/actions/workforce-ui";
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
type FormError = WorkforceAddErrorCode | "GENERIC";

/**
 * Roles the dialog may offer. Typed `ListedWorkforceRole`
 * (Exclude<StaffRole,"OWNER">) so a stray "OWNER" fails `tsc`; the server
 * (addWorkforceMemberFromForm + R2B) re-validates every submitted value.
 */
export const WORKFORCE_ROLE_OPTIONS: readonly ListedWorkforceRole[] = ["ADMIN", "MANAGER", "EMPLOYEE"];

/**
 * Pure: map a stable error code (or "GENERIC" / null) to localized copy.
 * Exported + side-effect-free so the branching is unit-tested directly —
 * this repo has no act()-capable React test harness (see
 * components/app-sidebar-nav.test.mjs).
 */
export function workforceAddErrorMessage(error: FormError | null, t: WorkforceErrorDict): string | null {
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
  actions: { setError: (e: FormError | null) => void; close: () => void; refresh: () => void },
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

export function AddWorkforceMemberForm({
  assignableUsers,
  hasMore,
  locale = "fr",
}: {
  assignableUsers: AssignableUser[];
  hasMore: boolean;
  locale?: Locale;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<FormError | null>(null);
  const t = dictionaries[locale].workforce;
  const noEligibleUsers = assignableUsers.length === 0;
  const errorMessage = workforceAddErrorMessage(error, t);

  const roleLabel: Record<ListedWorkforceRole, string> = {
    ADMIN: t.roleAdmin,
    MANAGER: t.roleManager,
    EMPLOYEE: t.roleEmployee,
  };

  function openDialog() {
    setError(null);
    dialogRef.current?.showModal();
  }
  function closeDialog() {
    dialogRef.current?.close();
    formRef.current?.reset();
    setError(null);
  }

  return (
    <div>
      <button
        type="button"
        onClick={openDialog}
        disabled={noEligibleUsers}
        className={`${heroPrimaryButtonClass} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {t.addMemberButton}
      </button>
      {noEligibleUsers && <p className="mt-1 text-xs text-white/85">{t.errorNoEligibleUsers}</p>}

      <dialog
        ref={dialogRef}
        onCancel={closeDialog}
        aria-labelledby="add-workforce-member-title"
        className="w-full max-w-md rounded-2xl border border-pm-gris-2 bg-white p-0 text-left text-pm-noir shadow-xl backdrop:bg-pm-noir/40"
      >
        <form
          ref={formRef}
          className="flex flex-col gap-4 p-6"
          aria-busy={isPending}
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              try {
                const result = await addWorkforceMemberFromForm(formData);
                applyWorkforceAddResult(result, { setError, close: closeDialog, refresh: () => router.refresh() });
              } catch (err) {
                // The action is awaited inside a manual try/catch, so a
                // redirect() control-flow signal lands here — rethrow it so
                // Next can still navigate (repo convention).
                unstable_rethrow(err);
                setError("GENERIC");
              }
            })
          }
        >
          <div>
            <h2 id="add-workforce-member-title" className="font-serif text-xl font-semibold text-pm-noir">
              {t.addMemberTitle}
            </h2>
            <p className="mt-1 text-sm text-pm-gris">{t.addMemberDescription}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="workforce-user" className="text-xs font-medium uppercase tracking-wide text-pm-gris">
              {t.selectUserLabel}
            </label>
            <select
              id="workforce-user"
              name="userId"
              required
              defaultValue=""
              className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
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
            {hasMore && <p className="text-xs text-pm-gris">{t.eligibleUsersLimited}</p>}
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

          {errorMessage && (
            <p role="alert" className="text-sm text-pm-rouge">
              {errorMessage}
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
              {isPending ? t.submitting : t.submitButton}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
