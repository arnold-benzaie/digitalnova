"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { updateQuoteRequestStatus } from "@/lib/actions/gbp-audit-quotes";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { Badge } from "@/components/crm/badges";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { toast } from "@/components/gbp-audit/ui/toast";

const STATUS_OPTIONS = [
  { value: "new", label: "Nouveau" },
  { value: "contacted", label: "Contacté" },
  { value: "won", label: "Converti" },
  { value: "lost", label: "Perdu" },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));
const STATUS_CLASS: Record<string, string> = {
  new: "bg-pm-or/10 text-pm-or-2",
  contacted: "bg-pm-gris-2/60 text-pm-gris",
  won: "bg-pm-g-green/10 text-pm-g-green",
  lost: "bg-pm-rouge/10 text-pm-rouge-2",
};

type QuoteRequest = {
  id: string;
  auditId: string;
  businessName: string;
  offerLabel: string | null;
  message: string | null;
  status: string;
  createdAt: string;
};

export function QuoteRequestInbox({ requests }: { requests: QuoteRequest[] }) {
  const [statusFilter, setStatusFilter] = useState<"all" | string>("all");

  const filtered = useMemo(
    () => (statusFilter === "all" ? requests : requests.filter((r) => r.status === statusFilter)),
    [requests, statusFilter],
  );

  const newCount = requests.filter((r) => r.status === "new").length;

  return (
    <>
      <div>
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">Demandes de devis</h1>
        <p className="mt-1 text-sm text-pm-gris">
          {requests.length} demande(s) au total · {newCount} nouvelle(s)
        </p>
      </div>

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Filtrer par statut">
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          aria-pressed={statusFilter === "all"}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${statusFilter === "all" ? "bg-pm-noir text-white" : "bg-pm-gris-2/50 text-pm-gris hover:bg-pm-gris-2"}`}
        >
          Toutes
        </button>
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setStatusFilter(o.value)}
            aria-pressed={statusFilter === o.value}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${statusFilter === o.value ? "bg-pm-noir text-white" : "bg-pm-gris-2/50 text-pm-gris hover:bg-pm-gris-2"}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M4 6h16v12H4z" /><path d="M4 6l8 7 8-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            }
            title={requests.length === 0 ? "Aucune demande de devis pour le moment" : "Aucun résultat"}
            description={requests.length === 0 ? "Les demandes soumises depuis le portail client apparaîtront ici." : "Essayez un autre filtre."}
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {filtered.map((r) => (
            <div key={r.id} className="rounded-xl border border-pm-gris-2 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/admin/audit/${r.auditId}`} className="font-medium text-pm-noir underline-offset-2 hover:underline">
                    {r.businessName}
                  </Link>
                  {r.offerLabel && <p className="mt-0.5 text-xs text-pm-gris">Offre : {r.offerLabel}</p>}
                  {r.message && <p className="mt-2 text-sm text-pm-noir">{r.message}</p>}
                  <p className="mt-2 text-[10px] text-pm-gris">Reçue le {new Date(r.createdAt).toLocaleDateString("fr-FR")}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge label={STATUS_LABEL[r.status] ?? "Demande"} className={STATUS_CLASS[r.status] ?? ""} />
                  <InlineStatusSelect
                    value={r.status}
                    options={STATUS_OPTIONS}
                    action={async (status) => {
                      try {
                        await updateQuoteRequestStatus(r.id, status);
                        toast.success("Statut mis à jour");
                      } catch (err) {
                        toast.error("Impossible de mettre à jour", err instanceof Error ? err.message : undefined);
                      }
                    }}
                    className="rounded-lg border border-pm-gris-2 bg-white px-2 py-1 text-xs text-pm-noir"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
