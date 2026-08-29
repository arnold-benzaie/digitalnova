"use server";

import { revalidatePath } from "next/cache";
import { syncSearchConsoleData } from "@/lib/actions/search-console";
import { getOrCreateOrganizationForClient } from "@/lib/actions/crm-gbp";
import { requireStaffRole } from "@/lib/dev-role";

export async function syncSearchConsoleDataForClient(clientId: string) {
  await requireStaffRole();
  const org = await getOrCreateOrganizationForClient(clientId);
  await syncSearchConsoleData(org.id);
  revalidatePath(`/admin/crm/clients/${clientId}/search-console`);
}
