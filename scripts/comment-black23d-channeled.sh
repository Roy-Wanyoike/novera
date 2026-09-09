#!/usr/bin/env bash
# Leave channeling pointer comments on BLACK23D/novera issues 2..20 + PR #21
# (close/push not possible: Roy-Wanyoike token lacks write scope on BLACK23D).
set -euo pipefail
SRC="BLACK23D/novera"
DST="Roy-Wanyoike/novera"

for n in $(seq 2 20); do
  new=$((n + 1))
  gh issue comment "$n" -R "$SRC" \
    --body "Channeled to ${DST}#${new} — all Novera engineering work now lives in the canonical repository: github.com/Roy-Wanyoike/novera. This issue continues there with full audit context." \
    && echo "commented $SRC#$n -> $DST#$new"
done

gh pr comment 21 -R "$SRC" \
  --body "Channeled: head commit aad3c49 is already merged to main on ${DST} (squash of ImgBot PR #1 pulled in after). The hygiene fix is tracked at ${DST}#17. This repo is now reference/archive." \
  && echo "commented $SRC PR #21"
