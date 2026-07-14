"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInteraction } from "@/lib/actions/crm-interactions";

export function CreateInteractionForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          try {
            await createInteraction(formData);
            formRef.current?.reset();
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Une erreur est survenue.");
          }
        })
      }
    >
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <select name="type" defaultValue="note" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="note">Note</option>
          <option value="call">Appel</option>
          <option value="email">Email</option>
          <option value="meeting">Rendez-vous</option>
        </select>
        <input name="createdBy" placeholder="Votre nom" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
      </div>
      <textarea
        name="summary"
        placeholder="Résumé de l'interaction *"
        required
        rows={2}
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
        >
          {isPending ? "Ajout..." : "Enregistrer l'interaction"}
        </button>
        {error && <p className="text-sm text-pm-rouge">{error}</p>}
      </div>
    </form>
  );
}
