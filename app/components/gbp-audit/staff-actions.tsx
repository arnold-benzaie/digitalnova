"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeAuditStaffMember, revokeAuditInvitation, updateAuditStaffRole } from "@/lib/actions/gbp-audit-staff";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { Button } from "@/components/gbp-audit/ui/button";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { toast } from "@/components/gbp-audit/ui/toast";

const ROLE_OPTIONS = [
  { value: "staff", label: "Staff" },
  { value: "supervisor", label: "Superviseur" },
  { value: "admin", label: "Administrateur" },
];

export function StaffRoleSelect({ userId, role, disabled }: { userId: string; role: string; disabled?: boolean }) {
  if (disabled) {
    return (
      <span
        title="Impossible de modifier le dernier administrateur."
        className="inline-block rounded-lg border border-pm-gris-2 bg-pm-gris-2/30 px-3 py-2 text-sm text-pm-gris"
      >
        {ROLE_OPTIONS.find((o) => o.value === role)?.label ?? "Membre"}
      </span>
    );
  }

  return (
    <InlineStatusSelect
      value={role}
      options={ROLE_OPTIONS}
      action={async (newRole) => {
        try {
          await updateAuditStaffRole(userId, newRole);
          toast.success("Rôle mis à jour");
        } catch (err) {
          toast.error("Impossible de changer le rôle", err instanceof Error ? err.message : undefined);
        }
      }}
      className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir disabled:opacity-50"
    />
  );
}

export function RemoveStaffButton({ userId, name, disabled }: { userId: string; name: string; disabled?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirmDialog();

  if (disabled) {
    return <span title="Impossible de retirer le dernier administrateur." className="text-xs text-pm-gris/50">Retirer l&rsquo;accès</span>;
  }

  return (
    <>
      {dialog}
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={async () => {
          const ok = await confirm({
            title: "Retirer l'accès ?",
            description: `${name} n'aura plus accès à PUBLIC-MAP Audit.`,
            confirmLabel: "Retirer",
          });
          if (!ok) return;
          startTransition(async () => {
            try {
              await removeAuditStaffMember(userId);
              toast.success("Accès retiré");
              router.refresh();
            } catch (err) {
              toast.error("Impossible de retirer l'accès", err instanceof Error ? err.message : undefined);
            }
          });
        }}
      >
        {isPending ? "Retrait…" : "Retirer l'accès"}
      </Button>
    </>
  );
}

export function RevokeStaffInvitationButton({ id, email }: { id: string; email: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirmDialog();

  return (
    <>
      {dialog}
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={async () => {
          const ok = await confirm({ title: "Annuler cette invitation ?", description: `L'invitation envoyée à ${email} sera annulée.`, confirmLabel: "Annuler l'invitation" });
          if (!ok) return;
          startTransition(async () => {
            try {
              await revokeAuditInvitation(id);
              toast.success("Invitation annulée");
              router.refresh();
            } catch (err) {
              toast.error("Impossible d'annuler l'invitation", err instanceof Error ? err.message : undefined);
            }
          });
        }}
      >
        {isPending ? "Annulation…" : "Annuler"}
      </Button>
    </>
  );
}
