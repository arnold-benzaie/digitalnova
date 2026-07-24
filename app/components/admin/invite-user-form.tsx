"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inviteUser } from "@/lib/actions/users";

const ROLE_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "staff", label: "Staff" },
  { value: "admin", label: "Administrateur" },
];

export function InviteUserForm() {
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
      <button
        type="button"
        onClick={open}
        className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
      >
        + Inviter un utilisateur
      </button>

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
                await inviteUser(formData);
                close();
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Une erreur est survenue.");
              }
            })
          }
        >
          <div>
            <h2 className="font-serif text-xl font-semibold text-pm-noir">Inviter un utilisateur</h2>
            <p className="mt-1 text-sm text-pm-gris">
              L&apos;accès s&apos;active automatiquement dès que cette personne s&apos;inscrit avec cette adresse
              e-mail.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-email" className="text-xs font-medium uppercase tracking-wide text-pm-gris">
              Adresse e-mail
            </label>
            <input
              id="invite-email"
              name="email"
              type="email"
              required
              placeholder="prenom.nom@exemple.fr"
              className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-role" className="text-xs font-medium uppercase tracking-wide text-pm-gris">
              Rôle
            </label>
            <select
              id="invite-role"
              name="role"
              defaultValue="client"
              className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-sm text-pm-rouge">{error}</p>}

          <div className="mt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={close}
              disabled={isPending}
              className="rounded-lg px-4 py-2 text-sm font-medium text-pm-gris transition hover:text-pm-noir disabled:opacity-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
            >
              {isPending ? "Envoi..." : "Envoyer l'invitation"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
