// Pure-function tests for the audit scoring engine — run with:
//   npx tsx --test lib/gbp-audit/checklist.test.mjs
// No mocking needed: computeAuditScore/scoreBand take plain data in, return
// plain data out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeAuditScore, scoreBand, GBP_AUDIT_SECTIONS, GBP_AUDIT_CHECKS } from "./checklist.ts";

test("computeAuditScore: no findings = perfect score", () => {
  assert.equal(computeAuditScore([]), 100);
});

test("computeAuditScore: compliant/not_applicable/not_verifiable never penalize", () => {
  const findings = [
    { result: "compliant", severity: null },
    { result: "not_applicable", severity: "critical" }, // severity present but result exempts it
    { result: "not_verifiable", severity: "critical" },
  ];
  assert.equal(computeAuditScore(findings), 100);
});

test("computeAuditScore: critical weighs more than opportunity", () => {
  const withCritical = computeAuditScore([{ result: "critical_issue", severity: "critical" }]);
  const withOpportunity = computeAuditScore([{ result: "improvement_recommended", severity: "opportunity" }]);
  assert.ok(withCritical < withOpportunity, `critical (${withCritical}) should score lower than opportunity (${withOpportunity})`);
});

test("computeAuditScore: never goes below 0", () => {
  const manyCritical = Array.from({ length: 20 }, () => ({ result: "critical_issue", severity: "critical" }));
  assert.equal(computeAuditScore(manyCritical), 0);
});

test("computeAuditScore: missing severity falls back to moderate weight", () => {
  const explicit = computeAuditScore([{ result: "major_issue", severity: "moderate" }]);
  const fallback = computeAuditScore([{ result: "major_issue", severity: null }]);
  assert.equal(explicit, fallback);
});

test("scoreBand: boundaries match spec §9 exactly", () => {
  assert.equal(scoreBand(100).label, "Excellent");
  assert.equal(scoreBand(90).label, "Excellent");
  assert.equal(scoreBand(89).label, "Satisfaisant");
  assert.equal(scoreBand(75).label, "Satisfaisant");
  assert.equal(scoreBand(74).label, "Faiblesses importantes");
  assert.equal(scoreBand(50).label, "Faiblesses importantes");
  assert.equal(scoreBand(49).label, "Fortement incomplet");
  assert.equal(scoreBand(25).label, "Fortement incomplet");
  assert.equal(scoreBand(24).label, "Critique");
  assert.equal(scoreBand(0).label, "Critique");
});

test("catalog integrity: every GBP_AUDIT_SECTIONS entry has at least one check", () => {
  for (const section of GBP_AUDIT_SECTIONS) {
    const checks = GBP_AUDIT_CHECKS[section.code];
    assert.ok(Array.isArray(checks) && checks.length > 0, `section ${section.code} (${section.letter}) has no checks defined`);
  }
});

test("catalog integrity: all check keys are globally unique", () => {
  const allKeys = Object.values(GBP_AUDIT_CHECKS).flat().map((c) => c.key);
  const uniqueKeys = new Set(allKeys);
  assert.equal(allKeys.length, uniqueKeys.size, "duplicate check key(s) found across sections");
});

test("catalog integrity: 19 sections match spec §8 (A–S)", () => {
  assert.equal(GBP_AUDIT_SECTIONS.length, 19);
  assert.equal(GBP_AUDIT_SECTIONS[0].letter, "A");
  assert.equal(GBP_AUDIT_SECTIONS[18].letter, "S");
});
