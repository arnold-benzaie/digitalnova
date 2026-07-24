"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteAuditStaff } from "@/lib/actions/gbp-audit-staff";
import { Field, Input, Select } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";

const ROLE_OPTIONS = [
  { value: "staff", label: "Staff (construit les audits)" },
  { value: "supervisor", label: "Superviseur (révise et approuve)" },
  { value: "admin", label: "Administrateur (accès complet)" },
];

export function InviteStaffForm() {
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
        + Inviter un membre
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
                await inviteAuditStaff(formData);
                toast.success("Invitation envoyée");
                close();
                router.refresh();
              } catch (err) {
                const message = err instanceof Error ? err.message : "Une erreur est survenue.";
                setError(message);
                toast.error("Impossible d'inviter cette personne", message);
              }
            })
          }
        >
          <div>
            <h2 className="font-serif text-xl font-semibold text-pm-noir">Inviter un membre</h2>
            <p className="mt-1 text-sm text-pm-gris">L&rsquo;accès s&rsquo;active dès que cette personne se connecte avec cette adresse e-mail.</p>
          </div>

          <Field label="Adresse e-mail" required htmlFor="invite-email">
            <Input id="invite-email" name="email" type="email" required placeholder="prenom.nom@exemple.fr" />
          </Field>

          <Field label="Rôle" required htmlFor="invite-role">
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
              Annuler
            </Button>
            <Button type="submit" loading={isPending}>
              Envoyer l&rsquo;invitation
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
