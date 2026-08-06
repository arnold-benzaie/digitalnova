import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import {
  getOrganizationById,
  listDeliveriesForOrg,
  listDeliveryAttemptsForDeliveries,
  listWebhookEndpointOptionsForOrg,
} from "@/lib/integrations/queries";
import { WEBHOOK_DELIVERY_STATUSES, type WebhookDeliveryStatus } from "@/lib/integrations/contracts";
import { IntegrationsNav } from "@/components/integrations/integrations-nav";
import { Pagination } from "@/components/gbp-audit/ui/pagination";
import { DeliveryTable, type DeliveryRow } from "@/components/integrations/journal/delivery-table";
import { AdminPageHero } from "@/components/admin/page-hero";

const PAGE_SIZE = 20;

function parseStatus(value: string | undefined): WebhookDeliveryStatus | undefined {
  return value && (WEBHOOK_DELIVERY_STATUSES as readonly string[]).includes(value) ? (value as WebhookDeliveryStatus) : undefined;
}

function parsePage(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function buildHref(organizationId: string, params: { status?: string; endpointId?: string; page?: number }) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.endpointId) qs.set("endpointId", params.endpointId);
  if (params.page && params.page > 1) qs.set("page", String(params.page));
  const query = qs.toString();
  return `/admin/integrations/${organizationId}/journaux${query ? `?${query}` : ""}`;
}

export default async function IntegrationJournauxPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ status?: string; endpointId?: string; page?: string }>;
}) {
  await requireStaffRole();
  const { organizationId } = await params;
  const searchParamsResolved = await searchParams;
  const locale = await getLocale();
  const t = dictionaries[locale].integrations;

  const status = parseStatus(searchParamsResolved.status);
  const endpointId = searchParamsResolved.endpointId || undefined;
  const page = parsePage(searchParamsResolved.page);

  const [org, endpointOptions] = await Promise.all([
    getOrganizationById(organizationId),
    listWebhookEndpointOptionsForOrg(organizationId),
  ]);
  if (!org) notFound();

  const { rows, total } = await listDeliveriesForOrg(organizationId, { status, endpointId, page, pageSize: PAGE_SIZE });
  const attempts = await listDeliveryAttemptsForDeliveries(rows.map((r) => r.id));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const deliveries: DeliveryRow[] = rows.map((row) => ({
    id: row.id,
    event: row.event,
    status: row.status,
    responseStatus: row.responseStatus,
    responseDurationMs: row.responseDurationMs,
    lastErrorCode: row.lastErrorCode,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt.toISOString(),
    endpointName: row.endpointName,
    attempts: attempts
      .filter((a) => a.deliveryId === row.id)
      .map((a) => ({
        id: a.id,
        attemptNumber: a.attemptNumber,
        status: a.status,
        responseStatus: a.responseStatus,
        durationMs: a.durationMs,
        errorCode: a.errorCode,
        startedAt: a.startedAt.toISOString(),
      })),
  }));

  return (
    <>
      <Link href={`/admin/integrations/${organizationId}`} className="text-sm text-pm-gris hover:text-pm-noir">
        ← {org.name}
      </Link>
      <div className="mt-2">
        <AdminPageHero title={t.journaux.title} subtitle={t.journaux.subtitle} />
      </div>

      <IntegrationsNav organizationId={organizationId} active="journaux" locale={locale} />

      <form
        action={`/admin/integrations/${organizationId}/journaux`}
        className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center"
      >
        <div>
          <label htmlFor="status" className="sr-only">
            {t.journaux.filters.statusLabel}
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
          >
            <option value="">{t.journaux.filters.statusAll}</option>
            {WEBHOOK_DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.journaux.deliveryStatus[s as keyof typeof t.journaux.deliveryStatus] ?? s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="endpointId" className="sr-only">
            {t.journaux.filters.endpointLabel}
          </label>
          <select
            id="endpointId"
            name="endpointId"
            defaultValue={endpointId ?? ""}
            className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
          >
            <option value="">{t.journaux.filters.endpointAll}</option>
            {endpointOptions.map((endpoint) => (
              <option key={endpoint.id} value={endpoint.id}>
                {endpoint.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-pm-noir-2">
          {t.journaux.filters.apply}
        </button>
        {(status || endpointId) && (
          <Link href={`/admin/integrations/${organizationId}/journaux`} className="text-xs text-pm-gris underline underline-offset-2">
            {t.journaux.filters.reset}
          </Link>
        )}
      </form>

      {deliveries.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.journaux.empty}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.journaux.emptyHint}</p>
        </div>
      ) : (
        <div className="mt-6">
          <DeliveryTable deliveries={deliveries} locale={locale} />
          <Pagination page={page} totalPages={totalPages} buildHref={(p) => buildHref(organizationId, { status, endpointId, page: p })} locale={locale} />
        </div>
      )}
    </>
  );
}
