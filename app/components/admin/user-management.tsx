"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/crm/badges";
import { InviteUserForm } from "@/components/admin/invite-user-form";
import { MemberRoleSelect, RemoveMemberButton, RevokeInvitationButton } from "@/components/admin/user-actions";

const ROLE_LABEL: Record<string, string> = { admin: "Administrateur", staff: "Staff", client: "Client" };
const ROLE_CLASS: Record<string, string> = {
  admin: "bg-pm-g-green/10 text-pm-g-green",
  staff: "bg-pm-or/10 text-pm-or-2",
  client: "bg-pm-gris-2/60 text-pm-gris",
};
const STATUS_LABEL = { active: "Actif", pending: "Invitation en attente" } as const;
const STATUS_CLASS = {
  active: "bg-pm-g-green/10 text-pm-g-green",
  pending: "bg-pm-or/10 text-pm-or-2",
} as const;

type Member = { id: string; email: string; fullName: string | null; role: string; createdAt: string };
type Invitation = { id: string; email: string; role: string; createdAt: string };
type Status = keyof typeof STATUS_LABEL;
type Row =
  | { kind: "member"; id: string; email: string; fullName: string | null; role: string; createdAt: string }
  | { kind: "invitation"; id: string; email: string; role: string; createdAt: string };

export function UserManagement({
  currentUserId,
  organizationName,
  members,
  invitations,
  adminCount,
}: {
  currentUserId: string;
  organizationName: string;
  members: Member[];
  invitations: Invitation[];
  adminCount: number;
}) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "staff" | "client">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | Status>("all");

  const rows: Row[] = useMemo(
    () => [
      ...members.map((m): Row => ({ kind: "member", ...m })),
      ...invitations.map((i): Row => ({ kind: "invitation", ...i })),
    ],
    [members, invitations],
  );

  const filtered = rows.filter((row) => {
    const status: Status = row.kind === "member" ? "active" : "pending";
    if (statusFilter !== "all" && status !== statusFilter) return false;
    if (roleFilter !== "all" && row.role !== roleFilter) return false;
    if (search.trim()) {
      const needle = search.trim().toLowerCase();
      const haystack = `${row.email} ${row.kind === "member" ? (row.fullName ?? "") : ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  const staffCount = members.filter((m) => m.role === "staff").length;

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">Utilisateurs</h1>
          <p className="mt-1 text-sm text-pm-gris">
            {members.length} membre(s) actif(s) · {organizationName}
          </p>
        </div>
        <InviteUserForm />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Membres" value={members.length} />
        <StatCard label="Administrateurs" value={adminCount} />
        <StatCard label="Staff" value={staffCount} />
        <StatCard label="Invitations en attente" value={invitations.length} />
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="w-full sm:max-w-xs">
          <label htmlFor="user-search" className="sr-only">
            Rechercher un utilisateur
          </label>
          <input
            id="user-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom ou email…"
            className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
          />
        </div>
        <div>
          <label htmlFor="role-filter" className="sr-only">
            Filtrer par rôle
          </label>
          <select
            id="role-filter"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
            className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
          >
            <option value="all">Tous les rôles</option>
            <option value="admin">Administrateur</option>
            <option value="staff">Staff</option>
            <option value="client">Client</option>
          </select>
        </div>
        <div>
          <label htmlFor="status-filter" className="sr-only">
            Filtrer par statut
          </label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
          >
            <option value="all">Tous les statuts</option>
            <option value="active">Actif</option>
            <option value="pending">Invitation en attente</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">Aucun résultat</p>
          <p className="mt-1 text-sm text-pm-gris">Essayez une autre recherche, ou invitez quelqu&apos;un.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">Personne</th>
                <th className="px-5 py-3">Rôle</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3">Depuis</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const isSelf = row.kind === "member" && row.id === currentUserId;
                const isLastAdmin = isSelf && row.role === "admin" && adminCount <= 1;
                const status: Status = row.kind === "member" ? "active" : "pending";
                return (
                  <tr key={`${row.kind}-${row.id}`} className="border-t border-pm-gris-2 align-top">
                    <td className="px-5 py-3">
                      <div className="font-medium text-pm-noir">
                        {row.kind === "member" ? (row.fullName ?? row.email) : row.email}
                        {isSelf && <span className="ml-2 text-xs text-pm-gris">(vous)</span>}
                      </div>
                      {row.kind === "member" && row.fullName && (
                        <div className="text-xs text-pm-gris">{row.email}</div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {row.kind === "member" ? (
                        <MemberRoleSelect userId={row.id} role={row.role} disabled={isLastAdmin} />
                      ) : (
                        <Badge label={ROLE_LABEL[row.role] ?? row.role} className={ROLE_CLASS[row.role] ?? ""} />
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge label={STATUS_LABEL[status]} className={STATUS_CLASS[status]} />
                    </td>
                    <td className="px-5 py-3 text-pm-gris">{new Date(row.createdAt).toLocaleDateString("fr-FR")}</td>
                    <td className="px-5 py-3 text-right">
                      {row.kind === "member" ? (
                        <RemoveMemberButton userId={row.id} disabled={isLastAdmin} />
                      ) : (
                        <RevokeInvitationButton id={row.id} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{label}</div>
      <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">{value}</div>
    </div>
  );
}
