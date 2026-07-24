import Link from "next/link";
import { GBP_AUDIT_STATUS_LABEL, SUBSCORE_LABEL, scoreBand } from "@/lib/gbp-audit/checklist";
import { AuditStatusControl } from "@/components/gbp-audit/audit-status-control";
import { ProfileStatusControl } from "@/components/gbp-audit/profile-status-control";

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
}: {
  audit: AuditDetailAudit;
  business: AuditDetailBusiness;
  prospect: AuditDetailProspect;
}) {
  const band = audit.scoreOverall !== null ? scoreBand(audit.scoreOverall) : null;

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-pm-gris">Audit Google Business Profile</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold text-pm-noir">{business.legalName}</h1>
          <p className="mt-1 text-sm text-pm-gris">
            {prospect.firstName} {prospect.lastName} · {prospect.email ?? "email non renseigné"}
          </p>
        </div>
        <AuditStatusControl auditId={audit.id} status={audit.status} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5 lg:col-span-2">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Entreprise</h2>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Field label="Nom affiché sur Google" value={business.googleDisplayName} />
            <Field label="Secteur" value={business.industry} />
            <Field label="Catégorie principale" value={business.primaryCategory} />
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">Statut du profil</dt>
              <dd className="mt-0.5">
                <ProfileStatusControl auditId={audit.id} businessId={business.id} status={business.profileStatus} />
              </dd>
            </div>
            <Field label="Adresse" value={business.address} />
            <Field label="Zone desservie" value={business.serviceArea} />
            <Field label="Ville" value={business.city} />
            <Field label="Pays" value={business.country} />
            <Field label="Téléphone" value={business.phone} />
            <Field label="Site web" value={business.websiteUrl} />
            <Field label="Profil Google" value={business.googleProfileUrl} />
            <Field label="Google Maps" value={business.googleMapsUrl} />
            <Field label="Points de vente" value={String(business.locationCount)} />
          </dl>
        </div>

        <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Prospect</h2>
          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <Field label="Téléphone" value={prospect.phone} />
            <Field label="WhatsApp" value={prospect.whatsapp} />
            <Field label="Langue" value={prospect.preferredLanguage === "en" ? "Anglais" : "Français"} />
            <Field label="Pays" value={prospect.country} />
            <Field label="Source" value={prospect.source} />
            <Field label="Agent responsable" value={audit.assignedAgentName} />
          </dl>
          {prospect.notes && (
            <>
              <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-pm-gris">Notes internes</p>
              <p className="mt-1 text-sm text-pm-noir">{prospect.notes}</p>
            </>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Score global</h2>
          <span className="text-xs text-pm-gris">Statut : {GBP_AUDIT_STATUS_LABEL[audit.status] ?? "Audit"}</span>
        </div>
        {audit.scoreOverall === null ? (
          <p className="mt-2 text-lg font-medium text-pm-gris">Pas encore calculé</p>
        ) : (
          <>
            <p className="mt-2 text-3xl font-semibold text-pm-noir">{audit.scoreOverall} / 100</p>
            {band && <p className="mt-1 text-sm font-medium text-pm-noir">{band.label} — {band.description}</p>}
          </>
        )}
        <p className="mt-1 text-xs text-pm-gris">
          Indicateur interne d&rsquo;audit PUBLIC-MAP — pas une note officielle de Google.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(Object.keys(SUBSCORE_LABEL) as (keyof typeof SUBSCORE_LABEL)[]).map((key) => {
            const value = audit[SUBSCORE_FIELD_MAP[key]] as number | null;
            return (
              <div key={key}>
                <p className="text-xs text-pm-gris">{SUBSCORE_LABEL[key]}</p>
                <p className="mt-0.5 text-lg font-semibold text-pm-noir">{value ?? "—"}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between rounded-2xl border border-pm-gris-2 bg-white p-5">
        <div>
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Contrôles d&rsquo;audit</h2>
          <p className="mt-1 text-sm text-pm-gris">19 catégories, préuves et recommandations par contrôle.</p>
        </div>
        <Link
          href={`/admin/audit/${audit.id}/audit`}
          className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
        >
          Ouvrir les contrôles
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
