"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { completeOnboarding } from "@/lib/actions/onboarding";
import { getOnboardingQuestions } from "@/lib/onboarding-questions";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { Button } from "@/components/gbp-audit/ui/button";
import { panelClass } from "@/components/admin/page-hero";

export function OnboardingWizard({
  initialAnswers,
  onComplete,
  locale = "fr",
}: {
  initialAnswers?: Record<string, string>;
  onComplete?: () => void;
  locale?: Locale;
}) {
  const t = dictionaries[locale].dashboard.onboarding;
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers ?? {});
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const questions = getOnboardingQuestions(locale);
  const question = questions[step];
  const isLast = step === questions.length - 1;
  const currentValue = answers[question.key] ?? "";

  function setValue(value: string) {
    setAnswers((prev) => ({ ...prev, [question.key]: value }));
  }

  function goNext() {
    if (!currentValue.trim()) {
      setError(t.requiredError);
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
    <div className={panelClass}>
      <div className="flex items-center justify-between text-xs text-pm-gris">
        <span>{t.questionOf(step + 1, questions.length)}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-pm-gris-2/50">
        <div
          className="h-full rounded-full bg-pm-bleu-eu transition-all"
          style={{ width: `${((step + 1) / questions.length) * 100}%` }}
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
                    ? "border-pm-bleu-eu bg-pm-bleu-eu text-white"
                    : "border-pm-gris-2 bg-white text-pm-noir hover:border-pm-g-blue/30 hover:bg-pm-g-blue/5"
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
            className="w-full resize-none rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-g-blue/20"
          />
        ) : (
          <input
            type="text"
            value={currentValue}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-g-blue/20"
          />
        )}
      </div>

      {error && <p className="mt-2 text-sm text-pm-rouge">{error}</p>}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 0 || isPending}
          className="text-sm text-pm-gris underline transition hover:text-pm-bleu-eu disabled:opacity-0"
        >
          {dictionaries[locale].common.previous}
        </button>
        <Button type="button" onClick={goNext} loading={isPending}>
          {isPending ? t.analyzing : isLast ? t.finish : dictionaries[locale].common.next}
        </Button>
      </div>
    </div>
  );
}
