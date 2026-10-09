# Limites connues de la suite E2E sous WebKit et Firefox

- **Statut** : décision — investigation causale close, réouvrable (voir § 8)
- **Date** : 2026-10-09
- **Périmètre** : suite Playwright [`e2e/`](../e2e/) exécutée en local contre `next start`
  (port 3600), avec l'instance Clerk **Development** configurée par `.env.e2e.local`
- **Investigations de référence** : missions 4F.8.11-C à 4F.8.11-Q

---

## 1. Résumé

Sous WebKit, certains tests qui enchaînent une redirection côté client après une page
refusée échouent de manière intermittente : la session Clerk est perdue et le navigateur
aboutit sur la page de connexion Clerk. Tests concernés observés :
[`e2e/audit-permissions.spec.ts:42`](../e2e/audit-permissions.spec.ts) (rôle supervisor,
principalement) et [`e2e/session-authority.spec.ts:60`](../e2e/session-authority.spec.ts).

La chaîne ci-dessous est reconstituée à partir de plusieurs runs concordants : toutes ses
étapes n'ont pas été observées dans une seule et même exécution (par exemple, l'absence du
cookie suffixé a été relevée par le proxy HTTP, tandis que la raison `dev-browser-missing`
provient des traces d'autres runs en échec).

Chaîne observée côté serveur, avec l'instance Clerk **Development** :

1. une navigation de document `GET /admin/audit` arrive avec 5 des 6 cookies Clerk ;
   le cookie dev-browser suffixé `__clerk_db_jwt_<suffixe>` est absent ;
2. en mode « cookies suffixés », le middleware Clerk ne lit que la variante suffixée du
   dev-browser et ne retombe pas sur `__clerk_db_jwt` ; il conclut `dev-browser-missing` ;
3. il déclenche un handshake Clerk sans dev-browser ; Clerk crée un nouveau dev-browser
   déconnecté (`__client_uat=0`, `__session_<suffixe>` supprimé) ;
4. redirection vers la page de connexion Clerk : le test expire.

Les refus d'accès applicatifs fonctionnent correctement avant la perte de session : il ne
s'agit pas d'une régression d'autorisation.

## 2. Faits confirmés

- **F1** — L'échec WebKit est une perte de session Clerk, non un défaut d'autorisation :
  les redirections de refus (`/admin/users` → `/admin`, pages admin Audit → `/admin/audit`)
  sont correctes avant la perte de session.
- **F2** — La requête déclenchante arrive au serveur sans `__clerk_db_jwt_<suffixe>`, les
  5 autres cookies Clerk étant présents ; une server action émise 27 ms plus tôt depuis la
  même page portait les 6 cookies (observation par proxy HTTP transparent, noms de cookies
  uniquement).
- **F3** — `@clerk/backend` 3.11.2 : en mode suffixé, `getSuffixedOrUnSuffixedCookie` ne lit
  que le cookie suffixé ; sans dev-browser, une instance Development renvoie
  `dev-browser-missing` et lance un handshake sans paramètre dev-browser.
- **F4** — Le mécanisme de dev-browser et la raison `dev-browser-missing` sont, dans le code
  inspecté, propres aux instances Clerk Development (conditions
  `instanceType === "development"` côté serveur ; `setupProduction()` vide le dev-browser
  côté clerk-js). Le mécanisme observé est donc lié à l'instance Development utilisée en
  E2E. Le comportement en Preview et en production **n'a pas été évalué**.
- **F5** — `@clerk/clerk-js` 6.25.3 (version épinglée par `__internal_clerkJSVersion` dans
  [`app/layout.tsx`](../app/layout.tsx)) : toute écriture du dev-browser supprime d'abord le
  cookie suffixé puis le non suffixé, puis les réécrit. Déclencheurs identifiés dans le
  code : `environment:update` → `refreshCookies()`, réponse FAPI portant l'en-tête
  `Clerk-Db-Jwt`, `setup()`, `handleUnauthenticatedDevBrowser()`.
- **F6** — Sur les pages concernées, `redirect()` est exécuté après le début du streaming
  (limite Suspense de [`app/admin/audit/loading.tsx`](../app/admin/audit/loading.tsx)) :
  réponse 200 + `meta-refresh` (1 s) + redirection RSC côté client. La page refusée est
  quittée ~285 ms après l'insertion du meta, donc pas par le `meta-refresh`.
- **F7** — Le défaut est intermittent : les runs WebKit ciblés sont tantôt en échec, tantôt
  réussis.
- **F8** — Les relevés navigateur « requête sans aucun cookie » (`request.allHeaders()`) sur
  les navigations interrompues étaient un artefact de mesure, contredit par le proxy.
- **F9** — Chromium passe la suite complète sur tous les commits récents (124 réussis et
  1 ignoré conditionnel, puis 129 réussis et 1 ignoré avec la spec
  `crm-radar-website-promotion`).
- **F10** — Firefox ne démarre pas dans le bac à sable d'exécution utilisé
  (`browserType.launch` : timeout, `Operation not permitted`) : aucun test Firefox n'y a
  réellement été exécuté.

## 3. Hypothèses (non démontrées)

