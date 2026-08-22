import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { googleOauthConnections } from "@/db/schema";
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
      // Structurally present for a future merge with the market-as-
      // source-of-truth work (preview/market-google-ads) — always null
      // here: `organizations.market` does not exist on this branch (it
      // was added on a separate branch not yet merged to master). See
      // "limitations connues" in the Phase 1A report.
      market: null;
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

  const activeIntegrations = await getActiveIntegrations(session.organizationId);

  return {
    kind: "authenticated",
    userId: session.userId,
    organizationId: session.organizationId,
    organizationName: session.organizationName,
    firstName: session.firstName,
    locale,
    market: null,
    activeIntegrations,
  };
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
