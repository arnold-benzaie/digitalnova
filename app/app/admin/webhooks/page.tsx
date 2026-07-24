import { desc } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";

const STATUS_LABEL: Record<string, string> = {
  sent: "Envoyé",
  failed: "Échec",
  skipped_not_configured: "Non configuré",
};
const EVENT_LABEL: Record<string, string> = {
  "lead.created": "Nouveau lead",
  "client.updated": "Fiche client modifiée",
  "client.archived": "Client archivé",
  "contract.sent": "Contrat envoyé pour signature",
  "contract.signed": "Contrat signé",
  "ticket.created": "Ticket ouvert",
  "subscription.created": "Abonnement souscrit",
  "subscription.canceled": "Abonnement annulé",
  "gbp.connected": "Google Business Profile connecté",
  "gbp.review_replied": "Réponse à un avis publiée",
  "gbp.reviews_received": "Nouveaux avis reçus",
  "search_console.connected": "Google Search Console connecté",
  "analytics.connected": "Google Analytics connecté",
  "seo.audit_created": "Audit SEO créé",
  "seo.audit_updated": "Audit SEO mis à jour",
  "seo.audit_completed": "Audit SEO terminé",
};
const STATUS_CLASS: Record<string, string> = {
  sent: "bg-pm-g-green/10 text-pm-g-green",
  failed: "bg-pm-rouge/10 text-pm-rouge-2",
  skipped_not_configured: "bg-pm-gris-2/60 text-pm-gris",
};

export default async function WebhooksPage() {
  await requireStaffRole();

  const deliveries = await db.select().from(webhookDeliveries).orderBy(desc(webhookDeliveries.createdAt)).limit(100);
  const configured = Boolean(process.env.N8N_WEBHOOK_URL);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Automatisations (n8n)</h1>
      <p className="mt-2 text-sm text-pm-gris">
        {configured ? (
          "N8N_WEBHOOK_URL est configuré — les événements sont envoyés en direct."
        ) : (
          <>
            <code className="rounded bg-pm-gris-2/40 px-1.5 py-0.5 text-xs">N8N_WEBHOOK_URL</code> n&apos;est pas
            configuré — les événements ci-dessous sont journalisés mais pas envoyés. Renseignez la variable
            d&apos;environnement pour brancher un workflow n8n réel.
          </>
        )}
      </p>

      {deliveries.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">Aucun événement pour le moment</p>
          <p className="mt-1 text-sm text-pm-gris">
            Les actions clés (nouveau lead, deal gagné, ticket créé...) apparaîtront ici.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-pm-gris-2 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
              <tr>
                <th className="px-5 py-3">Événement</th>
                <th className="px-5 py-3">Statut</th>
                <th className="px-5 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id} className="border-t border-pm-gris-2">
                  <td className="px-5 py-3 text-pm-noir">
                    <p className="font-medium">{EVENT_LABEL[delivery.event] ?? "Événement"}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-pm-gris">{delivery.event}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASS[delivery.status] ?? ""}`}>
                      {STATUS_LABEL[delivery.status] ?? delivery.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-pm-gris">{new Date(delivery.createdAt).toLocaleString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