- **H1** — La réécriture des cookies dev-browser par clerk-js (F5) coïncide avec le départ
  de la navigation de redirection, et WebKit transmet un état intermédiaire où seul le
  cookie suffixé est absent. Le code permet cet état ; aucun run n'a établi la coïncidence
  (le dernier run instrumenté a réussi et n'a observé aucune réponse `/v1/environment`
  complète).
- **H2** — La propagation des écritures `document.cookie` vers le processus réseau de
  WebKit rend cet état intermédiaire observable par une requête de navigation.
- **H3** — L'écart entre clerk-js 6.25.3 (épinglé) et les SDK serveur plus récents
  (`@clerk/nextjs` 7.5.15, `@clerk/backend` 3.11.2) contribue au comportement.

Aucune de ces hypothèses n'est une cause confirmée. **La cause profonde n'est pas établie.**

## 4. Questions ouvertes

- **Q1** — Quel code retire effectivement `__clerk_db_jwt_<suffixe>` au moment de la requête
  fautive ?
- **Q2** — Quelle est l'origine du second document `/admin/audit/equipe` observé côté
  navigateur (le serveur n'en a servi aucun) ?
- **Q3** — Le comportement se produit-il hors de l'environnement E2E local (Safari réel,
  instance Clerk de Preview ou de production) ? Non évalué : aucune conclusion n'est tirée,
  ni dans un sens ni dans l'autre.

## 5. Couverture effective de la suite E2E

| Navigateur | État | Interprétation |
|---|---|---|
| Chromium | validé, bloquant dans le hook pre-commit | couverture de référence |
| WebKit | intermittent (perte de session Clerk Development, § 1) | **non validé** |
| Firefox | non exécutable dans le bac à sable d'exécution actuel | **non testé** |

## 6. Décision

- Le hook pre-commit est utilisé avec `PUBLIC_MAP_PLAYWRIGHT_PROJECTS=chromium`
  (voir [`.githooks/README.md`](../../.githooks/README.md)) : Tier 1, Tier 1 ENHANCED et
  Tier 2 restent obligatoires ; seul le projet Playwright exécuté est restreint.
- Chromium reste bloquant.
- WebKit et Firefox ne doivent **pas** être présentés comme validés pour un commit, une PR
  ou une livraison ; tout rapport de validation doit mentionner « Chromium uniquement ».
- Aucune modification de l'authentification, de la configuration Clerk ou des tests n'est
  décidée sur la base des preuves actuelles.

## 7. Risques résiduels

- Une régression réellement spécifique à WebKit/Safari ou à Firefox ne sera pas détectée
  par le hook.
- Le comportement hors environnement E2E local n'est pas évalué (Q3). F4 indique que le
  mécanisme observé repose sur une instance Development, mais cela ne démontre ni
  l'absence ni la présence d'un problème en Preview ou en production ; le risque n'est pas
  considéré comme nul.
- Les relances manuelles de la suite WebKit continueront de produire des échecs
  intermittents, à interpréter à l'aide de cette note.

## 8. Conditions de réouverture

Réouvrir l'investigation si l'un des cas suivants survient :

1. un échec WebKit E2E **sans** la chaîne `dev-browser-missing` décrite au § 1 ;
2. un problème de session confirmé sous Safari en Preview ou en production ;
3. un changement de version de Clerk (`__internal_clerkJSVersion` dans `app/layout.tsx`,
   `@clerk/nextjs`, `@clerk/backend`) ou de la gestion de session ;
4. une exigence de couverture Safari/WebKit en E2E — prévoir alors une campagne dédiée de
   runs instrumentés, avec un critère de corrélation fixé à l'avance.

## 9. Preuves

Le raisonnement, les chronologies et les commandes figurent dans les rapports des missions
**4F.8.11-C à 4F.8.11-Q**.

Les artefacts produits pendant ces missions (journaux de hook, traces Playwright WebKit,
observateurs de cookies, journal du proxy HTTP, archive `@clerk/clerk-js@6.25.3` vérifiée
par les sommes sha1/sha512 du registre npm) ont été conservés dans le répertoire de travail
temporaire de la session (scratchpad, dossiers `4f811c` à `4f811p`). Ces artefacts sont
**temporaires, non versionnés et non durables** : cette note ne dépend pas de leur
disponibilité. Ils ne contenaient aucune valeur de cookie ou de jeton en clair (valeurs
masquées ou jamais enregistrées).

| Mission | Apport principal |
|---|---|
| C | hook complet 3 navigateurs : Chromium vert, Firefox non lancé, 5 échecs WebKit |
| D | tri : perte de session Clerk, pas de régression d'autorisation |
| F | run WebKit ciblé : 4/5, supervisor en échec |
| H | chaîne `dev-browser-missing` dans toutes les traces d'échec |
| I | stockage navigateur : 6 cookies présents au moment de l'échec |
| J | mécanisme Next.js : streaming + `meta-refresh` + redirection côté client |
| K | départ de la page avant le délai du `meta-refresh` |
| L | absence de journalisation serveur par requête |
| M | proxy transparent : cookie `__clerk_db_jwt_<suffixe>` absent sur la requête fautive |
| N | logique serveur Clerk : lecture exclusive du cookie suffixé |
| O | clerk-js 6.25.3 : suppression puis réécriture du cookie dev-browser |
| P | corrélation tentée : run réussi, aucune réponse `/v1/environment` complète |
| Q | synthèse et décision |
