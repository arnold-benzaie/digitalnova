"use client";

import { useState } from "react";
import { Badge } from "@/components/crm/badges";
import { CompetitorForm, type EditableCompetitor } from "@/components/gbp-audit/competitor-form";
import { DeleteCompetitorButton } from "@/components/gbp-audit/delete-competitor-button";
import type { CompetitorComparison } from "@/lib/gbp-audit/competitor-scoring";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

const VERDICT_CLASS: Record<CompetitorComparison["overallVerdict"], string> = {
  ahead: "bg-pm-g-green/10 text-pm-g-green",
  behind: "bg-pm-rouge/10 text-pm-rouge-2",
  tied: "bg-pm-gris-2/60 text-pm-gris",
  unknown: "bg-pm-gris-2/60 text-pm-gris",
};

function DeltaCell({ ours, theirs, format = (v) => String(v) }: { ours: number | null; theirs: number | null; format?: (v: number) => string }) {
  if (ours === null || theirs === null) return <span className="text-pm-gris">—</span>;
  const delta = ours - theirs;
  const sign = delta > 0 ? "+" : "";
  const cls = delta > 0 ? "text-pm-g-green" : delta < 0 ? "text-pm-rouge-2" : "text-pm-gris";
  return (
    <span>
      {format(theirs)} <span className={`text-xs ${cls}`}>({sign}{format(delta)})</span>
    </span>
  );
}

export function CompetitorComparisonRow({
  auditId,
  competitor,
  comparison,
  locale = "fr",
}: {
  auditId: string;
  competitor: EditableCompetitor;
  comparison: CompetitorComparison;
  locale?: Locale;
}) {
  const t = dictionaries[locale].auditModule.competition;
  const [editing, setEditing] = useState(false);
  const ratingComparison = comparison.metrics.find((m) => m.metric === "rating");
  const reviewComparison = comparison.metrics.find((m) => m.metric === "reviewCount");
  const photoComparison = comparison.metrics.find((m) => m.metric === "photoCount");

  if (editing) {
    return (
      <tr className="border-t border-pm-gris-2">
        <td colSpan={7} className="p-0">
          <div className="p-4">
            <CompetitorForm auditId={auditId} competitor={competitor} onDone={() => setEditing(false)} locale={locale} />
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-pm-gris-2">
      <td className="px-5 py-3 font-medium text-pm-noir">
        {competitor.googleProfileUrl ? (
          <a href={competitor.googleProfileUrl} target="_blank" rel="noreferrer" className="hover:underline">{competitor.name}</a>
        ) : competitor.name}
      </td>
      <td className="px-5 py-3 text-pm-gris">
        <DeltaCell
          ours={typeof ratingComparison?.ours === "number" ? ratingComparison.ours / 100 : null}
          theirs={competitor.rating !== null ? competitor.rating / 100 : null}
          format={(v) => v.toFixed(1)}
        />
      </td>
      <td className="px-5 py-3 text-pm-gris">
        <DeltaCell ours={reviewComparison?.ours as number | null} theirs={competitor.reviewCount} />
      </td>
      <td className="px-5 py-3 text-pm-gris">
        <DeltaCell ours={photoComparison?.ours as number | null} theirs={competitor.photoCount} />
      </td>
      <td className="px-5 py-3 text-pm-gris">{competitor.postsRecent ? t.yes : t.no}</td>
      <td className="px-5 py-3">
        <Badge label={t.verdict[comparison.overallVerdict]} className={VERDICT_CLASS[comparison.overallVerdict]} />
      </td>
      <td className="px-5 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-pm-gris underline hover:text-pm-noir">
            {t.edit}
          </button>
          <DeleteCompetitorButton competitorId={competitor.id} auditId={auditId} name={competitor.name} locale={locale} />
        </div>
      </td>
    </tr>
  );
}
