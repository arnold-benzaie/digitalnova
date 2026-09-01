# Suite Playwright — PUBLIC-MAP Audit

Suite de non-régression end-to-end. Née autour du module Audit (`app/admin/audit/**`, portail public `app/audit-report/[token]` — `full-lifecycle.spec.ts`, `responsive.spec.ts`, `audit-module-coverage.spec.ts`, `audit-permissions.spec.ts`), elle couvre aussi désormais quelques parcours de l'application principale : RBAC staff (`staff-rbac.spec.ts`), page d'attente d'accès (`access-pending.spec.ts`), file Radar CRM (`crm-radar.spec.ts`), tableau de bord performance commerciale CRM (`crm-performance.spec.ts`). Elle ne prétend pas couvrir toute l'application, et ne tourne jamais contre le site vitrine à la racine du dépôt.

## Prérequis avant de lancer la suite

0. **Une seule fois** : créer `.env.e2e.local` à la racine de `app/` (déjà ignoré par git via `.env*`) à partir de `.env.e2e.local.example`, avec les clés de l'instance Clerk **Development** — jamais les clés Production de `.env.local`. Clerk refuse par conception toute opération d'authentification navigateur depuis `localhost` avec des clés Production (« Production Keys are only allowed for domain ... ») ; c'est une protection Clerk volontaire, pas un bug, et il ne faut ni la contourner (pas de domaine `localhost` ajouté aux origines autorisées de l'instance Production) ni utiliser les clés Production en local. Une instance Development existe déjà pour ce projet — récupérer ses clés :
   ```
   vercel env pull /tmp/preview-env.env --environment=preview --git-branch=preview/public-map-audit
   grep -E "^(CLERK_SECRET_KEY|NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)=" /tmp/preview-env.env
   # copier les deux valeurs (sk_test_... / pk_test_...) dans .env.e2e.local, puis :
   shred -u /tmp/preview-env.env   # ou `rm -f` si shred indisponible — ne jamais laisser le fichier temporaire
   ```
   (Ces clés `sk_test_`/`pk_test_` sont déjà celles utilisées par l'environnement Preview de Vercel pour la branche `preview/public-map-audit` — aucune nouvelle instance Clerk à créer.) Alternative : Clerk Dashboard → sélectionner l'instance **Development** → API Keys.
   `e2e/auth-setup.mjs` charge `.env.e2e.local` en priorité sur `.env.local` et refuse de s'exécuter si la clé résolue est une clé Production (`sk_live_...`) — donc une clé Production ne peut jamais être utilisée localement, même par erreur de configuration.
1. **La suite tourne contre un serveur en mode PRODUCTION local** (`next build` + `next start`), pas `next dev` — voir « Pourquoi un serveur de production local » plus bas. Avec les clés Clerk **Development** ci-dessus, `DATABASE_URL` pointé sur la **base Docker principale locale** (`public-map-approval-test-db`, port 5434) **et** `AUDIT_DATABASE_URL` sur la base Docker Audit locale (`public-map-audit-test-db`, port 5433) — toutes indispensables. Une fois `.env.e2e.local` rempli (voir point 0, en y ajoutant aussi `DATABASE_URL` ci-dessous), **construire puis démarrer** :
   ```
   set -a && source .env.e2e.local && set +a
   npm run build:e2e        # PUBLIC_MAP_E2E=1 next build --webpack  (à relancer à chaque changement de code testé)
   npm run start:e2e        # PUBLIC_MAP_E2E=1 next start -p 3600
   ```
   ou, sans consolider dans `.env.e2e.local` :
   ```
   CLERK_SECRET_KEY="sk_test_..." \
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..." \
   DATABASE_URL="postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test" \
   AUDIT_DATABASE_URL="postgresql://postgres:localtest@localhost:5433/public_map_audit_test" \
   npm run build:e2e && \
   CLERK_SECRET_KEY="sk_test_..." NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..." \
   DATABASE_URL="postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test" \
   AUDIT_DATABASE_URL="postgresql://postgres:localtest@localhost:5433/public_map_audit_test" \
   npm run start:e2e
   ```
   `PUBLIC_MAP_E2E=1` (défini uniquement par ces deux scripts, jamais sur Vercel) réautorise dans la CSP les origines Clerk **Development** (`*.clerk.accounts.dev`, `*.accounts.dev`) — exactement la même forme qu'un déploiement Preview Vercel, `isDev` en moins. Il ne touche ni `isDev` (donc pas de `'unsafe-eval'`), ni la résolution de base de données (`db/index.ts` ne regarde que `VERCEL_ENV === "preview"` + `PREVIEW_SCHEMA_DATABASE_URL`, aucun des deux ici), ni l'authentification. Le mode production supprime **par construction** le chien de garde mémoire de `next dev` (`if (isDev)` dans `node_modules/next/dist/server/lib/start-server.js`) et la recompilation webpack à la demande — les deux causes des `net::ERR_CONNECTION_REFUSED` / `net::ERR_ABORTED` / redémarrages de worker / navigations qui n'aboutissaient pas sous `next dev`.
   La base Docker principale locale (`public_map_approval_test` sur `127.0.0.1:5434` — la même que `lib/**/*.integration.test.mjs` et `e2e/helpers/main-db-role.mjs`) porte le membership admin du compte de test (contact@public-map.com). Sans cet override, `DATABASE_URL` de `.env.local` cible la vraie base de production principale — la suite ne doit jamais y créer de données de test. Sans l'override `AUDIT_DATABASE_URL`, `.env.local` pointe vers le vrai projet Supabase Audit (cloud) : toute création faite depuis l'UI y atterrirait pendant que `e2e/helpers/env.ts` force l'harnais de test vers Docker — les deux ne se verraient plus. Symptômes typiques : fixtures qui semblent dupliquées d'un run à l'autre, ou « audit introuvable en base juste après création ».
2. Les deux conteneurs Docker de test sont démarrés :
   ```
   docker start public-map-approval-test-db public-map-audit-test-db
   ```
   (base principale `public_map_approval_test` sur port 5434 — celle que sert le serveur E2E via `DATABASE_URL` — et base Audit `public_map_audit_test` sur port 5433 ; jamais un projet Supabase cloud. `e2e/global-setup.ts` vérifie explicitement à chaque run, via `db/guard-main-production.ts`, que la cible Audit est bien locale. Cette vérification porte sur l'harnais de test lui-même, pas sur le serveur E2E déjà lancé — voir le point 1.)
3. Une session Clerk réelle est établie pour ce compte, une fois le serveur E2E prêt (démarré avec les clés Development du point 1 — sinon la session serait établie sur une instance et validée sur une autre) :
   ```
   node e2e/auth-setup.mjs
   ```
   Résout dynamiquement l'utilisateur Clerk par e-mail (`contact@public-map.com` — voir `e2e/helpers/clerk-admin.mjs`, jamais un id codé en dur : un id fige une instance Clerk précise, et devient silencieusement invalide dès que l'instance change), génère un jeton de connexion Clerk réel (API Backend Clerk, pas de mot de passe) et enregistre la session dans `playwright/.auth/local-admin.json`, réutilisée par toute la suite (`playwright.config.ts`). Le compte doit avoir un membership `admin` dans `audit_staff_memberships` sur la base Docker — voir `scripts/audit-bootstrap-first-admin.mjs` si besoin de le recréer après une réinitialisation du conteneur.

## Lancer la suite

```
npm run test:e2e            # toute la suite Playwright
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

Le dépôt utilise une **passerelle pre-commit à paliers** — voir `../../.githooks/pre-commit` à la racine du dépôt, et `../../.githooks/README.md` pour le détail de la classification des chemins. Elle est activée automatiquement par `npm install` (script `prepare` dans `package.json`, qui exécute `git config core.hooksPath .githooks` — chemin **relatif**, jamais absolu). Un commit qui ne touche que le site vitrine à la racine du dépôt n'est pas concerné.

En résumé (détail complet dans `../../.githooks/README.md`) :

- **Palier 0** — documentation (`*.md`/`*.mdx`), fichiers hors `app/`, ou changement limité à `.githooks/**` : aucune validation applicative (un changement de `.githooks/**` relance en plus l'auto-test du classifieur).
- **Palier 1** — changements applicatifs ordinaires (composants, `lib/i18n`, pages `dashboard`, assets statiques non sensibles) : `tsc --noEmit`, ESLint sur les seuls fichiers indexés, `npm run test:integrations` — tout en local, base de test locale requise.
- **Palier 1 ENHANCED** — Server Actions liées à l'autorisation (`lib/actions/**`, `lib/dev-org.ts`) : palier 1 + tests de sécurité locaux ciblés (`lib/dev-role.test.mjs`, suites `*-auth`/`*-idor` de `lib/actions/`) — toujours sans cloud ni navigateur.
- **Palier 2** — chemins sensibles (session/auth/RBAC, module Audit, routes API, layouts, arborescence DB/schéma, infra `e2e/`, fichiers de build/config) **ou tout chemin `app/**` non classé (défaut restrictif)** : palier 1, palier 1 ENHANCED, **puis** la suite Playwright Audit complète décrite ci-dessus.

Autrement dit : **la suite Playwright complète n'est PAS lancée pour chaque commit `app/**`** — uniquement au palier 2. Les prérequis Playwright (serveur E2E de production sur `localhost:3600` — `npm run build:e2e` **puis** `npm run start:e2e` selon les points 0–3 ci-dessus, conteneurs `public-map-approval-test-db` + `public-map-audit-test-db`) ne concernent que ce palier ; le hook les vérifie — il sonde le serveur et le conteneur, **exécute** `node e2e/auth-setup.mjs` (qui contacte Clerk), puis lance Playwright — et bloque le commit avec un message explicite si l'une de ces étapes échoue. Il ne construit, ne démarre ni serveur ni conteneur Docker et ne provisionne aucune infrastructure : au palier 2, penser à relancer `npm run build:e2e` si le code testé a changé depuis le dernier build.

N'utilise pas `git commit --no-verify` pour contourner un blocage : corrige l'échec réel (type / lint / test) ou démarre le prérequis local légitime manquant.

## Étendre la suite

**Règle permanente : toute nouvelle fonctionnalité du module Audit doit s'accompagner d'un test (ou d'une extension d'un test existant) dans ce dossier.** Le parcours Audit repose surtout sur deux fichiers :

- `full-lifecycle.spec.ts` — un parcours métier complet et séquentiel (prospect → devis), à étendre avec de nouvelles étapes `test.step()` quand une nouvelle action s'insère dans ce parcours (ex. un nouveau statut, un nouveau type de preuve).
- `responsive.spec.ts` — un passage desktop/tablette/mobile sur les pages clés ; ajouter une nouvelle route Audit à `PAGES` quand une nouvelle page est créée.

Pour une fonctionnalité qui ne s'insère dans aucun des deux (ex. un nouveau rôle, une nouvelle page indépendante), créer un nouveau fichier `e2e/<nom>.spec.ts` plutôt que de forcer son insertion ailleurs.

Toute donnée de test doit rester préfixée `[E2E]` (ou utiliser un identifiant reconnaissable équivalent) et être nettoyée en `afterAll` via `e2e/helpers/audit-db.ts`, jamais laissée en base — voir `cleanupE2EAudit`/`countLingeringE2EFixtures` dans ce fichier.

## Pourquoi un serveur de production local (`next start`), et pas `next dev`

`next dev` embarque un chien de garde mémoire réservé au dev (`if (isDev)` dans `node_modules/next/dist/server/lib/start-server.js`, ~ligne 233, non désactivable) : après **chaque requête**, si `v8.used_heap_size` dépasse `0,8 × heap_size_limit`, il fait `process.exit(77)` et le CLI `fork()` un nouveau worker — fenêtre sans listener sur `:3600` puis recompilation webpack à froid. Sous la suite complète (~83 tests, ~35 routes), même avec `--max-old-space-size` relevé à 16–20 Go, le pic transitoire de `used_heap` finit par franchir le seuil ; et grossir le tas allonge les pauses GC (blocages de la boucle d'événements > 180 s → `page.goto` qui n'aboutit pas). Historique : `T-1.4-A` a d'abord tenté le durcissement de `next dev` (rejeté en revue indépendante), puis est passé au mode production.

En mode production (`next build` + `next start`), `isDev` est faux : **le chien de garde n'existe pas dans le graphe de code**, il n'y a plus de recompilation à la demande ni de rétention du graphe HMR, et le tas reste de l'ordre de quelques centaines de Mo.

## Le bloc `webServer` dans playwright.config.ts est une passerelle de disponibilité, pas un constructeur

`reuseExistingServer: true` : Playwright réutilise ce qui écoute déjà sur `:3600` et se contente de sonder `/api/gbp-audit/e2e-db-target` pour vérifier que le serveur répond **avant le premier test**. Il **ne construit pas** — le workflow E2E lance `npm run build:e2e` d'abord, donc le `.next` servi correspond toujours à l'arbre de travail testé. Le `command` de repli (`npm run start:e2e`, utilisé seulement si rien n'écoute sur `:3600`) hérite de l'environnement ambiant comme un lancement manuel, et `e2e/global-setup.ts` fait échouer tout le run si la cible n'est pas la base de test Audit locale.
