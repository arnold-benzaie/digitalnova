import type { CurrentSession } from "@/lib/session";

// Per-user greeting name — never a hardcoded name, always derived from the
// real signed-in session (CLIENT or WORKFORCE alike — both variants of
// CurrentSession carry the same firstName/fullName/organizationName/email
// fields). Priority: personal first name > full name > organization name
// (CLIENT only — see below) > local part of the email (never the full
// address) > null (generic "Bonjour/Hello 👋" fallback). Trimmed and
// length-capped so a malformed Clerk profile field can't blow up a hero
// layout.
//
// WORKFORCE ACCESS CONTROL UI — organizationName is excluded from a
// WORKFORCE session's candidates entirely: it is always the shared
// internal workspace name ("PUBLIC-MAP"), never a personal identifier, so
// ranking it above the email would greet a staff member with no
// first/full name as "Bonjour PUBLIC-MAP" instead of falling through to
// their own email's local part. For a CLIENT session organizationName is
// a real per-tenant business name and stays a reasonable fallback above
// the email.
// String.slice() cuts by UTF-16 code unit, which can split a surrogate
// pair (e.g. an emoji in a display name) or a combined grapheme in half,
// producing a broken character — Intl.Segmenter truncates by whole
// grapheme instead. value.length is always >= the grapheme count, so
// checking it first is a safe, cheap way to skip segmentation entirely
// for the (overwhelmingly common) short-name case.
function truncateName(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const graphemes = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), (s) => s.segment);
  return graphemes.length <= maxLength ? value : `${graphemes.slice(0, maxLength).join("")}…`;
}

export function resolveGreetingName(session: CurrentSession): string | null {
  const candidates = [
    session.firstName,
    session.fullName,
    session.context === "CLIENT" ? session.organizationName : null,
    session.email.split("@")[0],
  ];
  for (const candidate of candidates) {
    const cleaned = candidate?.trim();
    if (cleaned && cleaned.toLowerCase() !== "null" && cleaned.toLowerCase() !== "undefined") {
      return truncateName(cleaned, 40);
    }
  }
  return null;
}
