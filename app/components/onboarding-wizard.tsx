"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeOnboarding } from "@/lib/actions/onboarding";
import { ONBOARDING_QUESTIONS } from "@/lib/onboarding-questions";

export function OnboardingWizard({
  initialAnswers,
  onComplete,
}: {
  initialAnswers?: Record<string, string>;
  onComplete?: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers ?? {});
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const question = ONBOARDING_QUESTIONS[step];
  const isLast = step === ONBOARDING_QUESTIONS.length - 1;
  const currentValue = answers[question.key] ?? "";

  function setValue(value: string) {
    setAnswers((prev) => ({ ...prev, [question.key]: value }));
  }

  function goNext() {
    if (!currentValue.trim()) {
      setError("Merci de répondre avant de continuer.");
      return;
    }
    setError(null);
    if (isLast) {
      startTransition(async () => {
        await completeOnboarding(answers);
        onComplete?.();
        router.refresh();
      });
      return;
    }
    setStep((s) => s + 1);
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  }

  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-6">
      <div className="flex items-center justify-between text-xs text-pm-gris">
        <span>
          Question {step + 1} / {ONBOARDING_QUESTIONS.length}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-pm-gris-2/50">
        <div
          className="h-full rounded-full bg-pm-noir transition-all"
          style={{ width: `${((step + 1) / ONBOARDING_QUESTIONS.length) * 100}%` }}
        />
      </div>

      <p className="mt-6 font-serif text-xl font-semibold text-pm-noir">{question.label}</p>

      <div className="mt-4">
        {question.type === "choice" && question.choices ? (
          <div className="flex flex-col gap-2">
            {question.choices.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setValue(choice)}
                className={`rounded-lg border px-4 py-2 text-left text-sm transition ${
                  currentValue === choice
                    ? "border-pm-noir bg-pm-noir text-white"
                    : "border-pm-gris-2 bg-white text-pm-noir hover:bg-pm-gris-2/30"
                }`}
              >
                {choice}
              </button>
            ))}
          </div>
        ) : question.type === "textarea" ? (
          <textarea
            value={currentValue}
            onChange={(e) => setValue(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
          />
        ) : (
          <input
            type="text"
            value={currentValue}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
          />
        )}
      </div>

      {error && <p className="mt-2 text-sm text-pm-rouge">{error}</p>}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 0 || isPending}
          className="text-sm text-pm-gris underline disabled:opacity-0"
        >
          Précédent
        </button>
        <button
          type="button"
          onClick={goNext}
          disabled={isPending}
          className="rounded-lg bg-pm-noir px-5 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
        >
          {isPending ? "Analyse en cours..." : isLast ? "Terminer" : "Suivant"}
        </button>
      </div>
    </div>
  );
}
