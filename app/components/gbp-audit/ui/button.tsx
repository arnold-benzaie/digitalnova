"use client";

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-pm-bleu-eu text-white shadow-pm-sm hover:bg-pm-g-blue-2 hover:shadow-pm-md focus-visible:ring-pm-g-blue/35",
  secondary: "border border-pm-g-blue/20 bg-white text-pm-bleu-eu shadow-pm-sm hover:border-pm-g-blue/35 hover:bg-pm-g-blue/5 focus-visible:ring-pm-g-blue/25",
  danger: "border border-pm-rouge/30 bg-white text-pm-rouge-2 hover:bg-pm-rouge/10 focus-visible:ring-pm-rouge/25",
  ghost: "text-pm-gris hover:bg-pm-g-blue/5 hover:text-pm-bleu-eu focus-visible:ring-pm-g-blue/25",
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  disabled,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-200 active:translate-y-px",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && (
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
