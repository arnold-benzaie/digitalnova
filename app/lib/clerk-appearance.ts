/**
 * Brand theming for Clerk's prebuilt components (SignIn, SignUp, UserButton,
 * etc.) rendered inside this app. Colors/radius mirror the pm- tokens in
 * globals.css; this only reaches components mounted via <ClerkProvider> in
 * this codebase — it does NOT reach Clerk's hosted Account Portal or its
 * transactional emails, which are branded separately in the Clerk Dashboard.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: "#080808",
    colorPrimaryForeground: "#fafaf8",
    colorDanger: "#d52b1e",
    colorSuccess: "#2f7d4f",
    colorWarning: "#c8922a",
    colorBackground: "#fafaf8",
    colorForeground: "#080808",
    colorMutedForeground: "#6b6b6b",
    colorBorder: "#e2ddd8",
    colorInput: "#ffffff",
    colorInputForeground: "#080808",
    fontFamily: "var(--font-outfit)",
    borderRadius: "0.5rem",
  },
  options: {
    logoImageUrl: "/brand/public-map-logo.png",
    logoPlacement: "inside" as const,
    logoLinkUrl: "/",
    termsPageUrl: "https://www.public-map.com/terms",
    privacyPageUrl: "https://www.public-map.com/privacy",
  },
};
