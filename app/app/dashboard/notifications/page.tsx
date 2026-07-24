import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getOrCreateDevOrganization } from "@/lib/dev-org";

export default async function NotificationsPage() {
  const org = await getOrCreateDevOrganization();
  const items = await db
    .select()
    .from(notifications)
    .where(eq(notifications.organizationId, org.id))
    .orderBy(desc(notifications.createdAt))
    .limit(100);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Notifications</h1>
      <p className="mt-2 text-sm text-pm-gris">Historique complet des notifications de votre organisation.</p>

      {items.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">Aucune notification</p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm font-medium text-pm-noir">{item.title}</p>
                <p className="shrink-0 text-xs text-pm-gris">
                  {new Date(item.createdAt).toLocaleString("fr-FR")}
                </p>
              </div>
              {item.body && <p className="mt-1 text-sm text-pm-gris">{item.body}</p>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
