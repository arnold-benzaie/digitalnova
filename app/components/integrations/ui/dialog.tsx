"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Generic modal primitive — native <dialog> (focus trap, ESC-to-close,
 * backdrop for free, same foundation as components/gbp-audit/ui/confirm-
 * dialog.tsx), but with a content slot instead of a fixed confirm/cancel
 * shape. First shared Dialog in the codebase: every prior "create X" flow
 * (InviteUserForm, ApproveUserModal, InviteStaffForm) hand-rolled its own
 * useRef<HTMLDialogElement> + showModal()/close() — this is the 4th+
 * consumer, worth factoring out once instead of copy-pasting again.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-full max-w-md rounded-2xl border border-pm-gris-2 bg-white p-0 shadow-xl backdrop:bg-pm-noir/40"
      aria-labelledby="integrations-dialog-title"
    >
      <div className="p-6">
        <h2 id="integrations-dialog-title" className="font-serif text-lg font-semibold text-pm-noir">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}
