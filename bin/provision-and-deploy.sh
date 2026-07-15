#!/usr/bin/env bash
set -euo pipefail

app="advance-wars"
machine="${CAPROVER_MACHINE:-3218i}"
backend_port=8092
serve_port=10443
serve_dns="mew.tail79fee7.ts.net"
serve_target="http://127.0.0.1:${backend_port}"
proxy_name="advance-wars-tailnet-proxy"
proxy_network="captain-overlay-network"
proxy_service="srv-captain--${app}"
proxy_image="nginx:1.30.3-alpine@sha256:0d3b80406a13a767339fbe2f41406d6c7da727ab89cf8fae399e81f780f814d1"
login="${CAPROVER_LOGIN_TOOL:-$HOME/code/caprover-control/scripts/caprover-login.sh}"
config="${CAPROVER_CONFIG:-$HOME/.config/configstore/caprover.json}"
deploy="${CAPROVER_DEPLOY_TOOL:-$HOME/brain/bin/caprover-tar-deploy.sh}"
curl_bin="${CURL_BIN:-curl}"
ssh_bin="${SSH_BIN:-ssh}"
ssh_options=(-o BatchMode=yes -o ConnectTimeout=20)

fail() {
  echo "advance-wars provision: $*" >&2
  exit 1
}

require_status_ok() {
  local operation="$1"
  local response="$2"
  local status
  status="$(jq -r '.status // 0' <<<"$response")"
  [ "$status" = 100 ] || fail "$operation failed: $(jq -r '.description // .message // "unknown CapRover error"' <<<"$response")"
}

[ -x "$login" ] || fail "missing CapRover login helper: $login"
[ -x "$deploy" ] || fail "missing CapRover deploy helper: $deploy"
command -v jq >/dev/null 2>&1 || fail "jq is required"
command -v "$curl_bin" >/dev/null 2>&1 || fail "curl executable is unavailable: $curl_bin"
command -v "$ssh_bin" >/dev/null 2>&1 || fail "SSH executable is unavailable: $ssh_bin"

mew_node_id="$("$ssh_bin" "${ssh_options[@]}" will@mew \
  "sudo -n docker info --format '{{.Swarm.NodeID}}'")" || fail "could not discover mew's Swarm node ID"
[[ "$mew_node_id" =~ ^[a-z0-9]{25}$ ]] || fail "mew returned an invalid Swarm node ID"

"$login" >/dev/null
machine_row="$(jq -er --arg name "$machine" '
  .CapMachines[] | select(.name == $name) | [.baseUrl, .authToken] | @tsv
' "$config")" || fail "no authenticated CapRover machine named $machine in $config"
base_url="${machine_row%%$'\t'*}"
token="${machine_row#*$'\t'}"
headers=(-H "x-captain-auth: $token" -H "x-namespace: captain")

definitions="$("$curl_bin" -fsS --max-time 30 "${headers[@]}" "$base_url/api/v2/user/apps/appDefinitions")"
require_status_ok "app discovery" "$definitions"
if ! jq -e --arg app "$app" --argjson port "$backend_port" '
  [.data.appDefinitions[] | select(.appName != $app) | .ports[]? | select(.hostPort == $port)] | length == 0
' <<<"$definitions" >/dev/null; then
  fail "private backend port $backend_port is already owned by another CapRover app"
fi
app_count="$(jq -r --arg app "$app" '[.data.appDefinitions[] | select(.appName == $app)] | length' <<<"$definitions")"

if [ "$app_count" = 0 ]; then
  echo "Registering private stateless CapRover app $app..."
  payload="$(jq -nc --arg app "$app" '{appName:$app,hasPersistentData:false}')"
  response="$("$curl_bin" -fsS --max-time 60 -X POST "${headers[@]}" -H "content-type: application/json" \
    --data "$payload" "$base_url/api/v2/user/apps/appDefinitions/register")"
  require_status_ok "app registration" "$response"
elif [ "$app_count" != 1 ]; then
  fail "expected at most one app definition named $app, found $app_count"
fi

