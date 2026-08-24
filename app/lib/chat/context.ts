import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { googleOauthConnections, organizations } from "@/db/schema";
import type { Locale } from "@/lib/i18n/dictionaries";
import { getCurrentSession } from "@/lib/session";

export type ChatActiveIntegrations = { gbp: boolean; analytics: boolean; searchConsole: boolean };

export type ChatContext =
  | {
      kind: "authenticated";
      userId: string;
      organizationId: string;
      organizationName: string;
      firstName: string | null;
      locale: Locale;
      // §Phase 1F (phone country default) — `organizations.market` now
      // exists (merged since the comment this replaced was written).
      // Read directly here rather than threading it through
      // getCurrentSession(), which every OTHER session consumer in the
      // app also uses — a targeted, chat-only lookup keeps this change
      // scoped to the one feature that actually needs it.
      market: "CANADA" | "EUROPE" | null;
      activeIntegrations: ChatActiveIntegrations;
    }
  | {
      kind: "anonymous";
      visitorId: string;
      locale: Locale;
    };

/**
 * The single source of truth for what the chat widget (and, later, a
 * real AI provider) is allowed to know about "who is asking." Reuses
 * getCurrentSession() (lib/session.ts) — the same non-redirecting,
 * request-cached session resolver every other optional-auth surface in
 * this app already uses — so a signed-out visitor gets a clean
 * `{ kind: "anonymous" }` back, never a thrown error or a redirect,
 * which matters here because this is called from a public API route.
 *
 * Never accepts userId/organizationId/role/market from the caller — the
 * only input is the already-resolved visitorId (see lib/chat/visitor.ts)
 * and the already-resolved UI locale, both of which are safe to pass
 * through as-is because neither is a trust decision.
 */
export async function resolveChatContext(locale: Locale, visitorId: string): Promise<ChatContext> {
  const session = await getCurrentSession();
  if (!session) {
    return { kind: "anonymous", visitorId, locale };
  }

  const [activeIntegrations, market] = await Promise.all([getActiveIntegrations(session.organizationId), getOrganizationMarket(session.organizationId)]);

  return {
    kind: "authenticated",
    userId: session.userId,
    organizationId: session.organizationId,
    organizationName: session.organizationName,
    firstName: session.firstName,
    locale,
    market,
    activeIntegrations,
  };
}

/** Exported so chat-widget-server.tsx (initial SSR props, before any
 * conversation has started) can reuse the exact same lookup instead of
 * a second, independently-written query. */
export async function getOrganizationMarket(organizationId: string): Promise<"CANADA" | "EUROPE" | null> {
  const [row] = await db.select({ market: organizations.market }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return row?.market === "CANADA" || row?.market === "EUROPE" ? row.market : null;
}

/** "Active" means "synced at least once" (a real, meaningful signal),
 * not merely "OAuth scope granted" — matches the same distinction the
 * dashboard's own Integration status page already draws. Never reads
 * accessToken/refreshToken/grantedScopes; only the three sync
 * timestamps, reduced to booleans. */
async function getActiveIntegrations(organizationId: string): Promise<ChatActiveIntegrations> {
  const [row] = await db
    .select({
      gbpLastSyncedAt: googleOauthConnections.gbpLastSyncedAt,
      analyticsLastSyncedAt: googleOauthConnections.analyticsLastSyncedAt,
      searchConsoleLastSyncedAt: googleOauthConnections.searchConsoleLastSyncedAt,
    })
    .from(googleOauthConnections)
    .where(eq(googleOauthConnections.organizationId, organizationId))
    .limit(1);

  return {
    gbp: Boolean(row?.gbpLastSyncedAt),
    analytics: Boolean(row?.analyticsLastSyncedAt),
    searchConsole: Boolean(row?.searchConsoleLastSyncedAt),
  };
}
