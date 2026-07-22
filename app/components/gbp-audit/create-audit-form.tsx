"use client";

import { useTransition } from "react";
import { createProspectBusinessAndAudit } from "@/lib/actions/gbp-audit";
import { GBP_PROFILE_STATUS_OPTIONS } from "@/lib/gbp-audit/checklist";
import { Field, Input, Select, Textarea } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";

export function CreateAuditForm() {
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="mt-6 flex flex-col gap-8"
      action={(formData) =>
        startTransition(async () => {
          try {
            await createProspectBusinessAndAudit(formData);
          } catch (err) {
            // A successful call redirect()s and never reaches here (Next throws a
            // control-flow signal for that, not a real error) — this only fires
            // for genuine validation/DB failures.
            toast.error("Impossible de créer l'audit", err instanceof Error ? err.message : undefined);
          }
        })
      }
    >
      <fieldset className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <legend className="px-2 font-serif text-lg font-semibold text-pm-noir">Prospect</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Prénom" required htmlFor="firstName">
            <Input id="firstName" name="firstName" required />
          </Field>
          <Field label="Nom" required htmlFor="lastName">
            <Input id="lastName" name="lastName" required />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" />
          </Field>
          <Field label="Téléphone" htmlFor="phone">
            <Input id="phone" name="phone" />
          </Field>
          <Field label="Numéro WhatsApp" htmlFor="whatsapp">
            <Input id="whatsapp" name="whatsapp" />
          </Field>
          <Field label="Langue préférée" htmlFor="preferredLanguage">
            <Select id="preferredLanguage" name="preferredLanguage" defaultValue="fr">
              <option value="fr">Français</option>
              <option value="en">Anglais</option>
            </Select>
          </Field>
          <Field label="Pays" htmlFor="prospectCountry">
            <Input id="prospectCountry" name="prospectCountry" />
          </Field>
          <Field label="Fuseau horaire" hint="ex. Indian/Mauritius" htmlFor="timezone">
            <Input id="timezone" name="timezone" />
          </Field>
          <Field label="Source" hint="site web, recommandation..." htmlFor="source">
            <Input id="source" name="source" />
          </Field>
          <Field label="Agent responsable" htmlFor="ownerName">
            <Input id="ownerName" name="ownerName" />
          </Field>
          <Field label="Notes internes" className="sm:col-span-2" htmlFor="notes">
            <Textarea id="notes" name="notes" rows={2} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <legend className="px-2 font-serif text-lg font-semibold text-pm-noir">Entreprise</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nom officiel de l'entreprise" required htmlFor="legalName">
            <Input id="legalName" name="legalName" required />
          </Field>
          <Field label="Nom affiché sur Google" htmlFor="googleDisplayName">
            <Input id="googleDisplayName" name="googleDisplayName" />
          </Field>
          <Field label="Secteur d'activité" htmlFor="industry">
            <Input id="industry" name="industry" />
          </Field>
          <Field label="Catégorie principale" htmlFor="primaryCategory">
            <Input id="primaryCategory" name="primaryCategory" />
          </Field>
          <Field label="Adresse" className="sm:col-span-2" htmlFor="address">
            <Input id="address" name="address" />
          </Field>
          <Field label="Zone desservie" htmlFor="serviceArea">
            <Input id="serviceArea" name="serviceArea" />
          </Field>
          <Field label="Ville" htmlFor="city">
            <Input id="city" name="city" />
          </Field>
          <Field label="Région" htmlFor="region">
            <Input id="region" name="region" />
          </Field>
          <Field label="Pays" htmlFor="businessCountry">
            <Input id="businessCountry" name="businessCountry" />
          </Field>
          <Field label="Téléphone de l'entreprise" htmlFor="businessPhone">
            <Input id="businessPhone" name="businessPhone" />
          </Field>
          <Field label="Site web" htmlFor="websiteUrl">
            <Input id="websiteUrl" name="websiteUrl" type="url" />
          </Field>
          <Field label="URL du profil Google" htmlFor="googleProfileUrl">
            <Input id="googleProfileUrl" name="googleProfileUrl" type="url" />
          </Field>
          <Field label="URL Google Maps" htmlFor="googleMapsUrl">
            <Input id="googleMapsUrl" name="googleMapsUrl" type="url" />
          </Field>
          <Field label="Identifiant de l'établissement" hint="Place ID" htmlFor="googlePlaceId">
            <Input id="googlePlaceId" name="googlePlaceId" />
          </Field>
          <Field label="Nombre de points de vente" htmlFor="locationCount">
            <Input id="locationCount" name="locationCount" type="number" min={1} defaultValue={1} />
          </Field>
          <Field label="Statut du profil" htmlFor="profileStatus">
            <Select id="profileStatus" name="profileStatus" defaultValue="unknown">
              {GBP_PROFILE_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </fieldset>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={isPending}>
          Créer le prospect et démarrer l&rsquo;audit
        </Button>
      </div>
    </form>
  );
}
