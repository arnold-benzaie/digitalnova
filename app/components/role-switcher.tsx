"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDevRole } from "@/lib/dev-role-actions";
import type { DevRole } from "@/lib/dev-role";

const ROLE_LABELS: Record<DevRole, string> = {
  client: "Client",
  staff: "Staff",
  admin: "Admin",
};

export function RoleSwitcher({ current }: { current: DevRole }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(role: DevRole) {
    startTransition(async () => {
      await setDevRole(role);
      router.push(role === "client" ? "/dashboard" : "/admin");
      router.refresh();
    });
  }

  return (
    <label className="flex items-center gap-2 text-xs text-pm-gris">
      Rôle (dev)
      <select
        value={current}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value as DevRole)}
        className="rounded-md border border-pm-gris-2 bg-white px-2 py-1 text-pm-noir"
      >
        {(Object.keys(ROLE_LABELS) as DevRole[]).map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </select>
    </label>
  );
}
