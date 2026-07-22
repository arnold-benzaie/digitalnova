import type { Metadata } from "next";
import { Outfit, Cormorant_Garamond } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
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

export const metadata: Metadata = {
  title: "Public Maps — Plateforme",
  description: "Gérez, optimisez et suivez votre présence Google Business Profile.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
      <html
        lang="fr"
        className={`${outfit.variable} ${cormorant.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col bg-pm-blanc text-pm-noir font-sans">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
