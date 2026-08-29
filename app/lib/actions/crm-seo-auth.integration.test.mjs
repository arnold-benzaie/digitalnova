// PHASE 2B.0 — authorization hotfix for lib/actions/crm-seo.ts.
// runSeoAudit / updateSeoIssueStatus / addSeoKeyword / deleteSeoKeyword /
// refreshKeywordRankings / getAuditHistory now each call requireStaffRole()
// first (getAuditHistory is a read that exposes internal seo_audits rows).
// Real requireStaffRole() runs against a faked requireSession(). The SEO
// provider (@/lib/seo) and @/lib/webhooks are stubbed so a rejected call
// can be proven to reach neither and no external network call is made.
// Local disposable Docker Postgres only.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/crm-seo-auth.integration.test.mjs
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("REFUS : base non locale.");
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const STAFF_SESSION = {
  userId: "test-staff-user", clerkUserId: "test_clerk_staff", email: "staff@example.com",
  fullName: "Test Staff", firstName: "Test", organizationId: "test-org", organizationName: "Test Org",
  role: "staff", previousLastLoginAt: null,
};
const CLIENT_SESSION = { ...STAFF_SESSION, userId: "test-client-user", email: "client-role@example.com", role: "client" };
let mockState = { session: STAFF_SESSION };
const actAsStaff = () => { mockState = { session: STAFF_SESSION }; };
const actAsClient = () => { mockState = { session: CLIENT_SESSION }; };
mock.module("@/lib/session", { namedExports: { requireSession: async () => mockState.session, getCurrentSession: async () => null } });

let webhookCalls = [];
let providerCalls = [];
mock.module("@/lib/webhooks", { namedExports: { dispatchWebhookEvent: async (...a) => { webhookCalls.push(a); } } });
mock.module("@/lib/seo", {
  namedExports: {
    getSeoProvider: () => ({
      runTechnicalAudit: async (url) => {
        providerCalls.push(["runTechnicalAudit", url]);
        return { score: 80, summary: "stub", pageTitle: "t", metaDescription: "m", h1Count: 1, indexable: true, sitemapFound: true, robotsTxtFound: true, issues: [] };
      },
      checkKeywordRankings: async (url, kws) => {
        providerCalls.push(["checkKeywordRankings", url, kws]);
        return kws.map((keyword) => ({ keyword, searchEngine: "google", position: 5 }));
      },
    }),
  },
});

const { db } = await import("@/db");
const { crmClients, crmWebsites, seoAudits, seoAuditIssues, seoKeywords } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { runSeoAudit, updateSeoIssueStatus, addSeoKeyword, deleteSeoKeyword, refreshKeywordRankings, getAuditHistory } =
  await import("./crm-seo.ts");

const createdClientIds = new Set();
const createdWebsiteIds = new Set();
beforeEach(() => { actAsStaff(); webhookCalls = []; providerCalls = []; });
after(async () => {
  // crmWebsites cascades to seo_audits / seo_audit_issues / seo_keywords / seo_keyword_rankings.
  if (createdWebsiteIds.size) await db.delete(crmWebsites).where(inArray(crmWebsites.id, [...createdWebsiteIds]));
  if (createdClientIds.size) await db.delete(crmClients).where(inArray(crmClients.id, [...createdClientIds]));
  await db.$client.end();
});

async function makeWebsite() {
  const [c] = await db.insert(crmClients).values({ name: `2B0-seo ${randomUUID()}` }).returning();
  createdClientIds.add(c.id);
  const [w] = await db.insert(crmWebsites).values({ clientId: c.id, url: "https://seo-2b0.test/" }).returning();
  createdWebsiteIds.add(w.id);
  return w;
}
const auditsFor = async (websiteId) => db.select().from(seoAudits).where(eq(seoAudits.websiteId, websiteId));
const keywordsFor = async (websiteId) => db.select().from(seoKeywords).where(eq(seoKeywords.websiteId, websiteId));

