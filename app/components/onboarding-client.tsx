"use client";

import { useState } from "react";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function OnboardingClient({
  completed,
  summary,
  answers,
  locale = "fr",
}: {
  completed: boolean;
  summary: string | null;
  answers: Record<string, string>;
  locale?: Locale;
}) {
  const t = dictionaries[locale].dashboard.onboarding;
  const [editing, setEditing] = useState(false);

  if (!completed || editing) {
    return <OnboardingWizard initialAnswers={answers} onComplete={() => setEditing(false)} locale={locale} />;
  }

  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">{t.summaryTitle}</p>
      <p className="mt-2 text-sm text-pm-noir">{summary}</p>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-4 text-sm text-pm-gris underline hover:text-pm-noir"
      >
        {t.editAnswers}
      </button>
    </div>
  );
}
