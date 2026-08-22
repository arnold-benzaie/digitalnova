import type { Metadata } from "next";
import { Outfit, Cormorant_Garamond } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { frFR, enUS } from "@clerk/localizations";
import { APP_NAME } from "@/lib/brand";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { getLocale } from "@/lib/i18n/locale";
import { ChatWidgetServer } from "@/components/chat/chat-widget-server";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["300", "400", "600", "700"],
  style: ["normal", "italic"],
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return locale === "en"
    ? { title: `${APP_NAME} — Platform`, description: "Manage, optimize, and track your Google Business Profile presence." }
    : { title: `${APP_NAME} — Plateforme`, description: "Gérez, optimisez et suivez votre présence Google Business Profile." };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      appearance={clerkAppearance}
      localization={locale === "en" ? enUS : frFR}
      // Pinned to work around a real, reproducible sign-in failure: this
      // SDK version always requests the Clerk JS script with
      // crossOrigin="anonymous" (forcing a CORS preflight), but Clerk's CDN
      // 307-redirects the unpinned "@clerk/clerk-js@6/..." URL to the exact
      // patch version — and a preflight response is never allowed to be a
      // redirect, so every browser fails to load Clerk entirely ("Failed to
      // load Clerk JS", code failed_to_load_clerk_js). Requesting the exact
      // version directly skips the redirect. See Clerk's own guidance on
      // pinning: https://clerk.com/docs/pinning — bump this if @clerk/nextjs
      // is upgraded to a newer default clerk-js version.
      // @ts-expect-error — works at runtime (confirmed in @clerk/nextjs's own
      // source, see clerk-script-tags.js), just not part of the public prop types.
      __internal_clerkJSVersion="6.25.3"
    >
      <html
        lang={locale}
        className={`${outfit.variable} ${cormorant.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-pm-blanc text-pm-noir font-sans">
          {children}
          {/* Mounted once for the whole app (§23 of the AI Assistant plan)
              — a Server Component (resolves locale/session safely, never
              redirects a signed-out visitor) rendering a Client Component
              that lazy-loads the actual widget with ssr:false, since this
              Next.js version rejects ssr:false directly inside a Server
              Component like RootLayout. See chat-widget-mount.tsx. */}
          <ChatWidgetServer />
        </body>
      </html>
    </ClerkProvider>
  );
}
