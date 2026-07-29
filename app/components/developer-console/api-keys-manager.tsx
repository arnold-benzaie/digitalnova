"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/crm/badges";
import { API_KEY_STATUS_CLASS } from "@/components/integrations/badges";
import { Button } from "@/components/gbp-audit/ui/button";
import { Dialog } from "@/components/integrations/ui/dialog";
import { RevealOnceSecret } from "@/components/integrations/ui/reveal-once-secret";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { CreateApiKeyForm } from "@/components/developer-console/create-api-key-form";
import { RenameApiKeyDialog } from "@/components/developer-console/rename-api-key-dialog";
import { revokeDeveloperApiKey, rotateDeveloperApiKey } from "@/lib/developer-console/actions";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export type ApiKeyUsageRow = { limit: number; used: number; remaining: number };

export type DeveloperApiKeyRow = {
  id: string;
  name: string | null;
  keyPrefix: string;
  scopes: string[];
  status: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  usage: { perMinute: ApiKeyUsageRow; perDay: ApiKeyUsageRow };
};

function RowActions({
  apiKeyId,
  currentName,
  locale,
  onRevealed,
  onRenameRequested,
}: {
  apiKeyId: string;
  currentName: string | null;
  locale: Locale;
  onRevealed: (result: { plaintextKey: string; keyPrefix: string }) => void;
  onRenameRequested: (apiKeyId: string, currentName: string | null) => void;
}) {
  const t = dictionaries[locale].developerConsole.dashboard.keysSection;
  const { confirm, dialog } = useConfirmDialog(locale);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleRevoke() {
    setError(null);
    const ok = await confirm({ title: t.revokeConfirmTitle, description: t.revokeConfirmDescription, confirmLabel: t.actions.revoke });
    if (!ok) return;
    startTransition(async () => {
      try {
        await revokeDeveloperApiKey(apiKeyId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  async function handleRotate() {
    setError(null);
    const ok = await confirm({ title: t.rotateConfirmTitle, description: t.rotateConfirmDescription, confirmLabel: t.actions.rotate });
    if (!ok) return;
    startTransition(async () => {
      try {
        const result = await rotateDeveloperApiKey(apiKeyId);
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
        <Button type="button" variant="secondary" size="sm" onClick={() => onRenameRequested(apiKeyId, currentName)}>
          {t.actions.rename}
        </Button>
        <Button type="button" variant="secondary" size="sm" loading={isPending} onClick={handleRotate}>
          {t.actions.rotate}
        </Button>
        <Button type="button" variant="danger" size="sm" loading={isPending} onClick={handleRevoke}>
          {t.actions.revoke}
        </Button>
      </div>
      {error && <p className="text-xs text-pm-rouge">{error}</p>}
      {dialog}
    </div>
  );
}

export function ApiKeysManager({
  initialKeys,
  scopes,
  locale = "fr",
}: {
  initialKeys: DeveloperApiKeyRow[];
  scopes: readonly string[];
  locale?: Locale;
}) {
  const t = dictionaries[locale].developerConsole.dashboard;
  const scopeLabels = t.scopes;
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string | null } | null>(null);
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.keysSection.title}</h2>
        <Button type="button" variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          {t.keysSection.create}
        </Button>
      </div>

      {initialKeys.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.keysSection.empty}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.keysSection.emptyHint}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">{t.keysSection.columns.name}</th>
                <th className="px-5 py-3">{t.keysSection.columns.prefix}</th>
                <th className="px-5 py-3">{t.keysSection.columns.scopes}</th>
                <th className="px-5 py-3">{t.keysSection.columns.status}</th>
                <th className="px-5 py-3">{t.keysSection.columns.usage}</th>
                <th className="px-5 py-3">{t.keysSection.columns.lastUsed}</th>
                <th className="px-5 py-3">{t.keysSection.columns.expires}</th>
                <th className="px-5 py-3">{t.keysSection.columns.created}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {initialKeys.map((key) => (
                <tr key={key.id} className="border-t border-pm-gris-2 align-top">
                  <td className="px-5 py-3 text-pm-noir">{key.name || <span className="text-pm-gris">{t.keysSection.unnamed}</span>}</td>
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
                    <Badge label={t.keysSection.status[key.status] ?? key.status} className={API_KEY_STATUS_CLASS[key.status] ?? ""} />
                  </td>
                  <td className="px-5 py-3 text-xs text-pm-gris">
                    <div className="font-mono" title={t.planCard.perMinute}>
                      {t.usageOf(key.usage.perMinute.used, key.usage.perMinute.limit)} <span className="text-pm-gris/70">{t.planCard.perMinuteShort}</span>
                    </div>
                    <div className="font-mono" title={t.planCard.perDay}>
                      {t.usageOf(key.usage.perDay.used, key.usage.perDay.limit)} <span className="text-pm-gris/70">{t.planCard.perDayShort}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-pm-gris">{key.lastUsedAt ? formatDateTime(key.lastUsedAt, locale) : t.keysSection.never}</td>
                  <td className="px-5 py-3 text-pm-gris">{key.expiresAt ? formatDate(key.expiresAt, locale) : t.keysSection.noExpiry}</td>
                  <td className="px-5 py-3 text-pm-gris">{formatDate(key.createdAt, locale)}</td>
                  <td className="px-5 py-3">
                    {key.status === "active" && (
                      <RowActions
                        apiKeyId={key.id}
                        currentName={key.name}
                        locale={locale}
                        onRevealed={handleRotated}
                        onRenameRequested={(id, name) => setRenameTarget({ id, name })}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title={t.createForm.title}>
        <CreateApiKeyForm scopes={scopes} onCreated={handleCreated} onCancel={() => setCreateOpen(false)} locale={locale} />
      </Dialog>

      <RenameApiKeyDialog
        apiKeyId={renameTarget?.id ?? null}
        currentName={renameTarget?.name ?? null}
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        onRenamed={() => {
          setRenameTarget(null);
          router.refresh();
        }}
        locale={locale}
      />

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
