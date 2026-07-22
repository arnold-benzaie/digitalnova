"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createServiceOffer, deleteServiceOffer, toggleServiceOfferActive, updateServiceOffer } from "@/lib/actions/gbp-audit-offers";
import { Field, Input, Textarea } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { Badge } from "@/components/crm/badges";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { useConfirmDialog } from "@/components/gbp-audit/ui/use-confirm-dialog";
import { toast } from "@/components/gbp-audit/ui/toast";

type Offer = { id: string; key: string; label: string; description: string | null; ctaUrl: string | null; active: boolean; createdAt: string };

export function ServiceOfferManagement({ offers }: { offers: Offer[] }) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-3xl font-semibold text-pm-noir">Offres de service</h1>
          <p className="mt-1 text-sm text-pm-gris">{offers.length} offre(s) · affichées dans les rapports et le portail client si actives</p>
        </div>
        <Button type="button" onClick={() => setCreating((c) => !c)}>
          {creating ? "Fermer" : "+ Nouvelle offre"}
        </Button>
      </div>

      {creating && <OfferForm onDone={() => setCreating(false)} />}

      {offers.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" strokeLinejoin="round" />
              </svg>
            }
            title="Aucune offre pour le moment"
            description="Créez votre catalogue d'offres — elles pourront être recommandées dans les plans de correction et les rapports."
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {offers.map((o) => (
            <OfferRow key={o.id} offer={o} />
          ))}
        </div>
      )}
    </>
  );
}

function OfferForm({ offer, onDone }: { offer?: Offer; onDone: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Controlled, not defaultValue — React resets uncontrolled fields as soon
  // as the form's action prop returns (immediately here, since the real
  // work runs in startTransition below), which would wipe what the user
  // typed the moment a server validation error comes back.
  const [label, setLabel] = useState(offer?.label ?? "");
  const [description, setDescription] = useState(offer?.description ?? "");
  const [ctaUrl, setCtaUrl] = useState(offer?.ctaUrl ?? "");

  return (
    <form
      className="mt-4 flex flex-col gap-4 rounded-2xl border border-pm-gris-2 bg-white p-5"
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          try {
            if (offer) await updateServiceOffer(offer.id, formData);
            else await createServiceOffer(formData);
            toast.success(offer ? "Offre mise à jour" : "Offre créée");
            onDone();
            router.refresh();
          } catch (err) {
            const message = err instanceof Error ? err.message : "Une erreur est survenue.";
            setError(message);
            toast.error("Échec de l'enregistrement", message);
          }
        })
      }
    >
      <Field label="Nom de l'offre" required htmlFor="offer-label">
        <Input id="offer-label" name="label" value={label} onChange={(e) => setLabel(e.target.value)} required placeholder="Ex. Optimisation mensuelle GBP" />
      </Field>
      <Field label="Description" htmlFor="offer-description">
        <Textarea id="offer-description" name="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </Field>
      <Field label="Lien (CTA)" htmlFor="offer-cta" hint="URL vers la page de présentation ou de commande de cette offre">
        <Input id="offer-cta" name="ctaUrl" type="url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="https://…" />
      </Field>
      {error && <p role="alert" className="text-sm text-pm-rouge">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onDone} disabled={isPending}>
          Annuler
        </Button>
        <Button type="submit" loading={isPending}>
          {offer ? "Enregistrer" : "Créer l'offre"}
        </Button>
      </div>
    </form>
  );
}

function OfferRow({ offer }: { offer: Offer }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { confirm, dialog } = useConfirmDialog();

  if (editing) return <OfferForm offer={offer} onDone={() => setEditing(false)} />;

  return (
    <div className="rounded-xl border border-pm-gris-2 bg-white p-4">
      {dialog}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-pm-noir">{offer.label}</p>
            <Badge label={offer.active ? "Active" : "Désactivée"} className={offer.active ? "bg-pm-g-green/10 text-pm-g-green" : "bg-pm-gris-2/60 text-pm-gris"} />
          </div>
          {offer.description && <p className="mt-1 text-sm text-pm-gris">{offer.description}</p>}
          {offer.ctaUrl && (
            <a href={offer.ctaUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-pm-noir underline underline-offset-2">
              {offer.ctaUrl}
            </a>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await toggleServiceOfferActive(offer.id, !offer.active);
                  toast.success(offer.active ? "Offre désactivée" : "Offre activée");
                  router.refresh();
                } catch (err) {
                  toast.error("Échec", err instanceof Error ? err.message : undefined);
                }
              })
            }
          >
            {offer.active ? "Désactiver" : "Activer"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Modifier
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={isPending}
            onClick={async () => {
              const ok = await confirm({ title: "Supprimer cette offre ?", description: `"${offer.label}" sera définitivement supprimée.`, confirmLabel: "Supprimer" });
              if (!ok) return;
              startTransition(async () => {
                try {
                  await deleteServiceOffer(offer.id);
                  toast.success("Offre supprimée");
                  router.refresh();
                } catch (err) {
                  toast.error("Échec de la suppression", err instanceof Error ? err.message : undefined);
                }
              });
            }}
          >
            Supprimer
          </Button>
        </div>
      </div>
    </div>
  );
}
