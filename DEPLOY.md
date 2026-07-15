# Private deployment contract

Production is `https://mew.tail79fee7.ts.net:10443`, backed by the persistent CapRover app
`advance-wars`. CapRover exposes no web route, custom domain, or published port. The service is
pinned to the `mew` Swarm node and mounts `/opt/field-kit-data:/data`. An ownership-labelled,
digest-pinned nginx sidecar on the attachable overlay publishes its proxy only on
`127.0.0.1:8092`; Tailscale Serve terminates trusted HTTPS on `mew:10443`, with Funnel disabled.

The client boundary is Will's Tailnet. The unencrypted backend remains unreachable from both LAN
and Tailnet. Do not add a `3218i.com` hostname, CapRover web exposure, Swarm published port,
non-loopback proxy binding, Cloudflare route, or Tailscale Funnel entry.

The source and emulator are reproducible from Git and `package-lock.json`. Owner data stays outside
Git. `bin/release.sh` accepts only the identities in `config/games.json`, currently:

- Advance Wars 2: 8,388,608 bytes, internal `ADVANCEWARS2` / `AW2E`, SHA-256
  `ef3cc89273f9df88020f07751ea6306b25c39df01893822fe431550eedf9b134`.
- Pokemon Emerald Rogue v2.1a: 33,554,432 bytes, internal `POKEMON EMER` / `BPEE`, SHA-256
  `514d29951df8862a54381f454df0c81fa4383706f2ad1a8f5df626842e32cc34`.
- Emerald Rogue seed save: 131,072 bytes, SHA-256
  `d0efbea53b433335125d3e006e32a1702462eed661d1fe7fdd36679a1993865a`.

The server stores save-sync records under `/data/save-sync`. A QR fragment contains a random
256-bit browser capability. Browsers derive an opaque channel ID, bearer authorization, and
per-game AES-GCM key. The server persists only the authorization hash, ciphertext, revision, and
timestamp. New writes require `If-None-Match: *`; updates and deletes require the exact current
ETag. Mutations must be same-origin. The API has no list route and is bounded to known games, 64
channels, and 200 KiB ciphertext records.

The Todoboy deploy train merges and pushes the reviewed commit before invoking `./bin/release.sh`.
The script requires the train's task identity and exact commit, stages `.deploy-version` and
`.release-games/` only in the ephemeral release worktree, runs the complete gate, and invokes the
idempotent provisioner. Neither release script contains `git push`.

The provisioner recognizes and migrates only the exact original stateless Advance Wars definition;
unexpected configuration fails closed. It prepares the mode-0700 mew data directory, converges one
persistent private replica, and reads back every operator-owned CapRover and sidecar field.

Every release must prove:

- `/version.json` contains the exact merged commit and both game digests;
- `/game-manifest.json` contains both exact ROM identities and the seed-save identity;
- byte ranges return HTTP 206 and the expected internal header for each ROM;
- HTTPS carries HSTS, COOP, and COEP headers;
- `/api/healthz` proves writable storage, and a random opaque record completes a
  create/read/revision-update/delete cycle;
- the public wildcard hostname exposes neither shell/health markers nor either ROM;
- direct HTTP to port `8092` from another Tailnet client is unreachable;
- a fresh browser loads every runtime asset from the private origin, boots both games, renders
  gameplay, and registers the service worker.

A successful image upload alone is not a release.
