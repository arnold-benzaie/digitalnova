"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setEmailNotificationsEnabled, updateOrganizationName, updateProfile } from "@/lib/actions/settings";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

function SavedHint({ show, locale }: { show: boolean; locale: Locale }) {
  if (!show) return null;
  return <span className="text-xs text-pm-gris">{dictionaries[locale].settings.saved}</span>;
}

export function ProfileForm({ fullName, email, locale = "fr" }: { fullName: string; email: string; locale?: Locale }) {
  const t = dictionaries[locale].settings;
  const tCommon = dictionaries[locale].common;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="flex flex-col gap-3"
      action={(formData) =>
        startTransition(async () => {
          await updateProfile(formData);
          setSaved(true);
          router.refresh();
        })
      }
    >
      <div>
        <label className="text-xs font-medium text-pm-gris">{t.profile.fullName}</label>
        <input
          name="fullName"
          defaultValue={fullName}
          onChange={() => setSaved(false)}
          className="mt-1 w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-pm-gris">{t.profile.email}</label>
        <input
          name="email"
          type="email"
          defaultValue={email}
          onChange={() => setSaved(false)}
          className="mt-1 w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
        >
          {isPending ? tCommon.saving : tCommon.save}
        </button>
        <SavedHint show={saved && !isPending} locale={locale} />
      </div>
    </form>
  );
}

export function OrganizationForm({ name, locale = "fr" }: { name: string; locale?: Locale }) {
  const t = dictionaries[locale].settings;
  const tCommon = dictionaries[locale].common;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="flex flex-col gap-3"
      action={(formData) =>
        startTransition(async () => {
          await updateOrganizationName(formData);
          setSaved(true);
          router.refresh();
        })
      }
    >
      <div>
        <label className="text-xs font-medium text-pm-gris">{t.organization.name}</label>
        <input
          name="name"
          defaultValue={name}
          onChange={() => setSaved(false)}
          className="mt-1 w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50"
        >
          {isPending ? tCommon.saving : tCommon.save}
        </button>
        <SavedHint show={saved && !isPending} locale={locale} />
      </div>
    </form>
  );
}

export function NotificationToggle({ enabled, locale = "fr" }: { enabled: boolean; locale?: Locale }) {
  const t = dictionaries[locale].settings;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-pm-noir">{t.notifications.emailTitle}</p>
        <p className="text-xs text-pm-gris">{t.notifications.emailBody}</p>
      </div>
      <input
        type="checkbox"
        defaultChecked={enabled}
        disabled={isPending}
        onChange={(e) =>
          startTransition(async () => {
            await setEmailNotificationsEnabled(e.target.checked);
            router.refresh();
          })
        }
        className="h-5 w-5 shrink-0 rounded border-pm-gris-2 accent-pm-noir"
      />
    </label>
  );
}
