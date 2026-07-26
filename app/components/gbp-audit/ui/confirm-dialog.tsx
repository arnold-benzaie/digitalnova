"use client";

import { useImperativeHandle, useRef, useState, forwardRef, useTransition } from "react";
import { Button } from "@/components/gbp-audit/ui/button";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export type ConfirmDialogHandle = {
  /** Opens the dialog and resolves true/false once the user decides. */
  confirm: (opts?: { title?: string; description?: string; confirmLabel?: string }) => Promise<boolean>;
};

/**
 * Single reusable confirmation modal — mount ONE instance per page (see
 * useConfirmDialog below) instead of hand-rolling a window.confirm() or a
 * bespoke dialog per delete button. Native <dialog> (same pattern as
 * components/admin/invite-user-form.tsx) gives focus trapping, ESC-to-close
 * and a real backdrop for free.
 */
export const ConfirmDialog = forwardRef<ConfirmDialogHandle, { locale?: Locale }>(function ConfirmDialog({ locale = "fr" }, ref) {
  const t = dictionaries[locale].auditModule.ui.confirmDialog;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copy, setCopy] = useState<{ title: string; description: string; confirmLabel: string }>({
    title: t.defaultTitle,
    description: "",
    confirmLabel: t.defaultTitle,
  });
  const resolver = useRef<((value: boolean) => void) | null>(null);
  const [isPending, startTransition] = useTransition();

  useImperativeHandle(ref, () => ({
    confirm: (opts) =>
      new Promise<boolean>((resolve) => {
        setCopy({
          title: opts?.title ?? t.defaultTitle,
          description: opts?.description ?? t.defaultDescription,
          confirmLabel: opts?.confirmLabel ?? t.defaultTitle,
        });
        resolver.current = resolve;
        dialogRef.current?.showModal();
      }),
  }));

  function settle(value: boolean) {
    dialogRef.current?.close();
    resolver.current?.(value);
    resolver.current = null;
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={() => settle(false)}
      className="m-auto w-full max-w-sm rounded-2xl border border-pm-gris-2 bg-white p-6 backdrop:bg-pm-noir/40 backdrop:backdrop-blur-[2px]"
      aria-labelledby="confirm-dialog-title"
    >
      <h2 id="confirm-dialog-title" className="font-serif text-lg font-semibold text-pm-noir">
        {copy.title}
      </h2>
      <p className="mt-2 text-sm text-pm-gris">{copy.description}</p>
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="secondary" size="sm" onClick={() => settle(false)}>
          {t.cancel}
        </Button>
        <Button
          variant="danger"
          size="sm"
          loading={isPending}
          onClick={() => startTransition(() => settle(true))}
        >
          {copy.confirmLabel}
        </Button>
      </div>
    </dialog>
  );
});
