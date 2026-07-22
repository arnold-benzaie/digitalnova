import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { PDFParse } from "pdf-parse";
import { cleanupE2EAudit, countLingeringE2EFixtures, resolveAuditIds } from "./helpers/audit-db";
import { computeFullAuditScore } from "../lib/gbp-audit/checklist";

/**
 * Full lifecycle E2E — mirrors the manual recette checklist handed to the
 * user (prospect -> quote request), steps numbered to match exactly.
 * Single serial scenario: each step depends on state the previous one
 * created, so it's one test with test.step() markers, not 23 independent
 * tests. QA_BYPASS_AUDIT_ROLE is unset -> defaults to "admin" in
 * lib/gbp-audit/session.ts, which already satisfies "supervisor or admin"
 * for the approval step — no separate role/context switch needed.
 *
 * Every fixture is prefixed [E2E] or uses the fixed jean.dupont+e2e@...
 * address the user specified. Cleanup runs in afterAll unconditionally
 * (even if a step throws), then asserts zero [E2E] rows remain.
 */

const PROSPECT = {
  firstName: "Jean",
  lastName: "Dupont",
  email: "jean.dupont+e2e@example.com",
  phone: "+230 5712 3456",
  whatsapp: "+230 5712 3456",
  ownerName: "Agent Recette",
  notes: "Test automatique Playwright E2E",
};
const BUSINESS = {
  legalName: "[E2E] Boulangerie Test Recette SARL",
  googleDisplayName: "[E2E] Boulangerie Test Recette",
  industry: "Boulangerie",
  primaryCategory: "Bakery",
  address: "12 Rue de la Paix, Port-Louis",
  serviceArea: "Rose-Hill",
  city: "Port-Louis",
  region: "Plaines Wilhems",
  businessPhone: "+230 5798 1234",
  websiteUrl: "https://example.com",
};
const CRITICAL_FINDING = {
  sectionLabel: "Photos, logo et identité visuelle",
  checkLabel: "Logo présent et à jour",
  explanation: "Aucune photo de couverture ni aucun logo publié",
  recommendation: "Ajouter le logo et au moins cinq photos sous sept jours.",
};
const COMPLIANT_FINDING = {
  sectionLabel: "Propriété et statut du profil",
  checkLabel: "Le profil est revendiqué",
  explanation: "Profil revendiqué et vérifié dans Google Business Profile.",
};
const COMPETITOR = {
  name: "[E2E] Boulangerie du Port",
  googleProfileUrl: "https://maps.google.com/?cid=example",
  rating: "4.3",
  reviewCount: "128",
  photoCount: "45",
  notes: "Plus de photos et publications régulières.",
};
const TASK = {
  title: "Publier le logo et les photos de couverture",
  ownerName: "Agent Recette",
  etaDays: "7",
};
const CLIENT_SUMMARY = "Votre profil est globalement bien tenu, avec un point urgent sur les photos à corriger sous 7 jours.";
const QUOTE_MESSAGE = "Bonjour, je souhaite être recontacté pour corriger les points critiques identifiés.";

let auditId: string | undefined;
let businessId: string | undefined;
let prospectId: string | undefined;
let portalUrl: string | undefined;

function trackErrors(page: Page, bucket: string[]) {
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") bucket.push(`[console] ${msg.text()}`);
  });
  page.on("pageerror", (err) => bucket.push(`[pageerror] ${err.message}`));
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await cleanupE2EAudit({ auditId, businessId, prospectId });
  const remaining = await countLingeringE2EFixtures();
  expect(remaining, "des données [E2E] ont survécu au nettoyage").toBe(0);
});

