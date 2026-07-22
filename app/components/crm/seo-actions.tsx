"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { createWebsite, deleteWebsite, updateWebsite } from "@/lib/actions/crm-websites";
import { addSeoKeyword, deleteSeoKeyword, refreshKeywordRankings, runSeoAudit, updateSeoIssueStatus } from "@/lib/actions/crm-seo";
import { SEO_ISSUE_STATUS_OPTIONS } from "@/lib/seo-shared";

export function AddWebsiteForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
      >
        Ajouter un site web
      </button>

      <dialog
        ref={dialogRef}
        onCancel={close}
        className="w-full max-w-md rounded-2xl border border-pm-gris-2 bg-white p-0 shadow-xl backdrop:bg-pm-noir/40"
      >
        <form
          className="flex flex-col gap-3 p-6"
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              try {
                formData.set("clientId", clientId);
                await createWebsite(formData);
                close();
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Une erreur est survenue.");
              }
            })
          }
        >
          <h2 className="font-serif text-xl font-semibold text-pm-noir">Ajouter un site web</h2>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
            URL *
            <input
              name="url"
              required
              placeholder="https://exemple.com"
              className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
            Libellé
            <input
              name="label"
              placeholder="Site principal, boutique en ligne…"
              className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
            />
          </label>

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
              {isPending ? "Enregistrement..." : "Ajouter"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function EditWebsiteForm({ website }: { website: { id: string; url: string; label: string | null } }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
    setError(null);
  }

  return (
    <>
      <button type="button" onClick={open} className="text-xs text-pm-gris underline hover:text-pm-noir">
        Modifier
      </button>

      <dialog
        ref={dialogRef}
        onCancel={close}
        className="w-full max-w-md rounded-2xl border border-pm-gris-2 bg-white p-0 shadow-xl backdrop:bg-pm-noir/40"
      >
        <form
          className="flex flex-col gap-3 p-6"
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              try {
                await updateWebsite(website.id, formData);
                close();
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Une erreur est survenue.");
              }
            })
          }
        >
          <h2 className="font-serif text-xl font-semibold text-pm-noir">Modifier le site web</h2>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
            URL *
            <input
              name="url"
              required
              defaultValue={website.url}
              className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
            Libellé
            <input
              name="label"
              defaultValue={website.label ?? ""}
              className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
            />
          </label>

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
              {isPending ? "Enregistrement..." : "Enregistrer"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function DeleteWebsiteButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm("Supprimer ce site web et tout son historique d'audits/mots-clés ?")) return;
          setError(null);
          startTransition(async () => {
            try {
              await deleteWebsite(id);
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

export function RunSeoAuditButton({ websiteId }: { websiteId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              await runSeoAudit(websiteId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          });
        }}
        className="rounded-lg bg-pm-noir px-3 py-1.5 text-xs font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? "Analyse en cours..." : "Lancer un audit SEO"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function SeoIssueStatusSelect({ issueId, status }: { issueId: string; status: string }) {
  return (
    <InlineStatusSelect
      value={status}
      options={SEO_ISSUE_STATUS_OPTIONS}
      action={updateSeoIssueStatus.bind(null, issueId)}
      className="rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:opacity-50"
    />
  );
}

export function AddSeoKeywordForm({ websiteId }: { websiteId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className="flex flex-wrap items-end gap-2"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          try {
            formData.set("websiteId", websiteId);
            await addSeoKeyword(formData);
            formRef.current?.reset();
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Une erreur est survenue.");
          }
        })
      }
    >
      <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
        Mot-clé *
        <input
          name="keyword"
          required
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-pm-gris">
        URL ciblée
        <input
          name="targetUrl"
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-sm font-normal normal-case tracking-normal text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir transition hover:bg-pm-gris-2/40 disabled:opacity-50"
      >
        {isPending ? "Ajout..." : "Suivre ce mot-clé"}
      </button>
      {error && <p className="w-full text-xs text-pm-rouge">{error}</p>}
    </form>
  );
}

export function DeleteSeoKeywordButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await deleteSeoKeyword(id);
          router.refresh();
        });
      }}
      className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
    >
      {isPending ? "..." : "Retirer"}
    </button>
  );
}

export function RefreshKeywordRankingsButton({ websiteId }: { websiteId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              await refreshKeywordRankings(websiteId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          });
        }}
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-1.5 text-xs font-medium text-pm-noir transition hover:bg-pm-gris-2/40 disabled:opacity-50"
      >
        {isPending ? "Vérification..." : "Actualiser les positions"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
