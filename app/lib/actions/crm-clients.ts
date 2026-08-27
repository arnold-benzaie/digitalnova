"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  calendarEvents,
  crmClients,
  deals,
  interactions,
  organizations,
  projects,
  tasks,
  tickets,
} from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { getLocale } from "@/lib/i18n/locale";
import { getOrCreateOrganizationForClient } from "@/lib/actions/crm-gbp";

const MESSAGES = {
  fr: { nameRequired: "Le nom du client est requis.", invalidStage: "Étape invalide.", clientNotFound: "Client introuvable.", invalidMarket: "Marché invalide." },
  en: { nameRequired: "Client name is required.", invalidStage: "Invalid stage.", clientNotFound: "Client not found.", invalidMarket: "Invalid market." },
} as const;

const STAGES = ["lead", "prospect", "client", "churned"] as const;
// P0.2A-4 — the only two real markets (organizations.market is a plain
// nullable text column with no DB-level CHECK — "CANADA"/"EUROPE"/null is
// an application-level convention only, so this is the sole place that
// enforces it for CRM client edits). "" is the InlineStatusSelect sentinel
// for an explicit "Non défini" choice, mapped to null below — never an
// invented third state, and never a silent fallback for anything else.
const CLIENT_MARKET_VALUES = ["CANADA", "EUROPE"] as const;

export async function createClient(formData: FormData) {
  const locale = await getLocale();
  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(MESSAGES[locale].nameRequired);
  }

  const stageValue = formData.get("stage");
  const stage = STAGES.includes(stageValue as (typeof STAGES)[number]) ? (stageValue as string) : "lead";

  const [client] = await db
    .insert(crmClients)
    .values({
      name: name.trim(),
      contactName: (formData.get("contactName") as string) || null,
      email: (formData.get("email") as string) || null,
      phone: (formData.get("phone") as string) || null,
      address: (formData.get("address") as string) || null,
      source: (formData.get("source") as string) || null,
      ownerName: (formData.get("ownerName") as string) || null,
      notes: (formData.get("notes") as string) || null,
      stage,
    })
    .returning();

  await logCrmAudit({
    action: "crm.client_created",
    targetType: "crm_client",
    targetId: client.id,
    clientId: client.id,
    metadata: { name: client.name, stage: client.stage },
  });

  await dispatchWebhookEvent("lead.created", { clientId: client.id, name: client.name, stage: client.stage });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/clients");
  return client;
}

