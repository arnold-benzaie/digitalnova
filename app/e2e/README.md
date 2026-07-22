# Suite Playwright — PUBLIC-MAP Audit

Suite de non-régression end-to-end pour le module Audit (`app/admin/audit/**`, portail public `app/audit-report/[token]`). N'existe et ne s'exécute que pour ce module — jamais contre le reste de l'application (CRM, dashboard) ni contre le site vitrine à la racine du dépôt.

## Prérequis avant de lancer la suite

1. Le serveur dev tourne avec le QA Bypass actif :
   ```
   QA_BYPASS_AUDIT_AUTH=1 npm run dev
   ```
2. Le conteneur Docker de test est démarré :
   ```
   docker start public-map-audit-test-db
   ```
   (base `public_map_audit_test`, port 5433 — jamais le projet Supabase cloud, voir `e2e/global-setup.ts` qui le vérifie explicitement à chaque run via `db/guard-main-production.ts`.)

## Lancer la suite

```
npm run test:e2e            # toute la suite (34 scénarios)
npx playwright test e2e/full-lifecycle.spec.ts   # un seul fichier
npx playwright show-report e2e/report            # rouvrir le dernier rapport HTML
```

Chaque exécution génère :
- un **rapport HTML** dans `e2e/report/` (`npx playwright show-report e2e/report`) ;
- une **capture d'écran** pour tout test en échec (`test-results/**/test-failed-*.png`) ;
- une **vidéo** pour tout test en échec (`test-results/**/video.webm`) ;
- une **trace** rejouable pour tout test en échec (`npx playwright show-trace test-results/**/trace.zip`).

Rien de tout cela n'est généré pour les tests qui passent — uniquement en cas d'échec (voir `playwright.config.ts`, `screenshot`/`video`/`trace: "retain-on-failure"`).

## Hook pre-commit

Un hook Git bloque tout commit touchant `app/**` tant que cette suite n'est pas verte — voir `../../.githooks/pre-commit` à la racine du dépôt. Il est activé automatiquement par `npm install` (script `prepare` dans `package.json`, qui exécute `git config core.hooksPath .githooks`). Un commit qui ne touche que le site vitrine à la racine du dépôt n'est pas concerné et n'attend pas ce hook.

Si le serveur dev ou le conteneur Docker ne tournent pas, le hook bloque le commit avec un message explicite plutôt que d'ignorer silencieusement la vérification.

## Étendre la suite

**Règle permanente : toute nouvelle fonctionnalité ajoutée au module Audit doit s'accompagner d'un test (ou d'une extension d'un test existant) dans ce dossier.** Deux fichiers existent aujourd'hui :

- `full-lifecycle.spec.ts` — un parcours métier complet et séquentiel (prospect → devis), à étendre avec de nouvelles étapes `test.step()` quand une nouvelle action s'insère dans ce parcours (ex. un nouveau statut, un nouveau type de preuve).
- `responsive.spec.ts` — un passage desktop/tablette/mobile sur les pages clés ; ajouter une nouvelle route Audit à `PAGES` quand une nouvelle page est créée.

Pour une fonctionnalité qui ne s'insère dans aucun des deux (ex. un nouveau rôle, une nouvelle page indépendante), créer un nouveau fichier `e2e/<nom>.spec.ts` plutôt que de forcer son insertion ailleurs.

Toute donnée de test doit rester préfixée `[E2E]` (ou utiliser un identifiant reconnaissable équivalent) et être nettoyée en `afterAll` via `e2e/helpers/audit-db.ts`, jamais laissée en base — voir `cleanupE2EAudit`/`countLingeringE2EFixtures` dans ce fichier.

## Pourquoi pas de `webServer` dans playwright.config.ts

La suite tourne contre un serveur dev déjà lancé, jamais démarré par Playwright lui-même — la cible base de données (Docker local vs Supabase cloud) est une décision qui doit rester entièrement entre les mains de qui lance `npm run dev`, jamais implicite dans la config de test.
