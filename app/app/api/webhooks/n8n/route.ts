import { db } from "@/db";
import { crmClients, interactions, tasks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "@/lib/audit";

/**
 * Inbound n8n automation hook — lets an n8n workflow trigger a small set of
 * safe CRM actions in this app. No N8N_INBOUND_SECRET is configured yet,
 * so this always returns 401: an unauthenticated endpoint that can write
 * data must never be open by default, unlike the outbound dispatch in
 * lib/webhooks.ts which safely no-ops when unconfigured. Set
 * N8N_INBOUND_SECRET and send it as `Authorization: Bearer <secret>` once
 * a real n8n workflow calls this.
 */
export async function POST(request: Request) {
  const secret = process.env.N8N_INBOUND_SECRET;
  if (!secret) {
    return new Response("n8n inbound webhook not configured", { status: 401 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.action !== "string") {
    return new Response("Invalid payload", { status: 400 });
  }

  switch (body.action) {
    case "create_task": {
      const { title, clientId, dueDate, assignee } = body.data ?? {};
      if (typeof title !== "string" || !title.trim()) {
        return new Response("title is required", { status: 400 });
      }
      const [task] = await db
        .insert(tasks)
        .values({
          title: title.trim(),
          clientId: typeof clientId === "string" ? clientId : null,
          dueDate: typeof dueDate === "string" ? new Date(dueDate) : null,
          assignee: typeof assignee === "string" ? assignee : null,
        })
        .returning();
      await logAudit({ action: "n8n.task_created", targetType: "task", targetId: task.id });
      return Response.json({ created: task.id });
    }

    case "log_interaction": {
      const { clientId, type, summary, createdBy } = body.data ?? {};
      if (typeof clientId !== "string" || typeof summary !== "string" || !summary.trim()) {
        return new Response("clientId and summary are required", { status: 400 });
      }
      const [interaction] = await db
        .insert(interactions)
        .values({
          clientId,
          type: typeof type === "string" ? type : "note",
          summary: summary.trim(),
          createdBy: typeof createdBy === "string" ? createdBy : "n8n",
        })
        .returning();
      await logAudit({ action: "n8n.interaction_logged", targetType: "interaction", targetId: interaction.id });
      return Response.json({ created: interaction.id });
    }

    case "update_client_stage": {
      const { clientId, stage } = body.data ?? {};
      if (typeof clientId !== "string" || typeof stage !== "string") {
        return new Response("clientId and stage are required", { status: 400 });
      }
      await db.update(crmClients).set({ stage }).where(eq(crmClients.id, clientId));
      await logAudit({ action: "n8n.client_stage_changed", targetType: "crm_client", targetId: clientId, metadata: { stage } });
      return Response.json({ updated: clientId });
    }

    default:
      return new Response(`Unknown action: ${body.action}`, { status: 400 });
  }
}
