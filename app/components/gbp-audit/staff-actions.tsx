"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeAuditStaffMember, revokeAuditInvitation, updateAuditStaffRole } from "@/lib/actions/gbp-audit-staff";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { Button } from "@/components/gbp-audit/ui/button";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { toast } from "@/components/gbp-audit/ui/toast";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function StaffRoleSelect({ userId, role, disabled, locale = "fr" }: { userId: string; role: string; disabled?: boolean; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.team;
  const ROLE_OPTIONS = [
    { value: "staff", label: t.role.staff },
    { value: "supervisor", label: t.role.supervisor },
    { value: "admin", label: t.role.admin },
  ];

  if (disabled) {
    return (
      <span
        title={t.lastAdminTitle}
        className="inline-block rounded-lg border border-pm-gris-2 bg-pm-gris-2/30 px-3 py-2 text-sm text-pm-gris"
      >
        {ROLE_OPTIONS.find((o) => o.value === role)?.label ?? t.memberFallback}
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
          toast.success(t.roleUpdated);
        } catch (err) {
          toast.error(t.roleUpdateError, err instanceof Error ? err.message : undefined);
        }
      }}
      className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir disabled:opacity-50"
    />
  );
}

export function RemoveStaffButton({ userId, name, disabled, locale = "fr" }: { userId: string; name: string; disabled?: boolean; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.team;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirmDialog(locale);

  if (disabled) {
    return <span title={t.cannotRemoveLastAdminTitle} className="text-xs text-pm-gris/50">{t.removeAccess}</span>;
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
            title: t.removeConfirmTitle,
            description: t.removeConfirmDescription(name),
            confirmLabel: t.removeConfirmLabel,
          });
          if (!ok) return;
          startTransition(async () => {
            try {
              await removeAuditStaffMember(userId);
              toast.success(t.removed);
              router.refresh();
            } catch (err) {
              toast.error(t.removeError, err instanceof Error ? err.message : undefined);
            }
          });
        }}
      >
        {isPending ? t.removing : t.removeAccess}
      </Button>
    </>
  );
}

export function RevokeStaffInvitationButton({ id, email, locale = "fr" }: { id: string; email: string; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.team;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirmDialog(locale);

  return (
    <>
      {dialog}
      <Button
        variant="ghost"
        size="sm"
        disabled={isPending}
        onClick={async () => {
          const ok = await confirm({ title: t.cancelInvitationConfirmTitle, description: t.cancelInvitationConfirmDescription(email), confirmLabel: t.cancelInvitationConfirmLabel });
          if (!ok) return;
          startTransition(async () => {
            try {
              await revokeAuditInvitation(id);
              toast.success(t.invitationCanceled);
              router.refresh();
            } catch (err) {
              toast.error(t.cancelInvitationError, err instanceof Error ? err.message : undefined);
            }
          });
        }}
      >
        {isPending ? t.canceling : t.cancelInvitation}
      </Button>
    </>
  );
}
