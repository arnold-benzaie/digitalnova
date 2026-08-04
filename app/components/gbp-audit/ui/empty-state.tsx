import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-pm-g-blue/25 bg-pm-g-blue/[0.025] px-8 py-14 text-center shadow-pm-sm">
      {icon && <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pm-g-blue/10 text-pm-bleu-eu">{icon}</div>}
      <p className="font-serif text-lg font-semibold text-pm-noir">{title}</p>
      {description && <p className="max-w-sm text-sm text-pm-gris">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
