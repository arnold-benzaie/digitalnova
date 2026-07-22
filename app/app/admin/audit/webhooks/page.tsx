import { redirect } from "next/navigation";

/** Folded into Paramètres — kept as a redirect so old links/bookmarks still land somewhere useful. */
export default function AuditWebhooksRedirect() {
  redirect("/admin/audit/parametres");
}
