"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveUser } from "@/lib/actions/users";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

const APPROVAL_ROLES = ["client", "agent", "supervisor", "admin"] as const;

export function ApproveUserModal({
  userId,
  personLabel,
  organizations,
  locale,
  triggerLabel,
}: {
  userId: string;
  personLabel: string;
  organizations: { id: string; name: string }[];
  locale: Locale;
  triggerLabel: string;
}) {
  const t = dictionaries[locale].adminUsers.approveModal;
  const confirmAdminText = dictionaries[locale].adminUsers.confirm.adminRole;
  const instanceId = useId();
  const organizationFieldId = `approve-organization-${instanceId}`;
  const roleFieldId = `approve-role-${instanceId}`;
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [adminConfirmed, setAdminConfirmed] = useState(false);

  function open() {
    setError(null);
    setRole("");
    setAdminConfirmed(false);
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
    formRef.current?.reset();
    setError(null);
    setAdminConfirmed(false);
  }

  const isAdminRole = role === "admin";
  const submitDisabled = isPending || (isAdminRole && !adminConfirmed);

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="rounded-lg bg-pm-noir px-3 py-1.5 text-xs font-medium text-white transition hover:bg-pm-noir-2"
      >
        {triggerLabel}
      </button>

      <dialog
        ref={dialogRef}
        onCancel={close}
        className="w-full max-w-md rounded-2xl border border-pm-gris-2 bg-white p-0 shadow-xl backdrop:bg-pm-noir/40"
      >
        <form
          ref={formRef}
          className="flex flex-col gap-4 p-6"
          action={(formData) => {
            if (formData.get("role") === "admin") {
              formData.set("confirmAdmin", adminConfirmed ? "true" : "false");
            }
            startTransition(async () => {
              setError(null);
              try {
                await approveUser(formData);
                close();
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
              }
            });
          }}
        >
          <div>
            <h2 className="font-serif text-xl font-semibold text-pm-noir">{t.title}</h2>
            <p className="mt-1 text-sm text-pm-gris">{personLabel}</p>
          </div>

          <input type="hidden" name="userId" value={userId} />

          <div className="flex flex-col gap-1.5">
            <label htmlFor={organizationFieldId} className="text-xs font-medium uppercase tracking-wide text-pm-gris">
              {t.organizationLabel}
            </label>
            <select
              id={organizationFieldId}
              name="organizationId"
              required
              defaultValue=""
              className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
            >
              <option value="" disabled>
                {t.organizationPlaceholder}
              </option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={roleFieldId} className="text-xs font-medium uppercase tracking-wide text-pm-gris">
              {t.roleLabel}
            </label>
            <select
              id={roleFieldId}
              name="role"
              required
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
            >
              <option value="" disabled>
                {t.rolePlaceholder}
              </option>
              {APPROVAL_ROLES.map((value) => (
                <option key={value} value={value}>
                  {t.roleOptions[value]}
                </option>
              ))}
            </select>
          </div>

          {isAdminRole && (
            <div className="rounded-xl border border-pm-rouge/40 bg-pm-rouge/5 p-4">
              <p className="text-sm font-medium text-pm-rouge">{confirmAdminText}</p>
              <label className="mt-3 flex items-start gap-2.5 text-sm text-pm-noir">
                <input
                  type="checkbox"
                  checked={adminConfirmed}
                  onChange={(e) => setAdminConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-pm-gris-2 text-pm-rouge focus:ring-pm-rouge/60"
                />
                {t.adminConfirmCheckbox}
              </label>
            </div>
          )}

          {error && <p className="text-sm text-pm-rouge">{error}</p>}

          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={close}
              disabled={isPending}
              className="rounded-lg px-4 py-2 text-sm font-medium text-pm-gris transition hover:text-pm-noir disabled:opacity-50"
            >
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
            >
              {isPending ? t.submitting : t.submit}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
