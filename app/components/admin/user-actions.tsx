"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  changeUserOrganization,
  changeUserRole,
  deleteUser,
  reactivateUser,
  refuseUser,
  removeMember,
  revokeInvitation,
  suspendUser,
} from "@/lib/actions/users";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

export function MemberRoleSelect({
  userId,
  role,
  disabled,
  locale = "fr",
}: {
  userId: string;
  role: string;
  disabled?: boolean;
  locale?: Locale;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].adminUsers;
  const ROLE_OPTIONS = [
    { value: "client", label: t.roleLabels.client },
    { value: "staff", label: t.roleLabels.staff },
    { value: "agent", label: t.roleLabels.agent },
    { value: "supervisor", label: t.roleLabels.supervisor },
    { value: "admin", label: t.roleLabels.admin },
  ];

  if (disabled) {
    return (
      <span
        title={t.memberRoleDisabledTooltip}
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
          if (newRole === "admin" && !confirm(t.confirm.adminRole)) {
            return;
          }
          try {
            await changeUserRole(userId, newRole);
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
          }
        }}
        className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir disabled:opacity-50"
      />
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function RemoveMemberButton({ userId, disabled, locale = "fr" }: { userId: string; disabled?: boolean; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].adminUsers.removeMember;

  if (disabled) {
    return (
      <span title={t.disabledTooltip} className="text-xs text-pm-gris/50">
        {t.label}
      </span>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(t.confirm)) return;
          setError(null);
          startTransition(async () => {
            try {
              await removeMember(userId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? t.removing : t.label}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

/** Permanent, irreversible deletion of the user row itself — see
 * deleteUser()'s own docstring in lib/actions/users.ts for exactly what
 * this does and doesn't cascade. Disabled unconditionally for the
 * signed-in admin's own row (never just for admins, unlike
 * RemoveMemberButton) — deleting your own account outright should never
 * be a single click away, regardless of role. */
export function DeleteUserButton({ userId, disabled, locale = "fr" }: { userId: string; disabled?: boolean; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].adminUsers.deleteUser;

  if (disabled) {
    return (
      <span title={t.disabledTooltip} className="text-xs text-pm-gris/50">
        {t.label}
      </span>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(t.confirm)) return;
          setError(null);
          startTransition(async () => {
            try {
              const result = await deleteUser(userId);
              if (result?.error) {
                setError(result.error);
                return;
              }
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="text-xs text-pm-rouge underline hover:text-pm-rouge-2 disabled:opacity-50"
      >
        {isPending ? t.deleting : t.label}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function RefuseUserButton({
  userId,
  confirmText,
  label,
  labelPending,
  locale = "fr",
}: {
  userId: string;
  confirmText: string;
  label: string;
  labelPending: string;
  locale?: Locale;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(confirmText)) return;
          setError(null);
          startTransition(async () => {
            try {
              await refuseUser(userId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? labelPending : label}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function SuspendUserButton({
  userId,
  confirmText,
  label,
  labelPending,
  locale = "fr",
}: {
  userId: string;
  confirmText: string;
  label: string;
  labelPending: string;
  locale?: Locale;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(confirmText)) return;
          setError(null);
          startTransition(async () => {
            try {
              await suspendUser(userId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? labelPending : label}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function ReactivateUserButton({
  userId,
  confirmText,
  label,
  labelPending,
  locale = "fr",
}: {
  userId: string;
  confirmText: string;
  label: string;
  labelPending: string;
  locale?: Locale;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(confirmText)) return;
          setError(null);
          startTransition(async () => {
            try {
              await reactivateUser(userId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-noir disabled:opacity-50"
      >
        {isPending ? labelPending : label}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function ChangeOrganizationSelect({
  userId,
  organizationId,
  organizations,
  placeholder,
  locale = "fr",
}: {
  userId: string;
  organizationId: string;
  organizations: { id: string; name: string }[];
  placeholder: string;
  locale?: Locale;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div>
      <select
        defaultValue=""
        disabled={isPending}
        onChange={(e) => {
          const newOrganizationId = e.target.value;
          if (!newOrganizationId) return;
          setError(null);
          startTransition(async () => {
            try {
              await changeUserOrganization(userId, newOrganizationId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            } finally {
              e.target.value = "";
            }
          });
        }}
        className="rounded-lg border border-pm-gris-2 bg-white px-2 py-1.5 text-xs text-pm-noir disabled:opacity-50"
      >
        <option value="">{placeholder}</option>
        {organizations
          .filter((org) => org.id !== organizationId)
          .map((org) => (
            <option key={org.id} value={org.id}>
              {org.name}
            </option>
          ))}
      </select>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}

export function RevokeInvitationButton({ id, locale = "fr" }: { id: string; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].adminUsers.revokeInvitation;

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(t.confirm)) return;
          setError(null);
          startTransition(async () => {
            try {
              await revokeInvitation(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? t.revoking : t.label}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
