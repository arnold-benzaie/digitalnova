"use server";

import { revalidatePath } from "next/cache";
import { syncAnalyticsData } from "@/lib/actions/analytics";
import { getOrCreateOrganizationForClient } from "@/lib/actions/crm-gbp";
import { requireStaffRole } from "@/lib/dev-role";

export async function syncAnalyticsDataForClient(clientId: string) {
  await requireStaffRole();
  const org = await getOrCreateOrganizationForClient(clientId);
  await syncAnalyticsData(org.id);
  revalidatePath(`/admin/crm/clients/${clientId}/analytics`);
}
