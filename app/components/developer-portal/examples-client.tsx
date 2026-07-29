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
      <div role="tablist" className="inline-flex w-fit gap-1 rounded-full border border-border bg-muted/40 p-1">
        {LANGUAGES.map((lang) => (
          <button
            key={lang}
            role="tab"
            aria-selected={active === lang}
            onClick={() => setActive(lang)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              active === lang ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tabLabels[lang]}
          </button>
        ))}
      </div>

      {scenarios.map((scenario) => (
        <section key={scenario.key} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
          <h2 className="font-serif text-lg font-semibold text-foreground">{scenario.title}</h2>
          <pre className="overflow-x-auto rounded-xl bg-muted p-4 text-xs text-foreground">
            <code>{scenario.snippets[active]}</code>
          </pre>
        </section>
      ))}
    </div>
  );
}
