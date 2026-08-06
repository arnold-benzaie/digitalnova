import { eq } from "drizzle-orm";
import { db } from "@/db";
import { onboarding } from "@/db/schema";
import { OnboardingClient } from "@/components/onboarding-client";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero } from "@/components/admin/page-hero";

export default async function OnboardingPage() {
  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].dashboard.onboarding;
  const [record] = await db
    .select()
    .from(onboarding)
    .where(eq(onboarding.organizationId, org.id))
    .limit(1);

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.lead} />

      <div className="mt-6">
        <OnboardingClient
          completed={Boolean(record?.completedAt)}
          summary={record ? [record.summary, record.nextStep].filter(Boolean).join(" ") || null : null}
          answers={(record?.answers as Record<string, string>) ?? {}}
          locale={locale}
        />
      </div>
    </>
  );
}
