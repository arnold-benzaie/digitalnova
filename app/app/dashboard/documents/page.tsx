import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { DeleteDocumentButton, UploadDocumentForm } from "@/components/document-actions";
import { getOrCreateDevOrganization } from "@/lib/dev-org";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default async function DocumentsPage() {
  const org = await getOrCreateDevOrganization();
  const orgDocuments = await db
    .select()
    .from(documents)
    .where(eq(documents.organizationId, org.id))
    .orderBy(desc(documents.createdAt));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Documents</h1>
      <p className="mt-2 text-sm text-pm-gris">
        Déposez vos documents (contrats, exports, visuels) pour votre conseiller.
        Stockage limité à 4 Mo par fichier en attendant la configuration d&apos;un
        stockage objet dédié (Vercel Blob / Supabase Storage).
      </p>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <UploadDocumentForm />
      </div>

      {orgDocuments.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">Aucun document</p>
          <p className="mt-1 text-sm text-pm-gris">Ajoutez votre premier document ci-dessus.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">Nom</th>
                <th className="px-5 py-3">Taille</th>
                <th className="px-5 py-3">Ajouté par</th>
                <th className="px-5 py-3">Date</th>
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
                    {document.uploadedByRole === "client" ? "Client" : "Agence"}
                  </td>
                  <td className="px-5 py-3 text-pm-gris">
                    {new Date(document.createdAt).toLocaleDateString("fr-FR")}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <DeleteDocumentButton id={document.id} />
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
