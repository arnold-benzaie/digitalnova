"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Dialog } from "@/components/integrations/ui/dialog";
import { Button } from "@/components/gbp-audit/ui/button";
import { Field, Input } from "@/components/gbp-audit/ui/field";
import { renameDeveloperApiKey } from "@/lib/developer-console/actions";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

export function RenameApiKeyDialog({
  apiKeyId,
  currentName,
  open,
  onClose,
  onRenamed,
  locale = "fr",
}: {
  apiKeyId: string | null;
  currentName: string | null;
  open: boolean;
  onClose: () => void;
  onRenamed: () => void;
  locale?: Locale;
}) {
  const t = dictionaries[locale].developerConsole.dashboard.renameForm;
  const [name, setName] = useState(currentName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKeyId) return;
    setError(null);
    const formData = new FormData();
    if (name.trim()) formData.set("name", name.trim());

    startTransition(async () => {
      try {
        await renameDeveloperApiKey(apiKeyId, formData);
        onRenamed();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={t.title}>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
        // Re-seed the input with the current name each time a different
        // key is opened for rename — a plain useState initializer only
        // runs once per mount, and this dialog stays mounted across opens.
        key={apiKeyId ?? "none"}
      >
        <Field label={t.nameLabel} htmlFor="dev-console-rename-key-name">
          <Input id="dev-console-rename-key-name" type="text" maxLength={100} defaultValue={currentName ?? ""} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        {error && (
          <p className="text-sm text-pm-rouge" role="alert">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={isPending}>
            {t.submit}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
