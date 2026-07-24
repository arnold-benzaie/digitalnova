"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function InlineStatusSelect({
  value,
  options,
  action,
  className,
}: {
  value: string;
  options: { value: string; label: string }[];
  action: (status: string) => Promise<void>;
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <select
      defaultValue={value}
      disabled={isPending}
      onChange={(e) =>
        startTransition(async () => {
          await action(e.target.value);
          router.refresh();
        })
      }
      className={
        className ??
        "rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir disabled:opacity-50"
      }
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
