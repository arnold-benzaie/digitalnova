import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ProductActivityTracker } from "@/components/product-activity-tracker";
import { getDevRole } from "@/lib/dev-role";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const role = await getDevRole();
  return (
    <AppShell role={role}>
      {/* Mounted here only — never app/admin/layout.tsx — so page_view
          tracking covers the client portal exclusively, by construction. */}
      <ProductActivityTracker />
      {children}
    </AppShell>
  );
}
