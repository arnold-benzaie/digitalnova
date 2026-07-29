"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { THEME_COOKIE, type Theme } from "@/lib/developer-portal/theme-shared";
import { cn } from "@/lib/utils";

/**
 * Toggle for the Developer Platform's cookie-driven dark mode (Stage 0 —
 * see lib/developer-portal/theme.ts). Writes the cookie directly
 * (non-sensitive preference, no server action needed) then
 * router.refresh() so every Server Component under app/developers/**
 * re-renders with the new theme immediately — the .dark class itself is
 * always applied server-side (see app/developers/layout.tsx), this only
 * ever changes the cookie that decides it, never toggles the class
 * directly, so there's never a client/server mismatch to reconcile.
 */
export function ThemeToggle({ theme, className }: { theme: Theme; className?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={isPending}
      aria-label={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      aria-pressed={theme === "dark"}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition hover:bg-accent hover:text-accent-foreground disabled:opacity-50",
        className,
      )}
    >
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
