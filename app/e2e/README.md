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
1. Le serveur dev tourne avec les clés Clerk **Development** ci-dessus, `DATABASE_URL` pointé sur le schéma `preview` de la base principale, **et** `AUDIT_DATABASE_URL` sur la base Docker locale — toutes indispensables. Le plus simple, une fois `.env.e2e.local` rempli (voir point 0, en y ajoutant aussi `DATABASE_URL` avec le suffixe `preview` ci-dessous) :
   ```
   set -a && source .env.e2e.local && set +a && npm run dev
   ```
   ou, sans consolider dans `.env.e2e.local` :
   ```
   CLERK_SECRET_KEY="sk_test_..." \
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..." \
   DATABASE_URL="<valeur de .env.local>?options=-c%20search_path%3Dpreview" \
   AUDIT_DATABASE_URL="postgresql://postgres:localtest@localhost:5433/public_map_audit_test" \
   npm run dev
   ```
   Le schéma `preview` de la base principale porte déjà un membership admin réel pour le compte de test (contact@public-map.com — le même utilisé par `e2e-preview/`). Sans cet override, `DATABASE_URL` cible le schéma `public` réel — la suite ne doit jamais créer de données de test dans la vraie base de production. Sans l'override `AUDIT_DATABASE_URL`, `.env.local` pointe vers le vrai projet Supabase Audit (cloud) : toute création faite depuis l'UI y atterrirait pendant que `e2e/helpers/env.ts` force l'harnais de test vers Docker — les deux ne se verraient plus. Symptômes typiques : fixtures qui semblent dupliquées d'un run à l'autre, ou « audit introuvable en base juste après création ».
2. Le conteneur Docker de test est démarré :
   ```
   docker start public-map-audit-test-db
   ```
   (base `public_map_audit_test`, port 5433 — jamais le projet Supabase cloud, voir `e2e/global-setup.ts` qui le vérifie explicitement à chaque run via `db/guard-main-production.ts`. Cette vérification porte sur l'harnais de test lui-même, pas sur le serveur dev déjà lancé — voir le point 1.)
3. Une session Clerk réelle est établie pour ce compte, une fois le serveur dev prêt (démarré avec les clés Development du point 1 — sinon la session serait établie sur une instance et validée sur une autre) :
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

Autrement dit : **la suite Playwright complète n'est PAS lancée pour chaque commit `app/**`** — uniquement au palier 2. Les prérequis Playwright (serveur dev sur `localhost:3600` démarré selon les points 0–3 ci-dessus, conteneur `public-map-audit-test-db`) ne concernent que ce palier ; le hook les vérifie — il sonde le serveur et le conteneur, **exécute** `node e2e/auth-setup.mjs` (qui contacte Clerk), puis lance Playwright — et bloque le commit avec un message explicite si l'une de ces étapes échoue. Il ne démarre jamais de serveur ni de conteneur Docker et ne provisionne aucune infrastructure.

N'utilise pas `git commit --no-verify` pour contourner un blocage : corrige l'échec réel (type / lint / test) ou démarre le prérequis local légitime manquant.

## Étendre la suite

**Règle permanente : toute nouvelle fonctionnalité du module Audit doit s'accompagner d'un test (ou d'une extension d'un test existant) dans ce dossier.** Le parcours Audit repose surtout sur deux fichiers :

- `full-lifecycle.spec.ts` — un parcours métier complet et séquentiel (prospect → devis), à étendre avec de nouvelles étapes `test.step()` quand une nouvelle action s'insère dans ce parcours (ex. un nouveau statut, un nouveau type de preuve).
- `responsive.spec.ts` — un passage desktop/tablette/mobile sur les pages clés ; ajouter une nouvelle route Audit à `PAGES` quand une nouvelle page est créée.

Pour une fonctionnalité qui ne s'insère dans aucun des deux (ex. un nouveau rôle, une nouvelle page indépendante), créer un nouveau fichier `e2e/<nom>.spec.ts` plutôt que de forcer son insertion ailleurs.

Toute donnée de test doit rester préfixée `[E2E]` (ou utiliser un identifiant reconnaissable équivalent) et être nettoyée en `afterAll` via `e2e/helpers/audit-db.ts`, jamais laissée en base — voir `cleanupE2EAudit`/`countLingeringE2EFixtures` dans ce fichier.

## Pourquoi pas de `webServer` dans playwright.config.ts

La suite tourne contre un serveur dev déjà lancé, jamais démarré par Playwright lui-même — la cible base de données (Docker local vs Supabase cloud) est une décision qui doit rester entièrement entre les mains de qui lance `npm run dev`, jamais implicite dans la config de test.
