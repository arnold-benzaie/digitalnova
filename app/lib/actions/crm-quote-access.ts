"use server";

import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { crmQuoteAccessLinks, crmQuotes } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";
import { clientIpFromHeaders } from "@/lib/gbp-audit/client-ip";
import { checkRateLimit } from "@/lib/api-v1/rate-limit";
import { getLocale } from "@/lib/i18n/locale";

/**
 * Secure, unauthenticated access to a single quote's public page for its
 * (external) client — Chantier 1 Phase 1. Mirrors
 * lib/actions/crm-invoice-access.ts exactly in shape and security model: a
 * random, unguessable token is the sole credential, rate-limited and
 * attempt-capped at resolution time. This phase builds the token
 * infrastructure only — no public page, no email, and no accept/decline
 * action exist yet (later phases of Chantier 1); nothing here ever writes
 * to crmQuotes itself (status/sentAt/respondedAt untouched).
 */

const RATE_LIMIT_SCOPE = "crm_quote_token";
const RATE_LIMIT_PER_WINDOW = 30;
const RATE_LIMIT_WINDOW_SECONDS = 300;

const MESSAGES = {
  fr: { quoteNotFound: "Devis introuvable." },
  en: { quoteNotFound: "Quote not found." },
} as const;

/**
 * Staff-only — creates (or returns the existing, still-valid) token link
 * for a quote. Never touches crmQuotes.status/sentAt/respondedAt — this
 * function's sole job is minting/reusing the access token.
 *
 * Expiration policy (explicitly decided, not an arbitrary default): the
 * link's expiresAt is set from the quote's own validUntil at creation
 * time, when that's populated — a quote link should not outlive the
 * quote's own stated validity. When validUntil is unset, expiresAt stays
 * null (no expiration), matching the field's own nullable, "unknown/never"
 * semantics elsewhere in this codebase (never a fabricated duration).
 *
 * "Still-valid" reuse: an existing link is only reused when it is neither
 * revoked NOR already past its own expiresAt — an expired link (even one
 * that was fine when first created) is never handed back as-is; a fresh
 * one is minted instead, with expiresAt recomputed from the quote's
 * CURRENT validUntil (which may have changed since the original link was
 * created).
 */
export async function createOrGetQuoteAccessLink(quoteId: string) {
  await requireStaffRole();
  const locale = await getLocale();

  const [quote] = await db.select({ id: crmQuotes.id, validUntil: crmQuotes.validUntil }).from(crmQuotes).where(eq(crmQuotes.id, quoteId)).limit(1);
  if (!quote) throw new Error(MESSAGES[locale].quoteNotFound);

  const [existing] = await db.select().from(crmQuoteAccessLinks).where(eq(crmQuoteAccessLinks.quoteId, quoteId)).limit(1);
  const stillValid = existing && !existing.revokedAt && !(existing.expiresAt && existing.expiresAt.getTime() < Date.now());
  if (stillValid) return existing;

  const token = randomBytes(32).toString("base64url");
  // Explicitly reset revokedAt/failedAttempts, not just token/expiresAt —
  // this is a genuinely fresh credential, so a prior revocation or
  // exhausted attempt budget on the old token must never carry over onto
  // it.
  const values = { quoteId, token, expiresAt: quote.validUntil ?? null, revokedAt: null, failedAttempts: 0 };

  if (existing) {
    // A prior link exists but is revoked or expired — replace it in place
    // (same row, new token/expiry) rather than accumulating dead rows,
    // since quoteId has no uniqueness constraint forcing one-row-per-quote
    // but there is no reason to keep more than the single current one.
    const [link] = await db.update(crmQuoteAccessLinks).set(values).where(eq(crmQuoteAccessLinks.id, existing.id)).returning();
    return link;
  }

  const [link] = await db.insert(crmQuoteAccessLinks).values(values).returning();
  return link;
}

/**
 * PUBLIC — no Clerk session, no staff role. Possession of a valid,
 * non-revoked, non-expired token (within the attempt budget) is the sole
 * credential, exactly like crmInvoiceAccessLinks. Returns only the quote
 * row itself — never mutates it, never touches status/sentAt/respondedAt.
 * No accept/decline capability exists here or anywhere yet (later phase).
 */
export async function resolveQuoteByToken(token: string) {
  const hdrs = await headers();
  const ip = clientIpFromHeaders(hdrs);

  const rate = await checkRateLimit(RATE_LIMIT_SCOPE, ip, RATE_LIMIT_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
  if (!rate.allowed) return { ok: false as const, reason: "rate_limited" as const };

  const [link] = await db.select().from(crmQuoteAccessLinks).where(eq(crmQuoteAccessLinks.token, token)).limit(1);
  if (!link) return { ok: false as const, reason: "not_found" as const };
  if (link.failedAttempts >= link.maxAttempts) return { ok: false as const, reason: "locked" as const };

  async function recordFailure(reason: "revoked" | "expired") {
    await db.update(crmQuoteAccessLinks).set({ failedAttempts: sql`${crmQuoteAccessLinks.failedAttempts} + 1` }).where(eq(crmQuoteAccessLinks.id, link.id));
    return { ok: false as const, reason };
  }
  if (link.revokedAt) return recordFailure("revoked");
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return recordFailure("expired");

  const [quote] = await db.select().from(crmQuotes).where(eq(crmQuotes.id, link.quoteId)).limit(1);
  if (!quote) return { ok: false as const, reason: "not_found" as const };

  return { ok: true as const, quote };
}
