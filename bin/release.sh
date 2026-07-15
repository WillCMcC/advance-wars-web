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
  [[ "${TODOBOY_DEPLOY_TASK:-}" =~ ^[0-9]+$ ]] || {
    echo "TODOBOY_DEPLOY_TASK must identify the merge-gated release task" >&2
    exit 1
  }
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
sync_channel=""
sync_authorization=""
sync_revision=""
site="https://mew.tail79fee7.ts.net:10443"
cleanup() {
  if [ -n "$sync_channel" ] && [ -n "$sync_authorization" ] && [ -n "$sync_revision" ]; then
    curl -fsS --max-time 10 -X DELETE \
      -H "Origin: $site" \
      -H "Authorization: Bearer $sync_authorization" \
      -H "If-Match: \"r${sync_revision}\"" \
      "$site/api/save-sync/$sync_channel/advance-wars-2-black-hole-rising" >/dev/null 2>&1 || true
  fi
  rm -f "$version_tmp" .deploy-version
  rm -rf .release-games dist
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

npm ci --omit=optional
npm test
npm run build
npm run test:build
CI=1 npm run test:e2e
rm -rf dist
"$root/bin/provision-and-deploy.sh"

for attempt in $(seq 1 30); do
  if curl -fsS --max-time 15 "$site/healthz" | grep -Fq "field kit ok" &&
    curl -fsS --max-time 15 "$site/api/healthz" | jq -e '.ok == true and .storage == "writable"' >/dev/null &&
    curl -fsS --max-time 15 "$site/version.json" |
      jq -e --arg expected "$deploy_commit" '.app == "field-kit" and .commit == $expected' >/dev/null; then
    break
  fi
  [ "$attempt" -lt 30 ] || { echo "private Field Kit commit, API, and health checks did not converge" >&2; exit 1; }
  sleep 2
done

curl -fsS --max-time 20 "$site/game-manifest.json" | jq -e '
  (.games | length) == 2
  and any(.games[]; .id == "advance-wars-2-black-hole-rising" and .rom.sha256 == "ef3cc89273f9df88020f07751ea6306b25c39df01893822fe431550eedf9b134")
  and any(.games[]; .id == "pokemon-emerald-rogue-v2-1a" and .rom.sha256 == "514d29951df8862a54381f454df0c81fa4383706f2ad1a8f5df626842e32cc34" and .save.seed_sha256 == "d0efbea53b433335125d3e006e32a1702462eed661d1fe7fdd36679a1993865a")
' >/dev/null

security_headers="$(curl -fsSI --max-time 20 "$site/")"
grep -Eiq '^cross-origin-opener-policy: same-origin\r?$' <<<"$security_headers"
grep -Eiq '^cross-origin-embedder-policy: require-corp\r?$' <<<"$security_headers"
grep -Eiq '^strict-transport-security: max-age=31536000; includeSubDomains\r?$' <<<"$security_headers"

verify_live_rom() {
  local rom_name="$1" expected_size="$2" expected_title="$3" expected_code="$4" slice headers
  slice="$(mktemp)"
  headers="$(mktemp)"
  curl -fsS --max-time 30 --range 160-175 -D "$headers" "$site/roms/$rom_name" -o "$slice"
  [ "$(awk '/^HTTP\// { status=$2 } END { print status }' "$headers")" = 206 ]
  tr -d '\r' < "$headers" | grep -Eiq "^content-range: bytes 160-175/${expected_size}$"
  [ "$(wc -c < "$slice" | tr -d ' ')" = 16 ]
  [ "$(LC_ALL=C dd if="$slice" bs=1 count=12 2>/dev/null)" = "$expected_title" ]
  [ "$(LC_ALL=C dd if="$slice" bs=1 skip=12 count=4 2>/dev/null)" = "$expected_code" ]
  rm -f "$slice" "$headers"
}
verify_live_rom advance-wars-2.gba 8388608 ADVANCEWARS2 AW2E
verify_live_rom pokemon-emerald-rogue-v2.1a.gba 33554432 "POKEMON EMER" BPEE

sync_channel="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
sync_authorization="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')"
sync_payload='{"payload":{"version":1,"iv":"AAAAAAAAAAAAAAAA","data":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}}'
sync_created="$(curl -fsS --max-time 20 -X PUT \
  -H "Origin: $site" -H "Authorization: Bearer $sync_authorization" \
  -H 'If-None-Match: *' -H 'Content-Type: application/json' --data "$sync_payload" \
  "$site/api/save-sync/$sync_channel/advance-wars-2-black-hole-rising")"
sync_revision="$(jq -er '.revision == 1 | if . then 1 else error("bad revision") end' <<<"$sync_created")"
curl -fsS --max-time 20 -H "Authorization: Bearer $sync_authorization" \
  "$site/api/save-sync/$sync_channel/advance-wars-2-black-hole-rising" |
  jq -e '.revision == 1 and .payload.version == 1' >/dev/null
sync_updated="$(curl -fsS --max-time 20 -X PUT \
  -H "Origin: $site" -H "Authorization: Bearer $sync_authorization" \
  -H 'If-Match: "r1"' -H 'Content-Type: application/json' --data "$sync_payload" \
  "$site/api/save-sync/$sync_channel/advance-wars-2-black-hole-rising")"
sync_revision="$(jq -er '.revision == 2 | if . then 2 else error("bad revision") end' <<<"$sync_updated")"
curl -fsS --max-time 20 -X DELETE \
  -H "Origin: $site" -H "Authorization: Bearer $sync_authorization" -H 'If-Match: "r2"' \
  "$site/api/save-sync/$sync_channel/advance-wars-2-black-hole-rising" >/dev/null
sync_channel=""
sync_authorization=""
sync_revision=""

public_site="https://advance-wars.3218i.com"
if curl -fsS --max-time 15 "$public_site/version.json" 2>/dev/null |
  jq -e --arg expected "$deploy_commit" '.commit == $expected' >/dev/null 2>&1; then
  echo "refusing release: the reviewed commit is exposed through the public wildcard ingress" >&2
  exit 1
fi
if curl -fsS --max-time 15 "$public_site/healthz" 2>/dev/null | tr -d '\r' | grep -Fxq 'field kit ok'; then
  echo "refusing release: the Field Kit health marker is exposed through the public wildcard ingress" >&2
  exit 1
fi
if curl -fsS --max-time 15 "$public_site/" 2>/dev/null | grep -Fq 'data-release-marker="field-kit-save-sync-v1"'; then
  echo "refusing release: the Field Kit shell is exposed through the public wildcard ingress" >&2
  exit 1
fi
for rom_name in advance-wars-2.gba pokemon-emerald-rogue-v2.1a.gba; do
  if [ "$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' --range 160-175 "$public_site/roms/$rom_name" 2>/dev/null || true)" = 206 ]; then
    echo "refusing release: $rom_name is exposed through the public wildcard ingress" >&2
    exit 1
  fi
done

backend_probe="http://mew.tail79fee7.ts.net:8092/healthz"
backend_status="$(curl -sS --connect-timeout 3 --max-time 5 -o /dev/null -w '%{http_code}' "$backend_probe" 2>/dev/null || true)"
if [ "$backend_status" != 000 ]; then
  echo "refusing release: private backend is reachable outside mew loopback (HTTP $backend_status)" >&2
  exit 1
fi

E2E_BASE_URL="$site" EXPECTED_COMMIT="$deploy_commit" npm run test:e2e:live
