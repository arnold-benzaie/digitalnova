"use client";

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
 */
const ChatWidget = dynamic(() => import("@/components/chat/chat-widget").then((mod) => mod.ChatWidget), {
  ssr: false,
  loading: () => null,
});

export function ChatWidgetMount(props: { locale: Locale; firstName: string | null; isAuthenticated: boolean }) {
  return <ChatWidget {...props} />;
}
