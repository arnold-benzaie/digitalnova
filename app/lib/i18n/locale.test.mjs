// Bilingual (FR/EN) access-pending experience — run with:
//   npx tsx --test lib/i18n/locale.test.mjs
// Covers the pure, framework-independent pieces: Accept-Language parsing,
// the locale-cookie type guard, and dictionary parity (every key present
// in French must also exist in English, and vice versa — the class of bug
// where a string gets added to one language and forgotten in the other).
//
// Not covered here: lib/i18n/client-locale.ts's getClientLocale() (reads
// the real browser `document`/`navigator` globals, which Node doesn't
// provide in a safely-mockable form — same judgment call as
// lib/dev-role.test.mjs's header comment on why the Audit app's session
// helpers aren't unit-mocked either); lib/i18n/locale.ts's getLocale()
// (uses next/headers' cookies()/headers(), request-scoped APIs with no
// meaning outside an actual request); and lib/actions/locale.ts's
// setLocale() (a "use server" Server Action that calls redirect() and
// cookies().set() — thin wiring around the pieces tested here, exercised
// live instead, same as other Server Actions in this codebase).
import { test } from "node:test";
import assert from "node:assert/strict";
import { localeFromAcceptLanguage } from "./locale.ts";
import { isLocale } from "./shared.ts";
import { dictionaries, LOCALES } from "./dictionaries/index.ts";

test("localeFromAcceptLanguage: picks English for an en-* primary tag", () => {
  assert.equal(localeFromAcceptLanguage("en-US,en;q=0.9,fr;q=0.8"), "en");
  assert.equal(localeFromAcceptLanguage("en"), "en");
});

test("localeFromAcceptLanguage: is case-insensitive", () => {
  assert.equal(localeFromAcceptLanguage("EN-GB"), "en");
});

