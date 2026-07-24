"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function GbpReviewReplyForm({
  reviewId,
  existingReply,
  action,
}: {
  reviewId: string;
  existingReply: string | null;
  action: (reviewId: string, replyText: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(existingReply ?? "");
  const [editing, setEditing] = useState(!existingReply);

  if (!editing && existingReply) {
    return (
      <div className="mt-2 rounded-lg bg-pm-gris-2/20 p-2 text-xs text-pm-noir">
        <p className="font-medium text-pm-gris">Votre réponse</p>
        <p className="mt-0.5">{existingReply}</p>
        <button type="button" onClick={() => setEditing(true)} className="mt-1 text-pm-gris underline">
          Modifier
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={2}
        placeholder="Répondre à cet avis…"
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-xs text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                await action(reviewId, value);
                setEditing(false);
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Une erreur est survenue.");
              }
            });
          }}
          className="self-start rounded-lg bg-pm-noir px-3 py-1.5 text-xs font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
        >
          {isPending ? "Envoi..." : "Répondre"}
        </button>
        {existingReply && (
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setValue(existingReply);
              setError(null);
            }}
            className="text-xs text-pm-gris underline"
          >
            Annuler
          </button>
        )}
        {error && <p className="text-xs text-pm-rouge">{error}</p>}
      </div>
    </div>
  );
}
