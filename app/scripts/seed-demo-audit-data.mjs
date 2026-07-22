#!/usr/bin/env node
/**
 * Demo data for the PUBLIC-MAP Audit module — LOCAL/DEV ONLY. Every row is
 * prefixed "[DÉMO]" so it can never be mistaken for a real prospect. Run
 * against the local Docker Postgres only:
 *
 *   AUDIT_DATABASE_URL="postgresql://postgres:localtest@localhost:5433/public_map_audit_test" npx tsx scripts/seed-demo-audit-data.mjs
 *
 * Refuses to run against anything that looks like the main production
 * database (same guard as everything else — see db/guard-main-production.ts).
 * Idempotent-ish: safe to re-run, just creates another batch of demo rows
 * (clean the local DB with `docker exec ... psql -c "TRUNCATE ..."` between
 * runs if you want a clean slate).
 */
import { assertNotMainProductionDatabase } from "../db/guard-main-production.ts";
import { auditDb } from "../db/audit-index.ts";
import {
  auditBusinesses,
  auditProspects,
  auditStaffRoles,
  emailTemplates,
  gbpAuditEvidence,
  gbpAuditFindings,
  gbpAuditReports,
  gbpAudits,
  gbpCompetitors,
  gbpCorrectionTasks,
  gbpReportAccessLinks,
  gbpServiceOffers,
} from "../db/audit-schema.ts";
import { GBP_AUDIT_CHECKS, GBP_AUDIT_SECTIONS, computeFullAuditScore } from "../lib/gbp-audit/checklist.ts";
import { eq } from "drizzle-orm";

assertNotMainProductionDatabase(process.env.AUDIT_DATABASE_URL ?? "", "AUDIT_DATABASE_URL");

// 1x1 transparent PNG, used as placeholder evidence bytes.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function ensureRoles() {
  const existing = await auditDb.select().from(auditStaffRoles);
  const names = new Set(existing.map((r) => r.name));
  for (const name of ["admin", "supervisor", "staff"]) {
    if (!names.has(name)) {
      await auditDb.insert(auditStaffRoles).values({ name });
    }
  }
}

async function ensureServiceOffers() {
  const offers = [
    { key: "urgent_fix", label: "[DÉMO] Correction urgente", description: "Traitement prioritaire des anomalies critiques et des problèmes de propriété.", ctaUrl: "https://www.public-map.com/services" },
    { key: "full_optimization", label: "[DÉMO] Optimisation complète", description: "Refonte complète du profil : catégories, description, photos, attributs.", ctaUrl: "https://www.public-map.com/services" },
    { key: "monthly_management", label: "[DÉMO] Gestion mensuelle", description: "Suivi continu : publications, avis, statistiques, amélioration continue.", ctaUrl: "https://www.public-map.com/services" },
    { key: "local_seo", label: "[DÉMO] Référencement local", description: "Cohérence locale, site web, pages géographiques, citations.", ctaUrl: "https://www.public-map.com/services" },
  ];
  for (const offer of offers) {
    const [existing] = await auditDb.select().from(gbpServiceOffers).where(eq(gbpServiceOffers.key, offer.key)).limit(1);
    if (!existing) await auditDb.insert(gbpServiceOffers).values(offer);
  }
}

async function ensureEmailTemplates() {
  const templates = [
    { key: "audit_completed", subject: "[DÉMO] Votre audit Google Business Profile est prêt", bodyHtml: "<p>Bonjour {{firstName}}, votre audit pour {{businessName}} est terminé.</p>" },
    { key: "report_opened_reminder", subject: "[DÉMO] Avez-vous consulté votre rapport ?", bodyHtml: "<p>Nous n'avons pas encore vu que vous avez ouvert votre rapport d'audit.</p>" },
  ];
  for (const t of templates) {
    const [existing] = await auditDb.select().from(emailTemplates).where(eq(emailTemplates.key, t.key)).limit(1);
    if (!existing) await auditDb.insert(emailTemplates).values(t);
  }
}

