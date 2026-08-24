import { getLocale } from "@/lib/i18n/locale";
import { getCurrentSession } from "@/lib/session";
import { getOrganizationMarket } from "@/lib/chat/context";
import { ChatWidgetMount } from "@/components/chat/chat-widget-mount";

/**
 * Server Component boundary — resolves the widget's initial, safe
 * personalization props (locale, firstName if authenticated) BEFORE any
 * client code runs, using getCurrentSession() (lib/session.ts), the
 * non-redirecting session resolver every other optional-auth surface in
 * this app already uses. This is what lets the greeting (§17 "Bonjour
 * Arnold 👋") be correct on first paint, with no extra client-side
 * round-trip to /api/chat just to learn who's asking — and, critically,
 * it never calls requireSession() here, which would redirect a signed-
 * out visitor on every single page (including /sign-in itself) just
 * because the widget is mounted in the root layout.
 */
export async function ChatWidgetServer() {
  const locale = await getLocale();
  const session = await getCurrentSession();
  // §Phase 1F — only ever a WEAK, non-blocking hint for the phone
  // field's default country (see chat-lead-form.tsx): "CANADA" maps to
  // a real single country (CA), "EUROPE" spans dozens of countries and
  // is deliberately never turned into a guessed one.
  const market = session ? await getOrganizationMarket(session.organizationId) : null;
  return <ChatWidgetMount locale={locale} firstName={session?.firstName ?? null} isAuthenticated={session !== null} market={market} />;
}
