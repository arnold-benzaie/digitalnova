"use client";

import { useState, type ReactNode } from "react";

export function Tabs({ tabs }: { tabs: { key: string; label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.key);

  return (
    <div>
      <div role="tablist" aria-label="Sections des paramètres" className="flex gap-1 overflow-x-auto border-b border-pm-gris-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            onClick={() => setActive(tab.key)}
            className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
              active === tab.key ? "border-pm-noir text-pm-noir" : "border-transparent text-pm-gris hover:text-pm-noir"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} role="tabpanel" hidden={active !== tab.key} className="mt-6">
          {tab.content}
        </div>
      ))}
    </div>
  );
}
