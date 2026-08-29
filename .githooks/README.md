# Vérifications pre-commit

Ce dossier contient le hook `pre-commit` du dépôt et son auto-test.

Le hook applique une **passerelle à paliers** : il classe les chemins indexés,
retient le palier le plus élevé requis, et n'exécute que les vérifications
nécessaires à ce palier. La suite navigateur Playwright complète n'est donc
lancée que pour les changements sensibles (palier 2), pas pour chaque commit
`app/**`.

`.githooks/pre-commit` est la source de vérité : ce README le résume, il ne le
remplace pas.

## Activation

```
npm install
```

exécute le script `prepare` de `app/package.json`, qui lance :

```
git config core.hooksPath .githooks
```

- Le chemin **doit rester relatif** (`.githooks`), jamais un chemin absolu vers
  un seul checkout.
- Avec les *worktrees* Git, un `core.hooksPath` relatif se résout dans **chaque
  worktree** : chacun exécute donc la version du hook correspondant à son propre
  code indexé. Un worktree sur un commit plus ancien exécute son propre hook plus
  ancien ; modifier les fichiers `.githooks/` d'un worktree ne change pas la copie
  d'un autre worktree.
- `core.hooksPath` est une configuration **partagée** par tous les worktrees du
  dépôt (une seule valeur).

Vérifier :

```
git config --get core.hooksPath      # doit afficher : .githooks
```

## Les quatre paliers

| Palier | Déclencheurs (max sur tous les chemins indexés) | Vérifications | Prérequis externes |
| --- | --- | --- | --- |
| **0** | `*.md` / `*.mdx` ; fichiers hors `app/` ; changement limité à `.githooks/**` | Aucune validation applicative. Un changement de `.githooks/**` relance en plus l'auto-test du classifieur. | aucun |
| **1** | code applicatif ordinaire : `app/components/**`, `app/lib/i18n/**`, pages `app/app/dashboard/**`, assets statiques non sensibles (`*.css`, images, polices) | `tsc --noEmit --incremental false` ; ESLint sur les **seuls fichiers JS/TS indexés** (sans `--fix`, sans `--cache`) ; `npm run test:integrations` | base de test locale (voir plus bas) |
| **1 ENHANCED** | `app/lib/actions/**` ou `app/lib/dev-org.ts` | palier 1 **+** `lib/dev-role.test.mjs` **+** toutes les suites découvertes `lib/actions/*-auth.integration.test.mjs` et `lib/actions/*-idor.integration.test.mjs` | même base locale — **aucun cloud, aucun navigateur** |
| **2** | session/auth/RBAC (`app/lib/session.ts`, `app/lib/dev-role.ts`, `app/lib/admin-access.ts`, `app/proxy.ts`, `app/middleware.ts`, shell admin `app/components/app-shell*` / `app-sidebar-nav*`) ; module Audit (`app/app/admin/**`, `app/app/audit-report/**`, `app/lib/gbp-audit/**`) ; routes API (`app/app/api/**`) ; layouts d'arborescence (`app/app/**layout.tsx`) ; DB (`app/db/**`) ; infra E2E (`app/e2e/**` hors `*.md`) ; fichiers de build/config (`app/package.json`, `app/tsconfig*.json`, `app/eslint.config.*`, `app/next.config.*`, `app/playwright*.config.*`, `app/drizzle*.config.*`) ; **tout chemin `app/**` non classé** | palier 1, **puis** palier 1 ENHANCED, **puis** la chaîne Playwright Audit complète (les tests des paliers 1 et 1 ENHANCED tournent pour *tout* commit de palier 2) | environnement E2E (voir plus bas) |

Le palier 1 ENHANCED donne au code adjacent à l'autorisation une couverture de
sécurité **locale** plus forte, sans imposer d'E2E navigateur/cloud. Le
`DATABASE_URL` des processus de test de ce palier est **forcé** vers la base de
test locale, quelle que soit la valeur héritée du shell.

