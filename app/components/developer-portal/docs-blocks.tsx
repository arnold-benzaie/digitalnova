import type { ReactNode } from "react";

/** Shared content building blocks for every /developers/docs/** guide —
 * same Section/CodeBlock convention already used by the staff-facing
 * app/admin/integrations/[organizationId]/docs/page.tsx, generalized here
 * so both the internal and public docs read consistently. */

export function DocsPageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{title}</h1>
      <p className="text-base text-pm-gris">{subtitle}</p>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-pm-gris-2 bg-white p-6">
      <h2 className="font-serif text-lg font-semibold text-pm-noir">{title}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-pm-noir">{children}</div>
    </section>
  );
}

export function CodeBlock({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-xl bg-pm-noir p-4 text-xs text-pm-blanc"><code>{children}</code></pre>;
}

export function OrderedSteps({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-2">
          <span className="font-semibold text-pm-gris">{i + 1}.</span>
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
    <div className="overflow-x-auto rounded-xl border border-pm-gris-2">
      <table className="w-full text-left text-sm">
        <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
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
            <tr key={i} className="border-t border-pm-gris-2 align-top">
              {Object.values(row).map((value, j) => (
                <td key={j} className={`px-4 py-2 ${j === 0 ? "font-mono text-xs text-pm-noir" : "text-pm-gris"}`}>
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
    <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-pm-or/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-pm-or-2">
      {label}
    </span>
  );
}