export async function updateClientStage(id: string, stage: string) {
  const locale = await getLocale();
  if (!STAGES.includes(stage as (typeof STAGES)[number])) {
    throw new Error(MESSAGES[locale].invalidStage);
  }

  await db.update(crmClients).set({ stage }).where(eq(crmClients.id, id));

  await logCrmAudit({
    action: "crm.client_stage_changed",
    targetType: "crm_client",
    targetId: id,
    clientId: id,
    metadata: { stage },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/clients");
  revalidatePath(`/admin/crm/clients/${id}`);
}

/**
 * Sets (or explicitly clears) a client's commercial market — the single
 * input lib/crm-service-linking.ts's resolveClientMarket/resolveClientMarkets
 * (P0.2A-3) read to decide whether a catalogue price can be suggested.
 * Never guessed from address/currency/phone/language/country/GBP/price or
 * any other indirect signal (P0.2A-4 rule) — only ever this explicit,
 * staff-chosen value.
 *
 * `market` is a plain string because it travels through InlineStatusSelect
 * (a native <select>, which can never submit a true `null`): "" is the
 * sentinel for an explicit "Non défini" choice, mapped to a real `null`
 * below. Anything else that isn't exactly "CANADA"/"EUROPE"/"" is REJECTED
 * outright — never silently coerced to null, so a malformed or unexpected
 * value can never be mistaken for a deliberate "clear the market" action.
 *
 * Reuses getOrCreateOrganizationForClient (lib/actions/crm-gbp.ts) as-is
 * for the "client has no organization yet" case — the exact same
 * find-or-create-and-link pattern already established for Google Business
 * Profile, not duplicated here. Only called when setting a real market
 * (CANADA/EUROPE): clearing to null on a client with no organization is a
 * correct no-op, never a reason to create one just to hold a null value.
 * Not wrapped in its own new transaction (getOrCreateOrganizationForClient
 * isn't transaction-aware, and extending it to become so — or
 * reimplementing its body here — would be exactly the refactor/duplication
 * this phase was told to avoid); if the market UPDATE below were to fail
 * right after an organization was freshly created and linked, the client
 * is left with a real, valid organization and no market yet — safely
 * retryable (the next call takes the "organization already exists" path),
 * never a corrupted or contradictory state.
 */
export async function updateClientMarket(id: string, market: string) {
  const locale = await getLocale();
  if (market !== "" && !CLIENT_MARKET_VALUES.includes(market as (typeof CLIENT_MARKET_VALUES)[number])) {
    throw new Error(MESSAGES[locale].invalidMarket);
  }
  const resolvedMarket = market === "" ? null : (market as (typeof CLIENT_MARKET_VALUES)[number]);

  const [client] = await db.select({ organizationId: crmClients.organizationId }).from(crmClients).where(eq(crmClients.id, id)).limit(1);
  if (!client) throw new Error(MESSAGES[locale].clientNotFound);

  let organizationId = client.organizationId;
  if (resolvedMarket !== null && !organizationId) {
    const org = await getOrCreateOrganizationForClient(id);
    organizationId = org.id;
  }

  // Only ever touches the market column — no other organization field is
  // read or written here.
  if (organizationId) {
    await db.update(organizations).set({ market: resolvedMarket }).where(eq(organizations.id, organizationId));
  }

  await logCrmAudit({
    action: "crm.client_market_updated",
    targetType: "crm_client",
    targetId: id,
    clientId: id,
    metadata: { market: resolvedMarket },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/clients");
  revalidatePath(`/admin/crm/clients/${id}`);
}

/** Full edit — everything createClient can set, except stage (see ClientStageSelect). */
export async function updateClient(id: string, formData: FormData) {
  const locale = await getLocale();
  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(MESSAGES[locale].nameRequired);
  }

  const [client] = await db
    .update(crmClients)
    .set({
      name: name.trim(),
      contactName: (formData.get("contactName") as string) || null,
      email: (formData.get("email") as string) || null,
      phone: (formData.get("phone") as string) || null,
      address: (formData.get("address") as string) || null,
      source: (formData.get("source") as string) || null,
      ownerName: (formData.get("ownerName") as string) || null,
      notes: (formData.get("notes") as string) || null,
    })
    .where(eq(crmClients.id, id))
    .returning();
  if (!client) throw new Error(MESSAGES[locale].clientNotFound);

  await logCrmAudit({
    action: "crm.client_updated",
    targetType: "crm_client",
    targetId: id,
    clientId: id,
    metadata: { name: client.name },
  });

  await dispatchWebhookEvent("client.updated", { clientId: id, name: client.name });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/clients");
  revalidatePath(`/admin/crm/clients/${id}`);
  return client;
}

/**
 * Soft-archive — hides the client from the default list view without
 * touching its sales `stage` or deleting any related deals/tickets/etc.
 * Reversible via unarchiveClient, unlike deleteClient.
 */
export async function archiveClient(id: string) {
  const locale = await getLocale();
  const [client] = await db
    .update(crmClients)
    .set({ archivedAt: new Date() })
    .where(eq(crmClients.id, id))
    .returning();
  if (!client) throw new Error(MESSAGES[locale].clientNotFound);

  await logCrmAudit({
    action: "crm.client_archived",
    targetType: "crm_client",
    targetId: id,
    clientId: id,
  });

  await dispatchWebhookEvent("client.archived", { clientId: id, name: client.name });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/clients");
  revalidatePath(`/admin/crm/clients/${id}`);
}

export async function unarchiveClient(id: string) {
  const locale = await getLocale();
  const [client] = await db
    .update(crmClients)
    .set({ archivedAt: null })
    .where(eq(crmClients.id, id))
    .returning();
  if (!client) throw new Error(MESSAGES[locale].clientNotFound);

  await logCrmAudit({
    action: "crm.client_unarchived",
    targetType: "crm_client",
    targetId: id,
    clientId: id,
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/clients");
  revalidatePath(`/admin/crm/clients/${id}`);
}

/** Permanent — cascades to every deal/ticket/task/project/event/interaction/contract
 * tied to this client. Prefer archiveClient() unless the data must actually
 * be gone (e.g. a mistaken entry, or a legal deletion request). */
export async function deleteClient(id: string) {
  await db.delete(crmClients).where(eq(crmClients.id, id));

  await logCrmAudit({
    action: "crm.client_deleted",
    targetType: "crm_client",
    targetId: id,
    clientId: id,
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/clients");
}

/**
 * One-time demo seed (idempotent — no-ops if clients already exist) so the
 * CRM isn't empty on first load. Mirrors the ConnectGbpButton pattern used
 * elsewhere: an explicit user action, not automatic seeding on every request.
 */
export async function seedDemoCrmData() {
  const existing = await db.select({ id: crmClients.id }).from(crmClients).limit(1);
  if (existing.length > 0) return;

  const now = Date.now();
  const day = 86_400_000;

  const seededClients = await db
    .insert(crmClients)
    .values([
      {
        name: "Boulangerie Lefèvre",
        contactName: "Marie Lefèvre",
        email: "marie@boulangerie-lefevre.fr",
        phone: "01 42 00 00 01",
        address: "15 rue du Faubourg, 75011 Paris",
        stage: "client",
        source: "recommandation",
        ownerName: "Camille Dubois",
        notes: "Cliente historique, très satisfaite du suivi GBP.",
      },
      {
        name: "Garage Moreau Auto",
        contactName: "Julien Moreau",
        email: "julien@garage-moreau.fr",
        phone: "04 78 00 00 02",
        address: "22 avenue de la République, 69003 Lyon",
        stage: "client",
        source: "salon professionnel",
        ownerName: "Camille Dubois",
        notes: "Deuxième établissement en cours d'ouverture.",
      },
      {
        name: "Cabinet Dentaire Santé Sourire",
        contactName: "Dr. Amina Kaddour",
        email: "contact@santesourire.fr",
        phone: "05 61 00 00 03",
        address: "8 place du Capitole, 31000 Toulouse",
        stage: "prospect",
        source: "site web",
        ownerName: "Thomas Petit",
        notes: "Devis envoyé, en attente de retour.",
      },
      {
        name: "Restaurant Le Petit Marché",
        contactName: "Sofiane Benali",
        email: "sofiane@petitmarche.fr",
        phone: "03 88 00 00 04",
        address: "5 rue des Halles, 67000 Strasbourg",
        stage: "prospect",
        source: "publicité en ligne",
        ownerName: "Thomas Petit",
        notes: null,
      },
      {
        name: "Institut Beauté Zen",
        contactName: "Laura Girard",
        email: "laura@beautezen.fr",
        phone: "02 40 00 00 05",
        address: "3 cours des 50 Otages, 44000 Nantes",
        stage: "lead",
        source: "site web",
        ownerName: "Camille Dubois",
        notes: "Premier contact la semaine dernière, à relancer.",
      },
      {
        name: "Librairie des Deux Rives",
        contactName: "Pierre Rousseau",
        email: "pierre@deuxrives.fr",
        phone: "02 99 00 00 06",
        address: "12 rue Saint-Georges, 35000 Rennes",
        stage: "churned",
        source: "recommandation",
        ownerName: "Thomas Petit",
        notes: "A résilié après 6 mois, budget réduit.",
      },
    ])
    .returning();

  const byName = Object.fromEntries(seededClients.map((c) => [c.name, c]));

  await db.insert(deals).values([
    {
      clientId: byName["Boulangerie Lefèvre"].id,
      title: "Contrat annuel — gestion GBP",
      valueEuros: 1800,
      stage: "won",
      expectedCloseDate: new Date(now - 60 * day),
    },
    {
      clientId: byName["Garage Moreau Auto"].id,
      title: "Extension 2ème établissement",
      valueEuros: 900,
      stage: "won",
      expectedCloseDate: new Date(now - 10 * day),
    },
    {
      clientId: byName["Cabinet Dentaire Santé Sourire"].id,
      title: "Forfait audit + optimisation GBP",
      valueEuros: 1200,
      stage: "proposal",
      expectedCloseDate: new Date(now + 10 * day),
    },
    {
      clientId: byName["Restaurant Le Petit Marché"].id,
      title: "Forfait démarrage",
      valueEuros: 750,
      stage: "qualified",
      expectedCloseDate: new Date(now + 20 * day),
    },
    {
      clientId: byName["Institut Beauté Zen"].id,
      title: "Forfait découverte",
      valueEuros: 450,
      stage: "new",
      expectedCloseDate: new Date(now + 30 * day),
    },
  ]);

  await db.insert(tickets).values([
    {
      clientId: byName["Boulangerie Lefèvre"].id,
      subject: "Horaires d'ouverture incorrects",
      description: "Les horaires du week-end affichés sur Google ne sont plus à jour.",
      status: "resolved",
      priority: "medium",
      resolvedAt: new Date(now - 5 * day),
    },
    {
      clientId: byName["Garage Moreau Auto"].id,
      subject: "Avis suspect à signaler",
      description: "Un avis 1 étoile semble frauduleux, demande de signalement à Google.",
      status: "in_progress",
      priority: "high",
    },
    {
      clientId: byName["Cabinet Dentaire Santé Sourire"].id,
      subject: "Question sur la facturation",
      description: "Le client souhaite des précisions sur le forfait proposé.",
      status: "open",
      priority: "low",
    },
  ]);

  await db.insert(tasks).values([
    {
      clientId: byName["Institut Beauté Zen"].id,
      title: "Relancer par téléphone",
      description: "Faire un point sur les besoins avant d'envoyer un devis.",
      dueDate: new Date(now + 2 * day),
      status: "todo",
      assignee: "Camille Dubois",
    },
    {
      clientId: byName["Cabinet Dentaire Santé Sourire"].id,
      title: "Relancer le devis",
      dueDate: new Date(now + 3 * day),
      status: "todo",
      assignee: "Thomas Petit",
    },
    {
      clientId: byName["Restaurant Le Petit Marché"].id,
      title: "Préparer la proposition commerciale",
      dueDate: new Date(now + 5 * day),
      status: "in_progress",
      assignee: "Thomas Petit",
    },
    {
      clientId: null,
      title: "Préparer le rapport mensuel agence",
      dueDate: new Date(now + 7 * day),
      status: "todo",
      assignee: "Camille Dubois",
    },
  ]);

  await db.insert(calendarEvents).values([
    {
      clientId: byName["Cabinet Dentaire Santé Sourire"].id,
      title: "Appel de suivi devis",
      type: "call",
      startAt: new Date(now + 2 * day),
      endAt: new Date(now + 2 * day + 30 * 60_000),
    },
    {
      clientId: byName["Institut Beauté Zen"].id,
      title: "Premier rendez-vous découverte",
      type: "meeting",
      startAt: new Date(now + 4 * day),
      endAt: new Date(now + 4 * day + 60 * 60_000),
    },
    {
      clientId: null,
      title: "Réunion d'équipe hebdomadaire",
      type: "meeting",
      startAt: new Date(now + 1 * day),
      endAt: new Date(now + 1 * day + 45 * 60_000),
    },
  ]);

  await db.insert(interactions).values([
    {
      clientId: byName["Boulangerie Lefèvre"].id,
      type: "call",
      summary: "Point mensuel — cliente satisfaite, pas de sujet bloquant.",
      occurredAt: new Date(now - 7 * day),
      createdBy: "Camille Dubois",
    },
    {
      clientId: byName["Garage Moreau Auto"].id,
      type: "email",
      summary: "Envoi de la proposition pour le 2ème établissement.",
      occurredAt: new Date(now - 12 * day),
      createdBy: "Camille Dubois",
    },
    {
      clientId: byName["Cabinet Dentaire Santé Sourire"].id,
      type: "meeting",
      summary: "Présentation de l'offre en visioconférence, bon accueil.",
      occurredAt: new Date(now - 3 * day),
      createdBy: "Thomas Petit",
    },
    {
      clientId: byName["Institut Beauté Zen"].id,
      type: "note",
      summary: "Contact entrant via le formulaire du site, à qualifier.",
      occurredAt: new Date(now - 1 * day),
      createdBy: "Camille Dubois",
    },
  ]);

  await db.insert(projects).values([
    {
      clientId: byName["Boulangerie Lefèvre"].id,
      name: "Optimisation fiche GBP",
      description: "Mise à jour photos, description et suivi des avis.",
      status: "in_progress",
      startDate: new Date(now - 30 * day),
      dueDate: new Date(now + 15 * day),
    },
    {
      clientId: byName["Garage Moreau Auto"].id,
      name: "Ouverture 2ème établissement",
      description: "Création et vérification de la fiche du nouvel établissement.",
      status: "planning",
      startDate: new Date(now + 5 * day),
      dueDate: new Date(now + 45 * day),
    },
  ]);

  await logCrmAudit({
    action: "crm.demo_data_seeded",
    targetType: "crm",
    metadata: { clientCount: seededClients.length },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/clients");
  revalidatePath("/admin/crm/pipeline");
  revalidatePath("/admin/crm/tickets");
  revalidatePath("/admin/crm/tasks");
  revalidatePath("/admin/crm/calendar");
  revalidatePath("/admin/crm/projects");
}
