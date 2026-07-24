import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getDevRole } from "@/lib/dev-role";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const role = await getDevRole();
  return <AppShell role={role}>{children}</AppShell>;
}