const SCENARIOS = [
  {
    prospect: { firstName: "[DÉMO]", lastName: "Boulangerie Rose-Hill", email: "demo1@example.com", phone: "+230 5555 0101", whatsapp: "+230 5555 0101", source: "site web", ownerName: "[DÉMO] Agent Fogang" },
    business: { legalName: "[DÉMO] Boulangerie Rose-Hill", googleDisplayName: "[DÉMO] Boulangerie Rose-Hill — Pain & Pâtisserie", industry: "Boulangerie-pâtisserie", primaryCategory: "Boulangerie", address: "Rue Royale, Rose-Hill", city: "Rose-Hill", country: "Maurice", profileStatus: "claimed", locationCount: 1 },
    status: "in_progress",
    findingsCoverage: 0.6,
  },
  {
    prospect: { firstName: "[DÉMO]", lastName: "Garage Auto QB", email: "demo2@example.com", phone: "+230 5555 0102", source: "recommandation", ownerName: "[DÉMO] Agent Fogang" },
    business: { legalName: "[DÉMO] Garage Auto Quatre Bornes", primaryCategory: "Garage automobile", address: "Route Royale, Quatre Bornes", city: "Quatre Bornes", country: "Maurice", profileStatus: "unclaimed", locationCount: 1 },
    status: "pending_review",
    findingsCoverage: 1,
  },
  {
    prospect: { firstName: "[DÉMO]", lastName: "Clinique Dentaire Curepipe", email: "demo3@example.com", phone: "+230 5555 0103", source: "salon", ownerName: "[DÉMO] Agent Fogang" },
    business: { legalName: "[DÉMO] Clinique Dentaire Curepipe", primaryCategory: "Clinique dentaire", address: "Avenue Marcel, Curepipe", city: "Curepipe", country: "Maurice", profileStatus: "claimed", locationCount: 1 },
    status: "sent",
    findingsCoverage: 1,
    approved: true,
  },
  {
    prospect: { firstName: "[DÉMO]", lastName: "Salon de Coiffure Vacoas", email: "demo4@example.com", phone: "+230 5555 0104", source: "site web", ownerName: "[DÉMO] Agent Fogang" },
    business: { legalName: "[DÉMO] Salon de Coiffure Vacoas", primaryCategory: "Salon de coiffure", address: "Route Saint Jean, Vacoas", city: "Vacoas", country: "Maurice", profileStatus: "unknown", locationCount: 1 },
    status: "not_started",
    findingsCoverage: 0,
  },
];

const ALL_CHECKS = GBP_AUDIT_SECTIONS.flatMap((s) => GBP_AUDIT_CHECKS[s.code].map((c) => ({ sectionCode: s.code, checkKey: c.key })));
const CHECK_LABEL = Object.fromEntries(
  GBP_AUDIT_SECTIONS.flatMap((s) => GBP_AUDIT_CHECKS[s.code].map((c) => [`${s.code}:${c.key}`, c.label])),
);
// Weighted toward realistic outcomes (most checks pass) so demo scores land in a believable range.
const RESULTS = [
  "compliant", "compliant", "compliant", "compliant", "compliant", "compliant", "compliant",
  "improvement_recommended", "improvement_recommended",
  "major_issue",
  "critical_issue",
];
const SEVERITIES = ["opportunity", "opportunity", "moderate", "moderate", "important", "critical"];

