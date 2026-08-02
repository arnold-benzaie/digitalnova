import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { NotificationToggle, OrganizationForm, ProfileForm } from "@/components/settings-forms";
import { NotificationPreferencesControl } from "@/components/notification-preferences";
import { ReportScheduleForm } from "@/components/report-schedule-form";
import { getBillingProvider } from "@/lib/billing";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getOrCreateDevUser } from "@/lib/dev-user";
import { getReportSchedule } from "@/lib/report-schedule";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getNotificationSoundPath } from "@/lib/notification-sound-availability";

export default async function SettingsPage() {
  const [org, user, locale] = await Promise.all([getOrCreateDevOrganization(), getOrCreateDevUser(), getLocale()]);
  const soundPath = getNotificationSoundPath();
  const t = dictionaries[locale].settings;
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, org.id)).limit(1);
  const plans = getBillingProvider().listPlans();
  const schedule = await getReportSchedule(org.id);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
      <p className="mt-2 text-sm text-pm-gris">{t.lead}</p>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-pm-gris-2 bg-white p-6">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.profile.title}</h2>
          <p className="mt-1 text-xs text-pm-gris">{t.profile.demoNotice}</p>
          <div className="mt-4">
            <ProfileForm fullName={user.fullName ?? ""} email={user.email} locale={locale} />
          </div>
        </section>

        <section className="rounded-2xl border border-pm-gris-2 bg-white p-6">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.organization.title}</h2>
          <p className="mt-1 text-xs text-pm-gris">{t.organization.lead}</p>
          <div className="mt-4">
            <OrganizationForm name={org.name} locale={locale} />
          </div>
        </section>

        <section className="rounded-2xl border border-pm-gris-2 bg-white p-6">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.subscription.title}</h2>
          <p className="mt-1 text-xs text-pm-gris">{t.subscription.lead}</p>
          <div className="mt-4">
            {subscription && subscription.status !== "canceled" ? (
              <>
                <p className="font-medium text-pm-noir">
                  {plans.find((p) => p.id === subscription.plan)?.name ?? subscription.plan}
                </p>
                <p className="mt-1 text-sm text-pm-gris">
                  {t.subscription.perMonth(subscription.priceEuros)} · {t.status[subscription.status as keyof typeof t.status] ?? subscription.status}
                </p>
              </>
            ) : (
              <p className="text-sm text-pm-gris">{t.subscription.none}</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-pm-gris-2 bg-white p-6">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.notifications.title}</h2>
          <div className="mt-4">
            <NotificationToggle enabled={org.emailNotificationsEnabled} locale={locale} />
          </div>
        </section>

        <div>
          <NotificationPreferencesControl locale={locale} soundPath={soundPath} />
        </div>

        <section className="rounded-2xl border border-pm-gris-2 bg-white p-6 lg:col-span-2">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.reportSchedule.title}</h2>
          <p className="mt-1 text-xs text-pm-gris">{t.reportSchedule.lead}</p>
          <div className="mt-4">
            <ReportScheduleForm frequency={schedule?.frequency ?? "monthly"} enabled={schedule?.enabled ?? false} locale={locale} />
          </div>
        </section>
      </div>
    </>
  );
}
