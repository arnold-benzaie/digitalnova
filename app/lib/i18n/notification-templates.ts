import type { Locale } from "@/lib/i18n/dictionaries";

type Rendered = { title: string; body?: string };

/**
 * Per-notification-type, per-locale content templates — the fix for
 * notifications previously being stored as fully-formed, permanently-
 * French sentences with no way to re-render them in another language.
 *
 * Each `notify()` call site (lib/actions/*, app/api/**\/route.ts) now
 * passes a stable `type` + a structured `metadata` object instead of a
 * pre-rendered `title`/`body`. `lib/notifications.ts`'s `notify()` calls
 * this file once (locale "fr") to compute what's actually stored in the
 * `title`/`body` columns — kept for legacy display safety, exactly as
 * before — while `metadata` is ALSO stored, letting `renderNotification()`
 * below re-render the same notification in either language at read time.
 *
 * A template only returns `body` when the body is itself translatable UI
 * prose. Several notification types carry body text that is data, not UI
 * text — a user's own message, an AI-generated audit/onboarding summary —
 * and per the i18n architecture's own rule ("ne traduis pas... les
 * contenus rédigés par les utilisateurs... les données métier"), those
 * templates omit `body` entirely so the renderer falls back to whatever
 * was stored verbatim, unmodified by locale.
 *
 * A `type` with no template here (e.g. "fastspring.<event>", whose type
 * string is itself dynamic) or a notification with no `metadata` (every
 * row inserted before this system existed) falls back to its stored
 * title/body as-is — old notifications stay exactly as they were written,
 * never retroactively touched.
 */
const templates: Record<string, (locale: Locale, meta: Record<string, unknown>) => Rendered> = {
  "user.pending_approval": (locale, meta) => {
    const name = String(meta.name ?? "");
    return locale === "en"
      ? { title: "New user awaiting approval", body: `${name} is awaiting access approval.` }
      : { title: "Nouvel utilisateur en attente d'approbation", body: `${name} attend une validation d'accès.` };
  },
  "user.approved": (locale, meta) => {
    const name = String(meta.name ?? "");
    const role = String(meta.role ?? "");
    const organizationName = String(meta.organizationName ?? "");
    return locale === "en"
      ? { title: "User approved", body: `${name} was approved as ${role} — ${organizationName}.` }
      : { title: "Utilisateur approuvé", body: `${name} a été approuvé(e) en tant que ${role} — ${organizationName}.` };
  },
  "user.refused": (locale, meta) => {
    const name = String(meta.name ?? "");
    return locale === "en"
      ? { title: "Access request refused", body: `${name}'s request was refused.` }
      : { title: "Demande d'accès refusée", body: `La demande de ${name} a été refusée.` };
  },
  "user.suspended": (locale, meta) => {
    const name = String(meta.name ?? "");
    return locale === "en" ? { title: "User suspended", body: `${name} was suspended.` } : { title: "Utilisateur suspendu", body: `${name} a été suspendu(e).` };
  },
  "user.reactivated": (locale, meta) => {
    const name = String(meta.name ?? "");
    return locale === "en" ? { title: "User reactivated", body: `${name} was reactivated.` } : { title: "Utilisateur réactivé", body: `${name} a été réactivé(e).` };
  },
  "user.role_changed": (locale, meta) => {
    const newRole = String(meta.newRole ?? "");
    return locale === "en" ? { title: "Role changed", body: `Role changed to ${newRole}.` } : { title: "Rôle modifié", body: `Le rôle a été changé en ${newRole}.` };
  },
  "user.organization_changed": (locale, meta) => {
    const organizationName = String(meta.organizationName ?? "");
    return locale === "en"
      ? { title: "Organization changed", body: `A member was moved to ${organizationName}.` }
      : { title: "Organisation modifiée", body: `Un membre a été transféré vers ${organizationName}.` };
  },
  "message.received": (locale, meta) => {
    const senderRole = meta.senderRole === "client" ? "client" : "staff";
    if (locale === "en") return { title: senderRole === "client" ? "New message from the client" : "New message from your advisor" };
    return { title: senderRole === "client" ? "Nouveau message du client" : "Nouveau message de votre conseiller" };
  },
  "document.uploaded": (locale) => (locale === "en" ? { title: "New document added" } : { title: "Nouveau document ajouté" }),
  "onboarding.completed": (locale) => (locale === "en" ? { title: "Onboarding questionnaire completed" } : { title: "Questionnaire d'accueil complété" }),
  // audit.generated's body (result.summary) is AI-generated prose, not UI
  // text — omitted here on purpose, see this file's header comment.
  "audit.generated": (locale, meta) => {
    const score = Number(meta.score ?? 0);
    return locale === "en" ? { title: `Audit completed — score ${score}/100` } : { title: `Audit terminé — score ${score}/100` };
  },
  "gbp.synced": (locale, meta) => {
    const locationCount = Number(meta.locationCount ?? 0);
    const metricsUnavailable = Boolean(meta.metricsUnavailable);
    const reviewsUnavailable = Boolean(meta.reviewsUnavailable);
    const errorMessage = meta.errorMessage ? String(meta.errorMessage) : (locale === "en" ? "unknown error" : "erreur inconnue");
    const title = locale === "en" ? "Google Business Profile sync complete" : "Synchronisation Google Business Profile effectuée";
    if (metricsUnavailable) {
      return { title, body: locale === "en" ? `${locationCount} location(s) updated (Google stats unavailable — ${errorMessage}).` : `${locationCount} établissement(s) mis à jour (statistiques Google indisponibles — ${errorMessage}).` };
    }
    if (reviewsUnavailable) {
      return { title, body: locale === "en" ? `${locationCount} location(s) updated (Google reviews unavailable — partner access required).` : `${locationCount} établissement(s) mis à jour (avis Google non disponibles — accès partenaire requis).` };
    }
    return { title, body: locale === "en" ? `${locationCount} location(s) updated.` : `${locationCount} établissement(s) mis à jour.` };
  },
  "analytics.synced": (locale, meta) => {
    const propertyCount = Number(meta.propertyCount ?? 0);
    const metricsUnavailable = Boolean(meta.metricsUnavailable);
    const errorMessage = meta.errorMessage ? String(meta.errorMessage) : (locale === "en" ? "unknown error" : "erreur inconnue");
    const title = locale === "en" ? "Google Analytics sync complete" : "Synchronisation Google Analytics effectuée";
    if (metricsUnavailable) {
      return { title, body: locale === "en" ? `${propertyCount} propert(y/ies) updated (data unavailable — ${errorMessage}).` : `${propertyCount} propriété(s) mise(s) à jour (données indisponibles — ${errorMessage}).` };
    }
    return { title, body: locale === "en" ? `${propertyCount} propert(y/ies) updated.` : `${propertyCount} propriété(s) mise(s) à jour.` };
  },
  "search_console.synced": (locale, meta) => {
    const propertyCount = Number(meta.propertyCount ?? 0);
    const metricsUnavailable = Boolean(meta.metricsUnavailable);
    const errorMessage = meta.errorMessage ? String(meta.errorMessage) : (locale === "en" ? "unknown error" : "erreur inconnue");
    const title = locale === "en" ? "Search Console sync complete" : "Synchronisation Search Console effectuée";
    if (metricsUnavailable) {
      return { title, body: locale === "en" ? `${propertyCount} propert(y/ies) updated (data unavailable — ${errorMessage}).` : `${propertyCount} propriété(s) mise(s) à jour (données indisponibles — ${errorMessage}).` };
    }
    return { title, body: locale === "en" ? `${propertyCount} propert(y/ies) updated.` : `${propertyCount} propriété(s) mise(s) à jour.` };
  },
  "billing.subscribed": (locale, meta) => {
    const planName = String(meta.planName ?? "");
    const priceEuros = Number(meta.priceEuros ?? 0);
    return locale === "en" ? { title: `${planName} subscription activated`, body: `€${priceEuros}/month` } : { title: `Abonnement ${planName} activé`, body: `${priceEuros} €/mois` };
  },
  "billing.canceled": (locale) => (locale === "en" ? { title: "Subscription canceled" } : { title: "Abonnement annulé" }),
  "fastspring._generic": (locale) => (locale === "en" ? { title: "Billing update" } : { title: "Mise à jour de facturation" }),
  "report.generated": (locale, meta) => {
    const frequencyLabelsFr: Record<string, string> = { weekly: "hebdomadaire", monthly: "mensuel", quarterly: "trimestriel" };
    const frequencyLabelsEn: Record<string, string> = { weekly: "weekly", monthly: "monthly", quarterly: "quarterly" };
    const frequencyKey = String(meta.frequency ?? "");
    const frequency = (locale === "en" ? frequencyLabelsEn : frequencyLabelsFr)[frequencyKey] ?? frequencyKey;
    const score = meta.score !== undefined && meta.score !== null ? Number(meta.score) : null;
    const title = locale === "en" ? `${frequency} report available` : `Rapport ${frequency} disponible`;
    if (score === null) return { title, body: locale === "en" ? "No audit available yet." : "Aucun audit disponible pour le moment." };
    return {
      title,
      body: locale === "en" ? `Current audit score: ${score}/100. Download the PDF from Audits.` : `Score d'audit actuel : ${score}/100. Téléchargez le PDF depuis Audits.`,
    };
  },
};

