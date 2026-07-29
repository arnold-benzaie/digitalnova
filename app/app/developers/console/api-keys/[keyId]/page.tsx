import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import { getApiKeyEvents, getApiKeyForOrg } from "@/lib/developer-console/queries";
import { Badge } from "@/components/ui/badge";
import { API_KEY_STATUS_CLASS } from "@/components/integrations/badges";
import { FadeIn } from "@/components/developer-portal/motion/fade-in";

/**
 * Self-service API key detail page (Stage 3 of the developer-platform
 * plan) — metadata-only display (Name/Prefix/Created/Last used/Last IP/
 * Status), plus this key's own audit trail. No "Reveal" of the key
 * material — that's architecturally impossible under the hash-only
 * storage model (see lib/integrations/crypto.ts); Rotate (already
 * available from the keys table) is the only way to get a new usable
 * secret, matching Stripe/GitHub/OpenAI's own model.
 */
export default async function DeveloperConsoleApiKeyDetailPage({
  params,
}: {
  params: Promise<{ keyId: string }>;
}) {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const { keyId } = await params;
  const t = dictionaries[locale].developerConsole.dashboard;

  // getApiKeyForOrg scopes by session.organizationId — another
  // organization's key id renders the exact same 404 as a nonexistent
  // one, never a distinguishable "forbidden".
  const key = await getApiKeyForOrg(session.organizationId, keyId);
  if (!key) notFound();

  const events = await getApiKeyEvents(session.organizationId, { apiKeyId: keyId, limit: 50 });
  const eventLabels = dictionaries[locale].developerConsole.activity.actions;

  return (
    <FadeIn className="flex flex-col gap-4">
      <div>
        <Link href="/developers/console" className="text-sm text-muted-foreground hover:text-foreground">
          {t.keysSection.detail.backTo}
        </Link>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-foreground">{key.name || t.keysSection.unnamed}</h1>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-foreground">{t.keysSection.detail.generalTitle}</h2>
          <Badge variant="outline" className={API_KEY_STATUS_CLASS[key.status] ?? ""}>
            {t.keysSection.status[key.status] ?? key.status}
          </Badge>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.keysSection.detail.prefixLabel}</dt>
            <dd className="mt-0.5 font-mono text-xs text-foreground">{key.keyPrefix}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.keysSection.detail.createdLabel}</dt>
            <dd className="mt-0.5 text-foreground">{formatDate(key.createdAt.toISOString(), locale)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.keysSection.detail.lastUsedLabel}</dt>
            <dd className="mt-0.5 text-foreground">{key.lastUsedAt ? formatDateTime(key.lastUsedAt.toISOString(), locale) : t.keysSection.never}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.keysSection.detail.lastIpLabel}</dt>
            <dd className="mt-0.5 font-mono text-xs text-foreground">{key.lastUsedIp ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.keysSection.detail.expiresLabel}</dt>
            <dd className="mt-0.5 text-foreground">{key.expiresAt ? formatDate(key.expiresAt.toISOString(), locale) : t.keysSection.noExpiry}</dd>
          </div>
        </dl>
        <dl className="mt-4">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.keysSection.detail.scopesLabel}</dt>
          <dd className="mt-1.5 flex flex-wrap gap-1">
            {key.scopes.map((scope) => (
              <span key={scope} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground">
                {t.scopes[scope] ?? scope}
              </span>
            ))}
          </dd>
        </dl>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-serif text-lg font-semibold text-foreground">{t.keysSection.detail.auditLogTitle}</h2>
        {events.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{t.keysSection.detail.auditLogEmpty}</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {events.map((event) => (
              <li key={event.id} className="flex items-center justify-between border-t border-border pt-3 text-sm">
                <span className="text-foreground">{eventLabels[event.action] ?? event.action}</span>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{event.actorName ?? event.actorEmail ?? dictionaries[locale].developerConsole.activity.unknownActor}</span>
                  <span>{formatDateTime(event.createdAt.toISOString(), locale)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </FadeIn>
  );
}
