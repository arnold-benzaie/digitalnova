"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteAuditStaff } from "@/lib/actions/gbp-audit-staff";
import { Field, Input, Select } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function InviteStaffForm({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].auditModule.team;
  const ROLE_OPTIONS = [
    { value: "staff", label: t.roleOptions.staff },
    { value: "supervisor", label: t.roleOptions.supervisor },
    { value: "admin", label: t.roleOptions.admin },
  ];
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
    formRef.current?.reset();
    setError(null);
  }

  return (
    <>
      <Button type="button" onClick={open}>
        {t.inviteTrigger}
      </Button>

      <dialog
        ref={dialogRef}
        onCancel={close}
        className="w-full max-w-md rounded-2xl border border-pm-gris-2 bg-white p-0 shadow-xl backdrop:bg-pm-noir/40"
      >
        <form
          ref={formRef}
          className="flex flex-col gap-4 p-6"
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              try {
                const result = await inviteAuditStaff(formData);
                if (result?.error) {
                  setError(result.error);
                  toast.error(t.inviteError, result.error);
                  return;
                }
                toast.success(t.invited);
                close();
                router.refresh();
              } catch (err) {
                const message = err instanceof Error ? err.message : t.genericError;
                setError(message);
                toast.error(t.inviteError, message);
              }
            })
          }
        >
          <div>
            <h2 className="font-serif text-xl font-semibold text-pm-noir">{t.inviteDialogTitle}</h2>
            <p className="mt-1 text-sm text-pm-gris">{t.inviteDialogLead}</p>
          </div>

          <Field label={t.emailLabel} required htmlFor="invite-email">
            <Input id="invite-email" name="email" type="email" required placeholder="prenom.nom@exemple.fr" />
          </Field>

          <Field label={t.roleLabel} required htmlFor="invite-role">
            <Select id="invite-role" name="role" defaultValue="staff">
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          {error && (
            <p role="alert" className="text-sm text-pm-rouge">
              {error}
            </p>
          )}

          <div className="mt-2 flex items-center justify-end gap-3">
            <Button type="button" variant="ghost" onClick={close} disabled={isPending}>
              {t.cancel}
            </Button>
            <Button type="submit" loading={isPending}>
              {t.sendInvitation}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
