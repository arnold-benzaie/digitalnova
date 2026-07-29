import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getApiKeyEvents } from "@/lib/developer-console/queries";
import { formatDateTime } from "@/lib/i18n/format";

function summarizeMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  const record = metadata as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.keyPrefix === "string") parts.push(record.keyPrefix);
  if (typeof record.name === "string" && record.name) parts.push(`"${record.name}"`);
  return parts.join(" — ");
}

export default async function DeveloperConsoleActivityPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const t = dictionaries[locale].developerConsole.activity;
  const events = await getApiKeyEvents(session.organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
        <p className="text-sm text-pm-gris">{t.subtitle}</p>
      </div>

      {events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="text-sm text-pm-gris">{t.empty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">{t.columns.event}</th>
                <th className="px-5 py-3">{t.columns.key}</th>
                <th className="px-5 py-3">{t.columns.actor}</th>
                <th className="px-5 py-3">{t.columns.when}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-pm-gris-2 align-top">
                  <td className="px-5 py-3 text-pm-noir">{t.actions[event.action] ?? event.action}</td>
                  <td className="px-5 py-3 font-mono text-xs text-pm-gris">{summarizeMetadata(event.metadata)}</td>
                  <td className="px-5 py-3 text-pm-gris">{event.actorName ?? event.actorEmail ?? t.unknownActor}</td>
                  <td className="px-5 py-3 text-pm-gris">{formatDateTime(event.createdAt.toISOString(), locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
