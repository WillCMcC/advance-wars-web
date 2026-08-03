#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"

store="${FIELD_KIT_STORE:-$HOME/.local/share/field-kit}"
legacy_aw_store="${ADVANCE_WARS_ROM_STORE:-$HOME/.local/share/advance-wars-web/advance-wars-2.gba}"
aw_rom="$store/roms/advance-wars-2.gba"
emerald_rom="$store/roms/pokemon-emerald-rogue-v2.1a.gba"
emerald_save="$store/seeds/pokemon-emerald-rogue-v2.1a.srm"
task_aw="$HOME/brain/.data/attachments/task-573/1784075929039-b9327f28-Advance-Wars-2---Black-Hole-Rising--USA--Australia-.gba"
downloaded_emerald="$HOME/Downloads/Pokemon - Emerald Rogue (v2.1a).gba"
task_emerald_save="$HOME/brain/.data/attachments/task-595/1784089944429-391ef5aa-Pokemon---Emerald-Rogue--v2.1a-.srm"

if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "release checkout is dirty; release only a committed worktree" >&2
  git status --short >&2
  exit 1
fi
git check-ignore -q .deploy-version || { echo ".deploy-version must remain ignored" >&2; exit 1; }
git check-ignore -q .release-games/ || { echo ".release-games must remain ignored" >&2; exit 1; }

head_commit="$(git rev-parse HEAD)"
if [ -n "${TODOBOY_DEPLOY_COMMIT:-}" ]; then
  deploy_commit="$TODOBOY_DEPLOY_COMMIT"
elif [ "${ADVANCE_WARS_PROJECTS_RELEASE:-}" = 1 ]; then
  deploy_commit="$head_commit"
else
  echo "release requires the deploy train or the explicit Projects-pane release entry point" >&2
  exit 1
fi
[ "$deploy_commit" = "$head_commit" ] || { echo "TODOBOY_DEPLOY_COMMIT does not match release HEAD" >&2; exit 1; }
[[ "$deploy_commit" =~ ^[0-9a-f]{40}$ ]] || { echo "release commit is not a full Git SHA" >&2; exit 1; }

verify_input() {
  local kind="$1" file="$2" expected_size expected_sha expected_title="" expected_code=""
  case "$kind" in
    aw)
      expected_size=8388608
      expected_sha="ef3cc89273f9df88020f07751ea6306b25c39df01893822fe431550eedf9b134"
      expected_title="ADVANCEWARS2"
      expected_code="AW2E"
      ;;
    emerald)
      expected_size=33554432
      expected_sha="514d29951df8862a54381f454df0c81fa4383706f2ad1a8f5df626842e32cc34"
      expected_title="POKEMON EMER"
      expected_code="BPEE"
      ;;
    emerald-save)
      expected_size=131072
      expected_sha="d0efbea53b433335125d3e006e32a1702462eed661d1fe7fdd36679a1993865a"
      ;;
    *) return 1 ;;
  esac
  [ -f "$file" ] || return 1
  [ "$(wc -c < "$file" | tr -d ' ')" = "$expected_size" ] || return 1
  [ "$(shasum -a 256 "$file" | awk '{print $1}')" = "$expected_sha" ] || return 1
  if [ -n "$expected_title" ]; then
    [ "$(LC_ALL=C dd if="$file" bs=1 skip=160 count=12 2>/dev/null)" = "$expected_title" ] || return 1
    [ "$(LC_ALL=C dd if="$file" bs=1 skip=172 count=4 2>/dev/null)" = "$expected_code" ] || return 1
  fi
}

select_valid() {
  local kind="$1" candidate
  shift
  for candidate in "$@"; do
    [ -n "$candidate" ] || continue
    if verify_input "$kind" "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

install_durable() {
  local kind="$1" source="$2" destination="$3" temporary
  if verify_input "$kind" "$destination"; then
    chmod 0600 "$destination"
    return
  fi
  mkdir -p "$(dirname "$destination")"
  temporary="${destination}.tmp.$$"
  cp "$source" "$temporary"
  chmod 0600 "$temporary"
  verify_input "$kind" "$temporary" || { rm -f "$temporary"; return 1; }
  mv -f "$temporary" "$destination"
}

aw_source="$(select_valid aw "${ADVANCE_WARS_ROM:-}" "$aw_rom" "$legacy_aw_store" "$task_aw")" || {
  echo "verified owner-supplied Advance Wars 2 ROM is missing or changed" >&2
  exit 1
}
emerald_source="$(select_valid emerald "${EMERALD_ROGUE_ROM:-}" "$emerald_rom" "$downloaded_emerald")" || {
  echo "verified owner-supplied Emerald Rogue v2.1a ROM is missing or changed" >&2
  exit 1
}
save_source="$(select_valid emerald-save "${EMERALD_ROGUE_SAVE:-}" "$emerald_save" "$task_emerald_save")" || {
  echo "verified attached Emerald Rogue save is missing or changed" >&2
  exit 1
}

install_durable aw "$aw_source" "$aw_rom"
install_durable emerald "$emerald_source" "$emerald_rom"
install_durable emerald-save "$save_source" "$emerald_save"

version_tmp=".deploy-version.tmp.$$"
cleanup() {
  rm -f "$version_tmp" .deploy-version
  rm -rf .release-games
}
trap cleanup EXIT
printf '%s\n' "$deploy_commit" > "$version_tmp"
mv "$version_tmp" .deploy-version
mkdir -p .release-games/roms .release-games/seeds
cp "$aw_rom" .release-games/roms/advance-wars-2.gba
cp "$emerald_rom" .release-games/roms/pokemon-emerald-rogue-v2.1a.gba
cp "$emerald_save" .release-games/seeds/pokemon-emerald-rogue-v2.1a.srm
verify_input aw .release-games/roms/advance-wars-2.gba
verify_input emerald .release-games/roms/pokemon-emerald-rogue-v2.1a.gba
verify_input emerald-save .release-games/seeds/pokemon-emerald-rogue-v2.1a.srm

"$root/bin/provision-and-deploy.sh"
