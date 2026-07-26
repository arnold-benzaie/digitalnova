import { eq } from "drizzle-orm";
import { db } from "@/db";
import { onboarding } from "@/db/schema";
import { OnboardingClient } from "@/components/onboarding-client";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";

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
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
      <p className="mt-2 text-sm text-pm-gris">{t.lead}</p>

      <div className="mt-6">
        <OnboardingClient
          completed={Boolean(record?.completedAt)}
          summary={record?.summary ?? null}
          answers={(record?.answers as Record<string, string>) ?? {}}
          locale={locale}
        />
      </div>
    </>
  );
}
