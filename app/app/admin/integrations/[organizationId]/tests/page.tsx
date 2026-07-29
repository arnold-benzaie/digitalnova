import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getOrganizationById, listTestRunsForOrg, listWebhookEndpointsForOrg } from "@/lib/integrations/queries";
import { IntegrationsNav } from "@/components/integrations/integrations-nav";
import { Pagination } from "@/components/gbp-audit/ui/pagination";
import { TestPanel } from "@/components/integrations/tests/test-panel";
import { TriggerWorkerPanel } from "@/components/integrations/tests/trigger-worker-panel";
import { TestHistoryTable, type TestRunRow } from "@/components/integrations/tests/test-history-table";

const PAGE_SIZE = 20;
const SUPPORTED_EVENT_TYPE = "user.pending.created";

function parsePage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export default async function IntegrationTestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdminRole();
  const { organizationId } = await params;
  const { page: pageParam } = await searchParams;
  const locale = await getLocale();
  const t = dictionaries[locale].integrations;
  const page = parsePage(pageParam);

  const [org, endpoints, { rows, total }] = await Promise.all([
    getOrganizationById(organizationId),
    listWebhookEndpointsForOrg(organizationId),
    listTestRunsForOrg(organizationId, { page, pageSize: PAGE_SIZE }),
  ]);
  if (!org) notFound();

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
    <>
      <Link href={`/admin/integrations/${organizationId}`} className="text-sm text-pm-gris hover:text-pm-noir">
        ← {org.name}
      </Link>
      <h1 className="mt-2 font-serif text-3xl font-semibold text-pm-noir">{t.tests.title}</h1>
      <p className="mt-1 text-sm text-pm-gris">{t.tests.subtitle}</p>

      <IntegrationsNav organizationId={organizationId} active="tests" locale={locale} />

      <div className="mt-6 flex flex-col gap-6">
        <TestPanel
          organizationId={organizationId}
          endpointOptions={activeEndpointOptions}
          eventLabel={t.webhooks.events[SUPPORTED_EVENT_TYPE] ?? SUPPORTED_EVENT_TYPE}
          locale={locale}
        />

        <TriggerWorkerPanel organizationId={organizationId} locale={locale} />

        <div>
          <TestHistoryTable organizationId={organizationId} runs={runs} locale={locale} />
          <Pagination
            page={page}
            totalPages={totalPages}
            buildHref={(p) => `/admin/integrations/${organizationId}/tests${p > 1 ? `?page=${p}` : ""}`}
            locale={locale}
          />
        </div>
      </div>
    </>
  );
}
