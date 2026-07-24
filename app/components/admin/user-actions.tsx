"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeMember, revokeInvitation, updateMemberRole } from "@/lib/actions/users";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";

const ROLE_OPTIONS = [
  { value: "client", label: "Client" },
  { value: "staff", label: "Staff" },
  { value: "admin", label: "Administrateur" },
];

export function MemberRoleSelect({
  userId,
  role,
  disabled,
}: {
  userId: string;
  role: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  if (disabled) {
    return (
      <span
        title="Impossible de modifier le dernier administrateur de l'organisation."
        className="inline-block rounded-lg border border-pm-gris-2 bg-pm-gris-2/30 px-3 py-2 text-sm text-pm-gris"
      >
        {ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role}
      </span>
    );
  }

  return (
    <div>
      <InlineStatusSelect
        value={role}
        options={ROLE_OPTIONS}
        action={async (newRole) => {
          setError(null);
          try {
            await updateMemberRole(userId, newRole);
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Une erreur est survenue.");
          }
        }}
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir disabled:opacity-50"
      />
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function RemoveMemberButton({ userId, disabled }: { userId: string; disabled?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (disabled) {
    return (
      <span
        title="Impossible de retirer le dernier administrateur de l'organisation."
        className="text-xs text-pm-gris/50"
      >
        Retirer l&apos;accès
      </span>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm("Retirer l'accès de cette personne à l'organisation ?")) return;
          setError(null);
          startTransition(async () => {
            try {
              await removeMember(userId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? "Retrait..." : "Retirer l'accès"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function RevokeInvitationButton({ id }: { id: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm("Annuler cette invitation ?")) return;
          setError(null);
          startTransition(async () => {
            try {
              await revokeInvitation(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? "Annulation..." : "Annuler l'invitation"}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