test("parcours complet PUBLIC-MAP Audit : prospect -> devis", async ({ page, browser }) => {
  const errors: string[] = [];
  trackErrors(page, errors);

  await test.step("1-3. Créer le prospect, l'entreprise et l'audit", async () => {
    // #id locators throughout, not getByLabel — several required-field labels
    // render as "Label*" (see components/gbp-audit/ui/field.tsx's asterisk
    // span), and "Pays"/"Téléphone" each appear twice (prospect + entreprise)
    // with the exact same short label text. Field ids are unambiguous and
    // match components/gbp-audit/create-audit-form.tsx exactly.
    await page.goto("/admin/audit/nouveau");
    await page.locator("#firstName").fill(PROSPECT.firstName);
    await page.locator("#lastName").fill(PROSPECT.lastName);
    await page.locator("#email").fill(PROSPECT.email);
    await page.locator("#phone").fill(PROSPECT.phone);
    await page.locator("#whatsapp").fill(PROSPECT.whatsapp);
    await page.locator("#preferredLanguage").selectOption("fr");
    await page.locator("#prospectCountry").fill("Maurice");
    await page.locator("#ownerName").fill(PROSPECT.ownerName);
    await page.locator("#notes").fill(PROSPECT.notes);

    await page.locator("#legalName").fill(BUSINESS.legalName);
    await page.locator("#googleDisplayName").fill(BUSINESS.googleDisplayName);
    await page.locator("#industry").fill(BUSINESS.industry);
    await page.locator("#primaryCategory").fill(BUSINESS.primaryCategory);
    await page.locator("#address").fill(BUSINESS.address);
    await page.locator("#serviceArea").fill(BUSINESS.serviceArea);
    await page.locator("#city").fill(BUSINESS.city);
    await page.locator("#region").fill(BUSINESS.region);
    await page.locator("#businessCountry").fill("Maurice");
    await page.locator("#businessPhone").fill(BUSINESS.businessPhone);
    await page.locator("#websiteUrl").fill(BUSINESS.websiteUrl);
    await page.locator("#locationCount").fill("1");
    await page.locator("#profileStatus").selectOption("unknown");

    await page.getByRole("button", { name: "Créer le prospect et démarrer l’audit" }).click();
    await page.waitForURL(/\/admin\/audit\/[0-9a-f-]{36}$/);
  });

  await test.step("4. Vérifier la création et la redirection", async () => {
    expect(errors, `erreurs runtime après création : ${errors.join(" | ")}`).toEqual([]);
    const match = page.url().match(/\/admin\/audit\/([0-9a-f-]{36})$/);
    expect(match, "URL de redirection inattendue : " + page.url()).not.toBeNull();
    auditId = match![1];

    const ids = await resolveAuditIds(auditId);
    expect(ids, "audit introuvable en base juste après création").not.toBeNull();
    businessId = ids!.businessId;
    prospectId = ids!.prospectId;

    await expect(page.getByRole("heading", { name: BUSINESS.legalName })).toBeVisible();
    await expect(page.getByText(`${PROSPECT.firstName} ${PROSPECT.lastName}`)).toBeVisible();
    await expect(page.getByLabel("Statut de l'audit")).toHaveValue("not_started");
  });

  const OWNERSHIP_KEY = "profile_claimed";
  const PHOTOS_KEY = "logo_present";

  await test.step("5. Ouvrir Contrôles (19 catégories)", async () => {
    const tab = page.getByRole("link", { name: "Contrôles (19 catégories)" });
    await tab.click();
    await page.waitForURL(/\/audit$/);
    await expect(tab).toHaveAttribute("aria-current", "page");
    await expect(page.locator(`button[aria-controls="${OWNERSHIP_KEY}-panel"]`)).toBeVisible();
  });

  await test.step("6-7. Enregistrer un contrôle conforme et un contrôle critique, vérifier persistance et score", async () => {
    // Section A "Propriété et statut du profil" is open by default.
    await page.locator(`button[aria-controls="${OWNERSHIP_KEY}-panel"]`).click();
    let panel = page.locator(`#${OWNERSHIP_KEY}-panel`);
    await panel.locator(`#${OWNERSHIP_KEY}-result`).selectOption("compliant");
    await panel.locator(`#${OWNERSHIP_KEY}-explanation`).fill(COMPLIANT_FINDING.explanation);
    await panel.getByRole("button", { name: "Enregistrer" }).click();
    await expect(panel.getByText("Enregistré", { exact: true })).toBeVisible();

    // Open section I "Photos, logo et identité visuelle" — single-open accordion, closes section A.
    await page.getByRole("button", { name: /Photos, logo et identité visuelle/ }).click();
    await page.locator(`button[aria-controls="${PHOTOS_KEY}-panel"]`).click();
    panel = page.locator(`#${PHOTOS_KEY}-panel`);
    await panel.locator(`#${PHOTOS_KEY}-result`).selectOption("critical_issue");
    await panel.locator(`#${PHOTOS_KEY}-severity`).selectOption("critical");
    await panel.locator(`#${PHOTOS_KEY}-explanation`).fill(CRITICAL_FINDING.explanation);
    await panel.locator(`#${PHOTOS_KEY}-recommendation`).fill(CRITICAL_FINDING.recommendation);
    await panel.getByRole("button", { name: "Enregistrer" }).click();
    await expect(panel.getByText("Enregistré", { exact: true })).toBeVisible();

    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);

    // Persistence across reload — re-fetched from the server, not client state.
    await page.reload();
    await page.getByRole("button", { name: /Photos, logo et identité visuelle/ }).click();
    await page.locator(`button[aria-controls="${PHOTOS_KEY}-panel"]`).click();
    panel = page.locator(`#${PHOTOS_KEY}-panel`);
    await expect(panel.locator(`#${PHOTOS_KEY}-explanation`)).toHaveValue(CRITICAL_FINDING.explanation);
    await expect(panel.locator(`#${PHOTOS_KEY}-result`)).toHaveValue("critical_issue");

    // Score: reuse the real scoring function with the exact 2 findings just saved, rather than a hand-computed guess.
    const expected = computeFullAuditScore([
      { sectionCode: "ownership", result: "compliant", severity: null },
      { sectionCode: "photos_branding", result: "critical_issue", severity: "critical" },
    ] as never);
    await page.goto(`/admin/audit/${auditId}`);
    await expect(page.getByText(`${expected.overall} / 100`)).toBeVisible();
  });

  await test.step("8-9. Ajouter une preuve de type Note, vérifier son rattachement", async () => {
    await page.goto(`/admin/audit/${auditId}/preuves`);
    await page.getByLabel("Contrôle concerné").selectOption({ label: `${CRITICAL_FINDING.sectionLabel} — ${CRITICAL_FINDING.checkLabel}` });
    await page.getByLabel("Type de preuve").selectOption("note");
    // Not getByLabel("Note", {exact:true}) — the "Note" field is required once
    // kind="note" (see components/gbp-audit/evidence-form.tsx), so its
    // accessible name is "Note*" (asterisk span), not an exact "Note" match.
    await page.locator("#note").fill("Vérification E2E — aucune photo visible.");
    await page.getByRole("button", { name: "Ajouter la preuve" }).click();
    await expect(page.getByText("Preuve ajoutée")).toBeVisible();

    await page.goto(`/admin/audit/${auditId}/audit`);
    await page.getByRole("button", { name: /Photos, logo et identité visuelle/ }).click();
    await expect(page.locator(`button[aria-controls="${PHOTOS_KEY}-panel"]`).getByText("1 preuve(s)")).toBeVisible();
  });

  await test.step("10-11. Ajouter un concurrent, vérifier la comparaison", async () => {
    await page.getByRole("link", { name: "Concurrence" }).click();
    await page.waitForURL(/\/concurrence$/);
    await page.getByPlaceholder("Nom du concurrent").fill(COMPETITOR.name);
    await page.getByPlaceholder("URL du profil Google").fill(COMPETITOR.googleProfileUrl);
    await page.getByPlaceholder("Note (/5)").fill(COMPETITOR.rating);
    await page.getByPlaceholder("Nombre d'avis").fill(COMPETITOR.reviewCount);
    await page.getByPlaceholder("Nombre de photos").fill(COMPETITOR.photoCount);
    await page.getByLabel("Publications récentes").check();
    await page.getByPlaceholder("Différences visibles").fill(COMPETITOR.notes);
    await page.getByRole("button", { name: "Ajouter le concurrent" }).click();
    await expect(page.getByText("Concurrent ajouté")).toBeVisible();

    const row = page.locator("tr", { has: page.getByText(COMPETITOR.name, { exact: true }) });
    await expect(row).toBeVisible();
    // Our own profile stats were never filled -> comparison metrics are null -> "Données incomplètes" is the correct, computed verdict, not "some text".
    await expect(row.getByText("Données incomplètes")).toBeVisible();
  });

  await test.step("12-13. Ajouter une action au plan de correction (phase Urgences)", async () => {
    await page.getByRole("link", { name: "Plan de correction" }).click();
    await page.waitForURL(/\/plan-correction$/);
    // The phase-1 heading's direct parent is its card <div> — not `locator("div", {has})`,
    // which would also match the outer wrapper containing all 3 phases (ambiguous: any
    // getByText/getByPlaceholder inside it could then match phase 2 or 3's identical form fields too).
    const phase1 = page.getByRole("heading", { name: "Phase 1 — Urgences" }).locator("..");
    await phase1.getByText("+ Ajouter une action").click();
    await phase1.getByPlaceholder("Action à mener").fill(TASK.title);
    await phase1.getByLabel("Priorité").selectOption("critical");
    await phase1.getByLabel("Difficulté").selectOption("low");
    await phase1.getByPlaceholder("Responsable").fill(TASK.ownerName);
    await phase1.getByPlaceholder("Délai (jours)").fill(TASK.etaDays);
    await phase1.getByRole("button", { name: "Ajouter" }).click();
    await expect(page.getByText("Action ajoutée au plan de correction")).toBeVisible();
    await expect(phase1.getByText(TASK.title)).toBeVisible();
  });

  await test.step("14-16. Soumettre pour validation", async () => {
    // exact: true — the sidebar also has a "Rapports" (plural) nav item, a substring match away.
    await page.getByRole("link", { name: "Rapport", exact: true }).click();
    await page.waitForURL(/\/rapport$/);
    await page.getByRole("button", { name: "Soumettre pour validation" }).click();
    await expect(page.getByText("Audit soumis pour validation")).toBeVisible();
    // Admin role (QA bypass default) -> the approval form renders directly,
    // not the "en attente de validation" message shown to non-supervisor roles.
    await expect(page.getByLabel("Résumé pour le client")).toBeVisible();
  });

  await test.step("17. Approuver le rapport, marquer comme envoyé", async () => {
    await page.getByLabel("Résumé pour le client").fill(CLIENT_SUMMARY);
    await page.getByRole("button", { name: "Approuver le rapport" }).click();
    await expect(page.getByText("Rapport approuvé")).toBeVisible();
    await expect(page.getByRole("button", { name: "Marquer comme envoyé" })).toBeVisible();

    await page.getByRole("button", { name: "Marquer comme envoyé" }).click();
    await expect(page.getByText("Audit marqué comme envoyé")).toBeVisible();
    await expect(page.getByText("Rapport envoyé au prospect.")).toBeVisible();
  });

  await test.step("18-19. Générer le lien du portail, vérifier l'accès public", async () => {
    await page.getByRole("button", { name: "Générer le lien" }).click();
    await expect(page.getByText("Lien sécurisé généré")).toBeVisible();
    const linkCode = page.locator("code");
    await expect(linkCode).toBeVisible();
    portalUrl = (await linkCode.textContent())?.trim();
    expect(portalUrl, "aucun lien portail affiché").toBeTruthy();
    expect(portalUrl).toMatch(/\/audit-report\/[A-Za-z0-9_-]+$/);

    const prospectContext = await browser.newContext();
    const prospectPage = await prospectContext.newPage();
    const prospectErrors: string[] = [];
    trackErrors(prospectPage, prospectErrors);

    await prospectPage.goto(portalUrl!);
    await expect(prospectPage.getByRole("heading", { name: BUSINESS.legalName })).toBeVisible();
    await expect(prospectPage.getByText(`Bonjour ${PROSPECT.firstName},`)).toBeVisible();
    await expect(prospectPage.getByText("Points prioritaires")).toBeVisible();
    await expect(prospectPage.getByText(CRITICAL_FINDING.recommendation)).toBeVisible();
    await expect(prospectPage.getByText("Plan de correction")).toBeVisible();
    await expect(prospectPage.getByText(TASK.title)).toBeVisible();
    // No admin chrome on the public portal — the audit-tabs nav is admin-only.
    await expect(prospectPage.locator('nav[aria-label="Sections de l\'audit"]')).toHaveCount(0);
    await expect(prospectPage.getByText("Contrôles (19 catégories)")).toHaveCount(0);
    expect(prospectErrors, `erreurs runtime sur le portail : ${prospectErrors.join(" | ")}`).toEqual([]);

    await test.step("20. Vérifier les 2 versions du PDF", async () => {
      for (const [label, url] of [
        ["interne", `/api/gbp-audit/${auditId}/pdf`],
        ["client", `/api/gbp-audit/${auditId}/pdf?version=client`],
      ] as const) {
        const res = await page.request.get(url);
        expect(res.status(), `PDF ${label} : statut HTTP inattendu`).toBe(200);
        expect(res.headers()["content-type"], `PDF ${label} : mauvais content-type`).toContain("application/pdf");
        const buffer = await res.body();
        const parser = new PDFParse({ data: buffer });
        const parsed = await parser.getText();
        expect(parsed.text, `PDF ${label} ne contient pas le nom de l'entreprise`).toContain(BUSINESS.legalName);
      }
    });

    await test.step("21-22. Envoyer une demande de devis depuis le portail, vérifier sa création côté admin", async () => {
      await prospectPage.getByPlaceholder("Votre message (facultatif)").fill(QUOTE_MESSAGE);
      await prospectPage.getByRole("button", { name: "Envoyer ma demande" }).click();
      await expect(prospectPage.getByText("Votre demande a bien été transmise à PUBLIC-MAP.")).toBeVisible();

      await page.goto("/admin/audit/devis");
      const quoteLink = page.getByRole("link", { name: BUSINESS.legalName });
      await expect(quoteLink).toBeVisible();
      await expect(quoteLink).toHaveAttribute("href", `/admin/audit/${auditId}`);
      // The link's direct parent <div> also holds the message paragraph as a sibling (see quote-request-inbox.tsx).
      const quoteRow = quoteLink.locator("..");
      await expect(quoteRow.getByText(QUOTE_MESSAGE)).toBeVisible();
    });

    await prospectContext.close();
  });

  await test.step("23. Vérifier l'historique de l'audit", async () => {
    await page.goto(`/admin/audit/${auditId}/timeline`);
    const expectedLabels = [
      "Prospect créé",
      "Audit créé",
      "Contrôle mis à jour",
      "Preuve ajoutée",
      "Concurrent ajouté",
      "Tâche de correction créée",
      "Audit soumis pour validation",
      "Audit approuvé",
      "Rapport envoyé",
      "Lien sécurisé généré",
      "Demande de devis reçue",
    ];
    for (const label of expectedLabels) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  expect(errors, `erreurs runtime accumulées pendant tout le parcours : ${errors.join(" | ")}`).toEqual([]);
});
