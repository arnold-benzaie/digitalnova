#!/usr/bin/env bash
# Self-test for the pure path classifier in .githooks/pre-commit.
#
# Sources the WORKTREE copy of the hook, resolved from THIS file's own
# directory -- never core.hooksPath, never the main checkout. Pure string
# assertions only: never touches the git index, never runs tsc / eslint /
# tests / curl / docker / clerk / playwright. Exits non-zero on any
# classifier mismatch.
#
# Run:  bash .githooks/pre-commit.classify.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/pre-commit"
if [ ! -f "$HOOK" ]; then
  echo "FAIL: hook introuvable a cote du test : $HOOK"
  exit 1
fi
# shellcheck source=/dev/null
. "$HOOK"

fails=0
pass=0

expect_single() {  # expect_single <tier> <path>
  local want="$1" path="$2" got
  got="$(classify_path "$path")"
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
    printf 'ok    %-3s  %s\n' "$want" "$path"
  else
    fails=$((fails + 1))
    printf 'FAIL  want=%-3s got=%-3s  %s\n' "$want" "$got" "$path"
  fi
}

expect_set() {  # expect_set <tier> [<path> ...]   (zero paths => tests the empty case)
  local want="$1"; shift
  local got
  got="$(classify_paths "$@")"
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
    printf 'ok    %-3s  {%s}\n' "$want" "$*"
  else
    fails=$((fails + 1))
    printf 'FAIL  want=%-3s got=%-3s  {%s}\n' "$want" "$got" "$*"
  fi
}

expect_rank() {  # expect_rank <rank> <tier-token>
  local want="$1" tok="$2" got
  got="$(_tier_rank "$tok")"
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
    printf 'ok    rank=%s  token=%s\n' "$want" "$tok"
  else
    fails=$((fails + 1))
    printf 'FAIL  want-rank=%s got=%s  token=%s\n' "$want" "$got" "$tok"
  fi
}

# --- T-1.2 required matrix ------------------------------------------------
expect_set    0  index.html cart.js                                    # A
expect_single 1E app/lib/actions/crm-tasks.ts                          # B
expect_single 1E app/lib/dev-org.ts                                    # C
expect_single 2  app/lib/session.ts                                    # D
expect_single 2  "app/app/admin/crm/clients/[id]/page.tsx"             # E
expect_single 2  app/db/schema.ts                                      # F
expect_single 2  app/e2e/full-lifecycle.spec.ts                        # G1
expect_single 0  app/e2e/README.md                                     # G2
expect_single 2  app/lib/payments/charge.ts                            # H (default-deny)
expect_single 0  .githooks/pre-commit                                  # I
expect_set    2  app/lib/actions/gbp.ts app/lib/session.ts             # mixed -> max
expect_set    0  README.md app/docs/foo.md                             # docs mixed

# --- precedence: a sensitive subpath must never be swallowed ------------
expect_single 2  app/lib/gbp-audit/foo.ts
expect_single 2  app/app/dashboard/foo/layout.tsx
expect_single 1  app/components/foo.tsx
expect_single 1  app/lib/i18n/fr.ts

# --- extra: sensitive set ---------------------------------------------
expect_single 2  app/proxy.ts
expect_single 2  app/middleware.ts
expect_single 2  app/lib/dev-role.ts
expect_single 2  app/lib/admin-access.ts
expect_single 2  app/db/migrations/0034_something.sql
expect_single 2  app/db/audit-schema.ts
expect_single 2  app/db/guard-local-only.ts
expect_single 2  app/app/api/health/route.ts
expect_single 2  "app/app/audit-report/[token]/page.tsx"
expect_single 2  app/package.json
expect_single 2  app/tsconfig.json
expect_single 2  app/eslint.config.mjs
expect_single 2  app/next.config.ts
expect_single 2  app/playwright.config.ts
expect_single 2  app/drizzle-audit.config.ts
expect_single 2  app/e2e/helpers/env.ts
expect_single 2  app/components/app-shell.tsx
expect_single 2  app/components/app-shell-client.tsx
expect_single 2  app/components/app-sidebar-nav.tsx
expect_single 2  app/app/layout.tsx