test("runSeoAudit — client rejected, no audit row / provider / webhook", async () => {
  const w = await makeWebsite();
  actAsClient();
  try { await assert.rejects(() => runSeoAudit(w.id)); } finally { actAsStaff(); }
  assert.equal((await auditsFor(w.id)).length, 0);
  assert.equal(providerCalls.length, 0);
  assert.equal(webhookCalls.length, 0);
});
test("runSeoAudit — staff still works", async () => {
  const w = await makeWebsite();
  const completed = await runSeoAudit(w.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.score, 80);
  assert.ok(providerCalls.some(([m]) => m === "runTechnicalAudit"));
});
test("updateSeoIssueStatus — client rejected, issue status unchanged", async () => {
  const w = await makeWebsite();
  const [audit] = await db.insert(seoAudits).values({ websiteId: w.id, status: "completed" }).returning();
  const [issue] = await db.insert(seoAuditIssues).values({ auditId: audit.id, category: "seo", title: "x", description: "d", priority: "high", recommendation: "r" }).returning();
  actAsClient();
  try { await assert.rejects(() => updateSeoIssueStatus(issue.id, "resolved")); } finally { actAsStaff(); }
  const [after_] = await db.select().from(seoAuditIssues).where(eq(seoAuditIssues.id, issue.id)).limit(1);
  assert.equal(after_.status, "open");
});
test("updateSeoIssueStatus — staff still works", async () => {
  const w = await makeWebsite();
  const [audit] = await db.insert(seoAudits).values({ websiteId: w.id, status: "completed" }).returning();
  const [issue] = await db.insert(seoAuditIssues).values({ auditId: audit.id, category: "seo", title: "x", description: "d", priority: "high", recommendation: "r" }).returning();
  await updateSeoIssueStatus(issue.id, "resolved");
  const [after_] = await db.select().from(seoAuditIssues).where(eq(seoAuditIssues.id, issue.id)).limit(1);
  assert.equal(after_.status, "resolved");
});
test("addSeoKeyword — client rejected, no keyword row", async () => {
  const w = await makeWebsite();
  const fd = new FormData(); fd.set("websiteId", w.id); fd.set("keyword", "mot-2b0");
  actAsClient();
  try { await assert.rejects(() => addSeoKeyword(fd)); } finally { actAsStaff(); }
  assert.equal((await keywordsFor(w.id)).length, 0);
});
test("addSeoKeyword — staff still works", async () => {
  const w = await makeWebsite();
  const fd = new FormData(); fd.set("websiteId", w.id); fd.set("keyword", "mot-ok-2b0");
  const row = await addSeoKeyword(fd);
  assert.equal(row.keyword, "mot-ok-2b0");
});
test("deleteSeoKeyword — client rejected, keyword still exists", async () => {
  const w = await makeWebsite();
  const [kw] = await db.insert(seoKeywords).values({ websiteId: w.id, keyword: "garde-2b0" }).returning();
  actAsClient();
  try { await assert.rejects(() => deleteSeoKeyword(kw.id)); } finally { actAsStaff(); }
  assert.equal((await keywordsFor(w.id)).length, 1);
});
test("deleteSeoKeyword — staff still works", async () => {
  const w = await makeWebsite();
  const [kw] = await db.insert(seoKeywords).values({ websiteId: w.id, keyword: "supprime-2b0" }).returning();
  await deleteSeoKeyword(kw.id);
  assert.equal((await keywordsFor(w.id)).length, 0);
});
test("refreshKeywordRankings — client rejected, no provider call", async () => {
  const w = await makeWebsite();
  await db.insert(seoKeywords).values({ websiteId: w.id, keyword: "rank-2b0" });
  actAsClient();
  try { await assert.rejects(() => refreshKeywordRankings(w.id)); } finally { actAsStaff(); }
  assert.equal(providerCalls.length, 0);
});
test("refreshKeywordRankings — staff still works", async () => {
  const w = await makeWebsite();
  await db.insert(seoKeywords).values({ websiteId: w.id, keyword: "rank-ok-2b0" });
  await refreshKeywordRankings(w.id);
  assert.ok(providerCalls.some(([m]) => m === "checkKeywordRankings"));
});
test("getAuditHistory — client rejected (internal seo_audits data not exposed)", async () => {
  const w = await makeWebsite();
  await db.insert(seoAudits).values({ websiteId: w.id, status: "completed" });
  actAsClient();
  try { await assert.rejects(() => getAuditHistory(w.id)); } finally { actAsStaff(); }
});
test("getAuditHistory — staff still works", async () => {
  const w = await makeWebsite();
  await db.insert(seoAudits).values({ websiteId: w.id, status: "completed" });
  const rows = await getAuditHistory(w.id);
  assert.equal(rows.length, 1);
});
