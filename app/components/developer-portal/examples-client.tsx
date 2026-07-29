"use client";

import { useState } from "react";

export type ExampleLanguage = "curl" | "javascript" | "typescript" | "python";

export type ExampleScenario = {
  key: string;
  title: string;
  snippets: Record<ExampleLanguage, string>;
};

const LANGUAGES: ExampleLanguage[] = ["curl", "javascript", "typescript", "python"];

/** Shared tab state across every scenario on the page — switch to Python
 * once, every snippet below switches with it, matching the convention
 * most multi-language API docs use. */
export function ExamplesClient({ tabLabels, scenarios }: { tabLabels: Record<ExampleLanguage, string>; scenarios: ExampleScenario[] }) {
  const [active, setActive] = useState<ExampleLanguage>("curl");

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" className="inline-flex w-fit gap-1 rounded-full border border-pm-gris-2 bg-pm-gris-2/20 p-1">
        {LANGUAGES.map((lang) => (
          <button
            key={lang}
            role="tab"
            aria-selected={active === lang}
            onClick={() => setActive(lang)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              active === lang ? "bg-pm-noir text-pm-blanc shadow-sm" : "text-pm-gris hover:text-pm-noir"
            }`}
          >
            {tabLabels[lang]}
          </button>
        ))}
      </div>

      {scenarios.map((scenario) => (
        <section key={scenario.key} className="flex flex-col gap-3 rounded-2xl border border-pm-gris-2 bg-white p-6">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{scenario.title}</h2>
          <pre className="overflow-x-auto rounded-xl bg-pm-noir p-4 text-xs text-pm-blanc">
            <code>{scenario.snippets[active]}</code>
          </pre>
        </section>
      ))}
    </div>
  );
}
