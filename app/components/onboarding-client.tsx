"use client";

import { useState } from "react";
import { OnboardingWizard } from "@/components/onboarding-wizard";

export function OnboardingClient({
  completed,
  summary,
  answers,
}: {
  completed: boolean;
  summary: string | null;
  answers: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);

  if (!completed || editing) {
    return <OnboardingWizard initialAnswers={answers} onComplete={() => setEditing(false)} />;
  }

  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-pm-gris">
        Synthèse de votre profil (générée par IA)
      </p>
      <p className="mt-2 text-sm text-pm-noir">{summary}</p>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-4 text-sm text-pm-gris underline hover:text-pm-noir"
      >
        Modifier mes réponses
      </button>
    </div>
  );
}
