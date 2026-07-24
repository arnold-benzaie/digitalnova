import { eq } from "drizzle-orm";
import { db } from "@/db";
import { onboarding } from "@/db/schema";
import { OnboardingClient } from "@/components/onboarding-client";
import { getOrCreateDevOrganization } from "@/lib/dev-org";

export default async function OnboardingPage() {
  const org = await getOrCreateDevOrganization();
  const [record] = await db
    .select()
    .from(onboarding)
    .where(eq(onboarding.organizationId, org.id))
    .limit(1);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Questionnaire d&apos;accueil</h1>
      <p className="mt-2 text-sm text-pm-gris">
        Quelques questions pour que votre conseiller comprenne vos besoins
        (résumé généré par IA — voir README pour la mise en production).
      </p>

      <div className="mt-6">
        <OnboardingClient
          completed={Boolean(record?.completedAt)}
          summary={record?.summary ?? null}
          answers={(record?.answers as Record<string, string>) ?? {}}
        />
      </div>
    </>
  );
}
