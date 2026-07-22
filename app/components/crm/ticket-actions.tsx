"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTicket, updateTicket } from "@/lib/actions/crm-tickets";

const PRIORITY_OPTIONS = [
  { value: "low", label: "Priorité basse" },
  { value: "medium", label: "Priorité moyenne" },
  { value: "high", label: "Priorité haute" },
];

type Ticket = { id: string; subject: string; description: string | null; priority: string };

export function EditTicketForm({ ticket }: { ticket: Ticket }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    dialogRef.current?.close();
    setError(null);
  }

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} className="text-xs text-pm-gris underline hover:text-pm-noir">
        Modifier
      </button>
      <dialog ref={dialogRef} onCancel={close} className="w-full max-w-sm rounded-2xl border border-pm-gris-2 bg-white p-0 shadow-xl backdrop:bg-pm-noir/40">
        <form
          className="flex flex-col gap-3 p-6"
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              try {
                await updateTicket(ticket.id, formData);
                close();
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Une erreur est survenue.");
              }
            })
          }
        >
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Modifier le ticket</h2>
          <input name="subject" required defaultValue={ticket.subject} placeholder="Sujet *" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
          <textarea name="description" rows={3} defaultValue={ticket.description ?? ""} placeholder="Description" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
          <select name="priority" defaultValue={ticket.priority} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
            {PRIORITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {error && <p className="text-sm text-pm-rouge">{error}</p>}
          <div className="mt-1 flex items-center justify-end gap-3">
            <button type="button" onClick={close} disabled={isPending} className="text-sm text-pm-gris hover:text-pm-noir disabled:opacity-50">
              Annuler
            </button>
            <button type="submit" disabled={isPending} className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50">
              {isPending ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function DeleteTicketButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm("Supprimer ce ticket ?")) return;
          setError(null);
          startTransition(async () => {
            try {
              await deleteTicket(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? "..." : "Supprimer"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
