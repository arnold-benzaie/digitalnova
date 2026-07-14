"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setEmailNotificationsEnabled, updateOrganizationName, updateProfile } from "@/lib/actions/settings";

function SavedHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="text-xs text-pm-gris">Enregistré ✓</span>;
}

export function ProfileForm({ fullName, email }: { fullName: string; email: string }) {
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
        <label className="text-xs font-medium text-pm-gris">Nom complet</label>
        <input
          name="fullName"
          defaultValue={fullName}
          onChange={() => setSaved(false)}
          className="mt-1 w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-pm-gris">Email</label>
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
          {isPending ? "Enregistrement..." : "Enregistrer"}
        </button>
        <SavedHint show={saved && !isPending} />
      </div>
    </form>
  );
}

export function OrganizationForm({ name }: { name: string }) {
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
        <label className="text-xs font-medium text-pm-gris">Nom de l&apos;organisation</label>
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
          {isPending ? "Enregistrement..." : "Enregistrer"}
        </button>
        <SavedHint show={saved && !isPending} />
      </div>
    </form>
  );
}

export function NotificationToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-pm-noir">Notifications par email</p>
        <p className="text-xs text-pm-gris">
          Recevoir un email pour les audits, messages et documents (nécessite un fournisseur email — voir README).
        </p>
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
