"use client";

import { useRef } from "react";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/gbp-audit/ui/confirm-dialog";

/** const { confirm, dialog } = useConfirmDialog(); ... await confirm({ title, description }) ... {dialog} in JSX. */
export function useConfirmDialog() {
  const ref = useRef<ConfirmDialogHandle>(null);
  return {
    confirm: (opts?: Parameters<ConfirmDialogHandle["confirm"]>[0]) => ref.current?.confirm(opts) ?? Promise.resolve(false),
    dialog: <ConfirmDialog ref={ref} />,
  };
}
