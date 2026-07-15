#!/usr/bin/env bash
set -euo pipefail
umask 077

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"

expected_sha="ef3cc89273f9df88020f07751ea6306b25c39df01893822fe431550eedf9b134"
expected_size=8388608
rom_name="advance-wars-2.gba"
durable_rom="${ADVANCE_WARS_ROM_STORE:-$HOME/.local/share/advance-wars-web/$rom_name}"
task_rom="$HOME/brain/.data/attachments/task-573/1784075929039-b9327f28-Advance-Wars-2---Black-Hole-Rising--USA--Australia-.gba"

if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  echo "release checkout is dirty; release only a committed worktree" >&2
  git status --short >&2
  exit 1
fi
git check-ignore -q .deploy-version || { echo ".deploy-version must remain ignored" >&2; exit 1; }
git check-ignore -q .release-rom/ || { echo ".release-rom must remain ignored" >&2; exit 1; }

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

verify_rom() {
  local file="$1" actual_size actual_sha title code
  [ -f "$file" ] || return 1
  actual_size="$(wc -c < "$file" | tr -d ' ')"
  [ "$actual_size" = "$expected_size" ] || return 1
  actual_sha="$(shasum -a 256 "$file" | awk '{print $1}')"
  [ "$actual_sha" = "$expected_sha" ] || return 1
  title="$(LC_ALL=C dd if="$file" bs=1 skip=160 count=12 2>/dev/null)"
  code="$(LC_ALL=C dd if="$file" bs=1 skip=172 count=4 2>/dev/null)"
  [ "$title" = "ADVANCEWARS2" ] && [ "$code" = "AW2E" ]
}

rom_source="${ADVANCE_WARS_ROM:-}"
if [ -z "$rom_source" ] && verify_rom "$durable_rom"; then
  rom_source="$durable_rom"
fi
if [ -z "$rom_source" ] && verify_rom "$task_rom"; then
  rom_source="$task_rom"
fi
verify_rom "$rom_source" || {
  echo "verified owner-supplied Advance Wars 2 ROM is missing or changed" >&2
  echo "set ADVANCE_WARS_ROM to the AW2E01 Rev.00 cartridge image" >&2
  exit 1
}

if ! verify_rom "$durable_rom"; then
  mkdir -p "$(dirname "$durable_rom")"
  durable_tmp="${durable_rom}.tmp.$$"
  cp "$rom_source" "$durable_tmp"
  chmod 0600 "$durable_tmp"
  verify_rom "$durable_tmp" || { rm -f "$durable_tmp"; exit 1; }
  mv -f "$durable_tmp" "$durable_rom"
fi
chmod 0600 "$durable_rom"

version_tmp=".deploy-version.tmp.$$"
rom_tmp=".release-rom/${rom_name}.tmp.$$"
trap 'rm -f "$version_tmp" "$rom_tmp" .deploy-version; rm -rf .release-rom dist' EXIT
printf '%s\n' "$deploy_commit" > "$version_tmp"
mv "$version_tmp" .deploy-version
mkdir -p .release-rom
cp "$durable_rom" "$rom_tmp"
verify_rom "$rom_tmp"
mv "$rom_tmp" ".release-rom/$rom_name"

npm ci --omit=optional
npm test
npm run build
npm run test:build
CI=1 npm run test:e2e
rm -rf dist
"$root/bin/provision-and-deploy.sh"

site="https://mew.tail79fee7.ts.net:10443"
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 15 "$site/healthz" | grep -Fq "advance wars web ok" &&
    curl -fsS --max-time 15 "$site/version.json" |
      jq -e --arg expected "$deploy_commit" '.commit == $expected' >/dev/null; then
    break
  fi
  [ "$attempt" -lt 30 ] || { echo "private commit and health checks did not converge" >&2; exit 1; }
  sleep 2
done
curl -fsS --max-time 20 "$site/game-manifest.json" |
  jq -e --arg expected "$expected_sha" '.rom.sha256 == $expected' >/dev/null
security_headers="$(curl -fsSI --max-time 20 "$site/")"
grep -Eiq '^cross-origin-opener-policy: same-origin\r?$' <<<"$security_headers"
grep -Eiq '^cross-origin-embedder-policy: require-corp\r?$' <<<"$security_headers"
grep -Eiq '^strict-transport-security: max-age=31536000; includeSubDomains\r?$' <<<"$security_headers"
rom_slice="$(mktemp)"
rom_headers="$(mktemp)"
trap 'rm -f "$version_tmp" "$rom_tmp" "$rom_slice" "$rom_headers" .deploy-version; rm -rf .release-rom dist' EXIT
curl -fsS --max-time 30 --range 160-175 -D "$rom_headers" "$site/roms/$rom_name" -o "$rom_slice"
[ "$(awk '/^HTTP\// { status=$2 } END { print status }' "$rom_headers")" = 206 ]
tr -d '\r' < "$rom_headers" | grep -Eiq '^content-range: bytes 160-175/8388608$'
[ "$(wc -c < "$rom_slice" | tr -d ' ')" = 16 ]
[ "$(LC_ALL=C dd if="$rom_slice" bs=1 count=12 2>/dev/null)" = "ADVANCEWARS2" ]
[ "$(LC_ALL=C dd if="$rom_slice" bs=1 skip=12 count=4 2>/dev/null)" = "AW2E" ]

public_site="https://advance-wars.3218i.com"
if curl -fsS --max-time 15 "$public_site/version.json" 2>/dev/null |
  jq -e --arg expected "$deploy_commit" '.commit == $expected' >/dev/null 2>&1; then
  echo "refusing release: the reviewed commit is exposed through the public wildcard ingress" >&2
  exit 1
fi
if curl -fsS --max-time 15 "$public_site/healthz" 2>/dev/null |
  tr -d '\r' | grep -Fxq 'advance wars web ok'; then
  echo "refusing release: the app health marker is exposed through the public wildcard ingress" >&2
  exit 1
fi
if curl -fsS --max-time 15 "$public_site/" 2>/dev/null |
  grep -Fq 'data-release-marker="advance-wars-2-black-hole-rising"'; then
  echo "refusing release: the app shell is exposed through the public wildcard ingress" >&2
  exit 1
fi
: > "$rom_slice"
: > "$rom_headers"
if curl -fsS --max-time 30 --range 160-175 -D "$rom_headers" \
  "$public_site/roms/$rom_name" -o "$rom_slice" 2>/dev/null &&
  [ "$(awk '/^HTTP\// { status=$2 } END { print status }' "$rom_headers")" = 206 ] &&
  [ "$(wc -c < "$rom_slice" | tr -d ' ')" = 16 ] &&
  [ "$(LC_ALL=C dd if="$rom_slice" bs=1 count=12 2>/dev/null)" = "ADVANCEWARS2" ] &&
  [ "$(LC_ALL=C dd if="$rom_slice" bs=1 skip=12 count=4 2>/dev/null)" = "AW2E" ]; then
  echo "refusing release: the cartridge is exposed through the public wildcard ingress" >&2
  exit 1
fi

backend_probe="http://mew.tail79fee7.ts.net:8092/healthz"
backend_status="$(curl -sS --connect-timeout 3 --max-time 5 -o /dev/null \
  -w '%{http_code}' "$backend_probe" 2>/dev/null || true)"
if [ "$backend_status" != 000 ]; then
  echo "refusing release: private backend is reachable outside mew loopback (HTTP $backend_status)" >&2
  exit 1
fi

E2E_BASE_URL="$site" EXPECTED_COMMIT="$deploy_commit" npm run test:e2e:live
