"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTicket } from "@/lib/actions/crm-tickets";

export function CreateTicketForm({
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
            await createTicket(formData);
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
        <select
          name="clientId"
          required
          defaultValue=""
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        >
          <option value="" disabled>
            Client...
          </option>
          {clientOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <input
        name="subject"
        placeholder="Sujet *"
        required
        className="min-w-[180px] flex-1 rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
      />
      <select name="priority" defaultValue="medium" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
        <option value="low">Priorité basse</option>
        <option value="medium">Priorité moyenne</option>
        <option value="high">Priorité haute</option>
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? "Ajout..." : "Créer le ticket"}
      </button>
      {error && <p className="text-sm text-pm-rouge">{error}</p>}
    </form>
  );
}
