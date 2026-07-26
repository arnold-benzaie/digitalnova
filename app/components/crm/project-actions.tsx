"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProject, updateProject } from "@/lib/actions/crm-projects";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

type Project = {
  id: string;
  name: string;
  description: string | null;
  startDate: string | Date | null;
  dueDate: string | Date | null;
};

export function EditProjectForm({ project, locale = "fr" }: { project: Project; locale?: Locale }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const startDate = project.startDate ? new Date(project.startDate).toISOString().slice(0, 10) : "";
  const dueDate = project.dueDate ? new Date(project.dueDate).toISOString().slice(0, 10) : "";
  const t = dictionaries[locale].crm.projects.edit;

  function close() {
    dialogRef.current?.close();
    setError(null);
  }

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} className="text-xs text-pm-gris underline hover:text-pm-noir">
        {t.modifyButton}
      </button>
      <dialog ref={dialogRef} onCancel={close} className="w-full max-w-sm rounded-2xl border border-pm-gris-2 bg-white p-0 shadow-xl backdrop:bg-pm-noir/40">
        <form
          className="flex flex-col gap-3 p-6"
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              try {
                await updateProject(project.id, formData);
                close();
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
              }
            })
          }
        >
          <h2 className="font-serif text-lg font-semibold text-pm-noir">{t.title}</h2>
          <input name="name" required defaultValue={project.name} placeholder={t.namePlaceholder} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
          <textarea name="description" rows={2} defaultValue={project.description ?? ""} placeholder={t.descriptionPlaceholder} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20" />
          <label className="flex flex-col gap-1 text-xs text-pm-gris">
            {t.startLabel}
            <input name="startDate" type="date" defaultValue={startDate} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-pm-gris">
            {t.dueLabel}
            <input name="dueDate" type="date" defaultValue={dueDate} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir" />
          </label>
          {error && <p className="text-sm text-pm-rouge">{error}</p>}
          <div className="mt-1 flex items-center justify-end gap-3">
            <button type="button" onClick={close} disabled={isPending} className="text-sm text-pm-gris hover:text-pm-noir disabled:opacity-50">
              {dictionaries[locale].common.cancel}
            </button>
            <button type="submit" disabled={isPending} className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2 disabled:opacity-50">
              {isPending ? t.saving : t.saveButton}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function DeleteProjectButton({ id, locale = "fr" }: { id: string; locale?: Locale }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = dictionaries[locale].crm.projects.delete;

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (!confirm(t.confirm)) return;
          setError(null);
          startTransition(async () => {
            try {
              await deleteProject(id);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : dictionaries[locale].common.error);
            }
          });
        }}
        className="text-xs text-pm-gris underline hover:text-pm-rouge disabled:opacity-50"
      >
        {isPending ? t.deleting : t.button}
      </button>
      {error && <p className="mt-1 text-xs text-pm-rouge">{error}</p>}
    </div>
  );
}