test("localeFromAcceptLanguage: defaults to French for an fr-* primary tag", () => {
  assert.equal(localeFromAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.8"), "fr");
});

test("localeFromAcceptLanguage: defaults to French for an unrelated language", () => {
  assert.equal(localeFromAcceptLanguage("de-DE,de;q=0.9"), "fr");
});

test("localeFromAcceptLanguage: defaults to French when the header is absent (matches this app's only language everywhere else)", () => {
  assert.equal(localeFromAcceptLanguage(null), "fr");
  assert.equal(localeFromAcceptLanguage(undefined), "fr");
  assert.equal(localeFromAcceptLanguage(""), "fr");
});

test("isLocale: accepts exactly the two supported locales", () => {
  assert.equal(isLocale("fr"), true);
  assert.equal(isLocale("en"), true);
});

test("isLocale: rejects anything else, including undefined/empty (never trusts a tampered cookie)", () => {
  assert.equal(isLocale("de"), false);
  assert.equal(isLocale(""), false);
  assert.equal(isLocale(undefined), false);
  assert.equal(isLocale(null), false);
});

test("dictionaries: fr and en expose the exact same keys (no string added to one and forgotten in the other)", () => {
  assert.deepEqual(LOCALES, ["fr", "en"]);
  const [fr, en] = LOCALES.map((l) => dictionaries[l]);
  assert.deepEqual(Object.keys(fr).sort(), Object.keys(en).sort());
  for (const section of Object.keys(fr)) {
    assert.deepEqual(
      Object.keys(fr[section]).sort(),
      Object.keys(en[section]).sort(),
      `mismatched keys in dictionaries.*.${section}`,
    );
  }
});

// Plain objects only (not functions, not the interpolated-string return
// value of a function) get walked all the way down, so a key nested five
// levels deep (e.g. dashboard.googleIntegration.gbp.connectTitle) is just
// as covered as a top-level one — the shallow check above only compared
// one level, which would have silently missed a mismatch inside e.g.
// dashboard.googleIntegration.stats.
function deepKeys(value, path = "") {
  if (value === null || typeof value !== "object") return [];
  let keys = [];
  for (const key of Object.keys(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    keys.push(nextPath);
    keys = keys.concat(deepKeys(value[key], nextPath));
  }
  return keys;
}

test("dictionaries: fr and en expose the exact same keys at every nesting depth", () => {
  const fr = deepKeys(dictionaries.fr).sort();
  const en = deepKeys(dictionaries.en).sort();
  assert.deepEqual(fr, en);
});

test("dictionaries: every leaf is a non-empty string, a finite number, or a function (no accidental undefined/null left behind)", () => {
  function walk(value, path) {
    if (typeof value === "function") return;
    if (typeof value === "string") {
      assert.ok(value.length > 0, `empty string at ${path}`);
      return;
    }
    // A handful of domains mix small structured data (e.g. a phase number,
    // an id) alongside translatable text in the same object/array — numbers
    // are legitimate leaves there, not a sign of a forgotten translation.
    if (typeof value === "number") {
      assert.ok(Number.isFinite(value), `non-finite number at ${path}`);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const key of Object.keys(value)) walk(value[key], `${path}.${key}`);
      return;
    }
    assert.fail(`unexpected leaf type at ${path}: ${typeof value}`);
  }
  for (const locale of LOCALES) walk(dictionaries[locale], `dictionaries.${locale}`);
});

test("dictionaries: welcomeTitle/contact/backToSite/supportLabel interpolate the app name in both languages", () => {
  for (const locale of LOCALES) {
    const t = dictionaries[locale].accessPending;
    assert.match(t.welcomeTitle("PUBLIC-MAP"), /PUBLIC-MAP/);
    assert.match(t.contact("PUBLIC-MAP"), /PUBLIC-MAP/);
    assert.match(t.backToSite("PUBLIC-MAP"), /PUBLIC-MAP/);
    assert.match(t.supportLabel("PUBLIC-MAP"), /PUBLIC-MAP/);
  }
});

test("dictionaries: greeting personalizes with a real first name, or falls back to a generic greeting (never a fictional name)", () => {
  assert.equal(dictionaries.fr.accessPending.greeting("Arnaud"), "Bonjour Arnaud,");
  assert.equal(dictionaries.fr.accessPending.greeting(null), "Bonjour,");
  assert.equal(dictionaries.en.accessPending.greeting("John"), "Hello John,");
  assert.equal(dictionaries.en.accessPending.greeting(null), "Hello,");
});

test("dictionaries: access-pending copy matches the exact FR/EN text specified for this feature", () => {
  const fr = dictionaries.fr.accessPending;
  const en = dictionaries.en.accessPending;

  assert.equal(fr.welcomeTitle("PUBLIC-MAP"), "Bienvenue sur PUBLIC-MAP !");
  assert.equal(en.welcomeTitle("PUBLIC-MAP"), "Welcome to PUBLIC-MAP!");
  assert.equal(fr.lead, "Votre compte a été créé avec succès. Votre connexion est confirmée.");
  assert.equal(
    en.lead,
    "Your account has been created successfully. Your sign-in has been confirmed.",
  );
  // No automatic notification exists after approval (checked: no notify()
  // call, no email dispatch anywhere role/membership is granted — see
  // lib/actions/users.ts, lib/actions/gbp-audit-staff.ts) — the copy must
  // not promise one.
  assert.equal(
    fr.body,
    "Un administrateur doit maintenant valider votre accès avant que vous puissiez utiliser la plateforme. Votre accès sera disponible dès qu'un administrateur aura approuvé votre compte.",
  );
  assert.doesNotMatch(fr.body, /informé/i);
  assert.equal(
    en.body,
    "An administrator must now approve your account before you can access the platform. Your access will become available once an administrator has approved your account.",
  );
  assert.doesNotMatch(en.body, /notified/i);

  assert.equal(fr.infoTitle, "Que se passe-t-il maintenant ?");
  assert.equal(en.infoTitle, "What happens next?");
  assert.deepEqual(fr.infoItems, [
    "Votre identité a été vérifiée.",
    "Votre compte est enregistré.",
    "Votre demande attend une validation.",
    "Vous recevrez un accès après approbation.",
  ]);
  assert.deepEqual(en.infoItems, [
    "Your identity has been verified.",
    "Your account has been created.",
    "Your request is awaiting approval.",
    "You'll receive access after approval.",
  ]);

  assert.equal(fr.contact("PUBLIC-MAP"), "Contacter PUBLIC-MAP");
  assert.equal(en.contact("PUBLIC-MAP"), "Contact PUBLIC-MAP");
  assert.equal(fr.backToSite("PUBLIC-MAP"), "Retour au site PUBLIC-MAP");
  assert.equal(en.backToSite("PUBLIC-MAP"), "Return to PUBLIC-MAP");
  assert.equal(fr.signOut, "Se déconnecter");
  assert.equal(en.signOut, "Sign out");
  assert.equal(fr.supportLabel("PUBLIC-MAP"), "Support PUBLIC-MAP");
  assert.equal(en.supportLabel("PUBLIC-MAP"), "Support PUBLIC-MAP");
});
