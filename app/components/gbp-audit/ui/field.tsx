import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * Shared form primitives for the Audit module — replaces the copy-pasted
 * `inputClass` string that used to live in every form component. One
 * definition of what an input/select/textarea looks like, one place to
 * fix focus rings, error states, or spacing across all 10+ forms.
 */
const baseControl =
  "w-full rounded-lg border bg-white px-3 py-2 text-sm text-pm-noir shadow-sm transition-colors placeholder:text-pm-gris/70 focus:outline-none focus:ring-2 focus:ring-pm-noir/15 disabled:cursor-not-allowed disabled:bg-pm-gris-2/20 disabled:text-pm-gris";
const borderOk = "border-pm-gris-2 focus:border-pm-noir";
const borderError = "border-pm-rouge focus:border-pm-rouge focus:ring-pm-rouge/15";

function controlClass(hasError?: boolean, className?: string) {
  return [baseControl, hasError ? borderError : borderOk, className].filter(Boolean).join(" ");
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-pm-gris">
        {label}
        {required && <span className="ml-0.5 text-pm-rouge">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[11px] text-pm-gris">{hint}</p>}
      {error && (
        <p className="flex items-center gap-1 text-[11px] font-medium text-pm-rouge" role="alert">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 10-2 0v4a1 1 0 102 0V6zm-1 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ hasError, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }) {
  return <input className={controlClass(hasError, className)} {...props} />;
}

export function Textarea({ hasError, className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { hasError?: boolean }) {
  return <textarea className={controlClass(hasError, className)} {...props} />;
}

export function Select({ hasError, className, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { hasError?: boolean }) {
  return <select className={controlClass(hasError, `pr-8 ${className ?? ""}`)} {...props} />;
}