# --- extra: Tier 1 ENHANCED -----------------------------------------
expect_single 1E app/lib/actions/gbp-idor.integration.test.mjs
expect_single 1E app/lib/actions/crm-gbp.ts
expect_set    1E app/lib/actions/gbp.ts app/lib/i18n/en.ts

# --- extra: Tier 1 -------------------------------------------------
expect_single 1  app/app/dashboard/foo/page.tsx
expect_single 1  app/components/ui/button.tsx
expect_single 1  app/lib/i18n/dictionaries/fr.ts

# --- extra: Tier 0 (documentation + hooks + non-app root only) -------
expect_single 0  app/e2e/helpers/notes.md            # *.md -> 0 even under e2e
expect_single 0  app/lib/actions/README.md           # *.md -> 0 even under lib/actions
expect_single 0  docs/architecture.md
expect_single 0  .githooks/pre-commit.classify.test.sh
expect_single 1  app/app/globals.css                 # NOTE: css is NOT Tier 0 anymore -> Tier 1 asset

# --- default-deny: other unclassified app paths -----------------
expect_single 2  app/lib/webhooks.ts
expect_single 2  app/lib/notifications.ts
expect_single 2  app/scripts/generate-n8n-templates.mjs
expect_single 2  app/hooks/use-thing.ts

# --- realistic AF-1-like staged set -> overall 1E --------------
expect_set    1E app/lib/actions/analytics.ts app/lib/actions/gbp.ts app/lib/actions/search-console.ts app/lib/dev-org.ts app/lib/actions/gbp-idor.integration.test.mjs

# --- M1: static assets follow their PATH, not their extension --------
# Only *.md / *.mdx are universally Tier 0. A stylesheet / text file /
# image under a sensitive tree keeps that tree's Tier 2.
expect_single 2  app/app/admin/x.css                 # admin surface -> 2
expect_single 2  app/e2e/fixture.txt                 # e2e infra -> 2 (.txt never allowlisted)
expect_single 2  app/db/seed.txt                     # db tree -> 2
expect_single 1  app/components/foo.css              # non-sensitive tree -> Tier 1 asset
expect_single 1  app/app/dashboard/theme.css         # non-sensitive tree -> Tier 1 asset
expect_single 1  app/public/logo.svg                 # non-sensitive tree -> Tier 1 asset
expect_single 2  app/public/runtime-config.txt       # .txt under app/ -> default-deny Tier 2
expect_single 1E app/lib/actions/diagram.svg         # asset rule must NOT override 1E for lib/actions/**
expect_single 2  app/app/admin/logo.svg              # asset under admin -> still Tier 2

# --- M1: terminal doc-extension semantics ---------------------------
expect_single 0  README.md                           # doc -> 0
expect_single 0  app/e2e/README.md                   # doc -> 0 (even under e2e)
expect_single 0  foo.md.ts                           # 0 by NON-APP-ROOT rule, NOT because it is a doc
expect_single 2  app/lib/foo.md.ts                   # under app/, ends .ts -> non-doc, default-deny Tier 2
expect_single 2  app/lib/foo.md.json                 # under app/, ends .json -> default-deny Tier 2
expect_single 0  README.md.exe                       # 0 by NON-APP-ROOT rule, NOT because it is a doc

# --- .mts / .cts classify like any other TS-family file ------------
expect_single 1  app/lib/i18n/foo.mts                # i18n tree -> Tier 1
expect_single 1E app/lib/actions/foo.cts             # lib/actions/** -> Tier 1 ENHANCED

# --- defensive contract: unknown token / empty input -------------
expect_rank   3  ZZZ                                  # unknown tier token -> most severe rank
expect_rank   3  2
expect_rank   2  1E
expect_rank   1  1
expect_rank   0  0
expect_set    0                                       # classify_paths with NO args -> 0

echo ""
echo "classifier self-test: $pass ok, $fails fail"
if [ "$fails" -ne 0 ]; then
  echo "CLASSIFIER SELF-TEST: FAIL"
  exit 1
fi
echo "CLASSIFIER SELF-TEST: PASS"
exit 0
