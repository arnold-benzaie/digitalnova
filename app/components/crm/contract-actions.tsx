"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendContractForSignature, simulateContractSignature, updateContract } from "@/lib/actions/contracts";

type Contract = { id: string; title: string; content: string; signerName: string | null; signerEmail: string | null };

export function EditContractForm({ contract }: { contract: Contract }) {
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
      <dialog ref={dialogRef} onCancel={close} className="w-full max-w-lg rounded-2xl border border-pm-gris-2 bg-white p-0 shadow-xl backdrop:bg-pm-noir/40">
        <form
          className="flex flex-col gap-3 p-6"
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              try {
                await updateContract(contract.id, formData);
                close();
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Une erreur est survenue.");
              }
            })
          }
        >
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Modifier le contrat</h2>
          <input name="title" required defaultValue={contract.title} placeholder="Titre *" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
          <textarea name="content" required rows={5} defaultValue={contract.content} placeholder="Contenu *" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
          <input name="signerName" defaultValue={contract.signerName ?? ""} placeholder="Nom du signataire" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
          <input name="signerEmail" type="email" defaultValue={contract.signerEmail ?? ""} placeholder="Email du signataire" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
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

export function SendContractButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await sendContractForSignature(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          })
        }
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir transition hover:bg-pm-gris-2/40 disabled:opacity-50"
      >
        {isPending ? "Envoi..." : "Envoyer pour signature"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function SimulateSignatureButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await simulateContractSignature(id);
          router.refresh();
        })
      }
      className="rounded-lg bg-pm-g-green px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      title="Aucun vrai signataire — simule la signature pour la démo"
    >
      {isPending ? "..." : "Simuler la signature (démo)"}
    </button>
  );
}
