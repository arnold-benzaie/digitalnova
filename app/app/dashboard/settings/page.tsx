import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { NotificationToggle, OrganizationForm, ProfileForm } from "@/components/settings-forms";
import { ReportScheduleForm } from "@/components/report-schedule-form";
import { getBillingProvider } from "@/lib/billing";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getOrCreateDevUser } from "@/lib/dev-user";
import { getReportSchedule } from "@/lib/report-schedule";

const STATUS_LABEL: Record<string, string> = {
  active: "Actif",
  trialing: "Essai",
  past_due: "Paiement en retard",
  canceled: "Annulé",
};

export default async function SettingsPage() {
  const org = await getOrCreateDevOrganization();
  const user = await getOrCreateDevUser();
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, org.id)).limit(1);
  const plans = getBillingProvider().listPlans();
  const schedule = await getReportSchedule(org.id);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Paramètres</h1>
      <p className="mt-2 text-sm text-pm-gris">Gérez votre profil, votre organisation et vos préférences.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-pm-gris-2 bg-white p-6">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Profil</h2>
          <p className="mt-1 text-xs text-pm-gris">
            Profil de démonstration — remplacé par votre vrai compte une fois Clerk connecté.
          </p>
          <div className="mt-4">
            <ProfileForm fullName={user.fullName ?? ""} email={user.email} />
          </div>
        </section>

        <section className="rounded-2xl border border-pm-gris-2 bg-white p-6">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Organisation</h2>
          <p className="mt-1 text-xs text-pm-gris">Le nom affiché à votre conseiller et dans les rapports.</p>
          <div className="mt-4">
            <OrganizationForm name={org.name} />
          </div>
        </section>

        <section className="rounded-2xl border border-pm-gris-2 bg-white p-6">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Abonnement</h2>
          <p className="mt-1 text-xs text-pm-gris">
            Facturation gérée via FastSpring (merchant of record) — données simulées.
          </p>
          <div className="mt-4">
            {subscription && subscription.status !== "canceled" ? (
              <>
                <p className="font-medium text-pm-noir">
                  {plans.find((p) => p.id === subscription.plan)?.name ?? subscription.plan}
                </p>
                <p className="mt-1 text-sm text-pm-gris">
                  {subscription.priceEuros} €/mois · {STATUS_LABEL[subscription.status] ?? subscription.status}
                </p>
              </>
            ) : (
              <p className="text-sm text-pm-gris">Aucun abonnement actif.</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-pm-gris-2 bg-white p-6">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Notifications</h2>
          <div className="mt-4">
            <NotificationToggle enabled={org.emailNotificationsEnabled} />
          </div>
        </section>

        <section className="rounded-2xl border border-pm-gris-2 bg-white p-6 lg:col-span-2">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Rapports automatiques</h2>
          <p className="mt-1 text-xs text-pm-gris">
            Envoi périodique d&apos;un résumé d&apos;audit (délivré en notification in-app tant qu&apos;aucun
            fournisseur email n&apos;est configuré).
          </p>
          <div className="mt-4">
            <ReportScheduleForm frequency={schedule?.frequency ?? "monthly"} enabled={schedule?.enabled ?? false} />
          </div>
        </section>
      </div>
    </>
  );
}
