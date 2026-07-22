import { desc, sql } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { auditWebhookDeliveries, gbpAuditReports } from "@/db/audit-schema";
import { requireAuditAdminRole } from "@/lib/gbp-audit/session";
import { getAuditSettings } from "@/lib/gbp-audit/settings";
import { Badge } from "@/components/crm/badges";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { WEBHOOK_EVENT_LABEL } from "@/lib/gbp-audit/activity-labels";
import { Tabs } from "@/components/gbp-audit/ui/tabs";
import {
  GeneralSettingsForm,
  NotificationSettingsForm,
  ReportSettingsForm,
  ScoringSettingsForm,
  SecuritySettingsForm,
  WebhookSettingsForm,
} from "@/components/gbp-audit/settings-forms";

const ROLE_LABEL: Record<string, string> = { admin: "Administrateur", supervisor: "Superviseur", staff: "Staff" };

const STATUS_LABEL: Record<string, string> = {
  sent: "Envoyé",
  failed: "Échec",
  skipped_not_configured: "Ignoré (non configuré)",
  skipped_disabled: "Ignoré (désactivé)",
};
const STATUS_CLASS: Record<string, string> = {
  sent: "bg-pm-g-green/10 text-pm-g-green",
  failed: "bg-pm-rouge/10 text-pm-rouge-2",
  skipped_not_configured: "bg-pm-gris-2/60 text-pm-gris",
  skipped_disabled: "bg-pm-gris-2/60 text-pm-gris",
};

const SUBSCORES = [
  "Conformité du profil", "Complétude", "Réputation", "Contenu",
  "Cohérence locale", "Visibilité", "Risque de suspension", "Expérience utilisateur",
];
const SCORE_BANDS = [
  { range: "90 – 100", label: "Excellent" },
  { range: "75 – 89", label: "Satisfaisant" },
  { range: "50 – 74", label: "Faiblesses importantes" },
  { range: "25 – 49", label: "Fortement incomplet" },
  { range: "0 – 24", label: "Critique" },
];

function ConfigState({ configured }: { configured: boolean }) {
  return (
    <Badge
      label={configured ? "Configuré" : "Non configuré"}
      className={configured ? "bg-pm-g-green/10 text-pm-g-green" : "bg-pm-gris-2/60 text-pm-gris"}
    />
  );
}

