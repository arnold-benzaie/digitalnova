import Link from "next/link";
import { getAuditStatusLabel, getSubscoreLabel, scoreBand, SUBSCORE_LABEL } from "@/lib/gbp-audit/checklist";
import { AuditStatusControl } from "@/components/gbp-audit/audit-status-control";
import { ProfileStatusControl } from "@/components/gbp-audit/profile-status-control";
import { ScoreRing } from "@/components/gbp-audit/ui/score-ring";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { AdminPageHero, HeroControlChip } from "@/components/admin/page-hero";

export type AuditDetailBusiness = {
  id: string;
  legalName: string;
  googleDisplayName: string | null;
  industry: string | null;
  primaryCategory: string | null;
  profileStatus: string;
  address: string | null;
  serviceArea: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  websiteUrl: string | null;
  googleProfileUrl: string | null;
  googleMapsUrl: string | null;
  locationCount: number;
};

export type AuditDetailProspect = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  preferredLanguage: string;
  country: string | null;
  source: string | null;
  notes: string | null;
};

export type AuditDetailAudit = {
  id: string;
  status: string;
  scoreOverall: number | null;
  scoreCompliance: number | null;
  scoreCompleteness: number | null;
  scoreReputation: number | null;
  scoreContent: number | null;
  scoreLocalConsistency: number | null;
  scoreVisibility: number | null;
  scoreSuspensionRisk: number | null;
  scoreUserExperience: number | null;
  assignedAgentName: string | null;
};

const SUBSCORE_FIELD_MAP: Record<keyof typeof SUBSCORE_LABEL, keyof AuditDetailAudit> = {
  compliance: "scoreCompliance",
  completeness: "scoreCompleteness",
  reputation: "scoreReputation",
  content: "scoreContent",
  localConsistency: "scoreLocalConsistency",
  visibility: "scoreVisibility",
  suspensionRisk: "scoreSuspensionRisk",
  userExperience: "scoreUserExperience",
};

/** Pure presentational view — see audit-dashboard-view.tsx for why. */
export function AuditDetailView({
  audit,
  business,
  prospect,
  locale = "fr",
}: {
  audit: AuditDetailAudit;
  business: AuditDetailBusiness;
  prospect: AuditDetailProspect;
  locale?: Locale;
}) {
  const t = dictionaries[locale].auditModule.overview;
  const statusLabel = getAuditStatusLabel(locale);
  const subscoreLabel = getSubscoreLabel(locale);
  const band = audit.scoreOverall !== null ? scoreBand(audit.scoreOverall, locale) : null;

  return (
    <>
      <AdminPageHero
        eyebrow={t.kicker}
        title={business.legalName}
        subtitle={`${prospect.firstName} ${prospect.lastName} · ${prospect.email ?? t.emailMissing}`}
        actions={
          <HeroControlChip>
            <AuditStatusControl auditId={audit.id} status={audit.status} locale={locale} />
          </HeroControlChip>
        }
      />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5 lg:col-span-2">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.businessTitle}</h2>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Field label={t.businessFields.googleDisplayName} value={business.googleDisplayName} />
            <Field label={t.businessFields.industry} value={business.industry} />
            <Field label={t.businessFields.primaryCategory} value={business.primaryCategory} />
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.businessFields.profileStatus}</dt>
              <dd className="mt-0.5">
                <ProfileStatusControl auditId={audit.id} businessId={business.id} status={business.profileStatus} locale={locale} />
              </dd>
            </div>
            <Field label={t.businessFields.address} value={business.address} />
            <Field label={t.businessFields.serviceArea} value={business.serviceArea} />
            <Field label={t.businessFields.city} value={business.city} />
            <Field label={t.businessFields.country} value={business.country} />
            <Field label={t.businessFields.phone} value={business.phone} />
            <Field label={t.businessFields.websiteUrl} value={business.websiteUrl} />
            <Field label={t.businessFields.googleProfileUrl} value={business.googleProfileUrl} />
            <Field label={t.businessFields.googleMapsUrl} value={business.googleMapsUrl} />
            <Field label={t.businessFields.locationCount} value={String(business.locationCount)} />
          </dl>
        </div>

        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.prospectTitle}</h2>
          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <Field label={t.prospectFields.phone} value={prospect.phone} />
            <Field label={t.prospectFields.whatsapp} value={prospect.whatsapp} />
            <Field label={t.prospectFields.language} value={prospect.preferredLanguage === "en" ? t.languageEn : t.languageFr} />
            <Field label={t.prospectFields.country} value={prospect.country} />
            <Field label={t.prospectFields.source} value={prospect.source} />
            <Field label={t.prospectFields.ownerName} value={audit.assignedAgentName} />
          </dl>
          {prospect.notes && (
            <>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-pm-gris">{t.internalNotes}</p>
              <p className="mt-1 text-sm text-pm-noir">{prospect.notes}</p>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.globalScore}</h2>
          <span className="text-xs text-pm-gris">{t.statusPrefix}{statusLabel[audit.status] ?? t.statusFallback}</span>
        </div>
        {audit.scoreOverall === null ? (
          <p className="mt-2 text-lg font-medium text-pm-gris">{t.scoreNotComputed}</p>
        ) : (
          <div className="mt-3 flex items-center gap-4">
            <ScoreRing score={audit.scoreOverall} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-pm-gris">{audit.scoreOverall} / 100</p>
              {band && <p className="mt-0.5 text-sm font-medium text-pm-noir">{band.label} — {band.description}</p>}
            </div>
          </div>
        )}
        <p className="mt-1 text-xs text-pm-gris">{t.scoreDisclaimer}</p>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(Object.keys(SUBSCORE_LABEL) as (keyof typeof SUBSCORE_LABEL)[]).map((key) => {
            const value = audit[SUBSCORE_FIELD_MAP[key]] as number | null;
            return (
              <div key={key}>
                <p className="text-xs text-pm-gris">{subscoreLabel[key]}</p>
                <p className="mt-0.5 text-lg font-semibold text-pm-noir">{value ?? "—"}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between rounded-2xl border border-pm-gris-2 bg-white p-5">
        <div>
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.controlsTitle}</h2>
          <p className="mt-1 text-sm text-pm-gris">{t.controlsLead}</p>
        </div>
        <Link
          href={`/admin/audit/${audit.id}/audit`}
          className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
        >
          {t.openControls}
        </Link>
      </div>
    </>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">{label}</dt>
      <dd className="mt-0.5 text-pm-noir">{value || "—"}</dd>
    </div>
  );
}
