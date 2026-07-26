import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { DeleteDocumentButton, UploadDocumentForm } from "@/components/document-actions";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";

export default async function DocumentsPage() {
  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const t = dictionaries[locale].dashboard.documents;

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} ${t.sizeUnits.bytes}`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} ${t.sizeUnits.kilobytes}`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} ${t.sizeUnits.megabytes}`;
  }

  const orgDocuments = await db
    .select()
    .from(documents)
    .where(eq(documents.organizationId, org.id))
    .orderBy(desc(documents.createdAt));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">{t.title}</h1>
      <p className="mt-2 text-sm text-pm-gris">{t.lead}</p>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <UploadDocumentForm locale={locale} />
      </div>

      {orgDocuments.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.empty}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">{t.columns.name}</th>
                <th className="px-5 py-3">{t.columns.size}</th>
                <th className="px-5 py-3">{t.columns.addedBy}</th>
                <th className="px-5 py-3">{t.columns.date}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {orgDocuments.map((document) => (
                <tr key={document.id} className="border-t border-pm-gris-2">
                  <td className="px-5 py-3 font-medium text-pm-noir">
                    <a href={`/api/documents/${document.id}`} className="hover:underline">
                      {document.fileName}
                    </a>
                  </td>
                  <td className="px-5 py-3 text-pm-gris">{formatSize(document.sizeBytes)}</td>
                  <td className="px-5 py-3 text-pm-gris">
                    {document.uploadedByRole === "client" ? t.roleClient : t.roleAgency}
                  </td>
                  <td className="px-5 py-3 text-pm-gris">{formatDate(document.createdAt, locale)}</td>
                  <td className="px-5 py-3 text-right">
                    <DeleteDocumentButton id={document.id} locale={locale} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
