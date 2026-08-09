import Link from "next/link";
import type { ActivityEvent } from "@/lib/activity-timeline";
import { Timeline } from "@/components/gbp-audit/ui/timeline";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";
import { formatRelativeTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";

/**
 * Thin presentational wrapper around the existing, unmodified
 * `Timeline`/`EmptyState` components (components/gbp-audit/ui/*) — maps
 * the aggregation layer's `ActivityEvent[]` (lib/activity-timeline.ts)
 * into `TimelineEntry[]`. No new list/rail UI is built here on purpose.
 */
export function ActivityTimelineCard({
  events,
  locale,
  title,
  emptyTitle,
  emptyDescription,
}: {
  events: ActivityEvent[];
  locale: Locale;
  title: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (events.length === 0) {
    return <EmptyState icon={<NAV_ICONS.history width={20} height={20} />} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div aria-label={title}>
      <Timeline
        entries={events.map((event) => ({
          id: event.id,
          tone: event.tone,
          timestamp: formatRelativeTime(event.timestamp, locale),
          title: event.href ? (
            <Link href={event.href} className="hover:underline">
              {event.title}
            </Link>
          ) : (
            event.title
          ),
          description: event.description,
        }))}
      />
    </div>
  );
}
