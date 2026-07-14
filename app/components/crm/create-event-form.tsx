"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCalendarEvent } from "@/lib/actions/crm-calendar";

export function CreateEventForm({
  clientOptions,
  fixedClientId,
}: {
  clientOptions?: { id: string; name: string }[];
  fixedClientId?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          try {
            await createCalendarEvent(formData);
            formRef.current?.reset();
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Une erreur est survenue.");
          }
        })
      }
    >
      {fixedClientId && <input type="hidden" name="clientId" value={fixedClientId} />}
      {clientOptions && (
        <select name="clientId" defaultValue="" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">Interne (aucun client)</option>
          {clientOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <input
        name="title"
        placeholder="Titre *"
        required
        className="min-w-[160px] flex-1 rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
      />
      <select name="type" defaultValue="meeting" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
        <option value="meeting">Rendez-vous</option>
        <option value="call">Appel</option>
        <option value="deadline">Échéance</option>
        <option value="other">Autre</option>
      </select>
      <input name="startAt" type="datetime-local" required className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? "Ajout..." : "Ajouter"}
      </button>
      {error && <p className="text-sm text-pm-rouge">{error}</p>}
    </form>
  );
}
