import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { listApiKeysForOrg } from "@/lib/developer-console/queries";
import { Badge } from "@/components/ui/badge";
import { API_KEY_STATUS_CLASS } from "@/components/integrations/badges";
import { ApiKeyInspector } from "@/components/developer-console/api-key-inspector";
import { FadeIn } from "@/components/developer-portal/motion/fade-in";

/**
 * API Explorer / Playground (Stage 4) — reuses the SAME Scalar-rendered
 * OpenAPI reference already serving the public /developers/reference
 * (app/developers/reference/embed/route.ts), embedded here behind the
 * Console's auth gate instead of duplicating a second interactive-docs
 * stack. Scalar's own "Test Request" panel already sends real requests
 * to /api/v1 straight from the browser and already generates cURL/JS/
 * TypeScript/Python/PHP/Go/… snippets per endpoint (via @scalar/snippetz,
 * bundled transitively) — see the Stage 4 report for why none of that is
 * hand-built here.
 */
export default async function DeveloperConsolePlaygroundPage() {
  const [session, locale] = await Promise.all([requireSession(), getLocale()]);
  const t = dictionaries[locale].developerConsole.playground;
  const dashboardT = dictionaries[locale].developerConsole.dashboard;
  const keys = await listApiKeysForOrg(session.organizationId);
  const activeKeys = keys.filter((key) => key.status === "active");

  return (
    <FadeIn className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-semibold text-foreground">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
          <h2 className="font-serif text-lg font-semibold text-foreground">{t.authCard.title}</h2>
          <p className="text-sm text-muted-foreground">{t.authCard.body}</p>

          <div className="mt-2 flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.authCard.yourKeys}</p>
            {activeKeys.length === 0 ? (
              <div>
                <p className="text-sm text-muted-foreground">{t.authCard.noKeys}</p>
                <Link href="/developers/console" className="text-sm font-medium text-foreground underline underline-offset-2">
                  {t.authCard.goToDashboard}
                </Link>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {activeKeys.map((key) => (
                  <li key={key.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                    <div className="flex flex-col">
                      <span className="text-sm text-foreground">{key.name || dashboardT.keysSection.unnamed}</span>
                      <code className="text-xs text-muted-foreground">{key.keyPrefix}</code>
                    </div>
                    <Badge variant="outline" className={API_KEY_STATUS_CLASS[key.status] ?? ""}>
                      {dashboardT.keysSection.status[key.status] ?? key.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t.authCard.prefixNote}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
          <h2 className="font-serif text-lg font-semibold text-foreground">{t.codegenCard.title}</h2>
          <p className="text-sm text-muted-foreground">{t.codegenCard.body}</p>
        </div>
      </div>

      <ApiKeyInspector locale={locale} />

      <iframe
        src="/developers/reference/embed"
        title={t.title}
        className="min-h-[80vh] w-full rounded-2xl border border-border"
      />
    </FadeIn>
  );
}
