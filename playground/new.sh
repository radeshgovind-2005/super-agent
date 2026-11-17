#!/bin/sh
# Create a fresh Super Agent playground: the notes app at its baseline, tagged
# `baseline`, set up with `sa init`, and the 3 test tickets added and marked ready.
# Every run starts from the same point, so runs are comparable.
#
# Usage: playground/new.sh <dest> [--no-install] [--sa-command "<cmd>"]
#   --no-install   skip `npm ci` in the new repo (tests use this; workers install on their own)
#   --sa-command   how hooks and workers run sa (default: node <super-agent>/dist/cli.js)
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
DEST=""
INSTALL=1
SA_CMD="node $ROOT/dist/cli.js"

while [ $# -gt 0 ]; do
  case "$1" in
    --no-install) INSTALL=0 ;;
    --sa-command) shift; SA_CMD="$1" ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) [ -z "$DEST" ] || { echo "only one destination" >&2; exit 2; }; DEST="$1" ;;
  esac
  shift
done
[ -n "$DEST" ] || { echo "usage: playground/new.sh <dest> [--no-install] [--sa-command \"<cmd>\"]" >&2; exit 2; }
if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  echo "refusing to use $DEST: it exists and is not empty" >&2
  exit 1
fi
[ -f "$ROOT/dist/cli.js" ] || [ "$SA_CMD" != "node $ROOT/dist/cli.js" ] || {
  echo "build super-agent first: (cd $ROOT && npm run build)" >&2
  exit 1
}

sa() { sh -c "$SA_CMD \"\$@\"" sa "$@"; }

# 1. The app at baseline (without installed or built files).
mkdir -p "$DEST"
cp -R "$HERE/template/." "$DEST/"
rm -rf "$DEST/node_modules" "$DEST/dist" "$DEST/data"
cd "$DEST"
git init -q -b main
git config user.name >/dev/null 2>&1 || git config user.name "Super Agent Playground"
git config user.email >/dev/null 2>&1 || git config user.email "playground@example.invalid"
git add -A
git commit -q -m "chore: baseline notes app"
git tag baseline

if [ "$INSTALL" = 1 ]; then
  npm ci --silent --no-audit --no-fund
fi

# 2. Super Agent: state, hooks, deny/allow rules, agents, skill.
sa init --sa-command "$SA_CMD" >/dev/null

# 3. The tickets: copy their folders first (sa add keeps existing files), then register them.
mkdir -p .superagent/tickets
for dir in "$HERE"/tickets/*/; do
  name=$(basename "$dir")
  id=${name%%-*}
  cp -R "$dir" ".superagent/tickets/$name"
  title=$(sed -n '1s/^# [0-9]*: //p' "$dir/spec.md")
  after=$(awk '/^## Depends on/{on=1; next} /^## /{on=0} on && /^- [0-9]+/{sub(/^- /, ""); sub(/:.*/, ""); printf "%s%s", sep, $0; sep=","}' "$dir/spec.md")
  if [ -n "$after" ]; then
    sa add "$id" --title "$title" --after "$after" >/dev/null
  else
    sa add "$id" --title "$title" >/dev/null
  fi
done

git add .claude .gitignore .superagent/tickets
git commit -q -m "chore: set up super agent with 3 test tickets"

for dir in "$HERE"/tickets/*/; do
  name=$(basename "$dir")
  sa ready "${name%%-*}"
done

cat <<EOF

Playground ready in $DEST (tag: baseline).

Next:
  1. Give it a GitHub remote (sa submit opens PRs there), for example:
       cd $DEST && gh repo create superagent-playground --private --source . --push
  2. Start the router:  cd $DEST && claude
     then:  /superagent run
  3. Review:  /superagent review   (or: $SA_CMD report)
EOF
