import Link from "next/link";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { WebhooksSubnav } from "@/components/developer-console/webhooks-subnav";
import { WebhookTestTool } from "@/components/developer-console/webhook-test-tool";
import { SignatureVerifier } from "@/components/developer-console/signature-verifier";

/**
 * Webhook debugging tools (built in Stage 4, moved under /webhooks/tools
 * in Stage 5 once /developers/console/webhooks itself became the real
 * endpoint-management landing page) — an EPHEMERAL test tool and
 * signature verifier, deliberately separate from the persisted-endpoint
 * CRUD at /developers/console/webhooks. See
 * lib/developer-console/dev-tools.ts's module docstring for the reuse
 * boundary against lib/integrations/test-runner.ts.
 */
export default async function DeveloperConsoleWebhookToolsPage() {
  const locale = await getLocale();
  const t = dictionaries[locale].developerConsole.webhookTools;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
        <p className="text-sm text-pm-gris">{t.subtitle}</p>
        <Link href="/developers/docs/webhooks" className="text-sm font-medium text-pm-noir underline underline-offset-2">
          {t.docsLink}
        </Link>
      </div>

      <WebhooksSubnav locale={locale} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <WebhookTestTool locale={locale} />
        <SignatureVerifier locale={locale} />
      </div>
    </div>
  );
}
