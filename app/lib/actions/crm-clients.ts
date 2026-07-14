"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  calendarEvents,
  crmClients,
  deals,
  interactions,
  projects,
  tasks,
  tickets,
} from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { dispatchWebhookEvent } from "@/lib/webhooks";

const STAGES = ["lead", "prospect", "client", "churned"] as const;

export async function createClient(formData: FormData) {
  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Le nom du client est requis.");
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

  await logAudit({
    action: "crm.client_created",
    targetType: "crm_client",
    targetId: client.id,
    metadata: { name: client.name, stage: client.stage },
  });

  await dispatchWebhookEvent("lead.created", { clientId: client.id, name: client.name, stage: client.stage });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/clients");
  return client;
}

export async function updateClientStage(id: string, stage: string) {
  if (!STAGES.includes(stage as (typeof STAGES)[number])) {
    throw new Error("Étape invalide.");
  }

  await db.update(crmClients).set({ stage }).where(eq(crmClients.id, id));

  await logAudit({
    action: "crm.client_stage_changed",
    targetType: "crm_client",
    targetId: id,
    metadata: { stage },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/clients");
  revalidatePath(`/admin/crm/clients/${id}`);
}

export async function deleteClient(id: string) {
  await db.delete(crmClients).where(eq(crmClients.id, id));

  await logAudit({
    action: "crm.client_deleted",
    targetType: "crm_client",
    targetId: id,
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

  await logAudit({
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
