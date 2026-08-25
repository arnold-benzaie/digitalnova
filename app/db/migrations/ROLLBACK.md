# Plan de rollback — migrations 0001 / 0002

Document de référence uniquement. **Aucune commande de ce fichier n'a été exécutée.**
Toute exécution nécessite une confirmation explicite, et idéalement une sauvegarde fraîche
(voir « Restauration depuis la sauvegarde » plus bas).

## Module Audit GBP — déplacé vers une base Supabase séparée

L'ancienne migration `0010_huge_infant_terrible` (module Audit GBP, 15 tables)
a été **supprimée de ce dossier** — elle n'a jamais été appliquée à aucune
base réelle (vérifié avant suppression). Sur décision explicite, le module
Audit GBP utilise désormais un **projet Supabase totalement séparé**, avec
son propre schéma (`db/audit-schema.ts`), sa propre migration
(`db/audit-migrations/0000_...sql`) et son propre rôle `supervisor` (table
`audit_staff_roles`, locale à cette base — **pas** la table `roles` de ce
schéma principal). Ce schéma principal (`db/schema.ts`) ne contient plus
aucune trace du module Audit GBP, aucune table le concernant, aucune
référence à `supervisor`.

Le plan de rollback du module Audit GBP se trouve désormais dans le projet
Supabase Audit lui-même (base entièrement distincte — un rollback ici
n'aurait aucun sens et ne toucherait aucune donnée réelle).

## 0002_calm_juggernaut — ajout de 22 index

Non destructif à créer, et non destructif à annuler : un `DROP INDEX` ne touche
jamais aux données, seulement à la structure d'accès. Sûr à exécuter à tout moment.

```sql
DROP INDEX IF EXISTS "audit_issues_audit_id_idx";
DROP INDEX IF EXISTS "audit_log_organization_id_idx";
DROP INDEX IF EXISTS "audit_log_actor_user_id_idx";
DROP INDEX IF EXISTS "audits_organization_id_idx";
DROP INDEX IF EXISTS "audits_location_id_idx";
DROP INDEX IF EXISTS "calendar_events_client_id_idx";
DROP INDEX IF EXISTS "contracts_client_id_idx";
DROP INDEX IF EXISTS "contracts_deal_id_idx";
DROP INDEX IF EXISTS "crm_clients_organization_id_idx";
DROP INDEX IF EXISTS "deals_client_id_idx";
DROP INDEX IF EXISTS "documents_organization_id_idx";
DROP INDEX IF EXISTS "interactions_client_id_idx";
DROP INDEX IF EXISTS "invitations_email_idx";
DROP INDEX IF EXISTS "invitations_org_status_idx";
DROP INDEX IF EXISTS "invoices_organization_id_idx";
DROP INDEX IF EXISTS "invoices_subscription_id_idx";
DROP INDEX IF EXISTS "memberships_org_role_idx";
DROP INDEX IF EXISTS "messages_organization_id_idx";
DROP INDEX IF EXISTS "notifications_organization_id_idx";
DROP INDEX IF EXISTS "projects_client_id_idx";
DROP INDEX IF EXISTS "reviews_location_id_idx";
DROP INDEX IF EXISTS "tasks_client_id_idx";
DROP INDEX IF EXISTS "tickets_client_id_idx";
```

Puis retirer la ligne correspondante de `drizzle.__drizzle_migrations`
(`created_at = 1784... ` — voir la ligne la plus récente) pour que Drizzle
considère à nouveau cette migration comme non appliquée.

## 0001_good_cobalt_man — ajout de 23 tables

**DESTRUCTIF.** Ces tables contiennent aujourd'hui des données réelles (CRM,
documents, facturation, GBP, invitations...). Ne jamais exécuter sans :
1. confirmation explicite de ta part ;
2. une sauvegarde fraîche (voir plus bas) ;
3. la certitude qu'aucune fonctionnalité de l'app n'en dépend plus.

Ordre de suppression respectant les clés étrangères (enfants avant parents) :

