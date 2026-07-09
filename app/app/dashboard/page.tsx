import { currentUser } from "@clerk/nextjs/server";
import { AppShell } from "@/components/app-shell";

export default async function DashboardPage() {
  const user = await currentUser();

  return (
    <AppShell>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">
        Bonjour {user?.firstName ?? ""} 👋
      </h1>
      <p className="mt-2 text-sm text-pm-gris">
        Ceci est le squelette Phase 0 du portail Public Maps. La connexion
        Google Business Profile, l&apos;audit IA et les métriques de
        performance arrivent en Phase 1.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Score d'audit", value: "—" },
          { label: "Vues du profil", value: "—" },
          { label: "Appels", value: "—" },
          { label: "Avis", value: "—" },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl border border-pm-gris-2 bg-white p-5"
          >
            <div className="text-xs font-semibold uppercase tracking-wider text-pm-gris">
              {stat.label}
            </div>
            <div className="mt-2 font-serif text-3xl font-bold text-pm-noir">
              {stat.value}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}
