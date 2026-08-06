"use client";

import { useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import { createProspectBusinessAndAudit } from "@/lib/actions/gbp-audit";
import { getProfileStatusOptions } from "@/lib/gbp-audit/checklist";
import { Field, Input, Select, Textarea } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { panelClass, panelTitleClass } from "@/components/admin/page-hero";

export function CreateAuditForm({ locale = "fr" }: { locale?: Locale }) {
  const t = dictionaries[locale].auditModule.createAudit;
  const profileStatusOptions = getProfileStatusOptions(locale);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="mt-6 flex flex-col gap-8"
      action={(formData) =>
        startTransition(async () => {
          try {
            await createProspectBusinessAndAudit(formData);
          } catch (err) {
            // redirect() throws a Next.js control-flow signal, not a real error —
            // but because this action is invoked through a manual try/catch
            // (rather than passed directly as the form's `action`), that signal
            // lands here like any other thrown error and must be re-thrown so
            // Next.js can still perform the navigation. See unstable_rethrow's
            // docs: "Only use ... if your caught exceptions may include both
            // application errors and framework-controlled exceptions."
            unstable_rethrow(err);
            toast.error(t.createError, err instanceof Error ? err.message : undefined);
          }
        })
      }
    >
      <fieldset className={panelClass}>
        <legend className={`px-2 ${panelTitleClass}`}>{t.prospectLegend}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t.fields.firstName} required htmlFor="firstName">
            <Input id="firstName" name="firstName" required />
          </Field>
          <Field label={t.fields.lastName} required htmlFor="lastName">
            <Input id="lastName" name="lastName" required />
          </Field>
          <Field label={t.fields.email} htmlFor="email">
            <Input id="email" name="email" type="email" />
          </Field>
          <Field label={t.fields.phone} htmlFor="phone">
            <Input id="phone" name="phone" />
          </Field>
          <Field label={t.fields.whatsapp} htmlFor="whatsapp">
            <Input id="whatsapp" name="whatsapp" />
          </Field>
          <Field label={t.fields.preferredLanguage} htmlFor="preferredLanguage">
            <Select id="preferredLanguage" name="preferredLanguage" defaultValue="fr">
              <option value="fr">{t.fields.languageFr}</option>
              <option value="en">{t.fields.languageEn}</option>
            </Select>
          </Field>
          <Field label={t.fields.prospectCountry} htmlFor="prospectCountry">
            <Input id="prospectCountry" name="prospectCountry" />
          </Field>
          <Field label={t.fields.timezone} hint={t.fields.timezoneHint} htmlFor="timezone">
            <Input id="timezone" name="timezone" />
          </Field>
          <Field label={t.fields.source} hint={t.fields.sourceHint} htmlFor="source">
            <Input id="source" name="source" />
          </Field>
          <Field label={t.fields.ownerName} htmlFor="ownerName">
            <Input id="ownerName" name="ownerName" />
          </Field>
          <Field label={t.fields.notes} className="sm:col-span-2" htmlFor="notes">
            <Textarea id="notes" name="notes" rows={2} />
          </Field>
        </div>
      </fieldset>

      <fieldset className={panelClass}>
        <legend className={`px-2 ${panelTitleClass}`}>{t.businessLegend}</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t.fields.legalName} required htmlFor="legalName">
            <Input id="legalName" name="legalName" required />
          </Field>
          <Field label={t.fields.googleDisplayName} htmlFor="googleDisplayName">
            <Input id="googleDisplayName" name="googleDisplayName" />
          </Field>
          <Field label={t.fields.industry} htmlFor="industry">
            <Input id="industry" name="industry" />
          </Field>
          <Field label={t.fields.primaryCategory} htmlFor="primaryCategory">
            <Input id="primaryCategory" name="primaryCategory" />
          </Field>
          <Field label={t.fields.address} className="sm:col-span-2" htmlFor="address">
            <Input id="address" name="address" />
          </Field>
          <Field label={t.fields.serviceArea} htmlFor="serviceArea">
            <Input id="serviceArea" name="serviceArea" />
          </Field>
          <Field label={t.fields.city} htmlFor="city">
            <Input id="city" name="city" />
          </Field>
          <Field label={t.fields.region} htmlFor="region">
            <Input id="region" name="region" />
          </Field>
          <Field label={t.fields.businessCountry} htmlFor="businessCountry">
            <Input id="businessCountry" name="businessCountry" />
          </Field>
          <Field label={t.fields.businessPhone} htmlFor="businessPhone">
            <Input id="businessPhone" name="businessPhone" />
          </Field>
          <Field label={t.fields.websiteUrl} htmlFor="websiteUrl">
            <Input id="websiteUrl" name="websiteUrl" type="url" />
          </Field>
          <Field label={t.fields.googleProfileUrl} htmlFor="googleProfileUrl">
            <Input id="googleProfileUrl" name="googleProfileUrl" type="url" />
          </Field>
          <Field label={t.fields.googleMapsUrl} htmlFor="googleMapsUrl">
            <Input id="googleMapsUrl" name="googleMapsUrl" type="url" />
          </Field>
          <Field label={t.fields.googlePlaceId} hint={t.fields.googlePlaceIdHint} htmlFor="googlePlaceId">
            <Input id="googlePlaceId" name="googlePlaceId" />
          </Field>
          <Field label={t.fields.locationCount} htmlFor="locationCount">
            <Input id="locationCount" name="locationCount" type="number" min={1} defaultValue={1} />
          </Field>
          <Field label={t.fields.profileStatus} htmlFor="profileStatus">
            <Select id="profileStatus" name="profileStatus" defaultValue="unknown">
              {profileStatusOptions.map((option) => (
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
          {t.submit}
        </Button>
      </div>
    </form>
  );
}
