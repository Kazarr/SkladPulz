#!/usr/bin/env bash
# Copies pinned upstream files into this repo, as listed in vendor.txt at the repo root:
#   <dest> <git-url> <path-in-upstream> <commit|HEAD>
#   vendor.sh          re-copy every entry at its pinned commit (HEAD gets pinned to a real commit)
#   vendor.sh update   move every entry to its upstream's default-branch tip and re-pin
# Vendored files are never edited by hand. Review what changed with `git diff`.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
mode=${1:-sync}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fetch() { # <url> <ref>: prints a checkout dir, one fetch per url+ref
  local dir
  dir="$tmp/$(printf '%s@%s' "$1" "$2" | cksum | cut -d' ' -f1)"
  if [[ ! -d $dir ]]; then
    git init -q "$dir"
    git -C "$dir" fetch -q --depth 1 "$1" "$2"
    git -C "$dir" -c advice.detachedHead=false -c core.autocrlf=false checkout -q FETCH_HEAD
  fi
  printf '%s' "$dir"
}

pinned="$tmp/vendor.txt"
while IFS= read -r line || [[ -n $line ]]; do
  read -r dest url path ref _ <<<"$line"
  if [[ -z ${dest:-} || $dest == \#* ]]; then
    printf '%s\n' "$line" >>"$pinned"
    continue
  fi
  [[ $mode == update ]] && ref=HEAD
  src=$(fetch "$url" "$ref")
  sha=$(git -C "$src" rev-parse HEAD)
  # rm before cp: a fresh inode keeps a running copy of this script intact
  rm -rf "$dest"
  mkdir -p "$(dirname "$dest")"
  cp -R "$src/$path" "$dest"
  if [[ -d $dest && ! -e $dest/LICENSE && -e $src/LICENSE ]]; then
    cp "$src/LICENSE" "$dest/LICENSE"
  fi
  printf '%s %s %s %s\n' "$dest" "$url" "$path" "$sha" >>"$pinned"
  echo "$dest <- $path @ ${sha:0:7}"
done <vendor.txt
cp "$pinned" vendor.txt
