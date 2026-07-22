"use server";

import { revalidatePath } from "next/cache";
import { syncSearchConsoleData } from "@/lib/actions/search-console";
import { getOrCreateOrganizationForClient } from "@/lib/actions/crm-gbp";

export async function syncSearchConsoleDataForClient(clientId: string) {
  const org = await getOrCreateOrganizationForClient(clientId);
  await syncSearchConsoleData(org.id);
  revalidatePath(`/admin/crm/clients/${clientId}/search-console`);
}