async function seedScenario(scenario) {
  const [prospect] = await auditDb.insert(auditProspects).values({ ...scenario.prospect, preferredLanguage: "fr", country: scenario.prospect.country ?? "Maurice" }).returning();
  const [business] = await auditDb.insert(auditBusinesses).values({ ...scenario.business, prospectId: prospect.id }).returning();
  const [audit] = await auditDb.insert(gbpAudits).values({ businessId: business.id, prospectId: prospect.id, assignedAgentName: scenario.prospect.ownerName, status: scenario.status }).returning();

  const checksToFill = ALL_CHECKS.slice(0, Math.round(ALL_CHECKS.length * scenario.findingsCoverage));
  const insertedFindings = [];
  for (const check of checksToFill) {
    const result = RESULTS[Math.floor(Math.random() * RESULTS.length)];
    const severity = result === "compliant" ? null : SEVERITIES[Math.floor(Math.random() * SEVERITIES.length)];
    const [finding] = await auditDb
      .insert(gbpAuditFindings)
      .values({
        auditId: audit.id,
        sectionCode: check.sectionCode,
        checkKey: check.checkKey,
        result,
        severity,
        explanation: result !== "compliant" ? "[DÉMO] Explication générée pour la démonstration." : null,
        recommendation: result !== "compliant" ? "[DÉMO] Recommandation générée pour la démonstration." : null,
      })
      .returning();
    insertedFindings.push(finding);
  }

  if (insertedFindings.length > 0) {
    const score = computeFullAuditScore(insertedFindings);
    await auditDb
      .update(gbpAudits)
      .set({
        scoreOverall: score.overall,
        scoreCompliance: score.compliance,
        scoreCompleteness: score.completeness,
        scoreReputation: score.reputation,
        scoreContent: score.content,
        scoreLocalConsistency: score.localConsistency,
        scoreVisibility: score.visibility,
        scoreSuspensionRisk: score.suspensionRisk,
        scoreUserExperience: score.userExperience,
      })
      .where(eq(gbpAudits.id, audit.id));

    // A couple of evidence rows + correction tasks on the first two critical/important findings.
    const notable = insertedFindings.filter((f) => f.severity === "critical" || f.severity === "important").slice(0, 2);
    for (const finding of notable) {
      await auditDb.insert(gbpAuditEvidence).values({
        findingId: finding.id,
        kind: "screenshot",
        fileName: "demo-capture.png",
        mimeType: "image/png",
        sizeBytes: Buffer.from(TINY_PNG_BASE64, "base64").length,
        contentBase64: TINY_PNG_BASE64,
        note: "[DÉMO] Capture d'écran de démonstration.",
      });
      await auditDb.insert(gbpCorrectionTasks).values({
        auditId: audit.id,
        findingId: finding.id,
        phase: finding.severity === "critical" ? 1 : 2,
        title: `[DÉMO] Corriger : ${CHECK_LABEL[`${finding.sectionCode}:${finding.checkKey}`] ?? "contrôle non conforme"}`,
        priority: finding.severity,
        ownerName: scenario.prospect.ownerName,
        etaDays: finding.severity === "critical" ? 2 : 7,
      });
    }

    // One growth-phase task regardless.
    await auditDb.insert(gbpCorrectionTasks).values({
      auditId: audit.id,
      phase: 3,
      title: "[DÉMO] Mettre en place un calendrier de publications mensuel",
      priority: "opportunity",
      ownerName: scenario.prospect.ownerName,
      etaDays: 30,
    });

    await auditDb.insert(gbpCompetitors).values([
      { auditId: audit.id, name: "[DÉMO] Concurrent A", rating: 430, reviewCount: 87, photoCount: 24, postsRecent: true, notes: "[DÉMO] Répond systématiquement aux avis." },
      { auditId: audit.id, name: "[DÉMO] Concurrent B", rating: 390, reviewCount: 34, photoCount: 8, postsRecent: false, notes: "[DÉMO] Profil peu actif." },
    ]);
  }

  if (scenario.approved || scenario.status === "sent") {
    const [report] = await auditDb.insert(gbpAuditReports).values({ auditId: audit.id, clientSummary: "[DÉMO] Votre profil est globalement bien tenu, avec quelques points de propriété et de réputation à corriger en priorité." }).returning();
    const [link] = await auditDb.insert(gbpReportAccessLinks).values({ reportId: report.id, token: `demo-${audit.id.slice(0, 8)}`, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }).returning();
    console.log(`  → portail client : /audit-report/${link.token}`);
  }

  console.log(`✓ ${scenario.business.legalName} (statut: ${scenario.status}, ${insertedFindings.length} contrôles)`);
}

async function main() {
  console.log("Seed de démonstration — PUBLIC-MAP Audit (base locale uniquement)\n");
  await ensureRoles();
  await ensureServiceOffers();
  await ensureEmailTemplates();
  for (const scenario of SCENARIOS) {
    await seedScenario(scenario);
  }
  console.log("\nTerminé.");
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Échec du seed:", err);
  process.exit(1);
});
