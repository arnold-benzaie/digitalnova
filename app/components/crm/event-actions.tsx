"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCalendarEvent, updateCalendarEvent } from "@/lib/actions/crm-calendar";

const TYPE_OPTIONS = [
  { value: "meeting", label: "Rendez-vous" },
  { value: "call", label: "Appel" },
  { value: "deadline", label: "Échéance" },
  { value: "other", label: "Autre" },
];

type Event = {
  id: string;
  title: string;
  description: string | null;
  type: string;
  startAt: string | Date;
  endAt: string | Date | null;
};

function toLocalInput(value: string | Date) {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EditEventForm({ event }: { event: Event }) {
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
                await updateCalendarEvent(event.id, formData);
                close();
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Une erreur est survenue.");
              }
            })
          }
        >
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Modifier l&apos;événement</h2>
          <input name="title" required defaultValue={event.title} placeholder="Titre *" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
          <textarea name="description" rows={2} defaultValue={event.description ?? ""} placeholder="Description" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
          <select name="type" defaultValue={event.type} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <label className="flex flex-col gap-1 text-xs text-pm-gris">
            Début *
            <input name="startAt" type="datetime-local" required defaultValue={toLocalInput(event.startAt)} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-pm-gris">
            Fin
            <input name="endAt" type="datetime-local" defaultValue={event.endAt ? toLocalInput(event.endAt) : ""} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
          </label>
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

export function DeleteEventButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm("Supprimer cet événement ?")) return;
          setError(null);
          startTransition(async () => {
            try {
              await deleteCalendarEvent(id);
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
