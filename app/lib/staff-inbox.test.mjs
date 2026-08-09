// Pure-function tests for the staff Inbox classification rules — run with:
//   npx tsx --test lib/staff-inbox.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSyncHealthSummary,
  buildClientsAtRiskItems,
  buildMoneyFollowUpItems,
  buildSyncErrorItems,
  groupClientsNeedingAttention,
  CLIENT_AT_RISK_DAYS,
} from "./staff-inbox.ts";

const NOW = new Date("2026-08-08T12:00:00Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

test("computeSyncHealthSummary: matches the example counts shape (error beats needs-sync beats ok)", () => {
  const rows = [
    { organizationId: "a", connected: true, products: [{ scopeGranted: true, state: "synced" }] },
    { organizationId: "b", connected: true, products: [{ scopeGranted: true, state: "ready_to_sync" }] },
    { organizationId: "c", connected: true, products: [{ scopeGranted: true, state: "error" }] },
    // partial failure: one product synced, another errored — must still count as "in error", not hidden.
    { organizationId: "d", connected: true, products: [{ scopeGranted: true, state: "synced" }, { scopeGranted: true, state: "error" }] },
    { organizationId: "e", connected: false, products: [] },
  ];
  const summary = computeSyncHealthSummary(rows);
  assert.deepEqual(summary, { totalConnected: 4, syncedOk: 1, needsSync: 1, inError: 2 });
});

test("computeSyncHealthSummary: org with no scope granted on any product doesn't count toward any bucket", () => {
  const rows = [{ organizationId: "a", connected: true, products: [{ scopeGranted: false, state: "ready_to_sync" }] }];
  const summary = computeSyncHealthSummary(rows);
  assert.equal(summary.syncedOk + summary.needsSync + summary.inError, 0);
});

test("buildClientsAtRiskItems: never-contacted deal is at risk", () => {
  const items = buildClientsAtRiskItems(
    [{ dealId: "d1", clientId: "c1", clientName: "Entreprise ABC", dealTitle: "Proposition", stage: "proposal", lastInteractionAt: null }],
    NOW,
  );
  assert.equal(items.length, 1);
});

test(`buildClientsAtRiskItems: interaction exactly at the ${CLIENT_AT_RISK_DAYS}-day boundary is NOT yet at risk`, () => {
  const items = buildClientsAtRiskItems(
    [{ dealId: "d1", clientId: "c1", clientName: "X", dealTitle: "Y", stage: "new", lastInteractionAt: daysAgo(CLIENT_AT_RISK_DAYS - 1) }],
    NOW,
  );
  assert.equal(items.length, 0);
});

test("buildClientsAtRiskItems: won/lost deals are never flagged regardless of last contact", () => {
  const items = buildClientsAtRiskItems(
    [
      { dealId: "d1", clientId: "c1", clientName: "X", dealTitle: "Y", stage: "won", lastInteractionAt: null },
      { dealId: "d2", clientId: "c2", clientName: "Z", dealTitle: "W", stage: "lost", lastInteractionAt: daysAgo(30) },
    ],
    NOW,
  );
  assert.equal(items.length, 0);
});

test("buildMoneyFollowUpItems: delivery_failed invoice is urgent", () => {
  const items = buildMoneyFollowUpItems(
    [{ id: "i1", clientId: "c1", clientName: "X", invoiceNumber: "FAC-1", status: "delivery_failed", dueAt: null }],
    [],
    NOW,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].level, "urgent");
});

test("buildMoneyFollowUpItems: sent invoice not yet due is not flagged", () => {
  const items = buildMoneyFollowUpItems(
    [{ id: "i1", clientId: "c1", clientName: "X", invoiceNumber: "FAC-1", status: "sent", dueAt: daysAgo(-5) }],
    [],
    NOW,
  );
  assert.equal(items.length, 0);
});

test("buildMoneyFollowUpItems: overdue sent invoice is to_handle", () => {
  const items = buildMoneyFollowUpItems(
    [{ id: "i1", clientId: "c1", clientName: "X", invoiceNumber: "FAC-1", status: "sent", dueAt: daysAgo(2) }],
    [],
    NOW,
  );
  assert.equal(items[0].level, "to_handle");
});

test("buildMoneyFollowUpItems: quote sent without response is to_handle, accepted quote is info-only", () => {
  const items = buildMoneyFollowUpItems(
    [],
    [
      { id: "q1", clientId: "c1", clientName: "X", quoteNumber: "DEV-1", status: "sent", sentAt: daysAgo(2), respondedAt: null },
      { id: "q2", clientId: "c1", clientName: "X", quoteNumber: "DEV-2", status: "accepted", sentAt: daysAgo(5), respondedAt: daysAgo(1) },
    ],
    NOW,
  );
  assert.equal(items.length, 2);
  assert.equal(items.find((i) => i.data.kind === "no_response").level, "to_handle");
  assert.equal(items.find((i) => i.data.kind === "accepted").level, "info");
});

test("buildMoneyFollowUpItems: draft/paid/canceled invoices never appear", () => {
  const items = buildMoneyFollowUpItems(
    [
      { id: "i1", clientId: "c1", clientName: "X", invoiceNumber: "FAC-1", status: "draft", dueAt: daysAgo(30) },
      { id: "i2", clientId: "c1", clientName: "X", invoiceNumber: "FAC-2", status: "paid", dueAt: daysAgo(30) },
      { id: "i3", clientId: "c1", clientName: "X", invoiceNumber: "FAC-3", status: "canceled", dueAt: daysAgo(30) },
    ],
    [],
    NOW,
  );
  assert.equal(items.length, 0);
});

test("buildSyncErrorItems: always urgent", () => {
  const items = buildSyncErrorItems([{ organizationId: "c1", organizationName: "X", product: "gbp", href: "/admin/crm/clients/c1/gbp" }]);
  assert.equal(items.length, 1);
  assert.equal(items[0].level, "urgent");
});

test("groupClientsNeedingAttention: a client with multiple problems appears exactly once, at its most severe level", () => {
  const items = [
    { id: "1", level: "to_handle", organizationId: "c1", organizationName: "Entreprise ABC", href: "/x", data: {} },
    { id: "2", level: "urgent", organizationId: "c1", organizationName: "Entreprise ABC", href: "/y", data: {} },
    { id: "3", level: "info", organizationId: "c1", organizationName: "Entreprise ABC", href: "/z", data: {} },
    { id: "4", level: "to_watch", organizationId: "c2", organizationName: "Autre SARL", href: "/w", data: {} },
  ];
  const grouped = groupClientsNeedingAttention(items);
  assert.equal(grouped.length, 2);
  const abc = grouped.find((g) => g.organizationId === "c1");
  assert.equal(abc.level, "urgent");
  assert.equal(abc.count, 3);
});

test("groupClientsNeedingAttention: urgent clients sort before to_watch clients", () => {
  const items = [
    { id: "1", level: "to_watch", organizationId: "c1", organizationName: "A", href: "/x", data: {} },
    { id: "2", level: "urgent", organizationId: "c2", organizationName: "B", href: "/y", data: {} },
  ];
  const grouped = groupClientsNeedingAttention(items);
  assert.equal(grouped[0].organizationId, "c2");
});
