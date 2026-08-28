/**
 * AI Commercial Radar / Phase 1C — pure, deterministic prospect
 * qualification. No I/O, no database, no AI — a plain function over
 * already-fetched facts (see lib/actions/radar.ts for the caller that
 * supplies them).
 *
 * QUALIFICATION (this file) and OPPORTUNITY (lib/radar/score.ts) are
 * deliberately separate: qualification asks "is this a commercially
 * usable record at all," opportunity asks "how promising is it" — and
 * the opportunity function must only ever be called once a prospect is
 * QUALIFIED (see lib/actions/radar.ts).
 *
 * ELIGIBILITY vs QUALIFICATION: eligibility (doNotContact, archivedAt) is
 * a hard gate evaluated first and can never be overridden by anything —
 * not by how complete the profile is, not by any future opportunity
 * signal. A record failing eligibility is NOT_ELIGIBLE regardless of
 * every other fact about it.
 */

export type QualificationStatus = "QUALIFIED" | "INSUFFICIENT_DATA" | "NOT_ELIGIBLE";

export type EligibilityReason = "do_not_contact" | "archived";

export type Eligibility = { contactable: boolean; reason?: EligibilityReason };

export type QualificationInput = {
  name: string | null | undefined;
  email: string | null | undefined;
  phone: string | null | undefined;
  doNotContact: boolean;
  archivedAt: Date | null | undefined;
};

export type QualificationResult = {
  qualificationStatus: QualificationStatus;
  eligibility: Eligibility;
};

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * "Meaningful name" = the client/prospect's own name field is present and
 * non-blank. Never derived from anything else — no inference, no
 * fallback to a different field.
 */
function hasMeaningfulName(name: string | null | undefined): boolean {
  return isNonEmptyString(name);
}

/** At least one of email or phone — never both required. */
function hasUsableContactMethod(email: string | null | undefined, phone: string | null | undefined): boolean {
  return isNonEmptyString(email) || isNonEmptyString(phone);
}

export function assessQualification(input: QualificationInput): QualificationResult {
  // Hard eligibility gates — evaluated first, unconditionally, before any
  // other fact is even considered. Neither rule can be overridden by
  // profile completeness or (later) opportunity priority.
  if (input.doNotContact === true) {
    return { qualificationStatus: "NOT_ELIGIBLE", eligibility: { contactable: false, reason: "do_not_contact" } };
  }
  if (input.archivedAt != null) {
    return { qualificationStatus: "NOT_ELIGIBLE", eligibility: { contactable: false, reason: "archived" } };
  }

  // Minimum usable prospect information. Missing history (no deals, no
  // interactions, etc.) is never treated as a qualification failure here —
  // only the presence of a name and a usable contact method matters.
  if (!hasMeaningfulName(input.name) || !hasUsableContactMethod(input.email, input.phone)) {
    return { qualificationStatus: "INSUFFICIENT_DATA", eligibility: { contactable: true } };
  }

  return { qualificationStatus: "QUALIFIED", eligibility: { contactable: true } };
}
