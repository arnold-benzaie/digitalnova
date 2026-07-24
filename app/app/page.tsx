import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/session";

// proxy.ts already requires a valid Clerk session to reach this route;
// getCurrentSession() throws if that session has no membership yet
// (see lib/session.ts) rather than silently guessing a role.
export default async function Home() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error(
      "Accès refusé : aucun rôle n'est associé à ce compte. Contactez un administrateur Public Maps.",
    );
  }
  redirect(session.role === "client" ? "/dashboard" : "/admin");
}
