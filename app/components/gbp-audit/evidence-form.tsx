"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { addEvidenceFile } from "@/lib/actions/gbp-audit-evidence";
import { Field, Input, Select, Textarea } from "@/components/gbp-audit/ui/field";
import { Button } from "@/components/gbp-audit/ui/button";
import { toast } from "@/components/gbp-audit/ui/toast";

const EMPTY_FIELDS = { findingId: "", kind: "screenshot", url: "", note: "" };

export function EvidenceForm({ findings }: { findings: { id: string; label: string }[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  // Controlled, and submitted by building FormData from this state directly
  // (not the native form's own field values) — addEvidenceFile round-trips
  // through Storage and can take a couple of seconds, and relying on
  // <form action> to re-read DOM fields at submit time proved to race with
  // that: a second entry started before the first's response lands could
  // submit stale values. Building the payload from state we already trust
  // sidesteps that entirely.
  const [fields, setFields] = useState({ ...EMPTY_FIELDS, findingId: findings[0]?.id ?? "" });
  const submittedFieldsRef = useRef(fields);
  const [isPending, startTransition] = useTransition();

  function setField<K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = fields;
    submittedFieldsRef.current = submitted;
    const formData = new FormData();
    formData.set("findingId", submitted.findingId);
    formData.set("kind", submitted.kind);
    if (submitted.kind === "link") formData.set("url", submitted.url);
    if (submitted.kind === "note" || submitted.note) formData.set("note", submitted.note);
    const file = fileRef.current?.files?.[0];
    if (file && (submitted.kind === "screenshot" || submitted.kind === "photo" || submitted.kind === "pdf")) {
      formData.set("file", file);
    }
    startTransition(async () => {
      try {
        await addEvidenceFile(formData);
        toast.success("Preuve ajoutée");
        setFields((current) => {
          if (current !== submittedFieldsRef.current) return current;
          if (fileRef.current) fileRef.current.value = "";
          return { ...EMPTY_FIELDS, findingId: findings[0]?.id ?? "" };
        });
        router.refresh();
      } catch (err) {
        toast.error("Impossible d'ajouter cette preuve", err instanceof Error ? err.message : undefined);
      }
    });
  }

  return (
    <form className="grid grid-cols-1 gap-4 rounded-2xl border border-pm-gris-2 bg-white p-5 sm:grid-cols-2" onSubmit={handleSubmit}>
      <Field label="Contrôle concerné" required className="sm:col-span-2" htmlFor="findingId">
        <Select
          id="findingId"
          name="findingId"
          required
          disabled={findings.length === 0}
          value={fields.findingId}
          onChange={(e) => setField("findingId", e.target.value)}
        >
          {findings.length === 0 && <option value="">Aucun contrôle renseigné pour l&rsquo;instant</option>}
          {findings.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </Select>
      </Field>

      <Field label="Type de preuve" htmlFor="kind">
        <Select id="kind" name="kind" value={fields.kind} onChange={(e) => setField("kind", e.target.value)}>
          <option value="screenshot">Capture d&rsquo;écran</option>
          <option value="photo">Photo</option>
          <option value="pdf">PDF</option>
          <option value="link">Lien</option>
          <option value="note">Note</option>
        </Select>
      </Field>

      {(fields.kind === "screenshot" || fields.kind === "photo" || fields.kind === "pdf") && (
        <Field label="Fichier" hint="PNG, JPEG, WEBP ou PDF — 8 Mo max" htmlFor="file">
          <input
            ref={fileRef}
            id="file"
            type="file"
            name="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir file:mr-3 file:rounded-md file:border-0 file:bg-pm-gris-2/50 file:px-3 file:py-1 file:text-xs file:font-medium file:text-pm-noir"
          />
        </Field>
      )}
      {fields.kind === "link" && (
        <Field label="URL" htmlFor="url">
          <Input id="url" type="url" name="url" placeholder="https://..." value={fields.url} onChange={(e) => setField("url", e.target.value)} />
        </Field>
      )}

      <Field label="Note" required={fields.kind === "note"} className="sm:col-span-2" htmlFor="note">
        <Textarea id="note" name="note" rows={2} required={fields.kind === "note"} value={fields.note} onChange={(e) => setField("note", e.target.value)} />
      </Field>

      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" loading={isPending} disabled={findings.length === 0}>
          Ajouter la preuve
        </Button>
      </div>
    </form>
  );
}
