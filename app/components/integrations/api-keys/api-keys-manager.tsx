"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/crm/badges";
import { API_KEY_STATUS_CLASS } from "@/components/integrations/badges";
import { Button } from "@/components/gbp-audit/ui/button";
import { Dialog } from "@/components/integrations/ui/dialog";
import { RevealOnceSecret } from "@/components/integrations/ui/reveal-once-secret";
import { CreateApiKeyForm } from "@/components/integrations/api-keys/create-api-key-form";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { revokeIntegrationApiKey, rotateIntegrationApiKey } from "@/lib/actions/integrations-api-keys";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { tableWrapperClass } from "@/components/admin/page-hero";

export type ApiKeyRow = {
  id: string;
  keyPrefix: string;
  scopes: string[];
  status: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};


function RowActions({
  organizationId,
  apiKeyId,
  locale,
  onRevealed,
}: {
  organizationId: string;
  apiKeyId: string;
  locale: Locale;
  onRevealed: (result: { plaintextKey: string; keyPrefix: string }) => void;
}) {
  const t = dictionaries[locale].integrations.apiKeys;
  const { confirm, dialog } = useConfirmDialog(locale);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRevoke() {
    setError(null);
    const ok = await confirm({ title: t.revokeConfirmTitle, description: t.revokeConfirmDescription, confirmLabel: t.revoke });
    if (!ok) return;
    startTransition(async () => {
      try {
        await revokeIntegrationApiKey(organizationId, apiKeyId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function handleRotate() {
    setError(null);
    const ok = await confirm({ title: t.rotateConfirmTitle, description: t.rotateConfirmDescription, confirmLabel: t.rotate });
    if (!ok) return;
    startTransition(async () => {
      try {
        const result = await rotateIntegrationApiKey(organizationId, apiKeyId);
        onRevealed(result);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" loading={isPending} onClick={handleRotate}>
          {t.rotate}
        </Button>
        <Button type="button" variant="danger" size="sm" loading={isPending} onClick={handleRevoke}>
          {t.revoke}
        </Button>
      </div>
      {error && <p className="text-xs text-pm-rouge">{error}</p>}
      {dialog}
    </div>
  );
}

export function ApiKeysManager({
  organizationId,
  initialKeys,
  scopes,
  locale = "fr",
}: {
  organizationId: string;
  initialKeys: ApiKeyRow[];
  scopes: readonly string[];
  locale?: Locale;
}) {
  const t = dictionaries[locale].integrations.apiKeys;
  const scopeLabels = t.scopes;
  const [createOpen, setCreateOpen] = useState(false);
  const [revealed, setRevealed] = useState<{ title: string; value: string } | null>(null);
  const router = useRouter();

  function handleCreated(result: { plaintextKey: string; keyPrefix: string }) {
    setCreateOpen(false);
    setRevealed({ title: t.reveal.createdTitle, value: result.plaintextKey });
    router.refresh();
  }

  function handleRotated(result: { plaintextKey: string; keyPrefix: string }) {
    setRevealed({ title: t.reveal.rotatedTitle, value: result.plaintextKey });
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          {t.create}
        </Button>
      </div>

      {initialKeys.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.empty}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.emptyHint}</p>
        </div>
      ) : (
        <div className={`overflow-hidden ${tableWrapperClass}`}>
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">{t.columns.prefix}</th>
                <th className="px-5 py-3">{t.columns.scopes}</th>
                <th className="px-5 py-3">{t.columns.status}</th>
                <th className="px-5 py-3">{t.columns.lastUsed}</th>
                <th className="px-5 py-3">{t.columns.expires}</th>
                <th className="px-5 py-3">{t.columns.created}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {initialKeys.map((key) => (
                <tr key={key.id} className="border-t border-pm-gris-2 align-top">
                  <td className="px-5 py-3 font-mono text-xs text-pm-noir">{key.keyPrefix}</td>
                  <td className="px-5 py-3 text-pm-gris">
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.map((scope) => (
                        <span key={scope} className="rounded-full bg-pm-gris-2/40 px-2 py-0.5 text-[11px] text-pm-noir">
                          {scopeLabels[scope] ?? scope}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge label={t.status[key.status as keyof typeof t.status] ?? key.status} className={API_KEY_STATUS_CLASS[key.status] ?? ""} />
                  </td>
                  <td className="px-5 py-3 text-pm-gris">{key.lastUsedAt ? formatDateTime(key.lastUsedAt, locale) : t.never}</td>
                  <td className="px-5 py-3 text-pm-gris">{key.expiresAt ? formatDate(key.expiresAt, locale) : t.noExpiry}</td>
                  <td className="px-5 py-3 text-pm-gris">{formatDate(key.createdAt, locale)}</td>
                  <td className="px-5 py-3">
                    {key.status === "active" && (
                      <RowActions organizationId={organizationId} apiKeyId={key.id} locale={locale} onRevealed={handleRotated} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t.createForm.title}>
        <CreateApiKeyForm
          organizationId={organizationId}
          scopes={scopes}
          onCreated={handleCreated}
          onCancel={() => setCreateOpen(false)}
          locale={locale}
        />
      </Dialog>

      <RevealOnceSecret
        secret={revealed?.value ?? null}
        title={revealed?.title ?? ""}
        onClose={() => setRevealed(null)}
        copy={{
          warning: t.reveal.warning,
          note: t.reveal.prefixNote,
          copy: t.reveal.copy,
          copiedShort: t.reveal.copiedShort,
          copied: t.reveal.copied,
          done: t.reveal.done,
        }}
      />
    </div>
  );
}
