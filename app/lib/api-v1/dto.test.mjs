import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://unit-test-unused/db";

const { isValidUuid, toAuditDTO, toReportDetailDTO, toReportListItemDTO } = await import("@/lib/api-v1/dto");

const BASE_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  score: 82,
  summary: "Solid presence, a few gaps.",
  createdAt: new Date("2026-01-15T10:00:00.000Z"),
  locationId: "22222222-2222-2222-2222-222222222222",
  locationName: "Café Central",
  locationAddress: "12 Rue de la Paix",
};

test("isValidUuid: accepts a real UUID, rejects garbage", () => {
  assert.equal(isValidUuid("11111111-1111-1111-1111-111111111111"), true);
  assert.equal(isValidUuid("not-a-uuid"), false);
  assert.equal(isValidUuid(""), false);
  assert.equal(isValidUuid("11111111-1111-1111-1111-11111111111"), false); // one char short
});

test("toAuditDTO: only the intended fields are present, createdAt is ISO, location is nested", () => {
  const dto = toAuditDTO(BASE_ROW);
  assert.deepEqual(Object.keys(dto).sort(), ["createdAt", "id", "location", "score", "summary"]);
  assert.equal(dto.createdAt, "2026-01-15T10:00:00.000Z");
  assert.deepEqual(dto.location, { id: BASE_ROW.locationId, name: "Café Central", address: "12 Rue de la Paix" });
});

test("toAuditDTO: a null locationId means location: null, not an object with null fields", () => {
  const dto = toAuditDTO({ ...BASE_ROW, locationId: null, locationName: null, locationAddress: null });
  assert.equal(dto.location, null);
});

test("toReportListItemDTO: sums issueCounts into issueCount, defaults to all-zero when no counts row exists", () => {
  const withCounts = toReportListItemDTO(BASE_ROW, { low: 1, medium: 2, high: 1 });
  assert.equal(withCounts.issueCount, 4);
  assert.deepEqual(withCounts.issueCounts, { low: 1, medium: 2, high: 1 });

  const withoutCounts = toReportListItemDTO(BASE_ROW, undefined);
  assert.equal(withoutCounts.issueCount, 0);
  assert.deepEqual(withoutCounts.issueCounts, { low: 0, medium: 0, high: 0 });
});

test("toReportDetailDTO: embeds the full issue list and derives issueCounts from it (not a separate source)", () => {
  const issues = [
    { id: "i1", title: "Missing hours", description: null, priority: "high", recommendation: "Add hours" },
    { id: "i2", title: "Few photos", description: "Only 2 photos", priority: "medium", recommendation: null },
    { id: "i3", title: "Old cover photo", description: null, priority: "medium", recommendation: null },
  ];
  const dto = toReportDetailDTO(BASE_ROW, issues);
  assert.equal(dto.issues.length, 3);
  assert.deepEqual(dto.issueCounts, { low: 0, medium: 2, high: 1 });
  assert.deepEqual(dto.issues[0], issues[0]);
});
