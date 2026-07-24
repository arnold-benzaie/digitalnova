import { renderToBuffer } from "@react-pdf/renderer";
import { and, asc, eq, ilike, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { crmClients } from "@/db/schema";
import { toCsv } from "@/lib/csv";
import { CrmClientsReportDocument } from "@/lib/pdf/crm-clients-report";
import { getCurrentSession } from "@/lib/session";

const STAGE_LABEL: Record<string, string> = { lead: "Lead", prospect: "Prospect", client: "Client", churned: "Perdu" };
const STAGE_VALUES = Object.keys(STAGE_LABEL);

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session || session.role === "client") {
    return new Response("Non autorisé", { status: 401 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const stageParam = url.searchParams.get("stage") ?? "";
  const stage = STAGE_VALUES.includes(stageParam) ? stageParam : "";
  const archivedParam = url.searchParams.get("archived") ?? "active";

  // Same filter semantics as app/admin/crm/clients/page.tsx, so an export
  // triggered from a filtered list view exports exactly what's on screen.
  const conditions = [];
  if (q) {
    conditions.push(or(ilike(crmClients.name, `%${q}%`), ilike(crmClients.contactName, `%${q}%`), ilike(crmClients.email, `%${q}%`)));
  }
  if (stage) conditions.push(eq(crmClients.stage, stage));
  if (archivedParam === "active") conditions.push(isNull(crmClients.archivedAt));
  if (archivedParam === "archived") conditions.push(isNotNull(crmClients.archivedAt));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const rows = await db.select().from(crmClients).where(whereClause).orderBy(asc(crmClients.name));

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const csv = toCsv(
      ["Nom", "Contact", "Email", "Téléphone", "Adresse", "Étape", "Source", "Conseiller", "Notes", "Archivé", "Créé le"],
      rows.map((r) => [
        r.name,
        r.contactName ?? "",
        r.email ?? "",
        r.phone ?? "",
        r.address ?? "",
        STAGE_LABEL[r.stage] ?? r.stage,
        r.source ?? "",
        r.ownerName ?? "",
        r.notes ?? "",
        r.archivedAt ? "Oui" : "Non",
        new Date(r.createdAt).toLocaleDateString("fr-FR"),
      ]),
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="crm-clients-${stamp}.csv"`,
      },
    });
  }

  const buffer = await renderToBuffer(
    CrmClientsReportDocument({
      rows: rows.map((r) => ({
        name: r.name,
        contactName: r.contactName,
        email: r.email,
        stage: r.stage,
        ownerName: r.ownerName,
        source: r.source,
        createdAt: r.createdAt,
        archived: Boolean(r.archivedAt),
      })),
      generatedAt: new Date(),
      stageLabel: STAGE_LABEL,
    }),
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="crm-clients-${stamp}.pdf"`,
    },
  });
}
