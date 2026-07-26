"use client";

import { useRef } from "react";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/gbp-audit/ui/confirm-dialog";
import type { Locale } from "@/lib/i18n/dictionaries";

/** const { confirm, dialog } = useConfirmDialog(locale); ... await confirm({ title, description }) ... {dialog} in JSX. */
export function useConfirmDialog(locale: Locale = "fr") {
  const ref = useRef<ConfirmDialogHandle>(null);
  return {
    confirm: (opts?: Parameters<ConfirmDialogHandle["confirm"]>[0]) => ref.current?.confirm(opts) ?? Promise.resolve(false),
    dialog: <ConfirmDialog ref={ref} locale={locale} />,
  };
}
