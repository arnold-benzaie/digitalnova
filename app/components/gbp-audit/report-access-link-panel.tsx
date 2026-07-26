"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createOrGetReportAccessLink, revokeReportAccessLink } from "@/lib/actions/gbp-audit-report";
import { Button } from "@/components/gbp-audit/ui/button";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { toast } from "@/components/gbp-audit/ui/toast";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";

export type AccessLink = {
  id: string;
  token: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  failedAttempts: number;
  maxAttempts: number;
};

export function ReportAccessLinkPanel({
  auditId,
  link,
  viewCount,
  origin,
  locale = "fr",
}: {
  auditId: string;
  link: AccessLink | null;
  viewCount: number;
  /** Computed server-side (see app/admin/audit/[id]/rapport/page.tsx) — never window.location, that diverges between SSR and hydration. */
  origin: string;
  locale?: Locale;
}) {
  const t = dictionaries[locale].auditModule.report.accessLink;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const { confirm, dialog } = useConfirmDialog(locale);

  const active = link && !link.revokedAt;
  const url = active ? `${origin}/audit-report/${link!.token}` : null;

  function generate() {
    startTransition(async () => {
      try {
        await createOrGetReportAccessLink(auditId, 30);
        toast.success(t.generated, t.generatedDetail);
        router.refresh();
      } catch (err) {
        toast.error(t.generateError, err instanceof Error ? err.message : undefined);
      }
    });
  }

  async function revoke() {
    const ok = await confirm({
      title: t.revokeConfirmTitle,
      description: t.revokeConfirmDescription,
      confirmLabel: t.revokeConfirmLabel,
    });
    if (!ok) return;
    startTransition(async () => {
      try {
        await revokeReportAccessLink(link!.id, auditId);
        toast.success(t.revoked);
        router.refresh();
      } catch (err) {
        toast.error(t.revokeError, err instanceof Error ? err.message : undefined);
      }
    });
  }

  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
      {dialog}
      <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.title}</h2>

      {!active ? (
        <div className="mt-4">
          <p className="text-sm text-pm-gris">{t.noneActive}</p>
          <Button className="mt-3" loading={isPending} onClick={generate}>
            {t.generate}
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-pm-gris-2 bg-pm-gris-2/20 px-3 py-2">
            <code className="flex-1 truncate text-xs text-pm-noir">{url}</code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(url ?? "");
                setCopied(true);
                toast.success(t.copiedToClipboard);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="shrink-0 rounded-lg border border-pm-gris-2 px-2 py-1 text-xs transition-colors hover:bg-white"
            >
              {copied ? t.copied : t.copy}
            </button>
          </div>
          <p className="text-xs text-pm-gris">
            {link!.expiresAt ? t.expiresOn(formatDate(link!.expiresAt, locale)) : t.expiresOn(t.never)} · {t.viewCount(viewCount)} · {t.attempts(link!.failedAttempts, link!.maxAttempts)}
          </p>
          <Button variant="danger" size="sm" className="w-fit" loading={isPending} onClick={revoke}>
            {t.revoke}
          </Button>
        </div>
      )}
    </div>
  );
}
