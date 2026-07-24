"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/actions/crm-clients";
import { CLIENT_STAGE_OPTIONS } from "@/components/crm/badges";

export function CreateClientForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <details className="rounded-2xl border border-pm-gris-2 bg-white p-5" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-sm font-medium text-pm-noir">
        {open ? "Fermer" : "+ Ajouter un client"}
      </summary>
      <form
        ref={formRef}
        className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            try {
              const client = await createClient(formData);
              formRef.current?.reset();
              setOpen(false);
              router.push(`/admin/crm/clients/${client.id}`);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          })
        }
      >
        <input name="name" placeholder="Nom de l'entreprise *" required className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
        <input name="contactName" placeholder="Nom du contact" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
        <input name="email" type="email" placeholder="Email" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
        <input name="phone" placeholder="Téléphone" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
        <input name="address" placeholder="Adresse" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 sm:col-span-2" />
        <select name="stage" defaultValue="lead" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20">
          {CLIENT_STAGE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input name="source" placeholder="Source (site web, recommandation...)" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
        <input name="ownerName" placeholder="Conseiller assigné" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
        <textarea name="notes" placeholder="Notes" rows={2} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 sm:col-span-2" />

        <div className="flex items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
          >
            {isPending ? "Création..." : "Créer le client"}
          </button>
          {error && <p className="text-sm text-pm-rouge">{error}</p>}
        </div>
      </form>
    </details>
  );
}
