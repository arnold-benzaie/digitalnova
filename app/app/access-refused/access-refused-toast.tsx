"use client";

import { useEffect, useRef } from "react";
import { Toaster, toast } from "sonner";
import { getNotificationPreferences, playNotificationSound } from "@/lib/notification-preferences";

/**
 * The one-time delivery mechanism for a refused user's own "user.refused_
 * self" notification (see lib/actions/users.ts's refuseUser() and
 * lib/i18n/notification-templates.ts) — this route is intentionally
 * outside AppShell (see app/access-refused/page.tsx's own header comment
 * on why this page never calls requireSession()), so the bell/badge that
 * every other notification type relies on can never mount here. No
 * polling either: unlike /access-pending, there's nothing to wait for —
 * the refusal already happened before this page ever rendered, so a
 * single mount-time toast is the complete, correct behavior. Its own
 * minimal `<Toaster>` since components/notification-toaster.tsx is only
 * ever mounted inside AppShellClient, never here.
 */
export function AccessRefusedToast({ title, body, soundPath }: { title: string; body: string | null; soundPath: string | null }) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    toast(title, { description: body ?? undefined });
    if (soundPath && getNotificationPreferences().soundEnabled) playNotificationSound(soundPath);
  }, [title, body, soundPath]);

  return (
    <Toaster
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border !border-[var(--surface-border)] !bg-[var(--surface-card)] !text-[var(--surface-ink)] !shadow-lg",
          title: "!text-sm !font-medium",
          description: "!text-xs !text-[var(--surface-muted)]",
        },
      }}
    />
  );
}
