#!/usr/bin/env bash
# Edit tier (AGENTS.md): typecheck after an edit to a TypeScript file of this repo.
# Called by the PostToolUse hook with the tool payload on stdin; exits 2 so Claude sees the errors.
set -uo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
file="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write(String(j.tool_input?.file_path??""))}catch{}})' 2>/dev/null)"
case "$file" in
  "$root"/src/*.ts|"$root"/test/*.ts|"$root"/e2e/*.ts) ;;
  *) exit 0 ;;
esac
if [[ ! -x "$root/node_modules/.bin/tsc" ]]; then
  echo "tsc missing: run npm install in $root" >&2
  exit 2
fi
cd "$root" && out="$(npm run --silent typecheck 2>&1)" || { echo "$out" | head -30 >&2; exit 2; }
