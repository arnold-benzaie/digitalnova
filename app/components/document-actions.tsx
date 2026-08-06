"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDocument, uploadDocument } from "@/lib/actions/documents";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Button } from "@/components/gbp-audit/ui/button";

export function UploadDocumentForm({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].dashboard.documents;
  const tCommon = dictionaries[locale].common;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          try {
            await uploadDocument(formData);
            formRef.current?.reset();
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : tCommon.error);
          }
        })
      }
    >
      <input
        type="file"
        name="file"
        required
        className="text-sm text-pm-gris file:mr-3 file:rounded-lg file:border-0 file:bg-pm-g-blue/10 file:px-3 file:py-2 file:text-xs file:font-medium file:text-pm-bleu-eu hover:file:bg-pm-g-blue/20"
      />
      <Button type="submit" loading={isPending} className="shrink-0">
        {isPending ? t.uploading : t.add}
      </Button>
      {error && <p className="text-sm text-pm-rouge">{error}</p>}
    </form>
  );
}

export function DeleteDocumentButton({ id, locale = "fr" }: { id: string; locale?: Locale }) {
  const t = dictionaries[locale].dashboard.documents;
  const tCommon = dictionaries[locale].common;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await deleteDocument(id);
          router.refresh();
        })
      }
      className="text-xs text-pm-gris underline transition hover:text-pm-rouge-2 disabled:opacity-50"
    >
      {isPending ? t.deleting : tCommon.delete}
    </button>
  );
}
