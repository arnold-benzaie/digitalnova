/** Centralized locale type — the only two languages this app supports.
 * Adding a third language later means adding one entry here plus one
 * `<Locale>` branch in each domain file; nothing else in the type system
 * needs to change. */
export type Locale = "fr" | "en";

export const LOCALES: readonly Locale[] = ["fr", "en"];