```sql
DROP TABLE IF EXISTS "audit_issues";
DROP TABLE IF EXISTS "contracts";
DROP TABLE IF EXISTS "calendar_events";
DROP TABLE IF EXISTS "interactions";
DROP TABLE IF EXISTS "projects";
DROP TABLE IF EXISTS "tasks";
DROP TABLE IF EXISTS "tickets";
DROP TABLE IF EXISTS "deals";
DROP TABLE IF EXISTS "invoices";
DROP TABLE IF EXISTS "location_metrics";
DROP TABLE IF EXISTS "reviews";
DROP TABLE IF EXISTS "invitations";
DROP TABLE IF EXISTS "documents";
DROP TABLE IF EXISTS "messages";
DROP TABLE IF EXISTS "notifications";
DROP TABLE IF EXISTS "onboarding";
DROP TABLE IF EXISTS "report_schedules";
DROP TABLE IF EXISTS "webhook_deliveries";
DROP TABLE IF EXISTS "subscriptions";
DROP TABLE IF EXISTS "gbp_connections";
DROP TABLE IF EXISTS "audits";
DROP TABLE IF EXISTS "crm_clients";
DROP TABLE IF EXISTS "locations";
```

## 0000_fine_kingpin — tables fondatrices (organizations, users, roles, memberships, audit_log)

**Rollback non recommandé, quel que soit le contexte.** Ces tables portent
l'authentification et les rôles de toute l'application (P0-1). Les supprimer
casse la connexion de tous les utilisateurs, y compris les administrateurs.
Si un problème structurel est un jour découvert ici, la bonne réponse est une
migration corrective (`ALTER TABLE`), pas un rollback.

## Restauration depuis la sauvegarde

Une sauvegarde logique complète (JSON, toutes les tables, toutes les lignes)
a été prise avant ces migrations :

```
/private/tmp/claude-501/.../scratchpad/db-backups/backup-2026-07-15T00-00-00.json
```

Pour restaurer une table à partir de ce fichier (après un rollback de
structure, par exemple), réinsérer chaque ligne du tableau JSON correspondant
via `INSERT INTO <table> (...) VALUES (...)` en respectant l'ordre des
colonnes d'origine. Cette sauvegarde vit hors du dépôt (répertoire scratchpad
de session) — la déplacer vers un stockage durable si elle doit être
conservée au-delà de cette session.

## 0029_heavy_the_fallen — fondation catalogue (services, service_market_offers, service_relations, service_legacy_identifiers)

**Non destructif à annuler.** Les 4 tables créées par cette migration sont
vides à l'application (P0.1B.1 = fondation uniquement, aucune donnée
commerciale insérée, aucun SERVICE_ID réel créé — voir P0.1B.2, séparée et
non encore autorisée). Aucune table existante n'est modifiée par
`0029_heavy_the_fallen.sql` (uniquement des `CREATE TABLE`/`ALTER TABLE ...
ADD CONSTRAINT`/`CREATE INDEX`, zéro `ALTER` sur une table préexistante).

Ordre de suppression respectant les clés étrangères (enfants avant parents) :

```sql
DROP TABLE IF EXISTS "service_legacy_identifiers";
DROP TABLE IF EXISTS "service_relations";
DROP TABLE IF EXISTS "service_market_offers";
DROP TABLE IF EXISTS "services";
```

Puis retirer la ligne correspondante de `drizzle.__drizzle_migrations` pour
que Drizzle considère à nouveau cette migration comme non appliquée — même
procédure que pour les migrations précédentes de ce fichier.

Si des données commerciales ont été insérées entre-temps (P0.1B.2 ou
ultérieur), ce rollback devient destructif pour ces données uniquement —
revoir ce document et prendre une sauvegarde avant exécution dans ce cas.

Rollback vérifié réellement (pas seulement documenté) contre la base de test
locale disposable (`public-map-approval-test-db`, port 5434, jamais Preview/
Production) : les 4 `DROP TABLE` s'exécutent proprement, zéro impact sur les
tables existantes (`organizations`/`users` etc. confirmés intacts).
