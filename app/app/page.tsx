import { redirect } from "next/navigation";
import { getDevRole } from "@/lib/dev-role";

// Clerk is temporarily disabled (no valid API keys in .env.local yet) —
// route by the dev-role cookie instead of a real session until auth is back.
export default async function Home() {
  const role = await getDevRole();
  redirect(role === "client" ? "/dashboard" : "/admin");
}
