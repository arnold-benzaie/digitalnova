import Link from "next/link";

/** Link-based column sort (no client JS needed) — toggles asc/desc, preserves other query params via buildHref. */
export function SortableHeader({
  label,
  column,
  activeSort,
  activeDir,
  buildHref,
}: {
  label: string;
  column: string;
  activeSort: string;
  activeDir: "asc" | "desc";
  buildHref: (sort: string, dir: "asc" | "desc") => string;
}) {
  const isActive = activeSort === column;
  const nextDir: "asc" | "desc" = isActive && activeDir === "asc" ? "desc" : "asc";
  return (
    <Link
      href={buildHref(column, nextDir)}
      className="group inline-flex items-center gap-1 hover:text-pm-noir"
      aria-sort={isActive ? (activeDir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      <span className={`text-[10px] transition-opacity ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-40"}`}>
        {isActive && activeDir === "desc" ? "▼" : "▲"}
      </span>
    </Link>
  );
}