definitions="$("$curl_bin" -fsS --max-time 30 "${headers[@]}" "$base_url/api/v2/user/apps/appDefinitions")"
require_status_ok "post-registration app discovery" "$definitions"
if ! jq -e --arg app "$app" '
  [.data.appDefinitions[] | select(.appName == $app and .hasPersistentData == false)] | length == 1
' <<<"$definitions" >/dev/null; then
  fail "$app exists but is not registered as stateless; repair it deliberately before deploying"
fi
had_deployed_image="$(jq -r --arg app "$app" '
  .data.appDefinitions[] | select(.appName == $app) as $definition
  | any($definition.versions[]?;
      .version == $definition.deployedVersion
      and ((.deployedImageName // "") | length > 0))
' <<<"$definitions")"

while IFS= read -r domain; do
  [ -n "$domain" ] || continue
  echo "Removing stale public domain $domain from $app..."
  payload="$(jq -nc --arg app "$app" --arg domain "$domain" '{appName:$app,customDomain:$domain}')"
  response="$("$curl_bin" -fsS --max-time 60 -X POST "${headers[@]}" -H "content-type: application/json" \
    --data "$payload" "$base_url/api/v2/user/apps/appDefinitions/removecustomdomain")"
  require_status_ok "custom-domain removal" "$response"
done < <(jq -r --arg app "$app" '
  .data.appDefinitions[] | select(.appName == $app) | (.customDomain // [])[] | .publicDomain
' <<<"$definitions")

desired="$(jq -nc --arg app "$app" --arg node_id "$mew_node_id" '{
  appName: $app,
  hasPersistentData: false,
  projectId: "",
  description: "Private owner-only Advance Wars 2 browser PWA",
  instanceCount: 1,
  captainDefinitionRelativeFilePath: "./captain-definition",
  envVars: [],
  volumes: [],
  tags: [],
  nodeId: $node_id,
  notExposeAsWebApp: true,
  containerHttpPort: 80,
  forceSsl: false,
  ports: [],
  customDomain: [],
  appPushWebhook: {},
  redirectDomain: "",
  preDeployFunction: "",
  serviceUpdateOverride: "",
  websocketSupport: false,
  appDeployTokenConfig: {enabled:false}
}')"
response="$("$curl_bin" -fsS --max-time 120 -X POST "${headers[@]}" -H "content-type: application/json" \
  --data "$desired" "$base_url/api/v2/user/apps/appDefinitions/update")"
update_status="$(jq -r '.status // 0' <<<"$response")"
update_description="$(jq -r '.description // .message // ""' <<<"$response")"
bootstrap_without_image=0
if [ "$update_status" != 100 ]; then
  if [ "$had_deployed_image" = false ] &&
    [ "$update_description" = "ImageName for deployed version is not available, this version was probably failed due to an unsuccessful build!" ]; then
    bootstrap_without_image=1
    echo "CapRover stored the private first-release definition; an image is required before service initialization."
  else
    require_status_ok "app-definition update" "$response"
  fi
fi

definitions="$("$curl_bin" -fsS --max-time 30 "${headers[@]}" "$base_url/api/v2/user/apps/appDefinitions")"
require_status_ok "configuration verification" "$definitions"
if ! jq -e --arg app "$app" --arg node_id "$mew_node_id" --argjson port "$backend_port" '
  [.data.appDefinitions[] | select(.appName == $app)] as $matches
  | ($matches | length) == 1
  and ($matches[0].hasPersistentData == false)
  and ($matches[0].projectId == "")
  and ($matches[0].description == "Private owner-only Advance Wars 2 browser PWA")
  and ($matches[0].instanceCount == 1)
  and ($matches[0].captainDefinitionRelativeFilePath == "./captain-definition")
  and (($matches[0].envVars // []) == [])
  and (($matches[0].volumes // []) == [])
  and (($matches[0].tags // []) == [])
  and ($matches[0].nodeId == $node_id)
  and ($matches[0].notExposeAsWebApp == true)
  and ($matches[0].containerHttpPort == 80)
  and ($matches[0].forceSsl == false)
  and (($matches[0].ports // []) == [])
  and (($matches[0].customDomain // []) == [])
  and (($matches[0].appPushWebhook // {}) == {})
  and (($matches[0].redirectDomain // "") == "")
  and (($matches[0].preDeployFunction // "") == "")
  and (($matches[0].serviceUpdateOverride // "") == "")
  and (($matches[0].websocketSupport // false) == false)
  and (($matches[0].appDeployTokenConfig.enabled // false) == false)
  and ([.data.appDefinitions[] | select(.appName != $app) | .ports[]? | select(.hostPort == $port)] | length == 0)
' <<<"$definitions" >/dev/null; then
  echo "CapRover returned an app definition outside the private release contract:" >&2
  jq -c --arg app "$app" '.data.appDefinitions[] | select(.appName == $app)' <<<"$definitions" >&2
  exit 1
fi

if [ "$bootstrap_without_image" = 1 ] && ! jq -e --arg app "$app" '
  .data.appDefinitions[] | select(.appName == $app) as $definition
  | ([$definition.versions[]?
      | select(.version == $definition.deployedVersion)
      | (.deployedImageName // "")
      | select(length > 0)] | length) == 0
' <<<"$definitions" >/dev/null; then
  fail "CapRover reported a missing first image, but its read-back definition already has one"
fi

echo "Verified $app: one stateless replica pinned to mew, zero published ports, no public CapRover ingress."
"$deploy" "$app" "$machine"

"$ssh_bin" "${ssh_options[@]}" will@mew \
  "sudo -n /bin/bash -s -- '$proxy_name' '$proxy_network' '$proxy_service' '$proxy_image' '$backend_port'" <<'REMOTE_PROXY'
set -euo pipefail

proxy_name="$1"
proxy_network="$2"
proxy_service="$3"
proxy_image="$4"
backend_port="$5"
proxy_root="/opt/advance-wars-tailnet-proxy"
proxy_config="$proxy_root/nginx.conf"
owner_file="$proxy_root/.owner"
owner_label="com.willcmcc.advance-wars-web.owner"
owner_value="advance-wars-web"
config_label="com.willcmcc.advance-wars-web.proxy-config-sha256"

die() {
  echo "advance-wars private proxy: $*" >&2
  exit 1
}

for command in docker jq sha256sum curl; do
  command -v "$command" >/dev/null 2>&1 || die "$command is required"
done

[ "$(docker network inspect "$proxy_network" --format '{{.Scope}}')" = swarm ] ||
  die "$proxy_network is not a Swarm network"
[ "$(docker network inspect "$proxy_network" --format '{{.Attachable}}')" = true ] ||
  die "$proxy_network is not attachable"
network_id="$(docker network inspect "$proxy_network" --format '{{.Id}}')"

service_json=""
for attempt in $(seq 1 60); do
  if service_json="$(docker service inspect "$proxy_service" 2>/dev/null)" &&
    jq -e --arg network_id "$network_id" '
      length == 1
      and any(.[0].Spec.TaskTemplate.Networks[]?; .Target == $network_id)
      and ((.[0].Spec.EndpointSpec.Ports // []) == [])
      and ((.[0].Endpoint.Ports // []) == [])
    ' <<<"$service_json" >/dev/null; then
    break
  fi
  [ "$attempt" -lt 60 ] ||
    die "CapRover service $proxy_service did not appear on $proxy_network"
  sleep 2
done

config_contents="$(cat <<'NGINX'
worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;

events {
  worker_connections 256;
}

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log off;
  sendfile on;
  client_body_temp_path /tmp/client_temp;
  proxy_temp_path /tmp/proxy_temp;
  fastcgi_temp_path /tmp/fastcgi_temp;
  uwsgi_temp_path /tmp/uwsgi_temp;
  scgi_temp_path /tmp/scgi_temp;
  resolver 127.0.0.11 valid=5s ipv6=off;
  resolver_timeout 5s;

  upstream advance_wars {
    zone advance_wars 64k;
    server srv-captain--advance-wars:80 resolve;
  }

  server {
    listen 8080;
    server_name _;

    location / {
      proxy_pass http://advance_wars;
      proxy_http_version 1.1;
      proxy_set_header Connection "";
      proxy_set_header Host $http_host;
      proxy_set_header X-Forwarded-Host $http_host;
      proxy_set_header X-Forwarded-Proto https;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_buffering off;
      proxy_connect_timeout 5s;
      proxy_read_timeout 300s;
    }
  }
}
NGINX
)"
config_sha="$(printf '%s\n' "$config_contents" | sha256sum | awk '{print $1}')"
tmpfs_options="rw,noexec,nosuid,nodev,size=16m"

if [ -e "$proxy_root" ]; then
  [ -d "$proxy_root" ] || die "$proxy_root exists but is not a directory"
  [ ! -L "$proxy_root" ] || die "$proxy_root must not be a symbolic link"
  [ -f "$owner_file" ] || die "$proxy_root has no ownership marker"
  [ ! -L "$owner_file" ] || die "$owner_file must not be a symbolic link"
  [ "$(cat "$owner_file")" = "$owner_value" ] ||
    die "$proxy_root has an unexpected ownership marker"
else
  new_root="${proxy_root}.new.$$"
  trap 'rm -rf "$new_root"' EXIT
  install -d -m 0755 "$new_root"
  printf '%s\n' "$owner_value" > "$new_root/.owner"
  chmod 0444 "$new_root/.owner"
  mv "$new_root" "$proxy_root"
  trap - EXIT
fi

config_tmp="${proxy_config}.tmp.$$"
trap 'rm -f "$config_tmp"' EXIT
printf '%s\n' "$config_contents" > "$config_tmp"
chmod 0444 "$config_tmp"
mv -f "$config_tmp" "$proxy_config"
trap - EXIT

docker pull "$proxy_image" >/dev/null
image_id="$(docker image inspect "$proxy_image" --format '{{.Id}}')"
[ -n "$image_id" ] || die "could not resolve the pinned proxy image"

mapfile -t existing_ids < <(docker container ls -aq --filter "name=^/${proxy_name}$")
[ "${#existing_ids[@]}" -le 1 ] || die "multiple containers match $proxy_name"
existing_id="${existing_ids[0]:-}"

container_is_expected() {
  [ -n "$existing_id" ] || return 1
  docker inspect "$existing_id" | jq -e \
    --arg image_id "$image_id" \
    --arg image_ref "$proxy_image" \
    --arg owner_label "$owner_label" \
    --arg owner_value "$owner_value" \
    --arg config_label "$config_label" \
    --arg config_sha "$config_sha" \
    --arg network "$proxy_network" \
    --arg config "$proxy_config" \
    --arg tmpfs_options "$tmpfs_options" \
    --arg port "$backend_port" '
      length == 1
      and .[0].State.Running == true
      and .[0].Image == $image_id
      and .[0].Config.Image == $image_ref
      and .[0].Config.User == "101:101"
      and .[0].Config.Labels[$owner_label] == $owner_value
      and .[0].Config.Labels[$config_label] == $config_sha
      and .[0].HostConfig.RestartPolicy.Name == "unless-stopped"
      and .[0].HostConfig.ReadonlyRootfs == true
      and .[0].HostConfig.Privileged == false
      and ((.[0].HostConfig.CapAdd // []) == [])
      and ((.[0].HostConfig.CapDrop // []) == ["ALL"])
      and ((.[0].HostConfig.SecurityOpt // []) == ["no-new-privileges"])
      and ((.[0].HostConfig.Tmpfs // {} | keys) == ["/tmp"])
      and ((.[0].HostConfig.Tmpfs["/tmp"] | split(",") | sort) ==
        ($tmpfs_options | split(",") | sort))
      and .[0].HostConfig.PortBindings == {
        "8080/tcp": [{"HostIp":"127.0.0.1","HostPort":$port}]
      }
      and ((.[0].NetworkSettings.Networks | keys) == [$network])
      and (.[0].Mounts | length) == 1
      and .[0].Mounts[0].Type == "bind"
      and .[0].Mounts[0].Source == $config
      and .[0].Mounts[0].Destination == "/etc/nginx/nginx.conf"
      and .[0].Mounts[0].RW == false
    ' >/dev/null
}

if [ -n "$existing_id" ]; then
  existing_owner="$(docker inspect "$existing_id" \
    --format "{{ index .Config.Labels \"$owner_label\" }}")"
  [ "$existing_owner" = "$owner_value" ] ||
    die "refusing to replace unexpected container named $proxy_name"
  if ! container_is_expected; then
    docker rm -f "$existing_id" >/dev/null
    existing_id=""
  fi
fi

if [ -z "$existing_id" ]; then
  running_ids="$(docker container ls -q)"
  if [ -n "$running_ids" ] &&
    docker inspect $running_ids | jq -e --arg port "$backend_port" '
      any(.[].HostConfig.PortBindings // {} | to_entries[];
        any(.value[]?; .HostPort == $port))
    ' >/dev/null; then
    die "host port $backend_port is published by another container"
  fi
  if command -v ss >/dev/null 2>&1 &&
    ss -H -ltn | awk -v port="$backend_port" '
      { count = split($4, pieces, ":"); if (pieces[count] == port) found = 1 }
      END { exit found ? 0 : 1 }
    '; then
    die "host port $backend_port already has a non-Docker listener"
  fi

  existing_id="$(docker run -d \
    --name "$proxy_name" \
    --label "$owner_label=$owner_value" \
    --label "$config_label=$config_sha" \
    --restart unless-stopped \
    --network "$proxy_network" \
    --publish "127.0.0.1:${backend_port}:8080" \
    --mount "type=bind,src=$proxy_config,dst=/etc/nginx/nginx.conf,readonly" \
    --read-only \
    --tmpfs "/tmp:$tmpfs_options" \
    --user 101:101 \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    "$proxy_image")"
  container_is_expected || die "private proxy container read-back did not converge"
fi

for attempt in $(seq 1 60); do
  if curl -fsS --max-time 5 "http://127.0.0.1:${backend_port}/healthz" |
    grep -Fq 'advance wars web ok'; then
    exit 0
  fi
  [ "$attempt" -lt 60 ] || {
    docker logs --tail 100 "$proxy_name" >&2 || true
    die "private proxy did not become healthy on loopback port $backend_port"
  }
  sleep 2
done
REMOTE_PROXY

"$ssh_bin" "${ssh_options[@]}" will@mew "sudo -n /bin/bash -s -- '$serve_dns' '$serve_port' '$serve_target'" <<'REMOTE'
set -euo pipefail

dns="$1"
https_port="$2"
target="$3"
host_port="$dns:$https_port"
state="$(tailscale serve status --json)"

is_expected() {
  jq -e --arg port "$https_port" --arg host_port "$host_port" --arg target "$target" '
    .TCP[$port].HTTPS == true
    and .TCP[$port].HTTP != true
    and .Web[$host_port].Handlers["/"].Proxy == $target
    and (((.Web[$host_port].Handlers // {}) | keys) == ["/"])
    and (((.AllowFunnel // {})[$host_port] // false) == false)
  ' >/dev/null
}

if ! is_expected <<<"$state"; then
  jq -e --arg port "$https_port" --arg host_port "$host_port" '
    .TCP[$port] == null
    and .Web[$host_port] == null
    and (((.AllowFunnel // {})[$host_port] // false) == false)
  ' <<<"$state" >/dev/null || {
    echo "refusing to replace unexpected Tailscale Serve config on $host_port" >&2
    exit 1
  }
  tailscale serve --bg --yes --https="$https_port" "$target"
  state="$(tailscale serve status --json)"
  is_expected <<<"$state" || {
    echo "Tailscale Serve read-back did not converge" >&2
    printf '%s\n' "$state" >&2
    exit 1
  }
fi
REMOTE
