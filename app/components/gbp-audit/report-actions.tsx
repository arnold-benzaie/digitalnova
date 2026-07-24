"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAudit, markAuditSent, requestAuditChanges, submitAuditForReview } from "@/lib/actions/gbp-audit-report";
import type { AuditStaffRole } from "@/lib/gbp-audit/session";
import { Field, Textarea } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";

export function ReportActions({ auditId, status, role, clientSummary }: { auditId: string; status: string; role: AuditStaffRole; clientSummary: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [summary, setSummary] = useState(clientSummary);
  const [note, setNote] = useState("");

  const isSupervisor = role === "admin" || role === "supervisor";

  function run(fn: () => Promise<void>, successMessage: string) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(successMessage);
        router.refresh();
      } catch (err) {
        toast.error("L'action a échoué", err instanceof Error ? err.message : undefined);
      }
    });
  }

  return (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
      <h2 className="font-serif text-lg font-semibold text-pm-noir">Validation du rapport</h2>

      {status === "not_started" || status === "in_progress" ? (
        <div className="mt-4">
          <p className="text-sm text-pm-gris">L&rsquo;audit est encore en cours. Soumettez-le pour validation lorsqu&rsquo;il est complet.</p>
          <Button className="mt-3" loading={isPending} onClick={() => run(() => submitAuditForReview(auditId), "Audit soumis pour validation")}>
            Soumettre pour validation
          </Button>
        </div>
      ) : status === "pending_review" ? (
        isSupervisor ? (
          <div className="mt-4 flex flex-col gap-4">
            <Field label="Résumé pour le client" htmlFor="client-summary">
              <Textarea id="client-summary" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
            </Field>
            <Button loading={isPending} disabled={!summary.trim()} onClick={() => run(() => approveAudit(auditId, summary), "Rapport approuvé")} className="w-fit">
              Approuver le rapport
            </Button>
            <Field label="Motif de refus" hint="si des corrections sont demandées" htmlFor="change-note">
              <Textarea id="change-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button
              variant="secondary"
              loading={isPending}
              disabled={!note.trim()}
              onClick={() => run(() => requestAuditChanges(auditId, note), "Corrections demandées à l'agent")}
              className="w-fit"
            >
              Demander des corrections
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-pm-gris">En attente de validation par un superviseur ou un administrateur.</p>
        )
      ) : status === "changes_requested" ? (
        <div className="mt-4">
          <p className="text-sm text-pm-gris">Des corrections ont été demandées. Retournez aux contrôles, corrigez, puis resoumettez.</p>
          <Button className="mt-3" loading={isPending} onClick={() => run(() => submitAuditForReview(auditId), "Audit resoumis pour validation")}>
            Resoumettre pour validation
          </Button>
        </div>
      ) : status === "approved" ? (
        <div className="mt-4">
          <p className="text-sm text-pm-gris">Le rapport est approuvé. Générez le lien sécurisé ci-dessous, envoyez-le au prospect, puis marquez l&rsquo;audit comme envoyé.</p>
          <Button className="mt-3" loading={isPending} onClick={() => run(() => markAuditSent(auditId), "Audit marqué comme envoyé")}>
            Marquer comme envoyé
          </Button>
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-1.5 text-sm font-medium text-emerald-600">
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 111.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
          Rapport envoyé au prospect.
        </p>
      )}
    </div>
  );
}
