"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCrmDocument, uploadCrmDocument } from "@/lib/actions/crm-documents";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

export function UploadCrmDocumentForm({ clientId, locale = "fr" }: { clientId: string; locale?: Locale }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.documents;

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          try {
            await uploadCrmDocument(formData);
            formRef.current?.reset();
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
          }
        })
      }
    >
      <input type="hidden" name="clientId" value={clientId} />
      <input
        name="file"
        type="file"
        required
        className="flex-1 rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir file:mr-3 file:rounded-md file:border-0 file:bg-pm-gris-2/40 file:px-3 file:py-1 file:text-xs"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="shrink-0 rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
        >
          {isPending ? t.uploading : t.uploadButton}
        </button>
        {error && <p className="text-sm text-pm-rouge">{error}</p>}
      </div>
    </form>
  );
}

export function DeleteCrmDocumentButton({ id, locale = "fr" }: { id: string; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.documents;

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(t.deleteConfirm)) return;
          setError(null);
          startTransition(async () => {
            try {
              await deleteCrmDocument(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? t.deleting : t.deleteButton}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
