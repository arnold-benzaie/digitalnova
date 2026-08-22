"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import type { Locale } from "@/lib/i18n/dictionaries";

/**
 * The ONLY place `{ ssr: false }` appears — deliberately isolated in its
 * own Client Component. This Next.js version (16.2.10) rejects
 * `ssr: false` inside a Server Component outright ("ssr: false is not
 * allowed with next/dynamic in Server Components"), so app/layout.tsx
 * (a Server Component) never calls next/dynamic itself — it renders
 * <ChatWidgetServer/> (also a Server Component) which renders THIS
 * Client Component, which is the one that performs the actual lazy,
 * client-only import. app/layout.tsx itself never becomes "use client".
 *
 * Explicit <Suspense> instead of next/dynamic's own `loading:` shorthand
 * (which is otherwise equivalent — Next's docs describe next/dynamic as
 * "a composite of React.lazy() and Suspense"): ChatWidgetServer calls
 * getCurrentSession()/getLocale() (dynamic, per-request APIs), which
 * forces the root layout to re-execute server-side on every navigation,
 * including client-side ones — this component's own <ChatWidget/> gets a
 * fresh element on each of those. An application-owned Suspense boundary
 * gives React an explicit, stable fallback/resolved-child swap point for
 * that repeated remount instead of relying on next/dynamic's internal
 * one, which is the suspected cause of a "Rendered more hooks than
 * during the previous render" error observed during the Audit E2E
 * suite's real client-side navigations (see Phase 1B report).
 */
const ChatWidget = dynamic(() => import("@/components/chat/chat-widget").then((mod) => mod.ChatWidget), {
  ssr: false,
});

export function ChatWidgetMount(props: { locale: Locale; firstName: string | null; isAuthenticated: boolean }) {
  return (
    <Suspense fallback={null}>
      <ChatWidget {...props} />
    </Suspense>
  );
}
