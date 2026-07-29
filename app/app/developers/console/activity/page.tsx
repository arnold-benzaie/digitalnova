import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getApiKeyEvents } from "@/lib/developer-console/queries";
import { formatDateTime } from "@/lib/i18n/format";
import { FadeIn } from "@/components/developer-portal/motion/fade-in";

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
    <FadeIn className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      {events.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">{t.empty}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3">{t.columns.event}</th>
                <th className="px-5 py-3">{t.columns.key}</th>
                <th className="px-5 py-3">{t.columns.actor}</th>
                <th className="px-5 py-3">{t.columns.when}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-t border-border align-top">
                  <td className="px-5 py-3 text-foreground">{t.actions[event.action] ?? event.action}</td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{summarizeMetadata(event.metadata)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{event.actorName ?? event.actorEmail ?? t.unknownActor}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDateTime(event.createdAt.toISOString(), locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FadeIn>
  );
}
