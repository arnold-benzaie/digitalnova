"use server";

import { cookies } from "next/headers";
import { DEV_ROLE_COOKIE, type DevRole } from "@/lib/dev-role";

export async function setDevRole(role: DevRole) {
  const store = await cookies();
  store.set(DEV_ROLE_COOKIE, role, { path: "/" });
}
