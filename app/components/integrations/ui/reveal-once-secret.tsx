"use client";

import { useState } from "react";
import { Dialog } from "@/components/integrations/ui/dialog";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";

export type RevealOnceCopy = {
  warning: string;
  note: string;
  copy: string;
  copiedShort: string;
  copied: string;
  done: string;
};

/**
 * Shown exactly once, right after a secret is generated (API key
 * plaintext, webhook secret). `secret === null` closes the dialog; the
 * caller must drop the plaintext from its own state on close so it can
 * never be reopened — nothing here persists it beyond this render. Copy
 * text is passed in (not looked up from a fixed dictionary path) so this
 * one component serves every reveal-once flow (API keys, webhook
 * secrets, future ones) with its own wording.
 */
export function RevealOnceSecret({
  secret,
  title,
  copy: t,
  onClose,
}: {
  secret: string | null;
  title: string;
  copy: RevealOnceCopy;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    toast.success(t.copied);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog open={secret !== null} onClose={onClose} title={title}>
      <p className="text-sm font-medium text-pm-rouge-2">{t.warning}</p>
      <p className="mt-1 text-xs text-pm-gris">{t.note}</p>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-pm-gris-2 bg-pm-gris-2/20 px-3 py-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-pm-noir">{secret}</code>
        <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
          {copied ? t.copiedShort : t.copy}
        </Button>
      </div>
      <div className="mt-5 flex justify-end">
        <Button type="button" variant="primary" size="sm" onClick={onClose}>
          {t.done}
        </Button>
      </div>
    </Dialog>
  );
}
