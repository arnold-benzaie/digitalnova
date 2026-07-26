import { desc } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDateTime } from "@/lib/i18n/format";

const STATUS_CLASS: Record<string, string> = {
  sent: "bg-pm-g-green/10 text-pm-g-green",
  failed: "bg-pm-rouge/10 text-pm-rouge-2",
  skipped_not_configured: "bg-pm-gris-2/60 text-pm-gris",
};

export default async function WebhooksPage() {
  await requireStaffRole();
  const locale = await getLocale();
  const t = dictionaries[locale].settings.webhooks;

  const deliveries = await db.select().from(webhookDeliveries).orderBy(desc(webhookDeliveries.createdAt)).limit(100);
  const configured = Boolean(process.env.N8N_WEBHOOK_URL);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
      <p className="mt-2 text-sm text-pm-gris">
        {configured ? (
          t.configured
        ) : (
          <>
            <code className="rounded bg-pm-gris-2/40 px-1.5 py-0.5 text-xs">N8N_WEBHOOK_URL</code> {t.notConfigured}
          </>
        )}
      </p>

      {deliveries.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.empty}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">{t.columns.event}</th>
                <th className="px-5 py-3">{t.columns.status}</th>
                <th className="px-5 py-3">{t.columns.date}</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id} className="border-t border-pm-gris-2">
                  <td className="px-5 py-3 text-pm-noir">
                    <p className="font-medium">{t.events[delivery.event] ?? t.unknownEvent}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-pm-gris">{delivery.event}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASS[delivery.status] ?? ""}`}>
                      {t.status[delivery.status as keyof typeof t.status] ?? delivery.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-pm-gris">{formatDateTime(delivery.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
