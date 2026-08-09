import type { ReactNode } from "react";
import { SEMANTIC_DOT, type SemanticTone } from "@/lib/gbp-audit/status-colors";

export interface TimelineEntry {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  timestamp: string;
  tone?: SemanticTone;
}

/** Premium correction/activity timeline — vertical rail with a tone-colored node per entry, replacing ad hoc dot lists. */
export function Timeline({ entries, className = "" }: { entries: TimelineEntry[]; className?: string }) {
  return (
    <ol className={`flex flex-col ${className}`}>
      {entries.map((entry, i) => (
        <li key={entry.id} className="relative flex gap-3 pb-6 last:pb-0">
          {i < entries.length - 1 && <span className="absolute left-[5px] top-4 h-full w-px bg-pm-gris-2" aria-hidden="true" />}
          <span className={`relative mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${SEMANTIC_DOT[entry.tone ?? "neutral"]}`} aria-hidden="true" />
          <div className="flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium text-pm-noir">{entry.title}</p>
              <p className="text-xs text-pm-gris">{entry.timestamp}</p>
            </div>
            {entry.description && <p className="mt-0.5 text-sm text-pm-gris">{entry.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
