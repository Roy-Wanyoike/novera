#!/usr/bin/env bash
# Channel audit issues from BLACK23D/novera to Roy-Wanyoike/novera.
# Usage:
#   scripts/channel-issues-to-roy.sh fetch     # dump issues 1..20 to .tmp/issues/
#   scripts/channel-issues-to-roy.sh labels    # create custom labels on destination
#   scripts/channel-issues-to-roy.sh create    # recreate issues in same order (same numbers)
set -euo pipefail

SRC="BLACK23D/novera"
DST="Roy-Wanyoike/novera"
DIR="/home/z/my-project/.tmp/issues"
N_MAX="${N_MAX:-20}"

do_fetch() {
  mkdir -p "$DIR"
  for n in $(seq 1 "$N_MAX"); do
    gh issue view "$n" -R "$SRC" --json title --jq .title > "$DIR/$n.title"
    gh issue view "$n" -R "$SRC" --json body --jq .body \
      | sed 's#github.com/BLACK23D/novera#github.com/Roy-Wanyoike/novera#g' > "$DIR/$n.body"
    gh issue view "$n" -R "$SRC" --json labels --jq '[.labels[].name] | join(",")' > "$DIR/$n.labels"
    gh issue view "$n" -R "$SRC" --json comments --jq '[.comments[] | {"author": .author.login, "body": .body}] | length' > "$DIR/$n.ncmts"
    if [ "$(cat "$DIR/$n.ncmts")" != "0" ]; then
      gh issue view "$n" -R "$SRC" --json comments \
        --jq '.comments[] | "---\n**Migrated comment by " + .author.login + ":**\n\n" + .body' >> "$DIR/$n.body"
    fi
    echo "fetched #$n: $(cat "$DIR/$n.title")"
  done
}

do_labels() {
  declare -A L=(
    [kernel]="#5319e7" [api]="#1d76db" [security]="#d93f0b"
    [frontend]="#0e8a16" [docs]="#0075ca" [hygiene]="#b60205"
    [P1]="#e11d48" [P2]="#fbca04" [P3]="#cccccc" [accessibility]="#f143ab"
  )
  for name in "${!L[@]}"; do
    gh label create "$name" -R "$DST" --color "${L[$name]:1}" 2>/dev/null \
      && echo "created label $name" || echo "label $name: exists/kept"
  done
}

do_create() {
  for n in $(seq 1 "$N_MAX"); do
    title="$(cat "$DIR/$n.title")"
    labels="$(cat "$DIR/$n.labels")"
    url="$(gh issue create -R "$DST" --title "$title" --body-file "$DIR/$n.body" --label "$labels")"
    got="${url##*/}"
    if [ "$got" != "$n" ]; then
      echo "WARNING: issue #$n became #$got on destination (numbering drifted!)"
    else
      echo "created $DST#$got  <-  $SRC#$n : $title"
    fi
  done
}

case "${1:-}" in
  fetch) do_fetch ;;
  labels) do_labels ;;
  create) do_create ;;
  *) echo "usage: $0 {fetch|labels|create}"; exit 1 ;;
esac