/** Reads a stored notification row (whatever locale it was written in)
 * and re-renders it for the given display locale — via its `type` +
 * `metadata` when both are present and recognized, otherwise falling
 * back to the stored `title`/`body` unchanged (legacy rows, and body
 * text that's genuinely data rather than translatable UI copy). */
export function renderNotification(
  item: { type: string; title: string; body: string | null; metadata: unknown },
  locale: Locale,
): { title: string; body: string | null } {
  const meta = item.metadata && typeof item.metadata === "object" ? (item.metadata as Record<string, unknown>) : null;
  const template = resolveTemplate(item.type);
  if (!template || !meta) return { title: item.title, body: item.body };
  try {
    const rendered = template(locale, meta);
    return { title: rendered.title, body: rendered.body !== undefined ? rendered.body : item.body };
  } catch {
    return { title: item.title, body: item.body };
  }
}

/** Used by notify() to compute the canonical (French) title/body stored
 * in the DB columns — single source of truth, so the stored fallback text
 * is never a second, independently-maintained copy of the template. */
export function renderNotificationFr(type: string, metadata: Record<string, unknown>): Rendered | null {
  const template = resolveTemplate(type);
  if (!template) return null;
  return template("fr", metadata);
}

/** Exact match first; falls back to a generic template for the one type
 * whose suffix is itself dynamic (`fastspring.<event.type>`, from the
 * FastSpring webhook) — otherwise every such event would need its own
 * template entry keyed by a third-party-defined string. */
function resolveTemplate(type: string) {
  if (templates[type]) return templates[type];
  if (type.startsWith("fastspring.")) return templates["fastspring._generic"];
  return undefined;
}
