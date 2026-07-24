"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendMessage } from "@/lib/actions/messages";

export function SendMessageForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className="flex items-end gap-3"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          try {
            await sendMessage(formData);
            formRef.current?.reset();
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Une erreur est survenue.");
          }
        })
      }
    >
      <textarea
        name="body"
        required
        rows={2}
        placeholder="Écrivez votre message..."
        className="flex-1 resize-none rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir placeholder:text-pm-gris focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
      />
      <button
        type="submit"
        disabled={isPending}
        className="shrink-0 rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
      >
        {isPending ? "Envoi..." : "Envoyer"}
      </button>
      {error && <p className="text-sm text-pm-rouge">{error}</p>}
    </form>
  );
}
