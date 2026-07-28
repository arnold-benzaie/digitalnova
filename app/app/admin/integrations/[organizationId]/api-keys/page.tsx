import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { getOrganizationById, listApiKeysForOrg } from "@/lib/integrations/queries";
import { INTEGRATION_SCOPES } from "@/lib/integrations/governance";
import { IntegrationsNav } from "@/components/integrations/integrations-nav";
import { ApiKeysManager, type ApiKeyRow } from "@/components/integrations/api-keys/api-keys-manager";

export default async function IntegrationApiKeysPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  await requireAdminRole();
  const { organizationId } = await params;
  const locale = await getLocale();
  const t = dictionaries[locale].integrations;

  const [org, keys] = await Promise.all([getOrganizationById(organizationId), listApiKeysForOrg(organizationId)]);
  if (!org) notFound();

  const rows: ApiKeyRow[] = keys.map((key) => ({
    id: key.id,
    keyPrefix: key.keyPrefix,
    scopes: key.scopes,
    status: key.status,
    lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
    expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
    createdAt: key.createdAt.toISOString(),
  }));

  return (
    <>
      <Link href={`/admin/integrations/${organizationId}`} className="text-sm text-pm-gris hover:text-pm-noir">
        ← {org.name}
      </Link>
      <h1 className="mt-2 font-serif text-3xl font-semibold text-pm-noir">{t.apiKeys.title}</h1>
      <p className="mt-1 text-sm text-pm-gris">{t.apiKeys.subtitle}</p>

      <IntegrationsNav organizationId={organizationId} active="api-keys" locale={locale} />

      <ApiKeysManager organizationId={organizationId} initialKeys={rows} scopes={INTEGRATION_SCOPES} locale={locale} />
    </>
  );
}
