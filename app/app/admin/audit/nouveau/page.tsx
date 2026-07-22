import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { CreateAuditForm } from "@/components/gbp-audit/create-audit-form";

export default async function NewAuditPage() {
  await requireAuditStaffRole();

  return (
    <>
      <div>
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">Nouvel audit Google Business Profile</h1>
        <p className="mt-1 text-sm text-pm-gris">
          Identifiez le prospect et son entreprise. L&rsquo;audit détaillé (19 catégories de contrôle) s&rsquo;ouvre
          juste après la création.
        </p>
      </div>
      <CreateAuditForm />
    </>
  );
}
