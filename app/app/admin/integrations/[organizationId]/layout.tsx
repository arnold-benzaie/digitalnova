import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireStaffRole } from "@/lib/dev-role";
import { getOrganizationById } from "@/lib/integrations/queries";

/** Shared existence check for every /admin/integrations/[organizationId]/*
 * route — the sub-nav itself is rendered per-page (not here), matching
 * components/gbp-audit/audit-tabs.tsx's precedent for /admin/audit/[id]/*:
 * a layout can't cleanly know which leaf route is active without extra
 * plumbing, so each page renders its own <IntegrationsNav active="..."/>. */
export default async function IntegrationOrganizationLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ organizationId: string }>;
}) {
  await requireStaffRole();
  const { organizationId } = await params;
  const org = await getOrganizationById(organizationId);
  if (!org) notFound();

  return <>{children}</>;
}
