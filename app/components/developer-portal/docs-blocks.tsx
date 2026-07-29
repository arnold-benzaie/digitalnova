import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

/** Shared content building blocks for every /developers/docs/** guide —
 * same Section/CodeBlock convention already used by the staff-facing
 * app/admin/integrations/[organizationId]/docs/page.tsx, generalized here
 * so both the internal and public docs read consistently. Uses the same
 * semantic tokens and shadcn Badge as the Developer Console so the whole
 * /developers surface shares one visual language. */

export function DocsPageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-serif text-3xl font-semibold text-foreground">{title}</h1>
      <p className="text-base text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
      <h2 className="font-serif text-lg font-semibold text-foreground">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-foreground">{children}</div>
    </section>
  );
}

export function CodeBlock({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-xl bg-muted p-4 text-xs text-foreground"><code>{children}</code></pre>;
}

export function OrderedSteps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-2">
          <span className="font-semibold text-muted-foreground">{i + 1}.</span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function DocsTable({
  columns,
  rows,
}: {
  columns: readonly string[];
  rows: readonly Record<string, ReactNode>[];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {columns.map((col) => (
              <th key={col} className="px-4 py-2">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border align-top">
              {Object.values(row).map((value, j) => (
                <td key={j} className={`px-4 py-2 ${j === 0 ? "font-mono text-xs text-foreground" : "text-muted-foreground"}`}>
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SoonNotice({ label }: { label: string }) {
  return (
    <Badge variant="outline" className="w-fit rounded-full bg-pm-or/15 text-foreground">
      {label}
    </Badge>
  );
}

export function Callout({ tone = "info", children }: { tone?: "info" | "warning" | "danger"; children: ReactNode }) {
  const toneClass =
    tone === "danger"
      ? "border-destructive/30 bg-destructive/5 text-destructive"
      : tone === "warning"
        ? "border-pm-or/30 bg-pm-or/10 text-foreground"
        : "border-border bg-muted/40 text-foreground";
  return <div className={`flex flex-col gap-3 rounded-xl border p-4 text-sm leading-relaxed ${toneClass}`}>{children}</div>;
}
