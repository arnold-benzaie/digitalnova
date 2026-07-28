import { redirect } from "next/navigation";

/** Folded into the universal /admin/integrations platform — kept as a
 * redirect so old links/bookmarks still land somewhere useful. Same
 * precedent as app/admin/audit/webhooks/page.tsx. */
export default function WebhooksRedirect() {
  redirect("/admin/integrations");
}