export default async function AuditSettingsPage() {
  const session = await requireAuditAdminRole();

  const [settings, deliveries, [{ total: reportsTotal, withPdf: reportsWithPdf }]] = await Promise.all([
    getAuditSettings(),
    auditDb.select().from(auditWebhookDeliveries).orderBy(desc(auditWebhookDeliveries.createdAt)).limit(50),
    auditDb
      .select({
        total: sql<number>`count(*)::int`,
        withPdf: sql<number>`count(*) filter (where ${gbpAuditReports.pdfStoragePath} is not null)::int`,
      })
      .from(gbpAuditReports),
  ]);
  const webhookConfigured = Boolean(process.env.N8N_WEBHOOK_URL);
  const storageConfigured = Boolean(process.env.AUDIT_SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_AUDIT_SUPABASE_URL);
  const notConfiguredDeliveries = deliveries.length > 0 && deliveries.every((d) => d.status === "skipped_not_configured");

  const generalTab = (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">Mon compte</h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">Nom</dt>
            <dd className="mt-0.5 text-pm-noir">{session.fullName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">E-mail</dt>
            <dd className="mt-0.5 text-pm-noir">{session.email}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-pm-gris">Rôle</dt>
            <dd className="mt-0.5 text-pm-noir">{ROLE_LABEL[session.role] ?? "Membre"}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-pm-gris">
          Pour gérer les membres de l&rsquo;équipe et leurs rôles, rendez-vous dans <span className="font-medium text-pm-noir">Équipe</span>.
        </p>
      </div>
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">Contact prospect</h2>
        <p className="mt-1 text-sm text-pm-gris">Affiché sur le portail client et en pied de rapport PDF.</p>
        <div className="mt-4">
          <GeneralSettingsForm settings={settings} />
        </div>
      </div>
    </div>
  );

  const scoringTab = (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">Pénalités par gravité</h2>
        <p className="mt-1 text-sm text-pm-gris">Chaque contrôle non conforme retire des points du score sur 100, selon sa gravité.</p>
        <div className="mt-4">
          <ScoringSettingsForm settings={settings} />
        </div>
      </div>
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">Sous-scores (19 catégories → 8 axes)</h2>
        <p className="mt-1 text-sm text-pm-gris">Les 19 catégories de contrôles alimentent 8 sous-scores affichés sur la fiche d&rsquo;audit — structure fixe, non modifiable.</p>
        <ul className="mt-4 grid grid-cols-2 gap-2 text-sm text-pm-noir sm:grid-cols-4">
          {SUBSCORES.map((s) => (
            <li key={s} className="rounded-lg bg-pm-gris-2/30 px-3 py-2">{s}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">Bandes de score</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-pm-gris">
              <tr><th className="py-2 pr-4">Score</th><th className="py-2">Appréciation</th></tr>
            </thead>
            <tbody>
              {SCORE_BANDS.map((b) => (
                <tr key={b.label} className="border-t border-pm-gris-2">
                  <td className="py-2 pr-4 tabular-nums text-pm-noir">{b.range}</td>
                  <td className="py-2 text-pm-gris">{b.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const pdfTab = (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
      <h2 className="font-serif text-lg font-semibold text-pm-noir">Rapports PDF et liens sécurisés</h2>
      <p className="mt-1 text-sm text-pm-gris">Le PDF est généré automatiquement à l&rsquo;approbation d&rsquo;un audit.</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-pm-gris-2 p-3 text-center">
          <dt className="text-xs font-medium text-pm-gris">Rapports générés</dt>
          <dd className="mt-1 text-xl font-semibold text-pm-noir tabular-nums">{reportsTotal ?? 0}</dd>
        </div>
        <div className="rounded-xl border border-pm-gris-2 p-3 text-center">
          <dt className="text-xs font-medium text-pm-gris">Avec PDF stocké</dt>
          <dd className="mt-1 text-xl font-semibold text-pm-noir tabular-nums">{reportsWithPdf ?? 0}</dd>
        </div>
        <div className="rounded-xl border border-pm-gris-2 p-3 text-center">
          <dt className="text-xs font-medium text-pm-gris">Stockage Supabase</dt>
          <dd className="mt-1"><ConfigState configured={storageConfigured} /></dd>
        </div>
      </dl>
      <div className="mt-6 border-t border-pm-gris-2 pt-6">
        <ReportSettingsForm settings={settings} />
      </div>
      <p className="mt-4 text-xs text-pm-gris">
        Voir la liste complète dans <span className="font-medium text-pm-noir">Rapports</span>.
      </p>
    </div>
  );

  const notificationsTab = (
    <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
      <h2 className="font-serif text-lg font-semibold text-pm-noir">Notifications automatiques</h2>
      <p className="mt-1 text-sm text-pm-gris">Choisissez quels événements créent une notification interne pour l&rsquo;équipe.</p>
      <div className="mt-4">
        <NotificationSettingsForm settings={settings} />
      </div>
      <p className="mt-4 text-xs text-pm-gris">
        Consultez l&rsquo;historique dans <span className="font-medium text-pm-noir">Notifications</span>.
      </p>
    </div>
  );

  const webhooksTab = (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-lg font-semibold text-pm-noir">Intégration webhook (n8n)</h2>
          <ConfigState configured={webhookConfigured} />
        </div>
        <div className="mt-4">
          <WebhookSettingsForm settings={settings} />
        </div>
      </div>

      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h3 className="font-serif text-base font-semibold text-pm-noir">Dernières livraisons</h3>
        <p className="mt-1 text-sm text-pm-gris">Les 50 dernières tentatives d&rsquo;envoi.</p>

        {notConfiguredDeliveries && (
          <div className="mt-4 rounded-xl border border-pm-or/40 bg-pm-or/10 p-3 text-sm text-pm-or-2">
            L&rsquo;intégration n&rsquo;est pas configurée — tous les événements sont enregistrés mais aucun n&rsquo;est réellement envoyé.
          </div>
        )}

        {deliveries.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M4 12h6l2-4 4 8 2-4h4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              }
              title="Aucune livraison pour le moment"
              description="Les événements (création d'audit, approbation, demande de devis…) apparaîtront ici dès qu'ils se produisent."
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-pm-gris-2">
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-5 py-3">Événement</th>
                  <th className="px-5 py-3">Statut</th>
                  <th className="px-5 py-3">Code HTTP</th>
                  <th className="px-5 py-3">Quand</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-t border-pm-gris-2">
                    <td className="px-5 py-3 text-pm-noir">
                      <p>{WEBHOOK_EVENT_LABEL[d.event] ?? "Événement"}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-pm-gris">{d.event}</p>
                    </td>
                    <td className="px-5 py-3">
                      <Badge label={STATUS_LABEL[d.status] ?? "Statut inconnu"} className={STATUS_CLASS[d.status] ?? "bg-pm-gris-2/60 text-pm-gris"} />
                    </td>
                    <td className="px-5 py-3 text-pm-gris tabular-nums">{d.responseStatus ?? "—"}</td>
                    <td className="px-5 py-3 text-pm-gris">{new Date(d.createdAt).toLocaleString("fr-FR")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );

  const securityTab = (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">Limites anti-abus (portail public)</h2>
        <p className="mt-1 text-sm text-pm-gris">Par adresse IP, sur les surfaces publiques non authentifiées.</p>
        <div className="mt-4">
          <SecuritySettingsForm settings={settings} />
        </div>
      </div>
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">Liens sécurisés (portail client)</h2>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-pm-gris-2 p-3">
            <dt className="text-xs font-medium text-pm-gris">Expiration par défaut</dt>
            <dd className="mt-1 text-sm font-semibold text-pm-noir">{settings.reportLinkDefaultExpiryDays} jour(s)</dd>
          </div>
          <div className="rounded-xl border border-pm-gris-2 p-3">
            <dt className="text-xs font-medium text-pm-gris">Verrouillage</dt>
            <dd className="mt-1 text-sm font-semibold text-pm-noir">Après {settings.reportLinkMaxAttempts} tentatives échouées</dd>
          </div>
          <div className="rounded-xl border border-pm-gris-2 p-3">
            <dt className="text-xs font-medium text-pm-gris">Révocation</dt>
            <dd className="mt-1 text-sm font-semibold text-pm-noir">Manuelle, depuis l&rsquo;onglet Rapport</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-pm-gris">
          Modifiables dans <span className="font-medium text-pm-noir">Rapports PDF</span>.
        </p>
      </div>
      <div className="rounded-2xl border border-pm-gris-2 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-pm-noir">Configuration technique</h2>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-pm-gris-2 p-3">
            <dt className="text-sm text-pm-noir">Stockage des preuves (Supabase)</dt>
            <dd><ConfigState configured={storageConfigured} /></dd>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-pm-gris-2 p-3">
            <dt className="text-sm text-pm-noir">Webhook n8n</dt>
            <dd><ConfigState configured={webhookConfigured} /></dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-pm-gris">
          Les valeurs des clés et jetons de connexion ne sont jamais affichées ici — seul leur état de configuration l&rsquo;est.
        </p>
      </div>
    </div>
  );

  return (
    <>
      <div>
        <h1 className="font-serif text-3xl font-semibold text-pm-noir">Paramètres</h1>
        <p className="mt-1 text-sm text-pm-gris">Votre compte et la configuration de PUBLIC-MAP Audit.</p>
      </div>

      <div className="mt-6">
        <Tabs
          tabs={[
            { key: "general", label: "Général", content: generalTab },
            { key: "scoring", label: "Scoring", content: scoringTab },
            { key: "pdf", label: "Rapports PDF", content: pdfTab },
            { key: "notifications", label: "Notifications", content: notificationsTab },
            { key: "webhooks", label: "Webhooks", content: webhooksTab },
            { key: "security", label: "Sécurité", content: securityTab },
          ]}
        />
      </div>
    </>
  );
}
