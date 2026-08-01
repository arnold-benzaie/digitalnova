"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The one thing an invitation email itself can't do — Gmail and most
 * email clients block JavaScript entirely, so navigator.clipboard can
 * never run inside the email (see lib/email/invitation.ts's docstring).
 * This page is the fallback destination: a real button, on a real page,
 * that can actually copy the (non-sensitive, static) sign-up URL.
 */
export function CopyLinkClient({
  url,
  copyLabel,
  copiedLabel,
  openLabel,
}: {
  url: string;
  copyLabel: string;
  copiedLabel: string;
  openLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (resetTimer.current) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable/denied — the visible, selectable URL
      // text above remains a working fallback (select + copy manually).
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <button
        type="button"
        onClick={handleCopy}
        aria-live="polite"
        className="rounded-lg bg-pm-noir px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-pm-noir-2"
      >
        {copied ? copiedLabel : copyLabel}
      </button>
      <a
        href={url}
        className="rounded-lg border border-pm-gris-2 px-5 py-2.5 text-sm font-semibold text-pm-noir transition hover:border-pm-noir"
      >
        {openLabel}
      </a>
    </div>
  );
}
