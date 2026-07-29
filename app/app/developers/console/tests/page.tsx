import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { listTestRunsForOrg, listWebhookEndpointsForOrg } from "@/lib/developer-console/queries";
import { Pagination } from "@/components/gbp-audit/ui/pagination";
import { TestPanel } from "@/components/developer-console/test-panel";
import { TestHistoryTable, type TestRunRow } from "@/components/developer-console/test-history-table";
import { FadeIn } from "@/components/developer-portal/motion/fade-in";

const PAGE_SIZE = 20;
const SUPPORTED_EVENT_TYPE = "user.pending.created";

function parsePage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/**
 * Self-service Playground (Stage 1 of the developer-platform plan) — the
 * org-member counterpart to
 * app/admin/integrations/[organizationId]/tests/page.tsx, scoped to
 * session.organizationId only. Deliberately does not include a
 * TriggerWorkerPanel equivalent — see lib/developer-console/tests-actions.ts's
 * doc comment for why (that action is platform-global, staff-only).
 */
export default async function DeveloperConsoleTestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const [session, locale, { page: pageParam }] = await Promise.all([requireSession(), getLocale(), searchParams]);
  const t = dictionaries[locale].developerConsole.tests;
  const eventLabel = dictionaries[locale].developerConsole.webhooksManager.events[SUPPORTED_EVENT_TYPE] ?? SUPPORTED_EVENT_TYPE;
  const page = parsePage(pageParam);

  const [endpoints, { rows, total }] = await Promise.all([
    listWebhookEndpointsForOrg(session.organizationId),
    listTestRunsForOrg(session.organizationId, { page, pageSize: PAGE_SIZE }),
  ]);

  const activeEndpointOptions = endpoints.filter((e) => e.status === "active").map((e) => ({ id: e.id, name: e.name }));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const runs: TestRunRow[] = rows.map((run) => ({
    id: run.id,
    endpointName: run.endpointName,
    mode: run.mode,
    eventType: run.eventType,
    requestPayload: run.requestPayload,
    responseStatus: run.responseStatus,
    responseDurationMs: run.responseDurationMs,
    errorCode: run.errorCode,
    replayOfId: run.replayOfId,
    createdAt: run.createdAt.toISOString(),
  }));

  return (
    <FadeIn className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      <TestPanel endpointOptions={activeEndpointOptions} eventLabel={eventLabel} locale={locale} />

      <div>
        <TestHistoryTable runs={runs} locale={locale} />
        <Pagination
          page={page}
          totalPages={totalPages}
          buildHref={(p) => `/developers/console/tests${p > 1 ? `?page=${p}` : ""}`}
          locale={locale}
        />
      </div>
    </FadeIn>
  );
}