### Précédence et défaut restrictif

- Chaque chemin indexé est classé indépendamment.
- Le commit exécute le **palier le plus élevé** requis par l'ensemble indexé.
- Les règles sensibles sont évaluées en premier : un sous-chemin sensible ne peut
  pas être « avalé » par une règle plus large.
- Un chemin sous `app/**` qui ne correspond à aucune règle connue tombe en
  **palier 2** (défaut restrictif).
- `*.md` / `*.mdx` sont en palier 0 **quel que soit** leur emplacement.

**Limitation connue (comportement actuel, pas une garantie de sécurité) :** les
chemins **hors `app/`** à la racine du dépôt (`.github/workflows/**`,
`Dockerfile`, `vercel.json`, etc.) classent aujourd'hui en palier 0. Le hook a
toujours été limité au périmètre `app/`.

## Base de test locale (paliers 1 et 1 ENHANCED)

Identifiants (non secrets, déjà codés en dur dans le hook et les
`*.integration.test.mjs`) :

- hôte : `127.0.0.1`
- port : `5434`
- base : `public_map_approval_test`
- conteneur : `public-map-approval-test-db`

Démarrer si nécessaire :

```
docker start public-map-approval-test-db
```

Le hook **sonde** cette base et **bloque le commit** avec un message explicite si
elle est injoignable. **Il ne démarre pas Docker lui-même.**

## Prérequis du palier 2

Le palier 2 exécute la chaîne E2E existante. D'après le hook, il faut que soient
**déjà** en place :

- un serveur dev joignable sur `http://localhost:3600` (démarré selon
  `../app/e2e/README.md` : schéma `preview` + clés Clerk **Development**) ;
- le conteneur `public-map-audit-test-db` démarré ;
- une session Clerk réelle établie via `node e2e/auth-setup.mjs` ;
- puis `npx playwright test`.

Le hook **vérifie** ces prérequis : il sonde le serveur dev et le conteneur,
**exécute** `e2e/auth-setup.mjs` (qui contacte Clerk pour établir la session
Playwright), puis lance `npx playwright test`. Il bloque le commit si l'une de ces
étapes échoue. Il ne démarre **jamais** de serveur dev ni de conteneur Docker, et
ne provisionne aucune infrastructure.

Aucune clé, aucun secret et aucun identifiant Preview/Production ne figure ici ni
dans le hook — voir `../app/e2e/README.md` pour la configuration détaillée.

## Auto-test du classifieur

```
bash .githooks/pre-commit.classify.test.sh
```

Toutes les assertions doivent passer. Utile après avoir modifié le hook.
Le hook exécute automatiquement cet auto-test dès qu'un fichier `.githooks/**`
est indexé dans le commit.

## Ne pas contourner

N'utilise **pas** `git commit --no-verify` pour passer outre un blocage. À la
place :

- corrige l'échec réel (erreur de type, de lint ou de test) ;
- ou remets en place le prérequis local légitime manquant (conteneur Docker ;
  pour le palier 2, le serveur dev).

## Dépannage

| Symptôme | Action |
| --- | --- |
| `ECHEC : base de test locale injoignable sur 127.0.0.1:5434` | `docker start public-map-approval-test-db` |
| Palier 2 : `le serveur dev ... ne repond pas` | démarrer le serveur dev selon `../app/e2e/README.md` (schéma `preview`) |
| Palier 2 : `impossible d'etablir une session Clerk reelle` | `.env.e2e.local` absent/incomplet ou clé Production résolue — voir `../app/e2e/README.md`, point 0 |
| Palier 2 : test Playwright en échec | `npx playwright show-report e2e/report` |
| Palier inattendu | `bash .githooks/pre-commit.classify.test.sh` ; rappel : tout chemin `app/**` non reconnu tombe en palier 2 |
| Hook non exécuté | `git config --get core.hooksPath` doit valoir `.githooks` ; relancer `npm install` sinon |
