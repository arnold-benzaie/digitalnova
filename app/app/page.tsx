import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";

// proxy.ts already requires a valid Clerk session to reach this route;
// requireSession() redirects to /sign-in or /access-pending itself if that
// session is missing or has no membership yet (see lib/session.ts).
export default async function Home() {
  const session = await requireSession();
  redirect(session.role === "client" ? "/dashboard" : "/admin");
}
